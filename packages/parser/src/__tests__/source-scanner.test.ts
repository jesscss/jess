import { describe, expect, test } from 'vitest';
import {
  findBalancedBlockEnd,
  findStatementEnd,
  findTopLevelBlockStart,
  findTopLevelDelimiter,
  skipSourceTrivia
} from '../index.js';

describe('source scanner helpers', () => {
  test('skips whitespace and block comments without slicing', () => {
    const source = ' \n\t/* comment */.a';

    expect(skipSourceTrivia(source, 0)).toBe(source.indexOf('.a'));
  });

  test('finds rule block boundaries while ignoring quoted and commented braces', () => {
    const source = '.a::before { content: "}"; /* } */ color: red; } .b {}';
    const start = findTopLevelBlockStart(source, 0);

    expect(start).toBe(source.indexOf('{'));
    expect(findBalancedBlockEnd(source, start)).toBe(source.indexOf('} .b'));
  });

  test('ignores block starts inside selector parens and brackets', () => {
    const source = '.a:is([data-x="{"]) { color: red; }';

    expect(findTopLevelBlockStart(source, 0)).toBe(source.indexOf('{ color'));
  });

  test('finds delimiters only at top-level delimiter depth', () => {
    const source = 'color: rgb(10; 20; 30); background: blue;';
    const firstStatementEnd = findStatementEnd(source, 0, source.length);
    const secondColon = findTopLevelDelimiter(source, ':', firstStatementEnd + 1, source.length);

    expect(firstStatementEnd).toBe(source.indexOf('; background'));
    expect(secondColon).toBe(source.indexOf(': blue'));
  });
});
