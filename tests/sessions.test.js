import test from 'node:test';
import assert from 'node:assert/strict';

import { newSession, sessionTitle, slimMessages, slimSessions } from '../lib/sessions.js';

test('creates sessions with unique ids', () => {
  const a = newSession(1000);
  const b = newSession(1000);
  assert.notEqual(a.id, b.id);
  assert.equal(a.messages.length, 0);
});

test('titles a session from the first user message', () => {
  assert.equal(sessionTitle([{ role: 'assistant', content: 'hi' }], 'New'), 'New');
  assert.equal(sessionTitle([{ role: 'user', content: '  Summarize   this page ' }]), 'Summarize this page');
  const long = sessionTitle([{ role: 'user', content: 'x'.repeat(80) }]);
  assert.ok(long.endsWith('…'));
  assert.ok(long.length <= 43);
});

test('drops streaming messages and clips long content', () => {
  const messages = slimMessages([
    { role: 'assistant', content: 'partial', streaming: true },
    { role: 'user', content: 'a'.repeat(30000), ts: 1 },
  ]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  assert.ok(messages[0].content.length <= 20001);
});

test('caps sessions and preserves titles', () => {
  const sessions = Array.from({ length: 60 }, (_, index) => ({
    ...newSession(index),
    title: `t${index}`,
    messages: [],
  }));
  const slim = slimSessions(sessions);
  assert.equal(slim.length, 50);
  assert.equal(slim[0].title, 't0');
});
