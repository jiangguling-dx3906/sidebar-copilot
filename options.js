import { DEFAULT_SETTINGS, PRESETS, loadSettings, saveSettings } from './lib/settings.js';
import { normalizeBaseUrl, describeStatus } from './lib/api.js';

const el = {
  presets: document.getElementById('presets'),
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
  maxAgentSteps: document.getElementById('maxAgentSteps'),
  maxStepsLabel: document.getElementById('maxStepsLabel'),
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
  fillForm(settings);
  renderPresets();
  updatePresetState();
  bind();
  setStatus('');
}

function fillForm(values) {
  el.apiBase.value = values.apiBase || '';
  el.apiKey.value = values.apiKey || '';
  el.model.value = values.model || '';
  el.temperature.value = String(values.temperature ?? 0.3);
  el.temperatureLabel.textContent = Number(values.temperature ?? 0.3).toFixed(1);
  el.maxPageChars.value = String(values.maxPageChars ?? 14000);
  el.maxCharsLabel.textContent = String(values.maxPageChars ?? 14000);
  el.historyLimit.value = String(values.historyLimit ?? 12);
  el.historyLabel.textContent = String(values.historyLimit ?? 12);
  el.allowPageActions.checked = values.allowPageActions !== false;
  el.confirmActions.checked = Boolean(values.confirmActions);
  el.maxAgentSteps.value = String(values.maxAgentSteps ?? 6);
  el.maxStepsLabel.textContent = String(values.maxAgentSteps ?? 6);
  el.systemExtra.value = values.systemExtra || '';

  const preset = PRESETS.find(
    (item) => item.id !== 'custom' && normalizeBaseUrl(item.apiBase) === normalizeBaseUrl(values.apiBase),
  );
  activePreset = preset?.id || 'custom';
  updatePresetState();
  updateKeyHint(activePreset);
}

function renderPresets() {
  el.presets.textContent = '';
  for (const preset of PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset';
    button.dataset.preset = preset.id;
    button.textContent = preset.label;
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
  el.keyHint.textContent = '只保存在本机浏览器存储里，不会同步到云端。';
  if (preset?.keyUrl) {
    const link = document.createElement('a');
    link.href = preset.keyUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = ' 获取 Key ↗';
    link.style.color = 'var(--accent-strong)';
    el.keyHint.appendChild(link);
  }
}

function bind() {
  el.temperature.addEventListener('input', () => {
    el.temperatureLabel.textContent = Number(el.temperature.value).toFixed(1);
  });
  el.maxPageChars.addEventListener('input', () => {
    el.maxCharsLabel.textContent = Number(el.maxPageChars.value).toLocaleString('zh-CN');
  });
  el.historyLimit.addEventListener('input', () => {
    el.historyLabel.textContent = el.historyLimit.value;
  });
  el.maxAgentSteps.addEventListener('input', () => {
    el.maxStepsLabel.textContent = el.maxAgentSteps.value;
  });

  el.toggleKey.addEventListener('click', () => {
    const revealed = el.apiKey.type === 'text';
    el.apiKey.type = revealed ? 'password' : 'text';
    el.toggleKey.textContent = revealed ? '显示' : '隐藏';
  });

  el.save.addEventListener('click', async () => {
    const values = readForm();
    if (!values.apiBase) {
      setStatus('请填写 API 地址。', 'err');
      return;
    }
    settings = await saveSettings(values);
    setStatus('已保存。回到侧边栏即可直接对话。', 'ok');
  });

  el.test.addEventListener('click', testConnection);
  el.clearChat.addEventListener('click', async () => {
    await chrome.storage.local.remove('conversation');
    setStatus('对话记录已清除。', 'ok');
  });

  el.reset.addEventListener('click', () => {
    fillForm(DEFAULT_SETTINGS);
    setStatus('已填入默认值，点击“保存”后生效。');
  });

  el.shortcutsLink.addEventListener('click', (event) => {
    event.preventDefault();
    const url = navigator.userAgent.includes('Edg/')
      ? 'edge://extensions/shortcuts'
      : 'chrome://extensions/shortcuts';
    chrome.tabs.create({ url }).catch(() => {
      setStatus('请在浏览器的扩展管理页里找到“键盘快捷键”。');
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
    maxAgentSteps: Number(el.maxAgentSteps.value),
    systemExtra: el.systemExtra.value.trim(),
  };
}

async function testConnection() {
  const values = readForm();
  if (!values.apiBase) {
    setStatus('请先填写 API 地址。', 'err');
    return;
  }
  if (!values.apiKey && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(values.apiBase)) {
    setStatus('请先填写 API Key。', 'err');
    return;
  }

  el.test.disabled = true;
  setStatus('正在测试连接…');

  const started = performance.now();
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (values.apiKey) headers.Authorization = `Bearer ${values.apiKey}`;

    const response = await fetch(`${values.apiBase}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: values.model,
        messages: [{ role: 'user', content: '只回复 OK 两个字母。' }],
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
    const reply = json?.choices?.[0]?.message?.content || '（空响应）';
    const elapsed = Math.round(performance.now() - started);
    setStatus(`连接成功 · ${values.model} · ${elapsed}ms · 返回：${String(reply).slice(0, 40)}`, 'ok');
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      setStatus('连接超时（20 秒）。检查网络或 API 地址。', 'err');
    } else if (error?.name === 'TypeError') {
      setStatus('无法连接：地址不可达，或本地服务没有允许跨域（CORS）。', 'err');
    } else {
      setStatus(`连接失败：${error?.message || error}`, 'err');
    }
  } finally {
    el.test.disabled = false;
  }
}

function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = `status ${kind}`.trim();
}
