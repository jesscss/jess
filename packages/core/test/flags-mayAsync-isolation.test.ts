import { expectMayAsync, expectStatic, expectNonStatic, createStaticRuleset, createVariableReference, createVariableInParen, createVariableInSquareBlock, createVariableInOperation, createVariableInNegative, createVariableInCall, createSelectorInterpolation, DEFAULT_VARIABLE } from './helpers';
import { decl, any, el, num, Operation, ref, call, list, paren, negative, atrule, interpolated, rules, ruleset, sellist, sel, Any } from '../src';

describe('Less mayAsync isolation (siblings do not bleed)', () => {
  test('sibling rulesets', () => {
    const tree = rules([
      createVariableReference().value[0]!,
      createStaticRuleset(el('.b'), [decl({ name: 'x', value: any('1') })]).value[0]!
    ]);
    const r1 = tree.value[0]!;
    const r2 = tree.value[1]!;
    expectMayAsync(r1);
    expectStatic(r2);
  });

  test('sibling at-rules', () => {
    const tree = rules([
      atrule({
        name: new Any('media', { role: 'atkeyword' }),
        prelude: any('(min-width: 10px)'),
        rules: createVariableReference()
      }),
      atrule({
        name: new Any('media', { role: 'atkeyword' }),
        prelude: any('(min-width: 10px)'),
        rules: createStaticRuleset(el('a'), [decl({ name: 'x', value: any('1') })])
      })
    ]);
    const a1 = tree.value[0]!;
    const a2 = tree.value[1]!;
    expectMayAsync(a1);
    expectStatic(a2);
  });

  test('sibling declarations: Paren', () => {
    const tree = createStaticRuleset(el('.a'), [
      decl({ name: 'p1', value: paren(ref('@v', { type: 'variable' })) }),
      decl({ name: 'p2', value: paren(any('1')) })
    ]);
    const rs = tree.value[0]! as any;
    const inner = rs.value.rules;
    const d1 = inner.value[0]!;
    const d2 = inner.value[1]!;
    expectMayAsync(d1);
    expectStatic(d2);
  });

  test('sibling declarations: Block', () => {
    const tree = createStaticRuleset(el('.a'), [
      decl({ name: 'b1', value: list([ref('@v', { type: 'variable' })]) }),
      decl({ name: 'b2', value: list([any('1')]) })
    ]);
    const rs = tree.value[0]!;
    const inner = rs.value.rules;
    const d1 = inner.value[0]!;
    const d2 = inner.value[1]!;
    expectMayAsync(d1);
    expectStatic(d2);
  });

  test('sibling declarations: Operation', () => {
    const tree = createStaticRuleset(el('.a'), [
      decl({ name: 'o1', value: new Operation([num(1), '+', ref('@v', { type: 'variable' })]) }),
      decl({ name: 'o2', value: new Operation([num(1), '+', num(2)]) })
    ]);
    const rs = tree.value[0]!;
    const inner = rs.value.rules;
    const d1 = inner.value[0]!;
    const d2 = inner.value[1]!;
    expectMayAsync(d1);
    expectNonStatic(d2);
  });

  test('sibling declarations: Negative', () => {
    const tree = createStaticRuleset(el('.a'), [
      decl({ name: 'n1', value: negative(ref('@v', { type: 'variable' })) }),
      decl({ name: 'n2', value: negative(any('1')) })
    ]);
    const rs = tree.value[0]!;
    const inner = rs.value.rules;
    const d1 = inner.value[0]!;
    const d2 = inner.value[1]!;
    expectMayAsync(d1);
    expectNonStatic(d2);
  });

  test('sibling declarations: Call', () => {
    const tree = createStaticRuleset(el('.a'), [
      decl({ name: 'c1', value: call({ name: 'rgb', args: list([ref('@v', { type: 'variable' }), any('1'), any('1')]) }) }),
      decl({ name: 'c2', value: call({ name: 'rgb', args: list([any('1'), any('1'), any('1')]) }) })
    ]);
    const rs = tree.value[0]!;
    const inner = rs.value.rules;
    const d1 = inner.value[0]!;
    const d2 = inner.value[1]!;
    expectMayAsync(d1);
    expectMayAsync(d2);
  });

  test('sibling rulesets: pseudo selector with selector-child', () => {
    const tree = rules([
      ruleset({
        selector: sellist([sel([el('.a:has('), interpolated({ source: '.{}', replacements: [DEFAULT_VARIABLE] }), el(')')])]),
        rules: rules([decl({ name: 'y', value: any('1') })])
      }),
      ruleset({
        selector: sellist([sel([el('.b:has(.c')])]),
        rules: rules([decl({ name: 'y', value: any('1') })])
      })
    ]);
    const r1 = tree.value[0]!;
    const r2 = tree.value[1]!;
    expectMayAsync(r1);
    expectStatic(r2);
  });

  test('sibling rulesets: compound selector', () => {
    const tree = rules([
      ruleset({
        selector: sellist([sel([el('.foo'), interpolated({ source: '.{}', replacements: [DEFAULT_VARIABLE] })])]),
        rules: rules([decl({ name: 'y', value: any('1') })])
      }),
      ruleset({
        selector: sellist([sel([el('.bar.baz')])]),
        rules: rules([decl({ name: 'y', value: any('1') })])
      })
    ]);
    const r1 = tree.value[0]!;
    const r2 = tree.value[1]!;
    expectMayAsync(r1);
    expectStatic(r2);
  });

  test('sibling rulesets: complex selector', () => {
    const tree = rules([
      ruleset({
        selector: sellist([sel([el('.x '), interpolated({ source: '.{}', replacements: [DEFAULT_VARIABLE] }), el(' .y')])]),
        rules: rules([decl({ name: 'z', value: any('1') })])
      }),
      ruleset({
        selector: sellist([sel([el('.x .c .y')])]),
        rules: rules([decl({ name: 'z', value: any('1') })])
      })
    ]);
    const r1 = tree.value[0]!;
    const r2 = tree.value[1]!;
    expectMayAsync(r1);
    expectStatic(r2);
  });

  test('sibling rulesets: selector list', () => {
    const tree = rules([
      ruleset({
        selector: sellist([sel([el('.a, '), interpolated({ source: '.{}', replacements: [DEFAULT_VARIABLE] })])]),
        rules: rules([decl({ name: 'y', value: any('1') })])
      }),
      ruleset({
        selector: sellist([sel([el('.a, .c')])]),
        rules: rules([decl({ name: 'y', value: any('1') })])
      })
    ]);
    const r1 = tree.value[0]!;
    const r2 = tree.value[1]!;
    expectMayAsync(r1);
    expectStatic(r2);
  });
});
