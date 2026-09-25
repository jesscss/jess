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
  if ((value.type === 'Block' || value.type === 'Expression') && 'value' in value) {
    return findOperation(value.value);
  }
  if (value.type === 'List' && 'value' in value && Array.isArray(value.value)) {
    for (const item of value.value) {
      const found = findOperation(item);
      if (found !== null) {
        return found;
      }
    }
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
   * An operation inside `calc(…)` is authored inside a math function: it is
   * `inMathFunction`, exactly as css and `.jess` mark it, and is kept as written
   * whatever the mode — owner 2026-09-24 (DESIGN-DECISIONS P35).
   */
  it('a `calc(…)` operand is inMathFunction in every mode', () => {
    for (const mathMode of MODES) {
      expect(deepOperation('.a { k: calc(4px / 2); }', mathMode).inMathFunction, mathMode).toBe(true);
    }
  });

  it('unary minus answers to the mode too', () => {
    const answers = MODES.map(mathMode =>
      parseOperation('@x: 3px; .a { k: -@x; }', mathMode).mathOutsideParens);
    expect(answers).toEqual([true, true, false, false]);
  });

  /*
   * One division rule reads every slash; the mode picks its shape (P34/P35).
   * Where the mode does not divide, the slash is the value's loosest separator
   * and each side keeps its own arithmetic — `4 / 2 + 5em` is `4` and `2 + 5em`,
   * and that `+` computes like any bare `+` under the mode. Under `always` the
   * slash is a division at product precedence.
   */
  it('a non-dividing slash separates two sides that keep their own math', () => {
    const slash = parseValue('.a { k: 4 / 2 + 5em; }', 'parens-division');
    expect(slash).toMatchObject({ type: 'List', sep: '/' });
    expect(requireOperation(slash).mathOutsideParens).toBe(true);
    expect(parseValue('.a { k: 4 / 2 + 5em; }', 'strict')).toMatchObject({ type: 'List', sep: '/' });
    expect(parseOperation('.a { k: 4 / 2 + 5em; }', 'always')).toMatchObject({
      operator: '+',
      left: { type: 'Operation', operator: '/', mathOutsideParens: true },
      mathOutsideParens: true
    });
  });

  /*
   * A function-condition operand is a plain value, so its math takes the same
   * shapes — a slash list, an `Expression` — and the condition's verbatim
   * source must still spell exactly what was written.
   */
  it('a function-condition operand keeps its authored spelling through the new shapes', () => {
    const conditionSrc = (source: string): string => {
      const found = deepFind(parse(source).rules, 'Condition');
      if (found === null || !('src' in found) || typeof found.src !== 'string') {
        throw new TypeError('no Condition in the parsed tree');
      }
      return found.src;
    };
    expect(conditionSrc('a { b: foo(@w / 2 > 1); }')).toBe('@w / 2 > 1');
    expect(conditionSrc('a { b: foo(@w > 4 / 2); }')).toBe('@w > 4 / 2');
    expect(conditionSrc('a { b: foo(@w * 2 > 1); }')).toBe('@w * 2 > 1');
    expect(() => parse('a { b: if(@w / 2 > 1, x, y); }')).not.toThrow();
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
  return requireOperation(parseValue(source, mathMode));
}

function parseValue(source: string, mathMode: typeof MODES[number]): ValueSlot {
  const rules = parse(source, { mathMode }).rules as Statement[];
  const ruleset = rules.find(rule => rule.type === 'Ruleset');
  if (ruleset === undefined || ruleset.type !== 'Ruleset') {
    throw new TypeError('expected a ruleset');
  }
  const decl = ruleset.rules.find(rule => rule.type === 'Declaration');
  if (decl === undefined || decl.type !== 'Declaration') {
    throw new TypeError('expected a declaration');
  }
  return decl.value;
}

function deepOperation(source: string, mathMode: typeof MODES[number]): Operation {
  const rules = parse(source, { mathMode }).rules as Statement[];
  const found = deepFindOperation(rules);
  if (found === null) {
    throw new TypeError('no Operation anywhere in the parsed tree');
  }
  return found;
}

function deepFind(value: unknown, type: string): object | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFind(item, type);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  if ('type' in value && value.type === type) {
    return value;
  }
  for (const item of Object.values(value)) {
    const found = deepFind(item, type);
    if (found !== null) {
      return found;
    }
  }
  return null;
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
