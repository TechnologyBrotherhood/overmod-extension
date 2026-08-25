// Overmod content script for Hacker News
// - Hides threads from blocked users based on combined blocklists
// - Lets users highlight/unhighlight threads they find valuable

// Basic diagnostics to help verify the script is active
try { console.log('Overmod Active'); } catch (_) {}

// CSS injected for hidden/highlighted threads and actions
function injectStyle() {
  const STYLE = `
    .overmod-hidden { display: none !important; }
    .overmod-highlight > td { background: var(--overmod-highlight-bg, ${DEFAULT_HIGHLIGHT_STYLE.bg}) !important; color: var(--overmod-highlight-fg, ${DEFAULT_HIGHLIGHT_STYLE.fg}) !important; }
    .overmod-highlight a, .overmod-highlight a:visited, .overmod-highlight .hnuser, .overmod-highlight .commtext { color: var(--overmod-highlight-fg, ${DEFAULT_HIGHLIGHT_STYLE.fg}) !important; }
    .overmod-inline-action { color: #828282; margin-left: 6px; font-size: 12px; }
    .overmod-inline-action a { color: #828282; text-decoration: none; }
    .overmod-inline-action a:hover { text-decoration: underline; }
    #overmod-header { font-size: inherit; color: #828282; }
    #overmod-header a { color: inherit; text-decoration: none; }
    #overmod-header a:hover { text-decoration: underline; }
    #overmod-removed-banner td { padding: 4px 10px; color: #828282; font-size: 10pt; }
  `;

  if (document.getElementById("overmod-style")) return;
  const s = document.createElement("style");
  s.id = "overmod-style";
  s.textContent = STYLE;
  // document_start runs before <html> is parsed, so documentElement (and
  // head/body) can be null here. Park the append until the shell exists; the
  // DOMContentLoaded dispatch for it runs before main()'s, so the rule is
  // live before any hiding class is applied.
  const attach = () => {
    const host = document.documentElement || document.head || document.body;
    if (host && !host.contains(s)) host.appendChild(s);
  };
  if (document.documentElement) attach();
  else document.addEventListener('DOMContentLoaded', attach, { once: true });
}

function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

function compilePatterns(patterns) {
  const regexes = [];
  for (const p of patterns || []) {
    try { regexes.push(new RegExp('^' + p + '$', 'i')); } catch (_) {}
  }
  return regexes;
}

// Resolve exact names plus regex patterns into a plain Set of usernames.
// `names` must already be lowercased — the service worker normalizes all
// merged lists at sync time, so re-lowercasing here would be wasted work.
// Patterns are matched once against the page's distinct authors, so every
// later lookup is a plain Set hit instead of a per-row regex scan.
function createMatchSet(names, patterns, authors) {
  const set = new Set(names || []);
  const regexes = compilePatterns(patterns);
  if (regexes.length && authors) {
    for (const author of authors) {
      if (!set.has(author) && regexes.some((re) => re.test(author))) set.add(author);
    }
  }
  return set;
}

function distinctAuthors(index) {
  const authors = new Set();
  for (const item of index) {
    if (item.authorLower) authors.add(item.authorLower);
  }
  return authors;
}

function createOptionsLink(anchorEl) {
  const msg = document.createElement('span');
  msg.className = 'overmod-inline-action';
  const link = document.createElement('a');
  link.href = '#';
  link.textContent = 'Open Overmod options to add a writable list';
  link.addEventListener('click', async (e) => {
    e.preventDefault();
    try { await chrome.runtime.sendMessage({ type: 'overmod:openOptions' }); } catch (_) {}
  });
  msg.appendChild(link);
  anchorEl.replaceWith(msg);
}

function populateListSelect(select, lists) {
  for (const l of lists) {
    const opt = document.createElement('option');
    const label = l.label ? String(l.label) : `${String(l.publicKey).slice(0, 8)}…`;
    opt.value = l.publicKey;
    opt.textContent = label;
    select.appendChild(opt);
  }
}

function setupChooserUI(anchorEl, select, confirmText, onConfirm) {
  const wrap = document.createElement('span');
  wrap.className = 'overmod-inline-action';

  const confirm = document.createElement('a');
  confirm.href = '#';
  confirm.style.marginLeft = '6px';
  confirm.textContent = confirmText;

  const cancel = document.createElement('a');
  cancel.href = '#';
  cancel.style.marginLeft = '6px';
  cancel.textContent = 'Cancel';

  const original = anchorEl;
  const parent = anchorEl.parentNode;
  if (!parent) return null;

  parent.replaceChild(wrap, anchorEl);
  wrap.appendChild(select);
  wrap.appendChild(confirm);
  wrap.appendChild(cancel);

  cancel.addEventListener('click', (e) => {
    e.preventDefault();
    wrap.replaceWith(original);
  });

  confirm.addEventListener('click', async (e) => {
    e.preventDefault();
    await onConfirm(wrap, confirm, select.value);
  });

  return wrap;
}

function getRows() {
  return $all('tr.athing.comtr');
}

function getIndentLevel(row) {
  const img = row.querySelector('td.ind img');
  if (!img) return 0;
  const w = Number(img.getAttribute('width') || img.width || 0);
  return Math.floor(w / 40);
}

function getCommentId(row) {
  return row.getAttribute('id') || '';
}

function isGreenComment(hnuser) {
  if (!hnuser) return false;
  // HN wraps new-account usernames in <font color="#3c963c"> inside .hnuser
  const font = hnuser.querySelector('font[color]');
  if (!font) return false;
  const hex = (font.getAttribute('color') || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return g > r && g > b;
}

function buildIndex(rows) {
  return rows.map((row) => {
    const hnuser = row.querySelector('.hnuser');
    const author = hnuser ? String(hnuser.textContent || '').trim() : '';
    return {
      row,
      id: getCommentId(row),
      author,
      authorLower: author.toLowerCase(),
      indent: getIndentLevel(row),
      isGreen: isGreenComment(hnuser)
    };
  });
}

function setHighlight(row, style) {
  if (!row) return;
  row.classList.add('overmod-highlight');
  const commtexts = row.querySelectorAll('.commtext');
  for (const el of commtexts) {
    if (!el.dataset.overmodCommtextClass) {
      el.dataset.overmodCommtextClass = el.className || '';
    }
    el.className = 'commtext';
  }
  const normalized = normalizeHighlightStyle(style);
  const bg = normalized.bg || DEFAULT_HIGHLIGHT_STYLE.bg;
  const fg = normalized.fg || DEFAULT_HIGHLIGHT_STYLE.fg;
  row.style.setProperty('--overmod-highlight-bg', bg);
  row.style.setProperty('--overmod-highlight-fg', fg);
}

function clearHighlight(row) {
  if (!row) return;
  row.classList.remove('overmod-highlight');
  row.style.removeProperty('--overmod-highlight-bg');
  row.style.removeProperty('--overmod-highlight-fg');
  const commtexts = row.querySelectorAll('.commtext');
  for (const el of commtexts) {
    if (el.dataset.overmodCommtextClass) {
      el.className = el.dataset.overmodCommtextClass;
      delete el.dataset.overmodCommtextClass;
    }
  }
}

function buildHighlightStyleMap(state) {
  const map = new Map();
  if (!state) return map;
  const sources = (state.highlighted && state.highlighted.sourceLists) || {};
  const colors = state.highlightColors || {};
  const ordered = Array.isArray(state.subscribedLists) ? state.subscribedLists.slice() : [];
  const seen = new Set();
  const applyList = (pk) => {
    if (!pk || seen.has(pk)) return;
    seen.add(pk);
    const users = sources[pk] || [];
    const style = normalizeHighlightStyle(colors[pk]);
    if (!Array.isArray(users) || !users.length) return;
    for (const name of users) {
      const key = String(name || '').toLowerCase();
      if (!key || map.has(key)) continue;
      map.set(key, style);
    }
  };
  ordered.forEach(applyList);
  Object.keys(sources || {}).forEach(applyList);
  return map;
}

function getCommentsLink() {
  const subtext = document.querySelector('td.subtext');
  if (!subtext) return null;
  const links = subtext.querySelectorAll('a');
  for (const link of links) {
    if (/\d+\s*comments?/.test(link.textContent) || link.textContent === 'discuss') {
      return link;
    }
  }
  return null;
}

// Tracks membership in "root row plus everything indented under it" while
// scanning the index in order: call once per row with whether the row is
// itself a root, get back whether the row is a root or inside one. This is
// the one place the subtree-boundary rule lives — blocking, green-hiding,
// counting, and manual highlights all share it, so a fix to the rule can't
// land in one walk and miss the others.
function subtreeTracker() {
  let below = -1;
  return (item, isRoot) => {
    if (below >= 0 && item.indent > below) return true;
    below = isRoot ? item.indent : -1;
    return !!isRoot;
  };
}

// Count comments (plus their subtrees) authored by each set's members, for
// several sets in one pass over the index. Each set gets its own subtree
// tracker, so the result matches running the count separately per set.
function countCommentsByAuthorSets(index, authorSets) {
  const counts = authorSets.map(() => 0);
  const trackers = authorSets.map(() => subtreeTracker());
  for (const item of index) {
    for (let s = 0; s < authorSets.length; s++) {
      const set = authorSets[s];
      if (!set || set.size === 0) continue;
      if (trackers[s](item, !!item.authorLower && set.has(item.authorLower))) counts[s]++;
    }
  }
  return counts;
}

function countCommentsByAuthors(index, authorSet) {
  return countCommentsByAuthorSets(index, [authorSet])[0];
}

function renderHeader(counts, onTransientToggle, transientActive, onGreenToggle, greenShowing) {
  const commentsLink = getCommentsLink();
  if (!commentsLink) return;

  let slot = document.getElementById('overmod-header');
  if (!slot) {
    slot = document.createElement('span');
    slot.id = 'overmod-header';
    commentsLink.parentNode.insertBefore(slot, commentsLink.nextSibling);
  }
  slot.textContent = '';

  function addToggle(label, active, activeLabel, inactiveLabel, onClick) {
    slot.appendChild(document.createTextNode(' | '));
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = active ? activeLabel : inactiveLabel;
    link.title = active ? `Re-hide ${label} comments` : `Show ${label} comments`;
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      if (slot.dataset.busy === '1') return;
      slot.dataset.busy = '1';
      try { await onClick(!active); } finally { slot.dataset.busy = '0'; }
    }, { once: true });
    slot.appendChild(link);
  }

  slot.appendChild(document.createTextNode(` | ${counts.blockedCount} blocked`));
  addToggle('transient', transientActive, `${counts.hiddenCount} shown`, `${counts.hiddenCount} hidden`, onTransientToggle);
  addToggle('green (new user)', greenShowing, `${counts.greenCount} green shown`, `${counts.greenCount} green`, onGreenToggle);
}

// Single pass over the index: a row is hidden when its author is blocked,
// when it is a green (new user) comment while those are hidden, or when it
// sits inside the subtree of such a row. classList.toggle with a force
// argument no-ops when the class already matches, so re-applies only touch
// rows whose state actually changes.
// Returns the number of comments hidden because of a blocked author (their
// subtrees included, green-only hiding excluded) — the removed-banner count,
// tracked here so the banner doesn't need its own pass over the index.
function applyBlocking(index, blockedSet, hideGreen) {
  const hasBlocks = !!(blockedSet && blockedSet.size);
  const inBlocked = subtreeTracker();
  const inHidden = subtreeTracker();
  let blockedCount = 0;
  for (const item of index) {
    const blocked = inBlocked(item, hasBlocks && !!item.authorLower && blockedSet.has(item.authorLower));
    if (blocked) blockedCount++;
    const hide = inHidden(item, blocked || (hideGreen && item.isGreen));
    item.row.classList.toggle('overmod-hidden', hide);
  }
  return blockedCount;
}

function renderRemovedBanner(index, count) {
  const existing = document.getElementById('overmod-removed-banner');
  if (existing) existing.remove();
  if (!count || !index.length) return;

  const firstRow = index[0].row;
  const parent = firstRow.parentNode;
  if (!parent) return;

  const tr = document.createElement('tr');
  tr.id = 'overmod-removed-banner';
  const td = document.createElement('td');
  td.textContent = `${count} comment${count !== 1 ? 's' : ''} removed`;
  tr.appendChild(td);
  parent.insertBefore(tr, firstRow);
}

// Single pass: manual highlighted IDs cover the comment and its whole
// subtree (indent tracking, like applyBlocking); user-based highlights
// style only the author's own comments and take precedence over the
// default manual style. Rows already in the right state aren't touched,
// so clearing no longer walks every row's .commtext nodes.
function applyBothHighlights(index, highlightedIds, highlightedUsers, userStyleMap) {
  const hasIds = !!(highlightedIds && highlightedIds.size);
  const hasUsers = !!(highlightedUsers && highlightedUsers.size);
  const inManualTree = subtreeTracker();
  for (const item of index) {
    const inManual = inManualTree(item, hasIds && highlightedIds.has(item.id));
    let style = inManual ? DEFAULT_HIGHLIGHT_STYLE : null;
    if (hasUsers && item.authorLower && highlightedUsers.has(item.authorLower)) {
      style = (userStyleMap && userStyleMap.get(item.authorLower)) || DEFAULT_HIGHLIGHT_STYLE;
    }
    if (style) {
      setHighlight(item.row, style);
    } else if (item.row.classList.contains('overmod-highlight')) {
      clearHighlight(item.row);
    }
  }
}

// scope 'page' asks the background for the slim comment-page state (no
// per-list blocked copies, no writable lists), served from cache without
// waiting on a refresh. Omit it for the full state the user-page choosers
// need — the worker then waits out its staleness check first, so these
// one-shot reads act on current lists. Either way the reply's writableLists
// carry only public fields; the signing keys never leave the worker.
async function getStateFromBackground(scope) {
  try {
    return await chrome.runtime.sendMessage({ type: 'overmod:getState', scope });
  } catch (_) {
    return null;
  }
}

async function getLocalState() {
  const { overmod, overmodHighlighted } = await chrome.storage.local.get(["overmod", "overmodHighlighted"]);
  return { overmod: overmod || {}, highlighted: overmodHighlighted || {} };
}

function isUserPage() {
  return location.pathname === '/user' || /\/(user)\b/.test(location.pathname);
}

function isThreadsPage() {
  return location.pathname === '/threads' || /\/(threads)\b/.test(location.pathname);
}

function getUserPageUsername() {
  const p = new URLSearchParams(location.search);
  const id = p.get('id');
  return id ? String(id).trim() : '';
}

function insertOvermodRow(username) {
  if (!username) return;
  if (document.getElementById('overmod-row')) return;

  const table = document.querySelector('#bigbox td > table') || document.querySelector('table#hnmain tr#bigbox td table');
  if (!table) return;

  const rows = Array.from(table.querySelectorAll('tr'));
  const favAnchor = table.querySelector('a[href^="favorites?id="]');
  let insertAfter = favAnchor ? favAnchor.closest('tr') : null;
  if (!insertAfter) {
    const linkRows = rows.filter(tr => {
      const labelCell = tr.firstElementChild;
      const label = ((labelCell && labelCell.textContent) || '').trim();
      if (label) return false;
      return !!tr.querySelector('a[href^="submitted?id="], a[href^="threads?id="], a[href^="comments?id="], a[href^="favorites?id="]');
    });
    if (linkRows.length) insertAfter = linkRows[linkRows.length - 1];
  }
  if (!insertAfter) insertAfter = rows[rows.length - 1] || null;

  const tr1 = document.createElement('tr');
  tr1.id = 'overmod-row';
  const tdLabel = document.createElement('td');
  tdLabel.setAttribute('valign', 'top');
  tdLabel.textContent = 'overmod:';
  const tdValue1 = document.createElement('td');

  const tr2 = document.createElement('tr');
  const tdLabel2 = document.createElement('td');
  tdLabel2.textContent = '';
  const tdValue2 = document.createElement('td');

  function makeLinkCell(text, handler) {
    const a = document.createElement('a');
    a.href = '#';
    const u = document.createElement('u');
    u.textContent = text;
    a.appendChild(u);
    a.addEventListener('click', (e) => { e.preventDefault(); handler(a); });
    return a;
  }

  async function showChooser(kind, anchorEl) {
    const s = await getStateFromBackground();
    const listsAll = Array.isArray(s?.writableLists) ? s.writableLists : [];
    if (!listsAll.length) {
      createOptionsLink(anchorEl);
      return;
    }
    let candidates = listsAll.filter(l => (l.type || '').toLowerCase() === kind);
    if (!candidates.length) candidates = listsAll;

    const select = document.createElement('select');
    populateListSelect(select, candidates);

    const confirmText = kind === 'block' ? 'Confirm block' : 'Confirm highlight';
    setupChooserUI(anchorEl, select, confirmText, async (wrap, confirm, selectedPk) => {
      confirm.textContent = kind === 'block' ? 'Blocking…' : 'Highlighting…';
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'overmod:addBlock', username, publicKey: selectedPk });
        if (resp && resp.ok) {
          wrap.textContent = kind === 'block' ? 'blocked' : 'highlighted';
        } else {
          const err = resp && resp.error ? resp.error : 'Unknown error';
          const errEl = document.createElement('span');
          errEl.className = 'overmod-inline-action';
          errEl.textContent = `Failed to ${kind}: ${err}`;
          wrap.replaceWith(errEl);
        }
      } catch (err) {
        const errEl = document.createElement('span');
        errEl.className = 'overmod-inline-action';
        errEl.textContent = `Failed to ${kind}: ${err}`;
        wrap.replaceWith(errEl);
      }
    });
  }

  async function showUnblockChooser(anchorEl) {
    const s = await getStateFromBackground();
    const listsAll = Array.isArray(s?.writableLists) ? s.writableLists : [];
    const blockedSource = (s?.blocked && s.blocked.sourceLists) || {};
    if (!listsAll.length) {
      createOptionsLink(anchorEl);
      return;
    }

    const nameLower = String(username || '').toLowerCase();
    const candidates = [];
    for (const l of listsAll) {
      const pk = (l.publicKey || '').trim();
      if (!pk) continue;
      if ((l.type || 'block').toLowerCase() !== 'block') continue;
      const arr = blockedSource[pk] || [];
      if (arr.some(u => String(u || '').toLowerCase() === nameLower)) {
        candidates.push(l);
      }
    }

    if (!candidates.length) {
      const wrap = document.createElement('span');
      wrap.className = 'overmod-inline-action';
      wrap.textContent = 'Not in any writable block list (after last sync)';
      anchorEl.replaceWith(wrap);
      return;
    }

    const select = document.createElement('select');
    populateListSelect(select, candidates);

    setupChooserUI(anchorEl, select, 'Confirm unblock', async (wrap, confirm, selectedPk) => {
      confirm.textContent = 'Unblocking…';
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'overmod:removeBlock', username, publicKey: selectedPk });
        if (resp && resp.ok) {
          wrap.textContent = 'unblocked';
        } else {
          const err = resp && resp.error ? resp.error : 'Unknown error';
          const errEl = document.createElement('span');
          errEl.className = 'overmod-inline-action';
          errEl.textContent = `Failed to unblock: ${err}`;
          wrap.replaceWith(errEl);
        }
      } catch (err) {
        const errEl = document.createElement('span');
        errEl.className = 'overmod-inline-action';
        errEl.textContent = `Failed to unblock: ${err}`;
        wrap.replaceWith(errEl);
      }
    });
  }

  async function maybeAddUnblockRow() {
    const s = await getStateFromBackground();
    const listsAll = Array.isArray(s?.writableLists) ? s.writableLists : [];
    const blockedSource = (s?.blocked && s.blocked.sourceLists) || {};
    if (!listsAll.length) return;

    const nameLower = String(username || '').toLowerCase();
    let hasCandidate = false;
    for (const l of listsAll) {
      const pk = (l.publicKey || '').trim();
      if (!pk) continue;
      if ((l.type || 'block').toLowerCase() !== 'block') continue;
      const arr = blockedSource[pk] || [];
      if (arr.some(u => String(u || '').toLowerCase() === nameLower)) {
        hasCandidate = true;
        break;
      }
    }
    if (!hasCandidate) return;

    const tr3 = document.createElement('tr');
    const tdLabel3 = document.createElement('td');
    tdLabel3.textContent = '';
    const tdValue3 = document.createElement('td');
    tdValue3.appendChild(makeLinkCell('unblock user…', (a) => showUnblockChooser(a)));
    tr3.appendChild(tdLabel3);
    tr3.appendChild(tdValue3);

    const parent = tr2.parentNode;
    if (!parent) return;
    parent.insertBefore(tr3, tr2.nextSibling);
  }

  tdValue1.appendChild(makeLinkCell('block user', (a) => showChooser('block', a)));
  tr1.appendChild(tdLabel);
  tr1.appendChild(tdValue1);

  tdValue2.appendChild(makeLinkCell('highlight user', (a) => showChooser('highlight', a)));
  tr2.appendChild(tdLabel2);
  tr2.appendChild(tdValue2);

  if (insertAfter && insertAfter.parentNode) {
    insertAfter.parentNode.insertBefore(tr1, insertAfter.nextSibling);
    if (tr1.nextSibling) {
      insertAfter.parentNode.insertBefore(tr2, tr1.nextSibling);
    } else {
      insertAfter.parentNode.appendChild(tr2);
    }
  } else {
    table.appendChild(tr1);
    table.appendChild(tr2);
  }

  try { void maybeAddUnblockRow(); } catch (_) {}
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { compilePatterns, createMatchSet, distinctAuthors, applyBlocking, countCommentsByAuthors, countCommentsByAuthorSets, applyBothHighlights };
}

