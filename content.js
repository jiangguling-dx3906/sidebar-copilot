/**
 * Page extraction helpers, injected on demand by the side panel.
 * Runs in the extension's isolated world; never modifies the page.
 */
(() => {
  'use strict';

  const VERSION = '2.0.0';
  if (window.__SC_EXTRACT__ && window.__SC_EXTRACT_VERSION__ === VERSION) return;
  window.__SC_EXTRACT_VERSION__ = VERSION;

  const EXCLUDED = [
    'script',
    'style',
    'noscript',
    'template',
    'svg',
    'canvas',
    'iframe',
    'nav',
    'footer',
    'aside',
    'form',
    'button',
    'select',
    'input',
    'textarea',
    '[aria-hidden="true"]',
    '[hidden]',
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    '[role="dialog"]',
    '.ad',
    '.ads',
    '.advert',
    '.cookie',
    '.newsletter',
    '.sidebar',
  ].join(',');

  const BLOCK = 'h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,figcaption,dd,dt';
  const MAX_BLOCKS = 4000;
  const MAX_TEXT = 80000;
  const MAX_SELECTION = 8000;

  function normalize(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[\t ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function isExcluded(element) {
    try {
      return Boolean(element.closest(EXCLUDED));
    } catch {
      return false;
    }
  }

  function nestedInBlock(element) {
    const parent = element.parentElement;
    if (!parent) return false;
    try {
      return Boolean(parent.closest('li, blockquote, figcaption, dd, dt'));
    } catch {
      return false;
    }
  }

  function pickRoot() {
    const candidates = Array.from(
      document.querySelectorAll('article, main, [role="main"], #content, #main, .post, .article'),
    ).filter((element) => !isExcluded(element));

    let best = null;
    let bestLength = 0;
    for (const element of candidates) {
      const length = (element.textContent || '').length;
      if (length > bestLength) {
        best = element;
        bestLength = length;
      }
    }
    if (!best || bestLength < 400) return document.body;
    return best;
  }

  function readMeta() {
    const meta = (selector) => document.querySelector(selector)?.getAttribute('content') || '';
    const title = normalize(document.title) || normalize(document.querySelector('h1')?.innerText);
    return {
      title,
      url: location.href,
      site: meta('meta[property="og:site_name"]') || location.hostname,
      description: normalize(meta('meta[name="description"]') || meta('meta[property="og:description"]')).slice(0, 500),
      lang: document.documentElement.lang || '',
    };
  }

  function readContent(root) {
    const parts = [];
    const headings = [];
    const seen = new Set();
    const blocks = Array.from(root.querySelectorAll(BLOCK)).slice(0, MAX_BLOCKS);

    for (const element of blocks) {
      if (isExcluded(element)) continue;
      if (element.closest('table')) continue;
      if (nestedInBlock(element)) continue;

      const tag = element.tagName.toLowerCase();
      const text = normalize(element.innerText || element.textContent || '');
      if (text.length < 2) continue;

      if (/^h[1-6]$/.test(tag)) {
        const level = Math.min(Number(tag[1]), 4);
        const heading = text.replace(/\s+/g, ' ').slice(0, 300);
        headings.push({ level, text: heading });
        parts.push(`${'#'.repeat(level)} ${heading}`);
        continue;
      }

      const key = text.slice(0, 100);
      if (seen.has(key)) continue;
      seen.add(key);

      if (tag === 'li') parts.push(`- ${text}`);
      else if (tag === 'blockquote') parts.push(text.split('\n').map((line) => `> ${line}`).join('\n'));
      else if (tag === 'pre') parts.push(`\`\`\`\n${text}\n\`\`\``);
      else parts.push(text);
    }

    let output = parts.join('\n\n');
    if (output.length < 300) {
      const fallback = normalize(root.innerText || root.textContent || '');
      if (fallback.length > output.length) output = fallback;
    }
    return { text: output.slice(0, MAX_TEXT), headings: headings.slice(0, 40) };
  }

  function splitRow(row) {
    return Array.from(row.children)
      .filter((cell) => /^(TD|TH)$/.test(cell.tagName))
      .slice(0, 12)
      .map((cell) => normalize(cell.innerText || cell.textContent).replace(/\|/g, '\\|').replace(/\n+/g, ' '));
  }

  function readTables(root) {
    return Array.from(root.querySelectorAll('table'))
      .filter((table) => !isExcluded(table))
      .slice(0, 6)
      .map((table) => {
        const rows = Array.from(table.querySelectorAll('tr')).slice(0, 30).map(splitRow);
        const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
        if (width < 2 || rows.length < 2) return '';
        const pad = (row) => {
          const copy = row.slice(0, width);
          while (copy.length < width) copy.push('');
          return copy;
        };
        const header = pad(rows[0]);
        const separator = header.map(() => '---');
        return [header, separator, ...rows.slice(1).map(pad)]
          .map((row) => `| ${row.join(' | ')} |`)
          .join('\n');
      })
      .filter(Boolean);
  }

  function readLinks(root) {
    const links = [];
    const seen = new Set();
    const current = `${location.origin}${location.pathname}${location.search}`;

    for (const anchor of Array.from(root.querySelectorAll('a[href]'))) {
      if (isExcluded(anchor)) continue;
      let url;
      try {
        url = new URL(anchor.getAttribute('href'), location.href);
      } catch {
        continue;
      }
      if (!/^https?:$/.test(url.protocol)) continue;
      if (`${url.origin}${url.pathname}${url.search}` === current) continue;
      const href = url.href;
      if (seen.has(href)) continue;
      seen.add(href);
      const text = normalize(anchor.innerText || anchor.getAttribute('aria-label') || '').slice(0, 80);
      if (!text) continue;
      links.push({ text, href: href.slice(0, 500) });
      if (links.length >= 40) break;
    }
    return links;
  }

  window.__SC_EXTRACT__ = function extract(options = {}) {
    const limit = Math.min(Math.max(Number(options.maxChars) || MAX_TEXT, 1000), MAX_TEXT);
    const meta = readMeta();
    const root = pickRoot();
    const content = readContent(root);
    const tables = readTables(root);
    const text = [content.text, ...tables].filter(Boolean).join('\n\n');

    let selection = '';
    try {
      selection = normalize(String(window.getSelection() || '')).slice(0, MAX_SELECTION);
    } catch {
      selection = '';
    }

    return {
      version: VERSION,
      title: meta.title || document.title,
      url: meta.url,
      site: meta.site,
      description: meta.description,
      lang: meta.lang,
      selection,
      text: text.slice(0, limit),
      charCount: text.length,
      truncated: text.length > limit,
      headings: content.headings,
      links: readLinks(root),
      media: readMediaSummary(),
      extractedAt: new Date().toISOString(),
    };
  };

  function readMediaSummary() {
    return Array.from(document.querySelectorAll('video, audio'))
      .slice(0, 3)
      .map((media) => ({
        tag: media.tagName.toLowerCase(),
        duration: Number.isFinite(media.duration) ? Math.round(media.duration * 10) / 10 : null,
        currentTime: Math.round(media.currentTime * 10) / 10,
        paused: media.paused,
        volume: Math.round(media.volume * 100) / 100,
        playbackRate: media.playbackRate,
        title: document.title,
      }));
  }

  /* ------------------------------------------------------------------ */
  /* page actions                                                        */
  /* ------------------------------------------------------------------ */

  const INTERACTIVE = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    'summary',
    'label',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="combobox"]',
    '[onclick]',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const registry = new Map();
  const refByElement = new WeakMap();
  let refSequence = 0;
  let snapshotId = '';
  let snapshotRefs = new Set();
  let deepRoots = null;

  function nextSnapshot() {
    snapshotId =
      globalThis.crypto?.randomUUID?.() ||
      `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    snapshotRefs = new Set();
    deepRoots = null;
    return snapshotId;
  }

  function rootsDeep() {
    if (deepRoots) return deepRoots;
    const roots = [document];
    const visit = (root) => {
      let nodes;
      try {
        nodes = root.querySelectorAll('*');
      } catch {
        return;
      }
      for (const node of nodes) {
        if (!node.shadowRoot) continue;
        roots.push(node.shadowRoot);
        visit(node.shadowRoot);
      }
    };
    visit(document);
    deepRoots = roots;
    return roots;
  }

  function queryAllDeep(selector) {
    const found = [];
    const seen = new Set();
    for (const root of rootsDeep()) {
      let nodes;
      try {
        nodes = root.querySelectorAll(selector);
      } catch {
        return [];
      }
      for (const node of nodes) {
        if (seen.has(node)) continue;
        seen.add(node);
        found.push(node);
      }
    }
    return found;
  }

  function isVisibleElement(element) {
    if (!(element instanceof Element)) return false;
    if (!element.isConnected) return false;
    try {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (Number(style.opacity) === 0) return false;
      if (element.closest('[hidden], [aria-hidden="true"]')) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  }

  function isDisabled(element) {
    return Boolean(
      element.disabled ||
        element.getAttribute('aria-disabled') === 'true' ||
        (element.matches?.(':disabled') ?? false),
    );
  }

  function isSensitiveField(element) {
    const type = (element.getAttribute?.('type') || '').toLowerCase();
    if (['password', 'hidden', 'file'].includes(type)) return true;
    const label = [
      element.getAttribute?.('name'),
      element.getAttribute?.('id'),
      element.getAttribute?.('autocomplete'),
      element.getAttribute?.('placeholder'),
      element.getAttribute?.('aria-label'),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return /(password|passwd|pwd|otp|one[-_ ]?time|token|secret|api[-_ ]?key|card number|cvv|cvc|ssn|social security|id[-_ ]?number)/.test(
      label,
    );
  }

  function labelOf(element) {
    const type = (element.getAttribute?.('type') || '').toLowerCase();
    const safeValue = type === 'password' || isSensitiveField(element) ? '' : element.value;
    const raw =
      element.getAttribute?.('aria-label') ||
      element.getAttribute?.('title') ||
      element.innerText ||
      safeValue ||
      element.getAttribute?.('placeholder') ||
      element.getAttribute?.('alt') ||
      element.textContent ||
      '';
    return normalize(raw).replace(/\s+/g, ' ').slice(0, 120);
  }

  function implicitRole(element) {
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute('type') || '').toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      return 'textbox';
    }
    return element.getAttribute('role') || '';
  }

  function refFor(element) {
    const existing = refByElement.get(element);
    if (existing && registry.get(existing) === element) {
      snapshotRefs.add(existing);
      return existing;
    }
    refSequence += 1;
    const ref = `e${refSequence}`;
    registry.set(ref, element);
    refByElement.set(element, ref);
    snapshotRefs.add(ref);
    if (registry.size > 400) {
      for (const [key, node] of registry) {
        if (!node.isConnected) registry.delete(key);
        if (registry.size <= 300) break;
      }
    }
    return ref;
  }

  function describeElement(element) {
    const rect = element.getBoundingClientRect();
    const type = (element.getAttribute('type') || '').toLowerCase();
    const role = implicitRole(element);
    const result = {
      ref: refFor(element),
      tag: element.tagName.toLowerCase(),
      role,
      name: labelOf(element),
      disabled: isDisabled(element),
      inViewport:
        rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth,
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
    };
    if (element.getAttribute('type')) result.type = type;
    if (element.getAttribute('placeholder')) result.placeholder = element.getAttribute('placeholder');
    if (element.href) result.href = String(element.href).slice(0, 300);
    if ('checked' in element && (type === 'checkbox' || type === 'radio')) {
      result.checked = Boolean(element.checked);
    }
    if (
      !isSensitiveField(element) &&
      'value' in element &&
      typeof element.value === 'string' &&
      element.value &&
      result.tag !== 'select'
    ) {
      result.value = element.value.slice(0, 120);
    }
    return result;
  }

  function findByText(text) {
    const needle = normalize(text).toLowerCase();
    const exact = [];
    const partial = [];
    for (const element of queryAllDeep(INTERACTIVE)) {
      if (!isVisibleElement(element)) continue;
      const label = labelOf(element).toLowerCase();
      if (!label) continue;
      if (label === needle) exact.push(element);
      else if (label.includes(needle)) partial.push(element);
      if (exact.length >= 40 || exact.length + partial.length >= 200) break;
    }
    return [...exact, ...partial];
  }

  function findQueryElements(query) {
    let selectorMatches = [];
    try {
      selectorMatches = queryAllDeep(query);
    } catch {
      return findByText(query);
    }
    if (selectorMatches.length > 0) return selectorMatches;
    return findByText(query);
  }

  function inspectPage(params = {}) {
    nextSnapshot();
    const limit = Math.min(Math.max(Number(params.limit) || 24, 1), 80);
    const query = String(params.query || '').trim();
    let candidates;

    if (query) {
      candidates = findQueryElements(query).filter(isVisibleElement);
    } else {
      const all = queryAllDeep(INTERACTIVE).filter(isVisibleElement);
      const inView = [];
      const offView = [];
      for (const element of all) {
        const rect = element.getBoundingClientRect();
        const visible =
          rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
        (visible ? inView : offView).push(element);
      }
      candidates = [...inView, ...offView];
    }

    const elements = [];
    for (const element of candidates) {
      if (elements.some((picked) => picked !== element && picked.contains(element))) continue;
      elements.push(element);
      if (elements.length >= limit) break;
    }

    return {
      ok: true,
      snapshotId,
      url: location.href,
      title: document.title,
      count: elements.length,
      elements: elements.map(describeElement),
      note:
        candidates.length > elements.length
          ? `页面上还有更多元素，只返回了前 ${elements.length} 个；可以用 query 过滤。`
          : undefined,
    };
  }

  function resolveTarget(params = {}) {
    if (params.ref) {
      const ref = String(params.ref);
      if (!snapshotRefs.has(ref)) {
        return { error: `ref "${ref}" 属于旧快照，请重新 inspect_page` };
      }
      const element = registry.get(ref);
      if (!element || !element.isConnected) {
        return { error: `ref "${ref}" 已失效，请重新 inspect_page` };
      }
      return { element };
    }
    if (params.selector) {
      let element = null;
      try {
        element = queryAllDeep(String(params.selector))[0] || null;
      } catch {
        return { error: `CSS 选择器不合法：${params.selector}` };
      }
      if (!element) return { error: `找不到元素：${params.selector}` };
      if (!isVisibleElement(element)) return { error: '元素存在但不可见' };
      return { element };
    }
    if (params.text) {
      const [element] = findByText(String(params.text));
      if (!element) return { error: `页面上找不到包含 “${params.text}” 的可点击元素` };
      return { element };
    }
    return { error: '需要 ref、selector 或 text 之一' };
  }

  function flash(element) {
    try {
      const previousOutline = element.style.outline;
      const previousOffset = element.style.outlineOffset;
      element.style.outline = '2px solid #6366f1';
      element.style.outlineOffset = '2px';
      setTimeout(() => {
        element.style.outline = previousOutline;
        element.style.outlineOffset = previousOffset;
      }, 1200);
    } catch {
      /* styling is best-effort */
    }
  }

  function coveredBy(element) {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;
    const top = document.elementFromPoint(x, y);
    if (!top || top === element || element.contains(top) || top.contains(element)) return null;
    return labelOf(top) || top.tagName.toLowerCase();
  }

  function pointTarget(params = {}) {
    if (Number.isFinite(Number(params.x)) && Number.isFinite(Number(params.y))) {
      const element = document.elementFromPoint(Number(params.x), Number(params.y));
      if (!element) return { error: '该坐标没有可点击元素' };
      return { element };
    }
    return resolveTarget(params);
  }

  function clickElement(params = {}) {
    const { element, error } = pointTarget(params);
    if (error) return { ok: false, error };
    if (isDisabled(element)) return { ok: false, error: `“${labelOf(element)}”处于禁用状态` };

    const info = describeElement(element);
    const beforeUrl = location.href;
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    const x = Number.isFinite(Number(params.x)) ? Number(params.x) : rect.left + rect.width / 2;
    const y = Number.isFinite(Number(params.y)) ? Number(params.y) : rect.top + rect.height / 2;
    const blocker = coveredBy(element);
    flash(element);
    dispatchPointerSequence(element, x, y);
    element.click();

    return {
      ok: true,
      clicked: info.name || info.tag,
      tag: info.tag,
      url: location.href,
      beforeUrl,
      verified: false,
      uncertain: true,
      postcondition: { type: 'clickDispatched', matched: false },
      warning: blocker ? `元素中心被“${blocker}”覆盖，点击可能没有生效` : undefined,
    };
  }

  function doubleClickElement(params = {}) {
    const { element, error } = pointTarget(params);
    if (error) return { ok: false, error };
    if (isDisabled(element)) return { ok: false, error: `“${labelOf(element)}”处于禁用状态` };
    const info = describeElement(element);
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    flash(element);
    dispatchPointerSequence(element, x, y);
    dispatchPointerSequence(element, x, y);
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    return {
      ok: true,
      doubleClicked: info.name || info.tag,
      verified: false,
      uncertain: true,
      postcondition: { type: 'doubleClickDispatched', matched: false },
    };
  }

  function rightClickElement(params = {}) {
    const { element, error } = resolveTarget(params);
    if (error) return { ok: false, error };
    const info = describeElement(element);
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    flash(element);
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window, button: 2 };
    element.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 2 }));
    element.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    element.dispatchEvent(new MouseEvent('contextmenu', base));
    return {
      ok: true,
      rightClicked: info.name || info.tag,
      verified: false,
      uncertain: true,
      postcondition: { type: 'contextMenuDispatched', matched: false },
    };
  }

  function focusElement(params = {}) {
    const { element, error } = resolveTarget(params);
    if (error) return { ok: false, error };
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    element.focus({ preventScroll: true });
    const active = document.activeElement;
    return {
      ok: true,
      focused: labelOf(element) || element.tagName.toLowerCase(),
      verified: active === element,
      postcondition: { type: 'activeElement', matched: active === element },
    };
  }

  function writeNativeValue(element, value) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const prototype =
        element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, String(value));
      else element.value = String(value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (element.isContentEditable) {
      element.textContent = String(value);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(value), inputType: 'insertText' }));
      return true;
    }
    return false;
  }

  function clearElement(params = {}) {
    const { element, error } = resolveTarget(params);
    if (error) return { ok: false, error };
    if (!writeNativeValue(element, '')) return { ok: false, error: '目标不是可清空的输入框' };
    const actual = 'value' in element ? String(element.value || '') : String(element.textContent || '');
    return {
      ok: true,
      cleared: labelOf(element) || element.tagName.toLowerCase(),
      verified: actual.length === 0,
      postcondition: { type: 'emptyValue', matched: actual.length === 0 },
    };
  }

  function setChecked(params = {}, checked) {
    const { element, error } = resolveTarget(params);
    if (error) return { ok: false, error };
    const type = (element.getAttribute('type') || '').toLowerCase();
    if (!(element instanceof HTMLInputElement) || (type !== 'checkbox' && type !== 'radio')) {
      return { ok: false, error: '目标不是 checkbox/radio' };
    }
    if (isDisabled(element)) return { ok: false, error: '目标处于禁用状态' };
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    if (Boolean(element.checked) !== Boolean(checked)) {
      element.click();
    }
    return {
      ok: true,
      checked: Boolean(element.checked),
      verified: Boolean(element.checked) === Boolean(checked),
      postcondition: { type: 'checked', expected: Boolean(checked), actual: Boolean(element.checked) },
    };
  }

  function selectText(params = {}) {
    const { element, error } = resolveTarget(params);
    if (error) return { ok: false, error };
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    element.focus({ preventScroll: true });
    let length = 0;
    let verified = false;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.select();
      length = Math.abs((element.selectionEnd || 0) - (element.selectionStart || 0));
      verified = length > 0 && element.selectionStart === 0;
    } else if (element.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      length = String(selection || '').length;
      verified = length > 0;
    } else {
      return { ok: false, error: '目标不是可选中文本的输入框' };
    }
    return {
      ok: true,
      selectedLength: length,
      verified,
      postcondition: { type: 'selectionLength', matched: verified, actual: length },
    };
  }

  function getElementInfo(params = {}) {
    const { element, error } = resolveTarget(params);
    if (error) return { ok: false, error };
    const type = (element.getAttribute('type') || '').toLowerCase();
    const sensitive = isSensitiveField(element);
    const attributes = {};
    for (const attr of Array.from(element.attributes || []).slice(0, 30)) {
      if (attr.name === 'value' && (type === 'password' || sensitive)) continue;
      attributes[attr.name] = String(attr.value).slice(0, 200);
    }
    return {
      ok: true,
      element: describeElement(element),
      text: normalize(element.innerText || element.textContent || '').slice(0, 2000),
      value:
        type === 'password' || sensitive || !('value' in element)
          ? undefined
          : String(element.value || '').slice(0, 500),
      checked: 'checked' in element ? Boolean(element.checked) : undefined,
      selected: element instanceof HTMLOptionElement ? Boolean(element.selected) : undefined,
      disabled: isDisabled(element),
      visible: isVisibleElement(element),
      attributes,
      html: String(element.outerHTML || '').slice(0, 1200),
      verified: true,
      postcondition: { type: 'elementInfo', matched: true },
    };
  }

  function scrollInside(params = {}) {
    const { element, error } = resolveTarget(params);
    if (error) return { ok: false, error };
    const direction = params.direction || 'down';
    const amount = Number(params.amount) || Math.round(element.clientHeight * 0.8) || 300;
    if (direction === 'top') element.scrollTo({ top: 0, behavior: 'instant' });
    else if (direction === 'bottom') element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
    else if (direction === 'up') element.scrollBy({ top: -amount, behavior: 'instant' });
    else element.scrollBy({ top: amount, behavior: 'instant' });
    return {
      ok: true,
      scrollTop: Math.round(element.scrollTop),
      scrollHeight: Math.round(element.scrollHeight),
      clientHeight: Math.round(element.clientHeight),
      verified: true,
      postcondition: { type: 'scrollTop', actual: Math.round(element.scrollTop) },
    };
  }

  function dispatchPointerSequence(element, x, y) {
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      view: window,
    };
    try {
      element.dispatchEvent(
        new PointerEvent('pointerdown', {
          ...base,
          button: 0,
          buttons: 1,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        }),
      );
    } catch {
      /* PointerEvent is optional */
    }
    element.dispatchEvent(new MouseEvent('mousedown', { ...base, button: 0, buttons: 1 }));
    try {
      element.dispatchEvent(
        new PointerEvent('pointerup', {
          ...base,
          button: 0,
          buttons: 0,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        }),
      );
    } catch {
      /* ignore */
    }
    element.dispatchEvent(new MouseEvent('mouseup', { ...base, button: 0, buttons: 0 }));
  }

  function submitFrom(element) {
    const form = element.form || element.closest?.('form');
    if (form && typeof form.requestSubmit === 'function') {
      setTimeout(() => {
        try {
          form.requestSubmit();
        } catch {
          /* ignore */
        }
      }, 0);
      return true;
    }
    for (const type of ['keydown', 'keypress', 'keyup']) {
      element.dispatchEvent(
        new KeyboardEvent(type, {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
    return false;
  }

  function typeIntoElement(params = {}) {
    const { element, error } = resolveTarget(params);
    if (error) return { ok: false, error };

    const type = (element.getAttribute('type') || '').toLowerCase();
    if (type === 'password') {
      return { ok: false, error: '拒绝填写密码字段，请让用户自己输入' };
    }
    if (type === 'hidden' || type === 'file') {
      return { ok: false, error: `不支持填写 type=${type} 的输入框` };
    }
    if (isSensitiveField(element)) {
      return { ok: false, error: '拒绝填写验证码/令牌/密钥/银行卡等敏感字段，请让用户自己输入' };
    }

    const text = String(params.text ?? '');
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    element.focus({ preventScroll: true });
    flash(element);

    let next = text;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      next = params.clear === false ? `${element.value}${text}` : text;
    } else if (!element.isContentEditable) {
      return { ok: false, error: '目标不是可输入的输入框' };
    }

    if (!writeNativeValue(element, next)) {
      return { ok: false, error: '目标不是可输入的输入框' };
    }

    const actual =
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? String(element.value || '')
        : String(element.textContent || '');
    const verified = actual === next;
    const submitted = params.submit ? submitFrom(element) : false;
    return {
      ok: true,
      field: labelOf(element) || element.tagName.toLowerCase(),
      length: text.length,
      valueLength: actual.length,
      verified,
      postcondition: { type: 'inputValue', matched: verified, expectedLength: next.length, actualLength: actual.length },
      submitted,
      url: location.href,
    };
  }

  function selectOption(params = {}) {
    const { element, error } = resolveTarget(params);
    if (error) return { ok: false, error };
    if (!(element instanceof HTMLSelectElement)) {
      return { ok: false, error: '目标不是原生 <select>，请用 click + 文字选择' };
    }

    const option = String(params.option ?? '');
    const match = Array.from(element.options).find(
      (candidate) => candidate.value === option || normalize(candidate.textContent) === normalize(option),
    );
    if (!match) {
      return {
        ok: false,
        error: `找不到选项“${option}”`,
        options: Array.from(element.options).slice(0, 20).map((candidate) => candidate.textContent.trim()),
      };
    }
    element.value = match.value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      ok: true,
      selected: normalize(match.textContent),
      value: match.value,
      verified: element.value === match.value,
      postcondition: { type: 'selectedValue', expected: match.value, actual: element.value },
    };
  }

  function pressKey(params = {}) {
    const raw = String(params.key || '');
    if (!raw) return { ok: false, error: '缺少 key' };
    const parts = raw.split('+').map((part) => part.trim()).filter(Boolean);
    const key = parts.length > 1 ? parts.at(-1) : raw;
    const prefixModifiers = parts.slice(0, -1).map((part) => part.toLowerCase());
    const modifiers = new Set(
      [...(Array.isArray(params.modifiers) ? params.modifiers : []), ...prefixModifiers].map((modifier) =>
        String(modifier).toLowerCase(),
      ),
    );
    let target = document.activeElement || document.body;
    if (params.ref || params.selector) {
      const resolved = resolveTarget(params);
      if (resolved.error) return { ok: false, error: resolved.error };
      target = resolved.element;
      target.focus({ preventScroll: true });
    }
    const repeat = Math.min(Math.max(Number(params.repeat) || 1, 1), 20);
    const init = {
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      bubbles: true,
      cancelable: true,
      composed: true,
      ctrlKey: modifiers.has('control'),
      shiftKey: modifiers.has('shift'),
      altKey: modifiers.has('alt'),
      metaKey: modifiers.has('meta'),
    };
    for (let index = 0; index < repeat; index += 1) {
      for (const type of ['keydown', 'keypress', 'keyup']) {
        target.dispatchEvent(new KeyboardEvent(type, init));
      }
    }
    return {
      ok: true,
      key,
      modifiers: [...modifiers],
      repeat,
      target: target.tagName.toLowerCase(),
      verified: false,
      uncertain: true,
      postcondition: { type: 'keyDispatched', matched: false },
    };
  }

  function scrollPage(params = {}) {
    const amount = Number(params.amount) || Math.round(innerHeight * 0.8);
    if (params.ref || params.selector) {
      const { element, error } = resolveTarget(params);
      if (error) return { ok: false, error };
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
    } else {
      const direction = params.direction || 'down';
      if (direction === 'top') scrollTo({ top: 0, behavior: 'instant' });
      else if (direction === 'bottom') scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
      else if (direction === 'up') scrollBy({ top: -amount, behavior: 'instant' });
      else scrollBy({ top: amount, behavior: 'instant' });
    }
    return {
      ok: true,
      scrollY: Math.round(scrollY),
      viewport: Math.round(innerHeight),
      pageHeight: Math.round(document.documentElement.scrollHeight),
      verified: true,
      postcondition: { type: 'scrollY', actual: Math.round(scrollY) },
    };
  }

  function openUrl(params = {}) {
    let url;
    try {
      url = new URL(String(params.url || ''), location.href);
    } catch {
      return { ok: false, error: 'URL 不合法' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, error: `只允许 http(s)，收到 ${url.protocol}` };
    }
    setTimeout(() => {
      location.href = url.href;
    }, 0);
    return { ok: true, navigatedTo: url.href, verified: true, postcondition: { type: 'navigation', url: url.href } };
  }

  function pointOf(params = {}) {
    if (Number.isFinite(Number(params.x)) && Number.isFinite(Number(params.y))) {
      return { ok: true, point: { x: Number(params.x), y: Number(params.y) } };
    }
    const { element, error } = resolveTarget(params);
    if (error) return { ok: false, error };
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    return {
      ok: true,
      point: {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      },
      meta: describeElement(element),
    };
  }

  function dispatchDragEvent(target, type, point, buttons) {
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: point.x,
      clientY: point.y,
      view: window,
    };
    try {
      if (type.startsWith('pointer')) {
        target.dispatchEvent(
          new PointerEvent(type, {
            ...base,
            button: 0,
            buttons,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
          }),
        );
        return;
      }
    } catch {
      /* fall back to mouse events */
    }
    target.dispatchEvent(new MouseEvent(type, { ...base, button: 0, buttons }));
  }

  function dragAction(params = {}) {
    const fromResult = pointOf(params.from || params);
    if (!fromResult.ok) return fromResult;
    const from = fromResult.point;

    let to;
    if (params.to) {
      const toResult = pointOf(params.to);
      if (!toResult.ok) return toResult;
      to = toResult.point;
    } else {
      const dx = Number(params.dx) || 0;
      const dy = Number(params.dy) || 0;
      if (!dx && !dy) return { ok: false, error: '需要 to，或 dx/dy 之一' };
      to = { x: from.x + dx, y: from.y + dy };
    }

    const steps = Math.min(Math.max(Number(params.steps) || 12, 2), 40);
    const startElement = document.elementFromPoint(from.x, from.y) || document.body;

    dispatchDragEvent(startElement, 'pointerdown', from, 1);
    dispatchDragEvent(startElement, 'mousedown', from, 1);

    for (let step = 1; step <= steps; step += 1) {
      const x = from.x + ((to.x - from.x) * step) / steps;
      const y = from.y + ((to.y - from.y) * step) / steps;
      const hovered = document.elementFromPoint(x, y) || document.documentElement;
      dispatchDragEvent(hovered, 'pointermove', { x, y }, 1);
      dispatchDragEvent(hovered, 'mousemove', { x, y }, 1);
    }

    const endElement = document.elementFromPoint(to.x, to.y) || document.documentElement;
    dispatchDragEvent(endElement, 'pointerup', to, 0);
    dispatchDragEvent(endElement, 'mouseup', to, 0);

    return { ok: true, from, to, steps, verified: false, uncertain: true, postcondition: { type: 'dragDispatched', matched: false } };
  }

  function setRange(params = {}) {
    const { element, error } = resolveTarget(params);
    if (error) return { ok: false, error };
    if (!(element instanceof HTMLInputElement) || element.type !== 'range') {
      return { ok: false, error: '目标不是 input[type=range]；自定义滑块请用 drag' };
    }
    const min = Number.isFinite(Number(element.min)) ? Number(element.min) : 0;
    const max = Number.isFinite(Number(element.max)) ? Number(element.max) : 100;
    const percent = params.percent != null ? Number(params.percent) : null;
    const rawValue = percent != null ? min + ((max - min) * percent) / 100 : Number(params.value);
    if (!Number.isFinite(rawValue)) return { ok: false, error: '需要 percent 或 value' };

    const value = Math.min(Math.max(rawValue, min), max);
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    element.focus({ preventScroll: true });
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(element, String(value));
    else element.value = String(value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    flash(element);

    return {
      ok: true,
      value: element.value,
      min,
      max,
      percent: max === min ? 0 : Math.round(((value - min) / (max - min)) * 100),
      verified: Number(element.value) === value,
      postcondition: { type: 'rangeValue', expected: value, actual: Number(element.value) },
    };
  }

  function pickMedia(params = {}) {
    if (params.ref || params.selector) {
      const { element, error } = resolveTarget(params);
      if (error) return { error };
      if (!(element instanceof HTMLMediaElement)) return { error: '目标不是 <video>/<audio>' };
      return { media: element };
    }
    const all = Array.from(document.querySelectorAll('video, audio')).filter(
      (element) => element.isConnected,
    );
    if (all.length === 0) return { error: '页面上没有找到 <video> 或 <audio>' };
    const playing = all.find((element) => !element.paused && element.readyState > 2);
    if (playing) return { media: playing };
    const visible = all
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
    return { media: visible[0]?.element || all[0] };
  }

  function mediaSnapshot(media) {
    let captions = '';
    try {
      for (const track of Array.from(media.textTracks || [])) {
        if (track.mode !== 'showing') continue;
        for (const cue of Array.from(track.activeCues || [])) {
          captions += `${cue.text}\n`;
        }
      }
    } catch {
      captions = '';
    }

    return {
      tag: media.tagName.toLowerCase(),
      currentTime: Math.round(media.currentTime * 10) / 10,
      duration: Number.isFinite(media.duration) ? Math.round(media.duration * 10) / 10 : null,
      paused: media.paused,
      ended: media.ended,
      muted: media.muted,
      volume: Math.round(media.volume * 100) / 100,
      playbackRate: media.playbackRate,
      readyState: media.readyState,
      captions: captions.trim().slice(0, 500) || undefined,
      title: document.title,
      src: String(media.currentSrc || media.src || '').slice(0, 300),
    };
  }

  async function tryPlay(media) {
    const wasMuted = media.muted;
    try {
      await media.play();
      return { ok: true };
    } catch (error) {
      if (error?.name !== 'NotAllowedError') {
        return { ok: false, error: String(error?.message || error) };
      }
      // Autoplay policy blocks audible playback without a page gesture. Start
      // muted (always allowed), then restore the previous mute state.
      media.muted = true;
      try {
        await media.play();
        media.muted = wasMuted;
        return { ok: true, mutedFallback: true };
      } catch (fallbackError) {
        media.muted = wasMuted;
        return {
          ok: false,
          error: '浏览器拦截了自动播放，请先在页面上手动点一次播放',
        };
      }
    }
  }

  async function controlMedia(params = {}) {
    const picked = pickMedia(params);
    if (picked.error) return { ok: false, error: picked.error };
    const media = picked.media;
    const action = String(params.action || 'status');
    let expected = null;

    if (action === 'play') {
      const outcome = await tryPlay(media);
      if (!outcome.ok) return { ok: false, error: outcome.error };
      expected = false;
    } else if (action === 'pause') {
      media.pause();
      expected = true;
    } else if (action === 'toggle') {
      if (media.paused) {
        const outcome = await tryPlay(media);
        if (!outcome.ok) return { ok: false, error: outcome.error };
        expected = false;
      } else {
        media.pause();
        expected = true;
      }
    } else if (action === 'seek' || action === 'seek_by') {
      if (!Number.isFinite(media.duration) || media.duration <= 0) {
        return { ok: false, error: '媒体还没加载出时长，先等它加载或点播放' };
      }
      let target;
      if (action === 'seek_by') {
        target = media.currentTime + Number(params.seconds || 0);
      } else if (params.percent != null) {
        target = (media.duration * Math.min(Math.max(Number(params.percent), 0), 100)) / 100;
      } else if (params.seconds != null) {
        target = Number(params.seconds);
      } else {
        return { ok: false, error: 'seek 需要 percent 或 seconds' };
      }
      media.currentTime = Math.min(Math.max(target, 0), media.duration);
      expected = media.currentTime;
    } else if (action === 'volume') {
      const value =
        params.volume != null
          ? Number(params.volume)
          : Number(params.percent != null ? Number(params.percent) / 100 : NaN);
      if (!Number.isFinite(value)) return { ok: false, error: 'volume 需要 volume(0-1) 或 percent' };
      media.volume = Math.min(Math.max(value, 0), 1);
      media.muted = media.volume === 0;
      expected = media.volume;
    } else if (action === 'mute') {
      media.muted = true;
      expected = true;
    } else if (action === 'unmute') {
      media.muted = false;
      expected = false;
    } else if (action === 'toggle_mute') {
      media.muted = !media.muted;
      expected = media.muted;
    } else if (action === 'rate') {
      const rate = Number(params.rate);
      if (!Number.isFinite(rate)) return { ok: false, error: 'rate 需要 0.25-4 之间的数字' };
      media.playbackRate = Math.min(Math.max(rate, 0.25), 4);
      expected = media.playbackRate;
    } else if (action !== 'status') {
      return { ok: false, error: `未知媒体操作：${action}` };
    }

    const snapshot = mediaSnapshot(media);
    let verified = true;
    if (action === 'play' || action === 'pause' || action === 'toggle') verified = media.paused === expected;
    else if (action === 'seek' || action === 'seek_by') verified = Math.abs(media.currentTime - expected) <= 1.5;
    else if (action === 'volume') verified = Math.abs(media.volume - expected) < 0.02;
    else if (action === 'mute' || action === 'unmute' || action === 'toggle_mute') verified = media.muted === expected;
    else if (action === 'rate') verified = Math.abs(media.playbackRate - expected) < 0.01;

    return {
      ok: true,
      action,
      media: snapshot,
      verified,
      postcondition: { type: `media:${action}`, matched: verified, expected },
    };
  }

  function hoverElement(params = {}) {
    const { element, error } = resolveTarget(params);
    if (error) return { ok: false, error };
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    for (const type of ['pointerover', 'mouseover', 'mousemove']) {
      try {
        if (type === 'pointerover') {
          element.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              composed: true,
              clientX: x,
              clientY: y,
              pointerId: 1,
              pointerType: 'mouse',
              isPrimary: true,
            }),
          );
        } else {
          element.dispatchEvent(
            new MouseEvent(type, { bubbles: true, composed: true, clientX: x, clientY: y }),
          );
        }
      } catch {
        /* ignore */
      }
    }
    flash(element);
    return {
      ok: true,
      hovered: labelOf(element) || element.tagName.toLowerCase(),
      point: { x: Math.round(x), y: Math.round(y) },
      verified: false,
      uncertain: true,
      postcondition: { type: 'hoverDispatched', matched: false },
    };
  }

  async function act(name, params = {}) {
    try {
      switch (name) {
        case 'inspect_page':
          return inspectPage(params);
        case 'click':
          return clickElement(params);
        case 'double_click':
          return doubleClickElement(params);
        case 'right_click':
          return rightClickElement(params);
        case 'focus':
          return focusElement(params);
        case 'clear':
          return clearElement(params);
        case 'check':
          return setChecked(params, true);
        case 'uncheck':
          return setChecked(params, false);
        case 'select_text':
          return selectText(params);
        case 'get_element_info':
          return getElementInfo(params);
        case 'scroll_inside':
          return scrollInside(params);
        case 'type_text':
          return typeIntoElement(params);
        case 'select_option':
          return selectOption(params);
        case 'press_key':
          return pressKey(params);
        case 'scroll_page':
          return scrollPage(params);
        case 'open_url':
          return openUrl(params);
        case 'read_page':
          return readPageAction();
        case 'point':
          return pointOf(params);
        case 'drag':
          return dragAction(params);
        case 'set_range':
          return setRange(params);
        case 'control_media':
          return controlMedia(params);
        case 'hover':
          return hoverElement(params);
        default:
          return { ok: false, error: `未知操作：${name}` };
      }
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }

  function readPageAction() {
    const page = window.__SC_EXTRACT__({ maxChars: 8000 });
    const media = Array.from(document.querySelectorAll('video, audio'))
      .slice(0, 4)
      .map(mediaSnapshot);
    return {
      ok: true,
      url: page.url,
      title: page.title,
      text: page.text,
      truncated: page.truncated,
      charCount: page.charCount,
      media: media.length > 0 ? media : undefined,
    };
  }

  window.__SC_ACT__ = act;
  window.__SC_ACTION_VERSION__ = VERSION;
})();
