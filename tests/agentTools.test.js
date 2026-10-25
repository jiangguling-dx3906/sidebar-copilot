import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PAGE_TOOLS,
  describeAction,
  isRiskyAction,
  actionStatusLabel,
} from '../lib/agentTools.js';

test('exposes the page tools with JSON schemas', () => {
  const names = PAGE_TOOLS.map((tool) => tool.function.name);
  for (const name of [
    'inspect_page',
    'click',
    'type_text',
    'select_option',
    'press_key',
    'scroll_page',
    'open_url',
    'read_page',
    'wait_for',
    'control_media',
    'drag',
    'set_range',
    'hover',
    'double_click',
    'right_click',
    'focus',
    'clear',
    'check',
    'uncheck',
    'select_text',
    'get_element_info',
    'scroll_inside',
    'tab_control',
    'skill',
  ]) {
    assert.ok(names.includes(name), name);
  }
  for (const tool of PAGE_TOOLS) {
    assert.equal(tool.type, 'function');
    assert.equal(tool.function.parameters.type, 'object');
    assert.equal(typeof tool.function.description, 'string');
  }
  const media = PAGE_TOOLS.find((tool) => tool.function.name === 'control_media');
  assert.ok(media.function.parameters.properties.action.enum.includes('seek'));
});

test('risky actions are detected by visible text', () => {
  assert.equal(isRiskyAction('click', { text: '立即支付' }), true);
  assert.equal(isRiskyAction('click', { text: '删除全部' }), true);
  assert.equal(isRiskyAction('select_option', { option: '确认' }), true);
  assert.equal(isRiskyAction('press_key', { key: 'Enter' }), true);
  assert.equal(isRiskyAction('press_key', { key: 'a', modifiers: ['Control'] }), true);
  assert.equal(isRiskyAction('tab_control', { action: 'close', tab_id: 3 }), true);
  assert.equal(isRiskyAction('click', { text: '登录' }), false);
  assert.equal(isRiskyAction('open_url', { url: 'https://example.com/delete' }), false);
  assert.equal(isRiskyAction('scroll_page', { direction: 'down' }), false);
});

test('describes actions for the transcript', () => {
  assert.equal(describeAction('click', { text: '登录' }), '点击 “登录”');
  assert.equal(describeAction('click', { selector: '#go' }), '点击 #go');
  assert.equal(
    describeAction('type_text', { selector: '#name', text: '小明' }),
    '在 #name 输入 “小明”',
  );
  assert.equal(describeAction('open_url', { url: 'https://example.com' }), '打开 https://example.com');
  assert.equal(describeAction('read_page', {}), '读取页面正文');
  assert.equal(describeAction('control_media', { action: 'seek', percent: 50 }), '跳转进度到 50%');
  assert.equal(describeAction('control_media', { action: 'seek_by', seconds: 30 }), '快进 30 秒');
  assert.equal(describeAction('set_range', { selector: '#vol', percent: 80 }), '把 #vol 设为 80%');
  assert.equal(describeAction('drag', { from: { selector: '#bar' }, dx: 120 }), '拖拽 #bar → 右移 120px');
  assert.equal(describeAction('hover', { text: '更多' }), '悬停 “更多”');
  assert.equal(describeAction('check', { selector: '#agree' }), '勾选 #agree');
  assert.equal(describeAction('tab_control', { action: 'back' }), '后退');
  assert.equal(describeAction('skill', { name: 'form' }), '加载技能 form');
});

test('status labels cover every state', () => {
  assert.equal(actionStatusLabel('ok'), '完成');
  assert.equal(actionStatusLabel('error'), '失败');
  assert.equal(actionStatusLabel('skipped'), '已跳过');
  assert.equal(actionStatusLabel('uncertain'), '待确认');
  assert.equal(actionStatusLabel('running'), '执行中');
  assert.equal(actionStatusLabel('unknown'), '');
});
