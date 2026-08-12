// Overmod Chrome Extension - Background Service Worker (MV3)

importScripts('common.js'); // shared helpers, incl. the toPageState projection

const DEFAULT_SETTINGS = {
  apiBaseUrl: "https://api.overmod.org", // configurable in options
  subscribedLists: [], // array of publicKey strings
  subscribedOverrides: {}, // publicKey -> 'block' | 'highlight'
  subscribedLabels: {}, // publicKey -> label
  highlightColors: {}, // publicKey -> custom highlight color (hex/rgb) for highlight lists
  transientLists: {}, // publicKey -> true when list is treated as transient (toggleable)
  localBlockedUsers: [], // local-only blocked usernames
  highlightedUsers: [], // local-only highlighted usernames
  hideMode: "remove", // or "collapse" in future
  hideGreenComments: false, // when true, comments by new (green) HN users are auto-hidden
  transientUnblockActive: false, // when true, transient lists are temporarily ignored
  // Lists we can write to: [{ label?: string, publicKey: string, privateKey: string }]
  writableLists: [],
  blocked: {
    combined: [], // merged unique usernames from all sources
    combinedWithoutTransient: [], // merged blocked with transient lists ignored
    transientOnly: [], // blocked only via transient lists (for toggling)
    sourceLists: {}, // publicKey -> usernames[]
    lastSync: null
  },
  highlighted: {
    combined: [], // from subscribed highlight lists + local highlightedUsers
    sourceLists: {}, // publicKey -> usernames[]
    lastSync: null
  }
};

// Automatically refresh blocklists when state is requested if the last
// successful sync is older than this many milliseconds.
const AUTO_SYNC_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

// Generic retry helper for async operations (e.g., pulling from server).
// fn: () => Promise<T>
// options: { retries?: number, delayMs?: number }
async function withRetry(fn, options) {
  const retries = (options && typeof options.retries === 'number') ? options.retries : 2;
  const delayMs = (options && typeof options.delayMs === 'number') ? options.delayMs : 500;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      if (delayMs > 0) {
        // Jittered so parallel list fetches that fail together don't retry
        // in lockstep against the same rate limiter.
        await new Promise((resolve) => setTimeout(resolve, delayMs * (1 + Math.random())));
      }
    }
  }
  throw lastError;
}

// Utility: case-insensitive set of usernames (HN usernames are lowercase, but normalize anyway)
function toNameSet(arr) {
  const s = new Set();
  for (const v of arr || []) {
    if (typeof v === "string" && v.trim()) s.add(v.trim().toLowerCase());
  }
  return s;
}

// Detect whether a local block list entry is a regex pattern.
// HN usernames only contain letters, digits, hyphens, and underscores,
// so any regex metacharacter means the entry is a pattern.
function isRegexPattern(str) {
  return /[.*+?^${}()|[\]\\]/.test(str);
}

async function getState() {
  const { overmod } = await chrome.storage.local.get("overmod");
  return overmod ? overmod : structuredClone(DEFAULT_SETTINGS);
}

async function setState(next) {
  await chrome.storage.local.set({ overmod: next });
}

const DEFAULT_SYNC = {
  writableLists: [],
  subscribedLists: [],
  subscribedOverrides: {},
  subscribedLabels: {},
  highlightColors: {},
  transientLists: {},
  localBlockedUsers: [],
  highlightedUsers: []
};

async function getSyncSettings() {
  const { overmodSync } = await chrome.storage.sync.get('overmodSync');
  const raw = overmodSync && typeof overmodSync === 'object' ? overmodSync : {};
  return {
    ...DEFAULT_SYNC,
    ...raw,
    highlightColors: raw.highlightColors && typeof raw.highlightColors === 'object'
      ? raw.highlightColors
      : {},
    transientLists: raw.transientLists && typeof raw.transientLists === 'object'
      ? raw.transientLists
      : {}
  };
}

async function setSyncSettings(next) {
  await chrome.storage.sync.set({ overmodSync: next });
}

async function getFullState() {
  const local = await getState();
  const sync = await getSyncSettings();
  const mergedLocalBlocked = Array.from(new Set([
    ...((local.localBlockedUsers || []).map(String)),
    ...((sync.localBlockedUsers || []).map(String))
  ]));
  const mergedHighlightedUsers = Array.from(new Set([
    ...((local.highlightedUsers || []).map(String)),
    ...((sync.highlightedUsers || []).map(String))
  ]));
  return {
    ...local,
    subscribedLists: Array.isArray(sync.subscribedLists) && sync.subscribedLists.length
      ? sync.subscribedLists
      : (local.subscribedLists || []),
    subscribedOverrides: {
      ...(local.subscribedOverrides || {}),
      ...(sync.subscribedOverrides || {})
    },
    subscribedLabels: {
      ...(local.subscribedLabels || {}),
      ...(sync.subscribedLabels || {})
    },
    highlightColors: {
      ...(local.highlightColors || {}),
      ...(sync.highlightColors || {})
    },
    transientLists: {
      ...(local.transientLists || {}),
      ...(sync.transientLists || {})
    },
    localBlockedUsers: mergedLocalBlocked,
    highlightedUsers: mergedHighlightedUsers,
    writableLists: Array.isArray(sync.writableLists) ? sync.writableLists : []
  };
}

async function ensureDefaults() {
  const current = await getState();
  const sync = await getSyncSettings();
  // Merge missing keys only; don't clobber existing user settings
  const merged = {
    ...DEFAULT_SETTINGS,
    ...current,
    blocked: { ...DEFAULT_SETTINGS.blocked, ...(current.blocked || {}) },
    highlighted: { ...DEFAULT_SETTINGS.highlighted, ...(current.highlighted || {}) }
  };

  // Pull synced subscriptions into local state if present
  if (Array.isArray(sync.subscribedLists) && sync.subscribedLists.length) {
    merged.subscribedLists = sync.subscribedLists.slice();
  }
  if (sync.subscribedOverrides && typeof sync.subscribedOverrides === 'object') {
    merged.subscribedOverrides = {
      ...(merged.subscribedOverrides || {}),
      ...sync.subscribedOverrides
    };
  }
  if (sync.subscribedLabels && typeof sync.subscribedLabels === 'object') {
    merged.subscribedLabels = {
      ...(merged.subscribedLabels || {}),
      ...sync.subscribedLabels
    };
  }
  if (sync.highlightColors && typeof sync.highlightColors === 'object') {
    merged.highlightColors = {
      ...(merged.highlightColors || {}),
      ...sync.highlightColors
    };
  }
  if (sync.transientLists && typeof sync.transientLists === 'object') {
    merged.transientLists = {
      ...(merged.transientLists || {}),
      ...sync.transientLists
    };
  }

  // Merge synced local users into local state
  if (Array.isArray(sync.localBlockedUsers) && sync.localBlockedUsers.length) {
    const set = new Set((merged.localBlockedUsers || []).map((s) => String(s).toLowerCase()));
    const next = merged.localBlockedUsers ? merged.localBlockedUsers.slice() : [];
    for (const name of sync.localBlockedUsers) {
      const key = String(name || '').trim();
      if (!key) continue;
      const lower = key.toLowerCase();
      if (!set.has(lower)) {
        set.add(lower);
        next.push(key);
      }
    }
    merged.localBlockedUsers = next;
  }
  if (Array.isArray(sync.highlightedUsers) && sync.highlightedUsers.length) {
    const set = new Set((merged.highlightedUsers || []).map((s) => String(s).toLowerCase()));
    const next = merged.highlightedUsers ? merged.highlightedUsers.slice() : [];
    for (const name of sync.highlightedUsers) {
      const key = String(name || '').trim();
      if (!key) continue;
      const lower = key.toLowerCase();
      if (!set.has(lower)) {
        set.add(lower);
        next.push(key);
      }
    }
    merged.highlightedUsers = next;
  }

  await setState(merged);
  return merged;
}

// All sync writes are serialized through this chain so an older in-flight
// sync can never finish after — and clobber — the state written by a newer
// one (e.g. a block added between a page load's staleness sync and its
// completion). Each queued run snapshots state when it starts, not when it
// was requested, so a post-write sync always sees the write.
let syncChain = Promise.resolve();
// Shares one staleness-triggered sync among concurrent getState calls:
// N tabs restored at once get one fetch round, not N queued ones.
let stalenessSync = null;

function syncBlocklists() {
  const run = syncChain.then(syncBlocklistsNow);
  syncChain = run.catch(() => {});
  return run;
}

async function syncBlocklistsNow() {
  const state = await ensureDefaults();
  const base = state.apiBaseUrl?.replace(/\/$/, "") || DEFAULT_SETTINGS.apiBaseUrl;
  const lists = Array.isArray(state.subscribedLists) ? state.subscribedLists : [];

  const sourceLists = {};
  const sourceHighlightLists = {};
  const usersByList = {};
  const effectiveType = {};
  let fetchSuccesses = 0;
  let fetchFailures = 0;
  const labels = { ...(state.subscribedLabels || {}) };
  const transientFlags = state.transientLists || {};
  // Fetch all subscribed lists concurrently — each iteration only touches
  // its own list's keys, and priority ordering is applied afterwards from
  // the ordered `lists` array, so completion order doesn't matter.
  await Promise.all(lists.map(async (pk) => {
    const trimmed = String(pk || "").trim();
    if (!trimmed) return;
    try {
      const data = await withRetry(async () => {
        const res = await fetch(`${base}/lists/${encodeURIComponent(trimmed)}`, {
          method: "GET",
          headers: { "Accept": "application/json" }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }, { retries: 2, delayMs: 500 });
      const overrideType = (state.subscribedOverrides && state.subscribedOverrides[trimmed]) || null;
      const listType = overrideType || data.type || 'block';
      const name = data && typeof data.name === 'string' ? data.name.trim() : '';
      const users = Array.isArray(data.users)
        ? data.users.map(u => (u && u.username ? String(u.username) : "")).filter(Boolean)
        : [];
      usersByList[trimmed] = users;
      effectiveType[trimmed] = listType;
      if (name && !labels[trimmed]) {
        labels[trimmed] = name;
      }
      if (listType === 'highlight') sourceHighlightLists[trimmed] = users; else sourceLists[trimmed] = users;
      fetchSuccesses++;
    } catch (err) {
      fetchFailures++;
      // On failure, retain last-known-good data for this list if available.
      const overrideType = (state.subscribedOverrides && state.subscribedOverrides[trimmed]) || null;
      const prevBlocked = (state.blocked && state.blocked.sourceLists && state.blocked.sourceLists[trimmed]) || [];
      const prevHighlighted = (state.highlighted && state.highlighted.sourceLists && state.highlighted.sourceLists[trimmed]) || [];
      const prevType = prevHighlighted.length ? 'highlight' : 'block';
      const listType = overrideType || prevType || 'block';
      const users = prevHighlighted.length ? prevHighlighted.slice() : prevBlocked.slice();
      usersByList[trimmed] = users;
      effectiveType[trimmed] = listType;
      if (listType === 'highlight') {
        sourceHighlightLists[trimmed] = users.slice();
        sourceLists[trimmed] = sourceLists[trimmed] || [];
      } else {
        sourceLists[trimmed] = users.slice();
        sourceHighlightLists[trimmed] = sourceHighlightLists[trimmed] || [];
      }
      // Optionally log network/parse error; state falls back to previous data.
      console.debug("Overmod sync error for", trimmed, err);
    }
  }));

  // Priority-based classification (first list wins), local overrides win globally
  const decision = new Map(); // all sources applied
  const decisionPersistent = new Map(); // transient block lists ignored
  // Local highlights first (highest priority)
  for (const n of toNameSet(state.highlightedUsers)) {
    decision.set(n, 'highlight');
    decisionPersistent.set(n, 'highlight');
  }
  // Split local blocked users into plain names and regex patterns
  const localBlockedPlain = [];
  const localBlockedPatterns = [];
  for (const raw of state.localBlockedUsers || []) {
    const v = String(raw || '').trim();
    if (!v) continue;
    if (isRegexPattern(v)) {
      localBlockedPatterns.push(v);
    } else {
      localBlockedPlain.push(v);
    }
  }
  // Local blocks next if not already decided
  for (const n of toNameSet(localBlockedPlain)) {
    if (!decision.has(n)) decision.set(n, 'block');
    if (!decisionPersistent.has(n)) decisionPersistent.set(n, 'block');
  }
  // Apply subscribed lists in saved order; earlier has higher priority
  for (const pk of lists) {
    const typ = effectiveType[pk] || 'block';
    const arr = usersByList[pk] || [];
    const isTransientBlock = typ === 'block' && !!transientFlags[pk];
    for (const name of arr) {
      const key = String(name).toLowerCase();
      if (!decision.has(key)) decision.set(key, typ);
      if (!isTransientBlock && !decisionPersistent.has(key)) {
        decisionPersistent.set(key, typ);
      }
    }
  }

  const mergedBlocked = [];
  const mergedHighlighted = [];
  const mergedBlockedPersistent = [];
  const mergedHighlightedPersistent = [];

  for (const [name, typ] of decision.entries()) {
    if (typ === 'highlight') mergedHighlighted.push(name); else mergedBlocked.push(name);
  }
  for (const [name, typ] of decisionPersistent.entries()) {
    if (typ === 'highlight') mergedHighlightedPersistent.push(name); else mergedBlockedPersistent.push(name);
  }
  mergedBlocked.sort();
  mergedBlockedPersistent.sort();
  mergedHighlighted.sort();
  mergedHighlightedPersistent.sort();

  // Users blocked only by transient lists (removed when toggle is active)
  const persistentBlockedSet = new Set(mergedBlockedPersistent);
  const transientOnly = mergedBlocked.filter((n) => !persistentBlockedSet.has(n));

  // A sync where every list fetch failed produced no new data: keep the old
  // lastSync so the next getState retries, instead of freezing the all-stale
  // result for another AUTO_SYNC_MAX_AGE_MS. Partial failures still bump it —
  // retrying on every page load against a single dead list would hammer the
  // API for nothing.
  const syncedAt = fetchFailures > 0 && fetchSuccesses === 0
    ? ((state.blocked && state.blocked.lastSync) || null)
    : Date.now();
  const next = {
    ...state,
    subscribedLabels: labels,
    blocked: {
      combined: Array.from(mergedBlocked),
      combinedWithoutTransient: Array.from(mergedBlockedPersistent),
      transientOnly,
      localPatterns: localBlockedPatterns,
      sourceLists,
      lastSync: syncedAt
    },
    highlighted: {
      combined: Array.from(mergedHighlighted),
      sourceLists: sourceHighlightLists,
      lastSync: syncedAt
    }
  };
  await setState(next);
  // Also persist labels to sync storage so they roam with the profile.
  try {
    const sync = await getSyncSettings();
    await setSyncSettings({
      ...sync,
      subscribedLabels: { ...(sync.subscribedLabels || {}), ...labels }
    });
  } catch (_) {
    // Ignore sync failures; local state is still updated.
  }
  return next;
}

async function maybeSyncBlocklists() {
  const current = await getState();
  const last = current && current.blocked && current.blocked.lastSync
    ? Number(current.blocked.lastSync)
    : 0;
  if (last && (Date.now() - last) <= AUTO_SYNC_MAX_AGE_MS) return current;
  if (!stalenessSync) {
    stalenessSync = syncBlocklists().finally(() => { stalenessSync = null; });
  }
  try {
    return await stalenessSync;
  } catch (_) {
    return current;
  }
}

// --- Signing utilities (Ed25519 via WebCrypto) ---
function b64ToBytes(b64) {
  // atob handles standard base64
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function seedToPkcs8(seed32) {
  // PKCS#8 structure for Ed25519 private key (RFC 8410):
  // SEQUENCE {
  //   INTEGER 0
  //   SEQUENCE { OID 1.3.101.112 }
  //   OCTET STRING (34 bytes): 0x04 0x20 || seed
  // }
  if (seed32.length !== 32) throw new Error('Invalid Ed25519 seed length');
  const header = new Uint8Array([
    0x30, 0x2e,       // SEQUENCE, len 46
    0x02, 0x01, 0x00, // INTEGER 0
    0x30, 0x05,       // SEQUENCE len 5
    0x06, 0x03, 0x2b, 0x65, 0x70, // OID 1.3.101.112 (Ed25519)
    0x04, 0x22,       // OCTET STRING len 34
    0x04, 0x20        // OCTET STRING (seed) len 32
  ]);
  const out = new Uint8Array(header.length + 32);
  out.set(header, 0);
  out.set(seed32, header.length);
  return out.buffer;
}

async function signMessageEd25519(message, privateKeyBase64) {
  const te = new TextEncoder();
  const secret64 = b64ToBytes(privateKeyBase64);
  // Server returns 64-byte NaCl secretKey; derive the first 32 bytes (seed)
  const seed = secret64.slice(0, 32);
  const pkcs8 = seedToPkcs8(seed);
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('Ed25519', key, te.encode(message));
  return bytesToB64(new Uint8Array(sigBuf));
}

async function addUserToList(username, list, apiBaseUrl) {
  const base = (apiBaseUrl || list.baseUrl || DEFAULT_SETTINGS.apiBaseUrl).replace(/\/$/, '');
  const publicKey = String(list.publicKey || '').trim();
  const privateKey = String(list.privateKey || '').trim();
  if (!publicKey || !privateKey) throw new Error('Missing list keys');

  const body = { username: String(username) };
  const safePk = encodeURIComponent(publicKey);
  const path = `/lists/${safePk}/users`;
  const message = `POST:${path}:${JSON.stringify(body)}`;
  const signature = await signMessageEd25519(message, privateKey);
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': signature },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j && j.error ? ` - ${j.error}` : ''; } catch {}
    throw new Error(`Add user failed: HTTP ${res.status}${detail}`);
  }
  return res.json();
}

async function removeUserFromList(username, list, apiBaseUrl) {
  const base = (apiBaseUrl || list.baseUrl || DEFAULT_SETTINGS.apiBaseUrl).replace(/\/$/, '');
  const publicKey = String(list.publicKey || '').trim();
  const privateKey = String(list.privateKey || '').trim();
  if (!publicKey || !privateKey) throw new Error('Missing list keys');

  const body = {};
  const safePk = encodeURIComponent(publicKey);
  const safeUser = encodeURIComponent(String(username));
  const path = `/lists/${safePk}/users/${safeUser}`;
  const message = `DELETE:${path}:${JSON.stringify(body)}`;
  const signature = await signMessageEd25519(message, privateKey);
  const res = await fetch(`${base}${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'X-Signature': signature }
  });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j && j.error ? ` - ${j.error}` : ''; } catch {}
    throw new Error(`Remove user failed: HTTP ${res.status}${detail}`);
  }
  return res.json();
}

async function verifyListKey(publicKey, privateKey, apiBaseUrl) {
  const base = (apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl).replace(/\/$/, '');
  const pk = String(publicKey || '').trim();
  const priv = String(privateKey || '').trim();
  if (!pk || !priv) throw new Error('Missing public or private key');

  const ts = Date.now();
  const msgBody = { ts };
  const message = JSON.stringify(msgBody);
  const signature = await signMessageEd25519(message, priv);
  const res = await fetch(`${base}/verify-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: pk,
      ts,
      signature
    })
  });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j && j.error ? ` - ${j.error}` : ''; } catch {}
    throw new Error(`Verify key failed: HTTP ${res.status}${detail}`);
  }
  return res.json();
}

async function subscribeList(publicKey, listType, name) {
  const pk = String(publicKey || '').trim();
  if (!pk) throw new Error('Missing publicKey');

  const state = await getState();
  const sync = await getSyncSettings();

  const lists = Array.isArray(state.subscribedLists) ? state.subscribedLists.slice() : [];
  if (!lists.includes(pk)) lists.push(pk);

  const overrides = { ...(state.subscribedOverrides || {}) };
  if (listType === 'block' || listType === 'highlight') {
    overrides[pk] = listType;
  }

  const labels = { ...(state.subscribedLabels || {}) };
  if (name && String(name).trim()) {
    labels[pk] = String(name).trim();
  }

  const highlightColors = {
    ...(state.highlightColors || {}),
    ...(sync.highlightColors || {})
  };
  const transientLists = {
    ...(state.transientLists || {}),
    ...(sync.transientLists || {})
  };

  const next = {
    ...state,
    subscribedLists: lists,
    subscribedOverrides: overrides,
    subscribedLabels: labels,
    highlightColors,
    transientLists
  };
  const nextSync = {
    ...sync,
    subscribedLists: lists.slice(),
    subscribedOverrides: { ...(sync.subscribedOverrides || {}), ...overrides },
    subscribedLabels: { ...(sync.subscribedLabels || {}), ...labels },
    highlightColors,
    transientLists
  };
  await Promise.all([setState(next), setSyncSettings(nextSync)]);
  try { await syncBlocklists(); } catch (_) {}
  return next;
}

async function unsubscribeList(publicKey) {
  const pk = String(publicKey || '').trim();
  if (!pk) throw new Error('Missing publicKey');

  const state = await getState();
  const sync = await getSyncSettings();
  const lists = Array.isArray(state.subscribedLists) ? state.subscribedLists.slice() : [];
  const filtered = lists.filter((x) => x !== pk);

  const overrides = { ...(state.subscribedOverrides || {}) };
  delete overrides[pk];
  const labels = { ...(state.subscribedLabels || {}) };
  delete labels[pk];
  const colors = { ...(state.highlightColors || {}) };
  delete colors[pk];
  const transient = { ...(state.transientLists || {}) };
  delete transient[pk];

  const next = {
    ...state,
    subscribedLists: filtered,
    subscribedOverrides: overrides,
    subscribedLabels: labels,
    highlightColors: colors,
    transientLists: transient
  };
  const nextSync = {
    ...sync,
    subscribedLists: filtered.slice(),
    subscribedOverrides: { ...(sync.subscribedOverrides || {}) , ...overrides },
    subscribedLabels: { ...(sync.subscribedLabels || {}), ...labels },
    highlightColors: (() => {
      const merged = { ...(sync.highlightColors || {}) , ...colors };
      delete merged[pk];
      return merged;
    })(),
    transientLists: (() => {
      const merged = { ...(sync.transientLists || {}), ...transient };
      delete merged[pk];
      return merged;
    })()
  };
  await Promise.all([setState(next), setSyncSettings(nextSync)]);
  try { await syncBlocklists(); } catch (_) {}
  return next;
}

async function openOptionsPage() {
  if (chrome.runtime.openOptionsPage) {
    await chrome.runtime.openOptionsPage();
    return;
  }
  throw new Error('openOptions unavailable');
}

chrome.action.onClicked.addListener(async () => {
  try {
    await openOptionsPage();
  } catch (_) {
    // Ignore failures from opening options; nothing useful to report.
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  const sync = await getSyncSettings();
  if (!sync || typeof sync !== 'object' || !Array.isArray(sync.writableLists)) {
    await setSyncSettings({ writableLists: [] });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "overmod:getState": {
        // Opportunistically refresh from the server when the last successful
        // sync is stale. Comment pages ('page' scope) must not block on the
        // network: they get cached state immediately and their
        // storage.onChanged listener delivers any refresh. Everything else
        // (user-page choosers, the options list editor) is a one-shot read
        // with no listener — a stale cache there means acting on the wrong
        // lists, so those wait out the staleness check. If the worker is
        // killed mid-sync, the next getState simply retries.
        const refresh = maybeSyncBlocklists().catch(() => {});
        if (message.scope !== 'page') await refresh;
        const full = await getFullState();
        sendResponse(message.scope === 'page' ? toPageState(full) : full);
        break;
      }
      case "overmod:syncNow": {
        try {
          const next = await syncBlocklists();
          sendResponse({ ok: true, state: next });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
        break;
      }
      case "overmod:addBlock": {
        try {
          const { username, publicKey } = message;
          const full = await getFullState();
          const lists = Array.isArray(full.writableLists) ? full.writableLists : [];
          let target = null;
          if (publicKey) {
            target = lists.find(l => (l.publicKey || '').trim() === String(publicKey).trim());
          } else if (lists.length === 1) {
            target = lists[0];
          }
          if (!target) {
            sendResponse({ ok: false, error: 'No writable list selected or configured' });
            break;
          }
          const result = await addUserToList(username, target, target.baseUrl || full.apiBaseUrl);
          await syncBlocklists();
          sendResponse({ ok: true, result });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
        break;
      }
      case "overmod:removeBlock": {
        try {
          const { username, publicKey } = message;
          const full = await getFullState();
          const lists = Array.isArray(full.writableLists) ? full.writableLists : [];
          const target = lists.find(l => (l.publicKey || '').trim() === String(publicKey || '').trim());
          if (!target) {
            sendResponse({ ok: false, error: 'No matching writable list for removal' });
            break;
          }
          const result = await removeUserFromList(username, target, target.baseUrl || full.apiBaseUrl);
          await syncBlocklists();
          sendResponse({ ok: true, result });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
        break;
      }
      case "overmod:subscribeList": {
        try {
          const { publicKey, listType, name } = message;
          const next = await subscribeList(publicKey, listType, name);
          sendResponse({ ok: true, state: next });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
        break;
      }
      case "overmod:unsubscribeList": {
        try {
          const { publicKey } = message;
          const next = await unsubscribeList(publicKey);
          sendResponse({ ok: true, state: next });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
        break;
      }
      case "overmod:verifyListKey": {
        try {
          const { publicKey, privateKey, apiBaseUrl } = message;
          const result = await verifyListKey(publicKey, privateKey, apiBaseUrl);
          sendResponse({ ok: true, result });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
        break;
      }
      case "overmod:openOptions": {
        try {
          await openOptionsPage();
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
        break;
      }
      case "overmod:setTransientUnblock": {
        try {
          const { enabled } = message;
          // ensureDefaults rather than getState: this write may be the state
          // a just-loaded page renders from, so fold sync-only additions in
          // rather than persisting a state that lacks them.
          const state = await ensureDefaults();
          const next = { ...state, transientUnblockActive: !!enabled };
          await setState(next);
          sendResponse({ ok: true, state: next });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
        break;
      }
      default:
        break;
    }
  })();
  // Keep the message channel open for async response
  return true;
});
