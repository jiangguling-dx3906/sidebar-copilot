#!/usr/bin/env node
/**
 * Local read-only bridge between the Sidebar Copilot extension and the
 * DeepSeek Harness desktop app.
 *
 * It mints the same signed cookie the browser uses (from the local DSH
 * credential store), calls DSH's loopback session API, and decodes session
 * logs to return full transcripts. It never writes to DSH.
 *
 * Usage:
 *   node scripts/dsh-bridge.mjs [--port 8765] [--dsh http://127.0.0.1:56508]
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

import { extractTranscript, titleOf } from '../lib/dsh-transcript.js';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const PORT = Number(arg('port', 8765));
const DSH_URL = arg('dsh', 'http://127.0.0.1:56508').replace(/\/+$/, '');
const HOME = arg('home', homedir());
const DSH_HOME = path.join(HOME, '.dsh');
const CREDENTIALS = path.join(DSH_HOME, '.credentials.yaml');
const SESSIONS_ROOT = path.join(DSH_HOME, 'sessions');
const AUTHORITY = new URL(DSH_URL).host;

function readSecret() {
  const text = readFileSync(CREDENTIALS, 'utf8');
  const section = text.split('client-connection/browser-session:')[1] || '';
  const match = /secret:\s*([A-Za-z0-9_-]+)/.exec(section);
  if (!match) throw new Error('DSH browser-session credential not found');
  return Buffer.from(match[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function cookie() {
  const secret = readSecret();
  const now = Date.now();
  const payload = { version: 1, authority: AUTHORITY, issuedAt: now, expiresAt: now + 3600_000 };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  const name = `dsh-auth-${createHash('sha256').update(AUTHORITY).digest('base64url')}`;
  return `${name}=v1.${body}.${signature}`;
}

async function rpc(method, args) {
  const response = await fetch(`${DSH_URL}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookie() },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: randomUUID(),
      method,
      payload: { args },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`DSH ${method} returned HTTP ${response.status}`);
  const json = await response.json();
  if (!json?.result?.ok) {
    throw new Error(json?.result?.error?.message || `DSH ${method} failed`);
  }
  return json.result.value;
}

async function listSessions() {
  const value = await rpc('session/list', { _request: {} });
  return (value.items || [])
    .filter((item) => !item.blank)
    .map((item) => {
      const values = item.projections?.values || {};
      const outline = Array.isArray(values.turnOutline) ? values.turnOutline : [];
      return {
        id: item.sessionId,
        title: values.title || outline[0]?.prompt?.slice(0, 60) || 'DeepSeek Harness session',
        updatedAt: item.updatedAt,
        running: Boolean(item.running),
        cwd: item.cwd,
        turns: outline.length,
        preview: outline.at(-1)?.response || outline.at(-1)?.prompt || '',
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function findSessionLog(sessionId) {
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) return null;
  if (!existsSync(SESSIONS_ROOT)) return null;
  for (const workspace of readdirSync(SESSIONS_ROOT)) {
    const dir = path.join(SESSIONS_ROOT, workspace, sessionId);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (/^session\.v\d+\.jsonl\.zstd$/.test(name)) return path.join(dir, name);
    }
  }
  return null;
}

function decodeEvents(file) {
  const size = statSync(file).size;
  if (size > 200 * 1024 * 1024) throw new Error('session log is too large to read');
  const buffer = readFileSync(file);
  const offsets = [];
  for (let i = 0; i + 4 <= buffer.length; i += 1) {
    if (buffer[i] === 0x28 && buffer[i + 1] === 0xb5 && buffer[i + 2] === 0x2f && buffer[i + 3] === 0xfd) {
      offsets.push(i);
    }
  }
  let text = '';
  for (let i = 0; i < offsets.length; i += 1) {
    const end = i + 1 < offsets.length ? offsets[i + 1] : buffer.length;
    try {
      text += zstdDecompressSync(buffer.subarray(offsets[i], end)).toString('utf8');
    } catch {
      /* skip a frame that is still being appended */
    }
  }
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* ignore a partially written line */
    }
  }
  return events;
}

const cache = new Map();

function readTranscript(sessionId) {
  const file = findSessionLog(sessionId);
  if (!file) throw new Error('session log not found');
  const mtime = statSync(file).mtimeMs;
  const cached = cache.get(sessionId);
  if (cached && cached.mtime === mtime) return cached.value;
  const events = decodeEvents(file);
  const messages = extractTranscript(events);
  const value = {
    id: sessionId,
    title: titleOf(events),
    messages,
    updatedAt: mtime,
  };
  cache.set(sessionId, { mtime, value });
  return value;
}

function corsHeaders(request) {
  const origin = String(request.headers.origin || '');
  const headers = {
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  };
  // Only extension pages may read DSH conversations from a browser context.
  if (origin.startsWith('chrome-extension://')) {
    headers['access-control-allow-origin'] = origin;
  }
  return headers;
}

function send(request, response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...corsHeaders(request),
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders(request));
    response.end();
    return;
  }

  const url = new URL(request.url || '/', `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname === '/health') {
      const sessions = await listSessions();
      send(request, response, 200, { ok: true, dsh: DSH_URL, sessions: sessions.length });
      return;
    }

    if (url.pathname === '/sessions') {
      send(request, response, 200, { ok: true, sessions: await listSessions() });
      return;
    }

    const match = /^\/sessions\/([^/]+)$/.exec(url.pathname);
    if (match) {
      send(request, response, 200, { ok: true, session: readTranscript(decodeURIComponent(match[1])) });
      return;
    }

    send(request, response, 404, { ok: false, error: 'not found' });
  } catch (error) {
    send(request, response, 502, { ok: false, error: String(error?.message || error) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Sidebar Copilot ↔ DeepSeek Harness bridge`);
  console.log(`  bridge : http://127.0.0.1:${PORT}`);
  console.log(`  dsh    : ${DSH_URL}`);
  console.log(`  home   : ${DSH_HOME}`);
  console.log('  read-only; no data leaves this machine.');
});
