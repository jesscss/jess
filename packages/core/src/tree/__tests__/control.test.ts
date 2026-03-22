import {
  Any,
  Call,
  For,
  If,
  JsFunction,
  List,
  Nil,
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
import { sessionPatchField } from '../util/session-helpers.js';

function makePattern(bindingNames: string[], kind: 'block' | 'list' | 'sequence' | 'single' = 'block') {
  const vars = bindingNames.map(name => new VarDeclaration({
    name: new Any(name, { role: 'property' }),
    value: new Nil()
  }, { paramVar: true }));
  if (kind === 'single') {
    return vars[0]!;
  }
  return vars;
}

function makeLoop(
  pattern: VarDeclaration | VarDeclaration[],
  iterable: any,
  loopRules = rules([
    decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) }),
    decl({ name: 'key', value: ref({ key: 'key' }, { type: 'variable' }) }),
    decl({ name: 'index', value: ref({ key: 'index' }, { type: 'variable' }) })
  ])
) {
  return new For({
    vars: pattern,
    iterable,
    rules: loopRules
  });
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

  it('creates For with single var binding', () => {
    const singleVar = makePattern(['value'], 'single') as VarDeclaration;
    const forNode = new For({ vars: singleVar, iterable: list([new Any('a')]), rules: rules([]) });
    expect(forNode.vars).toBe(singleVar);
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
      conditions: [new Any('true', { role: 'any' })],
      bodies: [privateRules]
    });
    const forNode = new For({
      vars: makePattern(['value'], 'single') as VarDeclaration,
      iterable: list([new Any('a')]),
      rules: rules([], {
        rulesVisibility: {
          Declaration: 'private',
          Ruleset: 'private',
          VarDeclaration: 'private',
          Mixin: 'private'
        }
      })
    });
    expect(ifNode.bodies[0]!.options.rulesVisibility.Declaration).toBe('public');
    expect(ifNode.bodies[0]!.options.rulesVisibility.Ruleset).toBe('public');
    expect(ifNode.bodies[0]!.options.rulesVisibility.VarDeclaration).toBe('public');
    expect(ifNode.bodies[0]!.options.rulesVisibility.Mixin).toBe('public');
    expect(forNode.rules.options.rulesVisibility.Declaration).toBe('public');
    expect(forNode.rules.options.rulesVisibility.Ruleset).toBe('public');
    expect(forNode.rules.options.rulesVisibility.VarDeclaration).toBe('public');
    expect(forNode.rules.options.rulesVisibility.Mixin).toBe('public');
  });

  it('evaluates and renders $for with a session-patched iterable without mutating the canonical node', async () => {
    const context = new Context();
    context.createSession();

    const loop = makeLoop(makePattern(['value'], 'single'), list([new Any('a')]), rules([
      decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) })
    ]));
    const root = rules([loop]);
    const patchedIterable = list([new Any('patched')]);

    sessionPatchField(loop, 'iterable', patchedIterable, context);

    const evald = await root.eval(context);

    expect(`${evald}`).toContain('item: patched');
    expect(loop.toTrimmedString({ context })).toContain('patched');
    expect(loop.toTrimmedString()).toContain('a');
    expect(loop.iterable.toTrimmedString()).toBe('a');
  });

  it('renders $if with session-patched conditions and bodies without mutating the canonical node', () => {
    const context = new Context();
    context.createSession();

    const ifNode = new If({
      conditions: [new Any('true', { role: 'any' })],
      bodies: [rules([decl({ name: 'color', value: new Any('red') })])]
    });
    const patchedBody = rules([decl({ name: 'color', value: new Any('blue') })]);

    sessionPatchField(ifNode, 'conditions', [new Any('false', { role: 'any' })], context);
    sessionPatchField(ifNode, 'bodies', [patchedBody], context);

    expect(ifNode.toTrimmedString({ context })).toContain('$if (false)');
    expect(ifNode.toTrimmedString({ context })).toContain('color: blue;');
    expect(ifNode.toTrimmedString()).toContain('$if (true)');
    expect(ifNode.toTrimmedString()).toContain('color: red;');
    expect(ifNode.conditions[0]!.toTrimmedString()).toBe('true');
    expect(ifNode.bodies[0]!.toTrimmedString()).toContain('color: red;');
  });
});
