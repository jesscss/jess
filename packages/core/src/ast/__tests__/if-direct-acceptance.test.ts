import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import { atRuleBlock } from '../at-rule.js';
import { boundaryBlock, condition, decl, dimension, ifNode, keyword, mixinCall, mixinDef, stylesheet, rule, variableDeclaration, variableReference } from '../nodes.js';
import { serialize } from '../serialize.js';

const evaluator = buildEvaluator(makeLessRegistry());

describe('If canonical AST emission', () => {
  /* `boolean(<cond>)` is not a call — the Less grammar lowers it to the `$( … )`
   * expression boundary (§4.5.3a), so the canonical shape under test is a
   * boundary block over a `Condition`, not `funcCall('boolean', …)`. */
  it('evaluates condition values as typed operands inside an expression boundary', () => {
    const gtLeft = condition({
      g: 'cmp',
      op: '>',
      left: dimension(2),
      right: dimension(1)
    }, '(2 > 1)');
    const gtRight = condition({
      g: 'cmp',
      op: '>',
      left: dimension(3),
      right: dimension(2)
    }, '(3 > 2)');
    const document = stylesheet([
      rule('.boolean', [
        decl('value', boundaryBlock(condition({
          g: 'cmp',
          op: '=',
          left: gtLeft,
          right: gtRight
        }, '(2 > 1) = (3 > 2)')))
      ])
    ]);

    expect(serialize(document, { evaluator }).css).toBe('.boolean {\n  value: true;\n}\n');
  });

  it('evaluates ordered guards left-to-right and emits only the selected branch', () => {
    const document = stylesheet([
      variableDeclaration('theme', keyword('dark'), { mode: 'declare' }),
      ifNode([
        { guard: { g: 'cmp', op: '=', left: variableReference('theme', 'scoped'), right: keyword('light') }, rules: [rule('.wrong', [decl('color', keyword('black'))])] },
        { guard: { g: 'cmp', op: '=', left: variableReference('theme', 'scoped'), right: keyword('dark') }, rules: [rule('.card', [decl('color', keyword('white'))])] },
        { guard: null, rules: [rule('.fallback', [decl('color', keyword('gray'))])] }
      ])
    ]);

    expect(serialize(document, { evaluator }).css).toBe('.card {\n  color: white;\n}\n');
  });

  it('shares the containing frame for outer bindings and recurses through nested control', () => {
    const document = stylesheet([
      variableDeclaration('tone', keyword('blue'), { mode: 'declare' }),
      rule('.box', [
        ifNode([{ guard: { g: 'truth', value: keyword('true') }, rules: [decl('color', variableReference('tone', 'scoped'))] }]),
        ifNode([
          { guard: { g: 'truth', value: keyword('false') }, rules: [rule('.wrong', [decl('color', keyword('red'))])] },
          { guard: null, rules: [ifNode([{ guard: { g: 'truth', value: keyword('true') }, rules: [rule('.right', [decl('color', keyword('green'))])] }])] }
        ])
      ])
    ]);

    expect(serialize(document, { evaluator }).css).toBe('.box {\n  color: blue;\n}\n.box .right {\n  color: green;\n}\n');
  });

  it('uses the selected body in both at-rule and nested-output serializer paths', () => {
    const document = stylesheet([
      atRuleBlock('@media', keyword('screen'), [
        ifNode([
          { guard: { g: 'truth', value: keyword('false') }, rules: [rule('.wrong', [decl('color', keyword('red'))])] },
          { guard: null, rules: [rule('.card', [ifNode([{ guard: { g: 'truth', value: keyword('true') }, rules: [decl('color', keyword('green'))] }])])] }
        ])
      ])
    ]);

    expect(serialize(document, { evaluator }).css).toBe('@media screen {\n  .card {\n    color: green;\n  }\n}\n');
    expect(serialize(document, { evaluator, collapseNesting: false }).css).toBe('@media screen {\n  .card {\n    color: green;\n  }\n}\n');
  });

  it('publishes selected branch mixins only after their if event and keeps A/if(B)/C order', () => {
    const mixin = (color: string) => mixinDef('.paint', [], [decl('color', keyword(color))]);
    const document = stylesheet([
      mixin('a'),
      rule('.before', [mixinCall('.paint')]),
      ifNode([{ guard: { g: 'truth', value: keyword('true') }, rules: [mixin('b')] }]),
      mixin('c'),
      rule('.after', [mixinCall('.paint')])
    ]);

    expect(serialize(document, { evaluator }).css).toBe('.before {\n  color: a;\n  color: c;\n}\n'
      + '.after {\n  color: a;\n  color: b;\n  color: c;\n}\n');
  });

  it('orders nested selected-arm publication at its lexical if position', () => {
    const mixin = (color: string) => mixinDef('.paint', [], [decl('color', keyword(color))]);
    const document = stylesheet([
      mixin('a'),
      ifNode([{ guard: { g: 'truth', value: keyword('true') }, rules: [
        mixin('b'),
        ifNode([{ guard: { g: 'truth', value: keyword('true') }, rules: [mixin('nested')] }])
      ] }]),
      mixin('c'),
      rule('.after', [mixinCall('.paint')])
    ]);

    expect(serialize(document, { evaluator }).css).toBe('.after {\n  color: a;\n  color: b;\n  color: nested;\n  color: c;\n}\n');
  });

  it('does not publish a false branch mixin and keeps each selected definition in its activation closure', () => {
    const document = stylesheet([
      mixinDef('.outer', [{ name: 'tone' }], [
        ifNode([{ guard: { g: 'truth', value: keyword('true') }, rules: [
          mixinDef('.inner', [], [decl('color', variableReference('tone', 'scoped'))])
        ] }]),
        mixinCall('.inner')
      ]),
      mixinDef('.inner', [], [decl('fallback', keyword('root'))]),
      mixinDef('.base', [], [decl('color', keyword('base'))]),
      ifNode([{ guard: { g: 'truth', value: keyword('false') }, rules: [
        mixinDef('.base', [], [decl('color', keyword('wrong'))])
      ] }]),
      rule('.one', [mixinCall('.outer', [{ value: keyword('red') }]), mixinCall('.base')]),
      rule('.two', [mixinCall('.outer', [{ value: keyword('blue') }]), mixinCall('.base')]),
      rule('.after', [mixinCall('.inner')])
    ]);

    expect(serialize(document, { evaluator }).css).toBe('.one {\n  color: red;\n  fallback: root;\n  color: base;\n}\n'
      + '.two {\n  color: blue;\n  fallback: root;\n  color: base;\n}\n'
      + '.after {\n  fallback: root;\n}\n');
  });

  it('publishes reached branch mixins through nested and at-rule walkers in both output modes', () => {
    const document = stylesheet([
      rule('.outer', [
        ifNode([{ guard: { g: 'truth', value: keyword('true') }, rules: [
          mixinDef('.nested', [], [decl('color', keyword('purple'))])
        ] }]),
        rule('.inner', [mixinCall('.nested')])
      ]),
      atRuleBlock('@media', keyword('screen'), [
        ifNode([{ guard: { g: 'truth', value: keyword('true') }, rules: [
          mixinDef('.media', [], [decl('color', keyword('green'))])
        ] }]),
        rule('.card', [mixinCall('.media')])
      ])
    ]);

    expect(serialize(document, { evaluator }).css).toBe('.outer .inner {\n  color: purple;\n}\n'
      + '@media screen {\n  .card {\n    color: green;\n  }\n}\n');
    expect(serialize(document, { evaluator, collapseNesting: false }).css).toBe('.outer {\n  .inner {\n    color: purple;\n  }\n}\n'
      + '@media screen {\n  .card {\n    color: green;\n  }\n}\n');
  });
});
