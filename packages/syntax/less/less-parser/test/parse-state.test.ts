import { describe, expect, it } from 'vitest';
import { run } from 'parseman';
import type { Stylesheet } from '@jesscss/core/ast';
import { lessGrammar } from '../src/grammar.js';
import { parse } from '../src/index.js';
import {
  DEFAULT_LESS_MATH_MODE,
  mathModeOf,
  requireMathMode
} from '../src/parse-state.js';

describe('Less parse state', () => {
  it('uses the public math default when raw grammar callers omit state', () => {
    expect(mathModeOf(undefined)).toBe(DEFAULT_LESS_MATH_MODE);
    expect(mathModeOf({ source: '.a {}' })).toBe(DEFAULT_LESS_MATH_MODE);

    const source = '.a { k: 1 + 2; }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(operationMathOutsideParens(result.value)).toBe(true);

    const strict = run(lessGrammar.Document, source, {
      state: { mathMode: 'strict' },
      trivia: lessGrammar.whitespace
    });
    expect(strict.ok).toBe(true);
    expect(strict.unconsumedFrom).toBeNull();
    expect(operationMathOutsideParens(strict.value)).toBe(false);
  });

  it('honors an explicit mode and rejects an invalid one', () => {
    expect(mathModeOf({ mathMode: 'strict' })).toBe('strict');
    expect(() => mathModeOf({ mathMode: 'sometimes' })).toThrow('invalid `mathMode`');
    expect(() => mathModeOf(1)).toThrow('must be an object');
    expect(requireMathMode(undefined)).toBe(DEFAULT_LESS_MATH_MODE);
  });

  it('checks the parse entry\'s mode once, before the run, with or without math in the input', () => {
    const options: { mathMode?: unknown } = { mathMode: 'sometimes' };
    expect(() => Reflect.apply(parse, undefined, ['.a { b: c; }', options])).toThrow('invalid `mathMode`');
  });
});

function operationMathOutsideParens(sheet: Stylesheet): boolean {
  const rule = sheet.rules[0];
  if (rule?.type !== 'Ruleset') {
    throw new TypeError('expected a ruleset');
  }
  const declaration = rule.rules[0];
  if (declaration?.type !== 'Declaration' || Array.isArray(declaration.value)) {
    throw new TypeError('expected an operation declaration');
  }

  /* A computed operation reaches the AST inside its `Expression` (ledger P35). */
  const value = declaration.value.type === 'Expression' && !Array.isArray(declaration.value.value)
    ? declaration.value.value
    : declaration.value;
  if (value.type !== 'Operation') {
    throw new TypeError('expected an operation');
  }
  return value.mathOutsideParens;
}
