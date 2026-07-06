/**
 * Corpus 09 — `$extend` statement.
 *
 *   $extend .box;             extend a selector (Jess/Sass default = partial match)
 *   $extend .box !exact;      Less-style exact match
 *   $extend ns|.box;          namespaced target
 *   $extend .a, .b;           comma list → one Extend per target (in a List)
 *
 * This is Jess's STATEMENT form (not Less's `:extend()` pseudo). It builds a core
 * `Extend{ target, flag }`, which already serializes back with the `$extend` sigil.
 * The target is a real Selector node (a bare string crashes `Extend.writeSyntax`),
 * so it is wrapped in a `BasicSelector`. Extending a CAPTURED selector
 * (`$extend $type;`, `$type: $*[.sel]`) waits on `$*[…]` — see NOTES.
 */
import { describe, it, expect } from 'vitest';
import { expectAstContains, parse } from './_util.js';

/** Parse a top-level `$extend …;` and return the Extend node's own serialization.
 * (A top-level Extend renders invisibly in full CSS output, so assert the node's
 * `toTrimmedString`, which carries the `$extend`/`!exact`/`ns|` surface.) */
function extendSyntax(src: string): string {
  const { tree } = parse(src);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ext = (tree as any).rules?.[0] ?? (tree as any).value?.[0];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
  return ext.toTrimmedString();
}

describe('corpus/extend', () => {
  it('`$extend .box;` → Extend with a BasicSelector target', () => {
    expectAstContains('.danger { $extend .box; }', `
      (Extend
        target:
          (BasicSelector '.box')
      )`);
  });

  it('`$extend` round-trips to `$extend .box;`', () => {
    expect(extendSyntax('$extend .box;')).toBe('$extend .box;');
  });

  it('`!exact` selects the exact-match flag (round-trips with `!exact`)', () => {
    expect(extendSyntax('$extend .box !exact;')).toBe('$extend .box !exact;');
  });

  it('namespaced target round-trips to `ns|.box`', () => {
    expect(extendSyntax('$extend theme|.box;')).toBe('$extend theme|.box;');
  });

  it('comma list → one Extend per target, wrapped in a List', () => {
    expectAstContains('.danger { $extend .notice, .danger; }', `
      (List
        value:
          [
            (Extend
              target:
                (BasicSelector '.notice')
            )
            (Extend
              target:
                (BasicSelector '.danger')
            )
          ]
      )`);
  });
});
