// Tests for the comment blocking/hiding logic in content.js
// Run with: node content.test.js

const assert = require('assert');
const { compilePatterns, createMatchSet, distinctAuthors, applyBlocking, countCommentsByAuthors } = require('./content.js');

function fakeRow() {
  const classes = new Set();
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
    }
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
  const set = createMatchSet(['Alice', 'BOB'], [], new Set());
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
  applyBlocking(index, new Set(['blocked']), false);
  assert.deepStrictEqual(hiddenFlags(index), [false, true, true, true, false]);
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
  applyBlocking(index, new Set(), true);
  assert.deepStrictEqual(hiddenFlags(index), [false, true, true, false]);

  // Green showing again: everything unhidden
  applyBlocking(index, new Set(), false);
  assert.deepStrictEqual(hiddenFlags(index), [false, false, false, false]);

  // Green row inside a blocked subtree stays hidden with the subtree,
  // and so does everything else under the blocked root
  applyBlocking(index, new Set(['a']), true);
  assert.deepStrictEqual(hiddenFlags(index), [true, true, true, true]);
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
}

console.log('\nAll content.js tests passed.');
