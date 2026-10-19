import test from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdown, escapeHtml } from '../lib/markdown.js';

test('escapes raw HTML instead of rendering it', () => {
  const html = renderMarkdown('<img src=x onerror="alert(1)">');
  assert.ok(!html.includes('<img'), html);
  assert.ok(html.includes('&lt;img'), html);
});

test('keeps script tags inside code blocks inert', () => {
  const html = renderMarkdown('```html\n<script>alert(1)</script>\n```');
  assert.ok(!html.includes('<script>'), html);
  assert.ok(html.includes('&lt;script&gt;'), html);
});

test('renders headings, bold, italic and inline code', () => {
  const html = renderMarkdown('## 标题\n\n这是 **粗体**、*斜体* 和 `a<b`。');
  assert.ok(html.includes('<h2>标题</h2>'), html);
  assert.ok(html.includes('<strong>粗体</strong>'), html);
  assert.ok(html.includes('<em>斜体</em>'), html);
  assert.ok(html.includes('<code>a&lt;b</code>'), html);
});

test('renders lists and blockquotes', () => {
  const html = renderMarkdown('- 一\n- 二\n\n1. 甲\n2. 乙\n\n> 引用');
  assert.ok(html.includes('<ul><li>一</li><li>二</li></ul>'), html);
  assert.ok(html.includes('<ol><li>甲</li><li>乙</li></ol>'), html);
  assert.ok(html.includes('<blockquote>引用</blockquote>'), html);
});

test('renders a markdown table', () => {
  const html = renderMarkdown('| 名称 | 值 |\n| --- | --- |\n| a | 1 |');
  assert.ok(html.includes('<table>'), html);
  assert.ok(html.includes('<th>名称</th>'), html);
  assert.ok(html.includes('<td>1</td>'), html);
});

test('only linkifies http(s) and mailto URLs', () => {
  const safe = renderMarkdown('[站点](https://example.com/a?b=1&c=2)');
  assert.ok(safe.includes('href="https://example.com/a?b=1&amp;c=2"'), safe);
  assert.ok(safe.includes('rel="noopener noreferrer"'), safe);

  const unsafe = renderMarkdown('[点我](javascript:alert(1))');
  assert.ok(!unsafe.includes('<a '), unsafe);
  assert.ok(unsafe.includes('javascript:alert(1)'), unsafe);
});

test('cannot break out of the href attribute', () => {
  const html = renderMarkdown('[x](https://a.com/"onmouseover="alert(1))');
  assert.ok(!html.includes('onmouseover="alert'), html);
});

test('does not treat snake_case as emphasis', () => {
  const html = renderMarkdown('use max_page_chars value');
  assert.ok(!html.includes('<em>'), html);
});

test('renders fenced code with a language label', () => {
  const html = renderMarkdown('```js\nconst a = 1;\n```');
  assert.ok(html.includes('codeblock'), html);
  assert.ok(html.includes('>js<'), html);
  assert.ok(html.includes('const a = 1;'), html);
});

test('closes an unterminated fence instead of dropping the rest', () => {
  const html = renderMarkdown('```\nabc');
  assert.ok(html.includes('abc'), html);
});

test('escapeHtml covers all five characters', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});
