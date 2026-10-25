import test from 'node:test';
import assert from 'node:assert/strict';

import { supportsVision } from '../lib/vision.js';

test('detects image-capable model families', () => {
  assert.equal(supportsVision('deepseek-flash'), true);
  assert.equal(supportsVision('deepseek-v4-flash-vision-exp'), true);
  assert.equal(supportsVision('gpt-4o-mini'), true);
  assert.equal(supportsVision('gemini-2.5-pro'), true);
  assert.equal(supportsVision('qwen2.5-vl-7b'), true);
});

test('keeps text-only and unknown models text-only', () => {
  assert.equal(supportsVision('deepseek-chat'), false);
  assert.equal(supportsVision('deepseek-reasoner'), false);
  assert.equal(supportsVision(''), false);
  assert.equal(supportsVision('my-local-chat'), false);
});
