import test from 'node:test';
import assert from 'node:assert/strict';

import { extractTranscript, titleOf } from '../lib/dsh-transcript.js';

const events = [
  {
    type: 'agent/inbox/spliced',
    time: 1,
    data: {
      target: 'next-step',
      inserted: [{ role: 'user', content: [{ type: 'text', text: 'approval note' }], source: { kind: 'user-approval' } }],
    },
  },
  {
    type: 'agent/inbox/spliced',
    time: 2,
    data: {
      target: 'next-turn',
      inserted: [
        {
          role: 'user',
          content: [{ type: 'text', text: '  Read this page  ' }],
          source: { kind: 'user' },
        },
      ],
    },
  },
  {
    type: 'assistant/message',
    time: 3,
    data: {
      message: {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'hidden' },
          { type: 'text', text: 'The page says hello.' },
          { type: 'tool-call', name: 'pwsh' },
        ],
      },
    },
  },
  {
    type: 'assistant/message',
    time: 4,
    data: { message: { role: 'assistant', content: [{ type: 'tool-call', name: 'pwsh' }] } },
  },
];

test('extracts real user turns and assistant text only', () => {
  const messages = extractTranscript(events);
  assert.deepEqual(
    messages.map((message) => message.role),
    ['user', 'assistant'],
  );
  assert.equal(messages[0].text, '  Read this page  ');
  assert.equal(messages[1].text, 'The page says hello.');
});

test('ignores injected approval notes and tool-only assistant steps', () => {
  const messages = extractTranscript(events);
  assert.ok(!messages.some((message) => message.text.includes('approval note')));
  assert.equal(messages.length, 2);
});

test('derives a title from the first user message', () => {
  assert.equal(titleOf(events), 'Read this page');
  assert.equal(titleOf([], 'Fallback'), 'Fallback');
});
