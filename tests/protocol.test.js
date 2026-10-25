import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyResult, makeRequestId, makeTarget, sameDocument, sameTab } from '../lib/protocol.js';

test('builds stable target descriptors', () => {
  assert.deepEqual(makeTarget({ tabId: 7, documentId: 'doc-1', url: 'https://example.com' }), {
    tabId: 7,
    frameId: 0,
    documentId: 'doc-1',
    url: 'https://example.com',
  });
  assert.equal(sameTab({ tabId: 7 }, { tabId: 7 }), true);
  assert.equal(sameTab({ tabId: 7 }, { tabId: 8 }), false);
  assert.equal(sameDocument({ documentId: 'a' }, { documentId: 'a' }), true);
  assert.equal(sameDocument({ documentId: 'a' }, { documentId: 'b' }), false);
});

test('classifies verified, uncertain, and failed actions', () => {
  assert.equal(classifyResult({ ok: true, verified: true }).status, 'ok');
  assert.equal(classifyResult({ ok: true, verified: false }).status, 'uncertain');
  assert.equal(classifyResult({ ok: true }, { documentChanged: true }).status, 'uncertain');
  assert.equal(classifyResult({ ok: false, error: 'nope' }).status, 'error');
});

test('request ids are unique and prefixed', () => {
  const first = makeRequestId('act');
  const second = makeRequestId('act');
  assert.ok(first.startsWith('act-'));
  assert.notEqual(first, second);
});
