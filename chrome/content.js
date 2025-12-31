// Overmod content script for Hacker News
// - Hides threads from blocked users based on combined blocklists
// - Lets users highlight/unhighlight threads they find valuable

(function () {
  const HN_HOST = location.hostname;
  if (!/(^|\.)news\.ycombinator\.com$/.test(HN_HOST)) return;

  // Basic diagnostics to help verify the script is active
  try { console.log('Overmod Active'); } catch (_) {}

  // CSS injected for hidden/highlighted threads and actions
  function injectStyle() {
    const STYLE = `
    .overmod-hidden { display: none !important; }
    .overmod-highlight > td { background: var(--overmod-highlight-bg, ${DEFAULT_HIGHLIGHT_STYLE.bg}) !important; color: var(--overmod-highlight-fg, ${DEFAULT_HIGHLIGHT_STYLE.fg}) !important; }
    .overmod-highlight a, .overmod-highlight a:visited, .overmod-highlight .hnuser { color: var(--overmod-highlight-fg, ${DEFAULT_HIGHLIGHT_STYLE.fg}) !important; }
    .overmod-inline-action { color: #828282; margin-left: 6px; font-size: 12px; }
    .overmod-inline-action a { color: #828282; text-decoration: none; }
    .overmod-inline-action a:hover { text-decoration: underline; }
    tr.overmod-collapsed td.default { color: #828282; font-style: italic; }
    .overmod-collapsed-label { color: #828282; }
  `;

    if (document.getElementById("overmod-style")) return;
    const s = document.createElement("style");
    s.id = "overmod-style";
    s.textContent = STYLE;
    document.documentElement.appendChild(s);
  }

  function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

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
    // Comments on HN are rows: tr.athing.comtr
    return $all('tr.athing.comtr');
  }

  function getIndentLevel(row) {
    const img = row.querySelector('td.ind img');
    if (!img) return 0;
    const w = Number(img.getAttribute('width') || img.width || 0);
    return Math.floor(w / 40);
  }

  function getAuthor(row) {
    const el = row.querySelector('.hnuser');
    return el ? String(el.textContent || '').trim() : '';
  }

  function getCommentId(row) {
    return row.getAttribute('id') || '';
  }

  function buildIndex(rows) {
    // Precompute indent and id for each row
    return rows.map((row) => ({
      row,
      id: getCommentId(row),
      author: getAuthor(row),
      indent: getIndentLevel(row)
    }));
  }

  function hideThreadFromIndex(idx, index) {
    const start = index[idx];
    if (!start) return;
    const baseIndent = start.indent;
    // Hide the starting row and all subsequent rows indented deeper
    for (let i = idx; i < index.length; i++) {
      if (i === idx) {
        start.row.classList.add('overmod-hidden');
        continue;
      }
      const curr = index[i];
      if (curr.indent > baseIndent) {
        curr.row.classList.add('overmod-hidden');
      } else {
        break;
      }
    }
  }

  function restoreCollapsed(row) {
    if (!row) return;
    const td = row.querySelector('td.default');
    if (td && td.dataset && td.dataset.overmodOriginal) {
      td.innerHTML = td.dataset.overmodOriginal;
      delete td.dataset.overmodOriginal;
    }
    row.classList.remove('overmod-collapsed');
  }

  function collapseRootThreadFromIndex(idx, index) {
    const start = index[idx];
    if (!start) return;
    const baseIndent = start.indent;
    // Modify the start row to show a simple placeholder and hide descendants
    const td = start.row.querySelector('td.default');
    if (td && !td.dataset.overmodOriginal) {
      td.dataset.overmodOriginal = td.innerHTML;
      const span = document.createElement('span');
      span.className = 'overmod-collapsed-label';
      span.textContent = 'blocked';
      td.innerHTML = '';
      td.appendChild(span);
      start.row.classList.add('overmod-collapsed');
    } else {
      start.row.classList.add('overmod-collapsed');
    }
    for (let i = idx + 1; i < index.length; i++) {
      const curr = index[i];
      if (curr.indent > baseIndent) {
        curr.row.classList.add('overmod-hidden');
      } else {
        break;
      }
    }
  }

  function clearEffects(index) {
    for (const item of index) {
      item.row.classList.remove('overmod-hidden');
      restoreCollapsed(item.row);
    }
  }

  function reorderBlockedRoots(index) {
    // Move collapsed root rows (indent 0) to the end of the comments table
    if (!index || !index.length) return;
    const parent = index[0].row && index[0].row.parentElement ? index[0].row.parentElement : null;
    if (!parent) return;
    for (let i = 0; i < index.length; i++) {
      const it = index[i];
      if (it.indent === 0 && it.row.classList.contains('overmod-collapsed')) {
        parent.appendChild(it.row);
      }
    }
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
      if ((!style.bg && !style.fg) || !Array.isArray(users) || !users.length) return;
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

  function applyBlocking(index, blockedSet) {
    clearEffects(index);
    if (!blockedSet || blockedSet.size === 0) return;
    for (let i = 0; i < index.length; i++) {
      const name = index[i].author?.toLowerCase?.() || '';
      if (name && blockedSet.has(name)) {
        if (index[i].indent === 0) {
          collapseRootThreadFromIndex(i, index);
        } else {
          hideThreadFromIndex(i, index);
        }
      }
    }
  }

  function applyBothHighlights(index, highlightedIds, highlightedUsers, userStyleMap) {
    // Clear previous
    for (const item of index) clearHighlight(item.row);

    const idToIdx = new Map();
    index.forEach((it, i) => idToIdx.set(it.id, i));

    // 1) Manual highlighted IDs
    if (highlightedIds && highlightedIds.size) {
      for (const id of highlightedIds) {
        const startIdx = idToIdx.get(id);
        if (startIdx == null) continue;
        const start = index[startIdx];
        const baseIndent = start.indent;
        for (let i = startIdx; i < index.length; i++) {
          const curr = index[i];
          if (i === startIdx || curr.indent > baseIndent) {
            setHighlight(curr.row, DEFAULT_HIGHLIGHT_STYLE);
          } else {
            break;
          }
        }
      }
    }

    // 2) User-based highlights: highlight only the author's own comments,
    //    not the entire subtree under each comment.
    if (highlightedUsers && highlightedUsers.size) {
      for (let i = 0; i < index.length; i++) {
        const it = index[i];
        if (it.author && highlightedUsers.has(it.author.toLowerCase())) {
          const style = userStyleMap && userStyleMap.get(it.author.toLowerCase());
          setHighlight(it.row, style || DEFAULT_HIGHLIGHT_STYLE);
        }
      }
    }
  }

  async function getStateFromBackground() {
    try {
      return await chrome.runtime.sendMessage({ type: 'overmod:getState' });
    } catch (_) {
      return null;
    }
  }

  async function getLocalState() {
    const { overmod, overmodHighlighted } = await chrome.storage.local.get(["overmod", "overmodHighlighted"]);
    return { overmod: overmod || {}, highlighted: overmodHighlighted || {} };
  }

  // No per-comment controls on thread pages

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

    // Locate the user info table
    const table = document.querySelector('#bigbox td > table') || document.querySelector('table#hnmain tr#bigbox td table');
    if (!table) return;

    const rows = Array.from(table.querySelectorAll('tr'));
    // Prefer inserting after the favorites row
    const favAnchor = table.querySelector('a[href^="favorites?id="]');
    let insertAfter = favAnchor ? favAnchor.closest('tr') : null;
    if (!insertAfter) {
      // Fallback: after the last of the empty-label link rows
      const linkRows = rows.filter(tr => {
        const labelCell = tr.firstElementChild;
        const label = ((labelCell && labelCell.textContent) || '').trim();
        if (label) return false;
        return !!tr.querySelector('a[href^="submitted?id="], a[href^="threads?id="], a[href^="comments?id="], a[href^="favorites?id="]');
      });
      if (linkRows.length) insertAfter = linkRows[linkRows.length - 1];
    }
    if (!insertAfter) insertAfter = rows[rows.length - 1] || null;

    // Build three rows: label + first action, and a second row for the second action
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

    // Fill row 1 (block user) — turns into dropdown + confirm
    tdValue1.appendChild(makeLinkCell('block user', (a) => showChooser('block', a)));
    tr1.appendChild(tdLabel);
    tr1.appendChild(tdValue1);

    // Fill row 2 (highlight user) — turns into dropdown + confirm
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

    // Asynchronously add the unblock row only if the user
    // is in at least one writable block list.
    try { void maybeAddUnblockRow(); } catch (_) {}
  }

  async function main() {
    injectStyle();
    // If user page, insert an Overmod section with actions
    if (isUserPage()) {
      const u = getUserPageUsername();
      try { console.log(`User ${u} detected`); } catch (_) {}
      insertOvermodRow(u);
    }

    const rows = getRows();
    if (!rows.length) return; // not a comments page
    const index = buildIndex(rows);

    // Load state
    let state = await getStateFromBackground();
    if (!state) {
      const local = await getLocalState();
      state = { ...local.overmod };
    }
    let userStyleMap = buildHighlightStyleMap(state);
    const blockedSet = new Set((state?.blocked?.combined || []).map((s) => String(s).toLowerCase()));

    // Load highlights
    const { highlighted } = await getLocalState();
    const highlightedIds = new Set(Object.keys(highlighted || {}).filter((k) => highlighted[k] === true));
    const highlightedUsers = new Set([
      ...((state?.highlightedUsers || []).map(s => String(s).toLowerCase())),
      ...(((state?.highlighted?.combined) || []).map(s => String(s).toLowerCase()))
    ]);

    // Apply
    if (!isThreadsPage()) {
      applyBlocking(index, blockedSet);
      reorderBlockedRoots(index);
    }
    applyBothHighlights(index, highlightedIds, highlightedUsers, userStyleMap);
    // No injected per-comment actions

    // React to storage updates (e.g., sync completes or user changes settings)
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local') return;
      let needReblock = false, needRehighlight = false;
      if (changes.overmod) needReblock = true;
      if (changes.overmodHighlighted) needRehighlight = true;
      if (changes.overmod) {
        state = changes.overmod.newValue || state;
        userStyleMap = buildHighlightStyleMap(state || {});
      }
      if (needReblock || changes.overmod) {
        const st = changes.overmod ? changes.overmod.newValue : null;
        const nextBlocked = new Set(((st?.blocked?.combined) || (state?.blocked?.combined) || []).map((s) => String(s).toLowerCase()));
        if (!isThreadsPage()) {
          applyBlocking(index, nextBlocked);
          reorderBlockedRoots(index);
        }
        const hlUsers = new Set(((st?.highlightedUsers) || (state?.highlightedUsers) || []).map(s => String(s).toLowerCase()));
        // type tagging required for IntelliJ to not complain
        /** @type {Record<string, boolean>} */
        const map = changes.overmodHighlighted ? changes.overmodHighlighted.newValue : (await getLocalState()).highlighted;
        const ids = new Set(Object.keys(map || {}).filter((k) => map[k] === true));
        applyBothHighlights(index, ids, hlUsers, userStyleMap);
      } else if (needRehighlight) {
        /** @type {Record<string, boolean>} */
        const map = changes.overmodHighlighted.newValue || {};
        const ids = new Set(Object.keys(map).filter((k) => map[k] === true));
        const hlUsers = new Set((state?.highlightedUsers || []).map(s => String(s).toLowerCase()));
        applyBothHighlights(index, ids, hlUsers, userStyleMap);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    void main();
  }

  // When navigating back/forward, Chrome may restore the page from the
  // back/forward cache without re-running content scripts. Listen for
  // pageshow with persisted state and re-apply blocking/highlighting.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      void main();
    }
  });
})();
