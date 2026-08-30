import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { sourceSpanOf } from '../../../../core/src/ast/provenance.js';
import { buildEvaluator } from '../../../../core/src/ast/evaluator.js';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { parse } from '../src/index.js';

/*
 * TOP-LEVEL statement spans: the selector list of a ruleset, and the source
 * span of an at-rule block.
 *
 * A `Ruleset` has no source span of its own — the renderer reads
 * `sourceStartOf(node.selector)` for one — and it reads `sourceEndOf` (falling
 * back to the body span) for the end. Without the SELECTOR span the root trivia
 * cursor never advances past a rule, so a comment BETWEEN two top-level rules
 * was dropped even though it had been CAPTURED. Less alone kept it, because its
 * selector list carries the span.
 *
 * The at-rule block span is the other half of the same mechanism. The root
 * replay excludes any run that falls inside a top-level statement's
 * `{start,end}`; an at-rule block with no source span produces no exclusion, so
 * a comment authored INSIDE `@media { … }` escaped to the top level and was
 * emitted after the block. Less spans its at-rule blocks; this matches.
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

function firstRule(source: string): { selector?: object } {
  const rule = parse(source).rules.find(r => r.type === 'Ruleset');
  if (rule?.type !== 'Ruleset') {
    throw new TypeError('expected a ruleset');
  }
  return rule;
}

describe('SCSS top-level statement spans', () => {
  it('spans a ruleset selector list', () => {
    expect(sourceSpanOf(firstRule('a { color: red; }').selector as object)).toEqual({ start: 0, end: 1 });
  });

  it('spans a multi-branch selector list across all its branches', () => {
    const source = 'a, b > c { color: red; }';
    const span = sourceSpanOf(firstRule(source).selector as object);
    expect(source.slice(span?.start, span?.end)).toBe('a, b > c');
  });

  it('spans an at-rule block across the whole statement', () => {
    const source = '@media screen { a { color: red; } }';
    const at = parse(source).rules.find(r => r.type === 'AtRuleBlock');
    const span = sourceSpanOf(at as object);
    expect(source.slice(span?.start, span?.end)).toBe(source);
  });

  /* The loss this change exists to fix. */
  it('emits a comment between two top-level rules', () => {
    expect(css('a { color: red; }\n/* between */\nb { color: blue; }\n'))
      .toBe('a {\n  color: red;\n}\n/* between */\nb {\n  color: blue;\n}\n');
  });

  it('emits a comment before the first rule and after the last', () => {
    expect(css('/* lead */\na { color: red; }\n/* tail */\nb { color: blue; }\n'))
      .toBe('/* lead */\na {\n  color: red;\n}\n/* tail */\nb {\n  color: blue;\n}\n');
  });

  /*
   * The at-rule block span is what keeps this OUT of the top-level replay: the
   * root replay excludes any run inside a top-level statement's `{start,end}`,
   * and a block with no span produces no exclusion, so the run escaped and was
   * emitted AFTER the closing brace. css and jess drop it (correct, pending
   * block-interior re-emission, which no dialect has yet); SCSS keeps it in
   * place, because it reaches it as a `Comment` RULE NODE rather than through
   * trivia. Pinned so the trivia-model change has to reproduce this byte for
   * byte once those arms go.
   */
  it('keeps a comment inside an at-rule body in place', () => {
    expect(css('x { p: v; }\n@media test {\n  a { p: v; }\n  /* inner */\n  b { p: v; }\n}\ny { p: v; }\n'))
      .toBe('x {\n  p: v;\n}\n@media test {\n  a {\n    p: v;\n  }\n  /* inner */\n  b {\n    p: v;\n  }\n}\ny {\n  p: v;\n}\n');
  });

  /*
   * A comment inside the SELECTOR text is a separate matter one level further
   * in — the selector TERM's provenance, not the list span. Less retains it
   * (`s0/*test*\/,`); css and jess drop it. SCSS does neither: it REJECTS the
   * source outright. That is a recognition gap, not a trivia one, and it is
   * pinned here because it is the reason SCSS cannot be compared with the other
   * three on this case at all.
   */
  it('PINNED DEFECT — rejects a comment authored inside a selector', () => {
    expect(() => parse('s0/*test*/,/*test*/s1{p:v}')).toThrow();
  });
});
