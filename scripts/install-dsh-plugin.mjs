#!/usr/bin/env node
/**
 * Install or remove the Sidebar Copilot DSH host plugin for a desktop profile.
 *
 * The plugin is loaded by file URL from this repository, so nothing is copied
 * into the app. The profile patch is backed up first.
 *
 * Usage:
 *   node scripts/install-dsh-plugin.mjs
 *   node scripts/install-dsh-plugin.mjs --uninstall
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

if (!existsSync(patchFile)) {
  console.error(`profile patch not found: ${patchFile}`);
  process.exit(1);
}

const current = readFileSync(patchFile, 'utf8');
const hasBlock = current.includes(START);

if (uninstall) {
  if (!hasBlock) {
    console.log('Sidebar Copilot plugin is not installed in this profile.');
    process.exit(0);
  }
  const cleaned = current.replace(
    new RegExp(`\\n?${START}[\\s\\S]*?${END}\\n?`, 'm'),
    '\n',
  );
  writeFileSync(patchFile, cleaned);
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
const href = pathToFileURL(plugin).href;
const block = [
  START,
  '- id: sidebar-sync',
  `  name: "${href}"`,
  END,
].join('\n');

const next = hasBlock
  ? current.replace(new RegExp(`\\n?${START}[\\s\\S]*?${END}\\n?`, 'm'), `\n${block}\n`)
  : `${current.replace(/\s*$/, '')}\n\n${block}\n`;

writeFileSync(patchFile, next);
console.log('Sidebar Copilot DSH plugin installed.');
console.log(`  patch : ${patchFile}`);
console.log(`  backup: ${backupFile}`);
console.log(`  plugin: ${href}`);
console.log('');
console.log('Close DeepSeek Harness completely, then start it again.');
console.log('After restart, use “Sync to desktop” in the side panel history.');
console.log('To undo: node scripts/install-dsh-plugin.mjs --uninstall');
