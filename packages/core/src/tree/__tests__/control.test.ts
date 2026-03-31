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

  it('proves one loop iteration allocates one runtime key over a canonical template', async () => {
    const context = new Context();
    const loop = makeLoop(
      makePattern(['value'], 'single'),
      list([new Any('a')]),
      rules([decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) })])
    );

    const canonicalBody = loop.get('rules');
    const templateDecl = canonicalBody.at(0, context) as ReturnType<typeof decl>;
    const root = rules([loop]);
    const evald = await root.eval(context);
    const css = evald.render(context);

    expect(css).toContain('item: a;');
    expect(context.renderCounter).toBe(1);
    expect(canonicalBody.toTrimmedString()).toContain('item: $value;');
    expect(templateDecl.get('value').toTrimmedString()).toBe('$value');
    expect(canonicalBody.renderKey).toBeDefined();
  });

  it('proves three loop iterations allocate three runtime keys over one canonical template', async () => {
    const context = new Context();
    const loop = makeLoop(
      makePattern(['value'], 'single'),
      list([new Any('a'), new Any('b'), new Any('c')]),
      rules([decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) })])
    );

    const canonicalBody = loop.get('rules');
    const templateDecl = canonicalBody.at(0, context) as ReturnType<typeof decl>;
    const root = rules([loop]);
    const evald = await root.eval(context);
    const css = evald.render(context);

    expect(css).toContain('item: a;');
    expect(css).toContain('item: b;');
    expect(css).toContain('item: c;');
    expect(css.indexOf('item: a;')).toBeLessThan(css.indexOf('item: b;'));
    expect(css.indexOf('item: b;')).toBeLessThan(css.indexOf('item: c;'));
    expect(context.renderCounter).toBe(3);
    expect(canonicalBody.toTrimmedString()).toContain('item: $value;');
    expect(templateDecl.get('value').toTrimmedString()).toBe('$value');
  });

  it('proves short nested loop output can keep outer and inner iteration paths distinct', async () => {
    const context = new Context();
    const innerLoop = makeLoop(
      makePattern(['inner'], 'single'),
      list([new Any('1'), new Any('2')]),
      rules([
        decl({ name: 'outer', value: ref({ key: 'outer' }, { type: 'variable' }) }),
        decl({ name: 'inner', value: ref({ key: 'inner' }, { type: 'variable' }) })
      ])
    );
    const outerLoop = makeLoop(
      makePattern(['outer'], 'single'),
      list([new Any('a'), new Any('b')]),
      rules([innerLoop])
    );
    const root = rules([outerLoop]);

    const evald = await root.eval(context);
    const css = evald.render(context);

    expect(css).toContain('outer: a;');
    expect(css).toContain('outer: b;');
    expect(css).toContain('inner: 1;');
    expect(css).toContain('inner: 2;');
    expect(context.renderCounter).toBe(6);
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

  it('evaluates and renders a cloned $for with a replaced iterable without mutating the canonical node', async () => {
    const context = new Context();
    const loop = makeLoop(makePattern(['value'], 'single'), list([new Any('a')]), rules([
      decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) })
    ]));
    const patchedIterable = list([new Any('patched')]);
    const clonedLoop = loop.clone() as For;

    clonedLoop.adopt(patchedIterable, context);
    (clonedLoop as unknown as { iterable: List }).iterable = patchedIterable;

    const evald = await clonedLoop.eval(context);

    expect(evald.render(context)).toContain('item: patched');
    expect(loop.toTrimmedString()).toContain('a');
    expect(loop.get('iterable').toTrimmedString()).toBe('a');
    expect(clonedLoop.get('iterable').toTrimmedString()).toBe('patched');
  });

  it('renders a cloned $if with replaced conditions and bodies without mutating the canonical node', () => {
    const context = new Context();
    const ifNode = new If({
      conditions: [new Any('true', { role: 'any' })],
      bodies: [rules([decl({ name: 'color', value: new Any('red') })])]
    });
    const clonedIf = ifNode.clone() as If;
    const patchedCondition = new Any('false', { role: 'any' });
    const patchedBody = rules([decl({ name: 'color', value: new Any('blue') })]);

    clonedIf.adopt(patchedCondition, context);
    clonedIf.adopt(patchedBody, context);
    (clonedIf as unknown as { conditions: Any[] }).conditions = [patchedCondition];
    (clonedIf as unknown as { bodies: ReturnType<typeof rules>[] }).bodies = [patchedBody];

    expect(clonedIf.toTrimmedString({ context })).toContain('$if (false)');
    expect(clonedIf.toTrimmedString({ context })).toContain('color: blue;');
    expect(ifNode.toTrimmedString()).toContain('$if (true)');
    expect(ifNode.toTrimmedString()).toContain('color: red;');
    expect(ifNode.get('conditions')[0]!.toTrimmedString()).toBe('true');
    expect(ifNode.get('bodies')[0]!.toTrimmedString()).toContain('color: red;');
  });

  it('renders a cloned $while with replaced condition and rules without mutating the canonical node', () => {
    const context = new Context();
    const whileNode = new While({
      condition: new Any('true', { role: 'any' }),
      rules: rules([decl({ name: 'color', value: new Any('red') })])
    });
    const clonedWhile = whileNode.clone() as While;
    const patchedCondition = new Any('false', { role: 'any' });
    const patchedRules = rules([decl({ name: 'color', value: new Any('blue') })]);

    clonedWhile.adopt(patchedCondition, context);
    clonedWhile.adopt(patchedRules, context);
    (clonedWhile as unknown as { condition: Any }).condition = patchedCondition;
    (clonedWhile as unknown as { rules: ReturnType<typeof rules> }).rules = patchedRules;

    expect(clonedWhile.toTrimmedString({ context })).toContain('$while (false)');
    expect(clonedWhile.toTrimmedString({ context })).toContain('color: blue;');
    expect(whileNode.toTrimmedString()).toContain('$while (true)');
    expect(whileNode.toTrimmedString()).toContain('color: red;');
    expect(whileNode.get('condition').toTrimmedString()).toBe('true');
    expect(whileNode.get('rules').toTrimmedString()).toContain('color: red;');
  });

  it('renders a cloned $each with replaced header and rules without mutating the canonical node', () => {
    const context = new Context();
    const eachNode = new Each({
      header: expr(list([new Any('a')])),
      rules: rules([decl({ name: 'color', value: new Any('red') })])
    });
    const clonedEach = eachNode.clone() as Each;
    const patchedHeader = expr(list([new Any('patched')]));
    const patchedRules = rules([decl({ name: 'color', value: new Any('blue') })]);

    clonedEach.adopt(patchedHeader, context);
    clonedEach.adopt(patchedRules, context);
    (clonedEach as unknown as { header: ReturnType<typeof expr> }).header = patchedHeader;
    (clonedEach as unknown as { rules: ReturnType<typeof rules> }).rules = patchedRules;

    expect(clonedEach.toTrimmedString({ context })).toContain('$each $(patched)');
    expect(clonedEach.toTrimmedString({ context })).toContain('color: blue;');
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

  it('reads a cloned normalizedFromAssign during $for coalescing without mutating the canonical declaration', async () => {
    const context = new Context();
    const loopRules = rules([
      decl({ name: 'padding', value: ref({ key: 'value' }, { type: 'variable' }) })
    ]);
    const loop = makeLoop(makePattern(['value'], 'single'), list([new Any('a'), new Any('b')]), loopRules);
    const templateDecl = loop.get('rules').at(0, context) as ReturnType<typeof decl>;
    const clonedLoop = loop.clone(true) as For;
    const clonedTemplateDecl = clonedLoop.get('rules').at(0, context) as ReturnType<typeof decl>;

    clonedTemplateDecl.options = {
      ...clonedTemplateDecl.options,
      normalizedFromAssign: AssignmentType.Add
    };

    const evald = await clonedLoop.eval(context);
    const css = evald.toTrimmedString({ context });

    expect(css).toContain('padding: a, b;');
    expect(String(templateDecl.options.normalizedFromAssign ?? '')).toBe('');
  });

  it('reads cloned rules-iterable declaration names and values during $for evaluation without mutating the canonical iterable', async () => {
    const context = new Context();
    const iterableRules = rules([
      decl({ name: 'one', value: new Any('red') })
    ]);
    const iterDecl = iterableRules.at(0, context) as ReturnType<typeof decl>;
    const loopRules = rules([
      decl({ name: 'name', value: ref({ key: 'key' }, { type: 'variable' }) }),
      decl({ name: 'value', value: ref({ key: 'value' }, { type: 'variable' }) })
    ]);
    const loop = makeLoop(makePattern(['value', 'key'], 'block'), iterableRules, loopRules);
    const clonedLoop = loop.clone(true) as For;
    const clonedIterDecl = (clonedLoop.get('iterable') as ReturnType<typeof rules>).at(0, context) as ReturnType<typeof decl>;

    const patchedName = new Any('uno', { role: 'property' });
    const patchedValue = new Any('green');
    clonedIterDecl.adopt(patchedName, context);
    clonedIterDecl.adopt(patchedValue, context);
    (clonedIterDecl as unknown as { name: Any }).name = patchedName;
    (clonedIterDecl as unknown as { value: Any }).value = patchedValue;

    const evald = await clonedLoop.eval(context);

    expect(evald.toTrimmedString({ context })).toContain('name: uno;');
    expect(evald.toTrimmedString({ context })).toContain('value: green;');
    expect(iterDecl.toTrimmedString()).toContain('one: red');
  });
});
