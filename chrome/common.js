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

// Slim projection of the extension state for comment pages: exactly the
// fields the content script renders from, so anything else — and anything
// sensitive: writable-list private keys, per-list blocked copies,
// localBlockedUsers, API config — stays out of page context unless listed
// here. Applied by the worker's getState reply and by the content script's
// storage.onChanged path, so both routes stay slim. combinedWithoutTransient
// passes through undefined when absent: legacy states rely on the
// `|| combined` fallback in updateBlockedSets, which a default [] would
// defeat. highlighted.sourceLists stays — per-list highlight styles are
// resolved from it.
function toPageState(full) {
  const blocked = (full && full.blocked) || {};
  const highlighted = (full && full.highlighted) || {};
  return {
    hideGreenComments: !!(full && full.hideGreenComments),
    subscribedLists: (full && full.subscribedLists) || [],
    highlightColors: (full && full.highlightColors) || {},
    highlightedUsers: (full && full.highlightedUsers) || [],
    blocked: {
      combined: blocked.combined || [],
      combinedWithoutTransient: blocked.combinedWithoutTransient,
      transientOnly: blocked.transientOnly || [],
      localPatterns: blocked.localPatterns || []
    },
    highlighted: {
      combined: highlighted.combined || [],
      sourceLists: highlighted.sourceLists || {}
    }
  };
}

// Public view of writableLists for message replies: what a chooser UI needs
// to offer a list (identity, name, kind, API host) and nothing more. The
// private signing keys never leave the service worker — it re-reads them
// from its own storage when asked to sign — so no reply should carry them.
function toPublicWritableLists(lists) {
  return (Array.isArray(lists) ? lists : []).map((l) => ({
    publicKey: (l && l.publicKey) || '',
    label: l && l.label,
    type: l && l.type,
    baseUrl: l && l.baseUrl
  }));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEFAULT_HIGHLIGHT_STYLE, normalizeHexColor, normalizeHighlightStyle, toPageState, toPublicWritableLists };
}
