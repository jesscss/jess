import {
  Any,
  Block,
  For,
  If,
  List,
  Nil,
  Paren,
  Sequence,
  VarDeclaration,
  decl,
  list,
  ref,
  rules
} from '..';
import { Context } from '../../context.js';

function makeForHeader(bindingNames: string[], iterable: List) {
  const vars = bindingNames.map((name) => new VarDeclaration({
    name: new Any(name, { role: 'property' }),
    value: new Nil()
  }, { paramVar: true }));
  const pattern = new Block(
    new List(vars, { sep: ',' }),
    { type: 'square' }
  );
  return new Sequence([
    new Paren(new Sequence([
      pattern,
      new Any('of', { role: 'any' }),
      iterable
    ]))
  ]);
}

describe('Control Nodes', () => {
  it('evaluates a $for node with value/key/index bindings', async () => {
    const context = new Context();
    const iterable = list([new Any('a'), new Any('b')]);
    const loop = new For({
      header: makeForHeader(['value', 'key', 'index'], iterable),
      rules: rules([
        decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) }),
        decl({ name: 'key', value: ref({ key: 'key' }, { type: 'variable' }) }),
        decl({ name: 'index', value: ref({ key: 'index' }, { type: 'variable' }) })
      ])
    });
    const root = rules([loop]);
    const evald = await root.eval(context);
    expect(`${evald}`).toContain('item: a');
    expect(`${evald}`).toContain('item: b');
    expect(`${evald}`).toContain('key: 1');
    expect(`${evald}`).toContain('key: 2');
    expect(`${evald}`).toContain('index: 1');
    expect(`${evald}`).toContain('index: 2');
  });

  it('forces public rulesVisibility for $if and $for rules', () => {
    const privateRules = rules([], {
      rulesVisibility: {
        Declaration: 'private',
        Ruleset: 'private',
        VarDeclaration: 'private',
        Mixin: 'private'
      }
    });
    const ifNode = new If({
      branches: [{ condition: new Any('true', { role: 'any' }), rules: privateRules }]
    });
    const forNode = new For({
      header: makeForHeader(['value'], list([new Any('a')])),
      rules: rules([], {
        rulesVisibility: {
          Declaration: 'private',
          Ruleset: 'private',
          VarDeclaration: 'private',
          Mixin: 'private'
        }
      })
    });
    expect(ifNode.value.branches[0]!.rules.options.rulesVisibility.Declaration).toBe('public');
    expect(ifNode.value.branches[0]!.rules.options.rulesVisibility.Ruleset).toBe('public');
    expect(ifNode.value.branches[0]!.rules.options.rulesVisibility.VarDeclaration).toBe('public');
    expect(ifNode.value.branches[0]!.rules.options.rulesVisibility.Mixin).toBe('public');
    expect(forNode.value.rules.options.rulesVisibility.Declaration).toBe('public');
    expect(forNode.value.rules.options.rulesVisibility.Ruleset).toBe('public');
    expect(forNode.value.rules.options.rulesVisibility.VarDeclaration).toBe('public');
    expect(forNode.value.rules.options.rulesVisibility.Mixin).toBe('public');
  });
});
