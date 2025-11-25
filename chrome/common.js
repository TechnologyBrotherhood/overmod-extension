// Shared helpers for Overmod extension

// Default highlight colors used across the extension
const DEFAULT_HIGHLIGHT_STYLE = { bg: '#fff8d1', fg: '#2d2d2d' };

function normalizeHexColor(value) {
  if (!value) return '';
  const s = String(value).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const lower = s.toLowerCase();
    return `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}`;
  }
  return '';
}

function normalizeHighlightStyle(value) {
  if (!value) return { bg: '', fg: '' };
  if (typeof value === 'string') {
    return { bg: normalizeHexColor(value), fg: '' };
  }
  if (typeof value === 'object') {
    return {
      bg: normalizeHexColor(value.bg),
      fg: normalizeHexColor(value.fg)
    };
  }
  return { bg: '', fg: '' };
}
