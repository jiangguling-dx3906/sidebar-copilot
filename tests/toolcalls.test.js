import test from 'node:test';
import assert from 'node:assert/strict';

import { createToolCallAccumulator, parseToolArguments } from '../lib/toolcalls.js';

test('accumulates name and arguments split across chunks', () => {
  const acc = createToolCallAccumulator();
  acc.push([{ index: 0, id: 'call_1', type: 'function', function: { name: 'click', arguments: '' } }]);
  acc.push([{ index: 0, function: { arguments: '{"select' } }]);
  acc.push([{ index: 0, function: { arguments: 'or":"#go"}' } }]);

  const calls = acc.finish();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'call_1');
  assert.equal(calls[0].function.name, 'click');
  assert.equal(calls[0].function.arguments, '{"selector":"#go"}');
});

test('keeps parallel calls apart by index', () => {
  const acc = createToolCallAccumulator();
  acc.push([
    { index: 0, id: 'a', function: { name: 'read_page', arguments: '{}' } },
    { index: 1, id: 'b', function: { name: 'click', arguments: '{"text":"登录"}' } },
  ]);
  const calls = acc.finish();
  assert.deepEqual(
    calls.map((call) => call.function.name),
    ['read_page', 'click'],
  );
  assert.equal(calls[1].id, 'b');
});

test('tolerates sparse indices', () => {
  const acc = createToolCallAccumulator();
  acc.push([{ index: 2, id: 'late', function: { name: 'scroll_page', arguments: '{}' } }]);
  const calls = acc.finish();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'late');
});

test('generates an id when the provider omits it', () => {
  const acc = createToolCallAccumulator();
  acc.push([{ index: 0, function: { name: 'read_page', arguments: '{}' } }]);
  assert.match(acc.finish()[0].id, /^call_0_/);
});

test('parses arguments and rejects malformed JSON', () => {
  assert.deepEqual(parseToolArguments('{"a":1}'), { a: 1 });
  assert.deepEqual(parseToolArguments(''), {});
  assert.equal(parseToolArguments('{oops'), null);
  assert.equal(parseToolArguments('[1,2]'), null);
});
