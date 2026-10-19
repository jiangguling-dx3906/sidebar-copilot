/**
 * Accumulates streamed OpenAI-compatible `tool_calls` deltas.
 *
 * Providers send the call id/name once and split `arguments` across chunks, so
 * everything is appended by index and only assembled at the end of the stream.
 */
export function createToolCallAccumulator() {
  const calls = [];

  return {
    push(deltas) {
      if (!Array.isArray(deltas)) return;
      for (const delta of deltas) {
        if (!delta || typeof delta !== 'object') continue;
        const index = Number.isInteger(delta.index) ? delta.index : calls.length;
        let call = calls[index];
        if (!call) {
          call = calls[index] = { id: '', type: 'function', function: { name: '', arguments: '' } };
        }
        if (typeof delta.id === 'string' && delta.id) call.id = delta.id;
        if (typeof delta.type === 'string' && delta.type) call.type = delta.type;
        const fn = delta.function;
        if (fn && typeof fn === 'object') {
          if (typeof fn.name === 'string' && fn.name) call.function.name += fn.name;
          if (typeof fn.arguments === 'string' && fn.arguments) {
            call.function.arguments += fn.arguments;
          }
        }
      }
    },

    finish() {
      return calls.filter(Boolean).map((call, index) => ({
        id: call.id || `call_${index}_${Math.random().toString(36).slice(2, 8)}`,
        type: call.type || 'function',
        function: {
          name: call.function.name,
          arguments: call.function.arguments || '{}',
        },
      }));
    },
  };
}

/** Returns null when the model produced malformed JSON arguments. */
export function parseToolArguments(raw) {
  if (raw == null || String(raw).trim() === '') return {};
  try {
    const value = JSON.parse(String(raw));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
