/**
 * High-level task playbooks exposed to the model through the `skill` tool.
 * These are prompts, not executable shortcuts; the model still observes,
 * acts, and verifies with the page tools.
 */

const SKILLS = {
  form: {
    label: { zh: '填写表单', en: 'Fill a form' },
    summary: {
      zh: '检查字段 → 填写/选择/勾选 → 读回验证 → 需要时提交',
      en: 'Inspect fields → fill/select/check → read back → submit only if asked',
    },
    steps: {
      zh: [
        '先用 inspect_page 查看表单字段，确认每个字段的 ref、类型、是否必填/禁用。',
        '一次填一个字段：type_text 填文本，select_option 选原生下拉，check/uncheck 处理勾选。',
        '每填完一个字段，用 get_element_info 或下一次 inspect_page 读回实际值；不匹配就修正。',
        '密码、验证码、银行卡、身份证字段不要填写，停下来让用户自己处理。',
        '用户明确要求提交时才点击提交按钮；提交前用一句话说明将要提交什么。',
        '提交后 wait_for 成功文本或 URL 变化；不能确认时标记 uncertain，不要重复提交。',
      ],
      en: [
        'Use inspect_page to list fields and confirm each ref, type, and disabled/required state.',
        'Fill one field at a time: type_text for text, select_option for native selects, check/uncheck for toggles.',
        'After each field, use get_element_info or inspect_page to read the actual value back; fix mismatches.',
        'Never fill passwords, OTPs, card numbers, or government IDs; stop and ask the user.',
        'Click submit only when the user explicitly asked; state what will be submitted first.',
        'After submit, wait_for success text or a URL change; mark uncertain instead of retrying a submit.',
      ],
    },
  },
  media: {
    label: { zh: '控制视频/音频', en: 'Control media' },
    summary: {
      zh: '先读状态 → 播放/跳转/音量/倍速 → 读回状态验证',
      en: 'Read state → play/seek/volume/rate → read the state back',
    },
    steps: {
      zh: [
        '先调用 control_media 的 action=status，确认当前时间、总时长、暂停状态、音量和倍速。',
        '跳转优先用 percent（0-100）或 seconds；相对快进/后退用 seek_by。',
        '原生滑块用 set_range；自定义进度条用 drag，并在之后 status 验证 currentTime。',
        '音量用 volume（0-1）或 percent；静音用 mute/unmute/toggle_mute；倍速用 rate（0.25-4）。',
        '操作后用 status 或返回的 media 快照验证；没有变化就换策略，不要声称无法控制播放器。',
      ],
      en: [
        'Call control_media with action=status first; confirm currentTime, duration, paused, volume, and rate.',
        'Seek with percent (0-100) or seconds; use seek_by for relative skips.',
        'Use set_range for native sliders and drag for custom progress bars; verify currentTime afterwards.',
        'Volume accepts 0-1 or percent; mute/unmute/toggle_mute; rate is 0.25-4.',
        'Verify with status or the returned media snapshot; change strategy instead of claiming the player cannot be controlled.',
      ],
    },
  },
  extract: {
    label: { zh: '提取页面数据', en: 'Extract page data' },
    summary: {
      zh: '读正文/表格/链接 → 标注来源 → 不编造缺失数据',
      en: 'Read text/tables/links → cite the source → never invent missing data',
    },
    steps: {
      zh: [
        '先用 read_page 获取正文；需要结构化数据时用 inspect_page 定位表格/列表容器。',
        '用 get_element_info 读取具体节点的文本和属性；不要一次抓整页 HTML。',
        '数字、日期、价格必须来自页面原文；缺失就写“页面中未找到”。',
        '长页面只保留与问题相关的片段，并说明是否被截断。',
      ],
      en: [
        'Use read_page for the body; use inspect_page to locate tables/lists when you need structure.',
        'Use get_element_info for a node’s text and attributes; do not dump the whole page HTML.',
        'Numbers, dates, and prices must come from the page; write “not found on the page” when missing.',
        'Keep only relevant excerpts from long pages and say when content was truncated.',
      ],
    },
  },
  navigate: {
    label: { zh: '导航与标签页', en: 'Navigate and tabs' },
    summary: {
      zh: '打开/后退/前进/刷新/切换标签页 → 等加载 → 重新观察',
      en: 'Open/back/forward/reload/switch tabs → wait → observe again',
    },
    steps: {
      zh: [
        '打开链接用 open_url；需要保留当前页时传 new_tab=true。',
        '历史后退/前进/刷新/切换/关闭标签页用 tab_control。',
        '导航后先 wait_for 目标文本或 selector，再 read_page；旧 ref 和 snapshot 已失效。',
        '不要操作浏览器地址栏、扩展管理页、PDF 阅读器等扩展无法注入的界面。',
      ],
      en: [
        'Use open_url to open a link; pass new_tab=true to keep the current page.',
        'Use tab_control for back/forward/reload/activate/close/list.',
        'After navigation, wait_for the target text or selector, then read_page; old refs and snapshots are stale.',
        'Do not try to operate the browser address bar, extension manager, PDF viewer, or other protected UI.',
      ],
    },
  },
  verify: {
    label: { zh: '验证操作结果', en: 'Verify an action' },
    summary: {
      zh: '检查 URL/字段值/可见文本/媒体状态，区分成功、失败和不确定',
      en: 'Check URL/value/text/media state; distinguish success, failure, and uncertain',
    },
    steps: {
      zh: [
        '点击后先看 URL 是否变化；没有变化时用 inspect_page 或 wait_for 检查 DOM/文本。',
        '输入/选择/滑块必须读回实际值，不能只看“调用完成”。',
        '媒体操作读回 currentTime/volume/paused/rate；滚动读回 scrollY。',
        '超时、导航中断或结果不可见时标记 uncertain，不要自动重放点击/提交。',
        '把“页面明确显示”和“推断”分开写。',
      ],
      en: [
        'After a click, check whether the URL changed; if not, use inspect_page or wait_for to check the DOM/text.',
        'For input/select/range, read the actual value back; “the call completed” is not success.',
        'For media, read currentTime/volume/paused/rate; for scrolling, read scrollY.',
        'Mark uncertain on timeout, interrupted navigation, or an unobservable result; never auto-replay a click/submit.',
        'Separate “the page shows” from “I infer”.',
      ],
    },
  },
  inspect: {
    label: { zh: '检查界面', en: 'Inspect the UI' },
    summary: {
      zh: '列出可交互元素、Shadow DOM、禁用/遮挡状态和当前值',
      en: 'List interactive elements, open shadow DOM, disabled/covered state, and current values',
    },
    steps: {
      zh: [
        '先 inspect_page，不带 query 时按可视区域优先列出；元素多时用 query 过滤。',
        '选择器会搜索开放 Shadow DOM；关闭的 shadow root 仍无法访问。',
        '需要细节时用 get_element_info 读取文本、值、checked、selected、attributes 和位置。',
        '元素被遮挡或禁用时先处理遮挡/等待，再重试；不要反复点同一个无效目标。',
      ],
      en: [
        'Start with inspect_page; without a query it prioritizes the viewport. Filter with query when there are many elements.',
        'Selectors search open shadow roots; closed shadow roots remain inaccessible.',
        'Use get_element_info for text, value, checked, selected, attributes, and bounds.',
        'If an element is covered or disabled, resolve that first; do not keep clicking the same dead target.',
      ],
    },
  },
};

export function skillNames() {
  return Object.keys(SKILLS);
}

export function getSkill(name) {
  return SKILLS[String(name || '')] || null;
}

export function skillLabel(name, locale = 'zh') {
  const skill = getSkill(name);
  return skill ? skill.label[locale] || skill.label.zh : String(name || '');
}

export function buildSkillsPrompt(locale = 'zh') {
  const entries = Object.entries(SKILLS).map(([name, skill]) => {
    const summary = skill.summary[locale] || skill.summary.zh;
    return `- \`${name}\`: ${summary}`;
  });
  return locale === 'en'
    ? ['## Skills', 'Call `skill` with one of these names when a task matches; the tool returns a step-by-step playbook.', ...entries].join('\n')
    : ['## 技能', '任务匹配时调用 `skill` 获取分步操作手册，再按手册执行。', ...entries].join('\n');
}
