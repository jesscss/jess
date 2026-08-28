import { describe, expect, it } from 'vitest';
import { run } from 'parseman';
import type { Stylesheet } from '@jesscss/core/ast';
import { lessGrammar } from '../src/grammar.js';
import {
  DEFAULT_LESS_MATH_MODE,
  requireLessParseState
} from '../src/parse-state.js';

describe('Less parse state', () => {
  it('uses the public math default when raw grammar callers omit state', () => {
    const defaultState = requireLessParseState(undefined);
    expect(defaultState).toEqual({
      mathMode: DEFAULT_LESS_MATH_MODE
    });
    expect(Object.isFrozen(defaultState)).toBe(true);
    expect(requireLessParseState(undefined)).toBe(defaultState);
    expect(requireLessParseState({ source: '.a {}' })).toEqual({
      source: '.a {}',
      mathMode: DEFAULT_LESS_MATH_MODE
    });

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
    expect(requireLessParseState({ mathMode: 'strict' })).toEqual({
      mathMode: 'strict'
    });
    expect(() => requireLessParseState({ mathMode: 'sometimes' })).toThrow(
      'invalid `mathMode`'
    );
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
  if (declaration.value.type !== 'Operation') {
    throw new TypeError('expected an operation');
  }
  return declaration.value.mathOutsideParens;
}
