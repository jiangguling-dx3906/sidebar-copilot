/**
 * Incremental Server-Sent Events parser for OpenAI-compatible streams.
 * Handles arbitrary chunk boundaries and both LF and CRLF framing.
 */
export function createSSEParser(onEvent) {
  let buffer = '';

  function emit(raw) {
    const dataLines = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n').trim();
    if (!payload) return;
    if (payload === '[DONE]') {
      onEvent({ done: true });
      return;
    }
    try {
      onEvent({ data: JSON.parse(payload) });
    } catch {
      onEvent({ raw: payload });
    }
  }

  return {
    push(chunk) {
      buffer += String(chunk).replace(/\r\n/g, '\n');
      let index = buffer.indexOf('\n\n');
      while (index !== -1) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        emit(raw);
        index = buffer.indexOf('\n\n');
      }
    },
    flush() {
      if (buffer.trim()) emit(buffer);
      buffer = '';
    },
  };
}
