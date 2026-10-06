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

  // Each call of a detached ruleset is its own placement, as each mixin call is.
  it('places the rules of each detached-ruleset call apart', () => {
    expect(render('@dr: { .p { a: 1 } }; .a { @dr(); } .b { @dr(); } .x:extend(.a .p) {}'))
      .toBe('.a .p,\n.x {\n  a: 1;\n}\n.b .p {\n  a: 1;\n}\n');
  });

  it('composes the caller ancestor context of a mixin called inside a rule', () => {
    const src = '.grid-column { width: 1px; }\n'
      + '#make() { .col-x { &:extend(.grid-column); } }\n'
      + '.parent { #make(); }\n';
    expect(render(src)).toBe('.grid-column,\n.parent .col-x {\n  width: 1px;\n}\n');
  });
});

/*
 * Ledger X7 (amended by the owner 2026-10-05): a rule with an interpolated selector is
 * an extend target once resolved, at the root and in mixin and loop bodies alike, part
 * by part like any other rule (lessc 4.9.1 behaves the same). An interpolation glued
 * onto a class name continues that name (`.c-@{n}` is the one class `.c-1`).
 */
describe('interpolated rules are extend targets once resolved', () => {
  it('at the root, the glued name included', () => {
    expect(render('@n: 1; .c-@{n} { a: 1; } .x:extend(.c-1) {}')).toBe('.c-1,\n.x {\n  a: 1;\n}\n');
    expect(render('@n: 1; .k.c-@{n} { a: 1; } .x:extend(.c-1 all) {}')).toBe('.k:is(.c-1, .x) {\n  a: 1;\n}\n');
  });

  it('in a mixin body, part by part', () => {
    expect(render('.m(@n) { .k.c-@{n} { a: 1; } } .m(1); .x:extend(.c-1 all) {}'))
      .toBe('.k:is(.c-1, .x) {\n  a: 1;\n}\n');
    expect(render('.m(@n) { .w { .c-@{n} { a: 1; } } } .m(1); .x:extend(.c-1 all) {}'))
      .toBe('.w :is(.c-1, .x) {\n  a: 1;\n}\n');
    expect(render('@v: foo; .m() { .@{v} { a: 1; } } .m(); .x:extend(.foo) {}'))
      .toBe('.foo,\n.x {\n  a: 1;\n}\n');
  });

  /*
   * An extender a mixin, loop, interpolation or `&` concatenation composes groups like
   * any other where its token is one simple selector; one that holds several simples
   * keeps its own specificity outside the group (ledger X3 guard).
   */
  it('groups a composed extender by the selector token it composes', () => {
    expect(render('.base.k { m: 1 } .btn { &-primary:extend(.base all) {} }'))
      .toBe(':is(.base, .btn-primary).k {\n  m: 1;\n}\n');
    expect(render('.base.k { m: 1 } each(range(2), { .col-@{value} { &:extend(.base all); } });'))
      .toBe(':is(.base, .col-1, .col-2).k {\n  m: 1;\n}\n');
    expect(render('@v: ~"x.y"; .base.k { m: 1 } .@{v} { &:extend(.base all); }'))
      .toBe('.base.k,\n.x.y.k {\n  m: 1;\n}\n');
  });

  it('in a loop body, per iteration', () => {
    expect(render('each(range(2), { .k.c-@{value} { a: @value; } }); .x:extend(.c-2 all) {}'))
      .toBe('.k.c-1 {\n  a: 1;\n}\n.k:is(.c-2, .x) {\n  a: 2;\n}\n');
  });
});
