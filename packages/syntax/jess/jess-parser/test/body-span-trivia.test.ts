import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { bodySpanOf } from '../../../../core/src/ast/provenance.js';
import { buildEvaluator } from '../../../../core/src/ast/evaluator.js';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { parse } from '../src/index.js';

/*
 * Ruleset and at-rule BODY spans, and the comment output that depends on them.
 *
 * Trivia captured inside a block is replayed by the renderer against the
 * OWNER'S BODY SPAN. A block-bearing node with no body span therefore drops
 * every comment authored inside it — silently, with no parse error and no
 * diagnostic. Jess shipped without body spans, so this file is the regression
 * fixture for that loss as much as for the spans themselves.
 *
 * `css` and `less` have carried `withBlockBody` from the start, so the expected
 * bytes below are the ones `@jesscss/css-parser` already emits for the same
 * input. Jess diverging from css here is a Jess bug, not a dialect difference.
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

function firstBlock(source: string): object {
  const rule = parse(source).rules[0];
  if (rule?.type !== 'Ruleset' && rule?.type !== 'AtRuleBlock') {
    throw new TypeError('expected a block-bearing statement');
  }
  return rule;
}

describe('Jess block body spans', () => {
  it('gives a ruleset the span between its braces', () => {
    expect(bodySpanOf(firstBlock('.a { color: red; }'))).toEqual({ start: 4, end: 17 });
  });

  it('measures the body from the OUTER braces when a rule nests', () => {
    expect(bodySpanOf(firstBlock('.a { .b { color: red; } }'))).toEqual({ start: 4, end: 24 });
  });

  it('gives an at-rule block the span between its braces', () => {
    expect(bodySpanOf(firstBlock('@media screen { .a { color: red; } }'))).toEqual({ start: 15, end: 35 });
  });

  it('gives an empty body a zero-width span, not an absent one', () => {
    expect(bodySpanOf(firstBlock('.a {}'))).toEqual({ start: 4, end: 4 });
  });

  /* The loss this change exists to fix: without a body span these were dropped. */
  it('emits a block comment authored inside a ruleset', () => {
    expect(css('.a {\n  /* in */\n  color: red;\n}\n')).toBe('.a {\n  color: red;\n  /* in */\n}\n');
  });

  it('emits the inner comment of every nesting level against its own body', () => {
    expect(css('.a {\n  /* outer */\n  .b {\n    /* inner */\n    color: red;\n  }\n}\n'))
      .toBe('.a .b {\n  color: red;\n  /* inner */\n}\n');
  });

  it('emits a block comment authored inside an otherwise empty ruleset', () => {
    expect(css('.a { color: red; }\n.b {\n  /* only */\n}\n'))
      .toBe('.a {\n  color: red;\n}\n.b {\n  /* only */\n}\n');
  });

  it('does not emit a LINE comment authored inside a ruleset', () => {
    expect(css('.a {\n  // gone\n  color: red;\n}\n')).toBe('.a {\n  color: red;\n}\n');
  });

  /*
   * `/* outer *\/` sits in `.a`'s body but before `.b`, and `.b` is a nested
   * ruleset with no source span, so nothing bounds the run to a position. The
   * body-end flush belongs to the frame that emitted declarations, which `.a`
   * has none of, so the run is never claimed. `@jesscss/css-parser` drops it
   * identically — this is the missing STATEMENT span, not the body span.
   */
  it('PINNED DEFECT — drops a body comment that precedes a nested ruleset', () => {
    expect(css('.a {\n  /* outer */\n  .b { color: red; }\n}\n'))
      .toBe('.a .b {\n  color: red;\n}\n');
  });

  /*
   * `emitAtRuleBody` replays only BEFORE a statement with a source span, and
   * has no closing flush against the body end the way a ruleset body does. Same
   * bytes from `@jesscss/css-parser`.
   */
  it('PINNED DEFECT — drops a comment inside an at-rule block body', () => {
    expect(css('@media screen {\n  /* in */\n  .a { color: red; }\n}\n'))
      .toBe('@media screen {\n  .a {\n    color: red;\n  }\n}\n');
  });

  /*
   * Trailing trivia is never CAPTURED: the Jess root span stops at the last
   * statement, so a comment after it never enters the root trivia index and the
   * renderer has nothing to replay. Unaffected by body spans in either
   * direction — this is the root-span convention, and css/less/scss all keep
   * the comment. Verified identical before and after body spans landed.
   */
  it('PINNED DEFECT — drops a trailing document comment', () => {
    expect(css('.a { color: red; }\n/* trail */\n')).toBe('.a {\n  color: red;\n}\n');
  });

  it('keeps a leading document comment', () => {
    expect(css('/* lead */\n.a { color: red; }\n')).toBe('/* lead */\n.a {\n  color: red;\n}\n');
  });
});
