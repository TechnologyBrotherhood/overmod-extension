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

// Apply a confirmed remote-list write to the cached list data and rebuild the
// derived sets consumed by comment pages. This makes writes visible locally
// without waiting for a follow-up GET of the whole list.
function applyListUserMutation(full, mutation) {
  const state = full || {};
  const publicKey = String(mutation && mutation.publicKey || '').trim();
  const username = String(mutation && mutation.username || '').trim();
  if (!publicKey || !username) return state;

  const usernameLower = username.toLowerCase();
  const listType = String(mutation.listType || 'block').toLowerCase() === 'highlight'
    ? 'highlight'
    : 'block';
  const remove = mutation.action === 'remove';
  const subscribedLists = Array.isArray(state.subscribedLists)
    ? state.subscribedLists.slice()
    : [];
  if (!subscribedLists.includes(publicKey)) subscribedLists.push(publicKey);

  const subscribedOverrides = { ...(state.subscribedOverrides || {}), [publicKey]: listType };
  const blockedSources = { ...((state.blocked && state.blocked.sourceLists) || {}) };
  const highlightedSources = { ...((state.highlighted && state.highlighted.sourceLists) || {}) };
  const targetSources = listType === 'highlight' ? highlightedSources : blockedSources;
  const otherSources = listType === 'highlight' ? blockedSources : highlightedSources;

  let targetUsers = Array.isArray(targetSources[publicKey])
    ? targetSources[publicKey].slice()
    : [];
  if (remove) {
    targetUsers = targetUsers.filter((name) => String(name).toLowerCase() !== usernameLower);
  } else if (!targetUsers.some((name) => String(name).toLowerCase() === usernameLower)) {
    targetUsers.push(username);
  }
  targetSources[publicKey] = targetUsers;
  // A list has one effective type. Avoid retaining an obsolete copy if its
  // type was changed before this write.
  delete otherSources[publicKey];

  const decision = new Map();
  const decisionPersistent = new Map();
  const addDecision = (name, type, persistent) => {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return;
    if (!decision.has(key)) decision.set(key, type);
    if (persistent && !decisionPersistent.has(key)) decisionPersistent.set(key, type);
  };

  for (const name of state.highlightedUsers || []) addDecision(name, 'highlight', true);
  const localPatterns = [];
  for (const name of state.localBlockedUsers || []) {
    const value = String(name || '').trim();
    if (!value) continue;
    if (/[.*+?^${}()|[\]\\]/.test(value)) localPatterns.push(value);
    else addDecision(value, 'block', true);
  }

  const transientLists = state.transientLists || {};
  for (const pk of subscribedLists) {
    const type = subscribedOverrides[pk]
      || (Object.prototype.hasOwnProperty.call(highlightedSources, pk) ? 'highlight' : 'block');
    const users = type === 'highlight' ? (highlightedSources[pk] || []) : (blockedSources[pk] || []);
    const persistent = !(type === 'block' && transientLists[pk]);
    for (const name of users) addDecision(name, type, persistent);
  }

  const combined = [];
  const combinedWithoutTransient = [];
  const highlightedCombined = [];
  for (const [name, type] of decision) {
    (type === 'highlight' ? highlightedCombined : combined).push(name);
  }
  for (const [name, type] of decisionPersistent) {
    if (type === 'block') combinedWithoutTransient.push(name);
  }
  combined.sort();
  combinedWithoutTransient.sort();
  highlightedCombined.sort();
  const persistentSet = new Set(combinedWithoutTransient);

  return {
    ...state,
    subscribedLists,
    subscribedOverrides,
    blocked: {
      ...(state.blocked || {}),
      combined,
      combinedWithoutTransient,
      transientOnly: combined.filter((name) => !persistentSet.has(name)),
      localPatterns,
      sourceLists: blockedSources
    },
    highlighted: {
      ...(state.highlighted || {}),
      combined: highlightedCombined,
      sourceLists: highlightedSources
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEFAULT_HIGHLIGHT_STYLE, normalizeHexColor, normalizeHighlightStyle, toPageState, toPublicWritableLists, applyListUserMutation };
}
