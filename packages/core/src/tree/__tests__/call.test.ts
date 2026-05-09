import type { IToken } from 'chevrotain';
import { Any, Call, JsFunction, List, any, call, coll, decl, dimension, el, list, num, op, ref, rules, ruleset, vardecl } from '../index.js';
import { Context } from '../../context.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';
import { paren } from '../paren.js';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer } from '../util/render-buffer.js';

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

const token = (image: string, tokenTypeName = 'WS'): IToken => ({
  image,
  tokenType: { name: tokenTypeName } as IToken['tokenType'],
  startOffset: 0,
  endOffset: image.length - 1,
  startLine: 1,
  endLine: 1,
  startColumn: 1,
  endColumn: image.length
});

let context: Context;
describe('Call', () => {
  beforeEach(() => {
    context = new Context();
  });

  it('should serialize a CSS function', () => {
    let rule = call({
      name: 'rgb',
      args: list([num(100), num(100), num(100)])
    });
    expect(`${rule}`).toBe('rgb(100, 100, 100)');
    expect(Object.getOwnPropertyDescriptor(rule, '_options')?.value).toBeUndefined();
  });

  it('streams canonical function arguments without capture scaffolding', () => {
    const writer = new CountingWriter();
    const rule = call({
      name: 'rgb',
      args: list([num(100), num(100), num(100)])
    });

    expect(rule.toTrimmedString({ writer })).toBe('rgb(100, 100, 100)');
    expect(writer.captures).toBe(0);
  });

  it('serializes comment trivia owned by function argument separators', () => {
    const first = new Any('#333', undefined, [20, 1, 21, 23, 1, 24]);
    const second = new Any('#111', undefined, [40, 1, 41, 43, 1, 44]);
    const rule = new Call({
      name: 'linear-gradient',
      args: new List([first, second])
    });
    const tokens = [token(' '), token('/*{comment}*/', 'BlockComment')];
    const trivia = createTriviaMap({
      before: new Map([[38, tokens]]),
      after: new Map([[first.location[3], tokens]])
    }) satisfies TriviaMap;

    expect(rule.toString({ trivia })).toBe('linear-gradient(#333 /*{comment}*/, #111)');
  });

  it('should serialize an optional function lookup', () => {
    let rule = call({
      name: ref('rgb', { fallbackValue: true }),
      args: list([num(100), num(100), num(100)])
    });
    expect(`${rule}`).toBe('$rgb?(100, 100, 100)');
  });

  it('renders CSS calls through render(context)', () => {
    const rule = call({
      name: 'rgb',
      args: list([num(100), num(100), num(100)])
    });

    expect(rule.render(context)).toBe('rgb(100, 100, 100)');
    expect(rule.evaluated).toBe(false);
    expect(rule.preEvaluated).toBe(false);
  });

  it('writes call render output into flat buffers', async () => {
    const buffer = createRenderBuffer('flat');
    const rule = call({
      name: 'rgb',
      args: list([num(100), num(100), num(100)])
    });

    expect(await rule.render(context, buffer)).toBe('rgb(100, 100, 100)');
    expect(buffer.parts).toEqual(['rgb(100, 100, 100)']);
    expect(rule.evaluated).toBe(false);
    expect(rule.preEvaluated).toBe(false);
  });

  it('requires explicit segment handling for segmented buffers', () => {
    const buffer = createRenderBuffer('segmented');
    const rule = call({
      name: 'rgb',
      args: list([num(100), num(100), num(100)])
    });

    expect(() => rule.render(context, buffer)).toThrow(/segmented rendering/u);
  });

  it('streams rendered CSS call arguments without capture scaffolding', () => {
    const writer = new CountingWriter();
    const rule = call({
      name: 'rgb',
      args: list([num(100), num(100), num(100)])
    });

    expect(rule.render(context, { writer })).toBe('rgb(100, 100, 100)');
    expect(writer.toString()).toBe('rgb(100, 100, 100)');
    expect(writer.captures).toBe(0);
  });

  it('resolves CSS calls without touching render state', async () => {
    const rule = call({
      name: 'rgb',
      args: list([num(100), num(100), num(100)])
    });

    const resolved = await rule.resolve(context);

    expect(isNode(resolved, N.Call)).toBe(true);
    expect(resolved.toTrimmedString()).toBe('rgb(100, 100, 100)');
    expect(rule.evaluated).toBe(false);
    expect(rule.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('keeps source CSS call child containers canonical after resolve(context)', async () => {
    const root = rules([
      vardecl({
        name: any('channel'),
        value: num(20)
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const arg = list([
      num(10),
      ref({ key: 'channel' }, { type: 'variable' })
    ]);
    const rule = call({
      name: 'rgb',
      args: list([arg, num(30)])
    });
    const resolved = await rule.resolve(context);

    expect(resolved.toTrimmedString()).toBe('rgb(10, 20, 30)');
    expect(arg.toTrimmedString()).toBe('10, $channel');
    expect(rule.toTrimmedString()).toBe('rgb(10, $channel, 30)');
  });

  it('does not deep-clone empty plain CSS call args before resolve(context)', async () => {
    const originalClone = List.prototype.clone;
    let clonedLists = 0;
    List.prototype.clone = function cloneForCounting(this: List, ...args: Parameters<typeof originalClone>): ReturnType<typeof originalClone> {
      clonedLists++;
      return originalClone.apply(this, args);
    };

    try {
      const args = list([]);
      const rule = call({
        name: 'var',
        args
      });
      const resolved = await rule.resolve(context);

      expect(resolved.toTrimmedString()).toBe('var()');
      expect(clonedLists).toBe(0);
      expect(args.parent).toBe(rule);
    } finally {
      List.prototype.clone = originalClone;
    }
  });

  it('does not deep-clone non-empty plain CSS call args before resolve(context)', async () => {
    const originalClone = List.prototype.clone;
    let clonedLists = 0;
    List.prototype.clone = function cloneForCounting(this: List, ...args: Parameters<typeof originalClone>): ReturnType<typeof originalClone> {
      clonedLists++;
      return originalClone.apply(this, args);
    };

    try {
      const args = list([num(10), num(20), num(30)]);
      const rule = call({
        name: 'rgb',
        args
      });
      const resolved = await rule.resolve(context);

      expect(resolved.toTrimmedString()).toBe('rgb(10, 20, 30)');
      expect(clonedLists).toBe(0);
      expect(args.parent).toBe(rule);
      expect(rule.evaluated).toBe(false);
      expect(rule.preEvaluated).toBe(false);
    } finally {
      List.prototype.clone = originalClone;
    }
  });

  it('reduces safe direct arithmetic while preserving nested calc calls when rendering calc()', () => {
    const direct = call({
      name: 'calc',
      args: list([
        op([dimension([10, 'px']), '*', num(2)])
      ])
    });
    const nested = call({
      name: 'calc',
      args: list([
        op([
          dimension([10, 'vh']),
          '+',
          call({
            name: 'calc',
            args: list([dimension([5, 'vh'])])
          })
        ])
      ])
    });

    expect(direct.render(context)).toBe('calc(20px)');
    expect(nested.render(context)).toBe('calc(10vh + calc(5vh))');
  });

  it('keeps canonical function syntax separate from evaluated CSS-call normalization', () => {
    const rule = call({
      name: 'func',
      args: list([
        paren(list([any('a'), any('b')]), { escaped: true }),
        any('c')
      ], { sep: ';' })
    });

    expect(rule.toTrimmedString()).toBe('func(~(a, b); c)');
    expect(rule.render(context)).toBe('func((a, b), c)');
  });

  it('streams rendered escaped call arguments without capture scaffolding', () => {
    const writer = new CountingWriter();
    const rule = call({
      name: 'func',
      args: list([
        paren(list([any('a'), any('b')]), { escaped: true }),
        any('c')
      ], { sep: ';' })
    });

    expect(rule.render(context, { writer })).toBe('func((a, b), c)');
    expect(writer.toString()).toBe('func((a, b), c)');
    expect(writer.captures).toBe(0);
  });

  /** @todo */
  it('should serialize a mixin call', () => {
    let rule = call({
      name: ref('my-mixin', { type: 'mixin' }),
      args: list([num(100), num(100), num(100)])
    });
    expect(`${rule}`).toBe('$ > my-mixin(100, 100, 100)');
  });

  it('keeps detached collection calls on the collection surface', async () => {
    const root = rules([
      vardecl({ name: 'hoverColor', value: any('blue') }),
      vardecl({
        name: 'themeMap',
        value: coll([
          decl({ name: 'background-color', value: ref('hoverColor', { type: 'variable' }) })
        ])
      })
    ]);

    context.root = root;
    const evaldRoot = await root.eval(context);
    context.rulesContext = evaldRoot;

    const result = await call({ name: ref('themeMap', { type: 'variable' }) }).eval(context);
    expect(isNode(result, N.Collection)).toBe(true);
    expect(`${result}`).toContain('background-color');
  });

  it('marks declaration-only JS call output without call-site back-pointers', async () => {
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'decls',
      fn: () => rules([
        decl({ name: new Any('color', { role: 'property' }), value: any('red') })
      ])
    }));

    context.root = root;
    context.rulesContext = root;

    const result = await call({
      name: ref({ key: 'decls' }, { type: 'function' }),
      args: list([])
    }).eval(context);

    expect(isNode(result, N.Rules)).toBe(true);
    if (!isNode(result, N.Rules)) {
      throw new Error('Expected Rules result');
    }
    expect(Reflect.has(result, 'sourceParent')).toBe(false);
    expect(result.options.callDeclarationOutput).toBe(true);
  });

  it('does not copy empty positional JS function args', async () => {
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'empty',
      fn: () => any('ok')
    }));
    context.root = root;
    context.rulesContext = root;
    const originalCopy = List.prototype.copy;
    let copiedLists = 0;
    List.prototype.copy = function copyForCounting(this: List, ...args: Parameters<typeof originalCopy>): ReturnType<typeof originalCopy> {
      copiedLists++;
      return originalCopy.apply(this, args);
    };

    try {
      const result = await call({
        name: ref({ key: 'empty' }, { type: 'function' }),
        args: list([])
      }).eval(context);

      expect(result.toTrimmedString()).toBe('ok');
      expect(copiedLists).toBe(0);
    } finally {
      List.prototype.copy = originalCopy;
    }
  });

  it('does not let detached ruleset calls read caller scope in non-leaky mode', async () => {
    context = new Context({ leakyRules: false });
    const root = rules([
      vardecl({
        name: 'themeBlock',
        value: rules([
          decl({ name: 'color', value: ref('mode', { type: 'variable' }) })
        ])
      }),
      ruleset({
        selector: el('.use-theme'),
        rules: rules([
          vardecl({ name: 'mode', value: any('dark') }),
          call({ name: ref('themeBlock', { type: 'variable' }) })
        ])
      })
    ]);

    context.root = root;

    await expect(root.eval(context)).rejects.toThrow(/mode/);
  });

  it('lets detached ruleset calls read caller scope in leaky mode', async () => {
    context = new Context({ leakyRules: true });
    const root = rules([
      vardecl({
        name: 'themeBlock',
        value: rules([
          decl({ name: 'color', value: ref('mode', { type: 'variable' }) })
        ])
      }),
      ruleset({
        selector: el('.use-theme'),
        rules: rules([
          vardecl({ name: 'mode', value: any('dark') }),
          call({ name: ref('themeBlock', { type: 'variable' }) })
        ])
      })
    ]);

    context.root = root;

    const evald = await root.eval(context);
    expect(String(evald)).toContain('color: dark;');
  });

  // it('should serialize to a module', () => {
  //   let rule = call({
  //     name: 'rgb',
  //     value: list([num(100), num(100), num(100)])
  //   })
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.call({\n  name: "rgb",\n  value: $J.list([\n    $J.num({\n      value: 100,\n      unit: ""\n    }),\n    $J.num({\n      value: 100,\n      unit: ""\n    }),\n    $J.num({\n      value: 100,\n      unit: ""\n    })\n  ]),\n  ref: () => rgb,\n})'
  //   )
  // })
});
