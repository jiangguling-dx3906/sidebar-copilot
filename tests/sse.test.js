import test from 'node:test';
import assert from 'node:assert/strict';

import { createSSEParser } from '../lib/sse.js';

function collect() {
  const events = [];
  const parser = createSSEParser((event) => events.push(event));
  return { events, parser };
}

test('parses events split across chunk boundaries', () => {
  const { events, parser } = collect();
  parser.push('data: {"choices":[{"delta":{"content":"你');
  parser.push('好"}}]}\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].data.choices[0].delta.content, '你好');
});

test('parses several events in one chunk', () => {
  const { events, parser } = collect();
  parser.push(
    'data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"choices":[{"delta":{"content":"b"}}]}\n\n',
  );
  assert.deepEqual(
    events.map((event) => event.data.choices[0].delta.content),
    ['a', 'b'],
  );
});

test('signals [DONE]', () => {
  const { events, parser } = collect();
  parser.push('data: [DONE]\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].done, true);
});

test('handles CRLF framing', () => {
  const { events, parser } = collect();
  parser.push('data: {"ok":true}\r\n\r\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].data.ok, true);
});

test('ignores comments and keeps non-JSON payloads visible as raw', () => {
  const { events, parser } = collect();
  parser.push(': keep-alive\n\n');
  parser.push('data: not-json\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].raw, 'not-json');
});

test('flush emits a trailing event without a blank line', () => {
  const { events, parser } = collect();
  parser.push('data: {"ok":1}');
  parser.flush();
  assert.equal(events.length, 1);
  assert.equal(events[0].data.ok, 1);
});
