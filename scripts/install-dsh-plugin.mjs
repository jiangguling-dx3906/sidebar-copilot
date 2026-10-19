#!/usr/bin/env node
/**
 * Install or remove the Sidebar Copilot DSH host plugin for a desktop profile.
 *
 * The plugin is copied into the profile and loaded by relative URL, so the
 * profile patch is the only config change. The patch is backed up first.
 *
 * Usage:
 *   node scripts/install-dsh-plugin.mjs
 *   node scripts/install-dsh-plugin.mjs --uninstall
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

const START = '# sidebar-sync:start';
const END = '# sidebar-sync:end';
const args = process.argv.slice(2);
const uninstall = args.includes('--uninstall');

function arg(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const profile = path.resolve(arg('profile', path.join(homedir(), '.dsh', 'profiles', 'desktop')));
const patchFile = path.join(profile, 'cordis.patch.yml');
const plugin = path.resolve(arg('plugin', path.join(process.cwd(), 'dsh-plugin', 'sidebar-sync.mjs')));
const backupFile = path.join(profile, 'cordis.patch.yml.sidebar-sync.bak');

function installedPlugins() {
  return readdirSync(profile)
    .filter((name) => /^sidebar-sync.*\.plugin\.mjs$/.test(name))
    .map((name) => path.join(profile, name));
}

if (!existsSync(patchFile)) {
  console.error(`profile patch not found: ${patchFile}`);
  process.exit(1);
}

const current = readFileSync(patchFile, 'utf8');
const hasBlock = current.includes(START);

if (uninstall) {
  if (!hasBlock && installedPlugins().length === 0) {
    console.log('Sidebar Copilot plugin is not installed in this profile.');
    process.exit(0);
  }
  const cleaned = current.replace(
    new RegExp(`\\n?${START}[\\s\\S]*?${END}\\n?`, 'm'),
    '\n',
  );
  writeFileSync(patchFile, cleaned);
  for (const file of installedPlugins()) rmSync(file);
  console.log(`Removed the plugin entry from ${patchFile}`);
  console.log(`Original patch backup: ${backupFile}`);
  console.log('Restart DeepSeek Harness to unload it.');
  process.exit(0);
}

if (!existsSync(plugin)) {
  console.error(`plugin file not found: ${plugin}`);
  process.exit(1);
}

if (!existsSync(backupFile)) copyFileSync(patchFile, backupFile);

// A content-addressed filename lets HMR import a fresh module instead of
// reusing the cached old one; stale copies are removed.
const source = readFileSync(plugin);
const hash = createHash('sha256').update(source).digest('hex').slice(0, 8);
const fileName = `sidebar-sync.${hash}.plugin.mjs`;
const installedPlugin = path.join(profile, fileName);
for (const file of installedPlugins()) {
  if (file !== installedPlugin) rmSync(file);
}
copyFileSync(plugin, installedPlugin);

const block = [
  START,
  '- insert:',
  '    - id: sidebar-sync',
  `      name: "./${fileName}"`,
  END,
].join('\n');

const next = hasBlock
  ? current.replace(new RegExp(`\\n?${START}[\\s\\S]*?${END}\\n?`, 'm'), `\n${block}\n`)
  : `${current.replace(/\s*$/, '')}\n\n${block}\n`;

writeFileSync(patchFile, next);
console.log('Sidebar Copilot DSH plugin installed.');
console.log(`  patch : ${patchFile}`);
console.log(`  plugin: ${installedPlugin}`);
console.log(`  backup: ${backupFile}`);
console.log('');
console.log('With HMR enabled the profile recomposes immediately; otherwise restart DeepSeek Harness.');
console.log('Then use “→ DSH” in the side panel history.');
console.log('To undo: node scripts/install-dsh-plugin.mjs --uninstall');
