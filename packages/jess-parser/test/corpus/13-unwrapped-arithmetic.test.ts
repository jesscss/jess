/**
 * Corpus 13 — Unwrapped leading-`$var` arithmetic (value position).
 *
 * A targeted relaxation of the double-`$` rule: arithmetic that LEADS with a `$var`
 * may be written WITHOUT the `$(…)` wrapper — `$w + 1` builds the SAME `Operation`
 * node as `$($w + 1)`. Reuses the wrapped operator precedence (`*` over `+`/`-`)
 * and `_buildOperation` verbatim.
 *
 * The rule fires only when (a) the sequence leads with a `Reference` and (b) there
 * is at least one STANDALONE `+` / `-` / `*` operator. `/` is EXCLUDED (still needs
 * the wrapper — `font: 16px/1.5` slash ambiguity). An operator fused into a numeric
 * literal (`-1`, `+1`) is NOT standalone → stays a plain value list. Keyword
 * arithmetic (`w + 1`, no `$`) also stays a literal list.
 *
 * Truth table (each row pinned below):
 *   $w - 1  → Operation(subtract)      $w -1  → list [$w, -1]   (fused sign)
 *   $w + 1  → Operation(add)           $w +1  → list [$w, +1]   (fused sign)
 *   $w * 2  → Operation(multiply)      $w / 2 → list            (/ excluded)
 *   w + 1   → list                     (does not lead with $var)
 *   $w + 1 * 2  / $w * 2 + $h → precedence: * binds tighter than +/-
 */
import { describe, it } from 'vitest';
import { expectAstContains } from './_util.js';

const decl = (expr: string) => `a { width: ${expr}; }`;

describe('corpus/unwrapped-arithmetic', () => {
  it('`$w - 1` → Operation(subtract)', () => {
    expectAstContains(decl('$w - 1'), `
      (Operation
        left:
          (Reference
            key: 'w'
          )
        right:
          (Num 1)
      )`);
  });

  it('`$w -1` stays a value list (fused signed number, no standalone `-`)', () => {
    expectAstContains(decl('$w -1'), `
      value:
        [
          (Reference
            key: 'w'
          )
          (Num -1)
        ]`);
  });

  it('`$w + 1` → Operation(add)', () => {
    expectAstContains(decl('$w + 1'), `
      (Operation
        left:
          (Reference
            key: 'w'
          )
        right:
          (Num 1)
      )`);
  });

  it('`$w +1` stays a value list (fused signed number)', () => {
    expectAstContains(decl('$w +1'), `
      value:
        [
          (Reference
            key: 'w'
          )
          (Num 1)
        ]`);
  });

  it('`$w * 2` → Operation(multiply) (`*` never fuses)', () => {
    expectAstContains(decl('$w * 2'), `
      (Operation
        left:
          (Reference
            key: 'w'
          )
        right:
          (Num 2)
      )`);
  });

  it('`$w / 2` stays a value list — `/` is EXCLUDED (needs `$(…)`)', () => {
    expectAstContains(decl('$w / 2'), `
      value:
        [
          (Reference
            key: 'w'
          )
          ' /'
          (Num 2)
        ]`);
  });

  it('`w + 1` stays a list — does NOT lead with a `$var` (keyword arithmetic)', () => {
    expectAstContains(decl('w + 1'), `
      value:
        [
          (Keyword [role=keyword] 'w')
          ' +'
          (Num 1)
        ]`);
  });

  it('`$w + 1 * 2` → precedence: `*` binds tighter than `+`', () => {
    expectAstContains(decl('$w + 1 * 2'), `
      (Operation
        left:
          (Reference
            key: 'w'
          )
        right:
          (Operation
            left:
              (Num 1)
            right:
              (Num 2)
          )
      )`);
  });

  it('`$w * 2 + $h` → precedence: `*` sub-Operation on the left of `+`', () => {
    expectAstContains(decl('$w * 2 + $h'), `
      (Operation
        left:
          (Operation
            left:
              (Reference
                key: 'w'
              )
            right:
              (Num 2)
          )
        right:
          (Reference
            key: 'h'
          )
      )`);
  });

  it('a bare `$w` (no operator) stays a plain Reference', () => {
    expectAstContains(decl('$w'), `
      value:
        (Reference
          key: 'w'
        )`);
  });

  it('the wrapped `$($w + 1)` form is UNCHANGED (still Expression → Operation)', () => {
    expectAstContains(decl('$($w + 1)'), `
      (Expression
        value:
          (Operation
            left:
              (Reference
                key: 'w'
              )
            right:
              (Num 1)
          )
      )`);
  });
});
