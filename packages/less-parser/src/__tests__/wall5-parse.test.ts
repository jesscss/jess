/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- test inspects parser tree internals structurally. */
import { describe, it, expect } from 'vitest';
import { Parser } from '../jess.js';

/**
 * Bootstrap wall-5: `-(@gutter / 2)` (grid mixin `_grid.less`) threw
 * `Cannot operate on Paren` at render. Root cause was in the grammar: the
 * `-` in `-(…)` matched `GluedParen`'s lookbehind (its char class included a
 * trailing `-`), so the paren body was parsed permissively — the inner `/`
 * stayed a slash-`List` instead of a math `Operation`. `Negative` then tried to
 * `operate` on the unreduced `Paren`, hitting the base `Cannot operate` throw.
 *
 * A standalone `(@g / 2)` (no leading minus) always took the strict `Paren`
 * body and produced an `Operation`. The fix restricts GluedParen's trailing `-`
 * to only match when it terminates an identifier, so a unary-minus paren falls
 * through to the strict math paren.
 */
function firstOfType(node: any, type: string): any {
  if (!node || typeof node !== 'object') {
    return undefined;
  }
  if (node.type === type) {
    return node;
  }
  const keys = (node.constructor?.childKeys ?? []) as string[];
  for (const k of keys) {
    const v = node[k];
    const arr = Array.isArray(v) ? v : [v];
    for (const it of arr) {
      const found = firstOfType(it, type);
      if (found) {
        return found;
      }
    }
  }
  // Operation stores operands positionally
  if (node.type === 'Operation') {
    return firstOfType(node.left, type) ?? firstOfType(node.right, type);
  }
  return undefined;
}

describe('wall5 parse: unary-minus paren keeps math division', () => {
  const parse = (src: string): any => {
    const p = new Parser({ mathMode: 'parens-division' } as never);
    return (p as any).parse(src, 'Stylesheet');
  };

  it('parses `-(30px / 2)` as Negative(Paren(Operation /)), not a slash-List', () => {
    const res = parse('.x { width: -(30px / 2); }');
    expect(res.errors ?? []).toHaveLength(0);
    const neg = firstOfType(res.tree, 'Negative');
    expect(neg).toBeDefined();
    const paren = firstOfType(neg, 'Paren');
    expect(paren).toBeDefined();
    // The Paren's inner must be a division Operation (in-parens math), not a
    // preserved slash-List.
    expect(paren.value?.type).toBe('Operation');
    expect(paren.value?.operator).toBe('/');
  });

  it('keeps the standalone `(30px / 2)` a division Operation too', () => {
    const res = parse('.x { width: (30px / 2); }');
    const paren = firstOfType(res.tree, 'Paren');
    expect(paren?.value?.type).toBe('Operation');
  });
});
