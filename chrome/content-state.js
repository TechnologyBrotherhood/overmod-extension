// Runs at document_start, before any body DOM exists: register the hiding
// CSS and start the page-scope state fetch immediately so both overlap the
// full HTML parse. Without this the script ran at document_idle — after the
// page had fully painted — so blocked comments were visible for one or more
// frames before hiding landed (the reported flash).
injectStyle();
let eagerState = null;
if (!isUserPage()) {
  eagerState = Promise.all([getStateFromBackground('page'), getLocalState()]);
}

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
  // highlighted.combined is worker-merged and arrives pre-lowercased (same
  // contract as blocked.combined in createMatchSet); only the user-typed
  // highlightedUsers entries need normalizing.
  const users = new Set(state?.highlighted?.combined || []);
  for (const s of state?.highlightedUsers || []) users.add(String(s).toLowerCase());
  return { ids, users };
}

// The one render pipeline for a state change — both the initial load in
// main() and storage events go through here, so a render step can't be
// added to one path and missed by the other. Reads the current highlight
// map from ctx.highlightedMap, which the storage listener keeps fresh.
function applyState(ctx, index) {
  ctx.userStyleMap = buildHighlightStyleMap(ctx.state);
  ctx.greenShowing = !ctx.state?.hideGreenComments;
  updateBlockedSets(ctx, index);
  applyCurrentBlocking(ctx, index);
  const hl = getHighlightSets(ctx.state, ctx.highlightedMap);
  applyBothHighlights(index, hl.ids, hl.users, ctx.userStyleMap);
  rerenderHeader(ctx, index);
}

async function handleStorageChanged(ctx, index, changes, area) {
  if (area !== 'local') return;
  if (changes.overmodHighlighted) {
    ctx.highlightedMap = changes.overmodHighlighted.newValue || {};
  }
  if (changes.overmod) {
    // Project the raw storage value through the same allowlist the worker
    // applies to its getState reply, so a sync write doesn't swap the
    // page's slim state back for the full object.
    ctx.state = changes.overmod.newValue ? toPageState(changes.overmod.newValue) : ctx.state;
    ctx.stateApplied = true;
    if (ctx.highlightedMap === undefined) {
      ctx.highlightedMap = (await getLocalState()).highlighted;
    }
    applyState(ctx, index);
  } else if (changes.overmodHighlighted) {
    // Highlight-map-only change: nothing to re-derive from state, and a
    // full applyState would reset the header toggles — just repaint.
    const hl = getHighlightSets(ctx.state, ctx.highlightedMap);
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

  // A bfcache restore reruns main() while an earlier run may still be
  // parked on its state fetch; the run counter lets that old continuation
  // notice it was superseded and bail instead of repainting the page from
  // its pre-navigation snapshot.
  const run = (main._run = (main._run || 0) + 1);

  // First-run loads consume the eager fetch started at document_start (its
  // latency is hidden behind the HTML parse); bfcache reruns and any later
  // entry refetch, since the cached state may have moved on.
  const eager = eagerState;
  eagerState = null;
  const statePromise = eager || Promise.all([getStateFromBackground('page'), getLocalState()]);
  const index = buildIndex(rows);

  const ctx = {
    state: null,
    stateApplied: false,
    highlightedMap: undefined, // latest overmodHighlighted map, listener-maintained
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
  if (run !== main._run) return; // superseded by a bfcache-restore rerun
  if (ctx.highlightedMap === undefined) ctx.highlightedMap = local.highlighted;
  if (ctx.stateApplied) return; // a fresher storage write already rendered the page

  // bgState is already the slim projection; slim the local fallback too.
  ctx.state = bgState || toPageState(local.overmod);
  applyState(ctx, index);

  // The storage listener's registration races the worker's opportunistic
  // sync: onChanged events are dispatched only to contexts whose listener
  // the browser process already knows about, so a sync write landing before
  // our registration propagates is dropped, not queued (seen in the browser
  // harness as a reload stuck on stale state). One re-read closes the race:
  // it is ordered after the registration, so any sync write it doesn't see
  // will arrive as a normal event.
  const recheck = await getLocalState();
  if (run !== main._run || ctx.stateApplied) return;
  if ((recheck.overmod?.blocked?.lastSync || 0) !== (ctx.state?.blocked?.lastSync || 0)) {
    ctx.state = toPageState(recheck.overmod);
    ctx.highlightedMap = recheck.highlighted;
    applyState(ctx, index);
  }
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
