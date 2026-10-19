/**
 * Tool definitions handed to the model, plus display and safety helpers.
 * Execution lives in content.js (page side) and panel.js (wait/read wrappers).
 */

import { getLocale } from './i18n.js';

const locate = {
  ref: { type: 'string', description: 'Element ref from the latest inspect_page result, e.g. "e12"' },
  selector: { type: 'string', description: 'CSS selector, e.g. "#login" or "button[type=submit]"' },
  text: { type: 'string', description: 'Visible text of the element, e.g. "Sign in" (exact match first)' },
};

function fn(name, description, properties = {}, required = []) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}

export const PAGE_TOOLS = [
  fn(
    'inspect_page',
    'List interactive elements on the current page (buttons, links, inputs, selects) with refs, labels, bounds, and visibility. Filter by visible text or CSS selector. Use this before acting on a page.',
    {
      query: { type: 'string', description: 'Visible text or CSS selector; omit to list visible elements' },
      limit: { type: 'integer', description: 'Maximum elements to return, 1-40 (default 20)' },
    },
  ),
  fn('click', 'Click an element by ref, CSS selector, or visible text. Returns the new URL and element info.', locate),
  fn(
    'type_text',
    'Fill an input, textarea, or contenteditable element. Optionally submit with Enter. Never use on password, OTP, or card fields.',
    {
      ref: locate.ref,
      selector: locate.selector,
      text: { type: 'string', description: 'Text to enter' },
      submit: { type: 'boolean', description: 'Press Enter after typing (default false)' },
      clear: { type: 'boolean', description: 'Clear existing content first (default true)' },
    },
    ['text'],
  ),
  fn(
    'select_option',
    'Choose an option in a native <select>, by visible text or value.',
    {
      ref: locate.ref,
      selector: locate.selector,
      option: { type: 'string', description: 'Visible text or value of the option' },
    },
    ['option'],
  ),
  fn(
    'press_key',
    'Send a key press to the focused element, e.g. Enter, Escape, Tab, ArrowDown.',
    { key: { type: 'string', description: 'Key name, e.g. "Enter"' } },
    ['key'],
  ),
  fn(
    'scroll_page',
    'Scroll the page by direction, or scroll a specific element into view.',
    {
      direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: 'Scroll direction (default down)' },
      amount: { type: 'integer', description: 'Pixels to scroll; defaults to about 0.8 viewport' },
      ref: locate.ref,
      selector: locate.selector,
    },
  ),
  fn(
    'open_url',
    'Open an http(s) URL in the current tab. The page content changes after navigation.',
    { url: { type: 'string', description: 'Full http(s) URL' } },
    ['url'],
  ),
  fn('read_page', 'Re-read the current page text after navigation or updates, including media state.', {}),
  fn(
    'wait_for',
    'Wait up to 15 seconds for text or an element to appear. Use after navigation or for dialogs.',
    {
      text: { type: 'string', description: 'Visible text to wait for' },
      selector: { type: 'string', description: 'CSS selector to wait for' },
      timeout_ms: { type: 'integer', description: 'Timeout in milliseconds (default 5000, max 15000)' },
    },
  ),
  fn(
    'control_media',
    'Control the page video/audio: play, pause, seek, volume, mute, playback rate. Prefer this for video progress; percent is 0-100.',
    {
      action: {
        type: 'string',
        enum: [
          'status',
          'play',
          'pause',
          'toggle',
          'seek',
          'seek_by',
          'volume',
          'mute',
          'unmute',
          'toggle_mute',
          'rate',
        ],
        description: 'Operation to perform',
      },
      percent: { type: 'number', description: 'Percent (0-100) for seek or volume' },
      seconds: { type: 'number', description: 'Seconds for seek, or delta seconds for seek_by (may be negative)' },
      volume: { type: 'number', description: 'Volume from 0 to 1' },
      rate: { type: 'number', description: 'Playback rate from 0.25 to 4' },
      ref: locate.ref,
      selector: locate.selector,
    },
    ['action'],
  ),
  fn(
    'drag',
    'Press and drag an element to another position. Use for custom video progress bars, sliders, and sortable lists. from/to accept ref, selector, text, or x/y; dx/dy drags relative to the start.',
    {
      from: {
        type: 'object',
        description: 'Start point: {ref|selector|text|x,y}',
        properties: {
          ref: locate.ref,
          selector: locate.selector,
          text: locate.text,
          x: { type: 'number' },
          y: { type: 'number' },
        },
      },
      to: {
        type: 'object',
        description: 'End point: {ref|selector|text|x,y}',
        properties: {
          ref: locate.ref,
          selector: locate.selector,
          text: locate.text,
          x: { type: 'number' },
          y: { type: 'number' },
        },
      },
      dx: { type: 'number', description: 'Horizontal offset when to is omitted' },
      dy: { type: 'number', description: 'Vertical offset when to is omitted' },
      steps: { type: 'integer', description: 'Number of intermediate moves (default 12)' },
    },
    ['from'],
  ),
  fn(
    'set_range',
    'Set a native <input type=range> value, such as a volume slider or a settings slider. Use percent (0-100) or value.',
    {
      ref: locate.ref,
      selector: locate.selector,
      percent: { type: 'number', description: 'Target percent, 0-100' },
      value: { type: 'number', description: 'Target value (alternative to percent)' },
    },
  ),
  fn('hover', 'Move the mouse over an element to open hover menus or tooltips.', {
    ref: locate.ref,
    selector: locate.selector,
    text: locate.text,
  }),
];

const RISKY_ZH = /(支付|付款|购买|下单|提交订单|确认支付|确认|提交|删除|移除|清空|注销|退出登录|解绑|转账|充值|发送|发布|同意|授权)/;
const RISKY_EN =
  /\b(pay|payment|purchase|buy|order|checkout|delete|remove|clear|sign out|log out|unsubscribe|transfer|top up|send|publish|submit|confirm|authorize|agree)\b/i;

export function isRiskyAction(name, args) {
  if (!['click', 'type_text', 'select_option', 'press_key'].includes(name)) return false;
  if (name === 'press_key') return args?.key === 'Enter';
  const probe = [args?.text, args?.selector, args?.option].filter(Boolean).join(' ');
  return RISKY_ZH.test(probe) || RISKY_EN.test(probe);
}

function clip(value, length) {
  const text = String(value ?? '');
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

export function describeAction(name, args = {}) {
  return getLocale() === 'en' ? describeActionEn(name, args) : describeActionZh(name, args);
}

function targetOf(args, includeText) {
  if (includeText && args.text) return `“${clip(args.text, 24)}”`;
  return args.selector || args.ref || '';
}

function describeActionZh(name, args) {
  const label = {
    inspect_page: '查看页面元素',
    click: '点击',
    type_text: '输入',
    select_option: '选择',
    press_key: '按键',
    scroll_page: '滚动',
    open_url: '打开链接',
    read_page: '读取页面',
    wait_for: '等待',
    control_media: '媒体控制',
    drag: '拖拽',
    set_range: '设置滑块',
    hover: '悬停',
  }[name] || name;
  const target = targetOf(args, name === 'click' || name === 'hover');

  switch (name) {
    case 'click':
      return target ? `点击 ${target}` : label;
    case 'type_text':
      return `在 ${target || '输入框'} 输入 “${clip(args.text, 20)}”${args.submit ? ' 并提交' : ''}`;
    case 'select_option':
      return `在 ${target || '下拉框'} 选择 “${clip(args.option, 20)}”`;
    case 'press_key':
      return `按下 ${args.key || '按键'}`;
    case 'scroll_page':
      return `滚动页面 ${args.direction || 'down'}`;
    case 'open_url':
      return `打开 ${clip(args.url, 60)}`;
    case 'inspect_page':
      return args.query ? `查找 “${clip(args.query, 30)}”` : '查看页面元素';
    case 'wait_for':
      return `等待 ${clip(args.text || args.selector || '页面响应', 30)}`;
    case 'read_page':
      return '读取页面正文';
    case 'control_media': {
      const percent = args.percent != null ? ` ${args.percent}%` : '';
      const seconds = args.seconds != null ? ` ${args.seconds}s` : '';
      switch (args.action) {
        case 'play':
          return '播放';
        case 'pause':
          return '暂停';
        case 'toggle':
          return '切换播放/暂停';
        case 'seek':
          return `跳转进度到${percent || seconds || '指定位置'}`;
        case 'seek_by':
          return `${Number(args.seconds) < 0 ? '后退' : '快进'} ${Math.abs(Number(args.seconds) || 0)} 秒`;
        case 'volume':
          return `音量调到 ${args.volume != null ? Math.round(args.volume * 100) : args.percent}%`;
        case 'mute':
          return '静音';
        case 'unmute':
          return '取消静音';
        case 'toggle_mute':
          return '切换静音';
        case 'rate':
          return `倍速调到 ${args.rate}x`;
        default:
          return '读取播放状态';
      }
    }
    case 'drag': {
      const from = args.from?.selector || args.from?.ref || args.from?.text || '起点';
      const to =
        args.to?.selector ||
        args.to?.ref ||
        args.to?.text ||
        (args.dx != null ? `右移 ${args.dx}px` : '目标位置');
      return `拖拽 ${clip(from, 24)} → ${clip(to, 24)}`;
    }
    case 'set_range':
      return `把 ${target || '滑块'} 设为 ${args.percent != null ? `${args.percent}%` : args.value}`;
    case 'hover':
      return `悬停 ${target || '元素'}`;
    default:
      return label;
  }
}

function describeActionEn(name, args) {
  const label = {
    inspect_page: 'Inspect page',
    click: 'Click',
    type_text: 'Type',
    select_option: 'Select',
    press_key: 'Press',
    scroll_page: 'Scroll',
    open_url: 'Open',
    read_page: 'Read page',
    wait_for: 'Wait',
    control_media: 'Media',
    drag: 'Drag',
    set_range: 'Set range',
    hover: 'Hover',
  }[name] || name;
  const target = targetOf(args, name === 'click' || name === 'hover');

  switch (name) {
    case 'click':
      return target ? `Click ${target}` : label;
    case 'type_text':
      return `Type “${clip(args.text, 20)}” into ${target || 'the input'}${args.submit ? ' and submit' : ''}`;
    case 'select_option':
      return `Select “${clip(args.option, 20)}” in ${target || 'the select'}`;
    case 'press_key':
      return `Press ${args.key || 'a key'}`;
    case 'scroll_page':
      return `Scroll ${args.direction || 'down'}`;
    case 'open_url':
      return `Open ${clip(args.url, 60)}`;
    case 'inspect_page':
      return args.query ? `Find “${clip(args.query, 30)}”` : 'Inspect page';
    case 'wait_for':
      return `Wait for ${clip(args.text || args.selector || 'the page', 30)}`;
    case 'read_page':
      return 'Read page text';
    case 'control_media': {
      const percent = args.percent != null ? ` ${args.percent}%` : '';
      const seconds = args.seconds != null ? ` ${args.seconds}s` : '';
      switch (args.action) {
        case 'play':
          return 'Play';
        case 'pause':
          return 'Pause';
        case 'toggle':
          return 'Toggle play/pause';
        case 'seek':
          return `Seek to${percent || seconds || ' a position'}`;
        case 'seek_by':
          return `Skip ${Number(args.seconds) < 0 ? 'back' : 'forward'} ${Math.abs(Number(args.seconds) || 0)}s`;
        case 'volume':
          return `Set volume to ${args.volume != null ? Math.round(args.volume * 100) : args.percent}%`;
        case 'mute':
          return 'Mute';
        case 'unmute':
          return 'Unmute';
        case 'toggle_mute':
          return 'Toggle mute';
        case 'rate':
          return `Set speed to ${args.rate}x`;
        default:
          return 'Read playback state';
      }
    }
    case 'drag': {
      const from = args.from?.selector || args.from?.ref || args.from?.text || 'start';
      const to =
        args.to?.selector ||
        args.to?.ref ||
        args.to?.text ||
        (args.dx != null ? `move right ${args.dx}px` : 'target');
      return `Drag ${clip(from, 24)} → ${clip(to, 24)}`;
    }
    case 'set_range':
      return `Set ${target || 'range'} to ${args.percent != null ? `${args.percent}%` : args.value}`;
    case 'hover':
      return `Hover ${target || 'element'}`;
    default:
      return label;
  }
}

export function actionStatusLabel(status) {
  if (getLocale() === 'en') {
    return (
      {
        running: 'Running',
        ok: 'Done',
        error: 'Failed',
        skipped: 'Skipped',
        pending: 'Pending',
      }[status] || ''
    );
  }
  return (
    {
      running: '执行中',
      ok: '完成',
      error: '失败',
      skipped: '已跳过',
      pending: '准备中',
    }[status] || ''
  );
}

export function buildActionsPrompt(maxSteps) {
  return getLocale() === 'en'
    ? [
        `## Page actions (up to ${maxSteps} rounds)`,
        'You have permission to operate the active tab: click, type, drag, scroll, and control video/audio. Never claim you lack browser control.',
        'Call the tools directly instead of only giving advice:',
        '- Start with `inspect_page` (text or CSS selector) to find the target and get a ref; you can also use a selector or visible text directly.',
        '- Do one key action at a time and read the result before deciding the next step; if an action fails twice, change approach or stop and explain.',
        '- If nothing changes after a click or typing, use `inspect_page` or `wait_for` before retrying blindly.',
        '- For irreversible actions (pay, order, delete, send, sign out): state what you will do first and wait for the user to confirm before calling the tool.',
        '- Never type passwords, OTPs, card numbers, or ID numbers; stop and ask the user to fill them.',
        '- After navigating, use `read_page` to get the new content.',
        '- Video/audio pages: use `control_media` to play, pause, seek (percent 0-100 or seconds), set volume/rate; never claim you cannot operate the player.',
        '- Native sliders (volume/progress) use `set_range`; custom progress bars and sliders use `drag` (from/to or dx).',
        "- If text extraction failed, you can still use `inspect_page` to inspect the live DOM; do not assume the page cannot be operated.",
        '- Finish with one or two sentences about what you did and the result; do not dump tool JSON.',
      ].join('\n')
    : [
        `## 页面操作（最多 ${maxSteps} 轮）`,
        '你已经获得当前标签页的操作权限：可以点击、输入、拖拽、滚动、控制视频/音频。不要声称“没有浏览器控制权”。',
        '你可以调用工具直接操作当前标签页，而不是只给建议：',
        '- 先 `inspect_page`（文字或 CSS 选择器）确认目标，拿到 ref；也可以用 selector 或可见文字直接定位。',
        '- 一次只做一个关键动作，看返回结果再决定下一步；同一个动作失败两次就换方法或停下来说明。',
        '- 点击/输入后若页面没有变化，先 `inspect_page` 或 `wait_for` 再判断，不要盲目重复。',
        '- 涉及支付、下单、删除、发送、退出登录等不可逆动作：先用一句话说明你要做什么，等用户确认后再调用工具。',
        '- 绝对不要填写密码、验证码、银行卡、身份证号；遇到这类字段就停下，让用户自己填。',
        '- 导航到新页面后，用 `read_page` 重新获取内容。',
        '- 视频/音频页面：用 `control_media` 播放、暂停、跳转（percent 0-100 或 seconds）、调音量/倍速；不要声称你看不到播放器就无法操作。',
        '- 原生滑块（音量、进度条）用 `set_range`；自定义进度条/滑块用 `drag`（可用 from/to 或 dx）。',
        '- 页面正文提取失败时，仍然可以用 `inspect_page` 查看实时 DOM；不要因为读不到正文就断定不能操作。',
        '- 操作完成后，用一两句话说明你做了什么、结果如何；不要展示工具 JSON。',
      ].join('\n');
}
