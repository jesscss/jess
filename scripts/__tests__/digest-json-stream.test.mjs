/**
 * BYTE-IDENTITY PROOF for the streaming JSON digest.
 *
 * The whole claim of `scripts/digest-json-stream.mjs` is that it produces the
 * SAME `{ bytes, sha256 }` that `Buffer.from(JSON.stringify(value))` produced,
 * for every value `JSON.stringify` accepts. If a digest moves, the
 * canonicalization changed and that is a bug in the replacement, not an
 * improvement — so this file compares the two on every shape that matters
 * rather than asserting a hardcoded hash.
 *
 * Run: `node --test scripts/__tests__/digest-json-stream.test.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { digestJson } from '../digest-json-stream.mjs';

/** The previous implementation, verbatim: stringify the whole thing, then hash. */
function referenceDigest(value) {
  const text = JSON.stringify(value);
  if (text === undefined) {
    return undefined;
  }
  const buffer = Buffer.from(text, 'utf8');
  return { bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') };
}

const CASES = {
  // Scalars and roots.
  'null root': null,
  true: true,
  false: false,
  zero: 0,
  'negative zero': -0,
  float: 1.5,
  exponent: 1e21,
  'max safe integer': Number.MAX_SAFE_INTEGER,
  'string root': 'hello',
  'empty string': '',

  // Non-finite numbers become null.
  NaN: { a: NaN },
  Infinity: { a: Infinity, b: -Infinity },

  // Escaping — delegated to JSON.stringify, so this proves the delegation.
  'quotes and backslashes': { 'a"b\\c': 'd"e\\f' },
  'control characters': { a: '\u0000\u0001\u001f\n\r\t\b\f' },
  unicode: { ключ: 'значение', emoji: '🎨🔥', cjk: '日本語' },
  'astral pair': { a: '\u{1F600}' },
  'lone high surrogate': { a: '\uD800' },
  'lone low surrogate': { a: '\uDC00' },
  'surrogate at string end': { a: `padding${'\uD83D'}` },

  // Containers.
  'empty object': {},
  'empty array': [],
  'nested empties': { a: {}, b: [], c: [{}, []] },
  'array of scalars': [1, 'two', true, null],
  'mixed nesting': { a: [1, { b: [2, { c: 3 }] }] },

  // Omission semantics: skipped in objects, `null` in arrays.
  'undefined member': { a: 1, b: undefined, c: 2 },
  'function member': { a: 1, b() {}, c: 2 },
  'symbol member': { a: 1, b: Symbol('s'), c: 2 },
  'all members omitted': { a: undefined, b: undefined },
  'leading member omitted': { a: undefined, b: 1 },
  'trailing member omitted': { a: 1, b: undefined },
  'undefined in array': [1, undefined, 2],
  'function in array': [1, () => {}, 2],
  'sparse array': [1, , 3],

  /*
   * Boxed primitives serialize as the primitive, not as an object. `typeof`
   * reports 'object' for all three, so treating them as containers silently
   * changes the digest — `new Number(5)` would become `{}` instead of `5`.
   */
  'boxed number': new Number(5),
  'boxed string': new String('x'),
  'boxed boolean': new Boolean(true),
  'boxed nested': { a: new Number(7), b: new String('y'), c: new Boolean(false) },
  'boxed in array': [new Number(1), new String('two')],

  // Key order is insertion order for both implementations.
  'key order': { z: 1, a: 2, m: 3, 10: 4, 2: 5 },

  // toJSON is honored — the mechanism core relies on to stay acyclic.
  'toJSON scalar': { a: { toJSON: () => 'replaced' } },
  'toJSON container': { a: { toJSON: () => ({ x: [1, 2] }) } },
  'toJSON at root': { toJSON: () => ({ root: true }) },
  'toJSON returning undefined': { a: { toJSON: () => undefined }, b: 1 },
  'Date (toJSON)': { at: new Date(0) },

  // A shared (non-cyclic) subtree is duplicated by JSON, not rejected.
  'shared subtree': (() => {
    const shared = { s: 1 };
    return { a: shared, b: shared, c: [shared, shared] };
  })(),

  // Something tree-shaped and deep enough to cross the 64 KiB flush boundary.
  'wide tree': {
    type: 'Stylesheet',
    rules: Array.from({ length: 400 }, (_, i) => ({
      type: 'Rule',
      selector: { type: 'Selector', text: `.cls-${i} > a:hover` },
      declarations: [
        { type: 'Declaration', name: 'color', value: `#${i.toString(16).padStart(6, '0')}` },
        { type: 'Declaration', name: 'content', value: '"quoted \\ value"' }
      ]
    }))
  },

  'deep chain': (() => {
    let node = { leaf: true };
    for (let i = 0; i < 2000; i++) {
      node = { type: 'Rules', depth: i, children: [node] };
    }
    return node;
  })()
};

test('digestJson is byte-identical to sha256(JSON.stringify(value))', () => {
  for (const [name, value] of Object.entries(CASES)) {
    assert.deepEqual(digestJson(value), referenceDigest(value), `digest moved for: ${name}`);
  }
});

test('digestJson matches on values JSON.stringify omits entirely', () => {
  for (const value of [undefined, () => {}, Symbol('s')]) {
    assert.equal(digestJson(value), referenceDigest(value));
  }
});

test('digestJson crosses the flush boundary without splitting a surrogate pair', () => {
  // A long run of astral characters guarantees many flushes land near pairs.
  const value = { a: '🎨'.repeat(80_000) };
  assert.deepEqual(digestJson(value), referenceDigest(value));
});

test('digestJson reports a cycle with its path instead of a bare TypeError', () => {
  const root = { type: 'Rules', children: [] };
  const child = { type: 'Rule', parent: root };
  root.children.push(child);

  assert.throws(() => JSON.stringify(root), TypeError);
  assert.throws(() => digestJson(root), /Converting circular structure to JSON at children\.0\.parent/u);
});

test('digestJson survives a tree far deeper than the call stack', () => {
  // The depth at which JSON.stringify overflows; digestJson uses a heap stack.
  let node = { leaf: true };
  for (let i = 0; i < 400_000; i++) {
    node = { child: node };
  }
  assert.throws(() => JSON.stringify(node), RangeError);

  const digest = digestJson(node);
  assert.equal(typeof digest.sha256, 'string');
  assert.equal(digest.sha256.length, 64);
});
