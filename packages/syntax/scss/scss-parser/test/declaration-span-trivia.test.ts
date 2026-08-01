import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { sourceSpanOf } from '../../../../core/src/ast/provenance.js';
import { buildEvaluator } from '../../../../core/src/ast/evaluator.js';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { parse } from '../src/index.js';

/*
 * Declaration SOURCE spans for SCSS.
 *
 * The renderer replays a block's trivia by advancing a cursor to each
 * statement's END, so a `Declaration` with no source span never advances that
 * cursor and every comment in the body flushes at the closing brace. Less has
 * carried this span since the beginning; css gained it alongside this change.
 *
 * Nothing SCSS emits moves today — SCSS still models a block comment as a
 * `Comment` RULE NODE, so the trivia replay path is inert for it. Measured:
 * zero emitted-CSS movement across 503 sass-spec/test documents and 6,631
 * external-corpus entries. These spans are the PREREQUISITE for deleting the
 * `g.Comment` arms; without them that deletion makes SCSS stop emitting
 * comments outright.
 *
 * The span must end at the end of the VALUE and NOT include the statement `;`.
 * The SCSS production owns its own optional terminator (Less's does not), so
 * the span comes from a `field` around everything before it. A span reaching
 * past the semicolon both mis-claims the following run as the declaration's
 * inline trailing comment and swallows any comment authored between the value
 * and the `;`.
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

describe('SCSS declaration source spans', () => {
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

  it('spans a nested-property declaration across its whole block', () => {
    expect(spanText('.a { font: { family: serif; }; }')).toBe('font: { family: serif; }');
  });

  it('spans a @return statement inside a user function', () => {
    const source = '@function f() { @return 1px; }';
    const fn = parse(source).rules[0];
    if (fn?.type !== 'VariableDeclaration') {
      throw new TypeError('expected a $-bound lambda');
    }
    const body = fn.value;
    if (typeof body !== 'object' || body === null || !('rules' in body)) {
      throw new TypeError('expected an anonymous mixin body');
    }
    const ret = (body.rules as readonly { type: string }[])[0];
    const span = sourceSpanOf(ret as object);
    expect(source.slice(span?.start, span?.end)).toBe('@return 1px');
  });

  /*
   * Placement is UNCHANGED by the spans, because SCSS reaches these through its
   * `Comment` rule nodes rather than through trivia replay. Pinned so the
   * trivia-model change has to reproduce them byte for byte once those arms go.
   */
  it('emits each body comment at the position it was authored', () => {
    expect(css('a {\n  color: red; /* 1 */\n  width: 0; /* 2 */\n}\n'))
      .toBe('a {\n  color: red;\n  /* 1 */\n  width: 0;\n  /* 2 */\n}\n');
  });

  it('emits a comment authored before the first declaration first', () => {
    expect(css('a{/*test*/p:v}')).toBe('a {\n  /*test*/\n  p: v;\n}\n');
  });

  /*
   * css and Less both keep this comment INLINE (`p: v /* c *\/;`) because they
   * reach it through the declaration's inline-trailing-comment path. SCSS lifts
   * it to its own line instead, because the `Comment` rule node is a statement.
   * The span is already identical to css's and Less's — only the model differs,
   * so this is the trivia-model change's to fix, not this one's.
   */
  it('PINNED DEFECT — lifts an inline trailing comment onto its own line', () => {
    expect(css('.a { p: v /* c */; }')).toBe('.a {\n  p: v;\n  /* c */\n}\n');
  });
});
