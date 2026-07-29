import { describe, expect, it } from 'vitest';
import { isNode, type Node } from '../node.js';
import {
  collection,
  collectionEntry,
  declarationReference,
  generalEnclosed,
  important,
  interpolation,
  keyword,
  selectorCapture,
  varIndirect,
  reference,
  variableDeclaration,
  variableReference
} from '../nodes.js';

describe('AST node contract', () => {
  it('admits the Important value wrapper through the exported Node union', () => {
    const value: Node = important(keyword('red'));

    expect(isNode(value)).toBe(true);
  });

  it('admits SelectorCapture through the exported Node union', () => {
    const capture: Node = selectorCapture(
      ['.primary', '.secondary'],
      '*[.primary, .secondary]'
    );

    expect(isNode(capture)).toBe(true);
  });

  it('admits Collection through the exported Node union', () => {
    const value: Node = collection([]);

    expect(isNode(value)).toBe(true);
  });

  it('admits CollectionEntry through the exported Node union', () => {
    const value: Node = collectionEntry(keyword('a'), keyword('b'));

    expect(isNode(value)).toBe(true);
  });

  it('publishes GeneralEnclosed with structured Interpolation content', () => {
    const enclosed: Node = generalEnclosed(
      'function',
      'selector',
      interpolation([{ lit: '.card' }])
    );

    expect(enclosed).toEqual({
      type: 'GeneralEnclosed',
      form: 'function',
      name: 'selector',
      content: { type: 'Interpolation', parts: [{ lit: '.card' }] }
    });
    expect(isNode(enclosed)).toBe(true);
  });

  it('publishes variable-held calls as final Reference call steps', () => {
    const call: Node = reference(variableReference('content', 'scoped'), [{ type: 'Call', args: [] }], '@content()');

    expect(call).toEqual({
      type: 'Reference',
      base: { type: 'VariableReference', name: 'content', lookup: 'scoped' },
      steps: [{ type: 'Call', args: [] }],
      raw: '@content()'
    });
    expect(isNode(call)).toBe(true);
  });

  it('publishes declaration-member references as public AST facts', () => {
    const member: Node = reference(declarationReference('$'), [{ type: 'DotLookup', name: 'tone' }], '$.tone');

    expect(member).toEqual({
      type: 'Reference',
      base: { type: 'DeclarationReference', raw: '$' },
      steps: [{ type: 'DotLookup', name: 'tone' }],
      raw: '$.tone'
    });
    expect(isNode(declarationReference('$'))).toBe(true);
    expect(isNode(member)).toBe(true);
  });

  it('retains variable lookup and write operations as public AST facts', () => {
    expect(variableReference('current', 'live')).toEqual({
      type: 'VariableReference', name: 'current', lookup: 'live'
    });
    expect(variableReference('final', 'scoped')).toEqual({
      type: 'VariableReference', name: 'final', lookup: 'scoped'
    });
    expect(varIndirect(variableReference('name', 'live'), 'live')).toEqual({
      type: 'VarIndirect', nameRef: variableReference('name', 'live'), lookup: 'live'
    });
    expect(variableDeclaration('both', keyword('blue'), { mode: 'declare' })).toEqual({
      type: 'VariableDeclaration', name: 'both', value: keyword('blue'), write: { mode: 'declare' }
    });
    expect(variableDeclaration('ifMissing', keyword('blue'), {
      mode: 'if-absent', lookup: 'live'
    })).toMatchObject({
      type: 'VariableDeclaration', write: { mode: 'if-absent', lookup: 'live' }
    });
    expect(variableDeclaration('final', keyword('blue'), {
      mode: 'reassign', lookup: 'scoped'
    })).toMatchObject({
      type: 'VariableDeclaration', write: { mode: 'reassign', lookup: 'scoped' }
    });
  });
});
