import { describe, expect, it } from 'vitest';
import { makeBuiltinRegistry } from '@jesscss/fns';
import {
  buildEvaluator,
  decl,
  dimension,
  operation,
  root,
  rule,
  serialize,
  varDecl,
  varRef,
  type MixinCall,
  type MixinDef,
  type Root,
  type Statement
} from '../index.js';

const evaluator = buildEvaluator(makeBuiltinRegistry());
const render = (document: Root, collapseNesting = true): string | undefined =>
  serialize(document, { evaluator, collapseNesting }).css;

const call = (name: string, args: MixinCall['args'] = []): MixinCall => ({
  type: 'MixinCall', name, args, path: [], important: false
});

const mixin = (
  name: string,
  params: MixinDef['params'],
  body: Statement[],
  guard?: MixinDef['guard']
): MixinDef => ({ type: 'MixinDef', name, params, body, ...(guard ? { guard } : {}) });

describe('Mixin canonical AST emission', () => {
  it('terminates guarded recursion through direct guard and operation nodes', () => {
    const loop = mixin('.loop', [{ name: 'n' }], [
      decl('step', varRef('n')),
      call('.loop', [{ value: operation('-', varRef('n'), dimension(1)) }])
    ], {
      g: 'cmp', op: '>', left: varRef('n'), right: dimension(0)
    });
    const document = root([loop, rule('.out', [call('.loop', [{ value: dimension(3) }])])]);

    expect(render(document)).toBe('.out {\n  step: 3;\n  step: 2;\n  step: 1;\n}\n');
  });

  it('selects an overload while evaluating a default in the callee closure', () => {
    const small = mixin('.space', [{ name: 'n' }, { name: 'gap', default: operation('+', varRef('n'), dimension(1)) }], [
      decl('kind', { type: 'Keyword', src: 'small' }),
      decl('gap', varRef('gap'))
    ], { g: 'cmp', op: '<', left: varRef('n'), right: dimension(10) });
    const large = mixin('.space', [{ name: 'n' }, { name: 'gap', default: dimension(99) }], [
      decl('kind', { type: 'Keyword', src: 'large' }),
      decl('gap', varRef('gap'))
    ], { g: 'cmp', op: '>=', left: varRef('n'), right: dimension(10) });
    const document = root([
      small,
      large,
      rule('.small', [varDecl('n', dimension(40)), call('.space', [{ value: dimension(4) }])]),
      rule('.large', [call('.space', [{ value: dimension(12) }])])
    ]);

    expect(render(document)).toBe(
      '.small {\n  kind: small;\n  gap: 5;\n}\n'
      + '.large {\n  kind: large;\n  gap: 99;\n}\n'
    );
  });

  it('unlocks a parameter-bound variable for later canonical siblings', () => {
    const set = mixin('.set', [{ name: 'value' }], [varDecl('shared', varRef('value'))]);
    const document = root([
      set,
      call('.set', [{ value: dimension(7, 'px') }]),
      rule('.out', [decl('width', varRef('shared'))])
    ]);

    expect(render(document)).toBe('.out {\n  width: 7px;\n}\n');
  });

  it('places one shared mixin body correctly in flat and nested output modes', () => {
    const box = mixin('.box', [], [
      decl('color', { type: 'Keyword', src: 'red' }),
      rule('.inner', [decl('width', dimension(1, 'px'))])
    ]);
    const document = root([box, rule('.outer', [call('.box')])]);

    expect(render(document)).toBe(
      '.outer {\n  color: red;\n}\n'
      + '.outer .inner {\n  width: 1px;\n}\n'
    );
    expect(render(document, false)).toBe(
      '.outer {\n  color: red;\n  .inner {\n    width: 1px;\n  }\n}\n'
    );
  });
});
