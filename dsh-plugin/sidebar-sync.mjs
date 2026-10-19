/**
 * DSH host plugin: import a Sidebar Copilot transcript as a real DSH session.
 *
 * Loaded from the desktop profile patch; no dependencies. It registers
 * POST /sidebar-sync/import on the existing loopback web server and builds the
 * session through the public Session store API (ctx.sessions.create + seed),
 * so DSH owns persistence, projections, and the session list entry.
 */

export const name = 'sidebar-sync';
export const inject = ['webServer', 'sessions'];

const MAX_BODY = 8 * 1024 * 1024;

function corsHeaders(request) {
  const origin = String(request.headers.origin || '');
  const headers = {
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  };
  if (origin.startsWith('chrome-extension://')) {
    headers['access-control-allow-origin'] = origin;
  }
  return headers;
}

function reply(request, response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...corsHeaders(request),
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('request body is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function textMessage(text) {
  return [{ type: 'text', text: String(text) }];
}

export function buildEvents(messages, now) {
  const events = [];
  let seq = 0;
  let turn = 0;
  let open = false;

  const push = (type, data) => {
    events.push({ type, seq, time: now + seq, data });
    seq += 1;
  };

  for (const message of messages) {
    if (!message || typeof message.text !== 'string' || !message.text.trim()) continue;
    if (message.role === 'user') {
      if (open) {
        push('turn/end', { turn, reason: { kind: 'aborted', reason: { kind: 'user' } } });
      }
      turn += 1;
      push('agent/inbox/spliced', {
        target: 'next-turn',
        start: 0,
        inserted: [
          {
            role: 'user',
            content: textMessage(message.text),
            source: { kind: 'user' },
            id: crypto.randomUUID(),
          },
        ],
      });
      push('turn/start', { turn });
      push('step/start', { turn, step: 1 });
      open = true;
      continue;
    }

    if (message.role === 'assistant' && open) {
      push('assistant/message', {
        turn,
        step: 1,
        message: {
          role: 'assistant',
          content: textMessage(message.text),
          source: {
            kind: 'model',
            provider: 'deepseek-account',
            model: 'deepseek-flash',
          },
          id: crypto.randomUUID(),
        },
      });
      push('step/end', { turn, step: 1 });
      push('turn/end', { turn, reason: { kind: 'completed' } });
      open = false;
    }
  }

  if (open) push('turn/end', { turn, reason: { kind: 'completed' } });
  return events;
}

export function apply(ctx) {
  const handler = async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders(request));
      response.end();
      return;
    }
    if (request.method !== 'POST') {
      reply(request, response, 405, { ok: false, error: 'POST required' });
      return;
    }

    try {
      const payload = await readJson(request);
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      if (messages.length === 0) {
        reply(request, response, 400, { ok: false, error: 'messages must not be empty' });
        return;
      }

      const sessionId = `session-${crypto.randomUUID()}`;
      const now = Date.now();
      const events = buildEvents(messages, now);
      const session = ctx.sessions.create(sessionId, {
        seed: events,
        meta: {
          cwd: typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : undefined,
          createdAt: now,
          agentPreset: 'standard',
        },
      });

      reply(request, response, 200, {
        ok: true,
        sessionId: session.id,
        events: events.length,
      });
    } catch (error) {
      reply(request, response, 500, {
        ok: false,
        error: String(error?.message || error),
      });
    }
  };

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/sidebar-sync/import',
        handler,
      }),
    'sidebar-sync: import route',
  );
}
