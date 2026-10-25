import { renderMarkdown } from './lib/markdown.js';
import { streamChat } from './lib/api.js';
import { loadSettings, saveSettings } from './lib/settings.js';
import { loadSessions, saveSessions, newSession, sessionTitle, slimMessages, slimSessions } from './lib/sessions.js';
import { buildSystemPrompt, getQuickPrompts } from './lib/prompts.js';
import { PAGE_TOOLS, describeAction, isRiskyAction, actionStatusLabel } from './lib/agentTools.js';
import { parseToolArguments } from './lib/toolcalls.js';
import { setLocale, applyI18n, t, getLocale } from './lib/i18n.js';
import { applyPanelTheme } from './lib/theme.js';
import { getSkill } from './lib/skills.js';
import { makeRequestId, sameDocument } from './lib/protocol.js';
import * as cdp from './lib/cdp.js';

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
  dshSection: $('dshSection'),
  dshList: $('dshList'),
  refreshDsh: $('refreshDsh'),
  openSettings: $('openSettings'),
  actionsToggle: $('actionsToggle'),
  toast: $('toast'),
};

const ICONS = {
  send: '<path d="M12 19V5M6 11l6-6 6 6" />',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />',
};

const CDP_TOOLS = new Set([
  'capture_screenshot',
  'inspect_ax',
  'cdp_click',
  'cdp_type',
  'cdp_key',
  'cdp_upload',
]);

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
  documentId: '',
  snapshotId: '',
  pendingScreenshot: '',
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
  els.refreshDsh.addEventListener('click', loadDshSessions);
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
    const pushButton = event.target.closest('[data-push]');
    if (pushButton) {
      const session = state.sessions.find((item) => item.id === pushButton.dataset.push);
      if (session) pushSessionToDsh(session);
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

  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    if (state.busy) return;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || tab.url?.startsWith('chrome-extension://')) return;
    const previous = state.tabId;
    if (previous != null && previous !== tabId) cdp.detach(previous);
    readPage({ silent: true });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId === state.tabId && changeInfo.status === 'complete' && !state.busy) {
      readPage({ silent: true });
    }
  });

  chrome.debugger?.onDetach.addListener((source) => {
    if (source?.tabId != null) cdp.forget(source.tabId);
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
  if (state.historyOpen) loadDshSessions();
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
  renderPrompts();
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
    let tab = await getActiveTab();
    // When the side panel itself is focused as a tab (E2E and some detached
    // windows), keep operating on the page the panel was bound to.
    if (tab?.url?.startsWith('chrome-extension://') && state.tabId != null) {
      tab = await chrome.tabs.get(state.tabId).catch(() => tab);
    }
    state.tab = tab;

    if (!tab?.id || !/^(https?|file):/i.test(tab.url || '')) {
      // A detached side panel is itself a chrome-extension tab in tests and
      // some windows; do not let focusing it erase the bound page/selection.
      if (tab?.url?.startsWith('chrome-extension://') && state.page) {
        state.tab = null;
        return;
      }
      state.tabId = tab?.id ?? null;
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

    state.tabId = tab.id;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (window.__SC_EXTRACT__ ? window.__SC_EXTRACT__() : null),
    });

    const page = injection?.result;
    state.documentId = injection?.documentId || '';
    state.snapshotId = '';
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
    state.documentId = '';
    state.snapshotId = '';
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
    if (prompt.needsActions && !state.settings?.allowPageActions) continue;
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
  const maxRounds = Math.max(10, Math.min(300, Number(state.settings.maxAgentSteps) || 100));
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
          action.status = action.result?.uncertain ? 'uncertain' : 'ok';
        } catch (error) {
          action.status = 'error';
          action.error = localizeActionError(error?.message || String(error));
        }
        updateMessage(assistant, index);
        pushToolResult(action);
      }

      if (state.pendingScreenshot && state.settings.sendScreenshot) {
        state.apiMessages.push({
          role: 'user',
          content: [
            { type: 'text', text: 'Current tab screenshot (visual context for this task):' },
            { type: 'image_url', image_url: { url: state.pendingScreenshot } },
          ],
        });
      }
      state.pendingScreenshot = '';

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
          lastAssistant.content = t('panel.safetyCap', { n: maxRounds });
        }
        updateMessage(lastAssistant, state.messages.indexOf(lastAssistant));
      }
      state.controller = null;
      state.pendingScreenshot = '';
      setBusy(false);
      setStatus();
      persist();
      scrollToBottom(state.stickToBottom);
    }
  }
}

function pushToolResult(action) {
  const { screenshot: _screenshot, ...rest } =
    action.result && typeof action.result === 'object' ? action.result : {};
  state.apiMessages.push({
    role: 'tool',
    tool_call_id: action.id,
    content: JSON.stringify({
      ok: action.status !== 'error',
      status: action.status,
      ...rest,
      ...(action.result?.screenshot ? { screenshot: true } : {}),
      ...(action.status === 'error' ? { error: action.error || action.status } : {}),
    }),
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
  if (action.name === 'skill') {
    const skill = getSkill(action.args?.name);
    if (!skill) throw new Error(`未知技能：${action.args?.name || ''}`);
    return {
      ok: true,
      skill: action.args.name,
      summary: skill.summary[getLocale() === 'en' ? 'en' : 'zh'],
      steps: skill.steps[getLocale() === 'en' ? 'en' : 'zh'],
      verified: true,
    };
  }

  if (action.name === 'tab_control') return tabControl(action.args || {});
  if (action.name === 'open_url' && action.args?.new_tab) return openInNewTab(action.args);
  if (CDP_TOOLS.has(action.name)) return executeCdpTool(action);

  if (state.tabId == null) throw new Error(t('panel.noTab'));
  let tab = await getActiveTab().catch(() => null);
  if (tab?.url?.startsWith('chrome-extension://') && state.tabId != null) {
    tab = await chrome.tabs.get(state.tabId).catch(() => tab);
  }
  if (tab?.id != null && tab.id !== state.tabId) {
    throw new Error(t('panel.tabChanged'));
  }

  if (action.name === 'wait_for') {
    const result = await waitFor(action.args || {});
    if (!result.ok) throw new Error(result.error || t('panel.waitTimeoutShort'));
    return { ...result, verified: true, requestId: action.id };
  }

  const expectedDocument = state.documentId;
  const requestId = action.id || makeRequestId('act');
  const { result, documentId, frameId } = await injectAction(
    action.name,
    action.args || {},
    action.name === 'control_media' ? { allFrames: true } : {},
  );
  if (!result) throw new Error(t('panel.noResult'));
  if (result.ok === false) throw new Error(result.error || t('panel.actionFailed'));

  const currentDocument = documentId || state.documentId;
  const documentChanged = Boolean(
    expectedDocument && currentDocument && !sameDocument({ documentId: expectedDocument }, { documentId: currentDocument }),
  );

  if (action.name === 'inspect_page') {
    state.snapshotId = result.snapshotId || '';
    state.documentId = currentDocument || state.documentId;
    result.documentId = state.documentId;
    result.requestId = requestId;
    return result;
  }

  if (documentChanged && action.name !== 'open_url' && action.name !== 'control_media') {
    result.verified = false;
    result.uncertain = true;
    result.postcondition = { type: 'documentChanged', matched: false };
  }

  if (['click', 'double_click', 'right_click'].includes(action.name)) {
    const beforeText = state.page?.text || '';
    await sleep(400);
    const after = await getActiveTab().catch(() => null);
    if (after?.url && state.page?.url && after.url !== state.page.url) {
      await sleep(700);
      await readPage({ silent: true });
      result.verified = true;
      result.uncertain = false;
      result.postcondition = { type: 'urlChanged', matched: true, url: after.url };
    } else if (action.name !== 'right_click') {
      await sleep(250);
      await readPage({ silent: true });
      const afterText = state.page?.text || '';
      if (afterText && afterText !== beforeText) {
        result.verified = true;
        result.uncertain = false;
        result.postcondition = { type: 'domTextChanged', matched: true };
      } else if (result.verified !== true) {
        result.uncertain = true;
        result.postcondition = { type: 'noObservableChange', matched: false };
      }
    } else if (result.verified !== true) {
      result.uncertain = true;
      result.postcondition = { type: 'noObservableChange', matched: false };
    }
  }

  if (action.name === 'open_url') {
    await sleep(1600);
    await readPage({ silent: true });
    result.verified = true;
    result.uncertain = false;
    result.postcondition = { type: 'urlChanged', matched: true, url: state.page?.url };
  }

  if (action.name === 'type_text' && result.submitted) {
    await sleep(600);
    const after = await getActiveTab().catch(() => null);
    if (after?.url && state.page?.url && after.url !== state.page.url) {
      await sleep(600);
      await readPage({ silent: true });
    }
  }

  if (result.verified === false && result.uncertain !== true) result.uncertain = true;
  return {
    ...result,
    requestId,
    documentId: currentDocument,
    frameId: frameId ?? 0,
  };
}

async function executeCdpTool(action) {
  if (!state.settings.useCdp) throw new Error(t('panel.cdpDisabled'));
  if (state.tabId == null) throw new Error(t('panel.noTab'));
  const tabId = state.tabId;
  const args = action.args || {};

  if (action.name === 'capture_screenshot') {
    const screenshot = await cdp.captureScreenshot(tabId);
    state.pendingScreenshot = state.settings.sendScreenshot ? screenshot : '';
    return {
      ok: true,
      screenshot,
      verified: true,
      note: state.settings.sendScreenshot
        ? 'Screenshot captured and queued for the next visual-model request.'
        : 'Screenshot captured for visual inspection; it is shown in the side panel.',
    };
  }

  if (action.name === 'inspect_ax') {
    const nodes = await cdp.accessibilityTree(tabId, Math.min(Math.max(Number(args.limit) || 160, 20), 300));
    return { ok: true, nodes, count: nodes.length, verified: true };
  }

  if (action.name === 'cdp_click') {
    const backendNodeId = Number(args.backend_node_id);
    if (!backendNodeId) throw new Error('需要 backend_node_id');
    const center = await cdp.clickNode(tabId, backendNodeId, args.button === 'right' ? 'right' : 'left');
    return {
      ok: true,
      backend_node_id: backendNodeId,
      point: center,
      verified: false,
      uncertain: true,
      postcondition: { type: 'trustedClickDispatched', matched: false },
    };
  }

  if (action.name === 'cdp_type') {
    const backendNodeId = Number(args.backend_node_id);
    if (!backendNodeId) throw new Error('需要 backend_node_id');
    const text = String(args.text ?? '');
    const outcome = await cdp.typeNode(tabId, backendNodeId, text, {
      clear: args.clear !== false,
      submit: Boolean(args.submit),
    });
    const actual = outcome.actual ?? '';
    return {
      ok: true,
      backend_node_id: backendNodeId,
      valueLength: actual.length,
      verified: actual === text,
      postcondition: { type: 'inputValue', matched: actual === text, expectedLength: text.length, actualLength: actual.length },
    };
  }

  if (action.name === 'cdp_key') {
    await cdp.pressKey(tabId, String(args.key || ''), Array.isArray(args.modifiers) ? args.modifiers : [], args.repeat);
    return {
      ok: true,
      key: args.key,
      verified: false,
      uncertain: true,
      postcondition: { type: 'trustedKeyDispatched', matched: false },
    };
  }

  if (action.name === 'cdp_upload') {
    const backendNodeId = Number(args.backend_node_id);
    if (!backendNodeId) throw new Error('需要 backend_node_id');
    await cdp.setFileInput(tabId, backendNodeId, args.files || []);
    return {
      ok: true,
      backend_node_id: backendNodeId,
      files: (args.files || []).length,
      verified: true,
      postcondition: { type: 'fileInputSet', matched: true },
    };
  }

  throw new Error(`未知 CDP 操作：${action.name}`);
}

async function tabControl(args = {}) {
  const action = String(args.action || 'list');
  const tabId = Number(args.tab_id) || state.tabId;

  if (action === 'list') {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return {
      ok: true,
      tabs: tabs.slice(0, 40).map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        active: Boolean(tab.active),
        index: tab.index,
      })),
      verified: true,
      postcondition: { type: 'tabList', matched: true },
    };
  }

  if (action === 'new') {
    const url = String(args.url || 'about:blank');
    if (url !== 'about:blank' && !/^https?:/i.test(url)) throw new Error(t('panel.onlyHttp'));
    const tab = await chrome.tabs.create({ url, active: true });
    state.tabId = tab.id;
    await sleep(900);
    await readPage({ silent: true });
    return { ok: true, tabId: tab.id, url, verified: true, postcondition: { type: 'tabCreated', matched: Boolean(tab.id) } };
  }

  if (action === 'activate') {
    if (!tabId) throw new Error('需要 tab_id');
    await chrome.tabs.update(tabId, { active: true });
    state.tabId = tabId;
    await sleep(300);
    await readPage({ silent: true });
    return { ok: true, tabId, verified: true, postcondition: { type: 'tabActivated', matched: true } };
  }

  if (action === 'close') {
    if (!tabId) throw new Error('需要 tab_id');
    if (tabId === state.tabId) throw new Error('不能关闭侧边栏所在的当前标签页；先切换到别的标签页');
    await chrome.tabs.remove(tabId);
    return { ok: true, closed: tabId, verified: true, postcondition: { type: 'tabClosed', matched: true } };
  }

  if (action === 'reload') {
    if (!tabId) throw new Error('需要 tab_id');
    await chrome.tabs.reload(tabId);
    await sleep(1500);
    if (tabId === state.tabId) await readPage({ silent: true });
    return { ok: true, tabId, verified: true, postcondition: { type: 'tabReloaded', matched: true } };
  }

  if (action === 'back' || action === 'forward') {
    if (!tabId) throw new Error('需要 tab_id');
    const method = action === 'back' ? chrome.tabs.goBack : chrome.tabs.goForward;
    if (typeof method !== 'function') throw new Error('当前浏览器不支持标签页前进/后退');
    await method.call(chrome.tabs, tabId);
    await sleep(1200);
    if (tabId === state.tabId) await readPage({ silent: true });
    return { ok: true, tabId, action, verified: true, postcondition: { type: `tab:${action}`, matched: true } };
  }

  throw new Error(`未知标签页操作：${action}`);
}

async function openInNewTab(args = {}) {
  const url = String(args.url || '');
  if (!/^https?:/i.test(url)) throw new Error(t('panel.onlyHttp'));
  const tab = await chrome.tabs.create({ url, active: true });
  state.tabId = tab.id;
  await sleep(900);
  await readPage({ silent: true });
  return {
    ok: true,
    tabId: tab.id,
    url,
    verified: true,
    postcondition: { type: 'tabCreated', matched: true, url },
  };
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
    const entries = injections.map((injection) => ({
      result: injection?.result || null,
      documentId: injection?.documentId || '',
      frameId: injection?.frameId ?? 0,
    }));
    if (!allFrames) return entries[0] || { result: null };
    return entries.find((entry) => entry.result?.ok) || entries[0] || { result: null };
  };

  let entry;
  try {
    entry = await run();
  } catch {
    // The frame may be mid-navigation; give it a moment and retry once.
    await sleep(500);
    entry = await run();
  }

  if (!entry.result || entry.result.code === 'SCRIPT_NOT_READY') {
    await chrome.scripting.executeScript({ target, files: ['content.js'] });
    entry = await run();
  }

  return entry;
}

async function waitFor(args) {
  const timeout = Math.min(Math.max(Number(args.timeout_ms) || 5000, 500), 30000);
  const query = String(args.selector || args.text || '');
  const want = args.state === 'hidden' ? 'hidden' : 'visible';
  if (!query) return { ok: false, error: 'wait_for 需要 text 或 selector' };
  const started = Date.now();

  while (Date.now() - started < timeout) {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: state.tabId },
      func: (needle, text, hidden) => {
        const present = text
          ? document.body.innerText.includes(text)
          : Boolean(window.__SC_ACT__ && window.__SC_ACT__('inspect_page', { query: needle, limit: 5 })?.count);
        return { present, hidden };
      },
      args: [query, String(args.text || ''), want === 'hidden'],
    });
    const result = injection?.result;
    if (result && (want === 'visible' ? result.present : !result.present)) {
      return { ok: true, state: want, waited_ms: Date.now() - started };
    }
    await sleep(300);
  }
  return { ok: false, error: t('panel.waitTimeout', { ms: timeout, query }) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function localizeActionError(message) {
  if (getLocale() !== 'en') return message;
  const rules = [
    [/^ref "(.+)" 已失效.*$/, 'ref "$1" is stale; run inspect_page again'],
    [/^ref "(.+)" 属于旧快照.*$/, 'ref "$1" is from a stale snapshot; run inspect_page again'],
    [/^拒绝填写验证码.*$/, 'Refusing a sensitive field; ask the user to type it'],
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
    [/^不能关闭侧边栏所在的当前标签页.*$/, "Can't close the tab that hosts this side panel; switch to another tab first"],
    [/^当前浏览器不支持标签页前进\/后退$/, 'This browser does not support tab back/forward'],
  ];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(message)) return message.replace(pattern, replacement);
  }
  return message;
}

function stopStreaming() {
  state.controller?.abort();
  if (state.tabId != null) cdp.detach(state.tabId);
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
  if (state.tabId != null) cdp.detach(state.tabId);

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
  loadDshSessions();
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

    const pushButton = document.createElement('button');
    pushButton.type = 'button';
    pushButton.className = 'history-action';
    pushButton.dataset.push = session.id;
    pushButton.textContent = '→ DSH';
    pushButton.title = t('dsh.push');

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

    actions.append(pushButton, exportButton, deleteButton);
    item.append(main, actions);
    els.historyList.appendChild(item);
  }
}

function dshBase() {
  return String(state.settings?.dshBridgeUrl || 'http://127.0.0.1:8765').replace(/\/+$/, '');
}

async function loadDshSessions() {
  if (!state.settings?.dshSync) {
    els.dshSection.classList.add('hidden');
    return;
  }
  els.dshSection.classList.remove('hidden');
  els.dshList.textContent = '';

  const note = document.createElement('div');
  note.className = 'dsh-note';
  note.textContent = `${t('dsh.refresh')}…`;
  els.dshList.appendChild(note);

  try {
    const response = await fetch(`${dshBase()}/sessions`, { signal: AbortSignal.timeout(5000) });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'bridge error');
    renderDshSessions(json.sessions || []);
  } catch {
    els.dshList.textContent = '';
    const offline = document.createElement('div');
    offline.className = 'dsh-note';
    offline.textContent = t('dsh.offline');
    els.dshList.appendChild(offline);
  }
}

function renderDshSessions(sessions) {
  els.dshList.textContent = '';
  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dsh-note';
    empty.textContent = t('dsh.empty');
    els.dshList.appendChild(empty);
    return;
  }

  for (const session of sessions) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'dsh-item';

    const title = document.createElement('span');
    title.className = 'dsh-item-title';
    title.textContent = session.title;

    const meta = document.createElement('span');
    meta.className = 'dsh-item-meta';
    meta.textContent = [
      t('dsh.turns', { count: session.turns || 0 }),
      formatTime(session.updatedAt),
      session.running ? t('dsh.running') : '',
    ]
      .filter(Boolean)
      .join(' · ');

    item.append(title, meta);
    item.addEventListener('click', () => importDshSession(session));
    els.dshList.appendChild(item);
  }
}

async function importDshSession(session) {
  try {
    const response = await fetch(`${dshBase()}/sessions/${encodeURIComponent(session.id)}`, {
      signal: AbortSignal.timeout(15000),
    });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'bridge error');

    const messages = (json.session.messages || [])
      .filter((message) => message.text?.trim())
      .map((message) => ({
        role: message.role,
        content: message.text,
        ts: message.time || Date.now(),
      }));
    if (messages.length === 0) {
      toast(t('dsh.empty'));
      return;
    }

    persist();
    let target = currentSession();
    if (!target || (target.messages?.length || 0) > 0) {
      target = newSession();
      state.sessions.unshift(target);
      state.activeSessionId = target.id;
    }
    target.title = `[DSH] ${json.session.title || session.title}`;
    target.messages = messages;
    state.messages = target.messages;
    state.apiMessages = [];
    rebuildApiHistory();
    renderAll();
    closeHistory();
    setStatus();
    persist();
    toast(t('dsh.imported'));
  } catch {
    toast(t('dsh.offline'));
  }
}

async function pushSessionToDsh(session) {
  const bridge = String(state.settings?.dshBridgeUrl || 'http://127.0.0.1:8765').replace(/\/+$/, '');
  const messages = (session.messages || [])
    .filter((message) => ['user', 'assistant'].includes(message.role) && message.content?.trim())
    .map((message) => ({ role: message.role, text: message.content }));

  if (messages.length === 0) {
    toast(t('dsh.empty'));
    return;
  }

  toast(t('dsh.pushing'));
  try {
    const response = await fetch(`${bridge}/dsh/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: session.title,
        messages,
        ...(state.settings?.dshServerUrl ? { dshUrl: state.settings.dshServerUrl } : {}),
      }),
      signal: AbortSignal.timeout(35000),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.ok) throw new Error(json.error || `HTTP ${response.status}`);
    toast(t('dsh.pushed', { id: json.sessionId }));
  } catch {
    toast(t('dsh.pushFailed'));
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
  uncertain: '?',
  error: '!',
  skipped: '–',
  cancelled: '–',
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

  if (action.result?.screenshot) {
    const image = document.createElement('img');
    image.className = 'action-shot';
    image.src = action.result.screenshot;
    image.alt = 'Screenshot';
    card.appendChild(image);
  }

  if ((action.status === 'ok' || action.status === 'uncertain') && action.result) {
    const details = document.createElement('details');
    details.className = 'action-result';
    const summary = document.createElement('summary');
    summary.textContent = t('common.viewResult');
    const pre = document.createElement('pre');
    const { screenshot: _screenshot, ...rest } = action.result;
    pre.textContent = JSON.stringify(rest, null, 2).slice(0, 2400);
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
