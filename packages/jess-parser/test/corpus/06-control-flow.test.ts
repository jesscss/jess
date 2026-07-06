/**
 * Corpus 06 — Control flow: `$if` / `$else` / `$for` / `$while`.
 *
 *   $if (cond) { … } $else if (cond) { … } $else { … }   → If (else-chain)
 *   $for ($x, $i of $list) { … }                          → For (tuple binding)
 *   $for ([$k, $v] of $list) { … }                        → For (destructure)
 *   $for ($i of 1 to 3) { … }                             → For (inclusive range)
 *   $for ($i of 1 to <3) { … }                            → For (exclusive end)
 *   $while (cond) { … }                                   → While
 *
 * Control-flow keywords start with `$`, but the parenthesised header exits
 * expression mode — a variable read there must be written `$foo`; a bare ident
 * is a keyword literal (`true`/`false`). Comparison ops (`=` `>` `<` `>=` `<=`)
 * and logical `and`/`or`/`not (…)` join operands.
 */
import { describe, it } from 'vitest';
import { expectAstContains } from './_util.js';

describe('corpus/control-flow', () => {
  it('$if with comparison → If + Condition', () => {
    expectAstContains('$if ($foo = bar) { color: red; }', `
      (If
        condition:
          (Condition
            left:
              (Reference
                key: 'foo'
              )
            right:
              (Keyword [role=keyword] 'bar')
          )
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

  it('$if / $else if / $else → nested If chain ending in Rules', () => {
    expectAstContains('$if ($a) { color: red; } $else if ($b) { color: blue; } $else { color: green; }', `
      (If
        condition:
          (Reference
            key: 'a'
          )`);
    expectAstContains('$if ($a) { color: red; } $else if ($b) { color: blue; } $else { color: green; }', `
        else:
          (If
            condition:
              (Reference
                key: 'b'
              )`);
    expectAstContains('$if ($a) { color: red; } $else if ($b) { color: blue; } $else { color: green; }', `
            else:
              (Rules
                rules:
                  [
                    (Declaration
                      name: 'color'
                      value:
                        (Keyword [role=keyword] 'green')
                    )
                  ]
              )`);
  });

  it('$if with `not (…)` → negated Condition', () => {
    expectAstContains('$if (not ($a)) { color: red; }', `
      (If
        condition:
          (Condition
            left:
              (Reference
                key: 'a'
              )
          )`);
  });

  it('$if with `and` → left-folded Condition', () => {
    expectAstContains('$if ($a and $b) { color: red; }', `
      (Condition
        left:
          (Reference
            key: 'a'
          )
        right:
          (Reference
            key: 'b'
          )
      )`);
  });

  it('$while → While + Condition', () => {
    expectAstContains('$while ($i < 3) { color: red; }', `
      (While
        condition:
          (Condition
            left:
              (Reference
                key: 'i'
              )
            right:
              (Num 3)
          )`);
  });

  it('$for single binding over an inclusive range', () => {
    expectAstContains('$for ($i of 1 to 3) { value: $i; }', `
      (For
        pattern: {
          kind: 'single'
          value:
            (VarDeclaration
              name: 'i'
              value: ''
            )
        }
        iterable: {
          kind: 'range'
          start:
            (Num 1)
          end:
            (Num 3)
          includeStart: true
          includeEnd: true
        }`);
  });

  it('$for exclusive-end range (`to <3`)', () => {
    expectAstContains('$for ($i of 1 to <3) { value: $i; }', `
        iterable: {
          kind: 'range'
          start:
            (Num 1)
          end:
            (Num 3)
          includeStart: true
          includeEnd: false
        }`);
  });

  it('$for tuple binding over a list', () => {
    expectAstContains('$for ($x, $i of $list) { value: $i; }', `
        pattern: {
          kind: 'tuple'
          values:
            [
              (VarDeclaration
                name: 'x'
                value: ''
              )
              (VarDeclaration
                name: 'i'
                value: ''
              )
            ]
        }`);
  });

  it('$for destructure binding (`[$k, $v]`)', () => {
    expectAstContains('$for ([$key, $value] of $list) { value: $value; }', `
        pattern: {
          kind: 'tuple'
          values:
            [
              (VarDeclaration
                name: 'key'
                value: ''
              )
              (VarDeclaration
                name: 'value'
                value: ''
              )
            ]
        }`);
  });
});
