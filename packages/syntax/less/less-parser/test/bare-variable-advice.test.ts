import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../../../../core/src/ast/evaluator.js';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { LessBareVariableInterpolationError, LessImportPostludeError, parse } from '@jesscss/less-parser';

/*
 * A bare `@a` where only interpolation is valid is a diagnostic whose fix is
 * "Use @{a} instead of @a." (jess#319). The advice is only worth giving if it
 * works, so every position that gives it must also parse the advised form.
 */
describe('the bare-variable diagnostic advises a form that parses', () => {
  it.each([
    ['an @supports prelude', '@supports @a { .x { c: d } }'],
    ['an @supports feature name', '@supports (@a: b) { .x { c: d } }'],
    ['a negated @supports feature', '@supports not (@a: b) { .x { c: d } }'],
    ['an @media prelude', '@media @a { .x { c: d } }'],
    ['an @container prelude', '@container @a { .x { c: d } }'],
    ['an if() supports() test', '.x { w: if(supports(@a): 1px; else: 2px); }'],
    ['an if() supports() declaration', '.x { w: if(supports(@a: b): 1px; else: 2px); }'],
    ['an @import supports() condition', '@import url(x.css) supports(@a);'],
    ['an @import supports() declaration', '@import url(x.css) supports(@a: b);'],
    ['an @import supports() value', '@import url(x.css) supports(display: @a);'],
    ['an @import layer() name', '@import url(x.css) layer(@a);'],
    ['an unknown at-rule prelude', '@foo @a { b: c }'],
    ['a later word of an unknown at-rule prelude', '@foo bar @a { b: c }'],
    ['an unknown statement at-rule', '@foo @a;'],
    ['an @page prelude', '@page @a { b: c }']
  ])('in %s', (_label, source) => {
    let failure: unknown;
    try {
      parse(source);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(LessBareVariableInterpolationError);
    expect(failure).toMatchObject({ fix: 'Use @{a} instead of @a.' });

    const advised = source.replace('@a', '@{a}');
    expect(() => parse(advised), advised).not.toThrow();
  });

  it('renders the advised supports() interpolations', () => {
    const source = '@a: display; @import url(x.css) supports(@{a}: grid); .x { w: if(supports(@{a}: grid): 1px; else: 2px); }';
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '@import url(x.css) supports(display: grid);\n.x {\n  w: if(supports(display: grid): 1px; else: 2px);\n}\n'
    );
  });

  /*
   * An unknown at-rule's prelude evaluates only `@{…}` (ledger P2), so the
   * advised form is an interpolation there too.
   */
  it('renders the advised interpolation in an unknown at-rule prelude', () => {
    const source = '@a: x; @foo bar @{a} (y) { b: c } @page @{a} { b: c } @foo @{a};';
    expect(serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      '@foo bar x (y) {\n  b: c;\n}\n@page x {\n  b: c;\n}\n@foo x;\n'
    );
  });

  it('still rejects a supports() condition on a compile-time import when it interpolates', () => {
    expect(() => parse('@import "x.less" supports(@{a}: grid);')).toThrow(LessImportPostludeError);
  });
});
