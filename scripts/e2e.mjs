import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_CORE, 'playwright-core'].filter(Boolean);
  const failures = [];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      failures.push(`${candidate}: ${error.code || error.message}`);
    }
  }
  throw new Error(
    `playwright-core not found. Run "npm install" (or set PLAYWRIGHT_CORE to an existing install).\n${failures.join('\n')}`,
  );
}

const { chromium } = loadPlaywright();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');

const WAV_DATA_URI =
  'data:audio/wav;base64,UklGRsQPAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

const FIXTURE = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>DeepSeek V4 发布：长上下文与推理能力升级</title>
  <meta name="description" content="DeepSeek 发布 V4 模型，上下文扩展到 1M token。">
</head>
<body>
  <nav>导航噪音 首页 产品 价格</nav>
  <aside>侧栏广告：立即购买</aside>
  <form><input value="super-secret"><button>提交</button></form>
  <main>
    <article>
      <h1>DeepSeek V4 发布：长上下文与推理能力升级</h1>
      <p>DeepSeek 今天发布了 V4 模型，上下文窗口扩展到 100 万 token，推理成本进一步下降。这是本文的核心结论。</p>
      <div id="toolbox">
        <input id="name" placeholder="你的名字">
        <button id="greet" type="button">打个招呼</button>
        <button id="danger" type="button">删除全部</button>
        <p id="output">尚未打招呼</p>
      </div>
      <div id="media-lab">
        <audio id="clip" preload="auto" src="${WAV_DATA_URI}"></audio>
        <input id="volume" type="range" min="0" max="100" value="20">
        <div id="track" style="width:200px;height:20px;background:#dddddd;position:relative;margin-top:8px">
          <div id="thumb" style="width:16px;height:16px;background:#6366f1;border-radius:50%;position:absolute;left:0;top:2px"></div>
        </div>
        <p id="trackValue">0</p>
      </div>
      <h2>主要变化</h2>
      <ul>
        <li>上下文从 128K 扩展到 1M token</li>
        <li>数学与代码基准提升约 12%</li>
        <li>API 价格保持不变</li>
      </ul>
      <h2>价格对比</h2>
      <table>
        <tr><th>模型</th><th>输入价格</th><th>输出价格</th></tr>
        <tr><td>DeepSeek V3</td><td>0.27 美元</td><td>1.10 美元</td></tr>
        <tr><td>DeepSeek V4</td><td>0.27 美元</td><td>1.10 美元</td></tr>
      </table>
      <blockquote>我们相信更长的上下文会让 agent 工作流更可靠。</blockquote>
      <h2>示例代码</h2>
      <pre>const reply = await client.chat.completions.create({ model: "deepseek-chat" });</pre>
      <p>官方表示，V4 将在下周向所有开发者开放，旧模型会保留至少六个月。</p>
    </article>
  </main>
  <footer>版权所有 2026 示例公司</footer>
  <script>
    window.__tracking = 'should-not-appear';
    document.getElementById('greet').addEventListener('click', () => {
      const name = document.getElementById('name').value || '陌生人';
      document.getElementById('output').textContent = '你好，' + name + '！';
    });
    document.getElementById('danger').addEventListener('click', () => {
      document.getElementById('output').textContent = '（已删除）';
    });

    let dragging = false;
    const track = document.getElementById('track');
    const thumb = document.getElementById('thumb');
    const trackValue = document.getElementById('trackValue');
    function setFromEvent(event) {
      const rect = track.getBoundingClientRect();
      const percent = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
      thumb.style.left = 'calc(' + percent + '% - 8px)';
      trackValue.textContent = String(Math.round(percent));
    }
    track.addEventListener('pointerdown', (event) => {
      dragging = true;
      setFromEvent(event);
    });
    document.addEventListener('pointermove', (event) => {
      if (dragging) setFromEvent(event);
    });
    document.addEventListener('pointerup', () => {
      dragging = false;
    });
  </script>
</body>
</html>`;

const REPLY_CHUNKS = [
  '## 一句话结论\n\nDeepSeek 发布了 **V4** 模型，把上下文扩展到了 100 万 token，价格保持不变。\n\n',
  '## 关键要点\n\n1. 上下文从 128K 提升到 1M token\n2. 数学与代码基准提升约 **12%**\n3. API 价格与 V3 一致\n\n',
  '> 更长的上下文会让 agent 工作流更可靠。\n\n',
  '## 价格\n\n| 模型 | 输入 | 输出 |\n| --- | --- | --- |\n| V3 | 0.27 | 1.10 |\n| V4 | 0.27 | 1.10 |\n\n',
  '```js\nconst reply = await client.chat.completions.create({ model: "deepseek-chat" });\n```\n',
];

const REPLY_CHUNKS_EN = [
  '## Takeaway\n\nDeepSeek released **V4** with a 1M-token context window, at the same price as V3.\n\n',
  '## Key points\n\n1. Context grows from 128K to 1M tokens\n2. Math and coding benchmarks improve by about **12%**\n3. API pricing is unchanged from V3\n\n',
  '> Longer context makes agent workflows more reliable.\n\n',
  '## Pricing\n\n| Model | Input | Output |\n| --- | --- | --- |\n| V3 | 0.27 | 1.10 |\n| V4 | 0.27 | 1.10 |\n\n',
  '```js\nconst reply = await client.chat.completions.create({ model: "deepseek-chat" });\n```\n',
];

function sseBody(chunks) {
  return (
    chunks
      .map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
      .join('') + 'data: [DONE]\n\n'
  );
}

function sseText(text) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
}

function sseToolCalls(calls) {
  let body = '';
  calls.forEach((call, index) => {
    const args = JSON.stringify(call.args);
    const cut = Math.max(1, Math.floor(args.length / 2));
    body += `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index,
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: args.slice(0, cut) },
              },
            ],
          },
        },
      ],
    })}\n\n`;
    body += `data: ${JSON.stringify({
      choices: [{ delta: { tool_calls: [{ index, function: { arguments: args.slice(cut) } }] } }],
    })}\n\n`;
  });
  body += `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`;
  return `${body}data: [DONE]\n\n`;
}

async function getServiceWorker(context) {
  const existing = context.serviceWorkers();
  if (existing.length > 0) return existing[0];
  return context.waitForEvent('serviceworker', { timeout: 12000 }).catch(() => null);
}

async function launch(headless) {
  const profile = path.join(ROOT, '.tmp-profile');
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge',
    headless,
    viewport: { width: 420, height: 820 },
    deviceScaleFactor: 2,
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=msEdgeFirstRunExperience',
    ],
  });
  const worker = await getServiceWorker(context);
  if (!worker) {
    await context.close();
    return null;
  }
  return { context, worker };
}

const failures = [];
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name} ${detail}`);
    failures.push(name);
  }
}

async function shot(page, name, options = {}) {
  await page
    .evaluate(() => {
      const toast = document.getElementById('toast');
      toast?.classList.remove('show');
      toast?.classList.add('hidden');
    })
    .catch(() => {});
  await page.bringToFront();
  await page.screenshot({ path: path.join(SHOTS, name), animations: 'disabled', ...options });
}

async function main() {
  await mkdir(SHOTS, { recursive: true });

  const server = createServer((request, response) => {
    if (request.url?.startsWith('/fixture')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(FIXTURE);
      return;
    }
    if (request.url === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const fixtureUrl = `http://127.0.0.1:${port}/fixture`;

  console.log(`fixture: ${fixtureUrl}`);

  let dshAvailable = false;
  try {
    const response = await fetch('http://127.0.0.1:8765/health', { signal: AbortSignal.timeout(1500) });
    dshAvailable = response.ok;
  } catch {
    dshAvailable = false;
  }
  console.log(`DSH bridge: ${dshAvailable ? 'available' : 'not running (sync checks skipped)'}`);

  let launched = await launch(true);
  if (!launched) {
    console.log('headless extension load failed, retrying headed...');
    launched = await launch(false);
  }
  if (!launched) throw new Error('could not load the extension in Edge');

  const { context, worker } = launched;
  const extensionId = new URL(worker.url()).host;
  console.log(`extension id: ${extensionId}`);

  const panelOptions = await worker.evaluate(async () => {
    try {
      return await chrome.sidePanel.getOptions({});
    } catch (error) {
      return { error: String(error) };
    }
  });
  check(
    'side panel registered',
    panelOptions?.path === 'panel.html' && panelOptions?.enabled !== false,
    JSON.stringify(panelOptions),
  );

  const errors = [];
  const watch = (page, label) => {
    page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`${label} console: ${message.text()}`);
    });
  };

  try {
    const site = await context.newPage();
    watch(site, 'site');
    await site.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
    await site.bringToFront();

    const panel = await context.newPage();
    watch(panel, 'panel');
    await panel.goto(`chrome-extension://${extensionId}/panel.html`);

    const fixtureTabId = await panel.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((tab) => (tab.url || '').includes('/fixture'))?.id ?? null;
    });
    check('panel can see the fixture tab', Boolean(fixtureTabId));

    await panel.evaluate(
      (settings) =>
        new Promise((resolve) => chrome.storage.local.set({ settings, conversation: [] }, resolve)),
      {
        apiBase: 'https://api.example.test/v1',
        apiKey: 'sk-test-key',
        model: 'deepseek-chat',
        temperature: 0.3,
        maxPageChars: 14000,
        historyLimit: 12,
        includePage: true,
        allowPageActions: true,
        confirmActions: false,
        maxAgentSteps: 6,
        locale: 'zh',
        systemExtra: '',
      },
    );

    await panel.goto(`chrome-extension://${extensionId}/panel.html?standalone=1&tabId=${fixtureTabId}`);
    await panel.setViewportSize({ width: 420, height: 820 });

    await panel.waitForFunction(
      () => (document.getElementById('pageTitle')?.textContent || '').includes('DeepSeek V4'),
      null,
      { timeout: 20000 },
    );

    const pageBar = await panel.evaluate(() => ({
      title: document.getElementById('pageTitle').textContent,
      sub: document.getElementById('pageSub').textContent,
      status: document.getElementById('status').textContent,
      prompts: document.querySelectorAll('.prompt-card').length,
    }));
    check('page bar shows the page title', pageBar.title.includes('DeepSeek V4'), pageBar.title);
    check('page bar shows extracted chars', /字/.test(pageBar.sub), pageBar.sub);
    check('quick prompts rendered', pageBar.prompts === 6, String(pageBar.prompts));

    await shot(panel, 'panel-empty.png');

    let requestBody = null;
    let agentBodies = [];
    const mock = { mode: 'summary' };

    await panel.route('**/chat/completions', async (route) => {
      requestBody = route.request().postDataJSON();
      const fulfill = (body) =>
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
          body,
        });

      if (mock.mode === 'summary') {
        const english = String(requestBody?.messages?.[0]?.content || '').startsWith('You are Sidebar Copilot');
        await fulfill(sseBody(english ? REPLY_CHUNKS_EN : REPLY_CHUNKS));
        return;
      }

      agentBodies.push(requestBody);

      if (mock.mode === 'agent') {
        if (agentBodies.length === 1) {
          await fulfill(
            sseToolCalls([
              { id: 'call_type', name: 'type_text', args: { selector: '#name', text: '小明' } },
              { id: 'call_click', name: 'click', args: { selector: '#greet' } },
            ]),
          );
          return;
        }
        await fulfill(sseText('已经帮你填好名字并打了招呼。'));
        return;
      }

      if (mock.mode === 'media') {
        if (agentBodies.length === 1) {
          await fulfill(
            sseToolCalls([
              { id: 'call_seek', name: 'control_media', args: { action: 'seek', percent: 50 } },
              { id: 'call_volume', name: 'control_media', args: { action: 'volume', volume: 0.8 } },
              { id: 'call_range', name: 'set_range', args: { selector: '#volume', percent: 80 } },
              { id: 'call_drag', name: 'drag', args: { from: { selector: '#track' }, dx: 120 } },
            ]),
          );
          return;
        }
        await fulfill(sseText('已经把进度拖到一半、音量调到 80%，滑块也拖到右边了。'));
        return;
      }

      if (agentBodies.length === 1) {
        await fulfill(sseToolCalls([{ id: 'call_delete', name: 'click', args: { text: '删除全部' } }]));
        return;
      }
      await fulfill(sseText('好的，已跳过删除。'));
    });

    await panel.click('.prompt-card[data-prompt="summary"]');
    await panel.waitForSelector('.msg.assistant .md h2', { timeout: 15000 });
    await panel.waitForFunction(() => !document.querySelector('.msg.assistant .caret'), null, {
      timeout: 15000,
    });

    const chat = await panel.evaluate(() => ({
      user: document.querySelector('.msg.user .bubble')?.textContent || '',
      html: document.querySelector('.msg.assistant .md')?.innerHTML || '',
      messages: document.querySelectorAll('.msg').length,
      status: document.getElementById('status').textContent,
    }));
    check('user message shows the quick prompt', chat.user.includes('总结'), chat.user.slice(0, 30));
    check('assistant reply has a heading', chat.html.includes('<h2>'), '');
    check('assistant reply has a table', chat.html.includes('<table>'), '');
    check('assistant reply has a code block', chat.html.includes('codeblock'), '');
    check('two messages rendered', chat.messages === 2, String(chat.messages));

    const systemPrompt = requestBody?.messages?.[0]?.content || '';
    const userMessage = requestBody?.messages?.at(-1)?.content || '';
    check('request uses the configured model', requestBody?.model === 'deepseek-chat', String(requestBody?.model));
    check('system prompt carries the page body', systemPrompt.includes('100 万 token'), '');
    check('system prompt excludes nav noise', !systemPrompt.includes('导航噪音'), '');
    check('system prompt excludes form values', !systemPrompt.includes('super-secret'), '');
    check('system prompt excludes footer', !systemPrompt.includes('版权所有'), '');
    check('user message is sent verbatim', userMessage.includes('总结'), userMessage.slice(0, 20));
    check('attachment toggle is on', await panel.isChecked('#attachToggle'));

    await shot(panel, 'panel-chat.png');

    // --- selection flow -------------------------------------------------
    await site.evaluate(() => {
      const quote = document.querySelector('blockquote');
      const range = document.createRange();
      range.selectNodeContents(quote);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });

    await panel.click('#refreshPage');
    await panel.waitForSelector('#selectionChip:not(.hidden)', { timeout: 15000 });
    const selectionChip = await panel.evaluate(() => ({
      text: document.getElementById('selectionChip').textContent,
      count: Number(document.getElementById('selectionChip').dataset.count),
    }));
    check('selection chip appears', selectionChip.count > 0, selectionChip.text);

    await panel.click('#newChat');
    requestBody = null;
    await panel.click('.prompt-card[data-prompt="explain-selection"]');
    await panel.waitForFunction(() => !document.querySelector('.msg.assistant .caret'), null, {
      timeout: 15000,
    });
    const selectionPrompt = requestBody?.messages?.[0]?.content || '';
    check('system prompt carries the selection', selectionPrompt.includes('更长的上下文会让 agent 工作流更可靠'), '');
    check('system prompt marks the selection block', selectionPrompt.includes('<<<SELECTION_START>>>'), '');

    await panel.emulateMedia({ colorScheme: 'dark' });
    await shot(panel, 'panel-dark.png');
    await panel.emulateMedia({ colorScheme: 'light' });

    // --- agent actions ---------------------------------------------------
    await panel.click('#newChat');
    mock.mode = 'agent';
    agentBodies = [];
    await panel.fill('#input', '帮我填上名字，然后点打招呼');
    await panel.press('#input', 'Enter');

    await panel.waitForFunction(
      () => document.querySelectorAll('.action-card.ok').length >= 2,
      null,
      { timeout: 20000 },
    );
    await panel.waitForFunction(
      () =>
        document.querySelectorAll('.msg.assistant').length >= 2 &&
        !document.querySelector('.msg.assistant .caret'),
      null,
      { timeout: 20000 },
    );

    const actionState = await panel.evaluate(() => ({
      cards: Array.from(document.querySelectorAll('.action-card')).map((card) => ({
        label: card.querySelector('.action-label')?.textContent || '',
        status: card.className,
      })),
      final: Array.from(document.querySelectorAll('.msg.assistant .md')).at(-1)?.textContent || '',
      messages: document.querySelectorAll('.msg').length,
    }));
    check('two action cards rendered', actionState.cards.length === 2, String(actionState.cards.length));
    check('actions completed', actionState.cards.every((card) => card.status.includes('ok')), '');
    check('action labels describe the work', actionState.cards[0].label.includes('小明'), actionState.cards[0].label);
    check('final assistant message arrives', actionState.final.includes('填好名字'), actionState.final);
    check('conversation has three messages', actionState.messages === 3, String(actionState.messages));

    const typedOutput = await site.evaluate(() => document.getElementById('output').textContent);
    check('agent typed and clicked on the page', typedOutput.includes('小明'), typedOutput);

    check(
      'first agent request advertises tools',
      Array.isArray(agentBodies[0]?.tools) && agentBodies[0].tools.length >= 8,
      '',
    );
    const secondRequest = agentBodies[1] || { messages: [] };
    check('tool results are returned to the model', secondRequest.messages.some((message) => message.role === 'tool'), '');
    check(
      'tool result reports success',
      secondRequest.messages.some((message) => message.role === 'tool' && message.content.includes('"ok":true')),
      '',
    );

    await shot(panel, 'panel-actions.png');

    // --- risky action confirmation --------------------------------------
    await panel.click('#newChat');
    mock.mode = 'confirm';
    agentBodies = [];
    await panel.fill('#input', '把页面上的内容删掉');
    await panel.press('#input', 'Enter');

    await panel.waitForSelector('.action-confirm', { timeout: 20000 });
    const beforeDelete = await site.evaluate(() => document.getElementById('output').textContent);
    check('risky action waits for confirmation', beforeDelete.includes('小明'), beforeDelete);

    await shot(panel, 'panel-confirm.png');
    await panel.click('.action-confirm button[data-confirm="no"]');
    await panel.waitForFunction(() => !document.querySelector('.action-confirm'), null, { timeout: 15000 });

    const afterDelete = await site.evaluate(() => document.getElementById('output').textContent);
    check('skipped action did not run', afterDelete === beforeDelete, afterDelete);

    // --- media control and dragging -------------------------------------
    await panel.click('#newChat');
    mock.mode = 'media';
    agentBodies = [];
    await site.waitForFunction(
      () => {
        const clip = document.getElementById('clip');
        return clip.readyState >= 1 && clip.duration > 0;
      },
      null,
      { timeout: 15000 },
    );

    await panel.fill('#input', '把视频进度拖到一半，音量调到 80%，滑块拖到右边');
    await panel.press('#input', 'Enter');
    await panel.waitForFunction(
      () => document.querySelectorAll('.action-card.ok').length >= 4,
      null,
      { timeout: 25000 },
    );
    await panel.waitForFunction(
      () =>
        document.querySelectorAll('.msg.assistant').length >= 2 &&
        !document.querySelector('.msg.assistant .caret'),
      null,
      { timeout: 25000 },
    );

    const mediaState = await site.evaluate(() => {
      const clip = document.getElementById('clip');
      return {
        time: clip.currentTime,
        duration: clip.duration,
        volume: clip.volume,
        rangeValue: document.getElementById('volume').value,
        trackValue: Number(document.getElementById('trackValue').textContent),
        failed: document.querySelectorAll('.action-card.error').length,
      };
    });
    check(
      'media seek moved the audio',
      Math.abs(mediaState.time - mediaState.duration / 2) < 0.15,
      JSON.stringify(mediaState),
    );
    check('media volume was set', Math.abs(mediaState.volume - 0.8) < 0.01, String(mediaState.volume));
    check('range slider was set', mediaState.rangeValue === '80', mediaState.rangeValue);
    check('custom slider was dragged', mediaState.trackValue > 60, String(mediaState.trackValue));
    check('no action failed', mediaState.failed === 0, String(mediaState.failed));

    await shot(panel, 'panel-media.png');

    // --- English UI and prompt ------------------------------------------
    await panel.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get('settings', ({ settings }) => {
            chrome.storage.local.set({ settings: { ...settings, locale: 'en' } }, resolve);
          });
        }),
    );
    await panel.waitForFunction(
      () =>
        document
          .querySelector('.prompt-card[data-prompt="summary"]')
          ?.textContent?.includes('Summarize page'),
      null,
      { timeout: 15000 },
    );
    await panel.click('#newChat');
    mock.mode = 'summary';
    agentBodies = [];

    const enUi = await panel.evaluate(() => ({
      prompt: document.querySelector('.prompt-card[data-prompt="summary"]')?.textContent || '',
      placeholder: document.getElementById('input')?.placeholder || '',
      status: document.getElementById('status')?.textContent || '',
    }));
    check('English quick prompt', enUi.prompt.includes('Summarize page'), enUi.prompt);
    check('English input placeholder', enUi.placeholder.includes('Ask anything'), enUi.placeholder);
    check('English status uses chars', /chars/.test(enUi.status), enUi.status);
    await panel.waitForFunction(
      () => /chars/.test(document.getElementById('pageSub')?.textContent || ''),
      null,
      { timeout: 10000 },
    );
    await shot(panel, 'panel-empty-en.png');

    await panel.click('.prompt-card[data-prompt="summary"]');
    await panel.waitForFunction(() => !document.querySelector('.msg.assistant .caret'), null, {
      timeout: 15000,
    });
    const enSystem = requestBody?.messages?.[0]?.content || '';
    check('English system prompt', enSystem.startsWith('You are Sidebar Copilot'), enSystem.slice(0, 40));
    check('English action rules', enSystem.includes('## Page actions'), '');
    check('voice input button exists', await panel.isVisible('#mic'));
    await shot(panel, 'panel-en.png');

    // --- conversation history -------------------------------------------
    await panel.click('#historyBtn');
    await panel.waitForSelector('.history-item', { timeout: 10000 });
    const historyState = await panel.evaluate(() => ({
      items: document.querySelectorAll('.history-item').length,
      active: document.querySelectorAll('.history-item.active').length,
      titles: Array.from(document.querySelectorAll('.history-title')).map((node) => node.textContent),
    }));
    check('history lists multiple conversations', historyState.items >= 3, String(historyState.items));
    check('history marks the active conversation', historyState.active === 1, String(historyState.active));
    check('history shows a title', historyState.titles.every(Boolean), JSON.stringify(historyState.titles));
    check('history has sync-to-desktop action', await panel.isVisible('[data-push]'));
    await shot(panel, 'panel-history.png');

    const [download] = await Promise.all([
      panel.waitForEvent('download', { timeout: 10000 }),
      panel.click('.history-item [data-export]'),
    ]);
    check('history export downloads JSON', download.suggestedFilename().endsWith('.json'), download.suggestedFilename());
    await panel.click('#closeHistory');

    // --- custom background ----------------------------------------------
    await panel.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get('settings', ({ settings }) => {
            chrome.storage.local.set({ settings: { ...settings, panelBg: '#101820' } }, resolve);
          });
        }),
    );
    await panel.waitForFunction(
      () => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#101820',
      null,
      { timeout: 10000 },
    );
    const themed = await panel.evaluate(() => ({
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      color: getComputedStyle(document.body).color,
    }));
    check('custom panel background applied', themed.bg === '#101820', themed.bg);
    check('custom background keeps text light', themed.color === 'rgb(238, 240, 246)', themed.color);
    await shot(panel, 'panel-theme.png');

    await panel.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get('settings', ({ settings }) => {
            chrome.storage.local.set(
              { settings: { ...settings, locale: 'zh', panelBg: '' } },
              resolve,
            );
          });
        }),
    );

    // --- DeepSeek Harness sync (only when the local bridge is running) ---
    if (dshAvailable) {
      await panel.evaluate(
        () =>
          new Promise((resolve) => {
            chrome.storage.local.get('settings', ({ settings }) => {
              chrome.storage.local.set({ settings: { ...settings, dshSync: true } }, resolve);
            });
          }),
      );
      await panel.click('#historyBtn');
      await panel.waitForSelector('.dsh-item', { timeout: 15000 });
      const dshState = await panel.evaluate(() => ({
        count: document.querySelectorAll('.dsh-item').length,
        first: document.querySelector('.dsh-item-title')?.textContent || '',
      }));
      check('DSH sessions listed in history', dshState.count > 0, String(dshState.count));
      check('DSH session shows a title', Boolean(dshState.first), dshState.first);
      await shot(panel, 'panel-dsh.png');

      await panel.click('.dsh-item');
      await panel.waitForFunction(
        () => document.getElementById('historyDrawer').classList.contains('hidden'),
        null,
        { timeout: 20000 },
      );
      await panel.waitForFunction(() => document.querySelectorAll('.msg').length > 0, null, {
        timeout: 10000,
      });
      const imported = await panel.evaluate(() => ({
        messages: document.querySelectorAll('.msg').length,
        user: document.querySelector('.msg.user .bubble')?.textContent || '',
      }));
      check('DSH session imports messages', imported.messages > 0, String(imported.messages));
      check('DSH transcript starts with a user prompt', imported.user.length > 0, imported.user.slice(0, 30));
    } else {
      console.log('skip DSH sync checks: bridge not running');
    }

    const options = await context.newPage();
    watch(options, 'options');
    await options.setViewportSize({ width: 900, height: 1100 });
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.waitForSelector('#apiBase');
    const optionsState = await options.evaluate(() => ({
      base: document.getElementById('apiBase').value,
      preset: document.querySelector('.preset.active')?.textContent || '',
      allowActions: document.getElementById('allowPageActions').checked,
    }));
    check('options shows the saved API base', optionsState.base.includes('api.example.test'), optionsState.base);
    check('options highlights the custom preset', optionsState.preset === '自定义', optionsState.preset);
    check('options exposes the page-action switch', optionsState.allowActions === true, String(optionsState.allowActions));
    await shot(options, 'options.png', { fullPage: true });

    await options.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get('settings', ({ settings }) => {
            chrome.storage.local.set({ settings: { ...settings, locale: 'en' } }, resolve);
          });
        }),
    );
    await options.reload();
    await options.waitForSelector('#apiBase');
    const enOptions = await options.evaluate(() => ({
      heading: document.querySelector('h2')?.textContent || '',
      save: document.getElementById('save')?.textContent || '',
    }));
    check('English options heading', enOptions.heading.includes('Model provider'), enOptions.heading);
    check('English save button', enOptions.save === 'Save', enOptions.save);
    await shot(options, 'options-en.png', { fullPage: true });

    await options.click('#save');
    await options.waitForFunction(
      () => document.querySelectorAll('#savedProvider option').length >= 2,
      null,
      { timeout: 10000 },
    );
    check(
      'saving remembers the provider',
      (await options.evaluate(() => document.querySelectorAll('#savedProvider option').length)) >= 2,
    );

    await options.click('#reset');
    const keyAfterReset = await options.inputValue('#apiKey');
    check('reset keeps the API key', keyAfterReset === 'sk-test-key', keyAfterReset);

    await options.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get('settings', ({ settings }) => {
            chrome.storage.local.set({ settings: { ...settings, locale: 'zh' } }, resolve);
          });
        }),
    );

    const welcome = await context.newPage();
    watch(welcome, 'welcome');
    await welcome.setViewportSize({ width: 900, height: 800 });
    await welcome.goto(`chrome-extension://${extensionId}/welcome.html`);
    await welcome.waitForSelector('.step');
    await shot(welcome, 'welcome.png', { fullPage: true });

    console.log('\nconsole/page errors:');
    if (errors.length === 0) console.log('  none');
    else for (const error of errors) console.log(`  - ${error}`);
  } finally {
    await context.close();
    server.close();
  }

  console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
