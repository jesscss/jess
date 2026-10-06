import { describe, expect, it } from 'vitest';
import { LessParseError, parse } from '@jesscss/less-parser';

/** The typed failure `parse()` throws, or `undefined` when the source parses. */
function failureOf(source: string): unknown {
  try {
    parse(source);
    return undefined;
  } catch (error) {
    return error;
  }
}

/*
 * `/deep/`, `/shadow/` — and, in Less 4, any `/word/` — were Shadow DOM v0
 * combinators that never became CSS (ledger G37). They are not selectors, and
 * nothing recognizes them: each fails like any other invalid selector, with
 * the ordinary parse error.
 */
describe('a slashed combinator is an invalid selector', () => {
  it.each([
    ['/deep/ after a class', '.parent /deep/ .child {\n  color: red;\n}'],
    ['/shadow/ after a class', '.container /shadow/ .content { background: blue; }'],
    ['any /word/ after a type selector', 'div /wat/ span { color: red; }'],
    ['a nested rule', '.a {\n  .b /deep/ .c { x: y; }\n}'],
    ['glued to its neighbours', '.a/deep/.b { c: d; }'],
    ['after a later branch of a list', '.a, .b /deep/ .c { d: e; }'],
    ['inside a selector pseudo argument', ':is(.a /deep/ .b) { c: d; }'],
    ['inside an inline :extend() target', '.x:extend(.a /deep/ .b) { c: d; }'],
    ['inside a body :extend() target', '.x { &:extend(.a /deep/ .b); }']
  ])('%s', (_label, source) => {
    const failure = failureOf(source);
    expect(failure).toBeInstanceOf(LessParseError);
    expect(failure).toMatchObject({ code: 'parse/syntax-error' });
  });

  it.each([
    '.x { grid-area:a/b/c/d; }',
    '.x { grid-area: a / b / c / d; }',
    '.x { font:12px/1.5 a; }',
    '.x { a: b /c/ d; }',
    '.x { a:b /c/ d; }',
    '.x { a:b c /d/ e; }',
    '.x { grid-area:a /b/ c; }',
    '.x { grid-row:span /x/ y }',
    '@font-face { src: local(Foo/Bar/Baz); }',
    '.x { a: is(b /c/ d); }',
    '.x { background: url(/deep/a.png); }',
    '.a /* deep */ .b { c: d; }'
  ])('parses the valid declaration or selector %j', (source) => {
    expect(failureOf(source)).toBeUndefined();
  });
});
