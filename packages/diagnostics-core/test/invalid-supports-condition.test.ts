import { describe, expect, it } from 'vitest';
import { collectTolerantDiagnostics } from '../src/index.js';

/**
 * The editor twin of the compiler's `css/invalid-supports-condition` error
 * (owner 2026-10-22, ledger P45): the same code, severity, message, reason,
 * fix and location — the at-rule — as
 * `packages/jess/test/invalid-supports-condition.test.ts` asserts for the
 * compile, over the same preludes.
 */
type Dialect = 'css' | 'less' | 'scss' | 'jess';
const DIALECTS = ['css', 'less', 'scss', 'jess'] as const;
const CODE = 'css/invalid-supports-condition';

/** The at-rule sits on line 2, column 1. */
const sheet = (prelude: string): string => `a { b: c; }\n@supports ${prelude} {\n  .a { b: c; }\n}\n`;

function reported(dialect: Dialect, source: string) {
  return collectTolerantDiagnostics({ source, language: dialect }).diagnostics
    .filter(diagnostic => diagnostic.code === CODE)
    .map(({ code, phase, defaultSeverity, message, line, column }) => ({ code, phase, defaultSeverity, message, line, column }));
}

const PRELUDES: ReadonlyArray<readonly [prelude: string, what: string]> = [
  ['selector (a)', 'selector'],
  ['color', 'color'],
  ['(display: grid) or not (display: flex)', 'not'],
  ['not (display: grid) and (display: flex)', 'not'],
  ['(display: grid), (display: flex)', ',']
];

describe('an @supports prelude that is no condition', () => {
  for (const dialect of DIALECTS) {
    it.each(PRELUDES)(`${dialect}: @supports %s`, (prelude, what) => {
      expect(reported(dialect, sheet(prelude))).toEqual([
        { code: CODE, phase: 'parse', defaultSeverity: 'error', message: `\`${what}\` is not a supports condition`, line: 2, column: 1 }
      ]);
    });
  }
});

describe('a supports condition', () => {
  it.each(DIALECTS)('%s: reports nothing', (dialect) => {
    expect(reported(dialect, sheet('not (display: grid)'))).toEqual([]);
    expect(reported(dialect, sheet('selector(a > b) and (display: grid) and (font-tech  color-colrv1)'))).toEqual([]);
  });
});
