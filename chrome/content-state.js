// Page state management and entry point for the Overmod content script.
// Operates on a ctx object that holds mutable page-level state,
// and an index array of comment rows built by content.js.

function toLowerSet(arr) {
  return new Set((arr || []).map(s => String(s).toLowerCase()));
}

function updateBlockedSets(ctx, index) {
  const st = ctx.state;
  const patterns = st?.blocked?.localPatterns || [];
  ctx.blockedAll = createMatchSet(st?.blocked?.combined, patterns, ctx.authors);
  ctx.blockedPersistent = createMatchSet(st?.blocked?.combinedWithoutTransient || st?.blocked?.combined, patterns, ctx.authors);
  // Header counts depend only on state and the (static) page index, so
  // compute them here once per state change rather than on every header
  // render (toggles rerender the header without changing the counts).
  ctx.headerCounts = {
    blockedCount: countCommentsByAuthors(index, ctx.blockedPersistent),
    hiddenCount: countCommentsByAuthors(index, toLowerSet(st?.blocked?.transientOnly)),
    greenCount: ctx.greenCount,
  };
}

function applyCurrentBlocking(ctx, index) {
  const activeSet = ctx.transientActive ? ctx.blockedPersistent : ctx.blockedAll;
  let effectiveSet = activeSet;
  const pageUser = isThreadsPage() && getUserPageUsername().toLowerCase();
  if (pageUser && activeSet.has(pageUser)) {
    // Exclude the page owner on their own threads page
    effectiveSet = new Set(activeSet);
    effectiveSet.delete(pageUser);
  }
  applyBlocking(index, effectiveSet, !ctx.greenShowing);
  renderRemovedBanner(index, effectiveSet);
}

function rerenderHeader(ctx, index) {
  renderHeader(
    ctx.headerCounts,
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
    updateBlockedSets(ctx, index);
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

  const ctx = {
    state,
    authors: distinctAuthors(index),
    greenCount: index.reduce((n, it) => n + (it.isGreen ? 1 : 0), 0),
    userStyleMap: buildHighlightStyleMap(state),
    blockedAll: null,
    blockedPersistent: null,
    transientActive: false,
    greenShowing: !state?.hideGreenComments,
  };
  updateBlockedSets(ctx, index);

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
