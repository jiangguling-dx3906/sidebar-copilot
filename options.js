import { DEFAULT_SETTINGS, PRESETS, loadSettings, saveSettings } from './lib/settings.js';
import { normalizeBaseUrl, describeStatus } from './lib/api.js';
import { setLocale, applyI18n, t, getLocale } from './lib/i18n.js';

const el = {
  presets: document.getElementById('presets'),
  savedProvider: document.getElementById('savedProvider'),
  deleteProvider: document.getElementById('deleteProvider'),
  locale: document.getElementById('locale'),
  useCustomBg: document.getElementById('useCustomBg'),
  panelBg: document.getElementById('panelBg'),
  apiBase: document.getElementById('apiBase'),
  apiKey: document.getElementById('apiKey'),
  toggleKey: document.getElementById('toggleKey'),
  model: document.getElementById('model'),
  temperature: document.getElementById('temperature'),
  temperatureLabel: document.getElementById('temperatureLabel'),
  maxPageChars: document.getElementById('maxPageChars'),
  maxCharsLabel: document.getElementById('maxCharsLabel'),
  historyLimit: document.getElementById('historyLimit'),
  historyLabel: document.getElementById('historyLabel'),
  allowPageActions: document.getElementById('allowPageActions'),
  confirmActions: document.getElementById('confirmActions'),
  useCdp: document.getElementById('useCdp'),
  maxAgentSteps: document.getElementById('maxAgentSteps'),
  maxStepsLabel: document.getElementById('maxStepsLabel'),
  dshSync: document.getElementById('dshSync'),
  dshBridgeUrl: document.getElementById('dshBridgeUrl'),
  dshServerUrl: document.getElementById('dshServerUrl'),
  systemExtra: document.getElementById('systemExtra'),
  save: document.getElementById('save'),
  test: document.getElementById('test'),
  clearChat: document.getElementById('clearChat'),
  reset: document.getElementById('reset'),
  status: document.getElementById('status'),
  keyHint: document.getElementById('keyHint'),
  shortcutsLink: document.getElementById('shortcutsLink'),
};

let settings = { ...DEFAULT_SETTINGS };
let activePreset = 'deepseek';

init();

async function init() {
  settings = await loadSettings();
  setLocale(settings.locale);
  applyI18n();
  fillForm(settings);
  renderPresets();
  renderSavedProviders();
  updatePresetState();
  bind();
  setStatus('');
}

function fillForm(values) {
  el.locale.value = values.locale || 'auto';
  el.useCustomBg.checked = Boolean(values.panelBg);
  el.panelBg.value = values.panelBg || '#ffffff';
  el.panelBg.disabled = !el.useCustomBg.checked;
  el.apiBase.value = values.apiBase || '';
  el.apiKey.value = values.apiKey || '';
  el.model.value = values.model || '';
  el.temperature.value = String(values.temperature ?? 0.3);
  el.temperatureLabel.textContent = Number(values.temperature ?? 0.3).toFixed(1);
  el.maxPageChars.value = String(values.maxPageChars ?? 14000);
  el.maxCharsLabel.textContent = Number(values.maxPageChars ?? 14000).toLocaleString(
    getLocale() === 'en' ? 'en-US' : 'zh-CN',
  );
  el.historyLimit.value = String(values.historyLimit ?? 12);
  el.historyLabel.textContent = String(values.historyLimit ?? 12);
  el.allowPageActions.checked = values.allowPageActions !== false;
  el.confirmActions.checked = Boolean(values.confirmActions);
  el.useCdp.checked = values.useCdp !== false;
  el.maxAgentSteps.value = String(values.maxAgentSteps ?? 100);
  el.maxStepsLabel.textContent = String(values.maxAgentSteps ?? 100);
  el.dshSync.checked = Boolean(values.dshSync);
  el.dshBridgeUrl.value = values.dshBridgeUrl || DEFAULT_SETTINGS.dshBridgeUrl;
  el.dshServerUrl.value = values.dshServerUrl || DEFAULT_SETTINGS.dshServerUrl;
  el.systemExtra.value = values.systemExtra || '';

  const preset = PRESETS.find(
    (item) => item.id !== 'custom' && normalizeBaseUrl(item.apiBase) === normalizeBaseUrl(values.apiBase),
  );
  activePreset = preset?.id || 'custom';
  updatePresetState();
  updateKeyHint(activePreset);
}

function presetLabel(preset) {
  if (preset.id === 'custom') return t('options.presetCustom');
  if (preset.id === 'ollama') return t('options.presetOllama');
  return preset.label;
}

function providerLabel(apiBase, model) {
  const preset = PRESETS.find(
    (item) => item.id !== 'custom' && normalizeBaseUrl(item.apiBase) === normalizeBaseUrl(apiBase),
  );
  if (preset) return `${preset.id === 'ollama' ? t('options.presetOllama') : preset.label} · ${model}`;
  try {
    return `${new URL(apiBase).hostname} · ${model}`;
  } catch {
    return model;
  }
}

function rememberProvider(values) {
  const list = Array.isArray(settings.savedProviders) ? [...settings.savedProviders] : [];
  if (!values.apiBase || !values.apiKey) return list;
  const id = `${normalizeBaseUrl(values.apiBase)}|${values.model}`;
  const next = list.filter((provider) => provider.id !== id);
  next.unshift({
    id,
    label: providerLabel(values.apiBase, values.model),
    apiBase: values.apiBase,
    model: values.model,
    apiKey: values.apiKey,
    updatedAt: Date.now(),
  });
  return next.slice(0, 12);
}

function renderSavedProviders() {
  const providers = Array.isArray(settings.savedProviders) ? settings.savedProviders : [];
  el.savedProvider.textContent = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = t('options.chooseProvider');
  el.savedProvider.appendChild(placeholder);

  for (const provider of providers) {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.label;
    el.savedProvider.appendChild(option);
  }
}

function renderPresets() {
  el.presets.textContent = '';
  for (const preset of PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset';
    button.dataset.preset = preset.id;
    button.textContent = presetLabel(preset);
    button.addEventListener('click', () => {
      activePreset = preset.id;
      if (preset.apiBase) el.apiBase.value = preset.apiBase;
      if (preset.model) el.model.value = preset.model;
      updatePresetState();
      updateKeyHint(preset.id);
      setStatus('');
    });
    el.presets.appendChild(button);
  }
}

function updatePresetState() {
  for (const button of el.presets.querySelectorAll('.preset')) {
    button.classList.toggle('active', button.dataset.preset === activePreset);
  }
}

function updateKeyHint(presetId) {
  const preset = PRESETS.find((item) => item.id === presetId);
  el.keyHint.textContent = t('options.keyHint');
  if (preset?.keyUrl) {
    const link = document.createElement('a');
    link.href = preset.keyUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = t('options.getKeyLink');
    link.style.color = 'var(--accent-strong)';
    el.keyHint.appendChild(link);
  }
}

function bind() {
  el.temperature.addEventListener('input', () => {
    el.temperatureLabel.textContent = Number(el.temperature.value).toFixed(1);
  });
  el.maxPageChars.addEventListener('input', () => {
    el.maxCharsLabel.textContent = Number(el.maxPageChars.value).toLocaleString(
      getLocale() === 'en' ? 'en-US' : 'zh-CN',
    );
  });
  el.historyLimit.addEventListener('input', () => {
    el.historyLabel.textContent = el.historyLimit.value;
  });
  el.maxAgentSteps.addEventListener('input', () => {
    el.maxStepsLabel.textContent = el.maxAgentSteps.value;
  });

  el.locale.addEventListener('change', async () => {
    settings = await saveSettings({ ...settings, locale: el.locale.value });
    setLocale(el.locale.value);
    applyI18n();
    renderPresets();
    renderSavedProviders();
    updatePresetState();
    updateKeyHint(activePreset);
    setStatus('');
  });

  el.savedProvider.addEventListener('change', () => {
    const provider = (settings.savedProviders || []).find(
      (item) => item.id === el.savedProvider.value,
    );
    if (!provider) return;
    el.apiBase.value = provider.apiBase;
    el.apiKey.value = provider.apiKey;
    el.model.value = provider.model;
    activePreset = 'custom';
    updatePresetState();
    updateKeyHint('custom');
    setStatus('');
  });

  el.deleteProvider.addEventListener('click', async () => {
    const id = el.savedProvider.value;
    if (!id) return;
    settings = await saveSettings({
      ...settings,
      savedProviders: (settings.savedProviders || []).filter((item) => item.id !== id),
    });
    renderSavedProviders();
    el.savedProvider.value = '';
    setStatus(t('options.saved'), 'ok');
  });

  el.useCustomBg.addEventListener('change', () => {
    el.panelBg.disabled = !el.useCustomBg.checked;
  });

  el.toggleKey.addEventListener('click', () => {
    const revealed = el.apiKey.type === 'text';
    el.apiKey.type = revealed ? 'password' : 'text';
    el.toggleKey.textContent = revealed ? t('options.show') : t('options.hide');
  });

  el.save.addEventListener('click', async () => {
    const values = readForm();
    if (!values.apiBase) {
      setStatus(t('options.fillBase'), 'err');
      return;
    }
    values.savedProviders = rememberProvider(values);
    settings = await saveSettings(values);
    setLocale(values.locale);
    applyI18n();
    renderPresets();
    renderSavedProviders();
    updatePresetState();
    updateKeyHint(activePreset);
    setStatus(t('options.saved'), 'ok');
  });

  el.test.addEventListener('click', testConnection);
  el.clearChat.addEventListener('click', async () => {
    await chrome.storage.local.remove(['conversation', 'sessions', 'activeSessionId']);
    setStatus(t('options.cleared'), 'ok');
  });

  el.reset.addEventListener('click', () => {
    fillForm({
      ...DEFAULT_SETTINGS,
      apiBase: settings.apiBase,
      apiKey: settings.apiKey,
      model: settings.model,
      savedProviders: settings.savedProviders,
      locale: settings.locale,
      panelBg: settings.panelBg,
      saveHistory: settings.saveHistory,
      useCdp: settings.useCdp,
      dshSync: settings.dshSync,
      dshBridgeUrl: settings.dshBridgeUrl,
      dshServerUrl: settings.dshServerUrl,
    });
    setStatus(t('options.resetDone'));
  });

  el.shortcutsLink.addEventListener('click', (event) => {
    event.preventDefault();
    const url = navigator.userAgent.includes('Edg/')
      ? 'edge://extensions/shortcuts'
      : 'chrome://extensions/shortcuts';
    chrome.tabs.create({ url }).catch(() => {
      setStatus(t('options.shortcutFail'));
    });
  });
}

function readForm() {
  return {
    apiBase: normalizeBaseUrl(el.apiBase.value),
    apiKey: el.apiKey.value.trim(),
    model: el.model.value.trim() || DEFAULT_SETTINGS.model,
    temperature: Number(el.temperature.value),
    maxPageChars: Number(el.maxPageChars.value),
    historyLimit: Number(el.historyLimit.value),
    includePage: settings.includePage !== false,
    allowPageActions: el.allowPageActions.checked,
    confirmActions: el.confirmActions.checked,
    useCdp: el.useCdp.checked,
    maxAgentSteps: Math.max(20, Math.min(300, Number(el.maxAgentSteps.value) || 100)),
    systemExtra: el.systemExtra.value.trim(),
    locale: el.locale.value,
    panelBg: el.useCustomBg.checked ? el.panelBg.value : '',
    savedProviders: settings.savedProviders || [],
    dshSync: el.dshSync.checked,
    dshBridgeUrl: el.dshBridgeUrl.value.trim() || DEFAULT_SETTINGS.dshBridgeUrl,
    dshServerUrl: el.dshServerUrl.value.trim() || DEFAULT_SETTINGS.dshServerUrl,
  };
}

async function testConnection() {
  const values = readForm();
  if (!values.apiBase) {
    setStatus(t('options.needBase'), 'err');
    return;
  }
  if (!values.apiKey && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(values.apiBase)) {
    setStatus(t('options.needKey'), 'err');
    return;
  }

  el.test.disabled = true;
  setStatus(t('options.testing'));

  const providers = rememberProvider(values);
  if (providers.length !== (settings.savedProviders || []).length) {
    settings = await saveSettings({ ...settings, savedProviders: providers });
    renderSavedProviders();
  }

  const started = performance.now();
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (values.apiKey) headers.Authorization = `Bearer ${values.apiKey}`;

    const response = await fetch(`${values.apiBase}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: values.model,
        messages: [{ role: 'user', content: t('options.testPrompt') }],
        max_tokens: 16,
        stream: false,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      setStatus(describeStatus(response.status, detail), 'err');
      return;
    }

    const json = await response.json();
    const reply = json?.choices?.[0]?.message?.content || t('options.emptyReply');
    const elapsed = Math.round(performance.now() - started);
    setStatus(
      t('options.connected', { model: values.model, ms: elapsed, reply: String(reply).slice(0, 40) }),
      'ok',
    );
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      setStatus(t('options.timeout'), 'err');
    } else if (error?.name === 'TypeError') {
      setStatus(t('options.network'), 'err');
    } else {
      setStatus(t('options.failed', { message: error?.message || error }), 'err');
    }
  } finally {
    el.test.disabled = false;
  }
}

function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = `status ${kind}`.trim();
}
