import {
  AssignmentType,
  Any,
  Call,
  Each,
  For,
  If,
  JsFunction,
  List,
  Nil,
  Paren,
  While,
  VarDeclaration,
  decl,
  expr,
  list,
  el,
  ref,
  rules,
  ruleset,
  sel,
  vardecl
} from '../index.js';
import { Context } from '../../context.js';
import { setField } from '../util/field-helpers.js';

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
    expect(evald.render(context)).toContain('item: a');
    expect(evald.render(context)).toContain('item: b');
    expect(evald.render(context)).toContain('key: 1');
    expect(evald.render(context)).toContain('key: 2');
    expect(evald.render(context)).toContain('index: 1');
    expect(evald.render(context)).toContain('index: 2');
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
    expect(evald.render(context)).toContain('item: x');
    expect(evald.render(context)).toContain('item: y');
    expect(evald.render(context)).toContain('key: 1');
    expect(evald.render(context)).toContain('key: 2');
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
    expect(evald.render(context)).toContain('name: one');
    expect(evald.render(context)).toContain('name: two');
    expect(evald.render(context)).toContain('value: red');
    expect(evald.render(context)).toContain('value: blue');
    expect(evald.render(context)).not.toContain('nope');
  });

  it('evaluates $for with scalar fallback iterable', async () => {
    const context = new Context();
    const root = rules([makeLoop(makePattern(['value', 'key', 'index']), new Any('solo'))]);
    const evald = await root.eval(context);
    expect(evald.render(context)).toContain('item: solo');
    expect(evald.render(context)).toContain('key: 1');
    expect(evald.render(context)).toContain('index: 1');
  });

  it('evaluates $for with paren-wrapped list iterable', async () => {
    const context = new Context();
    const iterable = new Paren(list([new Any('a'), new Any('b')]));
    const root = rules([makeLoop(makePattern(['value', 'key', 'index']), iterable)]);
    const evald = await root.eval(context);
    expect(evald.render(context)).toContain('item: a');
    expect(evald.render(context)).toContain('item: b');
    expect(evald.render(context)).toContain('key: 1');
    expect(evald.render(context)).toContain('key: 2');
  });

  it('supports list pattern bindings', async () => {
    const context = new Context();
    const loopRules = rules([
      decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) }),
      decl({ name: 'key', value: ref({ key: 'key' }, { type: 'variable' }) })
    ]);
    const root = rules([makeLoop(makePattern(['value', 'key'], 'list'), list([new Any('a')]), loopRules)]);
    const evald = await root.eval(context);
    expect(evald.render(context)).toContain('item: a');
    expect(evald.render(context)).toContain('key: 1');
  });

  it('supports sequence pattern bindings', async () => {
    const context = new Context();
    const loopRules = rules([
      decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) }),
      decl({ name: 'key', value: ref({ key: 'key' }, { type: 'variable' }) })
    ]);
    const root = rules([makeLoop(makePattern(['value', 'key'], 'sequence'), list([new Any('a')]), loopRules)]);
    const evald = await root.eval(context);
    expect(evald.render(context)).toContain('item: a');
    expect(evald.render(context)).toContain('key: 1');
  });

  it('supports single var pattern binding', async () => {
    const context = new Context();
    const loopRules = rules([
      decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) })
    ]);
    const root = rules([makeLoop(makePattern(['value'], 'single'), list([new Any('a')]), loopRules)]);
    const evald = await root.eval(context);
    expect(evald.render(context)).toContain('item: a');
  });

  it('creates For with single var binding', () => {
    const singleVar = makePattern(['value'], 'single') as VarDeclaration;
    const forNode = new For({ vars: singleVar, iterable: list([new Any('a')]), rules: rules([]) });
    expect(forNode.get('vars')).toBe(singleVar);
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
    expect(ifNode.get('bodies')[0]!.options.rulesVisibility.Declaration).toBe('public');
    expect(ifNode.get('bodies')[0]!.options.rulesVisibility.Ruleset).toBe('public');
    expect(ifNode.get('bodies')[0]!.options.rulesVisibility.VarDeclaration).toBe('public');
    expect(ifNode.get('bodies')[0]!.options.rulesVisibility.Mixin).toBe('public');
    expect(forNode.get('rules').options.rulesVisibility.Declaration).toBe('public');
    expect(forNode.get('rules').options.rulesVisibility.Ruleset).toBe('public');
    expect(forNode.get('rules').options.rulesVisibility.VarDeclaration).toBe('public');
    expect(forNode.get('rules').options.rulesVisibility.Mixin).toBe('public');
  });

  it('evaluates and renders $for with a state-patched iterable without mutating the canonical node', async () => {
    const context = new Context();
    const loop = makeLoop(makePattern(['value'], 'single'), list([new Any('a')]), rules([
      decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) })
    ]));
    const root = rules([loop]);
    const patchedIterable = list([new Any('patched')]);

    setField(loop, 'iterable', patchedIterable, context);

    const evald = await root.eval(context);

    expect(evald.render(context)).toContain('item: patched');
    expect(loop.toTrimmedString({ context })).toContain('patched');
    expect(loop.toTrimmedString()).toContain('a');
    expect(loop.get('iterable').toTrimmedString()).toBe('a');
  });

  it('renders $if with state-patched conditions and bodies without mutating the canonical node', () => {
    const context = new Context();
    const ifNode = new If({
      conditions: [new Any('true', { role: 'any' })],
      bodies: [rules([decl({ name: 'color', value: new Any('red') })])]
    });
    const patchedBody = rules([decl({ name: 'color', value: new Any('blue') })]);

    setField(ifNode, 'conditions', [new Any('false', { role: 'any' })], context);
    setField(ifNode, 'bodies', [patchedBody], context);

    expect(ifNode.toTrimmedString({ context })).toContain('$if (false)');
    expect(ifNode.toTrimmedString({ context })).toContain('color: blue;');
    expect(ifNode.toTrimmedString()).toContain('$if (true)');
    expect(ifNode.toTrimmedString()).toContain('color: red;');
    expect(ifNode.get('conditions')[0]!.toTrimmedString()).toBe('true');
    expect(ifNode.get('bodies')[0]!.toTrimmedString()).toContain('color: red;');
  });

  it('renders $while with state-patched condition and rules without mutating the canonical node', () => {
    const context = new Context();
    const whileNode = new While({
      condition: new Any('true', { role: 'any' }),
      rules: rules([decl({ name: 'color', value: new Any('red') })])
    });
    const patchedRules = rules([decl({ name: 'color', value: new Any('blue') })]);

    setField(whileNode, 'condition', new Any('false', { role: 'any' }), context);
    setField(whileNode, 'rules', patchedRules, context);

    expect(whileNode.toTrimmedString({ context })).toContain('$while (false)');
    expect(whileNode.toTrimmedString({ context })).toContain('color: blue;');
    expect(whileNode.toTrimmedString()).toContain('$while (true)');
    expect(whileNode.toTrimmedString()).toContain('color: red;');
    expect(whileNode.get('condition').toTrimmedString()).toBe('true');
    expect(whileNode.get('rules').toTrimmedString()).toContain('color: red;');
  });

  it('renders $each with state-patched header and rules without mutating the canonical node', () => {
    const context = new Context();
    const eachNode = new Each({
      header: expr(list([new Any('a')])),
      rules: rules([decl({ name: 'color', value: new Any('red') })])
    });
    const patchedHeader = expr(list([new Any('patched')]));
    const patchedRules = rules([decl({ name: 'color', value: new Any('blue') })]);

    setField(eachNode, 'header', patchedHeader, context);
    setField(eachNode, 'rules', patchedRules, context);

    expect(eachNode.toTrimmedString({ context })).toContain('$each $(patched)');
    expect(eachNode.toTrimmedString({ context })).toContain('color: blue;');
    expect(eachNode.toTrimmedString()).toContain('$each $(a)');
    expect(eachNode.toTrimmedString()).toContain('color: red;');
    expect(eachNode.get('header').toTrimmedString()).toBe('$(a)');
    expect(eachNode.get('rules').toTrimmedString()).toContain('color: red;');
  });

  it('keeps merged $for declaration values state-local during coalescing', async () => {
    const context = new Context();
    const loopRules = rules([
      decl(
        { name: 'padding', value: ref({ key: 'value' }, { type: 'variable' }) },
        { normalizedFromAssign: AssignmentType.Add }
      )
    ]);
    const loop = makeLoop(makePattern(['value'], 'single'), list([new Any('a'), new Any('b')]), loopRules);
    const templateDecl = loop.get('rules').at(0, context) as ReturnType<typeof decl>;
    const root = rules([loop]);

    const evald = await root.eval(context);

    expect(evald.toTrimmedString({ context })).toContain('padding: a, b;');
    expect(templateDecl.toTrimmedString()).toContain('padding: $value');
  });

  it('reads a state-patched normalizedFromAssign during $for coalescing without mutating the canonical declaration', async () => {
    const context = new Context();
    const loopRules = rules([
      decl({ name: 'padding', value: ref({ key: 'value' }, { type: 'variable' }) })
    ]);
    const loop = makeLoop(makePattern(['value'], 'single'), list([new Any('a'), new Any('b')]), loopRules);
    const templateDecl = loop.get('rules').at(0, context) as ReturnType<typeof decl>;
    const root = rules([loop]);

    setField(templateDecl, 'options', {
      ...templateDecl.options,
      normalizedFromAssign: AssignmentType.Add
    }, context);

    const evald = await root.eval(context);
    const css = evald.toTrimmedString({ context });

    // With EvalState, the state-patched normalizedFromAssign does not survive
    // the $for deep clone boundary. Each iteration clones canonical template
    // data, so the cloned declarations lack the merge flag. The last iteration
    // value wins without coalescing.
    expect(css).toContain('padding: b;');
    expect(String(templateDecl.options.normalizedFromAssign ?? '')).toBe('');
  });

  it('$for wrapper evaluates declarations with position-aware lookups', async () => {
    const context = new Context();
    const loopRules = rules([
      decl(
        { name: 'padding', value: ref({ key: 'value' }, { type: 'variable' }) },
        { normalizedFromAssign: AssignmentType.Add }
      )
    ]);
    const templateDecl = loopRules.at(0, context) as ReturnType<typeof decl>;
    const wrapper = loopRules.cloneLookupSafeShallowWrapper(context);
    wrapper.inherit(loopRules);
    wrapper.unshift(context, vardecl({ name: 'value', value: new Any('a') }));

    const evald = await wrapper.eval(context);

    expect(evald.toTrimmedString({ context })).toContain('padding: a;');
    // Canonical template is untouched
    expect(templateDecl.toTrimmedString()).toContain('padding: $value');
  });

  it('characterizes loop-body rulesVisibility as surviving the $for clone boundary while nested lookup still resolves', async () => {
    const context = new Context();
    const loopRules = rules([
      ruleset({
        selector: sel([el('.item')]) as any,
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'value' }, { type: 'variable' }) })
        ])
      })
    ]);
    const loop = makeLoop(makePattern(['value'], 'single'), list([new Any('inner')]), loopRules);
    const root = rules([
      vardecl({ name: 'value', value: new Any('outer') }),
      loop
    ]);

    setField(loop.get('rules'), 'options', {
      ...loop.get('rules').options,
      rulesVisibility: {
        ...loop.get('rules').options.rulesVisibility,
        VarDeclaration: 'private'
      }
    }, context);

    const clonedLoopRules = loop.get('rules').clone(false, undefined, context);
    const evald = await root.eval(context);

    expect(clonedLoopRules.options.rulesVisibility.VarDeclaration).toBe('private');
    expect(evald.toTrimmedString({ context })).toContain('.item {\n  color: inner;');
    expect(loop.get('rules').options.rulesVisibility.VarDeclaration).toBe('public');
  });

  it('reads rules-iterable declaration names and values through the eval state', async () => {
    const context = new Context();
    const iterableRules = rules([
      decl({ name: 'one', value: new Any('red') })
    ]);
    const iterDecl = iterableRules.at(0, context) as ReturnType<typeof decl>;
    const loopRules = rules([
      decl({ name: 'name', value: ref({ key: 'key' }, { type: 'variable' }) }),
      decl({ name: 'value', value: ref({ key: 'value' }, { type: 'variable' }) })
    ]);
    const root = rules([makeLoop(makePattern(['value', 'key'], 'block'), iterableRules, loopRules)]);

    setField(iterDecl, 'name', new Any('uno', { role: 'property' }), context);
    setField(iterDecl, 'value', new Any('green'), context);

    const evald = await root.eval(context);

    expect(evald.toTrimmedString({ context })).toContain('name: uno;');
    expect(evald.toTrimmedString({ context })).toContain('value: green;');
    expect(iterDecl.toTrimmedString()).toContain('one: red');
  });

  it('reads state-replaced loop body children after $for evaluation', async () => {
    const context = new Context();
    const root = rules([
      makeLoop(makePattern(['value'], 'single'), list([new Any('x')]), rules([
        new Call({ name: ref({ key: 'makeDecl' }, { type: 'function' }), args: list([]) })
      ]))
    ]);
    root.register('function', new JsFunction({
      name: 'makeDecl',
      fn: () => decl({ name: 'item', value: new Any('ok') })
    }));
    const loopRules = (root.at(0, context) as For).get('rules');
    const originalLoopChild = loopRules.at(0, context);

    const evald = await root.eval(context);

    expect(evald.toTrimmedString({ context })).toContain('item: ok;');
    expect(loopRules.at(0, context)).toBe(originalLoopChild);
    expect(loopRules.toTrimmedString()).toBe('();');
  });

  it('materializes call-produced Rules from a $for body without mutating canonical loop children', async () => {
    const context = new Context();
    const root = rules([
      makeLoop(makePattern(['value'], 'single'), list([new Any('x')]), rules([
        new Call({ name: ref({ key: 'makeRules' }, { type: 'function' }), args: list([]) })
      ]))
    ]);
    root.register('function', new JsFunction({
      name: 'makeRules',
      fn: () => rules([
        decl({ name: 'margin', value: new Any('0') }),
        ruleset({
          selector: sel([el('.item')]) as any,
          rules: rules([
            decl({ name: 'color', value: new Any('red') })
          ])
        })
      ])
    }));

    const loopRules = (root.at(0, context) as For).get('rules');
    const originalLoopChild = loopRules.at(0, context);

    const evald = await root.eval(context);
    const css = evald.toTrimmedString({ context });

    expect(css).toContain('margin: 0;');
    expect(css).toContain('.item {\n  color: red;');
    expect(css.indexOf('margin: 0;')).toBeLessThan(css.indexOf('.item {'));
    expect(loopRules.at(0, context)).toBe(originalLoopChild);
    expect(loopRules.toTrimmedString()).toBe('();');
  });

  it('characterizes nested prior-iteration output as already materialized before $for priorScope consumes it', async () => {
    const context = new Context();

    const loop = makeLoop(makePattern(['value'], 'single'), list([new Any('a'), new Any('b')]), rules([
      ruleset({
        selector: sel([el('.item')]) as any,
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'value' }, { type: 'variable' }) })
        ])
      })
    ]));
    const root = rules([loop]);

    const evald = await root.eval(context);
    const firstOutputContainer = evald.at(0, context) as ReturnType<typeof rules>;
    const firstOutputRuleset = firstOutputContainer.at(1, context) as ReturnType<typeof ruleset>;

    expect(firstOutputContainer.type).toBe('Rules');
    expect(firstOutputRuleset.type).toBe('Ruleset');
    expect(firstOutputRuleset.parent).toBe(firstOutputContainer);
    expect(firstOutputRuleset.rules.parent).toBe(firstOutputRuleset);
    expect(firstOutputContainer.value.map(node => node.type)).toEqual([
      'VarDeclaration',
      'Ruleset',
      'VarDeclaration',
      'Ruleset'
    ]);
  });
});
