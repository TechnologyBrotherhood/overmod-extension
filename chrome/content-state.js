// Page state management and entry point for the Overmod content script.
// Operates on a ctx object that holds mutable page-level state,
// and an index array of comment rows built by content.js.

function toLowerSet(arr) {
  return new Set((arr || []).map(s => String(s).toLowerCase()));
}

function updateBlockedSets(ctx) {
  const st = ctx.state;
  const patterns = st?.blocked?.localPatterns || [];
  ctx.blockedAll = createMatchSet(st?.blocked?.combined, patterns);
  ctx.blockedPersistent = createMatchSet(st?.blocked?.combinedWithoutTransient || st?.blocked?.combined, patterns);
}

function applyCurrentBlocking(ctx, index) {
  const activeSet = ctx.transientActive ? ctx.blockedPersistent : ctx.blockedAll;
  let effectiveSet = activeSet;
  const pageUser = isThreadsPage() && getUserPageUsername().toLowerCase();
  if (pageUser && activeSet.has(pageUser)) {
    // Wrap the active set to exclude the page owner on their threads page
    effectiveSet = {
      get size() { return Math.max(0, activeSet.size - 1); },
      has(name) { return name !== pageUser && activeSet.has(name); }
    };
  }
  applyBlocking(index, effectiveSet);
  if (!ctx.greenShowing) applyGreenHiding(index);
  renderRemovedBanner(index, effectiveSet);
}

function rerenderHeader(ctx, index) {
  const counts = getHeaderCounts(ctx.state, index);
  renderHeader(
    counts,
    (enabled) => handleTransientToggle(ctx, index, enabled),
    ctx.transientActive,
    (enabled) => handleGreenToggle(ctx, index, enabled),
    ctx.greenShowing
  );
}

function handleTransientToggle(ctx, index, enabled) {
  ctx.transientActive = enabled;
  applyCurrentBlocking(ctx, index);
  rerenderHeader(ctx, index);
}

function handleGreenToggle(ctx, index, enabled) {
  ctx.greenShowing = enabled;
  applyCurrentBlocking(ctx, index);
  rerenderHeader(ctx, index);
}

function getHighlightSets(state, highlightedMap) {
  const ids = new Set(Object.keys(highlightedMap || {}).filter(k => highlightedMap[k] === true));
  const users = new Set([
    ...((state?.highlightedUsers || []).map(s => String(s).toLowerCase())),
    ...((state?.highlighted?.combined || []).map(s => String(s).toLowerCase()))
  ]);
  return { ids, users };
}

async function handleStorageChanged(ctx, index, changes, area) {
  if (area !== 'local') return;
  if (changes.overmod) {
    ctx.state = changes.overmod.newValue || ctx.state;
    ctx.userStyleMap = buildHighlightStyleMap(ctx.state);
    ctx.greenShowing = !ctx.state?.hideGreenComments;
    updateBlockedSets(ctx);
    applyCurrentBlocking(ctx, index);
    rerenderHeader(ctx, index);
    const map = changes.overmodHighlighted
      ? changes.overmodHighlighted.newValue
      : (await getLocalState()).highlighted;
    const hl = getHighlightSets(ctx.state, map);
    applyBothHighlights(index, hl.ids, hl.users, ctx.userStyleMap);
  } else if (changes.overmodHighlighted) {
    const hl = getHighlightSets(ctx.state, changes.overmodHighlighted.newValue || {});
    applyBothHighlights(index, hl.ids, hl.users, ctx.userStyleMap);
  }
}

// -- Entry point --

async function main() {
  injectStyle();
  if (isUserPage()) {
    const u = getUserPageUsername();
    try { console.log(`User ${u} detected`); } catch (_) {}
    insertOvermodRow(u);
  }

  const rows = getRows();
  if (!rows.length) return;
  const index = buildIndex(rows);

  let state = await getStateFromBackground();
  if (!state) {
    const local = await getLocalState();
    state = { ...local.overmod };
  }

  const patterns = state?.blocked?.localPatterns || [];
  const ctx = {
    state,
    userStyleMap: buildHighlightStyleMap(state),
    blockedAll: createMatchSet(state?.blocked?.combined, patterns),
    blockedPersistent: createMatchSet(state?.blocked?.combinedWithoutTransient || state?.blocked?.combined, patterns),
    transientActive: false,
    greenShowing: !state?.hideGreenComments,
  };

  const { highlighted } = await getLocalState();
  const hl = getHighlightSets(state, highlighted);

  applyCurrentBlocking(ctx, index);
  applyBothHighlights(index, hl.ids, hl.users, ctx.userStyleMap);
  rerenderHeader(ctx, index);

  if (main._storageListener) chrome.storage.onChanged.removeListener(main._storageListener);
  main._storageListener = (changes, area) => handleStorageChanged(ctx, index, changes, area);
  chrome.storage.onChanged.addListener(main._storageListener);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  void main();
}

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    void main();
  }
});
