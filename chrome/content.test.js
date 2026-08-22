// Tests for the comment blocking/hiding logic in content.js
// Run with: node content.test.js

const assert = require('assert');
const common = require('./common.js');
// content.js references these as bare globals (shared content-script scope)
global.DEFAULT_HIGHLIGHT_STYLE = common.DEFAULT_HIGHLIGHT_STYLE;
global.normalizeHighlightStyle = common.normalizeHighlightStyle;
const { compilePatterns, createMatchSet, distinctAuthors, applyBlocking, countCommentsByAuthors, countCommentsByAuthorSets, applyBothHighlights } = require('./content.js');

function fakeRow() {
  const classes = new Set();
  const cssVars = {};
  return {
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c); else classes.delete(c);
        return on;
      },
      contains: (c) => classes.has(c)
    },
    style: {
      setProperty: (k, v) => { cssVars[k] = v; },
      removeProperty: (k) => { delete cssVars[k]; }
    },
    querySelectorAll: () => [],
    cssVars
  };
}

function item(author, indent, opts = {}) {
  return {
    row: fakeRow(),
    id: opts.id || '',
    author,
    authorLower: author.toLowerCase(),
    indent,
    isGreen: !!opts.green
  };
}

function hiddenFlags(index) {
  return index.map((it) => it.row.classList.contains('overmod-hidden'));
}

console.log('Testing createMatchSet...');
{
  // Names arrive pre-lowercased from the service worker's merged lists
  const set = createMatchSet(['alice', 'bob'], [], new Set());
  assert.strictEqual(set.has('alice'), true);
  assert.strictEqual(set.has('bob'), true);
  assert.strictEqual(set.has('carol'), false);

  // Patterns resolve against page authors into plain Set entries
  const authors = new Set(['spammer1', 'spammer22', 'regular']);
  const withPatterns = createMatchSet(['alice'], ['spammer\\d+'], authors);
  assert.strictEqual(withPatterns.has('alice'), true);
  assert.strictEqual(withPatterns.has('spammer1'), true);
  assert.strictEqual(withPatterns.has('spammer22'), true);
  assert.strictEqual(withPatterns.has('regular'), false);
  assert.strictEqual(withPatterns instanceof Set, true);

  // Invalid patterns are skipped, valid ones still apply
  const mixed = createMatchSet([], ['[bad', 'good.*'], new Set(['gooduser', 'other']));
  assert.strictEqual(mixed.has('gooduser'), true);
  assert.strictEqual(mixed.has('other'), false);

  assert.strictEqual(compilePatterns(['[bad', 'ok']).length, 1);
}

console.log('Testing distinctAuthors...');
{
  const index = [item('Alice', 0), item('bob', 1), item('ALICE', 0), item('', 1)];
  assert.deepStrictEqual([...distinctAuthors(index)].sort(), ['alice', 'bob']);
}

console.log('Testing applyBlocking hides blocked author and subtree...');
{
  const index = [
    item('root', 0),
    item('blocked', 1),
    item('child', 2),
    item('grandchild', 3),
    item('sibling', 1)
  ];
  const count = applyBlocking(index, new Set(['blocked']), false);
  assert.deepStrictEqual(hiddenFlags(index), [false, true, true, true, false]);
  assert.strictEqual(count, 3);
}

console.log('Testing applyBlocking with nested blocked authors...');
{
  const index = [
    item('blocked1', 0),
    item('blocked2', 1),
    item('child', 2),
    item('after', 0)
  ];
  applyBlocking(index, new Set(['blocked1', 'blocked2']), false);
  assert.deepStrictEqual(hiddenFlags(index), [true, true, true, false]);
}

console.log('Testing applyBlocking unhides on re-apply with empty set...');
{
  const index = [item('a', 0), item('b', 1), item('c', 0)];
  applyBlocking(index, new Set(['a']), false);
  assert.deepStrictEqual(hiddenFlags(index), [true, true, false]);
  applyBlocking(index, new Set(), false);
  assert.deepStrictEqual(hiddenFlags(index), [false, false, false]);
}

console.log('Testing applyBlocking green hiding...');
{
  const index = [
    item('a', 0),
    item('newbie', 1, { green: true }),
    item('reply', 2),
    item('b', 1)
  ];
  // Green-only hiding doesn't count toward the removed (blocked) banner
  assert.strictEqual(applyBlocking(index, new Set(), true), 0);
  assert.deepStrictEqual(hiddenFlags(index), [false, true, true, false]);

  // Green showing again: everything unhidden
  applyBlocking(index, new Set(), false);
  assert.deepStrictEqual(hiddenFlags(index), [false, false, false, false]);

  // Green row inside a blocked subtree stays hidden with the subtree,
  // and so does everything else under the blocked root
  assert.strictEqual(applyBlocking(index, new Set(['a']), true), 4);
  assert.deepStrictEqual(hiddenFlags(index), [true, true, true, true]);

  // Blocked author beneath a green-hidden root still counts as blocked
  const nested = [
    item('newbie', 0, { green: true }),
    item('blocked', 1),
    item('after', 0)
  ];
  assert.strictEqual(applyBlocking(nested, new Set(['blocked']), true), 1);
  assert.deepStrictEqual(hiddenFlags(nested), [true, true, false]);
}

console.log('Testing countCommentsByAuthors...');
{
  const index = [
    item('root', 0),
    item('blocked', 1),
    item('child', 2),
    item('sibling', 1),
    item('blocked', 0)
  ];
  assert.strictEqual(countCommentsByAuthors(index, new Set(['blocked'])), 3);
  assert.strictEqual(countCommentsByAuthors(index, new Set()), 0);
  assert.strictEqual(countCommentsByAuthors(index, new Set(['nobody'])), 0);

  // Multi-set variant counts each set independently in one pass
  // ('root' at indent 0 owns the next three rows as its subtree)
  assert.deepStrictEqual(
    countCommentsByAuthorSets(index, [new Set(['blocked']), new Set(['root']), new Set()]),
    [3, 4, 0]
  );
}

console.log('Testing applyBothHighlights...');
{
  const highlighted = (index) => index.map((it) => it.row.classList.contains('overmod-highlight'));

  // Manual ID highlights the comment and its subtree
  const index = [
    item('root', 0, { id: 'c1' }),
    item('child', 1, { id: 'c2' }),
    item('sibling', 0, { id: 'c3' })
  ];
  applyBothHighlights(index, new Set(['c1']), new Set(), new Map());
  assert.deepStrictEqual(highlighted(index), [true, true, false]);

  // Re-apply with nothing highlighted clears previously highlighted rows
  applyBothHighlights(index, new Set(), new Set(), new Map());
  assert.deepStrictEqual(highlighted(index), [false, false, false]);

  // User highlight styles only the author's own rows, with their style
  const styleMap = new Map([['child', { bg: '#112233', fg: '#445566' }]]);
  applyBothHighlights(index, new Set(), new Set(['child']), styleMap);
  assert.deepStrictEqual(highlighted(index), [false, true, false]);
  assert.strictEqual(index[1].row.cssVars['--overmod-highlight-bg'], '#112233');

  // User style wins over the manual default within a manual subtree
  applyBothHighlights(index, new Set(['c1']), new Set(['child']), styleMap);
  assert.deepStrictEqual(highlighted(index), [true, true, false]);
  assert.strictEqual(index[1].row.cssVars['--overmod-highlight-bg'], '#112233');
  assert.strictEqual(index[0].row.cssVars['--overmod-highlight-bg'], common.DEFAULT_HIGHLIGHT_STYLE.bg);
}

console.log('Testing toPageState...');
{
  const full = {
    apiBaseUrl: 'https://api.example',
    writableLists: [{ publicKey: 'pk', privateKey: 'secret' }],
    localBlockedUsers: ['x'],
    subscribedLists: ['pk'],
    highlightColors: { pk: '#112233' },
    highlightedUsers: ['Alice'],
    hideGreenComments: true,
    blocked: {
      combined: ['a'], combinedWithoutTransient: ['a'], transientOnly: [],
      localPatterns: ['p.*'], sourceLists: { pk: ['a'] }, lastSync: 5
    },
    highlighted: { combined: ['h'], sourceLists: { pk: ['h'] }, lastSync: 5 }
  };
  const slim = common.toPageState(full);
  // Additive allowlist: fields not needed to render a comment page — and
  // everything sensitive — must be absent, not emptied.
  assert.strictEqual(slim.writableLists, undefined);
  assert.strictEqual(slim.localBlockedUsers, undefined);
  assert.strictEqual(slim.apiBaseUrl, undefined);
  assert.strictEqual(slim.blocked.sourceLists, undefined);
  assert.deepStrictEqual(slim.blocked.combined, ['a']);
  assert.deepStrictEqual(slim.blocked.localPatterns, ['p.*']);
  assert.deepStrictEqual(slim.highlighted.sourceLists, { pk: ['h'] });
  assert.deepStrictEqual(slim.highlightedUsers, ['Alice']);
  assert.strictEqual(slim.hideGreenComments, true);

  // Legacy states without combinedWithoutTransient must keep it undefined
  // so the `|| combined` fallback in updateBlockedSets still engages.
  const legacy = common.toPageState({ blocked: { combined: ['a'] } });
  assert.strictEqual(legacy.blocked.combinedWithoutTransient, undefined);
  assert.deepStrictEqual(legacy.blocked.combined, ['a']);

  // Tolerates an empty/absent state (worker-unreachable local fallback)
  assert.deepStrictEqual(common.toPageState({}).blocked.combined, []);
}

console.log('Testing toPublicWritableLists...');
{
  const pub = common.toPublicWritableLists([
    { publicKey: 'pk1', privateKey: 'sk1', label: 'L', type: 'block', baseUrl: 'https://api.example' },
    { publicKey: 'pk2', privateKey: 'sk2' }
  ]);
  // Chooser UIs keep list identity/name/kind/host; signing keys never
  // appear in a message reply.
  assert.deepStrictEqual(pub.map(l => l.publicKey), ['pk1', 'pk2']);
  assert.strictEqual(pub[0].label, 'L');
  assert.strictEqual(pub[0].type, 'block');
  assert.strictEqual(pub[0].baseUrl, 'https://api.example');
  assert.ok(pub.every(l => !('privateKey' in l)));

  assert.deepStrictEqual(common.toPublicWritableLists(undefined), []);
}

console.log('Testing confirmed list writes update cached blocking immediately...');
{
  const initial = {
    subscribedLists: ['early', 'mine', 'transient'],
    subscribedOverrides: { early: 'highlight', mine: 'block', transient: 'block' },
    transientLists: { transient: true },
    localBlockedUsers: ['local', 'bot.*'],
    highlightedUsers: [],
    blocked: {
      combined: ['old', 'temporary'],
      combinedWithoutTransient: ['old'],
      transientOnly: ['temporary'],
      sourceLists: { mine: ['old'], transient: ['temporary'] },
      lastSync: 123
    },
    highlighted: {
      combined: ['alice'],
      sourceLists: { early: ['alice'] },
      lastSync: 123
    }
  };

  const added = common.applyListUserMutation(initial, {
    action: 'add', publicKey: 'mine', username: 'Alice', listType: 'block'
  });
  // The earlier highlight list still wins, while an ordinary new block is
  // reflected in both the cached source list and merged page state.
  assert.deepStrictEqual(added.blocked.sourceLists.mine, ['old', 'Alice']);
  assert.ok(!added.blocked.combined.includes('alice'));
  const blocked = common.applyListUserMutation(added, {
    action: 'add', publicKey: 'mine', username: 'Bob', listType: 'block'
  });
  assert.ok(blocked.blocked.combined.includes('bob'));
  assert.ok(blocked.blocked.combinedWithoutTransient.includes('bob'));
  assert.deepStrictEqual(blocked.blocked.transientOnly, ['temporary']);
  assert.deepStrictEqual(blocked.blocked.localPatterns, ['bot.*']);
  assert.strictEqual(blocked.blocked.lastSync, 123);

  const removed = common.applyListUserMutation(blocked, {
    action: 'remove', publicKey: 'mine', username: 'BOB', listType: 'block'
  });
  assert.ok(!removed.blocked.combined.includes('bob'));
  assert.ok(!removed.blocked.sourceLists.mine.some(name => name.toLowerCase() === 'bob'));

  // A writable list that was not subscribed becomes effective locally too.
  const newList = common.applyListUserMutation(removed, {
    action: 'add', publicKey: 'new-list', username: 'Carol', listType: 'block'
  });
  assert.ok(newList.subscribedLists.includes('new-list'));
  assert.strictEqual(newList.subscribedOverrides['new-list'], 'block');
  assert.ok(newList.blocked.combined.includes('carol'));
}

console.log('\nAll content.js tests passed.');
