import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { sourceSpanOf } from '../../../../core/src/ast/provenance.js';
import { buildEvaluator } from '../../../../core/src/ast/evaluator.js';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { parse } from '../src/index.js';

/*
 * Declaration SOURCE spans, and the comment placement that depends on them.
 *
 * The renderer replays a block's trivia by advancing a cursor to each
 * statement's END. A declaration with no source span never advances that
 * cursor, so every comment authored inside the body falls out of the closing
 * flush in one clump at the `}` — in document order, but all at the bottom,
 * detached from the declarations they annotate.
 *
 * Less has carried this span since the beginning (`StandardDeclaration`), which
 * is why Less alone rendered these in place. The expected bytes below are the
 * ones `@jesscss/less-parser` already emits for the same input; css diverging
 * from Less here is a css bug, not a dialect difference.
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
  const rule = parse(source).rules[0];
  if (rule?.type !== 'Ruleset') {
    throw new TypeError('expected a ruleset');
  }
  const decl = rule.rules[0];
  if (decl?.type !== 'Declaration') {
    throw new TypeError('expected a declaration');
  }
  return decl;
}

describe('CSS declaration source spans', () => {
  it('spans a declaration from its property to the end of its value', () => {
    expect(sourceSpanOf(firstDeclaration('.a { color: red; }'))).toEqual({ start: 5, end: 15 });
  });

  it('stops the span BEFORE the statement semicolon', () => {
    const source = '.a { color: red ; }';
    const span = sourceSpanOf(firstDeclaration(source));
    expect(source.slice(span?.start, span?.end)).toBe('color: red');
  });

  it('includes a trailing !important in the span', () => {
    const source = '.a { color: red !important; }';
    const span = sourceSpanOf(firstDeclaration(source));
    expect(source.slice(span?.start, span?.end)).toBe('color: red !important');
  });

  /*
   * The placement this change exists to fix. Before declaration spans both
   * comments were emitted after BOTH declarations, at the closing brace.
   */
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

  it('keeps a comment authored around the declaration colon inline', () => {
    expect(css('s{p/*test*/:/*test*/v}')).toBe('s {\n  p/*test*/: v;\n}\n');
  });

  /*
   * Left unspanned on purpose, exactly as Less leaves its own
   * `CustomDeclaration` unspanned: a custom-property value is retained as
   * authored bytes, so spanning the declaration would additionally claim the
   * run that FOLLOWS the value and splice it into the value text.
   */
  it('keeps a comment after a custom-property value as a body comment', () => {
    expect(css('a{--var:/* 1 */}')).toBe('a {\n  --var: ;\n  /* 1 */\n}\n');
  });

  /*
   * A comment inside the SELECTOR is still dropped. Less keeps it
   * (`s0/*test*\/,`), so this is a real divergence — but it is the selector's
   * missing provenance, not the declaration's, and it was already the behaviour
   * before declaration spans landed.
   */
  it('PINNED DEFECT — drops a comment authored inside a selector', () => {
    expect(css('s0/*test*/,/*test*/s1{p:v}')).toBe('s0,\ns1 {\n  p: v;\n}\n');
  });

  /*
   * Fixed by the SELECTOR list span (a `Ruleset` has no span of its own — the
   * renderer reads `sourceStartOf(node.selector)` for one). See
   * `selector-span-trivia.test.ts` for the rest of that family.
   */
  it('emits a comment between two top-level rules', () => {
    expect(css('a { color: red; }\n/* between */\nb { color: blue; }\n'))
      .toBe('a {\n  color: red;\n}\n/* between */\nb {\n  color: blue;\n}\n');
  });
});
