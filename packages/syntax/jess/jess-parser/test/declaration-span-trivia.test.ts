import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { sourceSpanOf } from '../../../../core/src/ast/provenance.js';
import { buildEvaluator } from '../../../../core/src/ast/evaluator.js';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { parse } from '../src/index.js';

/*
 * Declaration SOURCE spans for Jess.
 *
 * The renderer replays a block's trivia by advancing a cursor to each
 * statement's END. A `Declaration` with no source span never advances that
 * cursor, so every comment authored inside a body falls out of the CLOSING
 * flush in one clump at the `}` — in document order, but all at the bottom,
 * detached from the declarations they annotate.
 *
 * Less has carried this span since the beginning; css and scss gained it just
 * before this. With all four aligned, the four dialects now produce the SAME
 * declaration span for the same bytes, which is the whole point: `.a { p: v
 * /* c *\/; }` is `{5,9}` in all four, and `.a { p: v !important; }` is
 * `{5,20}` in all four.
 *
 * The span must end at the end of the VALUE and NOT include the statement `;`.
 * The Jess productions own an `optional(literal(';'))` (Less's does not), so
 * the span comes from a `field` around everything before the terminator. A span
 * reaching past the semicolon both mis-claims the following run as the
 * declaration's inline trailing comment and swallows any comment authored
 * between the value and the `;`.
 *
 * PINNED DEFECT
 *
 * Cases whose title starts with `PINNED DEFECT` assert the CURRENT, WRONG
 * behaviour so a fix cannot land unnoticed. Fixing one means changing its
 * expectation and dropping the marker. Grep `PINNED DEFECT` across
 * `packages/syntax` for the set.
 */
function css(source: string): string {
  const out = serialize(parse(source), { evaluator: buildEvaluator({ functions: makeLessRegistry() }) });
  if (out instanceof Promise) {
    throw new TypeError('This fixture expects a synchronous serialize result.');
  }
  return out.css;
}

function firstDeclaration(source: string): object {
  const rule = parse(source).rules.find(r => r.type === 'Ruleset');
  if (rule?.type !== 'Ruleset') {
    throw new TypeError('expected a ruleset');
  }
  const decl = rule.rules.find(r => r.type === 'Declaration');
  if (decl === undefined) {
    throw new TypeError('expected a declaration');
  }
  return decl;
}

function spanText(source: string): string {
  const span = sourceSpanOf(firstDeclaration(source));
  return source.slice(span?.start, span?.end);
}

describe('Jess declaration source spans', () => {
  it('spans a declaration from its property to the end of its value', () => {
    expect(sourceSpanOf(firstDeclaration('.a { color: red; }'))).toEqual({ start: 5, end: 15 });
  });

  it('stops the span BEFORE the statement semicolon', () => {
    expect(spanText('.a { color: red ; }')).toBe('color: red');
  });

  it('stops the span before a comment authored between the value and the semicolon', () => {
    expect(spanText('.a { p: v /* c */; }')).toBe('p: v');
  });

  it('includes a trailing !important in the span', () => {
    expect(spanText('.a { color: red !important; }')).toBe('color: red !important');
  });

  it('spans an unterminated final declaration', () => {
    expect(spanText('.a { p: v }')).toBe('p: v');
  });

  it('spans an @property descriptor', () => {
    const source = '@property --x { syntax: "<color>"; inherits: false; initial-value: red; }';
    const at = parse(source).rules[0];
    if (at?.type !== 'AtRuleBlock') {
      throw new TypeError('expected an at-rule block');
    }
    const span = sourceSpanOf(at.rules[0] as object);
    expect(source.slice(span?.start, span?.end)).toBe('syntax: "<color>"');
  });

  /* The placement this change exists to fix. */
  it('emits each body comment at the position it was authored', () => {
    expect(css('a {\n  color: red; /* 1 */\n  width: 0; /* 2 */\n}\n'))
      .toBe('a {\n  color: red;\n  /* 1 */\n  width: 0;\n  /* 2 */\n}\n');
  });

  it('emits a comment authored before the first declaration first', () => {
    expect(css('a{/*test*/p:v}')).toBe('a {\n  /*test*/\n  p: v;\n}\n');
  });

  it('keeps a comment authored inside the declaration inline', () => {
    expect(css('a{p:v/*test*/}')).toBe('a {\n  p: v/*test*/;\n}\n');
  });

  /*
   * `$( … )` re-enters the ambient DOCUMENT trivia (see
   * `ExpressionInterpolation`), so unlike `calc(…)` a comment at its head does
   * reach the root trivia index. Before declaration spans it had nothing to
   * bound it and surfaced as a ruleset body comment; the declaration span now
   * claims it with the rest of the value. This was pinned by the body-span
   * change and is fixed here.
   */
  it('suppresses a comment at the head of a $( … ) value', () => {
    expect(css('.a { depth: $(/* lead */ 1px + 1px); }')).toBe('.a {\n  depth: 2px;\n}\n');
  });

  /*
   * The between-rules case is FIXED by the selector-list span (a `Ruleset` has
   * no span of its own — the renderer reads `sourceStartOf(node.selector)`).
   * A comment INSIDE the selector text is still dropped: that is the selector
   * TERM's provenance, one level further in, and it reproduces identically in
   * `@jesscss/css-parser`. Less keeps it.
   */
  it('PINNED DEFECT — drops a comment authored inside a selector', () => {
    expect(css('s0/*test*/,/*test*/s1{p:v}')).toBe('s0,\ns1 {\n  p: v;\n}\n');
  });

  it('emits a comment between two top-level rules', () => {
    expect(css('a { color: red; }\n/* between */\nb { color: blue; }\n'))
      .toBe('a {\n  color: red;\n}\n/* between */\nb {\n  color: blue;\n}\n');
  });
});
