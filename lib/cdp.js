/**
 * Optional Chrome DevTools Protocol layer.
 *
 * chrome.debugger can only be used with the "debugger" permission. It is
 * attached lazily (only when a CDP tool is called) because Chromium shows a
 * "started debugging this browser" infobar while a session is open.
 */

const sessions = new Set();

const RISKY_ATTRIBUTES =
  /(password|otp|one[-_ ]?time|token|secret|api[-_ ]?key|card|cvv|cvc|ssn|social security|id[-_ ]?number)/i;

function assertTabId(tabId) {
  if (!Number.isInteger(Number(tabId)) || Number(tabId) <= 0) throw new Error('No active tab for CDP');
  return Number(tabId);
}

export function isAttached(tabId) {
  return sessions.has(Number(tabId));
}

export async function attach(tabId) {
  const id = assertTabId(tabId);
  if (sessions.has(id)) return;
  await chrome.debugger.attach({ tabId: id }, '1.3');
  sessions.add(id);
  for (const domain of ['Page.enable', 'DOM.enable', 'Accessibility.enable']) {
    await chrome.debugger.sendCommand({ tabId: id }, domain).catch(() => {});
  }
}

export async function detach(tabId) {
  const id = Number(tabId);
  if (!sessions.has(id)) return;
  sessions.delete(id);
  await chrome.debugger.detach({ tabId: id }).catch(() => {});
}

export async function detachAll() {
  for (const id of [...sessions]) await detach(id);
}

export function forget(tabId) {
  sessions.delete(Number(tabId));
}

export async function send(tabId, method, params = {}) {
  const id = assertTabId(tabId);
  await attach(id);
  return chrome.debugger.sendCommand({ tabId: id }, method, params);
}

export async function captureScreenshot(tabId) {
  const result = await send(tabId, 'Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  return `data:image/png;base64,${result.data}`;
}

/** Compact AX nodes into a model-friendly list; backend ids let cdp_click act. */
export function compactAXTree(nodes, limit = 160) {
  const output = [];
  for (const node of nodes || []) {
    if (node.ignored) continue;
    const role = node.role?.value || '';
    if (!role) continue;
    const name = node.name?.value || '';
    const value = node.value?.value || '';
    if (!name && !value && !['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'menuitem', 'tab'].includes(role)) {
      continue;
    }
    output.push({
      backend_node_id: node.backendDOMNodeId,
      role,
      name: String(name).slice(0, 200),
      value: String(value).slice(0, 200),
      description: String(node.description?.value || '').slice(0, 200),
      frame_id: node.frameId || '',
      child_count: node.childIds?.length || 0,
    });
    if (output.length >= limit) break;
  }
  return output;
}

export async function accessibilityTree(tabId, limit = 160) {
  const { nodes } = await send(tabId, 'Accessibility.getFullAXTree', { depth: -1 });
  return compactAXTree(nodes, limit);
}

export async function nodeIdFor(tabId, backendNodeId) {
  await send(tabId, 'DOM.getDocument', { depth: -1, pierce: true });
  const { nodeIds } = await send(tabId, 'DOM.pushNodesByBackendIdsToFrontend', {
    backendNodeIds: [backendNodeId],
  });
  const nodeId = nodeIds?.[0];
  if (!nodeId) throw new Error('Element is no longer in the DOM');
  return nodeId;
}

export async function backendNodeForSelector(tabId, selector) {
  const { root } = await send(tabId, 'DOM.getDocument', { depth: -1, pierce: true });
  const { nodeId } = await send(tabId, 'DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error(`Element not found: ${selector}`);
  const { node } = await send(tabId, 'DOM.describeNode', { nodeId });
  return node.backendNodeId;
}

export async function nodeAttributes(tabId, backendNodeId) {
  const nodeId = await nodeIdFor(tabId, backendNodeId);
  const { attributes } = await send(tabId, 'DOM.getAttributes', { nodeId });
  const result = {};
  for (let i = 0; i + 1 < (attributes || []).length; i += 2) result[attributes[i]] = attributes[i + 1];
  return result;
}

export function assertSafeInput(attributes = {}) {
  const type = String(attributes.type || '').toLowerCase();
  if (type === 'password' || type === 'hidden') throw new Error('CDP refuses password/hidden fields');
  const probe = [attributes.name, attributes.id, attributes.placeholder, attributes.autocomplete, attributes['aria-label']]
    .filter(Boolean)
    .join(' ');
  if (RISKY_ATTRIBUTES.test(probe) || RISKY_ATTRIBUTES.test(type)) {
    throw new Error('CDP refuses OTP/token/secret/card/ID fields');
  }
}

export async function boxCenter(tabId, backendNodeId) {
  const nodeId = await nodeIdFor(tabId, backendNodeId);
  const { model } = await send(tabId, 'DOM.getBoxModel', { nodeId });
  const quad = model?.border || model?.content;
  if (!quad || quad.length < 8) throw new Error('Element has no box model');
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

export async function clickAt(tabId, x, y, button = 'left') {
  const common = { x: Math.round(x), y: Math.round(y), button, clickCount: 1 };
  await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: common.x, y: common.y });
  await send(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', buttons: 1, ...common });
  await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', buttons: 0, ...common });
}

export async function clickNode(tabId, backendNodeId, button = 'left') {
  const center = await boxCenter(tabId, backendNodeId);
  await clickAt(tabId, center.x, center.y, button);
  return center;
}

export async function focusNode(tabId, backendNodeId) {
  const nodeId = await nodeIdFor(tabId, backendNodeId);
  await send(tabId, 'DOM.focus', { nodeId });
}

export async function nodeValue(tabId, backendNodeId) {
  const { object } = await send(tabId, 'DOM.resolveNode', { backendNodeId });
  if (!object?.objectId) return '';
  try {
    const { result } = await send(tabId, 'Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function(){ return this.value ?? this.textContent ?? ""; }',
      returnByValue: true,
    });
    return String(result?.value ?? '');
  } finally {
    await send(tabId, 'Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
  }
}

export async function typeNode(tabId, backendNodeId, text, { clear = true, submit = false } = {}) {
  const attributes = await nodeAttributes(tabId, backendNodeId);
  assertSafeInput(attributes);
  await focusNode(tabId, backendNodeId);
  if (clear) {
    await pressKey(tabId, 'a', ['Control']);
    await pressKey(tabId, 'Backspace');
  }
  await send(tabId, 'Input.insertText', { text: String(text) });
  if (submit) await pressKey(tabId, 'Enter');
  return { attributes, actual: await nodeValue(tabId, backendNodeId) };
}

const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

export function modifierMask(modifiers = []) {
  return modifiers.reduce((mask, name) => mask | (MODIFIER_BITS[name] || 0), 0);
}

export async function pressKey(tabId, key, modifiers = [], repeat = 1) {
  const mask = modifierMask(modifiers);
  const count = Math.min(Math.max(Number(repeat) || 1, 1), 20);
  for (let i = 0; i < count; i += 1) {
    await send(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      modifiers: mask,
      windowsVirtualKeyCode: key === 'Enter' ? 13 : key === 'Tab' ? 9 : key === 'Backspace' ? 8 : 0,
    });
    await send(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      modifiers: mask,
      windowsVirtualKeyCode: key === 'Enter' ? 13 : key === 'Tab' ? 9 : key === 'Backspace' ? 8 : 0,
    });
  }
}

export async function setFileInput(tabId, backendNodeId, files) {
  const list = (Array.isArray(files) ? files : [files]).map(String).filter(Boolean);
  if (list.length === 0) throw new Error('No file paths given');
  const nodeId = await nodeIdFor(tabId, backendNodeId);
  await send(tabId, 'DOM.setFileInputFiles', { nodeId, files: list });
}
