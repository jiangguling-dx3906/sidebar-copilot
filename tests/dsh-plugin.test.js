import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEvents } from '../dsh-plugin/sidebar-sync.mjs';

test('builds a complete turn from a user/assistant pair', () => {
  const events = buildEvents(
    [
      { role: 'user', text: 'Hello' },
      { role: 'assistant', text: 'Hi there' },
    ],
    1000,
  );

  assert.deepEqual(
    events.map((event) => event.type),
    ['agent/inbox/spliced', 'turn/start', 'step/start', 'assistant/message', 'step/end', 'turn/end'],
  );
  assert.deepEqual(
    events.map((event) => event.seq),
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(events[0].data.inserted[0].content[0].text, 'Hello');
  assert.equal(events[3].data.message.content[0].text, 'Hi there');
  assert.equal(events[3].data.message.role, 'assistant');
  assert.equal(events[5].data.reason.kind, 'completed');
});

test('builds one turn per user/assistant pair', () => {
  const events = buildEvents(
    [
      { role: 'user', text: 'one' },
      { role: 'assistant', text: 'two' },
      { role: 'user', text: 'three' },
      { role: 'assistant', text: 'four' },
    ],
    0,
  );
  const turns = events.filter((event) => event.type === 'turn/start').map((event) => event.data.turn);
  assert.deepEqual(turns, [1, 2]);
  assert.equal(events.filter((event) => event.type === 'turn/end').length, 2);
});

test('ignores empty and unsupported messages', () => {
  const events = buildEvents(
    [
      { role: 'user', text: '   ' },
      { role: 'system', text: 'ignored' },
      { role: 'assistant', text: 'orphan' },
    ],
    0,
  );
  assert.equal(events.length, 0);
});

test('closes an unanswered user turn', () => {
  const events = buildEvents([{ role: 'user', text: 'only question' }], 0);
  assert.equal(events.at(-1).type, 'turn/end');
  assert.equal(events.at(-1).data.turn, 1);
});
