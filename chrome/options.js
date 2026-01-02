async function getState() {
  const { overmod } = await chrome.storage.local.get("overmod");
  return overmod || {};
}

async function setState(next) {
  await chrome.storage.local.set({ overmod: next });
}

function el(id) { return document.getElementById(id); }

/** @returns {HTMLInputElement} */
function inputEl(id) { return /** @type {HTMLInputElement} */ (document.getElementById(id)); }

/** @returns {HTMLSelectElement} */
function selectEl(id) { return /** @type {HTMLSelectElement} */ (document.getElementById(id)); }

const HIGHLIGHT_PALETTE = [
  { key: 'mint', label: 'Mint', bg: '#d9f99d', fg: '#14532d' },
  { key: 'sky', label: 'Sky', bg: '#dbeafe', fg: '#1d4ed8' },
  { key: 'lilac', label: 'Lilac', bg: '#ede9fe', fg: '#4c1d95' },
  { key: 'coral', label: 'Coral', bg: '#ffe4e6', fg: '#9f1239' },
  { key: 'default', label: 'Default', bg: DEFAULT_HIGHLIGHT_STYLE.bg, fg: DEFAULT_HIGHLIGHT_STYLE.fg }
];

async function blockUser(username, publicKey) {
  const resp = await chrome.runtime.sendMessage({ type: 'overmod:addBlock', username, publicKey });
  if (!resp || !resp.ok) {
    const msg = resp && resp.error ? resp.error : 'Unknown error adding user';
    throw new Error(msg);
  }
}

async function unblockUser(username, publicKey) {
  const resp = await chrome.runtime.sendMessage({ type: 'overmod:removeBlock', username, publicKey });
  if (!resp || !resp.ok) {
    const msg = resp && resp.error ? resp.error : 'Unknown error removing user';
    throw new Error(msg);
  }
}

async function getSyncSettings() {
  const { overmodSync } = await chrome.storage.sync.get('overmodSync');
  const raw = overmodSync && typeof overmodSync === 'object' ? overmodSync : {};
  return {
    writableLists: Array.isArray(raw.writableLists) ? raw.writableLists : [],
    subscribedLists: Array.isArray(raw.subscribedLists) ? raw.subscribedLists : [],
    subscribedOverrides: raw.subscribedOverrides && typeof raw.subscribedOverrides === 'object' ? raw.subscribedOverrides : {},
    subscribedLabels: raw.subscribedLabels && typeof raw.subscribedLabels === 'object' ? raw.subscribedLabels : {},
    highlightColors: raw.highlightColors && typeof raw.highlightColors === 'object' ? raw.highlightColors : {},
    localBlockedUsers: Array.isArray(raw.localBlockedUsers) ? raw.localBlockedUsers : [],
    highlightedUsers: Array.isArray(raw.highlightedUsers) ? raw.highlightedUsers : []
  };
}

async function setSyncSettings(next) {
  await chrome.storage.sync.set({ overmodSync: next });
}

async function mirrorSubscriptionsToSync() {
  const st = await getState();
  const sync = await getSyncSettings();
  const next = {
    ...sync,
    subscribedLists: Array.isArray(st.subscribedLists) ? st.subscribedLists.slice() : [],
    subscribedOverrides: st.subscribedOverrides || {},
    subscribedLabels: st.subscribedLabels || {},
    highlightColors: st.highlightColors || {},
    localBlockedUsers: Array.isArray(st.localBlockedUsers) ? st.localBlockedUsers.slice() : [],
    highlightedUsers: Array.isArray(st.highlightedUsers) ? st.highlightedUsers.slice() : []
  };
  await setSyncSettings(next);
}


function getHighlightStyleForPk(publicKey, source) {
  const raw = source && typeof source === 'object'
    ? (source[publicKey] || source)
    : null;
  const parsed = normalizeHighlightStyle(raw);
  return {
    bg: parsed.bg || DEFAULT_HIGHLIGHT_STYLE.bg,
    fg: parsed.fg || DEFAULT_HIGHLIGHT_STYLE.fg
  };
}

function isDefaultHighlightStyle(style) {
  const s = normalizeHighlightStyle(style);
  return (s.bg === '' || s.bg === DEFAULT_HIGHLIGHT_STYLE.bg) && (s.fg === '' || s.fg === DEFAULT_HIGHLIGHT_STYLE.fg);
}
function renderList(container, items, onRemove) {
  container.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'user-pill';
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.setAttribute('aria-label', 'Remove');
    btn.addEventListener('click', () => onRemove(item));
    const span = document.createElement('span');
    span.textContent = item;
    li.appendChild(btn);
    li.appendChild(span);
    container.appendChild(li);
  }
}

function createHighlightStyleControl(publicKey, initialStyle, onChange, options = { mode: 'compact' }) {
  const mode = (options && options.mode) || 'compact';
  const palette = (options && Array.isArray(options.palette) && options.palette.length)
    ? options.palette
    : HIGHLIGHT_PALETTE;

  const wrap = document.createElement('div');
  wrap.className = `color-control ${mode === 'full' ? 'color-control-full' : 'color-control-compact'}`;
  const style = getHighlightStyleForPk(publicKey, initialStyle);

  let current = { ...style };
  let currentKey = palette.find(p => p.bg && p.fg && p.bg.toLowerCase() === current.bg.toLowerCase() && p.fg.toLowerCase() === current.fg.toLowerCase())?.key || 'default';
  const swatches = [];

  function emit() { if (onChange) void onChange({ ...current }); }

  function updateSwatchState() {
    for (const sw of swatches) {
      if (sw.dataset.key === currentKey) sw.classList.add('active');
      else sw.classList.remove('active');
    }
  }

  function setStyle(next) {
    current = {
      bg: normalizeHexColor(next.bg) || DEFAULT_HIGHLIGHT_STYLE.bg,
      fg: normalizeHexColor(next.fg) || DEFAULT_HIGHLIGHT_STYLE.fg
    };
    if (next.key) currentKey = next.key;
    bgColor.value = current.bg;
    fgColor.value = current.fg;
    bgHex.value = current.bg;
    fgHex.value = current.fg;
    updateSwatchState();
    emit();
  }

  const label = document.createElement('span');
  label.className = 'muted small';
  label.textContent = 'Colour';

  const bgColor = document.createElement('input');
  bgColor.type = 'color';
  bgColor.setAttribute('aria-label', 'Background colour');
  bgColor.value = current.bg;

  const fgColor = document.createElement('input');
  fgColor.type = 'color';
  fgColor.setAttribute('aria-label', 'Foreground colour');
  fgColor.value = current.fg;

  const bgHex = document.createElement('input');
  bgHex.type = 'text';
  bgHex.placeholder = '#rrggbb';
  bgHex.value = current.bg;

  const fgHex = document.createElement('input');
  fgHex.type = 'text';
  fgHex.placeholder = '#rrggbb';
  fgHex.value = current.fg;

  const fieldWrap = document.createElement('div');
  fieldWrap.className = 'color-fields';

  function syncFromInputs() {
    const next = {
      bg: normalizeHexColor(bgHex.value) || normalizeHexColor(bgColor.value) || DEFAULT_HIGHLIGHT_STYLE.bg,
      fg: normalizeHexColor(fgHex.value) || normalizeHexColor(fgColor.value) || DEFAULT_HIGHLIGHT_STYLE.fg
    };
    current = next;
    bgColor.value = next.bg;
    fgColor.value = next.fg;
    bgHex.value = next.bg;
    fgHex.value = next.fg;
    currentKey = 'default';
    updateSwatchState();
    emit();
  }

  [bgColor, fgColor, bgHex, fgHex].forEach((input) => {
    input.addEventListener('change', syncFromInputs);
    input.addEventListener('blur', syncFromInputs);
  });


  if (mode === 'full') {
    const paletteWrap = document.createElement('div');
    paletteWrap.className = 'color-palette';
    palette.forEach((p) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch';
      btn.title = `${p.label} (${p.bg})`;
      btn.style.background = p.bg;
      btn.style.color = p.fg;
      btn.textContent = p.label;
      btn.addEventListener('click', () => {
        currentKey = p.key || 'preset';
        setStyle({ bg: p.bg, fg: p.fg, key: p.key || p.label });
      });
      btn.dataset.key = p.key || p.label || '';
      swatches.push(btn);
      paletteWrap.appendChild(btn);
    });
    updateSwatchState();

    const bgGroup = document.createElement('div');
    bgGroup.className = 'color-field';
    const bgLabel = document.createElement('label'); bgLabel.textContent = 'Background';
    bgGroup.appendChild(bgLabel);
    bgGroup.appendChild(bgColor);
    bgGroup.appendChild(bgHex);

    const fgGroup = document.createElement('div');
    fgGroup.className = 'color-field';
    const fgLabel = document.createElement('label'); fgLabel.textContent = 'Foreground';
    fgGroup.appendChild(fgLabel);
    fgGroup.appendChild(fgColor);
    fgGroup.appendChild(fgHex);

    fieldWrap.appendChild(bgGroup);
    fieldWrap.appendChild(fgGroup);

    wrap.appendChild(label);
    wrap.appendChild(paletteWrap);
    wrap.appendChild(fieldWrap);
  } else {
    bgHex.style.display = 'none';
    fgHex.style.display = 'none';
    const miniWrap = document.createElement('div');
    miniWrap.className = 'color-mini';
    miniWrap.appendChild(bgColor);
    miniWrap.appendChild(fgColor);
    wrap.appendChild(label);
    wrap.appendChild(miniWrap);
  }

  return {
    wrap,
    setVisible: (v) => { wrap.style.display = v ? '' : 'none'; },
    getStyle: () => ({ ...current })
  };
}

function renderSubscribed(container, keys, overrides, writableSet, labels, writableLabelMap) {
  container.innerHTML = '';
  (keys || []).forEach((pk, _) => {
    const li = document.createElement('li');
    li.className = 'sub-card';
    const left = document.createElement('div'); left.className = 'sub-left';
    const handle = document.createElement('span'); handle.className = 'drag-handle'; handle.title='Drag to reorder'; handle.textContent='≡';
    const flag = document.createElement('span');
    const isWritable = writableSet && writableSet.has(pk);
    flag.className = `sub-flag ${isWritable ? 'writable' : 'readonly'}`;
    flag.title = isWritable ? 'Writable (private key added)' : 'Subscribed only (read-only)';
    flag.textContent = isWritable ? '🔑' : '🗂️';
    const baseName =
      (labels && labels[pk]) ? String(labels[pk]) :
      (writableLabelMap && writableLabelMap[pk]) ? String(writableLabelMap[pk]) :
      '';
    const shortPk = pk ? String(pk).slice(0, 12) + '…' : '';
    const displayName = baseName ? `${baseName} (${shortPk})` : shortPk;
    const nameEl = document.createElement('span'); nameEl.className = 'sub-name'; nameEl.textContent = displayName;
    left.appendChild(handle); left.appendChild(flag); left.appendChild(nameEl);

    const actions = document.createElement('div'); actions.className = 'sub-actions';
    const typeSelect = document.createElement('select');
    const current = (overrides && overrides[pk]) || 'block';
    ['block','highlight'].forEach(t => { const o = document.createElement('option'); o.value=t; o.textContent=t; if (current===t) o.selected=true; typeSelect.appendChild(o); });
    typeSelect.addEventListener('change', async () => {
      const st = await getState();
      const ov = { ...(st.subscribedOverrides || {}) };
      ov[pk] = typeSelect.value;
      await setState({ ...st, subscribedOverrides: ov });
      await mirrorSubscriptionsToSync();
      // Recompute merged without requiring new network
      try { await chrome.runtime.sendMessage({ type: 'overmod:syncNow' }); } catch(_){ }
    });
    actions.appendChild(typeSelect);

    // Show upgrade to writable if not already; writable lists get user editor
    if (!isWritable) {
      const addPrivBtn = document.createElement('button');
      addPrivBtn.textContent = 'Config…';
      addPrivBtn.addEventListener('click', async () => {
        await openPrivateKeyModal(pk, typeSelect.value || (overrides && overrides[pk]) || 'block');
      });
      actions.appendChild(addPrivBtn);
    } else {
      const editUsersBtn = document.createElement('button');
      editUsersBtn.textContent = 'Edit users…';
      editUsersBtn.addEventListener('click', async () => { await openListUsersModal(pk); });
      actions.appendChild(editUsersBtn);
      const manageBtn = document.createElement('button');
      manageBtn.textContent = 'Config…';
      manageBtn.addEventListener('click', async () => { await openPrivateKeyModal(pk, typeSelect.value || current); });
      actions.appendChild(manageBtn);
    }
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      if (removeBtn.disabled) return;
      const original = removeBtn.textContent;
      removeBtn.disabled = true;
      removeBtn.textContent = 'Removing…';
      const status = el('syncStatus');
      if (status) status.textContent = 'Updating lists…';
      try {
        await removeList(pk);
      } finally {
        // UI will typically refresh and recreate this button, but restore state just in case.
        removeBtn.disabled = false;
        removeBtn.textContent = original;
      }
    });
    actions.appendChild(removeBtn);

    li.appendChild(left); li.appendChild(actions);
    // Drag & drop support via handle
    handle.draggable = true;
    handle.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', pk);
      li.classList.add('dragging');
    });
    handle.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('drag-over'); });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    li.addEventListener('drop', async (e) => {
      e.preventDefault(); li.classList.remove('drag-over');
      const fromPk = e.dataTransfer.getData('text/plain');
      if (fromPk && fromPk !== pk) { await reorderSubscribedByPk(fromPk, pk); }
    });
    container.appendChild(li);
  });
}

function maskPrivateKey(pk) {
  if (!pk) return '';
  const s = String(pk);
  if (s.length <= 8) return s;
  return '••••' + s.slice(-8);
}

function renderWritable(container, items, onRemove) {
  container.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'wl-card';

    const header = document.createElement('div');
    header.className = 'wl-header';
    const title = document.createElement('div');
    title.className = 'wl-title';
    title.textContent = item.label ? String(item.label) : `${String(item.publicKey || '').slice(0,8)}…`;
    const badge = document.createElement('span');
    const t = (item.type || 'block').toLowerCase();
    badge.className = `wl-badge ${t === 'highlight' ? 'wl-badge-highlight' : 'wl-badge-block'}`;
    badge.textContent = t;
    header.appendChild(title);
    header.appendChild(badge);

    const meta = document.createElement('div');
    meta.className = 'wl-meta';
    const pkShort = `${String(item.publicKey || '').slice(0,12)}…`;
    const base = (item.baseUrl || '').replace(/^https?:\/\//,'');
    const pkLabel = document.createElement('span');
    pkLabel.textContent = 'public key: ';
    const pkText = document.createElement('span');
    pkText.className = 'copyable';
    pkText.title = 'Click to copy public key';
    pkText.textContent = pkShort + ' ';
    pkText.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(String(item.publicKey || '')); pkText.textContent = 'copied'; setTimeout(()=>{ pkText.textContent = pkShort + ' '; }, 800);} catch(_){}
    });
    const copyPkBtn = document.createElement('button');
    copyPkBtn.className = 'icon-btn';
    copyPkBtn.title = 'Copy public key';
    copyPkBtn.textContent = '📋';
    copyPkBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(String(item.publicKey || '')); copyPkBtn.textContent = '✓'; setTimeout(()=>copyPkBtn.textContent='📋', 800);} catch(_){}
    });
    const baseSep = document.createElement('span');
    baseSep.textContent = ' • base: ' + (base || 'api.overmod.org');
    meta.appendChild(pkLabel);
    meta.appendChild(pkText);
    meta.appendChild(copyPkBtn);
    meta.appendChild(baseSep);

    const actions = document.createElement('div');
    actions.className = 'wl-actions';
    const typeSelect = document.createElement('select');
    ['block','highlight'].forEach(tt => {
      const o = document.createElement('option'); o.value = tt; o.textContent = tt; if (t===tt) o.selected = true; typeSelect.appendChild(o);
    });
    typeSelect.addEventListener('change', async () => {
      const sync = await getSyncSettings();
      const items2 = Array.isArray(sync.writableLists) ? sync.writableLists.slice() : [];
      const idx = items2.findIndex(x => (x.publicKey||'') === (item.publicKey||''));
      if (idx >= 0) { items2[idx].type = typeSelect.value; await setSyncSettings({ ...sync, writableLists: items2 }); }
      badge.textContent = typeSelect.value;
      badge.className = `wl-badge ${typeSelect.value === 'highlight' ? 'wl-badge-highlight' : 'wl-badge-block'}`;
    });

    const keySpan = document.createElement('span');
    keySpan.textContent = maskPrivateKey(item.privateKey);
    keySpan.dataset.revealed = 'false';
    const revealBtn = document.createElement('button');
    revealBtn.textContent = 'Reveal';
    revealBtn.addEventListener('click', () => {
      const rev = keySpan.dataset.revealed === 'true';
      if (rev) { keySpan.textContent = maskPrivateKey(item.privateKey); keySpan.dataset.revealed = 'false'; revealBtn.textContent = 'Reveal'; }
      else { keySpan.textContent = String(item.privateKey || ''); keySpan.dataset.revealed = 'true'; revealBtn.textContent = 'Hide'; }
    });
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(String(item.privateKey || '')); copyBtn.textContent = 'Copied!'; setTimeout(() => (copyBtn.textContent = 'Copy'), 1000);} catch(_){}
    });
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => onRemove(item));

    actions.appendChild(typeSelect);
    actions.appendChild(keySpan);
    actions.appendChild(revealBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(removeBtn);

    li.appendChild(header);
    li.appendChild(meta);
    li.appendChild(actions);
    container.appendChild(li);
  }
}

async function refreshUI() {
  const state = await getState();
  inputEl('apiBaseUrl').value = state.apiBaseUrl || 'https://api.overmod.org';
  selectEl('hideMode').value = state.hideMode || 'remove';
  let sync = await getSyncSettings();
  const writableSet = new Set((sync.writableLists || []).map(w => w.publicKey));
  const writableLabelMap = {};
  (sync.writableLists || []).forEach(w => {
    if (!w || !w.publicKey) return;
    if (w.label) writableLabelMap[w.publicKey] = w.label;
  });
  renderSubscribed(
    el('lists'),
    state.subscribedLists || [],
    state.subscribedOverrides || {},
    writableSet,
    state.subscribedLabels || {},
    writableLabelMap
  );
  // Unsubscribed writable lists (writable but not in subscribedLists)
  const subscribedSet = new Set((state.subscribedLists || []).map(pk => String(pk)));
  const unsubscribedWritable = (sync.writableLists || []).filter(w => {
    const key = String(w.publicKey || '');
    return key && !subscribedSet.has(key);
  });
  renderWritable(el('unsubscribedLists'), unsubscribedWritable, removeWritable);
  renderList(el('users'), state.localBlockedUsers || [], removeUser);
  renderList(el('hUsers'), state.highlightedUsers || [], removeHUser);
  // Note: sync is already loaded above
  // Migrate writableLists from local storage if present and sync is empty
  if (Array.isArray(state.writableLists) && state.writableLists.length && (!sync.writableLists || !sync.writableLists.length)) {
    sync = { ...sync, writableLists: state.writableLists.slice() };
    await setSyncSettings(sync);
  }

  const count = Array.isArray(state?.blocked?.combined) ? state.blocked.combined.length : 0;
  el('combinedCount').textContent = String(count);
  const last = state?.blocked?.lastSync ? new Date(state.blocked.lastSync) : null;
  el('syncStatus').textContent = last ? `Last pulled: ${last.toLocaleString()}` : 'Never pulled from server';
  // Aggregated lists display
  const aggBlocked = (state?.blocked?.combined || []).slice().sort((a,b)=>String(a).localeCompare(String(b)));
  const aggHighlighted = (state?.highlighted?.combined || []).slice().sort((a,b)=>String(a).localeCompare(String(b)));
  renderAlphaList('aggBlocked', aggBlocked);
  renderAlphaList('aggHighlighted', aggHighlighted);
  const bc = document.getElementById('aggBlockedCount'); if (bc) bc.textContent = String(aggBlocked.length);
  const hc = document.getElementById('aggHighlightedCount'); if (hc) hc.textContent = String(aggHighlighted.length);
}

async function openPrivateKeyModal(publicKey, typeHint) {
  const st = await getState();
  const sync = await getSyncSettings();
  const items = Array.isArray(sync.writableLists) ? sync.writableLists.slice() : [];
  const existing = items.find(w => (w.publicKey || '') === publicKey);

  const body = document.createElement('div');
  const { wrap: labelWrap, input: labelInput } = inputRow('Label (optional)', 'privLabel', (st.subscribedLabels && st.subscribedLabels[publicKey]) || existing?.label || '');
  labelInput.value = (st.subscribedLabels && st.subscribedLabels[publicKey]) || existing?.label || '';

  const typeRaw = existing?.type || typeHint || (st.subscribedOverrides && st.subscribedOverrides[publicKey]) || 'block';
  const type = (typeRaw || 'block').toLowerCase();
  const styleCtrl = createHighlightStyleControl(publicKey, (st.highlightColors || {})[publicKey], null, {
    mode: 'full',
    palette: HIGHLIGHT_PALETTE
  });
  const colorDetails = document.createElement('details');
  colorDetails.className = 'color-details';
  colorDetails.open = false;
  const colorSummary = document.createElement('summary');
  colorSummary.textContent = 'Highlight colour';
  colorDetails.appendChild(colorSummary);
  colorDetails.appendChild(styleCtrl.wrap);
  if (type !== 'highlight') {
    colorDetails.style.display = 'none';
  }

  // Reload list name from server
  const reloadBtn = document.createElement('button');
  reloadBtn.textContent = 'Reload';
  reloadBtn.type = 'button';
  reloadBtn.className = 'icon-btn inline-reload';
  reloadBtn.title = 'Reload name from server';
  reloadBtn.addEventListener('click', async () => {
    reloadBtn.disabled = true;
    const originalText = reloadBtn.textContent;
    reloadBtn.textContent = 'Reloading…';
    try {
      const base = (st.apiBaseUrl || 'https://api.overmod.org').replace(/\/$/, '');
      const res = await fetch(`${base}/lists/${encodeURIComponent(publicKey)}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg = j && j.error ? j.error : `HTTP ${res.status}`;
        alert('Failed to reload name: ' + msg);
        return;
      }
      const data = await res.json();
      if (data && typeof data.name === 'string' && data.name.trim()) {
        labelInput.value = data.name.trim();
      } else {
        alert('List has no name on server.');
      }
    } catch (e) {
      alert('Failed to reload name: ' + e);
    } finally {
      reloadBtn.disabled = false;
      reloadBtn.textContent = originalText;
    }
  });
  // Wrap input and icon together so the icon appears inside the field.
  if (labelInput.parentNode === labelWrap) {
    labelWrap.removeChild(labelInput);
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'input-with-icon';
    inputWrapper.appendChild(labelInput);
    inputWrapper.appendChild(reloadBtn);
    labelWrap.appendChild(inputWrapper);
  } else {
    labelWrap.appendChild(reloadBtn);
  }

  const keyWrap = document.createElement('div');
  const keyLabel = document.createElement('label'); keyLabel.textContent = 'Private key (base64)'; keyLabel.htmlFor = 'privKey';
  const keyInput = document.createElement('textarea'); keyInput.id='privKey'; keyInput.placeholder='base64'; keyInput.value = existing?.privateKey || '';
  const keyRow = document.createElement('div'); keyRow.className='row';
  const copyBtn = document.createElement('button'); copyBtn.textContent='Copy';
  copyBtn.addEventListener('click', async () => { try { await navigator.clipboard.writeText(String(keyInput.value||'')); copyBtn.textContent='Copied!'; setTimeout(()=>copyBtn.textContent='Copy',1000);} catch(_){} });
  keyWrap.appendChild(keyLabel); keyWrap.appendChild(keyInput);
  keyRow.appendChild(copyBtn);

  // Public key display + copy
  const pkWrap = document.createElement('div');
  const pkLabel = document.createElement('label'); pkLabel.textContent = 'Public key'; pkLabel.htmlFor = 'privPk';
  const pkText = document.createElement('textarea'); pkText.id = 'privPk'; pkText.readOnly = true; pkText.value = publicKey; pkText.style.minHeight = '48px';
  const pkRow = document.createElement('div'); pkRow.className = 'row';
  const pkCopy = document.createElement('button'); pkCopy.textContent = 'Copy';
  pkCopy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(publicKey); pkCopy.textContent='Copied!'; setTimeout(()=>pkCopy.textContent='Copy',1000);} catch(_){} });
  pkWrap.appendChild(pkLabel); pkWrap.appendChild(pkText);
  pkRow.appendChild(pkCopy);

  const baseDetails = document.createElement('details');
  baseDetails.style.marginTop = '12px';
  const baseSummary = document.createElement('summary');
  baseSummary.textContent = 'Use Custom Server';
  baseSummary.style.cssText = 'cursor: pointer; font-size: 12px; color: #6b7280; padding: 4px 0;';
  const baseWrap = document.createElement('div');
  baseWrap.style.marginTop = '8px';
  const baseLabel = document.createElement('label'); baseLabel.textContent = 'API Base URL'; baseLabel.htmlFor = 'privBase';
  const baseInput = document.createElement('input'); baseInput.type='text'; baseInput.id='privBase'; baseInput.value = existing?.baseUrl || (st.apiBaseUrl || 'https://api.overmod.org');
  baseWrap.appendChild(baseLabel); baseWrap.appendChild(baseInput);
  baseDetails.appendChild(baseSummary);
  baseDetails.appendChild(baseWrap);

  const hint = document.createElement('div'); hint.className='muted'; hint.textContent = 'Clear the field and click Save to remove the private key.';
  const verifyStatus = document.createElement('div');
  verifyStatus.className = 'muted';
  verifyStatus.style.marginTop = '4px';

  body.appendChild(labelWrap);
  body.appendChild(pkWrap);
  body.appendChild(pkRow);
  body.appendChild(keyWrap);
  body.appendChild(keyRow);
  body.appendChild(baseDetails);
  body.appendChild(colorDetails);
  body.appendChild(hint);
  body.appendChild(verifyStatus);

  openModal({
    title: 'List Config',
    body,
    primaryText: 'Save',
    onPrimary: async () => {
      const primaryBtn = el('modalPrimary');
      const priv = keyInput.value.trim();
      const label = labelInput.value.trim();
      const base = baseInput.value.trim().replace(/\/$/, '');

      // If a private key is provided, verify it against the server
      if (priv) {
        if (primaryBtn) {
          primaryBtn.disabled = true;
          primaryBtn.textContent = 'Saving…';
        }
        if (verifyStatus) {
          verifyStatus.textContent = 'Verifying private key…';
          verifyStatus.style.color = '#6b7280';
        }
        try {
          const verifyBase = (base || st.apiBaseUrl || 'https://api.overmod.org').replace(/\/$/, '');
          const resp = await chrome.runtime.sendMessage({
            type: 'overmod:verifyListKey',
            publicKey,
            privateKey: priv,
            apiBaseUrl: verifyBase
          });
          if (!resp || !resp.ok) {
            const msg = resp && resp.error ? resp.error : 'Unknown error verifying private key';
            if (verifyStatus) {
              verifyStatus.textContent = 'Failed to verify private key: ' + msg;
              verifyStatus.style.color = '#b91c1c';
            }
            if (primaryBtn) {
              primaryBtn.disabled = false;
              primaryBtn.textContent = 'Save';
            }
            return;
          }
        } catch (e) {
          if (verifyStatus) {
            verifyStatus.textContent = 'Failed to verify private key: ' + e;
            verifyStatus.style.color = '#b91c1c';
          }
          if (primaryBtn) {
            primaryBtn.disabled = false;
            primaryBtn.textContent = 'Save';
          }
          return;
        }
        if (verifyStatus) {
          verifyStatus.textContent = '✓ Private key verified';
          verifyStatus.style.color = '#16a34a';
        }
      } else if (verifyStatus) {
        verifyStatus.textContent = '';
      }

      let items2 = items.slice();
      const idx = items2.findIndex(w => (w.publicKey || '') === publicKey);
      if (!priv) {
        // remove
        if (idx >= 0) items2.splice(idx,1);
      } else {
        const next = { label: label || undefined, publicKey, privateKey: priv, type, baseUrl: base };
        if (idx >= 0) items2[idx] = next; else items2.push(next);
      }
      await setSyncSettings({ ...sync, writableLists: items2 });
      // Save/update label for subscribed list regardless of writability
      const st2 = await getState();
      const labels = { ...(st2.subscribedLabels || {}) };
      if (label) labels[publicKey] = label; else delete labels[publicKey];
      const colors = { ...(st2.highlightColors || {}) };
      const chosenStyle = type === 'highlight' ? styleCtrl.getStyle() : null;
      if (chosenStyle && !isDefaultHighlightStyle(chosenStyle)) {
        colors[publicKey] = normalizeHighlightStyle(chosenStyle);
      } else {
        delete colors[publicKey];
      }
      await setState({ ...st2, subscribedLabels: labels, highlightColors: colors });
      await mirrorSubscriptionsToSync();
      await refreshUI();
      el('modalRoot').classList.add('hidden');
    }
  });
}

async function openListUsersModal(publicKey) {
  const pk = String(publicKey || '').trim();
  if (!pk) return;

  let state;
  try {
    // Prefer the merged background state if available
    state = await chrome.runtime.sendMessage({ type: 'overmod:getState' });
  } catch (_) {
    // Fallback to local snapshot
    state = await getState();
  }
  if (!state) state = {};

  const overrides = state.subscribedOverrides || {};
  const labels = state.subscribedLabels || {};
  const writableLists = Array.isArray(state.writableLists) ? state.writableLists : [];
  const writable = writableLists.find((w) => (w.publicKey || '') === pk);

  const type = (overrides[pk] || writable?.type || 'block').toLowerCase();
  const listLabel = labels[pk] || writable?.label || '';

  const blockedSource = (state.blocked && state.blocked.sourceLists) || {};
  const highlightedSource = (state.highlighted && state.highlighted.sourceLists) || {};
  const rawUsers = ((blockedSource[pk] || highlightedSource[pk] || []) || [])
    .map((u) => String(u || '').trim())
    .filter(Boolean);

  // Unique, case-insensitive, but preserve first-seen casing
  const seen = new Set();
  const initialUsers = [];
  for (const name of rawUsers) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    initialUsers.push(name);
  }
  initialUsers.sort((a, b) => a.localeCompare(b));

  const body = document.createElement('div');

  const info = document.createElement('div');
  info.className = 'muted';
  const displayName = listLabel || `${pk.slice(0, 12)}…`;
  info.textContent = `Editing ${type} list “${displayName}”. One username per line.`;
  body.appendChild(info);

  const fieldWrap = document.createElement('div');
  const labelEl = document.createElement('label');
  labelEl.textContent = 'Users';
  labelEl.htmlFor = 'listUsersArea';
  const textarea = document.createElement('textarea');
  textarea.id = 'listUsersArea';
  textarea.value = initialUsers.join('\n');
  fieldWrap.appendChild(labelEl);
  fieldWrap.appendChild(textarea);
  body.appendChild(fieldWrap);

  const hint = document.createElement('div');
  hint.className = 'muted';
  hint.textContent = 'Changes will be written to the server when you click Save.';
  body.appendChild(hint);

  const statusEl = document.createElement('div');
  statusEl.className = 'muted';
  statusEl.style.marginTop = '8px';
  body.appendChild(statusEl);

  openModal({
    title: listLabel ? `Edit Users – ${listLabel}` : 'Edit List Users',
    body,
    primaryText: 'Save',
    onPrimary: async () => {
      const primaryBtn = el('modalPrimary');
      if (primaryBtn) primaryBtn.disabled = true;
      statusEl.textContent = 'Saving…';

      const lines = textarea.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const nextSeen = new Set();
      const nextUsers = [];
      for (const name of lines) {
        const key = name.toLowerCase();
        if (nextSeen.has(key)) continue;
        nextSeen.add(key);
        nextUsers.push(name);
      }

      const initialSet = new Set(initialUsers.map((n) => n.toLowerCase()));
      const toAdd = [];
      const toRemove = [];
      for (const name of nextUsers) {
        if (!initialSet.has(name.toLowerCase())) toAdd.push(name);
      }
      for (const name of initialUsers) {
        if (!nextSeen.has(name.toLowerCase())) toRemove.push(name);
      }

      try {
        for (const username of toAdd) {
          await blockUser(username, pk);
        }
        for (const username of toRemove) {
          await unblockUser(username, pk);
        }
        statusEl.textContent = 'Saved.';
        await refreshUI();
        el('modalRoot').classList.add('hidden');
      } catch (err) {
        statusEl.textContent = 'Failed to save changes';
        alert('Failed to update list: ' + err);
      } finally {
        if (primaryBtn) primaryBtn.disabled = false;
      }
    }
  });
}

function renderAlphaList(id, arr) {
  const ul = document.getElementById(id);
  if (!ul) return;
  ul.innerHTML = '';
  for (const name of arr || []) {
    const li = document.createElement('li');
    li.textContent = name;
    ul.appendChild(li);
  }
}
async function reorderSubscribedByPk(fromPk, toPk) {
  const st = await getState();
  const arr = Array.isArray(st.subscribedLists) ? st.subscribedLists.slice() : [];
  const from = arr.indexOf(fromPk);
  const to = arr.indexOf(toPk);
  if (from < 0 || to < 0 || from === to) return;
  const [item] = arr.splice(from,1);
  arr.splice(to,0,item);
  await setState({ ...st, subscribedLists: arr });
  await mirrorSubscriptionsToSync();
  await refreshUI();
  try { await chrome.runtime.sendMessage({ type: 'overmod:syncNow' }); } catch(_){ }
}

async function removeList(pk) {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'overmod:unsubscribeList', publicKey: pk });
    if (!resp || !resp.ok) {
      const msg = resp && resp.error ? resp.error : 'Unknown error';
      alert('Failed to remove list: ' + msg);
      return;
    }
  } catch (e) {
    alert('Failed to remove list: ' + e);
    return;
  }
  await refreshUI();
}

async function addUser() {
  const input = inputEl('userInput');
  const val = input.value.trim();
  if (!val) return;
  const state = await getState();
  const users = Array.isArray(state.localBlockedUsers) ? state.localBlockedUsers.slice() : [];
  if (!users.includes(val)) users.push(val);
  await setState({ ...state, localBlockedUsers: users });
  input.value = '';
   await mirrorSubscriptionsToSync();
  await refreshUI();
}

async function removeUser(name) {
  const state = await getState();
  const users = (state.localBlockedUsers || []).filter((x) => x !== name);
  await setState({ ...state, localBlockedUsers: users });
  await mirrorSubscriptionsToSync();
  await refreshUI();
}

async function addHUser() {
  const input = inputEl('hUserInput');
  const val = input.value.trim();
  if (!val) return;
  const state = await getState();
  const users = Array.isArray(state.highlightedUsers) ? state.highlightedUsers.slice() : [];
  if (!users.includes(val)) users.push(val);
  await setState({ ...state, highlightedUsers: users });
  input.value = '';
  await mirrorSubscriptionsToSync();
  await refreshUI();
}

async function removeHUser(name) {
  const state = await getState();
  const users = (state.highlightedUsers || []).filter((x) => x !== name);
  await setState({ ...state, highlightedUsers: users });
  await mirrorSubscriptionsToSync();
  await refreshUI();
}
async function removeWritable(item) {
  const sync = await getSyncSettings();
  const items = (sync.writableLists || []).filter((x) => x.publicKey !== item.publicKey);
  const colors = { ...(sync.highlightColors || {}) };
  if (item && item.publicKey) delete colors[item.publicKey];
  await setSyncSettings({ ...sync, writableLists: items, highlightColors: colors });
  const st = await getState();
  if (st) {
    const localColors = { ...(st.highlightColors || {}) };
    if (item && item.publicKey) delete localColors[item.publicKey];
    await setState({ ...st, highlightColors: localColors });
  }
  await refreshUI();
}

async function saveApiBaseUrl() {
  const base = inputEl('apiBaseUrl').value.trim();
  const state = await getState();
  await setState({ ...state, apiBaseUrl: base || 'https://api.overmod.org' });
}

async function saveHideMode() {
  const mode = selectEl('hideMode').value;
  const state = await getState();
  await setState({ ...state, hideMode: mode });
}

async function syncNow() {
  el('syncStatus').textContent = 'Pulling from server...';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'overmod:syncNow' });
    if (res && res.ok) {
      await refreshUI();
    } else {
      el('syncStatus').textContent = 'Pull failed';
    }
  } catch (e) {
    el('syncStatus').textContent = 'Pull failed';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // el('addListBtn') removed: use modal instead
  el('addUserBtn').addEventListener('click', addUser);
  el('apiBaseUrl').addEventListener('change', saveApiBaseUrl);
  el('hideMode').addEventListener('change', saveHideMode);
  el('syncBtn').addEventListener('click', syncNow);
  el('addHUserBtn').addEventListener('click', addHUser);
  void refreshUI();
});

async function newListOfType(type, name = '', description = '') {
  const statusEl = document.getElementById('newListStatus');
  const btnBlock = document.getElementById('newBlockBtn');
  const btnHighlight = document.getElementById('newHighlightBtn');
  if (statusEl) statusEl.textContent = '';
  if (btnBlock) btnBlock.disabled = true;
  if (btnHighlight) btnHighlight.disabled = true;
  const state = await getState();
  const base = (state.apiBaseUrl || 'https://api.overmod.org').replace(/\/$/, '');
  try {
    if (statusEl) statusEl.textContent = 'Creating…';
    const res = await fetch(`${base}/lists/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || undefined, description: description || undefined, type })
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (statusEl) statusEl.textContent = 'Failed to create list';
      alert('Failed to create list' + (j.error ? `: ${j.error}` : ''));
      return;
    }
    const data = await res.json();
    const sync = await getSyncSettings();
    const items = Array.isArray(sync.writableLists) ? sync.writableLists.slice() : [];
    const label = name || `${type} list`;
    items.push({ label, publicKey: data.publicKey, privateKey: data.privateKey, type, baseUrl: base });
    await setSyncSettings({ ...sync, writableLists: items });
    // Also subscribe via background so it can sync blocklists.
    try {
      await chrome.runtime.sendMessage({
        type: 'overmod:subscribeList',
        publicKey: data.publicKey,
        listType: type,
        name: label || undefined
      });
    } catch (_) {
      // If subscription fails, the writable list is still saved; user can subscribe manually.
    }
    if (statusEl) statusEl.textContent = 'Created. Added to writable lists.';
    await refreshUI();
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Failed to create list';
    alert('Failed to create list: ' + e);
  } finally {
    if (btnBlock) btnBlock.disabled = false;
    if (btnHighlight) btnHighlight.disabled = false;
  }
}

// --- Modal helpers ---
function openModal({ title, body, primaryText = 'OK', onPrimary, onCancel }) {
  const root = el('modalRoot');
  el('modalTitle').textContent = title;
  const bodyEl = el('modalBody');
  bodyEl.innerHTML = '';
  bodyEl.appendChild(body);
  function onKeydown(e) {
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      if (onCancel) onCancel();
      close();
    }
  }
  const close = () => {
    root.classList.add('hidden');
    document.removeEventListener('keydown', onKeydown);
  };
  el('modalPrimary').textContent = primaryText;
  el('modalPrimary').onclick = async () => { if (onPrimary) await onPrimary(); };
  el('modalCancel').onclick = () => { if (onCancel) onCancel(); close(); };
  el('modalClose').onclick = () => { if (onCancel) onCancel(); close(); };
  root.classList.remove('hidden');
  document.addEventListener('keydown', onKeydown);
}

function inputRow(labelText, id, placeholder = '') {
  const wrap = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = labelText;
  label.htmlFor = id;
  const input = document.createElement('input');
  input.type = 'text';
  input.id = id;
  input.placeholder = placeholder;
  wrap.appendChild(label);
  wrap.appendChild(input);
  return { wrap, input };
}
function openNewUnifiedListModal() {
  const typeWrap = document.createElement('div');
  const tLabel = document.createElement('label'); tLabel.textContent = 'Type'; tLabel.htmlFor = 'newListType';
  const tSelect = document.createElement('select'); tSelect.id = 'newListType';
  ['block','highlight'].forEach(t => { const o = document.createElement('option'); o.value=t; o.textContent=t; tSelect.appendChild(o); });
  typeWrap.appendChild(tLabel); typeWrap.appendChild(tSelect);

  const { wrap: nameWrap, input: nameInput } = inputRow('Name (optional)', 'newListName');
  const { wrap: descWrap, input: descInput } = inputRow('Description (optional)', 'newListDesc');
  const body = document.createElement('div');
  body.appendChild(typeWrap);
  body.appendChild(nameWrap);
  body.appendChild(descWrap);
  openModal({
    title: 'New List',
    body,
    primaryText: 'Create',
    onPrimary: async () => {
      await newListOfType(tSelect.value, nameInput.value.trim(), descInput.value.trim());
      el('modalRoot').classList.add('hidden');
    }
  });
}

function openSubscribedModal() {
  const body = document.createElement('div');
  const { wrap, input } = inputRow('Public key (base64url)', 'subPk', 'base64url public key');
  const tWrap = document.createElement('div');
  const tLabel = document.createElement('label'); tLabel.textContent = 'Use as'; tLabel.htmlFor = 'subType';
  const tSelect = document.createElement('select'); tSelect.id = 'subType';
  ['block','highlight'].forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; tSelect.appendChild(o); });
  tWrap.appendChild(tLabel); tWrap.appendChild(tSelect);
  body.appendChild(wrap); body.appendChild(tWrap);
  openModal({
    title: 'Subscribe to List',
    body,
    primaryText: 'Subscribe',
    onPrimary: async () => {
      const primaryBtn = el('modalPrimary');
      const val = input.value.trim();
      if (!val) return;
      if (primaryBtn) {
        primaryBtn.disabled = true;
        primaryBtn.textContent = 'Subscribing…';
      }
      try {
        const resp = await chrome.runtime.sendMessage({
          type: 'overmod:subscribeList',
          publicKey: val,
          listType: tSelect.value,
          name: null
        });
        if (!resp || !resp.ok) {
          const msg = resp && resp.error ? resp.error : 'Unknown error';
          alert('Failed to subscribe to list: ' + msg);
          return;
        }
      } catch (e) {
        alert('Failed to subscribe to list: ' + e);
        return;
      } finally {
        if (primaryBtn) {
          primaryBtn.disabled = false;
          primaryBtn.textContent = 'Subscribe';
        }
      }
      await refreshUI();
      el('modalRoot').classList.add('hidden');
    }
  });
}
// --- Export / Import ---
// buildExportData, validateImportData, applyImportData are loaded from export-import.js

async function exportSettings() {
  const state = await getState();
  const sync = await getSyncSettings();
  const data = buildExportData(state, sync);
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `overmod-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function importSettings(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        const data = JSON.parse(text);
        const validation = validateImportData(data);
        if (!validation.valid) {
          reject(new Error(validation.error));
          return;
        }
        const currentState = await getState();
        const currentSync = await getSyncSettings();
        const { nextState, nextSync } = applyImportData(data, currentState, currentSync);
        await setState(nextState);
        await setSyncSettings(nextSync);
        // Trigger a sync to pull latest data for imported lists
        try {
          await chrome.runtime.sendMessage({ type: 'overmod:syncNow' });
        } catch (_) {}
        resolve({ success: true });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

function openImportModal() {
  const body = document.createElement('div');
  const hint = document.createElement('div');
  hint.className = 'muted';
  hint.textContent = 'Paste an Overmod export JSON below. This will replace your current settings.';
  body.appendChild(hint);

  const textWrap = document.createElement('div');
  textWrap.style.marginTop = '12px';
  const textArea = document.createElement('textarea');
  textArea.id = 'importJson';
  textArea.placeholder = '{"version": 2, "lists": {...}}';
  textArea.style.minHeight = '150px';
  textArea.style.fontFamily = 'monospace';
  textArea.style.fontSize = '12px';
  textWrap.appendChild(textArea);
  body.appendChild(textWrap);

  const statusEl = document.createElement('div');
  statusEl.className = 'muted';
  statusEl.style.marginTop = '8px';
  body.appendChild(statusEl);

  openModal({
    title: 'Import Settings',
    body,
    primaryText: 'Import',
    onPrimary: async () => {
      const primaryBtn = el('modalPrimary');
      const jsonText = textArea.value.trim();
      if (!jsonText) {
        statusEl.textContent = 'Please paste your config JSON';
        statusEl.style.color = '#b91c1c';
        return;
      }
      if (primaryBtn) {
        primaryBtn.disabled = true;
        primaryBtn.textContent = 'Importing…';
      }
      statusEl.textContent = 'Importing…';
      statusEl.style.color = '#6b7280';
      try {
        const data = JSON.parse(jsonText);
        const validation = validateImportData(data);
        if (!validation.valid) {
          throw new Error(validation.error);
        }
        const currentState = await getState();
        const currentSync = await getSyncSettings();
        const { nextState, nextSync } = applyImportData(data, currentState, currentSync);
        await setState(nextState);
        await setSyncSettings(nextSync);
        // Trigger a sync to pull latest data for imported lists
        try {
          await chrome.runtime.sendMessage({ type: 'overmod:syncNow' });
        } catch (_) {}
        statusEl.textContent = 'Import successful!';
        statusEl.style.color = '#16a34a';
        await refreshUI();
        setTimeout(() => {
          el('modalRoot').classList.add('hidden');
        }, 1000);
      } catch (err) {
        statusEl.textContent = 'Import failed: ' + err.message;
        statusEl.style.color = '#b91c1c';
        if (primaryBtn) {
          primaryBtn.disabled = false;
          primaryBtn.textContent = 'Import';
        }
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const btnNew = document.getElementById('openNewBtn');
  const btnSub = document.getElementById('openSubBtn');
  const btnExport = document.getElementById('exportBtn');
  const btnImport = document.getElementById('importBtn');
  if (btnNew) btnNew.addEventListener('click', openNewUnifiedListModal);
  if (btnSub) btnSub.addEventListener('click', openSubscribedModal);
  if (btnExport) btnExport.addEventListener('click', exportSettings);
  if (btnImport) btnImport.addEventListener('click', openImportModal);
});
