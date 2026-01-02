// Tests for export/import logic
// Run with: node export-import.test.js

const assert = require('assert');
const { buildExportData, validateImportData, applyImportData } = require('./export-import.js');

console.log('Testing export/import round-trip...\n');

// Full state with all fields populated
const state = {
  subscribedLists: ['pk1', 'pk2'],
  subscribedOverrides: { pk1: 'block', pk2: 'highlight' },
  subscribedLabels: { pk1: 'Block List', pk2: 'Highlight List' },
  highlightColors: { pk2: { bg: '#d9f99d', fg: '#14532d' } },
  localBlockedUsers: ['blocked1', 'blocked2'],
  highlightedUsers: ['good1'],
  apiBaseUrl: 'https://custom.overmod.org'
};

const sync = {
  writableLists: [
    { publicKey: 'pk1', privateKey: 'sk1', label: 'Block List', type: 'block', baseUrl: 'https://custom.overmod.org' },
    { publicKey: 'pk3', privateKey: 'sk3', label: 'Unsubscribed List', type: 'highlight' }
  ]
};

// Export
const exported = buildExportData(state, sync);
console.log('Exported:', JSON.stringify(exported, null, 2), '\n');

// Validate
const validation = validateImportData(exported);
assert.strictEqual(validation.valid, true, 'Validation failed: ' + validation.error);

// Import into empty state
const { nextState, nextSync } = applyImportData(exported, {}, {});

// Verify round-trip
assert.deepStrictEqual(new Set(nextState.subscribedLists), new Set(state.subscribedLists), 'subscribedLists mismatch');
assert.deepStrictEqual(nextState.subscribedOverrides, state.subscribedOverrides, 'subscribedOverrides mismatch');
assert.deepStrictEqual(nextState.subscribedLabels, state.subscribedLabels, 'subscribedLabels mismatch');
assert.deepStrictEqual(nextState.highlightColors, state.highlightColors, 'highlightColors mismatch');
assert.deepStrictEqual(nextState.localBlockedUsers, state.localBlockedUsers, 'localBlockedUsers mismatch');
assert.deepStrictEqual(nextState.highlightedUsers, state.highlightedUsers, 'highlightedUsers mismatch');
assert.strictEqual(nextState.apiBaseUrl, state.apiBaseUrl, 'apiBaseUrl mismatch');

// Verify writable lists preserved (including unsubscribed ones)
for (const original of sync.writableLists) {
  const imported = nextSync.writableLists.find(w => w.publicKey === original.publicKey);
  assert.ok(imported, `Missing writable list: ${original.publicKey}`);
  assert.strictEqual(imported.privateKey, original.privateKey, `privateKey mismatch for ${original.publicKey}`);
}

console.log('All round-trip assertions passed.');
