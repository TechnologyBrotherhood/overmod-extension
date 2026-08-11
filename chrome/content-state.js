// Page state management and entry point for the Overmod content script.
// Operates on a ctx object that holds mutable page-level state,
// and an index array of comment rows built by content.js.

function updateBlockedSets(ctx, index) {
  const st = ctx.state;
  const patterns = st?.blocked?.localPatterns || [];
  const transientOnly = new Set(st?.blocked?.transientOnly || []);
  ctx.blockedPersistent = createMatchSet(st?.blocked?.combinedWithoutTransient || st?.blocked?.combined, patterns, ctx.authors);
  // combined = combinedWithoutTransient ∪ transientOnly, so extend a copy of
  // the persistent set instead of walking the full combined list again.
  ctx.blockedAll = new Set(ctx.blockedPersistent);
  for (const name of transientOnly) ctx.blockedAll.add(name);
  // Header counts depend only on state and the (static) page index, so
  // compute them here once per state change rather than on every header
  // render (toggles rerender the header without changing the counts).
  const [blockedCount, hiddenCount] = countCommentsByAuthorSets(index, [ctx.blockedPersistent, transientOnly]);
  ctx.headerCounts = { blockedCount, hiddenCount, greenCount: ctx.greenCount };
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
  const blockedCount = applyBlocking(index, effectiveSet, !ctx.greenShowing);
  renderRemovedBanner(index, blockedCount);
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
    ctx.stateApplied = true;
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

  // Start the state fetches before indexing the DOM so they overlap; one
  // local read covers both the fallback state and the highlighted-ID map.
  const statePromise = Promise.all([getStateFromBackground('page'), getLocalState()]);
  const index = buildIndex(rows);

  const ctx = {
    state: null,
    stateApplied: false,
    authors: distinctAuthors(index),
    greenCount: index.reduce((n, it) => n + (it.isGreen ? 1 : 0), 0),
    userStyleMap: new Map(),
    blockedAll: null,
    blockedPersistent: null,
    transientActive: false,
    greenShowing: true,
  };

  // Listen before awaiting the state: getState kicks off a background
  // blocklist sync in the worker, and its storage write can land before the
  // (cached, possibly stale) response does. Registering the listener after
  // the await would miss that write and leave the page on stale state.
  if (main._storageListener) chrome.storage.onChanged.removeListener(main._storageListener);
  main._storageListener = (changes, area) => handleStorageChanged(ctx, index, changes, area);
  chrome.storage.onChanged.addListener(main._storageListener);

  const [bgState, local] = await statePromise;
  if (ctx.stateApplied) return; // a fresher sync already rendered the page

  ctx.state = bgState || { ...local.overmod };
  ctx.userStyleMap = buildHighlightStyleMap(ctx.state);
  ctx.greenShowing = !ctx.state?.hideGreenComments;
  updateBlockedSets(ctx, index);

  const hl = getHighlightSets(ctx.state, local.highlighted);
  applyCurrentBlocking(ctx, index);
  applyBothHighlights(index, hl.ids, hl.users, ctx.userStyleMap);
  rerenderHeader(ctx, index);
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
