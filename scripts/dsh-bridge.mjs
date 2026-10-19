#!/usr/bin/env node
/**
 * Local bridge between the Sidebar Copilot extension and the DeepSeek Harness
 * desktop app.
 *
 * It discovers the DSH loopback port (the desktop picks a new port on every
 * start), mints the same signed cookie the browser uses, calls DSH's session
 * API, and decodes session logs to return full transcripts. The /dsh/import
 * route forwards to the sidebar-sync host plugin, which creates a real session.
 *
 * Usage:
 *   node scripts/dsh-bridge.mjs [--port 8765] [--dsh http://127.0.0.1:55033]
 */
import { execFile } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { zstdDecompressSync } from 'node:zlib';

import { extractTranscript, titleOf } from '../lib/dsh-transcript.js';

const run = promisify(execFile);

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const PORT = Number(arg('port', 8765));
const MANUAL_DSH_URL = String(arg('dsh', '')).replace(/\/+$/, '');
const HOME = arg('home', homedir());
const DSH_HOME = path.join(HOME, '.dsh');
const CREDENTIALS = path.join(DSH_HOME, '.credentials.yaml');
const SESSIONS_ROOT = path.join(DSH_HOME, 'sessions');

let discovered = { url: MANUAL_DSH_URL, at: 0 };

function readSecret() {
  const text = readFileSync(CREDENTIALS, 'utf8');
  const section = text.split('client-connection/browser-session:')[1] || '';
  const match = /secret:\s*([A-Za-z0-9_-]+)/.exec(section);
  if (!match) throw new Error('DSH browser-session credential not found');
  return Buffer.from(match[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function cookieFor(authority) {
  const secret = readSecret();
  const now = Date.now();
  const payload = { version: 1, authority, issuedAt: now, expiresAt: now + 3600_000 };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  const name = `dsh-auth-${createHash('sha256').update(authority).digest('base64url')}`;
  return `${name}=v1.${body}.${signature}`;
}

async function listeningPorts() {
  if (process.platform !== 'win32') return [];
  const script = [
    "$ids = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'DeepSeek|dsh' } | Select-Object -ExpandProperty Id",
    'if (-not $ids) { exit 0 }',
    '$ids | ForEach-Object { Get-NetTCPConnection -OwningProcess $_ -State Listen -ErrorAction SilentlyContinue } |',
    "  Where-Object { $_.LocalAddress -in @('127.0.0.1','0.0.0.0','::','::1') } |",
    '  Select-Object -ExpandProperty LocalPort -Unique',
  ].join('\n');
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command', script], {
      windowsHide: true,
      timeout: 5000,
      encoding: 'utf8',
    });
    return [...new Set(String(stdout).split(/\s+/).map(Number).filter((port) => port > 0))];
  } catch {
    return [];
  }
}

async function probe(base) {
  try {
    const authority = new URL(base).host;
    const response = await fetch(`${base}/api/session/list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieFor(authority) },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: randomUUID(),
        method: 'session/list',
        payload: { args: { _request: {} } },
      }),
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return false;
    const json = await response.json();
    return Boolean(json?.result?.ok);
  } catch {
    return false;
  }
}

async function discoverDshUrl(force = false) {
  if (MANUAL_DSH_URL) return MANUAL_DSH_URL;
  if (!force && discovered.url && Date.now() - discovered.at < 15_000) return discovered.url;

  const ports = await listeningPorts();
  for (const port of ports) {
    const base = `http://127.0.0.1:${port}`;
    if (await probe(base)) {
      discovered = { url: base, at: Date.now() };
      return base;
    }
  }

  throw new Error(
    'DSH web port not found. Is DeepSeek Harness running? Pass --dsh http://127.0.0.1:<port> if discovery fails.',
  );
}

async function rpcAt(base, method, args) {
  const authority = new URL(base).host;
  const response = await fetch(`${base}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieFor(authority) },
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

async function rpc(method, args) {
  let base = await discoverDshUrl();
  try {
    return await rpcAt(base, method, args);
  } catch (error) {
    // The desktop may have restarted on a new port; rediscover once.
    if (MANUAL_DSH_URL) throw error;
    discovered = { url: '', at: 0 };
    base = await discoverDshUrl(true);
    return rpcAt(base, method, args);
  }
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
    'access-control-allow-methods': 'GET, POST, OPTIONS',
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

async function readJson(request, limit = 8 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('request body is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function validOverride(value) {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

async function importToDsh(body) {
  const override = validOverride(body.dshUrl);
  const base = override || (await discoverDshUrl());
  const authority = new URL(base).host;
  let cwd = typeof body.cwd === 'string' && path.isAbsolute(body.cwd) ? body.cwd : '';
  if (!cwd) {
    try {
      const sessions = await listSessions();
      cwd = sessions.find((session) => session.cwd)?.cwd || '';
    } catch {
      /* fall through to the process directory */
    }
  }
  if (!cwd) cwd = process.cwd();

  const response = await fetch(`${base}/sidebar-sync/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieFor(authority) },
    body: JSON.stringify({ title: body.title, messages: body.messages, cwd }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      response.status === 404
        ? 'sidebar-sync plugin is not loaded; install it and restart DSH'
        : `DSH returned HTTP ${response.status}`,
    );
  }
  return { status: response.status, json };
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
      const base = await discoverDshUrl();
      const sessions = await listSessions();
      send(request, response, 200, { ok: true, dsh: base, sessions: sessions.length });
      return;
    }

    if (url.pathname === '/sessions') {
      send(request, response, 200, { ok: true, sessions: await listSessions() });
      return;
    }

    if (url.pathname === '/dsh/import' && request.method === 'POST') {
      const body = await readJson(request);
      const result = await importToDsh(body);
      send(request, response, result.status, result.json);
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
  console.log('Sidebar Copilot ↔ DeepSeek Harness bridge');
  console.log(`  bridge : http://127.0.0.1:${PORT}`);
  console.log(`  dsh    : ${MANUAL_DSH_URL || 'auto-discover'}`);
  console.log(`  home   : ${DSH_HOME}`);
  console.log('  read-only list + plugin import; no data leaves this machine.');
});
