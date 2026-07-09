import { beforeEach, describe, expect, it } from 'vitest';
import { any, call, condition, decl, dimension, el, list, mixin, paren, ref, rules, ruleset } from '../index.js';
import { Context } from '../../context.js';
import { renderNodeToString } from '../util/render-buffer.js';

/**
 * Repros for mixin guard FILTERING: a guard's truth value must gate whether the
 * guarded definition contributes its body. Mirrors the less.js `mixins-guards`
 * fixture cases `#parenthesisNot-true` / `-false` (bare parenthesized guard whose
 * operand is a keyword `true`/`false`) and guard-overload selection.
 */
describe('mixin guard filtering', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context({ leakyScope: true });
    context.depth = 2;
  });

  it('includes a mixin whose bare parenthesized guard evaluates to keyword true', async () => {
    // .m(@value) when ((@value)) { included: yes; }  ->  .m(true)
    const mixinDef = mixin({
      name: '.m',
      params: list([any('value', { role: 'property' })]),
      guard: paren(paren(ref({ key: 'value' }, { type: 'variable' }))),
      rules: [decl({ name: 'included', value: any('yes') })]
    });
    const caller = ruleset({
      selector: el('.test'),
      rules: [
        call({ name: ref({ key: '.m' }, { type: 'mixin' }), args: list([any('true')]) })
      ]
    });
    const root = rules([mixinDef, caller]);
    context.root = root;

    const css = await renderNodeToString(root, context);
    expect(css).toContain('included: yes;');
  });

  it('excludes a mixin whose bare parenthesized guard evaluates to keyword false', async () => {
    const mixinDef = mixin({
      name: '.m',
      params: list([any('value', { role: 'property' })]),
      guard: paren(paren(ref({ key: 'value' }, { type: 'variable' }))),
      rules: [decl({ name: 'included', value: any('yes') })]
    });
    const caller = ruleset({
      selector: el('.test'),
      rules: [
        call({ name: ref({ key: '.m' }, { type: 'mixin' }), args: list([any('false')]) })
      ]
    });
    const root = rules([mixinDef, caller]);
    context.root = root;

    const css = await renderNodeToString(root, context);
    expect(css).not.toContain('included: yes;');
  });

  it('selects only guard-passing overloads among same-name mixins', async () => {
    // .m(@a) when (@a > 0) { pos: y }   .m(@a) when (@a <= 0) { nonpos: y }
    const positive = mixin({
      name: '.m',
      params: list([any('a', { role: 'property' })]),
      guard: condition([ref({ key: 'a' }, { type: 'variable' }), '>', dimension([0])]),
      rules: [decl({ name: 'pos', value: any('y') })]
    });
    const nonPositive = mixin({
      name: '.m',
      params: list([any('a', { role: 'property' })]),
      guard: condition([ref({ key: 'a' }, { type: 'variable' }), '<=', dimension([0])]),
      rules: [decl({ name: 'nonpos', value: any('y') })]
    });
    const caller = ruleset({
      selector: el('.test'),
      rules: [
        call({ name: ref({ key: '.m' }, { type: 'mixin' }), args: list([dimension([5])]) })
      ]
    });
    const root = rules([positive, nonPositive, caller]);
    context.root = root;

    const css = await renderNodeToString(root, context);
    expect(css).toContain('pos: y;');
    expect(css).not.toContain('nonpos: y;');
  });
});
