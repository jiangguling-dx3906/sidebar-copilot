import { renderMarkdown } from './lib/markdown.js';
import { streamChat } from './lib/api.js';
import { loadSettings, saveSettings, loadConversation, saveConversation } from './lib/settings.js';
import { buildSystemPrompt, QUICK_PROMPTS } from './lib/prompts.js';
import { PAGE_TOOLS, describeAction, isRiskyAction, actionStatusLabel } from './lib/agentTools.js';
import { parseToolArguments } from './lib/toolcalls.js';

const $ = (id) => document.getElementById(id);

const els = {
  modelLabel: $('modelLabel'),
  pageFavicon: $('pageFavicon'),
  pageTitle: $('pageTitle'),
  pageSub: $('pageSub'),
  pagebar: $('pagebar'),
  attachToggle: $('attachToggle'),
  refreshPage: $('refreshPage'),
  keyBanner: $('keyBanner'),
  bannerSettings: $('bannerSettings'),
  scroll: $('scroll'),
  emptyState: $('emptyState'),
  emptyHint: $('emptyHint'),
  promptGrid: $('promptGrid'),
  messages: $('messages'),
  selectionChip: $('selectionChip'),
  selectionCount: $('selectionCount'),
  clearSelection: $('clearSelection'),
  input: $('input'),
  inputWrap: $('inputWrap'),
  send: $('send'),
  sendIcon: $('sendIcon'),
  status: $('status'),
  newChat: $('newChat'),
  openSettings: $('openSettings'),
  actionsToggle: $('actionsToggle'),
  toast: $('toast'),
};

const ICONS = {
  send: '<path d="M12 19V5M6 11l6-6 6 6" />',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />',
};

const state = {
  settings: null,
  messages: [],
  apiMessages: [],
  page: null,
  tab: null,
  tabId: null,
  selection: '',
  useSelection: false,
  busy: false,
  controller: null,
  runId: 0,
  pageLoading: false,
  stickToBottom: true,
  toastTimer: 0,
};

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

init().catch((error) => {
  setStatus(`初始化失败：${error?.message || error}`);
});

async function init() {
  bindEvents();
  renderPrompts();

  state.settings = await loadSettings();
  applySettings();

  state.messages = await loadConversation();
  rebuildApiHistory();
  renderAll();

  await readPage({ silent: true });
  await handlePendingAction();
}

function bindEvents() {
  els.send.addEventListener('click', () => {
    if (state.busy) stopStreaming();
    else send(els.input.value);
  });

  els.input.addEventListener('input', () => {
    resizeInput();
    updateSendState();
  });

  els.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!state.busy) send(els.input.value);
    }
    if (event.key === 'Escape' && state.busy) {
      event.preventDefault();
      stopStreaming();
    }
  });

  els.newChat.addEventListener('click', newChat);
  els.openSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
  els.bannerSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());

  els.actionsToggle.addEventListener('click', async () => {
    if (!isScriptableUrl(state.tab?.url || state.page?.url)) {
      toast('当前页面不允许扩展操作，切到普通网页再试');
      return;
    }
    state.settings.allowPageActions = !state.settings.allowPageActions;
    await saveSettings(state.settings);
    applyActionsToggle();
    toast(state.settings.allowPageActions ? '已允许 AI 操作页面' : '已关闭页面操作');
  });

  els.refreshPage.addEventListener('click', () => readPage({ silent: false }));

  els.attachToggle.addEventListener('change', async () => {
    state.settings.includePage = els.attachToggle.checked;
    await saveSettings(state.settings);
    setStatus();
  });

  els.clearSelection.addEventListener('click', () => {
    state.useSelection = false;
    updateSelectionChip();
  });

  els.scroll.addEventListener('scroll', () => {
    const distance = els.scroll.scrollHeight - els.scroll.scrollTop - els.scroll.clientHeight;
    state.stickToBottom = distance < 80;
  });

  els.messages.addEventListener('click', async (event) => {
    const confirmButton = event.target.closest('[data-confirm]');
    if (confirmButton) {
      const article = confirmButton.closest('.msg');
      const message = state.messages[Number(article?.dataset.index)];
      const action = message?.actions?.find((item) => item.id === confirmButton.dataset.actionId);
      action?.confirm?.resolve(confirmButton.dataset.confirm === 'yes');
      return;
    }

    const copy = event.target.closest('.code-copy');
    if (copy) {
      const block = copy.closest('.codeblock');
      const code = block?.querySelector('code')?.textContent || '';
      try {
        await navigator.clipboard.writeText(code);
        copy.textContent = '已复制';
        setTimeout(() => {
          copy.textContent = '复制';
        }, 1400);
      } catch {
        toast('复制失败，请手动选择');
      }
      return;
    }

    const retry = event.target.closest('[data-retry]');
    if (retry) {
      retryMessage(Number(retry.dataset.retry));
    }
  });

  chrome.tabs.onActivated.addListener(() => {
    if (!state.busy) readPage({ silent: true });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId === state.tabId && changeInfo.status === 'complete' && !state.busy) {
      readPage({ silent: true });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    state.settings = { ...state.settings, ...changes.settings.newValue };
    applySettings();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'sc:pending-action') handlePendingAction();
  });
}

function applySettings() {
  const settings = state.settings;
  els.modelLabel.textContent = settings.model || '未选择模型';
  els.attachToggle.checked = Boolean(settings.includePage);
  els.keyBanner.classList.toggle('hidden', hasCredentials(settings));
  applyActionsToggle();
  setStatus();
  updateSendState();
}

function isScriptableUrl(url) {
  return /^(https?|file):/i.test(String(url || ''));
}

function applyActionsToggle() {
  const enabled = Boolean(state.settings?.allowPageActions);
  const scriptable = isScriptableUrl(state.tab?.url || state.page?.url);
  els.actionsToggle.classList.toggle('active', enabled && scriptable);
  els.actionsToggle.classList.toggle('unavailable', enabled && !scriptable);
  els.actionsToggle.setAttribute('aria-pressed', String(enabled && scriptable));
  if (!scriptable) {
    els.actionsToggle.title =
      '当前页面不允许扩展操作（浏览器内部页、扩展商店、PDF 等）。切到普通网页后再试。';
  } else {
    els.actionsToggle.title = enabled
      ? 'AI 可以操作页面（点击/输入/拖拽/视频控制）。点击关闭。'
      : 'AI 只能阅读，不能操作页面。点击开启。';
  }
}

function hasCredentials(settings) {
  if (settings.apiKey) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)/i.test(settings.apiBase || '');
}

function setStatus(text) {
  if (text) {
    els.status.textContent = text;
    return;
  }
  const model = state.settings?.model || '未配置';
  if (state.page) {
    const parts = [`${formatNumber(state.page.charCount)} 字`, model];
    if (state.useSelection && state.selection) parts.push(`选中 ${formatNumber(state.selection.length)} 字`);
    els.status.textContent = parts.join(' · ');
  } else {
    els.status.textContent = state.pageLoading ? '正在读取页面…' : model;
  }
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

async function getActiveTab() {
  const params = new URLSearchParams(location.search);
  const pinned = Number(params.get('tabId'));
  if (Number.isFinite(pinned) && pinned > 0) {
    try {
      return await chrome.tabs.get(pinned);
    } catch {
      /* fall back to the active tab */
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) return tab;
  const [anyTab] = await chrome.tabs.query({ active: true });
  return anyTab || null;
}

async function readPage({ silent = false } = {}) {
  if (state.pageLoading) return;
  state.pageLoading = true;
  setStatus('正在读取页面…');

  try {
    const tab = await getActiveTab();
    state.tab = tab;
    state.tabId = tab?.id ?? null;

    if (!tab?.id || !/^(https?|file):/i.test(tab.url || '')) {
      state.page = null;
      state.selection = '';
      state.useSelection = false;
      renderPageBar({
        title: tab?.title || '这个页面读不到',
        sub: '浏览器内部页面、扩展商店等不允许扩展读取',
        favicon: tab?.favIconUrl,
      });
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (window.__SC_EXTRACT__ ? window.__SC_EXTRACT__() : null),
    });

    const page = injection?.result;
    if (!page) throw new Error('页面没有返回可读内容');

    const pageChanged = state.page?.url !== page.url;
    state.page = page;
    if (page.selection) {
      state.selection = page.selection;
      state.useSelection = pageChanged || !state.useSelection;
    } else if (pageChanged) {
      state.selection = '';
      state.useSelection = false;
    }

    renderPageBar({
      title: page.title || tab.title || '未命名页面',
      sub: [
        page.site || hostOf(page.url),
        `${formatNumber(page.charCount)} 字`,
        page.truncated ? '已截断' : '',
        page.links?.length ? `${page.links.length} 个链接` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      favicon: tab.favIconUrl,
    });
  } catch (error) {
    state.page = null;
    renderPageBar({
      title: '无法读取此页面',
      sub: explainInjectionError(error),
      favicon: state.tab?.favIconUrl,
    });
    if (!silent) toast('这个页面无法读取');
  } finally {
    state.pageLoading = false;
    updateSelectionChip();
    updateEmptyHint();
    applyActionsToggle();
    setStatus();
    updateSendState();
  }
}

function explainInjectionError(error) {
  const message = String(error?.message || error);
  if (/Cannot access contents of url|The extensions gallery cannot be scripted|Missing host permission/i.test(message)) {
    return '受浏览器保护的页面（设置、商店、PDF 等）无法注入脚本';
  }
  if (/No tab with id/i.test(message)) return '标签页已关闭，请切换页面后重试';
  return message.slice(0, 120);
}

function renderPageBar({ title, sub, favicon }) {
  els.pageTitle.textContent = title;
  els.pageSub.textContent = sub;
  els.pageFavicon.src = favicon || 'icons/icon32.png';
  els.pageFavicon.onerror = () => {
    els.pageFavicon.src = 'icons/icon32.png';
  };
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function updateSelectionChip() {
  const active = Boolean(state.selection && state.useSelection);
  els.selectionChip.classList.toggle('hidden', !active);
  if (active) els.selectionCount.textContent = String(state.selection.length);
  renderPrompts();
}

function updateEmptyHint() {
  if (state.page) {
    els.emptyHint.textContent = `已读取「${state.page.title || hostOf(state.page.url)}」，共 ${formatNumber(
      state.page.charCount,
    )} 字。`;
  } else if (!isScriptableUrl(state.tab?.url)) {
    els.emptyHint.textContent =
      '这是浏览器内部页面，扩展无法读取或操作。打开一个普通网页（http/https）再试。';
  } else {
    els.emptyHint.textContent = '当前页面读不到正文，但你仍然可以提问或让我检查页面。';
  }
}

/* ------------------------------------------------------------------ */
/* prompts                                                             */
/* ------------------------------------------------------------------ */

function renderPrompts() {
  els.promptGrid.textContent = '';
  for (const prompt of QUICK_PROMPTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'prompt-card';
    button.dataset.prompt = prompt.id;

    const label = document.createElement('span');
    label.textContent = prompt.label;
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '↗';

    button.append(label, arrow);
    button.disabled = Boolean(prompt.needsSelection && !state.selection);
    button.title = prompt.needsSelection && !state.selection ? '先在页面上选中一段文字' : prompt.label;
    button.addEventListener('click', () => runPrompt(prompt));

    els.promptGrid.appendChild(button);
  }
}

function runPrompt(prompt) {
  if (prompt.needsSelection && !state.selection) {
    toast('先在页面上选中一段文字');
    return;
  }
  if (prompt.needsSelection) {
    state.useSelection = true;
    updateSelectionChip();
  }
  send(prompt.prompt);
}

/* ------------------------------------------------------------------ */
/* chat                                                                */
/* ------------------------------------------------------------------ */

async function send(rawText) {
  const text = String(rawText || '').trim();
  if (!text || state.busy) return;

  if (!hasCredentials(state.settings)) {
    els.keyBanner.classList.remove('hidden');
    toast('先配置 API Key');
    return;
  }

  if (state.settings.includePage) {
    const tab = await getActiveTab().catch(() => null);
    if (!state.page || (tab?.id != null && tab.id !== state.tabId)) {
      await readPage({ silent: true });
    }
  }

  els.input.value = '';
  resizeInput();
  updateSendState();

  state.messages.push({ role: 'user', content: text, ts: Date.now() });
  state.apiMessages.push({ role: 'user', content: text });
  appendMessage(state.messages[state.messages.length - 1], state.messages.length - 1);
  updateEmptyState();
  persist();

  await runAgent();
}

async function runAgent() {
  const maxRounds = Math.max(1, Math.min(10, Number(state.settings.maxAgentSteps) || 6));
  const allowTools =
    Boolean(state.settings.allowPageActions) &&
    isScriptableUrl(state.tab?.url || state.page?.url) &&
    state.tabId != null;

  const controller = new AbortController();
  state.controller = controller;
  const runId = (state.runId += 1);
  setBusy(true);

  let lastAssistant = null;
  let exhausted = false;

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      if (runId !== state.runId) break;
      const assistant = { role: 'assistant', content: '', actions: [], streaming: true, ts: Date.now() };
      state.messages.push(assistant);
      lastAssistant = assistant;
      const index = state.messages.length - 1;
      appendMessage(assistant, index);
      scrollToBottom(true);

      const system = buildSystemPrompt({
        page: state.page,
        attached: Boolean(state.settings.includePage),
        selection: state.settings.includePage && state.useSelection ? state.selection : '',
        maxChars: state.settings.maxPageChars,
        extra: state.settings.systemExtra,
        allowActions: allowTools,
        maxSteps: maxRounds,
      });

      const result = await streamChat({
        settings: state.settings,
        messages: [{ role: 'system', content: system }, ...buildHistory()],
        tools: allowTools ? PAGE_TOOLS : undefined,
        signal: controller.signal,
        onDelta: (delta) => {
          assistant.content += delta;
          scheduleStreamUpdate(assistant, index);
        },
      });

      assistant.content = result.content || assistant.content;
      assistant.streaming = false;

      if (runId !== state.runId) return;

      if (!allowTools || !result.toolCalls || result.toolCalls.length === 0) {
        if (!assistant.content.trim()) assistant.content = '（模型返回了空内容，可以点重试。）';
        updateMessage(assistant, index);
        break;
      }

      state.apiMessages.push({
        role: 'assistant',
        content: result.content || '',
        tool_calls: result.toolCalls,
      });

      assistant.actions = result.toolCalls.map((call) => ({
        id: call.id,
        name: call.function?.name || 'unknown',
        args: parseToolArguments(call.function?.arguments),
        raw: call.function?.arguments,
        status: 'pending',
        result: null,
        error: '',
      }));
      updateMessage(assistant, index);

      for (const action of assistant.actions) {
        if (runId !== state.runId) return;
        if (controller.signal.aborted) {
          action.status = 'skipped';
          action.error = '已停止';
          pushToolResult(action);
          continue;
        }

        if (action.args == null) {
          action.status = 'error';
          action.error = '工具参数不是合法 JSON';
          updateMessage(assistant, index);
          pushToolResult(action);
          continue;
        }

        const approved = await confirmIfNeeded(action, assistant);
        if (runId !== state.runId) return;
        if (!approved) {
          action.status = 'skipped';
          action.error = '用户跳过了这个操作';
          updateMessage(assistant, index);
          pushToolResult(action);
          continue;
        }

        action.status = 'running';
        els.status.textContent = '正在操作页面…';
        updateMessage(assistant, index);
        try {
          action.result = await executeTool(action);
          action.status = 'ok';
        } catch (error) {
          action.status = 'error';
          action.error = error?.message || String(error);
        }
        updateMessage(assistant, index);
        pushToolResult(action);
      }

      if (controller.signal.aborted) {
        assistant.stopped = true;
        assistant.streaming = false;
        if (!assistant.content.trim()) assistant.content = '（已停止）';
        updateMessage(assistant, index);
        break;
      }
      if (round === maxRounds - 1) exhausted = true;
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (lastAssistant) {
        lastAssistant.stopped = true;
        if (!lastAssistant.content.trim() && !lastAssistant.actions?.length) {
          lastAssistant.content = '（已停止）';
        }
      }
    } else if (lastAssistant) {
      lastAssistant.error = error?.message || '请求失败，请稍后重试。';
    }
  } finally {
    if (runId === state.runId) {
      if (lastAssistant) {
        lastAssistant.streaming = false;
        if (exhausted && !lastAssistant.content.trim() && lastAssistant.actions?.length) {
          lastAssistant.content = `（已达到最大操作轮数 ${maxRounds}，先停在这里。需要继续的话再发一条消息。）`;
        }
        updateMessage(lastAssistant, state.messages.indexOf(lastAssistant));
      }
      state.controller = null;
      setBusy(false);
      setStatus();
      persist();
      scrollToBottom(state.stickToBottom);
    }
  }
}

function pushToolResult(action) {
  state.apiMessages.push({
    role: 'tool',
    tool_call_id: action.id,
    content: JSON.stringify(
      action.status === 'ok' ? action.result : { ok: false, error: action.error || action.status },
    ),
  });
}

function buildHistory() {
  const turns = Math.max(1, Math.min(10, Math.floor((Number(state.settings.historyLimit) || 12) / 2)));
  let seen = 0;
  let start = 0;
  for (let i = state.apiMessages.length - 1; i >= 0; i -= 1) {
    if (state.apiMessages[i].role === 'user') {
      seen += 1;
      if (seen === turns) {
        start = i;
        break;
      }
    }
  }
  return state.apiMessages.slice(start);
}

function rebuildApiHistory() {
  state.apiMessages = state.messages
    .filter(
      (message) =>
        message.role === 'user' ||
        (message.role === 'assistant' && message.content && message.content.trim()),
    )
    .map((message) => ({ role: message.role, content: message.content }));
}

function confirmIfNeeded(action, assistant) {
  const risky = isRiskyAction(action.name, action.args || {});
  if (!risky && !state.settings.confirmActions) return Promise.resolve(true);

  return new Promise((resolve) => {
    action.confirm = {
      risky,
      resolve: (value) => {
        action.confirm = null;
        resolve(value);
      },
    };
    updateMessage(assistant, state.messages.indexOf(assistant));
    scrollToBottom(state.stickToBottom);
  });
}

async function executeTool(action) {
  if (state.tabId == null) throw new Error('没有可操作的标签页');
  const tab = await getActiveTab().catch(() => null);
  if (tab?.id != null && tab.id !== state.tabId) {
    throw new Error('当前标签页已切换，已停止页面操作');
  }

  if (action.name === 'wait_for') {
    const result = await waitFor(action.args || {});
    if (!result.ok) throw new Error(result.error || '等待超时');
    return result;
  }

  if (action.name === 'read_page') {
    const result = await injectAction('read_page', {});
    if (!result?.ok) throw new Error(result?.error || '读取页面失败');
    return result;
  }

  const result = await injectAction(
    action.name,
    action.args || {},
    action.name === 'control_media' ? { allFrames: true } : {},
  );
  if (!result) throw new Error('页面没有返回结果');
  if (result.ok === false) throw new Error(result.error || '操作失败');

  if (action.name === 'open_url') {
    await sleep(1800);
    await readPage({ silent: true });
  } else if (action.name === 'click') {
    await sleep(350);
    const after = await getActiveTab().catch(() => null);
    if (after?.url && state.page?.url && after.url !== state.page.url) {
      await sleep(700);
      await readPage({ silent: true });
    }
  }

  return result;
}

async function injectAction(name, args, options = {}) {
  const allFrames = Boolean(options.allFrames);
  const target = allFrames ? { tabId: state.tabId, allFrames: true } : { tabId: state.tabId };

  const run = async () => {
    const injections = await chrome.scripting.executeScript({
      target,
      func: (actionName, actionArgs) =>
        window.__SC_ACT__
          ? window.__SC_ACT__(actionName, actionArgs)
          : { ok: false, error: '页面脚本未就绪，请刷新页面' },
      args: [name, args],
    });
    const values = injections.map((injection) => injection?.result).filter(Boolean);
    if (!allFrames) return values[0] ?? null;
    return values.find((value) => value.ok) || values[0] || null;
  };

  let result;
  try {
    result = await run();
  } catch (error) {
    // The frame may be mid-navigation; give it a moment and retry once.
    await sleep(500);
    result = await run();
  }

  if (!result || (result.ok === false && /页面脚本未就绪/.test(result.error || ''))) {
    await chrome.scripting.executeScript({ target, files: ['content.js'] });
    result = await run();
  }

  return result;
}

async function waitFor(args) {
  const timeout = Math.min(Math.max(Number(args.timeout_ms) || 5000, 500), 15000);
  const query = String(args.selector || args.text || '');
  const started = Date.now();

  while (Date.now() - started < timeout) {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: state.tabId },
      func: (needle, text) => {
        if (text && document.body.innerText.includes(text)) return { count: 1, byText: true };
        if (!window.__SC_ACT__) return { count: 0 };
        return window.__SC_ACT__('inspect_page', { query: needle, limit: 5 });
      },
      args: [query, String(args.text || '')],
    });
    const result = injection?.result;
    if (result?.count > 0) {
      return { ok: true, waited_ms: Date.now() - started, elements: result.elements || undefined };
    }
    await sleep(300);
  }
  return { ok: false, error: `等待超时（${timeout}ms）：${query || args.text}` };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopStreaming() {
  state.controller?.abort();
  for (const message of state.messages) {
    for (const action of message.actions || []) {
      action.confirm?.resolve(false);
    }
  }
}

function retryMessage(index) {
  if (state.busy) return;
  const message = state.messages[index];
  if (!message || message.role !== 'assistant') return;

  let userIndex = -1;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (state.messages[i].role === 'user') {
      userIndex = i;
      break;
    }
  }
  if (userIndex === -1) return;

  state.messages = state.messages.slice(0, userIndex + 1);
  rebuildApiHistory();
  renderAll();
  runAgent();
}

function newChat() {
  if (state.busy) stopStreaming();
  state.runId += 1;
  state.controller = null;
  setBusy(false);
  state.messages = [];
  state.apiMessages = [];
  state.useSelection = false;
  updateSelectionChip();
  setStatus();
  renderAll();
  persist();
  updateEmptyState();
  els.input.focus();
  toast('已开始新对话');
}

/* ------------------------------------------------------------------ */
/* rendering                                                           */
/* ------------------------------------------------------------------ */

function renderAll() {
  els.messages.textContent = '';
  state.messages.forEach((message, index) => appendMessage(message, index));
  updateEmptyState();
}

function updateEmptyState() {
  const empty = state.messages.length === 0;
  els.emptyState.classList.toggle('hidden', !empty);
  updateEmptyHint();
}

function appendMessage(message, index) {
  const node = buildMessage(message, index);
  els.messages.appendChild(node);
}

function updateMessage(message, index) {
  const current = els.messages.querySelector(`.msg[data-index="${index}"]`);
  if (!current) return;
  const next = buildMessage(message, index);
  current.replaceWith(next);
}

function buildMessage(message, index) {
  const article = document.createElement('article');
  article.className = `msg ${message.role}`;
  article.dataset.index = String(index);

  if (message.role === 'assistant') {
    if (index > 0 && state.messages[index - 1]?.role === 'assistant') {
      article.classList.add('continued');
    }

    const avatar = document.createElement('img');
    avatar.className = 'avatar';
    avatar.src = 'icons/icon48.png';
    avatar.alt = '';

    const body = document.createElement('div');
    body.className = 'body';

    const md = document.createElement('div');
    md.className = 'md';
    md.innerHTML = renderMarkdown(message.content || '');
    body.appendChild(md);

    if (message.actions?.length) {
      const list = document.createElement('div');
      list.className = 'action-list';
      for (const action of message.actions) list.appendChild(buildActionCard(action));
      body.appendChild(list);
    }

    if (message.streaming) {
      const caret = document.createElement('span');
      caret.className = 'caret';
      body.appendChild(caret);
    }

    if (message.error) {
      body.appendChild(buildError(message.error, index));
    }

    article.append(avatar, body);
    return article;
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = message.content;
  article.appendChild(bubble);
  return article;
}

function buildError(text, index) {
  const box = document.createElement('div');
  box.className = 'error-box';
  box.textContent = text;

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = '重试';
  retry.dataset.retry = String(index);
  box.appendChild(document.createElement('br'));
  box.appendChild(retry);
  return box;
}

const ACTION_ICONS = {
  pending: '…',
  running: '◌',
  ok: '✓',
  error: '!',
  skipped: '–',
};

function buildActionCard(action) {
  const card = document.createElement('div');
  card.className = `action-card ${action.status || 'pending'}`;
  card.dataset.actionId = action.id;

  const head = document.createElement('div');
  head.className = 'action-head';

  const icon = document.createElement('span');
  icon.className = 'action-icon';
  icon.textContent = ACTION_ICONS[action.status] || '•';

  const label = document.createElement('span');
  label.className = 'action-label';
  label.textContent = describeAction(action.name, action.args || {});

  const status = document.createElement('span');
  status.className = 'action-status';
  status.textContent = actionStatusLabel(action.status);

  head.append(icon, label, status);
  card.appendChild(head);

  if (action.error) {
    const error = document.createElement('div');
    error.className = 'action-error';
    error.textContent = action.error;
    card.appendChild(error);
  }

  if (action.confirm) {
    const row = document.createElement('div');
    row.className = 'action-confirm';
    const hint = document.createElement('span');
    hint.textContent = action.confirm.risky ? '这一步可能不可逆，确认执行？' : '允许这次操作？';

    const allow = document.createElement('button');
    allow.type = 'button';
    allow.className = 'allow';
    allow.dataset.confirm = 'yes';
    allow.dataset.actionId = action.id;
    allow.textContent = '允许';

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'skip';
    skip.dataset.confirm = 'no';
    skip.dataset.actionId = action.id;
    skip.textContent = '跳过';

    row.append(hint, allow, skip);
    card.appendChild(row);
  }

  if (action.status === 'ok' && action.result) {
    const details = document.createElement('details');
    details.className = 'action-result';
    const summary = document.createElement('summary');
    summary.textContent = '查看结果';
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(action.result, null, 2).slice(0, 2400);
    details.append(summary, pre);
    card.appendChild(details);
  }

  return card;
}

let streamFrame = 0;

function scheduleStreamUpdate(message, index) {
  if (streamFrame) return;
  streamFrame = requestAnimationFrame(() => {
    streamFrame = 0;
    const md = els.messages.querySelector(`.msg[data-index="${index}"] .md`);
    if (!md) return;
    md.innerHTML = renderMarkdown(message.content);
    if (state.stickToBottom) scrollToBottom(true);
  });
}

function scrollToBottom(force) {
  if (!force) return;
  els.scroll.scrollTop = els.scroll.scrollHeight;
}

function setBusy(busy) {
  state.busy = busy;
  els.send.classList.toggle('stop', busy);
  els.sendIcon.innerHTML = busy ? ICONS.stop : ICONS.send;
  els.send.title = busy ? '停止' : '发送';
  els.send.setAttribute('aria-label', busy ? '停止' : '发送');
  updateSendState();
}

function updateSendState() {
  if (state.busy) {
    els.send.disabled = false;
    return;
  }
  els.send.disabled = els.input.value.trim().length === 0;
}

function resizeInput() {
  const input = els.input;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
}

function persist() {
  saveConversation(state.messages.filter((message) => !message.streaming));
}

function formatNumber(value) {
  const number = Number(value) || 0;
  if (number >= 10000) return `${(number / 10000).toFixed(1)} 万`;
  return number.toLocaleString('zh-CN');
}

function toast(text) {
  els.toast.textContent = text;
  els.toast.classList.remove('hidden');
  requestAnimationFrame(() => els.toast.classList.add('show'));
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
    setTimeout(() => els.toast.classList.add('hidden'), 220);
  }, 1800);
}

/* ------------------------------------------------------------------ */
/* context menu actions                                                */
/* ------------------------------------------------------------------ */

async function handlePendingAction() {
  try {
    const stored = await chrome.storage.session.get('pendingAction');
    const pending = stored?.pendingAction;
    if (!pending || Date.now() - Number(pending.at) > 60000) return;
    await chrome.storage.session.remove('pendingAction');

    if (state.settings.includePage && !state.page) {
      await readPage({ silent: true });
    }

    if (pending.action === 'explain-selection') {
      if (pending.selection) {
        state.selection = pending.selection;
        state.useSelection = true;
        updateSelectionChip();
      }
      const prompt = QUICK_PROMPTS.find((item) => item.id === 'explain-selection');
      runPrompt(prompt);
      return;
    }

    const prompt = QUICK_PROMPTS.find((item) => item.id === 'summary');
    runPrompt(prompt);
  } catch {
    /* no pending action */
  }
}
