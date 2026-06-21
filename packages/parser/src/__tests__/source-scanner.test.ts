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

  test('line comments are opt-in trivia for Less-family scanners', () => {
    const source = '.a // { ignored\n{ color: red; // } ignored\n  background: blue; }';
    const options = { lineComments: true };
    const start = findTopLevelBlockStart(source, 0, source.length, options);

    expect(start).toBe(source.indexOf('{ color'));
    expect(findBalancedBlockEnd(source, start, source.length, options)).toBe(source.lastIndexOf('}'));
    expect(findStatementEnd(source, source.indexOf('color'), source.lastIndexOf('}'), options))
      .toBe(source.indexOf('; //'));
  });

  test('line comments are not skipped unless requested', () => {
    const source = '.a // { css keeps this as source text\n{ color: red; }';

    expect(findTopLevelBlockStart(source, 0)).toBe(source.indexOf('{ css'));
  });

  test('does not let unterminated comment-like text inside url consume a block', () => {
    const source = '.a { background: url(a/*); color: red; }';
    const start = findTopLevelBlockStart(source, 0);

    expect(findBalancedBlockEnd(source, start)).toBe(source.lastIndexOf('}'));
    expect(findStatementEnd(source, source.indexOf('background'), source.lastIndexOf('}')))
      .toBe(source.indexOf('; color'));
  });

  test('ignores block starts inside selector parens and brackets', () => {
    const source = '.a:is([data-x="{"]) { color: red; }';

    expect(findTopLevelBlockStart(source, 0)).toBe(source.indexOf('{ color'));
  });

  test('does not treat comment-like selector text inside parens as top-level trivia', () => {
    const source = ':not(div/*)*/) { color: red; }';
    const start = findTopLevelBlockStart(source, 0);

    expect(start).toBe(source.indexOf('{ color'));
    expect(findBalancedBlockEnd(source, start)).toBe(source.lastIndexOf('}'));
  });

  test('skips closed comments inside delimiter contexts', () => {
    const selectorSource = '.a:is(/*){*/ div) { color: red; }';
    const selectorStart = findTopLevelBlockStart(selectorSource, 0);
    expect(selectorStart).toBe(selectorSource.indexOf('{ color'));
    expect(findBalancedBlockEnd(selectorSource, selectorStart)).toBe(selectorSource.lastIndexOf('}'));

    const valueSource = '.a { color: rgb(/*{*/ 1 2 3); background: blue; }';
    const blockStart = findTopLevelBlockStart(valueSource, 0);
    const blockEnd = findBalancedBlockEnd(valueSource, blockStart);
    const statementStart = valueSource.indexOf('color');
    expect(findStatementEnd(valueSource, statementStart, blockEnd)).toBe(valueSource.indexOf('; background'));

    const spacedUrlSource = '.a { background: url (/*{*/ x); color: red; }';
    const spacedUrlBlockStart = findTopLevelBlockStart(spacedUrlSource, 0);
    const spacedUrlBlockEnd = findBalancedBlockEnd(spacedUrlSource, spacedUrlBlockStart);
    const spacedUrlStatementStart = spacedUrlSource.indexOf('background');
    expect(findStatementEnd(spacedUrlSource, spacedUrlStatementStart, spacedUrlBlockEnd))
      .toBe(spacedUrlSource.indexOf('; color'));
  });

  test('finds delimiters only at top-level delimiter depth', () => {
    const source = 'color: rgb(10; 20; 30); background: blue;';
    const firstStatementEnd = findStatementEnd(source, 0, source.length);
    const secondColon = findTopLevelDelimiter(source, ':', firstStatementEnd + 1, source.length);

    expect(firstStatementEnd).toBe(source.indexOf('; background'));
    expect(secondColon).toBe(source.indexOf(': blue'));
  });

  test('rejects multi-character delimiters instead of silently missing', () => {
    expect(() => findTopLevelDelimiter('a --> b', '-->', 0, 7)).toThrow(TypeError);
  });
});
