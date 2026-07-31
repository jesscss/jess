import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { bodySpanOf } from '../../../../core/src/ast/provenance.js';
import { buildEvaluator } from '../../../../core/src/ast/evaluator.js';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { parse } from '../src/index.js';

/*
 * Ruleset and at-rule BODY spans for SCSS.
 *
 * Trivia captured inside a block is replayed by the renderer against the
 * OWNER'S BODY SPAN, so a block-bearing node with no body span silently drops
 * every comment authored inside it. SCSS did not lose comments before this
 * landed only because its grammar models a block comment as a `Comment` RULE
 * NODE — a workaround for the missing spans, not a deliberate model.
 *
 * That distinction is what makes these cases load-bearing. The eventual ruling
 * is that all four dialects treat a comment as trivia and the `g.Comment` arms
 * go away; deleting those arms while SCSS has no body spans would make SCSS
 * stop emitting comments outright. These fixtures assert the spans exist FIRST,
 * so the arms can be removed against a working replay path.
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
  const rule = parse(source).rules.find(r => r.type === 'Ruleset' || r.type === 'AtRuleBlock');
  if (rule === undefined) {
    throw new TypeError('expected a block-bearing statement');
  }
  return rule;
}

describe('SCSS block body spans', () => {
  it('gives a ruleset the span between its braces', () => {
    expect(bodySpanOf(firstBlock('.a { color: red; }'))).toEqual({ start: 4, end: 17 });
  });

  it('measures the body from the OUTER braces when a rule nests', () => {
    expect(bodySpanOf(firstBlock('.a { .b { color: red; } }'))).toEqual({ start: 4, end: 24 });
  });

  it('gives an at-rule block the span between its braces', () => {
    expect(bodySpanOf(firstBlock('@media screen { .a { color: red; } }'))).toEqual({ start: 15, end: 35 });
  });

  it('gives a @mixin definition the span between its braces', () => {
    const def = parse('@mixin m { color: red; }').rules[0];
    if (def?.type !== 'MixinDefinition') {
      throw new TypeError('expected a mixin definition');
    }
    expect(bodySpanOf(def)).toEqual({ start: 10, end: 23 });
  });

  it('gives an empty body a zero-width span, not an absent one', () => {
    expect(bodySpanOf(firstBlock('.a {}'))).toEqual({ start: 4, end: 4 });
  });

  /*
   * Unchanged by the spans: SCSS emits these through its `Comment` rule nodes
   * today. Pinned so the trivia-model change has to keep them, byte for byte,
   * once the `g.Comment` arms are deleted.
   */
  it('emits a block comment authored inside a ruleset', () => {
    expect(css('.a {\n  /* in */\n  color: red;\n}\n')).toBe('.a {\n  /* in */\n  color: red;\n}\n');
  });

  it('emits a block comment authored inside an at-rule block', () => {
    expect(css('@media screen {\n  /* in */\n  .a { color: red; }\n}\n'))
      .toBe('@media screen {\n  /* in */\n  .a {\n    color: red;\n  }\n}\n');
  });

  it('emits the inner comment of every nesting level', () => {
    expect(css('.a {\n  /* outer */\n  .b {\n    /* inner */\n    color: red;\n  }\n}\n'))
      .toBe('.a {\n  /* outer */\n}\n.a .b {\n  /* inner */\n  color: red;\n}\n');
  });

  it('does not emit a LINE comment authored inside a ruleset', () => {
    expect(css('.a {\n  // gone\n  color: red;\n}\n')).toBe('.a {\n  color: red;\n}\n');
  });

  it('keeps a leading and a trailing document comment', () => {
    expect(css('/* lead */\n.a { color: red; }\n/* trail */\n'))
      .toBe('/* lead */\n.a {\n  color: red;\n}\n/* trail */\n');
  });

  /*
   * `@if` / `@else` bodies reduce through `IfBody`, which yields a bare
   * `Statement[]` — an ARRAY, which has nowhere to carry a body span — so the
   * braces are consumed one level below every node that could hold one. This is
   * the one block family in the SCSS grammar with no body span; the fix is a
   * body-span-carrying fact for `IfBody`, the way the Less grammar carries one
   * through its mixin-definition and ruleset-tail facts.
   */
  it('PINNED DEFECT — gives an @if body no body span', () => {
    const node = parse('@if true { .a { color: red; } }').rules[0];
    if (node?.type !== 'If') {
      throw new TypeError('expected an if node');
    }
    expect(bodySpanOf(node)).toBeUndefined();
  });
});
