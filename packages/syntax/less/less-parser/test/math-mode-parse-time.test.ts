import { describe, expect, it } from 'vitest';
import type { Operation, Statement, ValueNode, ValueSlot } from '@jesscss/core/ast';
import { parse } from '@jesscss/less-parser';

/**
 * `math:` is a PARSE-TIME input (ledger P1, §12.6b), and this file pins the
 * PARSE half of that: the mapping from mode + operator to
 * `Operation.mathOutsideParens`, read straight off the node.
 *
 * It exists because the eval half is testable from a hand-built node while the
 * parse half was not testable at all — break the mode→boolean mapping to a
 * constant and, under the default mode, nothing else in the suite goes red.
 * That is incident S7 (an unpinned rule) and this is the ratchet for it.
 *
 * The field is asserted DIRECTLY rather than through emitted bytes on purpose.
 * Bytes conflate the parse decision with the evaluator's paren frames and calc
 * depth; this file's whole job is the parser's own answer.
 */

function requireOperation(value: ValueSlot | ValueNode): Operation {
  if (Array.isArray(value)) {
    for (const part of value) {
      const found = findOperation(part);
      if (found !== null) {
        return found;
      }
    }
    throw new TypeError('no Operation in value slot');
  }
  const found = findOperation(value);
  if (found === null) {
    throw new TypeError('no Operation in value');
  }
  return found;
}

function findOperation(value: unknown): Operation | null {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return null;
  }
  if (value.type === 'Operation') {
    return value as Operation;
  }
  if (value.type === 'Block' && 'value' in value) {
    return findOperation(value.value);
  }
  return null;
}

const MODES = ['always', 'parens-division', 'parens', 'strict'] as const;

describe('Less `math:` resolves at PARSE time onto Operation.mathOutsideParens', () => {
  it('the mode actually reaches the grammar — `+` flips with it', () => {
    const answers = MODES.map(mathMode =>
      parseOperation('.a { k: 1 + 2; }', mathMode).mathOutsideParens);
    expect(answers).toEqual([true, true, false, false]);
  });

  it('the mode actually reaches the grammar — `/` inside parens flips with it', () => {
    const answers = MODES.map(mathMode =>
      parseOperation('.a { k: (4px / 2); }', mathMode).mathOutsideParens);
    expect(answers).toEqual([true, false, false, false]);
  });

  /*
   * A `/` inside `calc(…)` is division in CSS itself, not by Less policy. The
   * node records that this operation does not compute on its OWN under
   * `parens-division`; what makes it fold is the enclosing math context.
   *
   * `inMathFunction` is deliberately NOT asserted here. The Less grammar does
   * not set it yet — routing its math names needs a per-dialect argument
   * grammar, because in `.less` a `/` inside a call is a list boundary — so the
   * calc interior is still carried by the evaluator's ambient depth. That gap is
   * a different lane's; this file pins the mode mapping only.
   */
  it('a `calc(…)` operand records the mode, and does not compute bare under parens-division', () => {
    expect(deepOperation('.a { k: calc(4px / 2); }', 'parens-division').mathOutsideParens).toBe(false);
    expect(deepOperation('.a { k: calc(4px / 2); }', 'always').mathOutsideParens).toBe(true);
  });

  it('unary minus answers to the mode too', () => {
    const answers = MODES.map(mathMode =>
      parseOperation('@x: 3px; .a { k: -@x; }', mathMode).mathOutsideParens);
    expect(answers).toEqual([true, true, false, false]);
  });

  /*
   * A preserved slash group is authored bytes, so a neighbouring `+` inside it
   * must not fold either — `4 / 2 + 5em` is `4 / 2 + 5em`, never `4 / 7em`.
   * Under `always` the group is not preserved and the `+` keeps its arithmetic.
   */
  it('a preserved slash group restates its operands as arithmetic that does not happen bare', () => {
    expect(parseOperation('.a { k: 4 / 2 + 5em; }', 'parens-division').mathOutsideParens).toBe(false);
    expect(parseOperation('.a { k: 4 / 2 + 5em; }', 'strict').mathOutsideParens).toBe(false);
    expect(parseOperation('.a { k: 4 / 2 + 5em; }', 'always').mathOutsideParens).toBe(true);
  });

  /*
   * Media-query features build an `Operation` for their `:` and comparison
   * pairs. They are not arithmetic, but they took the same eval-time mode read
   * before this landed, so they are pinned to the mode as well — a change there
   * is a deliberate decision, not a silent default.
   */
  it('a media-query comparison records the mode rather than defaulting', () => {
    const answers = MODES.map(mathMode =>
      deepOperation('@media (width >= 100px) { .a { k: 1; } }', mathMode).mathOutsideParens);
    expect(answers).toEqual([true, true, false, false]);
  });
});

function parseOperation(source: string, mathMode: typeof MODES[number]): Operation {
  const rules = parse(source, { mathMode }).rules as Statement[];
  const ruleset = rules.find(rule => rule.type === 'Ruleset');
  if (ruleset === undefined || ruleset.type !== 'Ruleset') {
    throw new TypeError('expected a ruleset');
  }
  const decl = ruleset.rules.find(rule => rule.type === 'Declaration');
  if (decl === undefined || decl.type !== 'Declaration') {
    throw new TypeError('expected a declaration');
  }
  return requireOperation(decl.value);
}

function deepOperation(source: string, mathMode: typeof MODES[number]): Operation {
  const rules = parse(source, { mathMode }).rules as Statement[];
  const found = deepFindOperation(rules);
  if (found === null) {
    throw new TypeError('no Operation anywhere in the parsed tree');
  }
  return found;
}

function deepFindOperation(value: unknown): Operation | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFindOperation(item);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  if ('type' in value && value.type === 'Operation') {
    return value as Operation;
  }
  for (const item of Object.values(value)) {
    const found = deepFindOperation(item);
    if (found !== null) {
      return found;
    }
  }
  return null;
}
