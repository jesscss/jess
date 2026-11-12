import { describe, expect, it } from 'vitest';
import { run } from 'parseman';
import type { Stylesheet } from '@jesscss/core/ast';
import { lessGrammar } from '../src/grammar.js';
import { createLessParseState, parse, safeParse } from '../src/index.js';
import {
  DEFAULT_LESS_MATH_MODE,
  mathModeOf
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
      state: createLessParseState(source, { mathMode: 'strict' }),
      trivia: lessGrammar.whitespace
    });
    expect(strict.ok).toBe(true);
    expect(strict.unconsumedFrom).toBeNull();
    expect(operationMathOutsideParens(strict.value)).toBe(false);
  });

  it('reads the mode a raw state carries, with no re-check', () => {
    expect(mathModeOf({ mathMode: 'strict' })).toBe('strict');
  });

  it('reads a var() fallback under its own context: a Less variable is a lookup, a typed at-keyword is text', () => {
    const rule = parse('.a { b: var(--gap, @gap); c: var(--x, @media); }').rules[0];
    expect(rule).toMatchObject({
      rules: [
        { value: { name: 'var', args: [{}, { value: { type: 'Interpolation', parts: [{ ref: { type: 'Lookup', name: 'gap' } }] } }] } },
        { value: { name: 'var', args: [{}, { value: { type: 'Any', src: '@media' } }] } }
      ]
    });
  });
});

describe('Less parse options', () => {
  const MATH = '(expected one of \'always\', \'parens-division\', \'parens\', \'strict\')';
  const MODULE = '(expected one of \'auto\', \'modern\')';
  const cases: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
    [{ mathMode: 'sometimes' }, `invalid mathMode option: 'sometimes' ${MATH}`],
    [{ mathMode: 1 }, `invalid mathMode option: 1 ${MATH}`],
    [{ moduleMode: 'modrn' }, `invalid moduleMode option: 'modrn' ${MODULE}`]
  ];

  it.each(cases)('parse() rejects %o before the run, on input with no math', (options, message) => {
    expect(() => Reflect.apply(parse, undefined, ['.a { b: c; }', options])).toThrow(new TypeError(message));
  });

  it.each(cases)('the run-state builder rejects %o for a raw run, with the same error', (options, message) => {
    const source = '.a { b: c; }';
    expect(() => run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace,
      state: Reflect.apply(createLessParseState, undefined, [source, options])
    })).toThrow(new TypeError(message));
  });

  it.each(cases)('safeParse() throws %o as a caller error, not a syntax diagnostic', (options, message) => {
    let thrown: unknown;
    try {
      Reflect.apply(safeParse, undefined, ['a.less', '.a { b: c; }', options]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(thrown).not.toHaveProperty('code');
    expect(thrown).toHaveProperty('message', message);
  });

  it('reads `undefined` and `null` as the defaults', () => {
    const source = '.a { k: 4 / 2 + 1; }';
    const expected = JSON.stringify(parse(source));
    for (const options of [{}, { mathMode: undefined, moduleMode: undefined }, { mathMode: null, moduleMode: null }]) {
      expect(JSON.stringify(Reflect.apply(parse, undefined, [source, options]))).toBe(expected);
    }
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
