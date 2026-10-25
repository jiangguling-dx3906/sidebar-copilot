import test from 'node:test';
import assert from 'node:assert/strict';

import { assertSafeInput, compactAXTree, modifierMask } from '../lib/cdp.js';

test('maps CDP modifier names to protocol bits', () => {
  assert.equal(modifierMask([]), 0);
  assert.equal(modifierMask(['Control']), 2);
  assert.equal(modifierMask(['Control', 'Shift']), 10);
  assert.equal(modifierMask(['Alt', 'Meta']), 5);
});

test('compacts the accessibility tree and keeps backend ids', () => {
  const nodes = compactAXTree([
    { ignored: true, role: { value: 'button' }, name: { value: 'Hidden' } },
    { role: { value: 'button' }, name: { value: 'Save' }, backendDOMNodeId: 42, frameId: 'f1' },
    { role: { value: 'textbox' }, name: { value: '' }, value: { value: 'Alice' }, backendDOMNodeId: 43 },
  ]);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].backend_node_id, 42);
  assert.equal(nodes[0].role, 'button');
  assert.equal(nodes[1].value, 'Alice');
});

test('refuses CDP input into sensitive fields', () => {
  assert.throws(() => assertSafeInput({ type: 'password' }), /password/);
  assert.throws(() => assertSafeInput({ name: 'otp' }), /OTP|token|secret|card/);
  assert.doesNotThrow(() => assertSafeInput({ name: 'name', type: 'text' }));
});
