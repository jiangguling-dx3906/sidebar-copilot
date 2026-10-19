import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPanelTheme, isDarkColor, mixHex, normalizeHex } from '../lib/theme.js';

test('normalizes hex colors and rejects invalid input', () => {
  assert.equal(normalizeHex('#FFF'), '#ffffff');
  assert.equal(normalizeHex(' #1A2B3C '), '#1a2b3c');
  assert.equal(normalizeHex('red'), null);
  assert.equal(normalizeHex(''), null);
});

test('mixes colors proportionally', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixHex('#ffffff', '#000000', 0), '#ffffff');
});

test('detects dark backgrounds', () => {
  assert.equal(isDarkColor('#0f1115'), true);
  assert.equal(isDarkColor('#ffffff'), false);
  assert.equal(isDarkColor('#f6f7fb'), false);
});

test('builds a readable palette for light and dark backgrounds', () => {
  const light = buildPanelTheme('#fdf6e3');
  assert.equal(light['--bg'], '#fdf6e3');
  assert.equal(light['--text'], '#171a21');

  const dark = buildPanelTheme('#101820');
  assert.equal(dark['--bg'], '#101820');
  assert.equal(dark['--text'], '#eef0f6');
  assert.ok(dark['--border']);

  assert.equal(buildPanelTheme(''), null);
  assert.equal(buildPanelTheme('not-a-color'), null);
});
