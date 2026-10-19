import { loadSettings } from './lib/settings.js';
import { setLocale, t } from './lib/i18n.js';

const PANEL_PATH = 'panel.html';

async function enablePanel() {
  try {
    await chrome.sidePanel.setOptions({ path: PANEL_PATH, enabled: true });
  } catch {
    /* older browsers: the action fallback still opens a window */
  }
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    /* ignore */
  }
}

async function createMenus() {
  try {
    const settings = await loadSettings();
    setLocale(settings.locale);
  } catch {
    /* fall back to the detected locale */
  }
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'sc-explain-selection',
      title: t('menu.explain'),
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'sc-summarize-page',
      title: t('menu.summarize'),
      contexts: ['page'],
    });
  });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  enablePanel();
  createMenus();
  if (details.reason !== 'install') return;
  try {
    const { welcomed } = await chrome.storage.local.get('welcomed');
    if (welcomed) return;
    await chrome.storage.local.set({ welcomed: true });
    await chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  } catch {
    /* welcome page is optional */
  }
});

chrome.runtime.onStartup.addListener(() => {
  enablePanel();
  createMenus();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) createMenus();
});

async function openPanelFor(tab) {
  if (tab?.id != null) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
      return;
    } catch {
      /* fall through to a detached window */
    }
  }
  await openDetachedWindow(tab);
}

async function openDetachedWindow(tab) {
  const query = new URLSearchParams({ standalone: '1' });
  if (tab?.id != null) query.set('tabId', String(tab.id));
  await chrome.windows.create({
    url: `${chrome.runtime.getURL('panel.html')}?${query.toString()}`,
    type: 'popup',
    width: 430,
    height: 760,
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const action = info.menuItemId === 'sc-explain-selection' ? 'explain-selection' : 'summarize-page';
  const payload = {
    action,
    selection: String(info.selectionText || '').slice(0, 4000),
    tabId: tab?.id ?? null,
    at: Date.now(),
  };
  try {
    await chrome.storage.session.set({ pendingAction: payload });
  } catch {
    /* ignore */
  }
  try {
    chrome.runtime.sendMessage({ type: 'sc:pending-action' }).catch(() => {});
  } catch {
    /* no receiver yet */
  }
  await openPanelFor(tab);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-panel') return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  await openPanelFor(tab);
});

// Only fires when setPanelBehavior is unavailable; otherwise the browser opens
// the side panel itself and this listener is not invoked.
chrome.action.onClicked.addListener(async (tab) => {
  await openPanelFor(tab);
});
