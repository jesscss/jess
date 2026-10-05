import { describe, expect, it } from 'vitest';
import { LessSlashedCombinatorError, parse } from '@jesscss/less-parser';
import { parseLessCst } from '@jesscss/less-parser/cst';

/** The typed failure `parse()` throws, or `undefined` when the source parses. */
function failureOf(source: string): unknown {
  try {
    parse(source);
    return undefined;
  } catch (error) {
    return error;
  }
}

function hasNode(node: unknown, grammarType: string): boolean {
  if (typeof node !== 'object' || node === null || !('_tag' in node) || node._tag !== 'node') {
    return false;
  }
  return ('grammarType' in node && node.grammarType === grammarType)
    || ('rules' in node && Array.isArray(node.rules) && node.rules.some(child => hasNode(child, grammarType)));
}

/*
 * `/deep/`, `/shadow/` — and, in Less 4, any `/word/` — were Shadow DOM v0
 * combinators that never became CSS. Less 5 rejects them (ledger G37); the
 * diagnostic names the combinator on its own bytes rather than reporting
 * generic unexpected syntax at the start of the rule (jess#247).
 */
describe('slashed combinators are rejected by name', () => {
  it.each([
    ['/deep/ after a class', '.parent /deep/ .child {\n  color: red;\n}', 8, '/deep/'],
    ['/shadow/ after a class', '.container /shadow/ .content { background: blue; }', 11, '/shadow/'],
    ['the first of two', '.wrapper /deep/ .inner /deep/ .deepest { padding: 10px; }', 9, '/deep/'],
    ['any /word/ after a type selector', 'div /wat/ span { color: red; }', 4, '/wat/'],
    ['a nested rule', '.a {\n  .b /deep/ .c { x: y; }\n}', 10, '/deep/'],
    ['glued to its neighbours', '.a/deep/.b { c: d; }', 2, '/deep/'],
    ['after a later branch of a list', '.a, .b /deep/ .c { d: e; }', 7, '/deep/'],
    ['inside a selector pseudo argument', ':is(.a /deep/ .b) { c: d; }', 7, '/deep/'],
    ['inside a later pseudo argument branch', '.x:not(.y, .a /shadow/ .b) { c: d; }', 14, '/shadow/'],
    ['glued inside a pseudo argument', '.x:where(.a/deep/.b) { c: d; }', 11, '/deep/'],
    ['inside an inline :extend() target', '.x:extend(.a /deep/ .b) { c: d; }', 13, '/deep/'],
    ['inside a body :extend() target', '.x { &:extend(.a /deep/ .b); }', 17, '/deep/']
  ])('%s', (_label, source, offset, combinator) => {
    const failure = failureOf(source);
    expect(failure).toBeInstanceOf(LessSlashedCombinatorError);
    expect(failure).toMatchObject({
      code: 'parse/unsupported-slashed-combinator',
      offset,
      endOffset: offset + combinator.length,
      message: `The ${combinator} combinator was removed in Less v5.`
    });
  });

  it('keeps the rule in the tolerant CST', () => {
    const result = parseLessCst('.parent /deep/ .child { color: red; }\n.after { color: red; }');
    expect(result.ok).toBe(true);
    expect(hasNode(result.tree, 'SlashedCombinator')).toBe(true);
  });

  it.each([
    '.x { grid-area:a/b/c/d; }',
    '.x { grid-area: a / b / c / d; }',
    '.x { font:12px/1.5 a; }',
    '.x { a: b /c/ d; }',

    /*
     * A glued colon sends the declaration down the ruleset arm first; the
     * `/word/` there is only a fact until a `{` would commit a ruleset.
     */
    '.x { a:b /c/ d; }',
    '.x { a:b /c/ d }',
    '.x { a:b /c/ d !important; }',
    '.x { a:b c /d/ e; }',
    '.x { grid-area:a /b/ c; }',
    '.x { grid-area:auto /span/ 2; }',
    '.x { grid-row:span /x/ y }',
    '.x { background: url(/deep/a.png); }',
    '.a /* deep */ .b { c: d; }'
  ])('still parses the valid neighbour %j', (source) => {
    expect(failureOf(source)).toBeUndefined();
    const result = parseLessCst(source);
    expect(result.ok).toBe(true);
    expect(hasNode(result.tree, 'SlashedCombinator')).toBe(false);
  });

  /*
   * A glued declaration is read as a ruleset first, so a `/word/` inside a
   * pseudo argument is held until a selector commits rather than rejected where
   * it is read. A declaration whose value spells a selector pseudo function with
   * a `/word/` inside it is valid CSS — css and scss parse it, and lessc 4.x
   * emits `a: is(b / c / d)` and `src: local(Foo / Bar / Baz)`.
   */
  it.each([
    '.x { a:is(b /c/ d); }',
    '@font-face { src:local(Foo/Bar/Baz); }',
    '.x { a:is(b /c/ d) }',
    '.x { a:not(b, c /d/ e); f: g; }'
  ])('parses the glued declaration %j', (source) => {
    expect(failureOf(source)).toBeUndefined();
  });

  it.each([
    ['a nested ruleset', '.x { .y:is(.a /deep/ .b) { c: d; } }', 14, '/deep/'],
    ['a ruleset after a held declaration', '.x { a:is(b /c/ d); }\n:is(.a /deep/ .b) { c: d; }', 29, '/deep/'],
    ['a pseudo inside an inline :extend() target', '.x:extend(:is(.a /deep/ .b)) { c: d; }', 17, '/deep/'],
    ['a pseudo inside a body :extend() target', '.x { &:extend(:is(.a /deep/ .b)); }', 21, '/deep/']
  ])('still rejects a held combinator once %s commits', (_label, source, offset, combinator) => {
    const failure = failureOf(source);
    expect(failure).toBeInstanceOf(LessSlashedCombinatorError);
    expect(failure).toMatchObject({ offset, endOffset: offset + combinator.length });
  });
});
