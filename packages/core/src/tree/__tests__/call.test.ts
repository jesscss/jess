import type { IToken } from 'chevrotain';
import { Any, Call, JsFunction, List, Reference, Rules, Sequence, any, call, coll, decl, dimension, el, list, num, op, ref, rules, ruleset, seq, vardecl } from '../index.js';
import { Context } from '../../context.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';
import { paren } from '../paren.js';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer, renderNodeToString } from '../util/render-buffer.js';
import { defineFunction } from '../../define-function.js';

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

class AsyncAny extends Any<string> {
  override eval() {
    return Promise.resolve(any(this.value));
  }
}

class AsyncRenderedAny extends Any<string> {
  constructor(value: string, private readonly renderedValue: string) {
    super(value);
  }

  override eval() {
    return Promise.resolve(any(this.renderedValue));
  }
}

class RejectingAny extends Any<string> {
  override eval() {
    return Promise.reject(new Error(this.value));
  }
}

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
    expect(rule.toTrimmedString()).toBe('rgb(100, 100, 100)');
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
    expect(rule.toTrimmedString()).toBe('$rgb?(100, 100, 100)');
  });

  it('renders CSS calls through render(context)', () => {
    const rule = call({
      name: 'rgb',
      args: list([num(100), num(100), num(100)])
    });

    expect(rule.render(context)).toBe('rgb(100, 100, 100)');
    expect(rule.evaluated).toBe(false);
    expect(rule.registrationPrepared).toBe(false);
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
    expect(rule.registrationPrepared).toBe(false);
  });

  it('writes call render output into buffers without mutating a provided writer', async () => {
    const buffer = createRenderBuffer('flat');
    const writer = new CountingWriter();
    const rule = call({
      name: 'rgb',
      args: list([num(100), num(100), num(100)])
    });

    expect(await rule.render(context, buffer, { writer })).toBe('rgb(100, 100, 100)');
    expect(buffer.parts).toEqual(['rgb(100, 100, 100)']);
    expect(writer.toString()).toBe('');
    expect(writer.captures).toBe(0);
  });

  it('writes CSS call arguments without resolving child wrappers', async () => {
    const root = rules([
      vardecl({
        name: any('red-channel'),
        value: num(100)
      })
    ]);
    const evald = await root.eval(context);
    if (!(evald instanceof Rules)) {
      throw new TypeError('Expected Rules root');
    }
    context.root = evald;
    context.rulesContext = evald;
    const buffer = createRenderBuffer('flat');
    const arg = ref({ key: 'red-channel' }, { type: 'variable' });
    const rule = call({
      name: 'rgb',
      args: list([arg, num(100), num(100)])
    });
    const originalResolve = arg.resolve;
    let argResolveCalls = 0;
    arg.resolve = function countResolveCalls(
      this: typeof arg,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      argResolveCalls++;
      return originalResolve.apply(this, args);
    };

    expect(await rule.render(context, buffer)).toBe('rgb(100, 100, 100)');
    expect(buffer.parts).toEqual(['rgb(100, 100, 100)']);
    expect(argResolveCalls).toBe(0);
    expect(rule.evaluated).toBe(false);
    expect(rule.registrationPrepared).toBe(false);
  });

  it('writes async CSS call arguments into flat buffers', async () => {
    const buffer = createRenderBuffer('flat');
    const arg = new AsyncAny('20');
    const rule = call({
      name: 'rgb',
      args: list([num(10), arg, num(30)])
    });

    expect(await rule.render(context, buffer)).toBe('rgb(10, 20, 30)');
    expect(buffer.parts).toEqual(['rgb(10, 20, 30)']);
    expect(arg.parent).toBe(rule.value.args);
    expect(rule.evaluated).toBe(false);
    expect(rule.registrationPrepared).toBe(false);
  });

  it('renders async CSS call arguments directly without public resolve', async () => {
    const arg = new AsyncAny('20');
    const rule = call({
      name: 'rgb',
      args: list([num(10), arg, num(30)])
    });
    rule.resolve = () => {
      throw new Error('Call direct async arg render should stream plain CSS call');
    };

    await expect(Promise.resolve(rule.render(context))).resolves.toBe('rgb(10, 20, 30)');
    expect(arg.parent).toBe(rule.value.args);
    expect(rule.evaluated).toBe(false);
    expect(rule.registrationPrepared).toBe(false);
  });

  it('writes async CSS call content into flat buffers', async () => {
    const buffer = createRenderBuffer('flat');
    const content = new AsyncAny('body-output');
    const rule = call({
      name: 'wrap',
      args: list([]),
      contentNode: content
    });

    expect(await rule.render(context, buffer)).toBe('wrap(): body-output');
    expect(buffer.parts).toEqual(['wrap(): body-output']);
    expect(content.parent).toBe(rule);
    expect(rule.evaluated).toBe(false);
    expect(rule.registrationPrepared).toBe(false);
  });

  it('renders async CSS call content directly without public resolve', async () => {
    const content = new AsyncAny('body-output');
    const rule = call({
      name: 'wrap',
      args: list([]),
      contentNode: content
    });
    rule.resolve = () => {
      throw new Error('Call direct async content render should stream plain CSS call');
    };

    await expect(Promise.resolve(rule.render(context))).resolves.toBe('wrap(): body-output');
    expect(content.parent).toBe(rule);
    expect(rule.evaluated).toBe(false);
    expect(rule.registrationPrepared).toBe(false);
  });

  it('restores calc render frames when async CSS call argument rendering rejects', async () => {
    const buffer = createRenderBuffer('flat');
    const rule = call({
      name: 'calc',
      args: list([new RejectingAny('bad arg')])
    });

    await expect(rule.render(context, buffer)).rejects.toThrow('bad arg');
    expect(context.calcFrames).toBe(0);
  });

  it('awaits async calc arguments during direct render', async () => {
    const rule = call({
      name: 'calc',
      args: list([new AsyncRenderedAny('source', '20px')])
    });

    await expect(Promise.resolve(rule.render(context))).resolves.toBe('calc(20px)');
    expect(context.calcFrames).toBe(0);
  });

  it('writes resolved non-string call render output into flat buffers', async () => {
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'empty',
      fn: () => any('ok')
    }));
    context.root = root;
    context.rulesContext = root;
    const buffer = createRenderBuffer('flat');
    const rule = call({
      name: ref({ key: 'empty' }, { type: 'function' }),
      args: list([])
    });
    const originalResolve = rule.resolve;
    let resolveCalls = 0;
    rule.resolve = function countResolveCalls(
      this: typeof rule,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };

    expect(await rule.render(context, buffer)).toBe('ok');
    expect(buffer.parts).toEqual(['ok']);
    expect(resolveCalls).toBe(0);
    expect(rule.evaluated).toBe(false);
    expect(rule.registrationPrepared).toBe(false);
  });

  it('renders resolved non-string call output directly without public resolve', async () => {
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'empty',
      fn: () => any('ok')
    }));
    context.root = root;
    context.rulesContext = root;
    const rule = call({
      name: ref({ key: 'empty' }, { type: 'function' }),
      args: list([])
    });
    rule.resolve = () => {
      throw new Error('Call direct dynamic render should evaluate derived surface');
    };

    await expect(Promise.resolve(rule.render(context))).resolves.toBe('ok');
    expect(rule.evaluated).toBe(false);
    expect(rule.registrationPrepared).toBe(false);
  });

  it('writes finalized CSS call output into segmented buffers', () => {
    const buffer = createRenderBuffer('segmented');
    const rule = call({
      name: 'rgb',
      args: list([num(100), num(100), num(100)])
    });

    expect(rule.render(context, buffer)).toBe('rgb(100, 100, 100)');
    expect(buffer.segments).toEqual(['rgb(100, 100, 100)']);
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
    expect(rule.registrationPrepared).toBe(false);
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
      expect(rule.registrationPrepared).toBe(false);
    } finally {
      List.prototype.clone = originalClone;
    }
  });

  it('reduces safe direct arithmetic while preserving nested calc calls when rendering calc()', async () => {
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
    await expect(Promise.resolve(nested.render(context))).resolves.toBe('calc(10vh + calc(5vh))');
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
    expect(rule.toTrimmedString()).toBe('$ > my-mixin(100, 100, 100)');
  });

  it('keeps detached collection calls on the collection surface', async () => {
    const originalClone = Rules.prototype.clone;
    let collectionClones = 0;

    Rules.prototype.clone = function cloneForCounting(
      this: Rules,
      ...args: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      const [deep] = args;
      if (deep === false && isNode(this, N.Collection)) {
        collectionClones++;
      }
      return originalClone.apply(this, args);
    };

    try {
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
      expect(result.toTrimmedString()).toContain('background-color');
      expect(collectionClones).toBe(0);
    } finally {
      Rules.prototype.clone = originalClone;
    }
  });

  it('derives preserve-rules-like variable call names without cloning the source reference', async () => {
    const root = rules([
      vardecl({
        name: 'themeBlock',
        value: rules([
          decl({ name: 'color', value: any('blue') })
        ])
      })
    ]);

    context.root = root;
    const evaldRoot = await root.eval(context);
    context.rulesContext = evaldRoot;

    const originalClone = Reference.prototype.clone;
    let clonedReferences = 0;
    Reference.prototype.clone = function cloneForCounting(
      this: Reference,
      ...cloneArgs: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      clonedReferences++;
      return originalClone.apply(this, cloneArgs);
    };

    try {
      const name = ref('themeBlock', { type: 'variable' });
      const rule = call({ name });
      const result = await rule.eval(context);

      expect(isNode(result, N.Rules)).toBe(true);
      expect(result.toTrimmedString()).toContain('color: blue');
      expect(clonedReferences).toBe(0);
      expect(name.parent).toBe(rule);
    } finally {
      Reference.prototype.clone = originalClone;
    }
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

  it('does not clone childless source-free scalar leaves when copying positional JS function args', async () => {
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'echo',
      fn: (value: Any) => any(value.valueOf() === 'red' ? 'ok' : 'bad')
    }));
    context.root = root;
    context.rulesContext = root;
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
      const result = await call({
        name: ref({ key: 'echo' }, { type: 'function' }),
        args: list([any('red')])
      }).eval(context);

      expect(result.toTrimmedString()).toBe('ok');
      expect(scalarClones).toBe(0);
    } finally {
      Any.prototype.clone = originalClone;
    }
  });

  it('passes plain positional JS function containers without copying them', async () => {
    let received: Sequence | undefined;
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'echo',
      fn: (value: Sequence) => {
        received = value;
        return any(value.value[0]?.valueOf() === 'red' ? 'ok' : 'bad');
      }
    }));
    context.root = root;
    context.rulesContext = root;

    const originalValue = seq([any('red'), dimension(10, 'px')]);
    const originalArgs = list([originalValue]);
    const rule = call({
      name: ref({ key: 'echo' }, { type: 'function' }),
      args: originalArgs
    });
    const result = await rule.eval(context);

    expect(result.toTrimmedString()).toBe('ok');
    expect(received).toBe(originalValue);
    expect(originalValue.parent).toBe(originalArgs);
    expect(originalArgs.parent).toBe(rule);
  });

  it('does not clone childless source-free scalar leaves for callback arg lists', async () => {
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'first',
      fn: defineFunction(
        'first',
        async function(this: { rawArgs: List }) {
          return any(this.rawArgs.value[0]?.valueOf() === 'red' ? 'ok' : 'bad');
        },
        { params: [{ name: 'value', type: Any }] }
      )
    }));
    context.root = root;
    context.rulesContext = root;
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
      const result = await call({
        name: ref({ key: 'first' }, { type: 'function' }),
        args: list([any('red')])
      }).eval(context);

      expect(result.toTrimmedString()).toBe('ok');
      expect(scalarClones).toBe(0);
    } finally {
      Any.prototype.clone = originalClone;
    }
  });

  it('uses one owned argument surface for metadata JS function calls', async () => {
    class CountingSequence extends Sequence {
      static countConstructions = false;
      static constructedCopies = 0;

      constructor(...args: ConstructorParameters<typeof Sequence>) {
        super(...args);
        if (CountingSequence.countConstructions) {
          CountingSequence.constructedCopies++;
        }
      }
    }

    let rawArg: Node | undefined;
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'first',
      fn: defineFunction(
        'first',
        async function(this: { rawArgs: List }) {
          rawArg = this.rawArgs.value[0];
          return any(rawArg instanceof Sequence ? 'ok' : 'bad');
        },
        { params: [{ name: 'value', type: Sequence }] }
      )
    }));
    context.root = root;
    context.rulesContext = root;

    const originalValue = new CountingSequence([any('red'), dimension(10, 'px')]);
    const originalArgs = list([originalValue]);
    const rule = call({
      name: ref({ key: 'first' }, { type: 'function' }),
      args: originalArgs
    });

    CountingSequence.countConstructions = true;
    try {
      const result = await rule.eval(context);

      expect(result.toTrimmedString()).toBe('ok');
      expect(CountingSequence.constructedCopies).toBe(1);
      expect(rawArg).not.toBe(originalValue);
      expect(rawArg?.parent?.parent).toBe(rule);
      expect(originalValue.parent).toBe(originalArgs);
      expect(originalArgs.parent).toBe(rule);
    } finally {
      CountingSequence.countConstructions = false;
      CountingSequence.constructedCopies = 0;
    }
  });

  it('does not clone childless source-free scalar leaves before resolving referenced JS function calls', async () => {
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'echo',
      fn: (value: Any) => any(value.valueOf() === 'red' ? 'ok' : 'bad')
    }));
    context.root = root;
    context.rulesContext = root;
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
      const originalArgs = list([any('red')]);
      const rule = call({
        name: ref({ key: 'echo' }, { type: 'function' }),
        args: originalArgs
      });
      const result = await rule.resolve(context);

      expect(result.toTrimmedString()).toBe('ok');
      expect(scalarClones).toBe(0);
      expect(originalArgs.parent).toBe(rule);
      expect(rule.evaluated).toBe(false);
    } finally {
      Any.prototype.clone = originalClone;
    }
  });

  it('does not clone source-free scalar leaves in nested args before resolving referenced JS function calls', async () => {
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'echo',
      fn: defineFunction(
        'echo',
        async function(this: { rawArgs: List }) {
          const value = this.rawArgs.value[0];
          return any(isNode(value, N.Sequence) && value.value[0]?.valueOf() === 'red' ? 'ok' : 'bad');
        },
        { params: [{ name: 'value', type: Sequence }] }
      )
    }));
    context.root = root;
    context.rulesContext = root;
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
      const originalValue = seq([any('red'), dimension(10, 'px')]);
      const originalArgs = list([originalValue]);
      const rule = call({
        name: ref({ key: 'echo' }, { type: 'function' }),
        args: originalArgs
      });
      const result = await rule.resolve(context);

      expect(result.toTrimmedString()).toBe('ok');
      expect(scalarClones).toBe(0);
      expect(originalValue.parent).toBe(originalArgs);
      expect(originalArgs.parent).toBe(rule);
    } finally {
      Any.prototype.clone = originalClone;
    }
  });

  it('derives referenced JS function calls without reconstructing the source call', async () => {
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'echo',
      fn: (value: Any) => any(value.valueOf() === 'red' ? 'ok' : 'bad')
    }));
    context.root = root;
    context.rulesContext = root;

    class CountingCall extends Call {
      static countConstructions = false;
      static constructedCopies = 0;

      constructor(...args: ConstructorParameters<typeof Call>) {
        super(...args);
        if (CountingCall.countConstructions) {
          CountingCall.constructedCopies++;
        }
      }
    }

    const originalArgs = list([any('red')]);
    const rule = new CountingCall({
      name: ref({ key: 'echo' }, { type: 'function' }),
      args: originalArgs
    });

    CountingCall.countConstructions = true;
    try {
      const result = await rule.resolve(context);

      expect(result.toTrimmedString()).toBe('ok');
      expect(CountingCall.constructedCopies).toBe(0);
      expect(originalArgs.parent).toBe(rule);
    } finally {
      CountingCall.countConstructions = false;
    }
  });

  it('keeps source fallback call args canonical when optional function evaluation falls back', async () => {
    const originalClone = Call.prototype.clone;
    let clonedCalls = 0;
    Call.prototype.clone = function cloneForCounting(
      this: Call,
      ...cloneArgs: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      clonedCalls++;
      return originalClone.apply(this, cloneArgs);
    };

    const args = list([seq([any('red'), dimension([10, 'px'])])]);
    const originalArg = args.value[0]!;
    const rule = call({
      name: ref({ key: 'missing-fn' }, { type: 'function', fallbackValue: true }),
      args
    }, { silentFail: true });

    try {
      const resolved = await rule.eval(context);

      expect(isNode(resolved, N.Call)).toBe(true);
      expect(resolved.toTrimmedString()).toBe('missing-fn(red 10px)');
      expect(clonedCalls).toBe(0);
      expect(args.parent).toBe(rule);
      expect(originalArg.parent).toBe(args);
    } finally {
      Call.prototype.clone = originalClone;
    }
  });

  it('derives optional JS failure call output without shallow-cloning the source call', async () => {
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'bad',
      fn: () => {
        throw new Error('bad function');
      },
      allowOptional: true
    }));
    context.root = root;
    context.rulesContext = root;
    const originalClone = Call.prototype.clone;
    let clonedCalls = 0;
    Call.prototype.clone = function cloneForCounting(
      this: Call,
      ...cloneArgs: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      clonedCalls++;
      return originalClone.apply(this, cloneArgs);
    };

    try {
      const args = list([seq([any('red'), dimension([10, 'px'])])]);
      const originalArg = args.value[0]!;
      const rule = call({
        name: ref({ key: 'bad' }, { type: 'function', fallbackValue: true }),
        args
      }, { silentFail: true });
      const resolved = await rule.eval(context);

      expect(isNode(resolved, N.Call)).toBe(true);
      expect(resolved.toTrimmedString()).toBe('bad(red 10px)');
      expect(clonedCalls).toBe(0);
      expect(args.parent).toBe(rule);
      expect(originalArg.parent).toBe(args);
    } finally {
      Call.prototype.clone = originalClone;
    }
  });

  it('does not clone childless source-free scalar leaves before resolving callback arg lists', async () => {
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'first',
      fn: defineFunction(
        'first',
        async function(this: { rawArgs: List }) {
          return any(this.rawArgs.value[0]?.valueOf() === 'red' ? 'ok' : 'bad');
        },
        { params: [{ name: 'value', type: Any }] }
      )
    }));
    context.root = root;
    context.rulesContext = root;
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
      const originalArgs = list([any('red')]);
      const rule = call({
        name: ref({ key: 'first' }, { type: 'function' }),
        args: originalArgs
      });
      const result = await rule.resolve(context);

      expect(result.toTrimmedString()).toBe('ok');
      expect(scalarClones).toBe(0);
      expect(originalArgs.parent).toBe(rule);
    } finally {
      Any.prototype.clone = originalClone;
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

    const css = await renderNodeToString(root, context, { context });
    expect(css).toContain('color: dark;');
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
