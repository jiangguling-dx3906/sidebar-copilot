import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS } from '../lib/settings.js';

test('defaults to a long task with a safety cap', () => {
  assert.equal(DEFAULT_SETTINGS.maxAgentSteps, 100);
  assert.equal(DEFAULT_SETTINGS.allowPageActions, true);
  assert.equal(DEFAULT_SETTINGS.model, 'deepseek-flash');
  assert.equal(DEFAULT_SETTINGS.sendScreenshot, true);
});
