/**
 * Corpus 07 — Mixins.
 *
 *   name(params) { … }                → Mixin definition (Less `.m`/`#m` or Sass `m`)
 *   name($p: default) { … }           → params (a List of paramVar VarDeclarations)
 *   name($p) when (cond) { … }         → mixin guard (a Condition)
 *   .box { $ > name(args); }           → mixin CALL — the call operator is `$ >`
 *   $ > #ns > .mixin()                 → chained call (nested mixin References)
 *
 * A DEFINITION is a `name(...) { ... }` — parens (even empty) mark it a Mixin, not
 * a Ruleset. Params are `$name[: default]`; a bare `$name` (no default) carries a
 * Nil value. A CALL builds `Call{ name: nested mixin-References, args: List }`; the
 * name renders back as `$ > <chain>(...)`.
 *
 * Argument/param separator is the COMMA (per the language doc's stated rule). Some
 * doc examples show `;`-separated args — a doc self-contradiction; `;` args, rest
 * params `...$x`, and `$content()` callbacks are DEFERRED (see NOTES.md).
 */
import { describe, it } from 'vitest';
import { expectAstContains, expectRoundTrip, expectParseRejected } from './_util.js';

describe('corpus/mixins', () => {
  it('mixin definition (no params) → Mixin', () => {
    expectAstContains('mixin-1() { color: red; }', `
      (Mixin
        name: 'mixin-1'
        rules:
          [
            (Declaration
              name: 'color'
              value:
                (Keyword [role=keyword] 'red')
            )
          ]
      )`);
  });

  it('mixin params with defaults → params List of paramVar VarDeclarations', () => {
    expectAstContains('button-base($bg: #1a73e8, $color: #fff) { color: $color; }', `
      (Mixin
        name: 'button-base'
        params:
          (List
            value:
              [
                (VarDeclaration
                  name: 'bg'
                  value:
                    (Color
                      node: '#1a73e8'
                    )
                )
                (VarDeclaration
                  name: 'color'
                  value:
                    (Color
                      node: '#fff'
                    )
                )
              ]
          )`);
  });

  it('mixin param without default → Nil value (required arg)', () => {
    expectAstContains('highlight($bg, $color) { background: $bg; }', `
      (Mixin
        name: 'highlight'
        params:
          (List
            value:
              [
                (VarDeclaration
                  name: 'bg'
                  value:
                    (Nil '')
                )
                (VarDeclaration
                  name: 'color'
                  value:
                    (Nil '')
                )
              ]
          )`);
  });

  it('mixin guard (`when`) → a Condition on the Mixin', () => {
    expectAstContains('mixin($a) when ($a > 0) { color: red; }', `
      (Mixin
        name: 'mixin'
        params:
          (List
            value:
              [
                (VarDeclaration
                  name: 'a'
                  value:
                    (Nil '')
                )
              ]
          )
        rules:
          [
            (Declaration
              name: 'color'
              value:
                (Keyword [role=keyword] 'red')
            )
          ]
        guard:
          (Condition
            left:
              (Reference
                key: 'a'
              )
            right:
              (Num 0)
          )
      )`);
  });

  // A mixin `when` guard is STRICT on `and`/`or` joins (same rule as `$if`): a
  // COMPARISON operand in a join must be parenthesised, and `and`/`or` can't be mixed
  // at one level. A single bare comparison guard is fine.
  it('mixin guard REJECTS a bare `and`-joined comparison', () => {
    expectParseRejected('mixin($a, $b) when $a > 0 and $b > 0 { color: red; }');
  });

  it('mixin guard REJECTS mixing `and` and `or` at one level', () => {
    expectParseRejected('mixin($a, $b, $c) when ($a > 0) and ($b > 0) or ($c > 0) { color: red; }');
  });

  it('mixin guard ACCEPTS the parenthesised join `($a > 0) and ($b > 0)`', () => {
    expectAstContains('mixin($a, $b) when ($a > 0) and ($b > 0) { color: red; }', '(Condition');
  });

  it('Less-style names (`.m` / `#m`) build a Mixin, not a Ruleset', () => {
    expectAstContains('.my-hover() { color: red; }', `(Mixin\n  name: '.my-hover'`);
    expectAstContains('#ns() { color: red; }', `(Mixin\n  name: '#ns'`);
  });

  it('mixin call (`$ >`) → Call with a nested mixin Reference name', () => {
    expectAstContains('.box { $ > mixin-1(); }', `
      (Call
        name:
          (Reference
            target:
              (Reference
                key: ''
              )
            key: 'mixin-1'
          )
        args:
          (List
            value:
              []
          )
      )`);
  });

  it('mixin call renders back as `$ > name()`', () => {
    expectRoundTrip('.box { $ > mixin-1(); }', '$ > mixin-1();');
  });

  it('chained mixin call (`$ > #ns > .mixin`) → nested References', () => {
    expectAstContains('.box { $ > #ns > .mixin(); }', `
      (Call
        name:
          (Reference
            target:
              (Reference
                target:
                  (Reference
                    key: ''
                  )
                key: '#ns'
              )
            key: '.mixin'
          )`);
  });

  it('chained call round-trips to `$ > #ns > .mixin()`', () => {
    expectRoundTrip('.box { $ > #ns > .mixin(); }', '$ > #ns > .mixin();');
  });

  it('mixin call with positional args → args List', () => {
    expectAstContains('.box { $ > mix(#fff, blue); }', `
      args:
        (List
          value:
            [
              (Color
                node: '#fff'
              )
              (Keyword [role=keyword] 'blue')
            ]
        )`);
  });
});
