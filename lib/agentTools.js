/**
 * Tool definitions handed to the model, plus display and safety helpers.
 * Execution lives in content.js (page side) and panel.js (wait/read wrappers).
 */

const locate = {
  ref: { type: 'string', description: '元素引用，来自最近一次 inspect_page 的结果，例如 "e12"' },
  selector: { type: 'string', description: 'CSS 选择器，例如 "#login" 或 "button[type=submit]"' },
  text: { type: 'string', description: '元素的可见文字，例如 "登录"（精确匹配优先）' },
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
    '查看当前页面里可交互的元素（按钮、链接、输入框、下拉框），返回带 ref 的清单。可以用可见文字或 CSS 选择器过滤。操作页面前先用它确认目标。',
    {
      query: { type: 'string', description: '可见文字或 CSS 选择器；留空则列出当前可见元素' },
      limit: { type: 'integer', description: '最多返回多少个元素，1-40，默认 20' },
    },
  ),
  fn(
    'click',
    '点击页面元素。用 ref、selector 或 text 三选一定位。点击后返回新 URL 和元素信息。',
    locate,
  ),
  fn(
    'type_text',
    '在输入框、文本域或 contenteditable 元素里填写文字。可选择按 Enter 提交。禁止用于密码、验证码、银行卡字段。',
    {
      ref: locate.ref,
      selector: locate.selector,
      text: { type: 'string', description: '要填入的文字' },
      submit: { type: 'boolean', description: '填完后按 Enter 提交，默认 false' },
      clear: { type: 'boolean', description: '先清空原有内容，默认 true' },
    },
    ['text'],
  ),
  fn(
    'select_option',
    '在原生 <select> 下拉框中选择选项，按选项文字或 value 匹配。',
    {
      ref: locate.ref,
      selector: locate.selector,
      option: { type: 'string', description: '选项的可见文字或 value' },
    },
    ['option'],
  ),
  fn('press_key', '向当前焦点元素发送按键，例如 Enter、Escape、Tab、ArrowDown。', {
    key: { type: 'string', description: '键名，例如 "Enter"' },
  }, ['key']),
  fn(
    'scroll_page',
    '滚动页面。可以按方向滚动，也可以把某个元素滚动到视野内。',
    {
      direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: '滚动方向，默认 down' },
      amount: { type: 'integer', description: '滚动像素，默认约 0.8 屏' },
      ref: locate.ref,
      selector: locate.selector,
    },
  ),
  fn('open_url', '在当前标签页打开一个 http(s) 链接。导航后页面内容会变化。', {
    url: { type: 'string', description: '完整的 http(s) URL' },
  }, ['url']),
  fn('read_page', '重新读取当前页面的正文（导航或页面更新后用），返回截断后的文本。', {}),
  fn(
    'wait_for',
    '等待某个文字或元素出现，最多 15 秒。用于页面加载、弹窗出现之后。',
    {
      text: { type: 'string', description: '等待出现的可见文字' },
      selector: { type: 'string', description: '等待出现的 CSS 选择器' },
      timeout_ms: { type: 'integer', description: '超时毫秒数，默认 5000，最大 15000' },
    },
  ),
  fn(
    'control_media',
    '控制页面里的视频/音频：播放、暂停、跳转进度、调音量、静音、倍速。视频进度优先用这个工具，percent 是 0-100。',
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
        description: '要执行的操作',
      },
      percent: { type: 'number', description: 'seek 或 volume 的百分比（0-100）' },
      seconds: { type: 'number', description: 'seek 的秒数；seek_by 的增量秒数，可为负' },
      volume: { type: 'number', description: '音量 0-1' },
      rate: { type: 'number', description: '倍速 0.25-4' },
      ref: locate.ref,
      selector: locate.selector,
    },
    ['action'],
  ),
  fn(
    'drag',
    '按住一个元素拖到另一个位置，用于拖动视频进度条、自定义滑块、排序列表。from/to 可用 ref、selector、text 或坐标 x/y；也可以用 dx/dy 相对拖动。',
    {
      from: {
        type: 'object',
        description: '起点：{ref|selector|text|x,y}',
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
        description: '终点：{ref|selector|text|x,y}',
        properties: {
          ref: locate.ref,
          selector: locate.selector,
          text: locate.text,
          x: { type: 'number' },
          y: { type: 'number' },
        },
      },
      dx: { type: 'number', description: '相对起点的横向位移（没有 to 时使用）' },
      dy: { type: 'number', description: '相对起点的纵向位移（没有 to 时使用）' },
      steps: { type: 'integer', description: '拖动过程分几步，默认 12' },
    },
    ['from'],
  ),
  fn(
    'set_range',
    '设置原生 <input type=range> 滑块的值，例如音量条、设置页滑块。用 percent(0-100) 或 value。',
    {
      ref: locate.ref,
      selector: locate.selector,
      percent: { type: 'number', description: '目标百分比 0-100' },
      value: { type: 'number', description: '目标数值（与 percent 二选一）' },
    },
  ),
  fn('hover', '把鼠标移到元素上，用于展开悬停菜单或提示。', {
    ref: locate.ref,
    selector: locate.selector,
    text: locate.text,
  }),
];

export const ACTION_LABELS = {
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
};

const RISKY = /(支付|付款|购买|下单|提交订单|确认支付|确认|提交|删除|移除|清空|注销|退出登录|解绑|转账|充值|发送|发布|同意|授权)/;

export function isRiskyAction(name, args) {
  if (!['click', 'type_text', 'select_option', 'press_key'].includes(name)) return false;
  if (name === 'press_key') return args?.key === 'Enter';
  const probe = [args?.text, args?.selector, args?.option].filter(Boolean).join(' ');
  return RISKY.test(probe);
}

function clip(value, length) {
  const text = String(value ?? '');
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

export function describeAction(name, args = {}) {
  const label = ACTION_LABELS[name] || name;
  const target =
    (name === 'click' || name === 'hover') && args.text
      ? `“${clip(args.text, 24)}”`
      : args.selector || args.ref || (name === 'click' ? '' : '');

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
      return `把 ${target || '滑块'} 设为 ${
        args.percent != null ? `${args.percent}%` : args.value
      }`;
    case 'hover':
      return `悬停 ${target || '元素'}`;
    default:
      return label;
  }
}

export function actionStatusLabel(status) {
  switch (status) {
    case 'running':
      return '执行中';
    case 'ok':
      return '完成';
    case 'error':
      return '失败';
    case 'skipped':
      return '已跳过';
    case 'pending':
      return '准备中';
    default:
      return '';
  }
}

export function buildActionsPrompt(maxSteps) {
  return [
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
