import {
  Any,
  Block,
  Call,
  For,
  If,
  JsFunction,
  List,
  Nil,
  Paren,
  Sequence,
  VarDeclaration,
  decl,
  expr,
  list,
  el,
  ref,
  rules,
  ruleset,
  sel
} from '../index.js';
import { Context } from '../../context.js';

function makePattern(bindingNames: string[], kind: 'block' | 'list' | 'sequence' | 'single' = 'block') {
  const vars = bindingNames.map(name => new VarDeclaration({
    name: new Any(name, { role: 'property' }),
    value: new Nil()
  }, { paramVar: true }));
  if (kind === 'single') {
    return vars[0]!;
  }
  if (kind === 'list') {
    return new List(vars, { sep: ',' });
  }
  if (kind === 'sequence') {
    return new Sequence(vars);
  }
  return new Block(
    new List(vars, { sep: ',' }),
    { type: 'square' }
  );
}

function makeForHeader(pattern: any, iterable: any) {
  return new Sequence([
    new Paren(new Sequence([
      pattern,
      new Any('of', { role: 'any' }),
      iterable
    ])) as any
  ]);
}

function makeLoop(
  pattern: any,
  iterable: any,
  loopRules = rules([
    decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) }),
    decl({ name: 'key', value: ref({ key: 'key' }, { type: 'variable' }) }),
    decl({ name: 'index', value: ref({ key: 'index' }, { type: 'variable' }) })
  ])
) {
  const normalizedPattern = normalizePattern(pattern);
  return new For({
    pattern: normalizedPattern,
    iterable: { kind: 'node', value: iterable },
    rules: loopRules
  });
}

function isPatternNodeTuple(pattern: any): pattern is List | Sequence {
  return pattern instanceof List || pattern instanceof Sequence;
}

function normalizePattern(pattern: any) {
  if (pattern instanceof VarDeclaration) {
    return { kind: 'single' as const, value: pattern };
  }
  if (pattern instanceof Block && pattern.data instanceof List) {
    const values = pattern.data.data.filter((entry): entry is VarDeclaration => entry instanceof VarDeclaration);
    return { kind: 'tuple' as const, values: values as [VarDeclaration, ...VarDeclaration[]] };
  }
  if (isPatternNodeTuple(pattern)) {
    const values = pattern.data.filter((entry): entry is VarDeclaration => entry instanceof VarDeclaration);
    return values.length === 1
      ? { kind: 'single' as const, value: values[0]! }
      : { kind: 'tuple' as const, values: values as [VarDeclaration, ...VarDeclaration[]] };
  }
  throw new Error('Unexpected test pattern shape');
}

describe('Control Nodes', () => {
  it('evaluates $for with block pattern + expression iterable', async () => {
    const context = new Context();
    const pattern = makePattern(['value', 'key', 'index'], 'block');
    const iterable = expr(list([new Any('a'), new Any('b')]));
    const root = rules([makeLoop(pattern, iterable)]);
    const evald = await root.eval(context);
    expect(`${evald}`).toContain('item: a');
    expect(`${evald}`).toContain('item: b');
    expect(`${evald}`).toContain('key: 1');
    expect(`${evald}`).toContain('key: 2');
    expect(`${evald}`).toContain('index: 1');
    expect(`${evald}`).toContain('index: 2');
  });

  it('evaluates $for with call iterable branch', async () => {
    const context = new Context();
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'mkList',
      fn: () => list([new Any('x'), new Any('y')])
    }));
    const iterableCall = new Call({
      name: ref({ key: 'mkList' }, { type: 'function' }),
      args: list([])
    });
    root.push(makeLoop(makePattern(['value', 'key', 'index']), iterableCall));
    const evald = await root.eval(context);
    expect(`${evald}`).toContain('item: x');
    expect(`${evald}`).toContain('item: y');
    expect(`${evald}`).toContain('key: 1');
    expect(`${evald}`).toContain('key: 2');
  });

  it('evaluates $for with rules iterable and skips non-declarations', async () => {
    const context = new Context();
    const iterableRules = rules([
      decl({ name: 'one', value: new Any('red') }),
      ruleset({
        selector: sel([el('.skip')]) as any,
        rules: rules([decl({ name: 'x', value: new Any('nope') })])
      }),
      decl({ name: 'two', value: new Any('blue') })
    ]);
    const loopRules = rules([
      decl({ name: 'name', value: ref({ key: 'key' }, { type: 'variable' }) }),
      decl({ name: 'value', value: ref({ key: 'value' }, { type: 'variable' }) })
    ]);
    const root = rules([makeLoop(makePattern(['value', 'key'], 'block'), iterableRules, loopRules)]);
    const evald = await root.eval(context);
    expect(`${evald}`).toContain('name: one');
    expect(`${evald}`).toContain('name: two');
    expect(`${evald}`).toContain('value: red');
    expect(`${evald}`).toContain('value: blue');
    expect(`${evald}`).not.toContain('nope');
  });

  it('evaluates $for with scalar fallback iterable', async () => {
    const context = new Context();
    const root = rules([makeLoop(makePattern(['value', 'key', 'index']), new Any('solo'))]);
    const evald = await root.eval(context);
    expect(`${evald}`).toContain('item: solo');
    expect(`${evald}`).toContain('key: 1');
    expect(`${evald}`).toContain('index: 1');
  });

  it('supports list pattern bindings', async () => {
    const context = new Context();
    const loopRules = rules([
      decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) }),
      decl({ name: 'key', value: ref({ key: 'key' }, { type: 'variable' }) })
    ]);
    const root = rules([makeLoop(makePattern(['value', 'key'], 'list'), list([new Any('a')]), loopRules)]);
    const evald = await root.eval(context);
    expect(`${evald}`).toContain('item: a');
    expect(`${evald}`).toContain('key: 1');
  });

  it('supports sequence pattern bindings', async () => {
    const context = new Context();
    const loopRules = rules([
      decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) }),
      decl({ name: 'key', value: ref({ key: 'key' }, { type: 'variable' }) })
    ]);
    const root = rules([makeLoop(makePattern(['value', 'key'], 'sequence'), list([new Any('a')]), loopRules)]);
    const evald = await root.eval(context);
    expect(`${evald}`).toContain('item: a');
    expect(`${evald}`).toContain('key: 1');
  });

  it('supports single var pattern binding', async () => {
    const context = new Context();
    const loopRules = rules([
      decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) })
    ]);
    const root = rules([makeLoop(makePattern(['value'], 'single'), list([new Any('a')]), loopRules)]);
    const evald = await root.eval(context);
    expect(`${evald}`).toContain('item: a');
  });

  it('throws for invalid $for header', async () => {
    const badHeader = new Sequence([
      new Paren(new Sequence([makePattern(['value'], 'single'), new Any('from', { role: 'any' }), list([new Any('a')])])) as any
    ]);
    expect(() => new For({ header: badHeader, rules: rules([]) })).toThrow('Invalid $for header');
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
      pattern: { kind: 'single', value: makePattern(['value'], 'single') as VarDeclaration },
      iterable: { kind: 'node', value: list([new Any('a')]) },
      rules: rules([], {
        rulesVisibility: {
          Declaration: 'private',
          Ruleset: 'private',
          VarDeclaration: 'private',
          Mixin: 'private'
        }
      })
    });
    expect(ifNode.data.branches[0]!.rules.options.rulesVisibility.Declaration).toBe('public');
    expect(ifNode.data.branches[0]!.rules.options.rulesVisibility.Ruleset).toBe('public');
    expect(ifNode.data.branches[0]!.rules.options.rulesVisibility.VarDeclaration).toBe('public');
    expect(ifNode.data.branches[0]!.rules.options.rulesVisibility.Mixin).toBe('public');
    expect(forNode.data.rules.options.rulesVisibility.Declaration).toBe('public');
    expect(forNode.data.rules.options.rulesVisibility.Ruleset).toBe('public');
    expect(forNode.data.rules.options.rulesVisibility.VarDeclaration).toBe('public');
    expect(forNode.data.rules.options.rulesVisibility.Mixin).toBe('public');
  });
});
