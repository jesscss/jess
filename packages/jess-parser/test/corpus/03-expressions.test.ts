/**
 * Corpus 03 — Expressions `$( … )`.
 *
 * A single Expression node wraps an arithmetic / comparison tree. Binary
 * operators REQUIRE surrounding whitespace (`1 + 2`, `5 % 2`); glued forms
 * (`1+2`, `5%2`) are NOT operations (that's Less — converting spaces them out).
 * Inside `$(…)` a bare ident is a keyword literal; `$x` is a reference.
 */
import { describe, it, expect } from 'vitest';
import { parseJessFn } from '../../src/functional-parser.js';
import { expectAstContains } from './_util.js';

describe('corpus/expressions', () => {
  it('addition', () => {
    expectAstContains('.a { width: $(1 + 2); }', `
      (Expression
        value:
          (Operation
            left:
              (Num 1)
            right:
              (Num 2)
          )
      )`);
  });

  it('modulo (spaced) — % is the operator, not a percent unit', () => {
    expectAstContains('.a { width: $(5 % 2); }', `
      (Expression
        value:
          (Operation
            left:
              (Num 5)
            right:
              (Num 2)
          )
      )`);
  });

  it('precedence: * binds tighter than +', () => {
    expectAstContains('.a { width: $(1 + 2 * 3); }', `
      (Operation
        left:
          (Num 1)
        right:
          (Operation
            left:
              (Num 2)
            right:
              (Num 3)
          )
      )`);
  });

  it('color math', () => {
    expectAstContains('.a { color: $(#222 / 2); }', `
      (Operation
        left:
          (Color
            node: '#222'
          )
        right:
          (Num 2)
      )`);
  });

  it('percent Dimension (glued) is preserved', () => {
    expectAstContains('.a { width: $(50% * 2); }', `
      (Operation
        left:
          (Dimension
            number: 50
            unit: '%'
          )
        right:
          (Num 2)
      )`);
  });

  it('bare percent is a Dimension, not an operation', () => {
    expectAstContains('.a { width: $(50%); }', `
      (Expression
        value:
          (Dimension
            number: 50
            unit: '%'
          )
      )`);
  });

  it('string concatenation', () => {
    expectAstContains('.a { content: $("a" + "b"); }', `
      (Operation
        left:
          (Quoted
            value: 'a'
          )
        right:
          (Quoted
            value: 'b'
          )
      )`);
  });

  it('reference inside an expression', () => {
    expectAstContains('.a { height: $($width + 10px); }', `
      (Operation
        left:
          (Reference
            key: 'width'
          )
        right:
          (Dimension
            number: 10
            unit: 'px'
          )
      )`);
  });

  it('bare identifier is a keyword literal', () => {
    expectAstContains('.a { color: $(red); }', `
      (Expression
        value:
          (Keyword [role=keyword] 'red')
      )`);
  });

  it('comparison → Condition', () => {
    expectAstContains('.a { x: $(1 > 2); }', `
      (Condition
        left:
          (Num 1)
        right:
          (Num 2)
      )`);
  });

  it('glued operators are NOT valid Jess expressions', () => {
    // `$(1+2)` is Less, not Jess — operators need spaces. It fails to close `$(`.
    const { errors } = parseJessFn('.a { width: $(1+2); }');
    expect(errors.length).toBeGreaterThan(0);
  });
});
