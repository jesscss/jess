import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import { decl, dimension, forNode, ifNode, keyword, mixinCall, mixinDef, rule, spaced, stylesheet, variableDeclaration, variableReference } from '../nodes.js';
import { serialize } from '../serialize.js';

const evaluator = buildEvaluator(makeLessRegistry());
const render = (document: ReturnType<typeof stylesheet>): string => serialize(document, { evaluator }).css;

describe('R3 live and scoped variable stores', () => {
  it('keeps live reassignment separate from the immutable scoped declaration stack', () => {
    const document = stylesheet([
      variableDeclaration('tone', keyword('navy'), { mode: 'declare' }),
      variableDeclaration('tone', keyword('blue'), { mode: 'reassign', scope: 'live' }),
      rule('.card', [
        decl('live', variableReference('tone', 'live')),
        decl('scoped', variableReference('tone', 'scoped'))
      ])
    ]);

    expect(render(document)).toBe('.card {\n  live: blue;\n  scoped: navy;\n}\n');
  });

  it('targets conditional assignment at the requested lookup store', () => {
    const live = stylesheet([
      variableDeclaration('tone', keyword('navy'), { mode: 'if-absent', scope: 'live' }),
      variableDeclaration('tone', keyword('blue'), { mode: 'declare' }),
      rule('.live', [
        decl('live', variableReference('tone', 'live')),
        decl('scoped', variableReference('tone', 'scoped'))
      ])
    ]);
    const scoped = stylesheet([
      variableDeclaration('tone', keyword('navy'), { mode: 'if-absent', scope: 'scoped' }),
      variableDeclaration('tone', keyword('blue'), { mode: 'declare' }),
      rule('.scoped', [
        decl('live', variableReference('tone', 'live')),
        decl('scoped', variableReference('tone', 'scoped'))
      ])
    ]);

    expect(render(live)).toBe('.live {\n  live: blue;\n  scoped: navy;\n}\n');
    expect(render(scoped)).toBe('.scoped {\n  live: blue;\n  scoped: blue;\n}\n');
  });

  it('updates only the requested store for scoped reassignment and excludes a declaration while evaluating it', () => {
    const document = stylesheet([
      variableDeclaration('tone', keyword('navy'), { mode: 'declare' }),
      variableDeclaration('tone', keyword('blue'), { mode: 'reassign', scope: 'scoped' }),
      variableDeclaration('cycle', keyword('first'), { mode: 'declare' }),
      variableDeclaration('cycle', variableReference('cycle', 'scoped'), { mode: 'declare' }),
      rule('.card', [
        decl('live', variableReference('tone', 'live')),
        decl('scoped', variableReference('tone', 'scoped')),
        decl('cycle', variableReference('cycle', 'scoped'))
      ])
    ]);

    expect(render(document)).toBe('.card {\n  live: navy;\n  scoped: blue;\n  cycle: first;\n}\n');
  });

  it('uses the indirect reference target lookup without changing the name lookup', () => {
    const document = stylesheet([
      variableDeclaration('name', keyword('tone'), { mode: 'declare' }),
      variableDeclaration('tone', keyword('navy'), { mode: 'declare' }),
      variableDeclaration('tone', keyword('blue'), { mode: 'reassign', scope: 'live' }),
      rule('.card', [
        decl('live', variableReference(variableReference('name', 'live'), 'live')),
        decl('scoped', variableReference(variableReference('name', 'live'), 'scoped'))
      ])
    ]);

    expect(render(document)).toBe('.card {\n  live: blue;\n  scoped: navy;\n}\n');
  });

  it('publishes only selected branch declarations after the control point and preserves nested source order', () => {
    const document = stylesheet([
      variableDeclaration('tone', keyword('gray'), { mode: 'declare' }),
      rule('.before', [decl('scoped', variableReference('tone', 'scoped'))]),
      ifNode([{
        guard: { g: 'truth', value: keyword('true') },
        rules: [
          variableDeclaration('tone', keyword('navy'), { mode: 'declare' }),
          ifNode([{
            guard: { g: 'truth', value: keyword('true') },
            rules: [variableDeclaration('nested', keyword('blue'), { mode: 'declare' })]
          }]),
          variableDeclaration('tone', keyword('green'), { mode: 'declare' }),
          rule('.inside', [
            decl('live', variableReference('tone', 'live')),
            decl('scoped', variableReference('tone', 'scoped')),
            decl('nested', variableReference('nested', 'scoped'))
          ])
        ]
      }]),
      rule('.after', [
        decl('live', variableReference('tone', 'live')),
        decl('scoped', variableReference('tone', 'scoped'))
      ])
    ]);

    expect(render(document)).toBe('.before {\n  scoped: gray;\n}\n'
      + '.inside {\n  live: green;\n  scoped: green;\n  nested: blue;\n}\n'
      + '.after {\n  live: green;\n  scoped: green;\n}\n');
  });

  it('does not publish an unselected if arm and keeps selected conditional/reassignment lookup modes', () => {
    const document = stylesheet([
      variableDeclaration('tone', keyword('gray'), { mode: 'declare' }),
      ifNode([
        {
          guard: { g: 'truth', value: keyword('false') },
          rules: [variableDeclaration('tone', keyword('red'), { mode: 'declare' })]
        },
        {
          guard: null,
          rules: [
            variableDeclaration('tone', keyword('blue'), { mode: 'declare' }),
            variableDeclaration('tone', keyword('navy'), { mode: 'if-absent', scope: 'live' }),
            variableDeclaration('tone', keyword('white'), { mode: 'if-absent', scope: 'scoped' }),
            variableDeclaration('tone', keyword('green'), { mode: 'reassign', scope: 'live' }),
            variableDeclaration('tone', keyword('black'), { mode: 'reassign', scope: 'scoped' })
          ]
        }
      ]),
      rule('.after', [
        decl('live', variableReference('tone', 'live')),
        decl('scoped', variableReference('tone', 'scoped'))
      ])
    ]);

    expect(render(document)).toBe('.after {\n  live: green;\n  scoped: black;\n}\n');
  });

  it('keeps selected branch exclusion lazy and isolates selected state per loop and mixin activation', () => {
    const document = stylesheet([
      variableDeclaration('tone', keyword('gray'), { mode: 'declare' }),
      ifNode([{
        guard: { g: 'truth', value: keyword('true') },
        rules: [variableDeclaration('tone', variableReference('tone', 'scoped'), { mode: 'declare' })]
      }]),
      forNode(spaced([dimension(1)]), [
        ifNode([{
          guard: { g: 'truth', value: keyword('true') },
          rules: [variableDeclaration('tone', keyword('blue'), { mode: 'declare' })]
        }]),
        rule('.loop', [decl('scoped', variableReference('tone', 'scoped'))])
      ], { kind: 'single', name: 'item' }),
      mixinDef('.m', [], [
        ifNode([{
          guard: { g: 'truth', value: keyword('true') },
          rules: [variableDeclaration('tone', keyword('navy'), { mode: 'declare' })]
        }]),
        decl('from-mixin', variableReference('tone', 'scoped'))
      ]),
      rule('.out', [mixinCall('.m'), decl('after', variableReference('tone', 'scoped'))])
    ]);

    expect(render(document)).toBe('.loop {\n  scoped: blue;\n}\n'
      + '.out {\n  from-mixin: navy;\n  after: gray;\n}\n');
  });

  it('keeps mutually recursive selected declarations excluded while evaluating either side', () => {
    const document = stylesheet([
      variableDeclaration('a', keyword('root-a'), { mode: 'declare' }),
      variableDeclaration('b', keyword('root-b'), { mode: 'declare' }),
      ifNode([{
        guard: { g: 'truth', value: keyword('true') },
        rules: [
          variableDeclaration('a', variableReference('b', 'scoped'), { mode: 'declare' }),
          variableDeclaration('b', variableReference('a', 'scoped'), { mode: 'declare' })
        ]
      }]),
      rule('.after', [
        decl('a', variableReference('a', 'scoped')),
        decl('b', variableReference('b', 'scoped'))
      ])
    ]);

    expect(render(document)).toBe('.after {\n  a: root-a;\n  b: root-b;\n}\n');
  });

  it('augments ordinary scoped bindings while retaining declarations after a selected branch', () => {
    const document = stylesheet([
      mixinDef('.m', [{ name: 'seed' }], [
        ifNode([{
          guard: { g: 'truth', value: keyword('true') },
          rules: [variableDeclaration('branch', keyword('selected'), { mode: 'declare' })]
        }]),
        variableDeclaration('after', keyword('later'), { mode: 'declare' }),
        decl('seed', variableReference('seed', 'scoped')),
        decl('branch', variableReference('branch', 'scoped')),
        decl('after', variableReference('after', 'scoped'))
      ]),
      rule('.out', [mixinCall('.m', [{ value: keyword('parameter') }])])
    ]);

    expect(render(document)).toBe('.out {\n  seed: parameter;\n  branch: selected;\n  after: later;\n}\n');
  });
});
