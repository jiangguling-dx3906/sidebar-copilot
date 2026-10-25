/**
 * Tool definitions handed to the model, plus display and safety helpers.
 * Execution lives in content.js (page side) and panel.js (wait/read wrappers).
 */

import { getLocale } from './i18n.js';
import { skillNames } from './skills.js';

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
    'List interactive elements on the current page (buttons, links, inputs, selects, and open shadow DOM) with refs, labels, bounds, values, and visibility. Use this before acting on a page.',
    {
      query: { type: 'string', description: 'Visible text or CSS selector; omit to list visible elements' },
      limit: { type: 'integer', description: 'Maximum elements to return, 1-80 (default 24)' },
    },
  ),
  fn(
    'click',
    'Click an element by ref, CSS selector, visible text, or viewport coordinates. Returns the element, URL, and verification state.',
    {
      ...locate,
      x: { type: 'number', description: 'Viewport X coordinate (alternative to ref/selector/text)' },
      y: { type: 'number', description: 'Viewport Y coordinate (alternative to ref/selector/text)' },
    },
  ),
  fn('double_click', 'Double-click an element by ref, CSS selector, or visible text.', locate),
  fn('right_click', 'Open the context menu on an element (right-click).', locate),
  fn('focus', 'Focus an element without clicking it, so keyboard input goes there.', locate),
  fn('clear', 'Clear an input, textarea, or contenteditable element.', locate),
  fn('check', 'Check a checkbox or select a radio button.', locate),
  fn('uncheck', 'Uncheck a checkbox.', locate),
  fn('select_text', 'Select all text inside an input, textarea, or contenteditable element.', locate),
  fn(
    'get_element_info',
    'Read one element’s text, value, checked/selected state, attributes, bounds, and disabled/visible state. Use it to verify an action or inspect a node.',
    locate,
  ),
  fn(
    'scroll_inside',
    'Scroll inside a scrollable element (dialog, list, panel) by direction and amount, or to an element inside it.',
    {
      ref: locate.ref,
      selector: locate.selector,
      direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: 'Direction (default down)' },
      amount: { type: 'integer', description: 'Pixels to scroll; defaults to about 0.8 of the element height' },
    },
  ),
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
    'Send a key press to the focused element or a target, with optional modifiers (Control, Shift, Alt, Meta). Examples: Enter, Tab, Escape, Control+A.',
    {
      key: { type: 'string', description: 'Key name, e.g. "Enter", "A", "ArrowDown"' },
      modifiers: {
        type: 'array',
        items: { type: 'string', enum: ['Control', 'Shift', 'Alt', 'Meta'] },
        description: 'Modifier keys held during the press',
      },
      repeat: { type: 'integer', description: 'Repeat count, 1-20 (default 1)' },
      ref: locate.ref,
      selector: locate.selector,
    },
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
    'Open an http(s) URL in the current tab, or in a new tab when new_tab is true. The page content changes after navigation.',
    {
      url: { type: 'string', description: 'Full http(s) URL' },
      new_tab: { type: 'boolean', description: 'Open in a new tab instead of the current tab' },
    },
    ['url'],
  ),
  fn('read_page', 'Re-read the current page text after navigation or updates, including media state.', {}),
  fn(
    'wait_for',
    'Wait up to 30 seconds for text or an element to appear, or to disappear when state is hidden.',
    {
      text: { type: 'string', description: 'Visible text to wait for' },
      selector: { type: 'string', description: 'CSS selector to wait for' },
      state: { type: 'string', enum: ['visible', 'hidden'], description: 'Wait for visible (default) or hidden' },
      timeout_ms: { type: 'integer', description: 'Timeout in milliseconds (default 5000, max 30000)' },
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
  fn(
    'tab_control',
    'List, open, activate, close, reload, or navigate browser tabs (back/forward). Use after inspecting tabs when a task needs another tab.',
    {
      action: {
        type: 'string',
        enum: ['list', 'new', 'activate', 'close', 'reload', 'back', 'forward'],
        description: 'Tab operation',
      },
      tab_id: { type: 'integer', description: 'Target tab id for activate/close/reload/back/forward' },
      url: { type: 'string', description: 'URL for action=new (http/https)' },
    },
    ['action'],
  ),
  fn(
    'skill',
    'Load a step-by-step playbook for a common task before acting. Use it when the task matches a skill.',
    {
      name: { type: 'string', enum: skillNames(), description: 'Skill name' },
    },
    ['name'],
  ),
];

const RISKY_ZH = /(支付|付款|购买|下单|提交订单|确认支付|确认|提交|删除|移除|清空|注销|退出登录|解绑|转账|充值|发送|发布|同意|授权)/;
const RISKY_EN =
  /\b(pay|payment|purchase|buy|order|checkout|delete|remove|clear|sign out|log out|unsubscribe|transfer|top up|send|publish|submit|confirm|authorize|agree)\b/i;

export function isRiskyAction(name, args) {
  if (name === 'tab_control' && args?.action === 'close') return true;
  if (!['click', 'double_click', 'right_click', 'type_text', 'select_option', 'check', 'uncheck', 'press_key'].includes(name)) return false;
  if (name === 'press_key') return args?.key === 'Enter' || (args?.modifiers || []).length > 0;
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
    double_click: '双击',
    right_click: '右键点击',
    focus: '聚焦',
    clear: '清空',
    check: '勾选',
    uncheck: '取消勾选',
    select_text: '全选文本',
    get_element_info: '读取元素',
    scroll_inside: '容器内滚动',
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
    tab_control: '标签页',
    skill: '加载技能',
  }[name] || name;
  const target = targetOf(args, ['click', 'double_click', 'right_click', 'focus', 'hover'].includes(name));

  switch (name) {
    case 'click':
    case 'double_click':
    case 'right_click':
      return target ? `${label} ${target}` : label;
    case 'focus':
      return `聚焦 ${target || '元素'}`;
    case 'clear':
      return `清空 ${target || '输入框'}`;
    case 'check':
      return `勾选 ${target || '复选框'}`;
    case 'uncheck':
      return `取消勾选 ${target || '复选框'}`;
    case 'select_text':
      return `全选 ${target || '输入框'} 的文本`;
    case 'get_element_info':
      return `读取 ${target || '元素'} 的信息`;
    case 'scroll_inside':
      return `在 ${target || '容器'} 内滚动 ${args.direction || 'down'}`;
    case 'tab_control':
      return {
        list: '列出标签页',
        new: `新建标签页 ${clip(args.url, 50)}`,
        activate: `切换到标签页 ${args.tab_id ?? ''}`,
        close: `关闭标签页 ${args.tab_id ?? ''}`,
        reload: `刷新标签页 ${args.tab_id ?? ''}`,
        back: '后退',
        forward: '前进',
      }[args.action] || '标签页操作';
    case 'skill':
      return `加载技能 ${args.name || ''}`;
    case 'type_text':
      return `在 ${target || '输入框'} 输入 “${clip(args.text, 20)}”${args.submit ? ' 并提交' : ''}`;
    case 'select_option':
      return `在 ${target || '下拉框'} 选择 “${clip(args.option, 20)}”`;
    case 'press_key':
      return `按下 ${[...(args.modifiers || []), args.key || '按键'].join('+')}${Number(args.repeat) > 1 ? ` ×${args.repeat}` : ''}`;
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
    double_click: 'Double-click',
    right_click: 'Right-click',
    focus: 'Focus',
    clear: 'Clear',
    check: 'Check',
    uncheck: 'Uncheck',
    select_text: 'Select text',
    get_element_info: 'Read element',
    scroll_inside: 'Scroll inside',
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
    tab_control: 'Tab',
    skill: 'Load skill',
  }[name] || name;
  const target = targetOf(args, ['click', 'double_click', 'right_click', 'focus', 'hover'].includes(name));

  switch (name) {
    case 'click':
    case 'double_click':
    case 'right_click':
      return target ? `${label} ${target}` : label;
    case 'focus':
      return `Focus ${target || 'element'}`;
    case 'clear':
      return `Clear ${target || 'input'}`;
    case 'check':
      return `Check ${target || 'checkbox'}`;
    case 'uncheck':
      return `Uncheck ${target || 'checkbox'}`;
    case 'select_text':
      return `Select text in ${target || 'input'}`;
    case 'get_element_info':
      return `Read ${target || 'element'}`;
    case 'scroll_inside':
      return `Scroll ${args.direction || 'down'} inside ${target || 'container'}`;
    case 'tab_control':
      return {
        list: 'List tabs',
        new: `Open a new tab ${clip(args.url, 50)}`,
        activate: `Activate tab ${args.tab_id ?? ''}`,
        close: `Close tab ${args.tab_id ?? ''}`,
        reload: `Reload tab ${args.tab_id ?? ''}`,
        back: 'Go back',
        forward: 'Go forward',
      }[args.action] || 'Tab operation';
    case 'skill':
      return `Load skill ${args.name || ''}`;
    case 'type_text':
      return `Type “${clip(args.text, 20)}” into ${target || 'the input'}${args.submit ? ' and submit' : ''}`;
    case 'select_option':
      return `Select “${clip(args.option, 20)}” in ${target || 'the select'}`;
    case 'press_key':
      return `Press ${[...(args.modifiers || []), args.key || 'a key'].join('+')}${Number(args.repeat) > 1 ? ` ×${args.repeat}` : ''}`;
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
        uncertain: 'Uncertain',
        error: 'Failed',
        skipped: 'Skipped',
        cancelled: 'Cancelled',
        pending: 'Pending',
      }[status] || ''
    );
  }
  return (
    {
      running: '执行中',
      ok: '完成',
      uncertain: '待确认',
      error: '失败',
      skipped: '已跳过',
      cancelled: '已取消',
      pending: '准备中',
    }[status] || ''
  );
}

export function buildActionsPrompt(maxSteps) {
  return getLocale() === 'en'
    ? [
        '## Page actions (keep going until done)',
        `You can keep calling tools until the task is complete. Do not stop after an arbitrary small number of steps. Stop only when the user presses Stop, you have verified the goal, or the safety cap of ${maxSteps} steps is reached.`,
        'You have permission to operate the active tab: click, type, drag, scroll, switch tabs, and control video/audio. Never claim you lack browser control.',
        'Call the tools directly instead of only giving advice:',
        '- Call `skill` first when the task matches a playbook (form, media, extract, navigate, verify, inspect).',
        '- Start with `inspect_page` to get refs and the current snapshot; then act one key step at a time and read the result.',
        '- Target binding: after navigation or a document change, inspect again; never reuse a stale ref or snapshot.',
        '- Each result may say `verified`, `postcondition`, or `uncertain`. If uncertain, observe again instead of replaying a click/submit.',
        '- Prefer specific tools: `check`/`uncheck`, `clear`, `focus`, `select_text`, `get_element_info`, `scroll_inside`, `double_click`, `right_click`, `tab_control`.',
        '- Native sliders use `set_range`; custom progress bars/sliders use `drag`; video/audio use `control_media`.',
        '- For irreversible actions (pay, order, delete, send, sign out, close tab): state what you will do and wait for the user to confirm.',
        '- Never type passwords, OTPs, card numbers, or ID numbers; stop and ask the user to fill them.',
        '- Do not operate browser chrome, extension manager, PDF viewer, or other protected UI; return a clear unsupported error instead.',
        '- Finish with one or two sentences about what you did, what was verified, and anything uncertain; do not dump tool JSON.',
      ].join('\n')
    : [
        '## 页面操作（持续执行直到完成）',
        `你可以持续调用工具直到任务完成，不要因为“轮数”提前停。只有用户点停止、你确认完成、或达到 ${maxSteps} 步安全上限时才停。`,
        '你已经获得当前标签页的操作权限：可以点击、输入、拖拽、滚动、切换标签页、控制视频/音频。不要声称“没有浏览器控制权”。',
        '优先调用工具直接操作，而不是只给建议：',
        '- 任务匹配时先调用 `skill` 获取 playbook（form、media、extract、navigate、verify、inspect）。',
        '- 先 `inspect_page` 拿 ref 和当前快照；然后一次做一个关键动作，看返回结果再决定下一步。',
        '- 目标绑定：页面导航或文档变化后必须重新 inspect；不要复用旧 ref 或旧快照。',
        '- 结果里可能有 `verified`、`postcondition`、`uncertain`。遇到 uncertain 先重新观察，不要重复点击/提交。',
        '- 优先用专门工具：`check`/`uncheck`、`clear`、`focus`、`select_text`、`get_element_info`、`scroll_inside`、`double_click`、`right_click`、`tab_control`。',
        '- 原生滑块用 `set_range`；自定义进度条/滑块用 `drag`；视频/音频用 `control_media`。',
        '- 涉及支付、下单、删除、发送、退出登录、关闭标签页等不可逆动作：先说明你要做什么，等用户确认后再调用工具。',
        '- 绝对不要填写密码、验证码、银行卡、身份证号；遇到这类字段就停下，让用户自己填。',
        '- 不要操作浏览器地址栏、扩展管理页、PDF 阅读器等受保护界面；明确返回不支持，而不是硬试。',
        '- 操作完成后，用一两句话说明你做了什么、验证了什么、还有什么不确定；不要展示工具 JSON。',
      ].join('\n');
}
