const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normalizeHex(value) {
  const text = String(value || '').trim();
  if (!HEX.test(text)) return null;
  if (text.length === 4) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toLowerCase();
  }
  return text.toLowerCase();
}

function toRgb(hex) {
  const value = normalizeHex(hex);
  if (!value) return null;
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
  };
}

function toHex({ r, g, b }) {
  const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${[r, g, b].map((channel) => clamp(channel).toString(16).padStart(2, '0')).join('')}`;
}

export function mixHex(base, overlay, amount) {
  const a = toRgb(base);
  const b = toRgb(overlay);
  if (!a || !b) return base;
  const ratio = Math.max(0, Math.min(1, Number(amount) || 0));
  return toHex({
    r: a.r + (b.r - a.r) * ratio,
    g: a.g + (b.g - a.g) * ratio,
    b: a.b + (b.b - a.b) * ratio,
  });
}

export function isDarkColor(hex) {
  const rgb = toRgb(hex);
  if (!rgb) return false;
  const channel = (value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  return luminance < 0.45;
}

/**
 * Returns CSS custom properties for a custom panel background, or null when the
 * input is empty/invalid (meaning "use the default theme").
 */
export function buildPanelTheme(value) {
  const hex = normalizeHex(value);
  if (!hex) return null;

  const dark = isDarkColor(hex);
  const toward = dark ? '#ffffff' : '#000000';
  const shade = (amount) => mixHex(hex, toward, amount);

  return {
    '--bg': hex,
    '--bg-soft': shade(0.04),
    '--bg-elevated': shade(0.03),
    '--border': shade(0.12),
    '--border-strong': shade(0.2),
    '--text': dark ? '#eef0f6' : '#171a21',
    '--muted': dark ? '#a8afbd' : '#6b7280',
    '--muted-soft': dark ? '#7d8492' : '#9aa1ae',
    '--accent-soft': mixHex(hex, '#6366f1', 0.18),
    '--accent-text': dark ? '#c7c8ff' : '#4338ca',
    '--code-bg': shade(0.06),
    '--danger-soft': mixHex(hex, '#ef4444', 0.12),
    '--warn-soft': mixHex(hex, '#f59e0b', 0.14),
    '--ok-soft': mixHex(hex, '#22c55e', 0.12),
    '--shadow': '0 1px 2px rgba(0, 0, 0, 0.12)',
  };
}

export function applyPanelTheme(value, root = globalThis.document?.documentElement) {
  if (!root) return;
  const vars = [
    '--bg',
    '--bg-soft',
    '--bg-elevated',
    '--border',
    '--border-strong',
    '--text',
    '--muted',
    '--muted-soft',
    '--accent-soft',
    '--accent-text',
    '--code-bg',
    '--danger-soft',
    '--warn-soft',
    '--ok-soft',
    '--shadow',
  ];
  const theme = buildPanelTheme(value);
  if (!theme) {
    for (const name of vars) root.style.removeProperty(name);
    return;
  }
  for (const [name, color] of Object.entries(theme)) root.style.setProperty(name, color);
}
