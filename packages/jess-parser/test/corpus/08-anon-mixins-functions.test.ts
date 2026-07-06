/**
 * Corpus 08 — Anonymous mixins & functions.
 *
 *   $m: @() { … }        anonymous mixin (params + block body)
 *   $m: @{ … }           anonymous mixin (no params, block body)
 *   $f: @() > { … }      FUNCTION, block body (looks up final `return:`)
 *   $f: @() > <expr>     FUNCTION, single-expression body
 *
 * Core has no separate anon/function class — all four build a NAMELESS `Mixin` in
 * value position. A function is marked by the `>` return operator; per the docs a
 * function is "a mixin that looks up the final `return:` assignment", so the
 * single-expression form `@() > <expr>` is normalised into a body of one
 * `return: <expr>` Declaration — identical AST to the explicit block form. Param /
 * argument separator is the COMMA (see NOTES for the doc `;` contradiction).
 */
import { describe, it } from 'vitest';
import { expectAstContains } from './_util.js';

describe('corpus/anon-mixins-functions', () => {
  it('anon mixin `@() { … }` → nameless Mixin in value position', () => {
    expectAstContains('$my-mixin: @() { color: red; }', `
      (VarDeclaration
        name: 'my-mixin'
        value:
          (Mixin
            rules:
              [
                (Declaration
                  name: 'color'
                  value:
                    (Keyword [role=keyword] 'red')
                )
              ]
          )
      )`);
  });

  it('paren-less anon mixin `@{ … }` → same nameless Mixin', () => {
    expectAstContains('$my-mixin: @{ color: red; }', `
      (Mixin
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

  it('function block form `@() > { return: … }` → Mixin with a `return` decl', () => {
    expectAstContains('$fn: @() > { return: $(1 + 2); }', `
      (Mixin
        rules:
          [
            (Declaration
              name: 'return'
              value:
                (Expression
                  value:
                    (Operation
                      left:
                        (Num 1)
                      right:
                        (Num 2)
                    )
                )
            )
          ]
      )`);
  });

  it('single-expression function `@() > <expr>` normalises to the SAME `return` body', () => {
    expectAstContains('$fn: @() > $(1 + 2);', `
      (Mixin
        rules:
          [
            (Declaration
              name: 'return'
              value:
                (Expression
                  value:
                    (Operation
                      left:
                        (Num 1)
                      right:
                        (Num 2)
                    )
                )
            )
          ]
      )`);
  });

  it('function with params → params List + `return` body', () => {
    expectAstContains('$fn: @($a, $b) > $(1 + 2);', `
      (Mixin
        params:
          (List
            value:
              [
                (VarDeclaration
                  name: 'a'
                  value:
                    (Nil '')
                )
                (VarDeclaration
                  name: 'b'
                  value:
                    (Nil '')
                )
              ]
          )
        rules:
          [
            (Declaration
              name: 'return'`);
  });
});
