import { describe, expect, it } from 'vitest';
import { isNode, type Node } from '../node.js';
import {
  collection,
  collectionEntry,
  block,
  declarationReference,
  funcCall,
  important,
  interpolation,
  keyword,
  selectorCapture,
  reference,
  variableDeclaration,
  variableReference
} from '../nodes.js';
import { bare } from '../../../../../test/provenance-free.js';

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

  it('publishes both general-enclosed forms as a call and a block over one Interpolation', () => {
    const fn: Node = funcCall('selector', [interpolation([{ lit: '.card' }])]);
    const paren: Node = block(interpolation([{ lit: '--x: red' }]));

    expect(bare(fn)).toEqual({
      type: 'FunctionCall',
      name: 'selector',
      modern: false,

      /* A call argument is a `CallArg`, not a bare value slot — the same node a
       * mixin-call argument is, so a KEYWORD argument has somewhere to live.
       * `name`/`spread` are present-and-empty on every argument: that uniformity
       * is the point, so the shape is asserted rather than elided. */
      args: [{ value: { type: 'Interpolation', parts: [{ lit: '.card' }] }, name: undefined, spread: false }]
    });
    expect(bare(paren)).toEqual({
      type: 'Block',
      delimiter: 'paren',
      value: { type: 'Interpolation', parts: [{ lit: '--x: red' }] }
    });
    expect(isNode(fn)).toBe(true);
    expect(isNode(paren)).toBe(true);
  });

  it('publishes variable-held calls as final Reference call steps', () => {
    const call: Node = reference(variableReference('content', 'scoped'), [{ type: 'Call', args: [] }], '@content()');

    expect(bare(call)).toEqual({
      type: 'Reference',
      base: { type: 'Lookup', kind: 'var', scope: 'scoped', name: 'content', raw: '@content' },
      steps: [{ type: 'Call', args: [] }],
      raw: '@content()'
    });
    expect(isNode(call)).toBe(true);
  });

  it('publishes declaration-member references as public AST facts', () => {
    const member: Node = reference(declarationReference('$'), [{ type: 'LookupStep', kind: 'member', name: 'tone' }], '$.tone');

    expect(bare(member)).toEqual({
      type: 'Reference',
      base: { type: 'Lookup', kind: 'entry', scope: 'scoped', name: '', raw: '$' },
      steps: [{ type: 'LookupStep', kind: 'member', name: 'tone' }],
      raw: '$.tone'
    });
    expect(isNode(declarationReference('$'))).toBe(true);
    expect(isNode(member)).toBe(true);
  });

  it('retains variable lookup and write operations as public AST facts', () => {
    expect(bare(variableReference('current', 'live'))).toEqual({
      type: 'Lookup', kind: 'var', scope: 'live', name: 'current', raw: '@current'
    });
    expect(bare(variableReference('final', 'scoped'))).toEqual({
      type: 'Lookup', kind: 'var', scope: 'scoped', name: 'final', raw: '@final'
    });

    /* `@@name` — a var lookup whose NAME is a node, which is the entire reason
     * the separate `VarIndirect` kind existed. */
    expect(bare(variableReference(variableReference('name', 'live'), 'live'))).toEqual({
      type: 'Lookup', kind: 'var', scope: 'live', name: bare(variableReference('name', 'live')), raw: ''
    });
    expect(bare(variableDeclaration('both', keyword('blue'), { mode: 'declare' }))).toEqual({
      type: 'VariableDeclaration', name: 'both', value: keyword('blue'), write: { mode: 'declare' }
    });
    expect(variableDeclaration('ifMissing', keyword('blue'), {
      mode: 'if-absent', scope: 'live'
    })).toMatchObject({
      type: 'VariableDeclaration', write: { mode: 'if-absent', scope: 'live' }
    });
    expect(variableDeclaration('final', keyword('blue'), {
      mode: 'reassign', scope: 'scoped'
    })).toMatchObject({
      type: 'VariableDeclaration', write: { mode: 'reassign', scope: 'scoped' }
    });
  });
});
