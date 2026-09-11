import { describe, expect, it } from 'vitest';
import { parse as parseLess } from '../../../../syntax/less/less-parser/src/index.js';
import { buildEvaluator } from '../evaluator.js';
import { makeLessRegistry } from '@jesscss/fns';
import { serialize } from '../serialize.js';

/**
 * [extend/mixin-call] An `&:extend(target)` authored inside a mixin-call body or a
 * loop (`each`) body must accumulate onto the target's selector list, exactly like a
 * plain nested `&:extend()`. This is reached by the ONE render walk, which already
 * expands mixin calls and iterates loops: it records each extender's extend fact
 * inline as it emits that rule (EXTEND-SEMANTICS §1a, ledger X12 — extend consumes
 * resolved static shapes, it never re-drives evaluation). A target defined ahead of
 * its extender (the bootstrap `.grid-column` / `#make-grid-columns()` shape) is emitted
 * as an addressable render-buffer slot; after the walk, the extend engine folds the
 * extenders' compiled selectors into that slot. Before the fix, extend facts were
 * rebuilt by a cold second evaluator (`collectPlacedExtendFacts`) that skipped
 * main-document mixin-call and loop bodies, so those extenders were silently dropped.
 */
const evaluator = buildEvaluator(makeLessRegistry());
const render = (src: string): string =>
  serialize(parseLess(src), { evaluator, collapseNesting: true }).css ?? '';

describe('extend from mixin-call and loop bodies', () => {
  it('control: a plain nested `&:extend()` accumulates (and is not double-counted)', () => {
    expect(render('.a { color: red; }\n.b { &:extend(.a); }\n')).toBe(
      '.a,\n.b {\n  color: red;\n}\n'
    );
  });

  it('accumulates an `&:extend()` authored inside a mixin-call body', () => {
    const src = '.grid-column { width: 1px; }\n'
      + '#make() { .col-1 { &:extend(.grid-column); } }\n'
      + '#make();\n';
    expect(render(src)).toBe('.grid-column,\n.col-1 {\n  width: 1px;\n}\n');
  });

  it('accumulates an `&:extend()` authored inside an `each()` loop body', () => {
    const src = '.grid-column { width: 1px; }\n'
      + 'each(range(2), { .col-@{value} { &:extend(.grid-column); } });\n';
    expect(render(src)).toBe('.grid-column,\n.col-1,\n.col-2 {\n  width: 1px;\n}\n');
  });

  it('accumulates across guarded parametric mixin recursion (the bootstrap `#each-column` shape)', () => {
    const src = '.grid-column { width: 1px; }\n'
      + '#each(@i: 1) when (@i <= 3) {\n'
      + '  .col-@{i} { &:extend(.grid-column); }\n'
      + '  #each((@i + 1));\n'
      + '}\n'
      + '#each();\n';
    expect(render(src)).toBe(
      '.grid-column,\n.col-1,\n.col-2,\n.col-3 {\n  width: 1px;\n}\n'
    );
  });

  it('composes the caller ancestor context of a mixin called inside a rule', () => {
    const src = '.grid-column { width: 1px; }\n'
      + '#make() { .col-x { &:extend(.grid-column); } }\n'
      + '.parent { #make(); }\n';
    expect(render(src)).toBe('.grid-column,\n.parent .col-x {\n  width: 1px;\n}\n');
  });
});
