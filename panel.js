import { renderMarkdown } from './lib/markdown.js';
import { streamChat } from './lib/api.js';
import { loadSettings, saveSettings } from './lib/settings.js';
import { loadSessions, saveSessions, newSession, sessionTitle, slimMessages, slimSessions } from './lib/sessions.js';
import { buildSystemPrompt, getQuickPrompts } from './lib/prompts.js';
import { PAGE_TOOLS, describeAction, isRiskyAction, actionStatusLabel } from './lib/agentTools.js';
import { parseToolArguments } from './lib/toolcalls.js';
import { setLocale, applyI18n, t, getLocale } from './lib/i18n.js';
import { applyPanelTheme } from './lib/theme.js';

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
  selectionText: $('selectionText'),
  clearSelection: $('clearSelection'),
  input: $('input'),
  inputWrap: $('inputWrap'),
  mic: $('mic'),
  send: $('send'),
  sendIcon: $('sendIcon'),
  status: $('status'),
  newChat: $('newChat'),
  historyBtn: $('historyBtn'),
  historyDrawer: $('historyDrawer'),
  closeHistory: $('closeHistory'),
  historyList: $('historyList'),
  historyCount: $('historyCount'),
  saveHistoryToggle: $('saveHistoryToggle'),
  exportAll: $('exportAll'),
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
  voice: null,
  voiceBase: '',
  sessions: [],
  activeSessionId: null,
  historyOpen: false,
};

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

init().catch((error) => {
  setStatus(t('panel.statusInitFailed', { message: error?.message || error }));
});

async function init() {
  bindEvents();

  state.settings = await loadSettings();
  setLocale(state.settings.locale);
  applyI18n();
  renderPrompts();
  applySettings();

  const history = await loadSessions();
  state.sessions = history.sessions;
  state.activeSessionId = history.activeSessionId;
  const active = state.sessions.find((session) => session.id === state.activeSessionId);
  state.messages = active?.messages || [];
  els.saveHistoryToggle.checked = state.settings.saveHistory !== false;
  rebuildApiHistory();
  renderAll();
  renderHistory();

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
  els.historyBtn.addEventListener('click', openHistory);
  els.closeHistory.addEventListener('click', closeHistory);
  els.exportAll.addEventListener('click', () => {
    if (state.sessions.length === 0) {
      toast(t('history.empty'));
      return;
    }
    exportSessions(state.sessions, 'all');
  });
  els.historyList.addEventListener('click', (event) => {
    const load = event.target.closest('[data-load]');
    if (load) {
      switchSession(load.dataset.load);
      return;
    }
    const exportButton = event.target.closest('[data-export]');
    if (exportButton) {
      const session = state.sessions.find((item) => item.id === exportButton.dataset.export);
      if (session) exportSessions([session], session.title || 'conversation');
      return;
    }
    const deleteButton = event.target.closest('[data-delete]');
    if (deleteButton) deleteSession(deleteButton.dataset.delete);
  });
  els.saveHistoryToggle.addEventListener('change', async () => {
    state.settings.saveHistory = els.saveHistoryToggle.checked;
    await saveSettings(state.settings);
    if (state.settings.saveHistory) {
      persist();
    } else {
      toast(t('history.disabled'));
    }
  });
  els.openSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
  els.bannerSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());

  els.actionsToggle.addEventListener('click', async () => {
    if (!isScriptableUrl(state.tab?.url || state.page?.url)) {
      toast(t('panel.toastActionsUnavailable'));
      return;
    }
    state.settings.allowPageActions = !state.settings.allowPageActions;
    await saveSettings(state.settings);
    applyActionsToggle();
    toast(state.settings.allowPageActions ? t('panel.toastActionsOn') : t('panel.toastActionsOff'));
  });

  els.refreshPage.addEventListener('click', () => readPage({ silent: false }));
  els.mic.addEventListener('click', toggleVoice);

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
        copy.textContent = t('common.copied');
        setTimeout(() => {
          copy.textContent = t('common.copy');
        }, 1400);
      } catch {
        toast(t('panel.toastCopyFail'));
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
    const next = changes.settings.newValue || {};
    const localeChanged = next.locale !== state.settings.locale;
    state.settings = { ...state.settings, ...next };
    if (localeChanged) {
      setLocale(state.settings.locale);
      applyI18n();
      renderPrompts();
      renderAll();
      if (state.tabId != null && !state.busy) readPage({ silent: true }).catch(() => {});
    }
    applySettings();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'sc:pending-action') handlePendingAction();
  });
}

function applySettings() {
  const settings = state.settings;
  applyPanelTheme(settings.panelBg);
  els.modelLabel.textContent = settings.model || t('panel.noModel');
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
  els.actionsToggle.title = !scriptable
    ? t('panel.actionsUnavailable')
    : enabled
      ? t('panel.actionsOn')
      : t('panel.actionsOff');
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
  const model = state.settings?.model || t('panel.noModel');
  if (state.page) {
    const parts = [t('panel.statusChars', { count: formatNumber(state.page.charCount) }), model];
    if (state.useSelection && state.selection) {
      parts.push(t('panel.statusSelection', { count: formatNumber(state.selection.length) }));
    }
    els.status.textContent = parts.join(' · ');
  } else {
    els.status.textContent = state.pageLoading ? t('panel.statusReading') : model;
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
  setStatus(t('panel.statusReading'));

  try {
    const tab = await getActiveTab();
    state.tab = tab;
    state.tabId = tab?.id ?? null;

    if (!tab?.id || !/^(https?|file):/i.test(tab.url || '')) {
      state.page = null;
      state.selection = '';
      state.useSelection = false;
      renderPageBar({
        title: tab?.title || t('panel.pageUnsupportedTitle'),
        sub: t('panel.pageUnsupportedSub'),
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
    if (!page) throw new Error(t('panel.pageNoContent'));

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
      title: page.title || tab.title || t('panel.untitled'),
      sub: [
        page.site || hostOf(page.url),
        t('panel.statusChars', { count: formatNumber(page.charCount) }),
        page.truncated ? t('panel.truncated') : '',
        page.links?.length ? t('panel.links', { count: page.links.length }) : '',
      ]
        .filter(Boolean)
        .join(' · '),
      favicon: tab.favIconUrl,
    });
  } catch (error) {
    state.page = null;
    renderPageBar({
      title: t('panel.pageUnreadableTitle'),
      sub: explainInjectionError(error),
      favicon: state.tab?.favIconUrl,
    });
    if (!silent) toast(t('panel.toastCannotRead'));
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
    return t('panel.protectedPage');
  }
  if (/No tab with id/i.test(message)) return t('panel.tabClosed');
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
  if (active) {
    els.selectionChip.dataset.count = String(state.selection.length);
    els.selectionText.textContent = t('panel.selectionChip', { count: state.selection.length });
  } else {
    els.selectionChip.dataset.count = '0';
  }
  renderPrompts();
}

function updateEmptyHint() {
  if (state.page) {
    els.emptyHint.textContent = t('panel.emptyHintRead', {
      title: state.page.title || hostOf(state.page.url),
      count: formatNumber(state.page.charCount),
    });
  } else if (!isScriptableUrl(state.tab?.url)) {
    els.emptyHint.textContent = t('panel.emptyHintInternal');
  } else {
    els.emptyHint.textContent = t('panel.emptyHintUnreadable');
  }
}

/* ------------------------------------------------------------------ */
/* prompts                                                             */
/* ------------------------------------------------------------------ */

function renderPrompts() {
  els.promptGrid.textContent = '';
  for (const prompt of getQuickPrompts()) {
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
    button.title = prompt.needsSelection && !state.selection ? t('panel.selectFirst') : prompt.label;
    button.addEventListener('click', () => runPrompt(prompt));

    els.promptGrid.appendChild(button);
  }
}

function runPrompt(prompt) {
  if (prompt.needsSelection && !state.selection) {
    toast(t('panel.toastNoSelection'));
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
    toast(t('panel.toastNeedKey'));
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
        if (!assistant.content.trim()) assistant.content = t('panel.emptyResponse');
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
          action.error = t('panel.stopped');
          pushToolResult(action);
          continue;
        }

        if (action.args == null) {
          action.status = 'error';
          action.error = t('panel.invalidArgs');
          updateMessage(assistant, index);
          pushToolResult(action);
          continue;
        }

        const approved = await confirmIfNeeded(action, assistant);
        if (runId !== state.runId) return;
        if (!approved) {
          action.status = 'skipped';
          action.error = t('panel.skippedByUser');
          updateMessage(assistant, index);
          pushToolResult(action);
          continue;
        }

        action.status = 'running';
        els.status.textContent = t('panel.statusOperating');
        updateMessage(assistant, index);
        try {
          action.result = await executeTool(action);
          action.status = 'ok';
        } catch (error) {
          action.status = 'error';
          action.error = localizeActionError(error?.message || String(error));
        }
        updateMessage(assistant, index);
        pushToolResult(action);
      }

      if (controller.signal.aborted) {
        assistant.stopped = true;
        assistant.streaming = false;
        if (!assistant.content.trim()) assistant.content = t('panel.stopped');
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
          lastAssistant.content = t('panel.stopped');
        }
      }
    } else if (lastAssistant) {
      lastAssistant.error = error?.message || t('panel.requestFailed');
    }
  } finally {
    if (runId === state.runId) {
      if (lastAssistant) {
        lastAssistant.streaming = false;
        if (exhausted && !lastAssistant.content.trim() && lastAssistant.actions?.length) {
          lastAssistant.content = t('panel.maxRounds', { n: maxRounds });
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
  if (state.tabId == null) throw new Error(t('panel.noTab'));
  const tab = await getActiveTab().catch(() => null);
  if (tab?.id != null && tab.id !== state.tabId) {
    throw new Error(t('panel.tabChanged'));
  }

  if (action.name === 'wait_for') {
    const result = await waitFor(action.args || {});
    if (!result.ok) throw new Error(result.error || t('panel.waitTimeoutShort'));
    return result;
  }

  if (action.name === 'read_page') {
    const result = await injectAction('read_page', {});
    if (!result?.ok) throw new Error(result?.error || t('panel.readFailed'));
    return result;
  }

  const result = await injectAction(
    action.name,
    action.args || {},
    action.name === 'control_media' ? { allFrames: true } : {},
  );
  if (!result) throw new Error(t('panel.noResult'));
  if (result.ok === false) throw new Error(result.error || t('panel.actionFailed'));

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
      func: (actionName, actionArgs, fallback) =>
        window.__SC_ACT__
          ? window.__SC_ACT__(actionName, actionArgs)
          : { ok: false, code: 'SCRIPT_NOT_READY', error: fallback },
      args: [name, args, t('panel.scriptNotReady')],
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

  if (!result || result.code === 'SCRIPT_NOT_READY') {
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
  return { ok: false, error: t('panel.waitTimeout', { ms: timeout, query: query || args.text }) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function localizeActionError(message) {
  if (getLocale() !== 'en') return message;
  const rules = [
    [/^ref "(.+)" 已失效.*$/, 'ref "$1" is stale; run inspect_page again'],
    [/^找不到元素：(.+)$/, 'Element not found: $1'],
    [/^元素存在但不可见$/, 'Element exists but is not visible'],
    [/^页面上找不到包含 “(.+)” 的可点击元素$/, 'No clickable element contains “$1”'],
    [/^需要 ref、selector 或 text 之一$/, 'Provide ref, selector, or text'],
    [/^“(.+)”处于禁用状态$/, '“$1” is disabled'],
    [/^拒绝填写密码字段.*$/, 'Refusing to fill a password field; ask the user to type it'],
    [/^不支持填写 type=(.+) 的输入框$/, 'Unsupported input type=$1'],
    [/^目标不是可输入的输入框$/, 'Target is not an editable field'],
    [/^目标不是原生 <select>.*$/, 'Target is not a native <select>; use click + option'],
    [/^找不到选项“(.+)”$/, 'Option not found: “$1”'],
    [/^目标不是 input\[type=range\].*$/, 'Target is not input[type=range]; use drag'],
    [/^需要 percent 或 value$/, 'Provide percent or value'],
    [/^页面上没有找到 <video> 或 <audio>$/, 'No <video> or <audio> found on the page'],
    [/^媒体还没加载出时长.*$/, 'Media duration is not available yet; wait for it to load or press play'],
    [/^seek 需要 percent 或 seconds$/, 'seek needs percent or seconds'],
    [/^volume 需要.*$/, 'volume needs volume (0-1) or percent'],
    [/^rate 需要.*$/, 'rate needs a number between 0.25 and 4'],
    [/^未知媒体操作：(.+)$/, 'Unknown media action: $1'],
    [/^需要 to，或 dx\/dy 之一$/, 'Provide to, or dx/dy'],
    [/^URL 不合法$/, 'Invalid URL'],
    [/^只允许 http\(s\)，收到 (.+)$/, 'Only http(s) URLs are allowed; got $1'],
  ];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(message)) return message.replace(pattern, replacement);
  }
  return message;
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

  if (state.messages.length === 0) {
    closeHistory();
    els.input.focus();
    toast(t('panel.toastNewChat'));
    return;
  }

  persist();

  const session = newSession();
  state.sessions.unshift(session);
  state.activeSessionId = session.id;
  state.messages = session.messages;
  state.apiMessages = [];
  state.useSelection = false;
  updateSelectionChip();
  setStatus();
  renderAll();
  closeHistory();
  els.input.focus();
  toast(t('panel.toastNewChat'));
}

function currentSession() {
  return state.sessions.find((session) => session.id === state.activeSessionId) || null;
}

function openHistory() {
  state.historyOpen = true;
  els.historyDrawer.classList.remove('hidden');
  renderHistory();
}

function closeHistory() {
  state.historyOpen = false;
  els.historyDrawer.classList.add('hidden');
}

function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleString(getLocale() === 'en' ? 'en-US' : 'zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function renderHistory() {
  els.historyList.textContent = '';
  els.historyCount.textContent = t('history.count', { count: state.sessions.length });

  if (state.sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = t('history.empty');
    els.historyList.appendChild(empty);
    return;
  }

  const ordered = [...state.sessions]
    .filter((session) => (session.messages?.length || 0) > 0 || session.id === state.activeSessionId)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  for (const session of ordered) {
    const item = document.createElement('div');
    item.className = `history-item${session.id === state.activeSessionId ? ' active' : ''}`;

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'history-main';
    main.dataset.load = session.id;

    const title = document.createElement('span');
    title.className = 'history-title';
    title.textContent = session.title || sessionTitle(session.messages, t('history.untitled'));

    const meta = document.createElement('span');
    meta.className = 'history-meta';
    meta.textContent = `${formatTime(session.updatedAt || session.createdAt)} · ${t('history.messages', {
      count: session.messages?.length || 0,
    })}`;

    const snippet = document.createElement('span');
    snippet.className = 'history-snippet';
    const last = [...(session.messages || [])].reverse().find((message) => message.content?.trim());
    snippet.textContent = last
      ? String(last.content).replace(/[#*`>\n]+/g, ' ').trim().slice(0, 90)
      : '';

    main.append(title, meta, snippet);

    const actions = document.createElement('div');
    actions.className = 'history-actions';

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'history-action';
    exportButton.dataset.export = session.id;
    exportButton.textContent = t('history.export');

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'history-action danger';
    deleteButton.dataset.delete = session.id;
    deleteButton.textContent = t('history.delete');

    actions.append(exportButton, deleteButton);
    item.append(main, actions);
    els.historyList.appendChild(item);
  }
}

function switchSession(id) {
  if (id === state.activeSessionId) {
    closeHistory();
    return;
  }
  if (state.busy) stopStreaming();
  persist();
  const session = state.sessions.find((item) => item.id === id);
  if (!session) return;
  state.activeSessionId = id;
  state.messages = session.messages || [];
  state.apiMessages = [];
  rebuildApiHistory();
  renderAll();
  closeHistory();
  setStatus();
  persist();
}

function deleteSession(id) {
  if (!window.confirm(t('history.confirmDelete'))) return;
  const wasActive = id === state.activeSessionId;
  state.sessions = state.sessions.filter((session) => session.id !== id);
  if (state.sessions.length === 0) state.sessions = [newSession()];
  if (wasActive) {
    state.activeSessionId = state.sessions[0].id;
    state.messages = state.sessions[0].messages || [];
    state.apiMessages = [];
    rebuildApiHistory();
    renderAll();
  }
  persist();
  renderHistory();
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function slug(value) {
  return String(value || 'conversation')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function exportSessions(sessions, label) {
  const payload = {
    app: 'Sidebar Copilot',
    exportedAt: new Date().toISOString(),
    sessions: slimSessions(sessions),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  downloadJson(`sidebar-copilot-${slug(label)}-${stamp}.json`, payload);
  toast(t('history.exported'));
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
  retry.textContent = t('common.retry');
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
    hint.textContent = action.confirm.risky ? t('panel.confirmRisky') : t('panel.confirmNormal');

    const allow = document.createElement('button');
    allow.type = 'button';
    allow.className = 'allow';
    allow.dataset.confirm = 'yes';
    allow.dataset.actionId = action.id;
    allow.textContent = t('common.allow');

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'skip';
    skip.dataset.confirm = 'no';
    skip.dataset.actionId = action.id;
    skip.textContent = t('common.skip');

    row.append(hint, allow, skip);
    card.appendChild(row);
  }

  if (action.status === 'ok' && action.result) {
    const details = document.createElement('details');
    details.className = 'action-result';
    const summary = document.createElement('summary');
    summary.textContent = t('common.viewResult');
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
  els.send.title = busy ? t('common.stop') : t('common.send');
  els.send.setAttribute('aria-label', busy ? t('common.stop') : t('common.send'));
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
  const session = currentSession();
  if (!session) return;
  session.messages = slimMessages(state.messages);
  session.updatedAt = Date.now();
  if (!session.title) {
    const derived = sessionTitle(state.messages, '');
    if (derived) session.title = derived;
  }
  if (state.settings?.saveHistory !== false) {
    saveSessions(state.sessions, state.activeSessionId).catch(() => {});
  }
  if (state.historyOpen) renderHistory();
}

function formatNumber(value) {
  const number = Number(value) || 0;
  if (number >= 10000) {
    return getLocale() === 'en' ? `${(number / 1000).toFixed(1)}k` : `${(number / 10000).toFixed(1)} 万`;
  }
  return number.toLocaleString(getLocale() === 'en' ? 'en-US' : 'zh-CN');
}

function toggleVoice() {
  if (state.voice) {
    stopVoice();
    return;
  }

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    toast(t('panel.voiceUnsupported'));
    return;
  }

  const recognition = new Recognition();
  recognition.lang = getLocale() === 'en' ? 'en-US' : 'zh-CN';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  state.voice = recognition;
  state.voiceBase = els.input.value;
  els.mic.classList.add('listening');
  els.mic.title = t('panel.voiceListening');
  els.mic.setAttribute('aria-label', t('panel.voiceListening'));

  let finalText = '';
  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    els.input.value = `${state.voiceBase}${finalText}${interim}`.trim();
    resizeInput();
    updateSendState();
  };
  recognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      toast(t('panel.voiceDenied'));
    } else if (event.error !== 'aborted') {
      toast(t('panel.voiceError', { error: event.error }));
    }
    stopVoice();
  };
  recognition.onend = () => stopVoice();

  try {
    recognition.start();
  } catch (error) {
    toast(t('panel.voiceError', { error: error?.message || error }));
    stopVoice();
  }
}

function stopVoice() {
  const recognition = state.voice;
  state.voice = null;
  if (recognition) {
    try {
      recognition.stop();
    } catch {
      /* already stopped */
    }
  }
  els.mic.classList.remove('listening');
  els.mic.title = t('panel.voiceTitle');
  els.mic.setAttribute('aria-label', t('panel.voiceTitle'));
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
