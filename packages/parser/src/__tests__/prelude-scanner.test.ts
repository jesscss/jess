import { describe, expect, test } from 'vitest';
import { scanCheapAtRulePrelude } from '../prelude-scanner.js';

describe('prelude scanner helpers', () => {
  test('tokenizes cheap bare and parenthesized at-rule preludes', () => {
    expect(scanCheapAtRulePrelude('screen')).toEqual(['screen']);
    expect(scanCheapAtRulePrelude('(min-width: 1px)')).toEqual([['paren', 'min-width: 1px']]);
    expect(scanCheapAtRulePrelude('screen and (min-width: 1px)')).toEqual([
      'screen',
      'and',
      ['paren', 'min-width: 1px']
    ]);
  });

  test('rejects prelude structures outside the cheap scanner subset', () => {
    expect(scanCheapAtRulePrelude('screen, print')).toBeUndefined();
    expect(scanCheapAtRulePrelude('(width > calc(1px + 1em))')).toBeUndefined();
    expect(scanCheapAtRulePrelude('screen/**/and')).toBeUndefined();
  });

  test('uses scanner options for Less line comments between tokens', () => {
    expect(scanCheapAtRulePrelude('screen // comment\n and', { lineComments: true })).toEqual(['screen', 'and']);
    expect(scanCheapAtRulePrelude('screen // comment\n and')).toBeUndefined();
  });
});
