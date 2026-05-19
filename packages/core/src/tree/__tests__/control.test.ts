import {
  Any,
  Block,
  Call,
  For,
  If,
  INTERPOLATION_PLACEHOLDER,
  JsFunction,
  List,
  Nil,
  Rules,
  Sequence,
  VarDeclaration,
  While,
  any,
  bool,
  call,
  condition,
  decl,
  expr,
  interpolated,
  list,
  el,
  mixin,
  ref,
  rules,
  ruleset,
  sel,
  num,
  op,
  vardecl
} from '../index.js';
import { Context } from '../../context.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer, renderNodeToString } from '../util/render-buffer.js';

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

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
  if (pattern instanceof Block && pattern.value instanceof List) {
    const values = pattern.value.value.filter((entry): entry is VarDeclaration => entry instanceof VarDeclaration);
    const [first, ...rest] = values;
    if (!first) {
      throw new Error('Expected at least one binding in block pattern');
    }
    return { kind: 'tuple' as const, values: [first, ...rest] };
  }
  if (isPatternNodeTuple(pattern)) {
    const values = pattern.value.filter((entry): entry is VarDeclaration => entry instanceof VarDeclaration);
    const [first, ...rest] = values;
    if (!first) {
      throw new Error('Expected at least one binding in tuple pattern');
    }
    return values.length === 1
      ? { kind: 'single' as const, value: first }
      : { kind: 'tuple' as const, values: [first, ...rest] };
  }
  throw new Error('Unexpected test pattern shape');
}

describe('Control Nodes', () => {
  it('serializes $if source syntax through toTrimmedString()', () => {
    const node = new If({
      branches: [
        {
          condition: bool(true),
          rules: rules([decl({ name: 'color', value: any('red') })])
        },
        {
          rules: rules([decl({ name: 'color', value: any('blue') })])
        }
      ]
    });

    expect(node.toTrimmedString()).toBeString(`
      $if (true) {
        color: red;
      } $else {
        color: blue;
      }
    `);
  });

  it('keeps legacy direct $if render(context) on source syntax', () => {
    const context = new Context();
    const node = new If({
      branches: [
        {
          condition: bool(true),
          rules: rules([decl({ name: 'color', value: any('red') })])
        },
        {
          rules: rules([decl({ name: 'color', value: any('blue') })])
        }
      ]
    });

    expect(node.render(context)).toBeString(`
      $if (true) {
        color: red;
      } $else {
        color: blue;
      }
    `);
    expect(context.printState.writer?.toString()).toBeString(`
      $if (true) {
        color: red;
      } $else {
        color: blue;
      }
    `);
  });

  it('keeps direct $if resolve(context) on source syntax without eval stamping', () => {
    const context = new Context();
    const node = new If({
      branches: [
        {
          condition: bool(true),
          rules: rules([decl({ name: 'color', value: any('red') })])
        },
        {
          rules: rules([decl({ name: 'color', value: any('blue') })])
        }
      ]
    });

    const resolved = node.resolve(context);

    expect(resolved).toBe(node);
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('writes evaluated $if output into render buffers without public resolve/eval wrapper', async () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    const node = new If({
      branches: [
        {
          condition: bool(false),
          rules: rules([decl({ name: 'color', value: any('red') })])
        },
        {
          condition: bool(true),
          rules: rules([decl({ name: 'color', value: any('blue') })])
        },
        {
          rules: rules([decl({ name: 'color', value: any('green') })])
        }
      ]
    });
    node.resolve = () => {
      throw new Error('$if buffer render should use evalNode');
    };
    node.evalNode = () => {
      throw new Error('$if buffer render should evaluate the selected branch directly');
    };

    await expect(node.render(context, buffer)).resolves.toBe('color: blue;');
    expect(buffer.parts).toEqual(['color: blue;']);
  });

  it('evaluates $if output through root render', async () => {
    const context = new Context();
    const root = rules([
      new If({
        branches: [
          {
            condition: bool(false),
            rules: rules([decl({ name: 'color', value: any('red') })])
          },
          {
            rules: rules([decl({ name: 'color', value: any('green') })])
          }
        ]
      })
    ]);

    await expect(renderNodeToString(root, context)).resolves.toBe('color: green;\n');
  });

  it('evaluates nested control blocks inside ruleset render', async () => {
    const context = new Context();
    let whileCalls = 0;
    const root = rules([
      ruleset({
        selector: sel([el('.a')]),
        rules: rules([
          new If({
            branches: [
              {
                condition: bool(true),
                rules: rules([decl({ name: 'color', value: any('red') })])
              }
            ]
          }),
          makeLoop(
            makePattern(['value'], 'single'),
            list([new Any('10px'), new Any('20px')]),
            rules([decl({ name: 'width', value: ref({ key: 'value' }, { type: 'variable' }) })])
          ),
          new While({
            condition: call({
              name: new JsFunction({
                name: 'keep-going',
                fn: () => bool(++whileCalls <= 2)
              }),
              args: list([])
            }),
            rules: rules([decl({ name: 'height', value: any('1px') })])
          })
        ])
      })
    ]);

    await expect(renderNodeToString(root, context)).resolves.toBeString(`
      .a {
        color: red;
        width: 10px;
        width: 20px;
        height: 1px;
        height: 1px;
      }
    `);
    expect(whileCalls).toBe(3);
  });

  it('serializes $for source syntax through toTrimmedString()', () => {
    const node = makeLoop(
      makePattern(['value'], 'single'),
      list([any('a'), any('b')]),
      rules([decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) })])
    );

    expect(node.toTrimmedString()).toBeString(`
      $for ($value of a, b) {
        item: $value;
      }
    `);
  });

  it('streams $for range bounds without capture scaffolding', () => {
    const singlePattern = makePattern(['value'], 'single');
    if (!(singlePattern instanceof VarDeclaration)) {
      throw new Error('Expected single var pattern');
    }
    const writer = new CountingWriter();
    const node = new For({
      pattern: { kind: 'single', value: singlePattern },
      iterable: {
        kind: 'range',
        start: any('1'),
        end: any('5'),
        step: any('2'),
        includeStart: true,
        includeEnd: false
      },
      rules: rules([])
    });

    expect(node.toTrimmedString({ writer })).toContain('$for ($value of 1 to <5 step 2)');
    expect(writer.captures).toBe(0);
  });

  it('keeps legacy direct $for render(context) on source syntax', () => {
    const context = new Context();
    const node = makeLoop(
      makePattern(['value'], 'single'),
      list([any('a'), any('b')]),
      rules([decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) })])
    );

    expect(node.render(context)).toBeString(`
      $for ($value of a, b) {
        item: $value;
      }
    `);
    expect(context.printState.writer?.toString()).toBeString(`
      $for ($value of a, b) {
        item: $value;
      }
    `);
  });

  it('resolves $for output without touching render state', async () => {
    const context = new Context();
    const node = makeLoop(
      makePattern(['value'], 'single'),
      list([any('a'), any('b')]),
      rules([decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) })])
    );

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toContain('item: a');
    expect(resolved.toTrimmedString()).toContain('item: b');
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('writes evaluated $for output into render buffers without public resolve/eval wrapper', async () => {
    const context = new Context();
    const buffer = createRenderBuffer('segmented');
    const node = makeLoop(
      makePattern(['value'], 'single'),
      list([any('a'), any('b')]),
      rules([decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) })])
    );
    const originalResolve = node.resolve;
    let resolveCalls = 0;
    node.resolve = function countResolveCalls(
      this: typeof node,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };
    node.evalNode = () => {
      throw new Error('$for buffer render should stream iterations');
    };

    const rendered = await node.render(context, buffer);

    expect(rendered).toContain('item: a');
    expect(rendered).toContain('item: b');
    expect(buffer.segments.join('')).toBe(rendered);
    expect(resolveCalls).toBe(0);
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
  });

  it('serializes $while source syntax through toTrimmedString()', () => {
    const node = new While({
      condition: bool(true),
      rules: rules([decl({ name: 'color', value: any('red') })])
    });

    expect(node.toTrimmedString()).toBeString(`
      $while (true) {
        color: red;
      }
    `);
  });

  it('keeps direct $while render(context) on source syntax', () => {
    const context = new Context();
    const node = new While({
      condition: bool(true),
      rules: rules([decl({ name: 'color', value: any('red') })])
    });

    expect(node.render(context)).toBeString(`
      $while (true) {
        color: red;
      }
    `);
    expect(context.printState.writer?.toString()).toBeString(`
      $while (true) {
        color: red;
      }
    `);
  });

  it('resolves false $while output without touching render state', async () => {
    const context = new Context();
    const node = new While({
      condition: bool(false),
      rules: rules([decl({ name: 'color', value: any('red') })])
    });

    const resolved = await node.resolve(context);

    expect(resolved).toBeInstanceOf(Rules);
    expect(resolved.toTrimmedString()).toBe('');
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('evaluates repeated $while body output through root render', async () => {
    const context = new Context();
    let calls = 0;
    const root = rules([
      new While({
        condition: call({
          name: new JsFunction({
            name: 'keep-going',
            fn: () => bool(++calls <= 2)
          }),
          args: list([])
        }),
        rules: rules([decl({ name: 'color', value: any('red') })])
      })
    ]);

    await expect(Promise.resolve(renderNodeToString(root, context))).resolves.toBeString(`
      color: red;
      color: red;
    `);
    expect(calls).toBe(3);
  });

  it('lets $while body mutation advance the next condition', async () => {
    const context = new Context();
    const root = rules([
      vardecl({ name: 'i', value: num(0) }),
      new While({
        condition: condition([
          ref({ key: 'i' }, { type: 'variable' }),
          '<',
          num(3)
        ]),
        rules: rules([
          vardecl({
            name: 'i',
            value: op([
              ref({ key: 'i' }, { type: 'variable' }),
              '+',
              num(1)
            ])
          }),
          decl({ name: 'tick', value: any('yes') })
        ])
      })
    ]);

    await expect(Promise.resolve(renderNodeToString(root, context))).resolves.toBeString(`
      tick: yes;
      tick: yes;
      tick: yes;
    `);
  });

  it('restores rulesContext when $while streaming throws', async () => {
    const context = new Context();
    const scope = rules([]);
    const buffer = createRenderBuffer('flat');
    const node = new While({
      condition: bool(true),
      rules: rules([
        decl({
          name: 'color',
          value: call({
            name: new JsFunction({
              name: 'explode',
              fn: () => {
                throw new Error('boom');
              }
            }),
            args: list([])
          })
        })
      ])
    });
    context.rulesContext = scope;

    await expect(Promise.resolve(node.render(context, buffer))).rejects.toThrow('boom');
    expect(context.rulesContext).toBe(scope);
  });

  it('writes evaluated $while output into render buffers without public resolve/eval wrapper', async () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    let calls = 0;
    const node = new While({
      condition: call({
        name: new JsFunction({
          name: 'keep-going',
          fn: () => bool(++calls <= 2)
        }),
        args: list([])
      }),
      rules: rules([decl({ name: 'color', value: any('red') })])
    });
    node.resolve = () => {
      throw new Error('$while buffer render should use evalNode');
    };
    node.evalNode = () => {
      throw new Error('$while buffer render should stream iterations');
    };

    await expect(Promise.resolve(node.render(context, buffer))).resolves.toBeString(`
      color: red;
      color: red;
    `);
    expect(buffer.parts.join('')).toBeString(`
      color: red;
      color: red;
    `);
    expect(calls).toBe(3);
  });

  it('throws when $while exceeds its iteration guard', async () => {
    const context = new Context();
    const root = rules([
      new While({
        condition: bool(true),
        rules: rules([decl({ name: 'color', value: any('red') })])
      })
    ]);

    await expect(Promise.resolve().then(() => renderNodeToString(root, context))).rejects.toThrow('$while exceeded 10000 iterations');
  });

  it('adopts $while condition and rules as children', () => {
    const condition = bool(true);
    const body = rules([decl({ name: 'color', value: any('red') })]);
    const node = new While({
      condition,
      rules: body
    });

    expect(condition.parent).toBe(node);
    expect(body.parent).toBe(node);
  });

  it('evaluates $for with block pattern + expression iterable', async () => {
    const context = new Context();
    const pattern = makePattern(['value', 'key', 'index'], 'block');
    const iterable = expr(list([new Any('a'), new Any('b')]));
    const root = rules([makeLoop(pattern, iterable)]);
    const css = await renderNodeToString(root, context);
    expect(css).toContain('item: a');
    expect(css).toContain('item: b');
    expect(css).toContain('key: 1');
    expect(css).toContain('key: 2');
    expect(css).toContain('index: 1');
    expect(css).toContain('index: 2');
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
    const css = await renderNodeToString(root, context);
    expect(css).toContain('item: x');
    expect(css).toContain('item: y');
    expect(css).toContain('key: 1');
    expect(css).toContain('key: 2');
  });

  it('evaluates $for with rules iterable and skips non-declarations', async () => {
    const context = new Context();
    const iterableRules = rules([
      decl({ name: 'one', value: new Any('red') }),
      ruleset({
        selector: sel([el('.skip')]),
        rules: rules([decl({ name: 'x', value: new Any('nope') })])
      }),
      decl({ name: 'two', value: new Any('blue') })
    ]);
    const loopRules = rules([
      decl({ name: 'name', value: ref({ key: 'key' }, { type: 'variable' }) }),
      decl({ name: 'value', value: ref({ key: 'value' }, { type: 'variable' }) })
    ]);
    const root = rules([makeLoop(makePattern(['value', 'key'], 'block'), iterableRules, loopRules)]);
    const css = await renderNodeToString(root, context);
    expect(css).toContain('name: one');
    expect(css).toContain('name: two');
    expect(css).toContain('value: red');
    expect(css).toContain('value: blue');
    expect(css).not.toContain('nope');
  });

  it('evaluates $for with scalar fallback iterable', async () => {
    const context = new Context();
    const root = rules([makeLoop(makePattern(['value', 'key', 'index']), new Any('solo'))]);
    const css = await renderNodeToString(root, context);
    expect(css).toContain('item: solo');
    expect(css).toContain('key: 1');
    expect(css).toContain('index: 1');
  });

  it('supports list pattern bindings', async () => {
    const context = new Context();
    const loopRules = rules([
      decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) }),
      decl({ name: 'key', value: ref({ key: 'key' }, { type: 'variable' }) })
    ]);
    const root = rules([makeLoop(makePattern(['value', 'key'], 'list'), list([new Any('a')]), loopRules)]);
    const css = await renderNodeToString(root, context);
    expect(css).toContain('item: a');
    expect(css).toContain('key: 1');
  });

  it('supports sequence pattern bindings', async () => {
    const context = new Context();
    const loopRules = rules([
      decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) }),
      decl({ name: 'key', value: ref({ key: 'key' }, { type: 'variable' }) })
    ]);
    const root = rules([makeLoop(makePattern(['value', 'key'], 'sequence'), list([new Any('a')]), loopRules)]);
    const css = await renderNodeToString(root, context);
    expect(css).toContain('item: a');
    expect(css).toContain('key: 1');
  });

  it('supports single var pattern binding', async () => {
    const context = new Context();
    const loopRules = rules([
      decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) })
    ]);
    const root = rules([makeLoop(makePattern(['value'], 'single'), list([new Any('a')]), loopRules)]);
    const css = await renderNodeToString(root, context);
    expect(css).toContain('item: a');
  });

  it('derives zero-iteration $for output from the canonical loop body wrapper', async () => {
    const context = new Context();
    const loopRules = rules([
      decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) })
    ]);
    const root = rules([makeLoop(makePattern(['value'], 'single'), list([]), loopRules)]);

    const evald = await root.eval(context);
    const loopOutput = evald.at(0);

    expect(loopOutput).toBeInstanceOf(Rules);
    if (!(loopOutput instanceof Rules)) {
      throw new Error('Expected loop output to be Rules');
    }
    expect(loopOutput).not.toBe(loopRules);
    expect(loopOutput.value).toEqual([]);
    expect(loopOutput.scopeFrame).toBeUndefined();
    expect(await renderNodeToString(root, new Context())).toBe('');
  });

  it('does not shallow-clone loop body children to create zero-iteration output wrappers', async () => {
    const context = new Context();
    const originalClone = Rules.prototype.clone;
    let shallowMarkerBodyClones = 0;
    Rules.prototype.clone = function cloneForCounting(
      this: Rules,
      ...args: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      const [deep] = args;
      if (
        deep === false
        && this.value.some(node => (
          node.type === 'Declaration'
          && node.value?.name?.valueOf?.() === 'marker'
        ))
      ) {
        shallowMarkerBodyClones++;
      }
      return originalClone.apply(this, args);
    };

    try {
      const loopRules = rules([
        decl({ name: 'marker', value: ref({ key: 'value' }, { type: 'variable' }) })
      ]);
      const root = rules([makeLoop(makePattern(['value'], 'single'), list([]), loopRules)]);

      const css = await renderNodeToString(root, context);

      expect(css).toBe('');
      expect(shallowMarkerBodyClones).toBe(0);
    } finally {
      Rules.prototype.clone = originalClone;
    }
  });

  it('collapses single-iteration $for output without an extra Rules wrapper', async () => {
    const context = new Context();
    const loopRules = rules([
      decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) })
    ]);
    const root = rules([makeLoop(makePattern(['value'], 'single'), list([new Any('a')]), loopRules)]);

    const evald = await root.eval(context);
    const loopOutput = evald.at(0);
    const firstChild = loopOutput instanceof Rules ? loopOutput.value[0] : undefined;

    expect(loopOutput).toBeInstanceOf(Rules);
    if (!(loopOutput instanceof Rules)) {
      throw new Error('Expected loop output to be Rules');
    }
    expect(loopOutput.scopeFrame).toBeUndefined();
    expect(firstChild).not.toBeInstanceOf(Rules);
    expect(await renderNodeToString(root, new Context())).toContain('item: a');
  });

  it('builds $for iteration eval surfaces without calling Rules.clone()', async () => {
    const context = new Context();
    const originalClone = Rules.prototype.clone;
    let clonedLoopRules = 0;
    Rules.prototype.clone = function cloneForCounting(
      this: Rules,
      ...args: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      if (this.value.some(node => (
        node.type === 'Declaration'
        && node.value?.name?.valueOf?.() === 'item'
      ))) {
        clonedLoopRules++;
      }
      return originalClone.apply(this, args);
    };

    try {
      const itemDecl = decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) });
      const loopRules = rules([
        itemDecl
      ]);
      const root = rules([makeLoop(makePattern(['value'], 'single'), list([new Any('a')]), loopRules)]);

      const css = await renderNodeToString(root, context);

      expect(css).toContain('item: a');
      expect(clonedLoopRules).toBe(0);
      expect(itemDecl.parent).toBe(loopRules);
    } finally {
      Rules.prototype.clone = originalClone;
    }
  });

  it('derives multi-iteration $for output from the canonical loop body wrapper', async () => {
    const context = new Context();
    const loopRules = rules([
      decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) })
    ]);
    const root = rules([makeLoop(makePattern(['value'], 'single'), list([new Any('a'), new Any('b')]), loopRules)]);

    const evald = await root.eval(context);
    const loopOutput = evald.at(0);

    expect(loopOutput).toBeInstanceOf(Rules);
    if (!(loopOutput instanceof Rules)) {
      throw new Error('Expected loop output to be Rules');
    }
    expect(loopOutput).not.toBe(loopRules);
    expect(loopOutput.value).toHaveLength(2);
    expect(loopOutput.scopeFrame).toBeUndefined();
    const css = await renderNodeToString(root, new Context());
    expect(css).toContain('item: a');
    expect(css).toContain('item: b');
  });

  it('resolves $for iteration vars via ScopeFrame live slots without declaration lookup', async () => {
    const context = new Context();
    const registryHits: string[] = [];
    const originalFind = Rules.prototype.find;
    Rules.prototype.find = function(...args: Parameters<typeof originalFind>) {
      const [type, key] = args;
      if (
        type === 'declaration'
        && typeof key === 'string'
        && (key === 'value' || key === 'key' || key === 'index')
      ) {
        registryHits.push(key);
      }
      return originalFind.apply(this, args);
    };

    try {
      const root = rules([makeLoop(makePattern(['value', 'key', 'index']), list([new Any('a'), new Any('b')]))]);
      const css = await renderNodeToString(root, context);
      expect(css).toContain('item: a');
      expect(css).toContain('item: b');
      expect(registryHits).toEqual([]);
    } finally {
      Rules.prototype.find = originalFind;
    }
  });

  it('keeps canonical $for body children parented to the source wrapper', async () => {
    const context = new Context();
    const itemDecl = decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) });
    const loopRules = rules([itemDecl]);
    const root = rules([makeLoop(makePattern(['value'], 'single'), list([new Any('a'), new Any('b')]), loopRules)]);

    const css = await renderNodeToString(root, context);

    expect(css).toContain('item: a');
    expect(css).toContain('item: b');
    expect(itemDecl.parent).toBe(loopRules);
  });

  it('reuses childless source-free scalar leaves in $for per-iteration body copies', async () => {
    const context = new Context();
    const originalClone = Any.prototype.clone;
    let scalarClones = 0;
    Any.prototype.clone = function cloneForCounting(
      this: Any,
      ...args: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      if (this.valueOf() === 'red') {
        scalarClones++;
      }
      return originalClone.apply(this, args);
    };

    try {
      const loopRules = rules([
        decl({ name: 'color', value: any('red') }),
        decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) })
      ]);
      const root = rules([makeLoop(makePattern(['value'], 'single'), list([new Any('a'), new Any('b')]), loopRules)]);
      const css = await renderNodeToString(root, context);

      expect(css).toContain('color: red');
      expect(css).toContain('item: a');
      expect(css).toContain('item: b');
      expect(scalarClones).toBe(0);
    } finally {
      Any.prototype.clone = originalClone;
    }
  });

  it('binds source-free scalar $for values without copying or cloning them first', async () => {
    const context = new Context();
    const originalCopy = Any.prototype.copy;
    const originalClone = Any.prototype.clone;
    let scalarCopies = 0;
    let scalarClones = 0;
    Any.prototype.copy = function copyForCounting(
      this: Any,
      ...args: Parameters<typeof originalCopy>
    ): ReturnType<typeof originalCopy> {
      if (this.valueOf() === 'a' || this.valueOf() === 'b') {
        scalarCopies++;
      }
      return originalCopy.apply(this, args);
    };
    Any.prototype.clone = function cloneForCounting(
      this: Any,
      ...args: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      if (this.valueOf() === 'a' || this.valueOf() === 'b') {
        scalarClones++;
      }
      return originalClone.apply(this, args);
    };

    try {
      const loopRules = rules([
        decl({ name: 'item', value: ref({ key: 'value' }, { type: 'variable' }) })
      ]);
      const root = rules([makeLoop(makePattern(['value'], 'single'), list([new Any('a'), new Any('b')]), loopRules)]);
      const css = await renderNodeToString(root, context);

      expect(css).toContain('item: a');
      expect(css).toContain('item: b');
      expect(scalarCopies).toBe(0);
      expect(scalarClones).toBe(0);
    } finally {
      Any.prototype.copy = originalCopy;
      Any.prototype.clone = originalClone;
    }
  });

  it('forces public rulesVisibility for $if, $for, and $while rules', () => {
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
    const singlePattern = makePattern(['value'], 'single');
    if (!(singlePattern instanceof VarDeclaration)) {
      throw new Error('Expected single var pattern');
    }
    const forNode = new For({
      pattern: { kind: 'single', value: singlePattern },
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
    const whileNode = new While({
      condition: new Any('true', { role: 'any' }),
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
    expect(whileNode.value.rules.options.rulesVisibility.Declaration).toBe('public');
    expect(whileNode.value.rules.options.rulesVisibility.Ruleset).toBe('public');
    expect(whileNode.value.rules.options.rulesVisibility.VarDeclaration).toBe('public');
    expect(whileNode.value.rules.options.rulesVisibility.Mixin).toBe('public');
  });

  it('keeps nested eval state isolated across mixin calls and $for iterations', async () => {
    const context = new Context({
      leakyRules: true
    });

    const loopRules = rules([
      decl({
        name: interpolated({
          source: `${INTERPOLATION_PLACEHOLDER}-${INTERPOLATION_PLACEHOLDER}`,
          replacements: [
            ref({ key: 'prefix' }, { type: 'variable' }),
            ref({ key: 'index' }, { type: 'variable' })
          ]
        }, { role: 'property' }),
        value: ref({ key: 'value' }, { type: 'variable' })
      })
    ]);

    const loopMixin = mixin({
      name: any('.loop'),
      params: list([
        any('prefix', { role: 'property' })
      ]),
      rules: rules([
        new For({
          pattern: {
            kind: 'tuple',
            values: [
              new VarDeclaration({
                name: new Any('value', { role: 'property' }),
                value: new Nil()
              }, { paramVar: true }),
              new VarDeclaration({
                name: new Any('key', { role: 'property' }),
                value: new Nil()
              }, { paramVar: true }),
              new VarDeclaration({
                name: new Any('index', { role: 'property' }),
                value: new Nil()
              }, { paramVar: true })
            ]
          },
          iterable: {
            kind: 'node',
            value: list([new Any('one'), new Any('two')])
          },
          rules: loopRules
        })
      ])
    });

    const root = rules([
      loopMixin,
      ruleset({
        selector: sel([el('.a')]),
        rules: rules([
          call({
            name: ref({ key: '.loop' }, { type: 'mixin' }),
            args: list([new Any('a')])
          })
        ])
      }),
      ruleset({
        selector: sel([el('.b')]),
        rules: rules([
          call({
            name: ref({ key: '.loop' }, { type: 'mixin' }),
            args: list([new Any('b')])
          })
        ])
      })
    ]);
    context.root = root;

    const css = await renderNodeToString(root, context);

    expect(css).toBeString(`
      .a {
        a-1: one;
        a-2: two;
      }
      .b {
        b-1: one;
        b-2: two;
      }
    `);
  });
});
