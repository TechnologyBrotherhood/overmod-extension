// Export/Import logic for Overmod extension
// Shared between options.js and tests

const EXPORT_VERSION = 2;

const SerializerV2 = {
  version: 2,

  buildExport(state, sync) {
    const lists = {};
    const subscribedSet = new Set(state.subscribedLists || []);
    const writableMap = {};

    for (const w of (sync.writableLists || [])) {
      if (w && w.publicKey) {
        writableMap[w.publicKey] = w;
      }
    }

    const allKeys = new Set([
      ...(state.subscribedLists || []),
      ...Object.keys(writableMap)
    ]);

    for (const pk of allKeys) {
      const entry = {};
      const writable = writableMap[pk];

      const label = (state.subscribedLabels && state.subscribedLabels[pk]) || (writable && writable.label);
      if (label) entry.label = label;

      entry.subscribed = subscribedSet.has(pk);
      entry.type = (state.subscribedOverrides && state.subscribedOverrides[pk]) || (writable && writable.type) || 'block';

      if (writable && writable.privateKey) {
        entry.privateKey = writable.privateKey;
      }

      if (writable && writable.baseUrl && writable.baseUrl !== 'https://api.overmod.org') {
        entry.baseUrl = writable.baseUrl;
      }

      if (state.highlightColors && state.highlightColors[pk]) {
        entry.highlightColor = state.highlightColors[pk];
      }

      if (state.transientLists && state.transientLists[pk]) {
        entry.transient = true;
      }

      lists[pk] = entry;
    }

    const result = {
      version: this.version,
      exportedAt: new Date().toISOString(),
      lists
    };

    if (state.localBlockedUsers && state.localBlockedUsers.length) {
      result.localBlockedUsers = state.localBlockedUsers;
    }
    if (state.highlightedUsers && state.highlightedUsers.length) {
      result.highlightedUsers = state.highlightedUsers;
    }
    if (state.apiBaseUrl && state.apiBaseUrl !== 'https://api.overmod.org') {
      result.apiBaseUrl = state.apiBaseUrl;
    }

    return result;
  },

  validate(data) {
    if (data.localBlockedUsers !== undefined && !Array.isArray(data.localBlockedUsers)) {
      return { valid: false, error: 'localBlockedUsers must be an array' };
    }
    if (data.highlightedUsers !== undefined && !Array.isArray(data.highlightedUsers)) {
      return { valid: false, error: 'highlightedUsers must be an array' };
    }
    if (data.lists !== undefined && (typeof data.lists !== 'object' || Array.isArray(data.lists))) {
      return { valid: false, error: 'lists must be an object' };
    }
    if (data.lists) {
      for (const [pk, entry] of Object.entries(data.lists)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return { valid: false, error: `lists["${pk}"] must be an object` };
        }
        if (entry.type !== undefined && entry.type !== 'block' && entry.type !== 'highlight') {
          return { valid: false, error: `lists["${pk}"].type must be "block" or "highlight"` };
        }
        if (entry.transient !== undefined && typeof entry.transient !== 'boolean') {
          return { valid: false, error: `lists["${pk}"].transient must be boolean` };
        }
      }
    }
    return { valid: true };
  },

  applyImport(data, nextState, nextSync) {
    const subscribedLists = [];
    const subscribedOverrides = {};
    const subscribedLabels = {};
    const highlightColors = {};
    const transientLists = {};
    const writableLists = [];

    for (const [pk, entry] of Object.entries(data.lists || {})) {
      if (entry.subscribed) {
        subscribedLists.push(pk);
        if (entry.type) subscribedOverrides[pk] = entry.type;
        if (entry.label) subscribedLabels[pk] = entry.label;
        if (entry.highlightColor) highlightColors[pk] = entry.highlightColor;
        if (entry.transient === true) transientLists[pk] = true;
      }

      if (entry.privateKey) {
        writableLists.push({
          publicKey: pk,
          privateKey: entry.privateKey,
          label: entry.label || undefined,
          type: entry.type || 'block',
          baseUrl: entry.baseUrl || undefined
        });
      }
    }

    nextState.subscribedLists = subscribedLists;
    nextSync.subscribedLists = subscribedLists;
    nextState.subscribedOverrides = subscribedOverrides;
    nextSync.subscribedOverrides = subscribedOverrides;
    nextState.subscribedLabels = subscribedLabels;
    nextSync.subscribedLabels = subscribedLabels;
    nextState.highlightColors = highlightColors;
    nextSync.highlightColors = highlightColors;
    nextState.transientLists = transientLists;
    nextSync.transientLists = transientLists;
    nextSync.writableLists = writableLists;

    if (Array.isArray(data.localBlockedUsers)) {
      nextState.localBlockedUsers = data.localBlockedUsers.slice();
      nextSync.localBlockedUsers = data.localBlockedUsers.slice();
    }
    if (Array.isArray(data.highlightedUsers)) {
      nextState.highlightedUsers = data.highlightedUsers.slice();
      nextSync.highlightedUsers = data.highlightedUsers.slice();
    }
    if (data.apiBaseUrl && typeof data.apiBaseUrl === 'string') {
      nextState.apiBaseUrl = data.apiBaseUrl;
    }
  }
};

const serializers = {
  2: SerializerV2
};

function buildExportData(state, sync) {
  return serializers[EXPORT_VERSION].buildExport(state, sync);
}

function validateImportData(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid JSON structure' };
  }
  if (typeof data.version !== 'number' || data.version < 1) {
    return { valid: false, error: 'Missing or invalid version field' };
  }

  const serializer = serializers[data.version];
  if (!serializer) {
    return { valid: false, error: `Version ${data.version} not supported` };
  }

  return serializer.validate(data);
}

function applyImportData(data, currentState, currentSync) {
  const serializer = serializers[data.version];
  if (!serializer) {
    throw new Error(`Version ${data.version} not supported`);
  }

  const nextState = { ...currentState };
  const nextSync = { ...currentSync };
  serializer.applyImport(data, nextState, nextSync);
  return { nextState, nextSync };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EXPORT_VERSION, buildExportData, validateImportData, applyImportData };
}
