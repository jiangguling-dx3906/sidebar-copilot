import { createSSEParser } from './sse.js';
import { createToolCallAccumulator } from './toolcalls.js';

export class ApiError extends Error {
  constructor(message, { status, detail } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

export function normalizeBaseUrl(input) {
  let base = String(input || '').trim();
  if (!base) return '';
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  base = base.replace(/\/+$/, '');
  base = base.replace(/\/chat\/completions$/i, '');
  return base;
}

export function describeStatus(status, detail) {
  const snippet = String(detail || '').slice(0, 300).replace(/\s+/g, ' ').trim();
  const suffix = snippet ? `：${snippet}` : '';
  switch (status) {
    case 400:
      return `请求被拒绝（400），可能是模型名或参数不被支持${suffix}`;
    case 401:
      return 'API Key 无效或未授权（401）。请到设置里检查 Key。';
    case 402:
      return '账户余额不足（402）。';
    case 403:
      return `没有权限访问该模型（403）${suffix}`;
    case 404:
      return `接口或模型不存在（404），请检查 API 地址和模型名${suffix}`;
    case 429:
      return '请求太频繁或超出额度（429），稍后再试。';
    default:
      if (status >= 500) return `模型服务暂时不可用（${status}），稍后再试。${suffix}`;
      return `请求失败（${status}）${suffix}`;
  }
}

async function readErrorBody(response) {
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text);
      return parsed?.error?.message || parsed?.message || text;
    } catch {
      return text;
    }
  } catch {
    return '';
  }
}

function extractDelta(json) {
  const choice = json?.choices?.[0];
  if (!choice) return '';
  const delta = choice.delta ?? choice.message;
  if (!delta) return '';
  if (typeof delta.content === 'string') return delta.content;
  if (Array.isArray(delta.content)) {
    return delta.content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
  }
  if (typeof delta.text === 'string') return delta.text;
  return '';
}

export async function streamChat({ settings, messages, tools, signal, onDelta }) {
  const base = normalizeBaseUrl(settings.apiBase);
  if (!base) throw new ApiError('还没有配置 API 地址，请打开设置填写。');
  if (!settings.apiKey && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(base)) {
    throw new ApiError('还没有配置 API Key，请打开设置填写。');
  }

  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  const body = {
    model: settings.model,
    messages,
    stream: true,
    temperature: Number(settings.temperature ?? 0.3),
  };
  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const emit = typeof onDelta === 'function' ? onDelta : () => {};
  const accumulator = createToolCallAccumulator();
  let content = '';
  let finishReason = null;

  let response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError(
      `无法连接 ${base}。请检查网络、API 地址是否正确；本地服务还需要允许跨域（CORS）。`,
      { detail: String(error?.message || error) },
    );
  }

  if (!response.ok) {
    const detail = await readErrorBody(response);
    throw new ApiError(describeStatus(response.status, detail), { status: response.status, detail });
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('event-stream') || !response.body) {
    const json = await response.json().catch(() => null);
    const message = json?.choices?.[0]?.message;
    const text = typeof message?.content === 'string' ? message.content : extractDelta(json);
    if (text) {
      content += text;
      emit(text);
    }
    (message?.tool_calls || []).forEach((call, index) => {
      accumulator.push([{ index, ...call }]);
    });
    return { content, toolCalls: accumulator.finish(), finishReason: json?.choices?.[0]?.finish_reason || null };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const parser = createSSEParser((event) => {
    if (event.done) return;
    if (!event.data) return;
    const choice = event.data.choices?.[0];
    const text = extractDelta(event.data);
    if (text) {
      content += text;
      emit(text);
    }
    if (choice?.delta?.tool_calls) accumulator.push(choice.delta.tool_calls);
    if (choice?.finish_reason) finishReason = choice.finish_reason;
  });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.flush();

  return { content, toolCalls: accumulator.finish(), finishReason };
}
