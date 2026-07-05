/**
 * Regression tests for the extend engine operating on parser-shaped selectors:
 * a `ComplexSelector` whose selector fragments are raw STRINGS (`'.foo'`) rather
 * than `BasicSelector` nodes — the shape the LESS parser emits (strings-not-nodes
 * model). Factory helpers (`sel`/`el`/`co`) build node-shaped selectors, so these
 * bugs never surfaced in the existing node-shape suites; they only appear on real
 * parser output. See the `extend`/`extend-media`/`extend-chaining` all-less fixtures.
 */
import { describe, it, expect } from 'vitest';
import { ComplexSelector, SelectorList, el, sel, co } from '../../index.js';
import { walkAndExtend } from '../extend-walk.js';
import { tryExtendSelector, applyExtendsToSelector } from '../extend.js';

describe('extend on string-leaf ComplexSelectors (parser shape)', () => {
  it('walk: partial match of a string leaf inside a complex wraps it in :is()', () => {
    // Parser emits `.foo .bar` as ComplexSelector(['.foo', ' ', '.bar']).
    const target = new ComplexSelector(['.foo', ' ', '.bar']);
    const out = walkAndExtend(target, el('.foo'), el('.qux'), true);
    expect(out.valueOf()).toBe(':is(.foo,.qux) .bar');
  });

  it('walk: string-leaf partial supports a SelectorList extendWith (flattened into :is())', () => {
    const target = new ComplexSelector(['.foo', ' ', '.bar']);
    const out = walkAndExtend(target, el('.foo'), SelectorList.create([el('.a'), el('.b')]), true);
    expect(out.valueOf()).toBe(':is(.foo,.a,.b) .bar');
  });

  it('location matcher: a non-matching complex find must NOT spuriously match a string-leaf complex', () => {
    // `.ext8 .ext9` does not occur in `.foo .bar` — must return unchanged, not append `.buu`.
    const target = new ComplexSelector(['.foo', ' ', '.bar']);
    const r = tryExtendSelector(target, sel([el('.ext8'), co(' '), el('.ext9')]), el('.buu'), true);
    expect(r.value.valueOf()).toBe('.foo .bar');
  });

  it('parity: string-leaf and node-shape complexes reject the same non-matching find', () => {
    const strLeaf = new ComplexSelector(['.foo', ' ', '.bar']);
    const nodeShape = sel([el('.foo'), co(' '), el('.bar')]);
    const find = sel([el('.ext8'), co(' '), el('.ext9')]);
    const rStr = tryExtendSelector(strLeaf, find, el('.buu'), true);
    const rNode = tryExtendSelector(nodeShape, find, el('.buu'), true);
    expect(rStr.value.valueOf()).toBe(rNode.value.valueOf());
  });

  it('apply: partial extend of a string-leaf selector list produces :is()-wrapped output', () => {
    const list = SelectorList.create([
      new ComplexSelector(['.foo', ' ', '.bar']),
      new ComplexSelector(['.foo', ' ', '.baz'])
    ]);
    const out = applyExtendsToSelector(list, [
      { target: el('.foo'), extendWith: el('.qux'), partial: true }
    ] as Parameters<typeof applyExtendsToSelector>[1]);
    expect(out.valueOf()).toBe(':is(.foo,.qux) .bar,:is(.foo,.qux) .baz');
  });
});
