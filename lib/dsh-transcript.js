const TEXT_BLOCK = 'text';

function textOf(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((block) => block && block.type === TEXT_BLOCK && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

/**
 * Extract user/assistant messages from decoded DSH session events.
 * DSH logs injected approval text and tool calls too; only real user turns and
 * assistant text blocks become transcript messages.
 */
export function extractTranscript(events) {
  const messages = [];

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;

    if (event.type === 'agent/inbox/spliced') {
      const data = event.data || {};
      if (data.target !== 'next-turn') continue;
      for (const inserted of data.inserted || []) {
        if (!inserted || inserted.role !== 'user') continue;
        if (inserted.source?.kind !== 'user') continue;
        const text = textOf(inserted.content);
        if (text.trim()) messages.push({ role: 'user', text, time: event.time });
      }
      continue;
    }

    if (event.type === 'assistant/message') {
      const message = event.data?.message;
      if (!message || message.role !== 'assistant') continue;
      const text = textOf(message.content);
      if (text.trim()) messages.push({ role: 'assistant', text, time: event.time });
    }
  }

  return messages;
}

export function titleOf(events, fallback = 'DeepSeek Harness session') {
  const first = extractTranscript(events).find((message) => message.role === 'user');
  if (!first) return fallback;
  const text = first.text.replace(/\s+/g, ' ').trim();
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
}
