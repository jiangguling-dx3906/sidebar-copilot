export const DEFAULT_SETTINGS = Object.freeze({
  apiBase: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.3,
  maxPageChars: 14000,
  historyLimit: 12,
  includePage: true,
  systemExtra: '',
  allowPageActions: true,
  confirmActions: false,
  maxAgentSteps: 6,
  locale: 'auto',
  panelBg: '',
});

export const PRESETS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    apiBase: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    apiBase: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'ollama',
    label: '本地 Ollama',
    apiBase: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    keyUrl: 'https://ollama.com/download',
  },
  {
    id: 'custom',
    label: '自定义',
    apiBase: '',
    model: '',
    keyUrl: '',
  },
];

export async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(stored?.settings || {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  await chrome.storage.local.set({ settings: merged });
  return merged;
}

export async function loadConversation() {
  try {
    const stored = await chrome.storage.local.get('conversation');
    const messages = stored?.conversation;
    if (!Array.isArray(messages)) return [];
    return messages
      .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
      .map((message) => ({
        role: message.role,
        content: String(message.content || ''),
        ts: Number(message.ts) || 0,
        error: message.error ? String(message.error) : undefined,
        stopped: Boolean(message.stopped),
        actions: Array.isArray(message.actions)
          ? message.actions.slice(0, 8).map((action) => ({
              id: String(action.id || ''),
              name: String(action.name || ''),
              args: action.args && typeof action.args === 'object' ? action.args : {},
              status: String(action.status || 'ok'),
              error: action.error ? String(action.error) : '',
              result: action.result,
            }))
          : undefined,
      }))
      .slice(-100);
  } catch {
    return [];
  }
}

function clipResult(result) {
  if (!result) return undefined;
  try {
    const text = JSON.stringify(result);
    if (text.length <= 2000) return JSON.parse(text);
    return { truncated: true, preview: text.slice(0, 2000) };
  } catch {
    return undefined;
  }
}

export async function saveConversation(messages) {
  try {
    const trimmed = messages.slice(-100).map((message) => ({
      role: message.role,
      content: message.content,
      ts: message.ts,
      error: message.error,
      stopped: message.stopped,
      actions: message.actions?.length
        ? message.actions.slice(0, 8).map((action) => ({
            id: action.id,
            name: action.name,
            args: action.args,
            status: action.status,
            error: action.error,
            result: clipResult(action.result),
          }))
        : undefined,
    }));
    await chrome.storage.local.set({ conversation: trimmed });
  } catch {
    /* storage is best-effort */
  }
}
