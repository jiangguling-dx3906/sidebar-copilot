import test from 'node:test';
import assert from 'node:assert/strict';

import { getLocale, normalizeLocale, setLocale, t } from '../lib/i18n.js';

test('defaults to Chinese and translates keys', () => {
  setLocale('zh');
  assert.equal(getLocale(), 'zh');
  assert.equal(t('common.save'), '保存');
  assert.equal(t('panel.statusChars', { count: 445 }), '445 字');
});

test('switches to English', () => {
  setLocale('en');
  assert.equal(getLocale(), 'en');
  assert.equal(t('common.save'), 'Save');
  assert.equal(t('panel.statusChars', { count: 445 }), '445 chars');
  assert.equal(t('panel.selectionChip', { count: 12 }), 'Selected text · 12 chars');
});

test('normalizes explicit locales and falls back for unknown values', () => {
  assert.equal(normalizeLocale('zh'), 'zh');
  assert.equal(normalizeLocale('en'), 'en');
  assert.ok(['zh', 'en'].includes(normalizeLocale('auto')));
  assert.ok(['zh', 'en'].includes(normalizeLocale('fr')));
});

test('returns the key when a translation is missing and interpolates placeholders', () => {
  setLocale('en');
  assert.equal(t('missing.key'), 'missing.key');
  assert.equal(t('panel.maxRounds', { n: 6 }), '(Reached the 6-step limit. Send another message to continue.)');
  setLocale('zh');
});
