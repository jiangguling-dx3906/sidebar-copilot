import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSkillsPrompt, getSkill, skillLabel, skillNames } from '../lib/skills.js';

test('exposes the built-in skill playbooks', () => {
  const names = skillNames();
  for (const name of ['form', 'media', 'extract', 'navigate', 'verify', 'inspect']) {
    assert.ok(names.includes(name), name);
    const skill = getSkill(name);
    assert.ok(skill.steps.zh.length > 0);
    assert.ok(skill.steps.en.length > 0);
  }
  assert.equal(getSkill('missing'), null);
});

test('labels skills in both languages', () => {
  assert.equal(skillLabel('form', 'zh'), '填写表单');
  assert.equal(skillLabel('form', 'en'), 'Fill a form');
});

test('renders a compact skills prompt', () => {
  const zh = buildSkillsPrompt('zh');
  assert.ok(zh.includes('## 技能'));
  assert.ok(zh.includes('`form`'));
  const en = buildSkillsPrompt('en');
  assert.ok(en.includes('## Skills'));
  assert.ok(en.includes('`media`'));
});
