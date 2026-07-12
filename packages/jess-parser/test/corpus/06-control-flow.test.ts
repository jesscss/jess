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
import { expectAstContains, expectParseRejected } from './_util.js';

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

  // Jess is STRICT on condition JOINS: unlike Less (which accepts a bare `$a > 5 and
  // $b < 2` in value position and normalises it), Jess requires each `and`/`or`
  // operand to be a parenthesised sub-condition — `($a > 5) and ($b < 2)` — closer to
  // CSS media/container-query syntax. A single unjoined bare comparison stays valid.
  it('$if REJECTS a bare `and`-joined comparison (parens required around operands)', () => {
    expectParseRejected('$if ($a > 5 and $b < 2) { color: red; }');
  });

  it('$if REJECTS a bare `or`-joined comparison', () => {
    expectParseRejected('$if ($a > 5 or $b < 2) { color: red; }');
  });

  it('$if ACCEPTS the parenthesised join `($a > 5) and ($b < 2)`', () => {
    expectAstContains('$if (($a > 5) and ($b < 2)) { color: red; }', '(Condition');
  });

  it('$if ACCEPTS a single unjoined bare comparison `$a > 5`', () => {
    expectAstContains('$if ($a > 5) { color: red; }', `
      (Condition
        left:
          (Reference
            key: 'a'
          )
        right:
          (Num 5)
      )`);
  });

  it('$if ACCEPTS a bare NON-comparison atom operand in a join', () => {
    expectAstContains('$if (($a > 5) and true) { color: red; }', '(Condition');
    expectAstContains('$if (($a > 5) and $c) { color: red; }', '(Condition');
  });

  it('$if ACCEPTS a same-operator chain `(A) and (B) and (C)` / `or`-chain', () => {
    expectAstContains('$if (($a > 1) and ($b > 1) and ($c > 1)) { color: red; }', '(Condition');
    expectAstContains('$if (($a > 1) or ($b > 1) or ($c > 1)) { color: red; }', '(Condition');
  });

  // No implicit precedence in Jess (MQ4 rule): mixing `and` and `or` at one level is a
  // parse error — the author must group with parens.
  it('$if REJECTS mixing `and` and `or` at one level (must group)', () => {
    expectParseRejected('$if (($a > 1) and ($b > 1) or ($c > 1)) { color: red; }');
    expectParseRejected('$if (($a > 1) or ($b > 1) and ($c > 1)) { color: red; }');
  });

  it('$if ACCEPTS an explicitly grouped mixed condition', () => {
    expectAstContains('$if ((($a > 1) and ($b > 1)) or ($c > 1)) { color: red; }', '(Condition');
    expectAstContains('$if (($a > 1) and (($b > 1) or ($c > 1))) { color: red; }', '(Condition');
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
