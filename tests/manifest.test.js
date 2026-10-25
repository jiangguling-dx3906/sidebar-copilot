import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('is a valid MV3 extension manifest', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(typeof manifest.name, 'string');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.background.type, 'module');
});

test('declares the permissions the side panel relies on', () => {
  for (const permission of ['sidePanel', 'storage', 'scripting', 'tabs', 'contextMenus', 'clipboardWrite', 'debugger']) {
    assert.ok(manifest.permissions.includes(permission), permission);
  }
  assert.deepEqual(manifest.host_permissions, ['<all_urls>']);
});

test('every referenced file exists', () => {
  const files = [
    manifest.background.service_worker,
    manifest.side_panel.default_path,
    manifest.options_page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
  ];
  for (const file of files) {
    assert.ok(existsSync(path.join(root, file)), `missing ${file}`);
  }
});

test('the panel page loads its module and stylesheet', () => {
  const html = readFileSync(path.join(root, manifest.side_panel.default_path), 'utf8');
  assert.ok(html.includes('src="panel.js"'));
  assert.ok(html.includes('href="panel.css"'));
  assert.ok(!/onclick=/i.test(html), 'no inline event handlers (MV3 CSP)');
});
