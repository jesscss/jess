/**
 * Regression test for the `:is()` "append new alternative" location matcher.
 *
 * `searchWithinPseudoSelector` used to emit an unconditional `'append'` extend
 * location for EVERY `:is(...)` in the target — "the find could be added here as a
 * new alternative" — regardless of whether the find actually occurs inside the
 * `:is()`. A multi-position find like `.ext8 .ext9` (which never appears in
 * `:is(.foo, …) :is(.bar, …)`) would therefore spuriously "match" and corrupt the
 * selector, re-distributing the `:is()` and fabricating cross-product rows.
 *
 * The append location is now gated on the find genuinely matching an existing
 * alternative of that `:is()`. See the Less `extend`/`extend-selector` all-less
 * fixtures (`:is(.foo, .ext1 .ext2, .ext3, .ext4) :is(.bar, .ext3, .ext4)`).
 */
import { describe, it, expect } from 'vitest';
import { SelectorList, PseudoSelector, el, sel, co } from '../../index.js';
import { tryExtendSelector } from '../extend.js';

const isPseudo = (...alts: Parameters<typeof SelectorList.create>[0]) =>
  PseudoSelector.create({ name: ':is', arg: SelectorList.create(alts) });

describe('extend: :is() spurious append-alternative match', () => {
  it('a multi-position find that does not occur must NOT match an :is()-bearing target', () => {
    // :is(.foo, .ext1 .ext2, .ext3, .ext4) :is(.bar, .ext3, .ext4)
    const target = sel([
      isPseudo(el('.foo'), sel([el('.ext1'), co(' '), el('.ext2')]), el('.ext3'), el('.ext4')),
      co(' '),
      isPseudo(el('.bar'), el('.ext3'), el('.ext4'))
    ]);
    const before = target.valueOf();
    const r = tryExtendSelector(target, sel([el('.ext8'), co(' '), el('.ext9')]), el('.buu'), true);
    // `.ext8 .ext9` never appears — the target must be returned unchanged (NOT_FOUND).
    expect(r.value.valueOf()).toBe(before);
    expect(r.error?.type).toBe('NOT_FOUND');
  });

  it('a find that DOES occur as an :is() alternative still appends the extendWith', () => {
    // :is(.foo, .bar) — extending `.foo` should append `.qux` to the list.
    const target = isPseudo(el('.foo'), el('.bar'));
    const r = tryExtendSelector(target, el('.foo'), el('.qux'), true);
    expect(r.value.valueOf()).toBe(':is(.foo,.bar,.qux)');
  });
});
