export const MAX_SESSIONS = 50;
export const MAX_MESSAGES = 200;

export function newSession(now = Date.now()) {
  return {
    id: `s_${now}_${Math.random().toString(36).slice(2, 8)}`,
    title: '',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function sessionTitle(messages, fallback = '') {
  const first = (messages || []).find((message) => message.role === 'user' && message.content?.trim());
  if (!first) return fallback;
  const text = String(first.content).replace(/\s+/g, ' ').trim();
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
}

function clipText(value, limit) {
  const text = String(value || '');
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function clipResult(result) {
  if (!result) return undefined;
  try {
    const text = JSON.stringify(result);
    if (text.length <= 1500) return JSON.parse(text);
    return { truncated: true, preview: text.slice(0, 1500) };
  } catch {
    return undefined;
  }
}

export function slimMessages(messages) {
  return (messages || [])
    .filter((message) => !message.streaming)
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: clipText(message.content, 20000),
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
}

export function slimSessions(sessions) {
  return (sessions || []).slice(0, MAX_SESSIONS).map((session) => ({
    id: session.id,
    title: session.title || sessionTitle(session.messages),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: slimMessages(session.messages),
  }));
}

export async function loadSessions() {
  const stored = await chrome.storage.local.get(['sessions', 'activeSessionId', 'conversation']);
  let sessions = Array.isArray(stored.sessions) ? stored.sessions : [];

  if (sessions.length === 0 && Array.isArray(stored.conversation) && stored.conversation.length > 0) {
    const now = Date.now();
    const migrated = {
      ...newSession(now),
      title: sessionTitle(stored.conversation),
      messages: stored.conversation,
    };
    sessions = [migrated];
    await chrome.storage.local.set({ sessions, activeSessionId: migrated.id });
  }

  if (sessions.length === 0) sessions = [newSession()];

  const activeSessionId = sessions.some((session) => session.id === stored.activeSessionId)
    ? stored.activeSessionId
    : sessions[0].id;

  return { sessions, activeSessionId };
}

export async function saveSessions(sessions, activeSessionId) {
  const kept = (sessions || []).filter(
    (session) => (session.messages?.length || 0) > 0 || session.id === activeSessionId,
  );
  const list = kept.length > 0 ? kept : [newSession()];
  await chrome.storage.local.set({
    sessions: slimSessions(list),
    activeSessionId,
  });
}
