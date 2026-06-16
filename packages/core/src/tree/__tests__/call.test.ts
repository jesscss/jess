import type { IToken } from 'chevrotain';
import * as treeIndex from '../index.js';
import { Any, Call, F_MAY_ASYNC, F_NON_STATIC, JsFunction, List, Reference, Rules, Sequence, any, call, coll, decl, dimension, el, fn, list, mixin, num, op, ref, rules, ruleset, seq, vardecl } from '../index.js';
import {
  getCallRawArgDiagnosticMessageSource,
  getCallRawArgDiagnosticSource,
  getCallRawArgSourceNode,
  getCallRawArgsPlacement
} from '../call.js';
import { Context } from '../../context.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';
import { paren } from '../paren.js';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer, renderNodeToString } from '../util/render-buffer.js';
import { defineFunction } from '../../define-function.js';
import { MixinCollection } from '../util/callable-collection.js';

class CountingWriter extends OutputWriter {
  captures = 0;
  marks = 0;
  readbacks = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }

  override mark(): number {
    this.marks++;
    return super.mark();
  }

  override getSince(mark: number): string {
    this.readbacks++;
    return super.getSince(mark);
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
  constructor(value: string) {
    super(value);
    this.addFlag(F_MAY_ASYNC);
  }

  override eval() {
    return Promise.resolve(any(this.value));
  }
}

class AsyncRenderedAny extends Any<string> {
  constructor(value: string, private readonly renderedValue: string) {
    super(value);
    this.addFlag(F_MAY_ASYNC);
  }

  override eval() {
    return Promise.resolve(any(this.renderedValue));
  }
}

class RejectingAny extends Any<string> {
  constructor(value: string) {
    super(value);
    this.addFlag(F_MAY_ASYNC);
  }

  override eval() {
    return Promise.reject(new Error(this.value));
  }
}

class ThrowingAny extends Any<string> {
  override eval() {
    throw new Error(this.value);
  }
}

function countDeriveCallUse(): { readonly count: number; restore(): void } {
  const descriptor = Object.getOwnPropertyDescriptor(Call.prototype, 'deriveCall');
  const original = descriptor?.value;
  if (!descriptor || typeof original !== 'function') {
    return {
      count: 0,
      restore() {}
    };
  }
  let count = 0;
  Object.defineProperty(Call.prototype, 'deriveCall', {
    ...descriptor,
    value: function deriveCallForCounting(this: Call, ...args: unknown[]) {
      count++;
      return Reflect.apply(original, this, args);
    }
  });
  return {
    get count() {
      return count;
    },
    restore() {
      Object.defineProperty(Call.prototype, 'deriveCall', descriptor);
    }
  };
}

function countEvalStateUse(): { readonly count: number; restore(): void } {
  const descriptor = Object.getOwnPropertyDescriptor(Call.prototype, 'evalState');
  const original = descriptor?.value;
  if (!descriptor || typeof original !== 'function') {
    return {
      count: 0,
      restore() {}
    };
  }
  let count = 0;
  Object.defineProperty(Call.prototype, 'evalState', {
    ...descriptor,
    value: function evalStateForCounting(this: Call, ...args: unknown[]) {
      count++;
      return original.apply(this, args);
    }
  });
  return {
    get count() {
      return count;
    },
    restore() {
      Object.defineProperty(Call.prototype, 'evalState', descriptor);
    }
  };
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
    expect(writer.marks).toBe(1);
    expect(writer.readbacks).toBe(1);
  });

  it('serializes token CSS call arguments without source arg-list trim marks', () => {
    const writer = new CountingWriter();
    const rule = call({
      name: 'var',
      args: list([any('--brand'), any('red')])
    });

    expect(rule.toTrimmedString({ writer })).toBe('var(--brand, red)');
    expect(writer.toString()).toBe('var(--brand, red)');
    expect(writer.marks).toBe(1);
    expect(writer.readbacks).toBe(1);
  });

  it('serializes empty CSS calls without writer readback scaffolding', () => {
    const writer = new CountingWriter();
    const rule = call({ name: 'button' });

    expect(rule.toTrimmedString({ writer })).toBe('button()');
    expect(writer.toString()).toBe('button()');
    expect(writer.marks).toBe(0);
    expect(writer.readbacks).toBe(0);
  });

  it('serializes empty optional-important CSS calls without writer readback scaffolding', () => {
    const writer = new CountingWriter();
    const rule = call({ name: 'missing' }, { silentFail: true, markImportant: true });

    expect(rule.toTrimmedString({ writer })).toBe('missing?() !important');
    expect(writer.toString()).toBe('missing?() !important');
    expect(writer.marks).toBe(0);
    expect(writer.readbacks).toBe(0);
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

  it('does not re-export optional fallback call syntax helper', () => {
    expect('createOptionalFallbackCallSyntaxState' in treeIndex).toBe(false);
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

  it('renders empty CSS calls without writer readback scaffolding', () => {
    const writer = new CountingWriter();
    const rule = call({ name: 'button' }, { silentFail: true, markImportant: true });

    expect(rule.render(context, { writer })).toBe('button?() !important');
    expect(writer.toString()).toBe('button?() !important');
    expect(writer.marks).toBe(0);
    expect(writer.readbacks).toBe(0);
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

  it('writes CSS call render output into shared flat buffers without nested call marks', async () => {
    const buffer = createRenderBuffer('flat');
    buffer.shareWriter = true;
    const writer = new CountingWriter(false, buffer.parts);
    context.printState.writer = writer;
    const rule = call({
      name: 'rgb',
      args: list([num(100), num(100), num(100)])
    });

    expect(await rule.render(context, buffer)).toBe('rgb(100, 100, 100)');
    expect(buffer.parts).toEqual(['rgb', '(', '100', ', ', '100', ', ', '100', ')']);
    expect(writer.marks).toBe(1);
    expect(writer.readbacks).toBe(0);
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

  it('writes empty CSS call render output into buffers without writer readback scaffolding', () => {
    const buffer = createRenderBuffer('flat');
    const writer = new CountingWriter();
    const rule = call({ name: 'button' });

    expect(rule.render(context, buffer, { writer })).toBe('button()');
    expect(buffer.parts).toEqual(['button()']);
    expect(writer.toString()).toBe('');
    expect(writer.marks).toBe(0);
    expect(writer.readbacks).toBe(0);
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

  it('renders dynamic CSS call names without evaluating the name twice', async () => {
    const name = any('source-name');
    const renderedName = any('rgb');
    let renderedNamePublicStringCalls = 0;
    renderedName.toTrimmedString = () => {
      renderedNamePublicStringCalls++;
      return 'wrong-name';
    };
    let nameEvaluations = 0;
    name.eval = function evalForCounting() {
      nameEvaluations++;
      return renderedName;
    };
    const rule = call({
      name,
      args: list([num(100), num(100), num(100)])
    });

    await expect(Promise.resolve(rule.render(context))).resolves.toBe('rgb(100, 100, 100)');
    expect(nameEvaluations).toBe(1);
    expect(renderedNamePublicStringCalls).toBe(0);
    expect(rule.evaluated).toBe(false);
    expect(rule.registrationPrepared).toBe(false);
  });

  it('renders evaluated CSS call arguments without public string transport', async () => {
    const arg = any('source');
    const renderedArg = any('20');
    let renderedArgPublicStringCalls = 0;
    renderedArg.toTrimmedString = () => {
      renderedArgPublicStringCalls++;
      return 'wrong-arg';
    };
    arg.eval = function evalForArgTransport() {
      return renderedArg;
    };
    const rule = call({
      name: 'rgb',
      args: list([num(10), arg, num(30)])
    });

    await expect(Promise.resolve(rule.render(context))).resolves.toBe('rgb(10, 20, 30)');
    expect(renderedArgPublicStringCalls).toBe(0);
    expect(rule.evaluated).toBe(false);
    expect(rule.registrationPrepared).toBe(false);
  });

  it('renders evaluated escaped call arguments without public string transport', async () => {
    const inner = any('source');
    const renderedInner = any('a, b');
    let renderedInnerPublicStringCalls = 0;
    renderedInner.toTrimmedString = () => {
      renderedInnerPublicStringCalls++;
      return 'wrong-inner';
    };
    inner.eval = function evalForEscapedArgTransport() {
      return renderedInner;
    };
    const rule = call({
      name: 'func',
      args: list([paren(inner, { escaped: true })])
    });

    await expect(Promise.resolve(rule.render(context))).resolves.toBe('func((a, b))');
    expect(renderedInnerPublicStringCalls).toBe(0);
    expect(rule.evaluated).toBe(false);
    expect(rule.registrationPrepared).toBe(false);
  });

  it('renders evaluated CSS call content without public string transport', async () => {
    const content = any('source-content');
    const renderedContent = any('body-output');
    let renderedContentPublicStringCalls = 0;
    renderedContent.toTrimmedString = () => {
      renderedContentPublicStringCalls++;
      return 'wrong-content';
    };
    content.eval = function evalForContentTransport() {
      return renderedContent;
    };
    const rule = call({
      name: 'wrap',
      contentNode: content
    });

    await expect(Promise.resolve(rule.render(context))).resolves.toBe('wrap(): body-output');
    expect(renderedContentPublicStringCalls).toBe(0);
    expect(rule.evaluated).toBe(false);
    expect(rule.registrationPrepared).toBe(false);
  });

  it('renders dynamic calc names through one name eval with calc frames', async () => {
    const name = any('source-name');
    let nameEvaluations = 0;
    name.eval = function evalForCounting() {
      nameEvaluations++;
      return any('calc');
    };
    const rule = call({
      name,
      args: list([
        op([dimension([10, 'px']), '*', num(2)])
      ])
    });

    await expect(Promise.resolve(rule.render(context))).resolves.toBe('calc(20px)');
    expect(nameEvaluations).toBe(1);
    expect(context.calcFrames).toBe(0);
    expect(rule.evaluated).toBe(false);
    expect(rule.registrationPrepared).toBe(false);
  });

  it('renders dynamic stylesheet function names without evaluating the name twice', async () => {
    const fnNode = fn({
      name: any('make-color'),
      body: rules([
        decl({ name: 'return', value: any('blue') })
      ])
    });
    const root = rules([fnNode]);
    context.root = root;
    context.rulesContext = root;
    const name = any('source-name');
    let nameEvaluations = 0;
    name.eval = function evalForCounting() {
      nameEvaluations++;
      return fnNode;
    };
    const rule = call({
      name,
      args: list([])
    });

    await expect(Promise.resolve(rule.render(context))).resolves.toBe('blue');
    expect(nameEvaluations).toBe(1);
    expect(rule.evaluated).toBe(false);
    expect(rule.registrationPrepared).toBe(false);
  });

  it('passes stylesheet function args through the callable binding surface once', async () => {
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

    const fnNode = fn({
      name: any('inspect'),
      params: list([
        vardecl({ name: 'value', value: any('') })
      ]),
      body: rules([
        decl({ name: 'return', value: ref('value', { type: 'variable' }) })
      ])
    });
    const root = rules([fnNode]);
    context.root = root;
    context.rulesContext = root;
    const name = any('source-name');
    name.eval = function evalForFunctionName() {
      return fnNode;
    };
    const originalArg = new CountingSequence([any('red'), dimension([10, 'px'])]);
    const originalArgs = list([originalArg]);
    const rule = call({
      name,
      args: originalArgs
    });

    CountingSequence.countConstructions = true;
    try {
      const result = await rule.eval(context);

      expect(result.toTrimmedString()).toBe('red 10px');
      expect(CountingSequence.constructedCopies).toBe(1);
      expect(originalArg.parent).toBe(originalArgs);
      expect(originalArgs.parent).toBe(rule);
    } finally {
      CountingSequence.countConstructions = false;
      CountingSequence.constructedCopies = 0;
    }
  });

  it('renders dynamic mixin names without calling public eval state', async () => {
    const mixinDef = mixin({
      name: any('.theme'),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });
    const root = rules([mixinDef]);
    context.root = root;
    context.rulesContext = root;
    const name = any('source-name');
    name.eval = function evalForMixinName() {
      return mixinDef;
    };
    const rule = call({ name });
    const evalStateCalls = countEvalStateUse();

    try {
      const rendered = await Promise.resolve(rule.render(context));

      expect(rendered).toContain('color: red');
      expect(evalStateCalls.count).toBe(0);
      expect(rule.evaluated).toBe(false);
      expect(rule.registrationPrepared).toBe(false);
    } finally {
      evalStateCalls.restore();
    }
  });

  it('renders dynamic ruleset names without calling public eval state', async () => {
    const mixinRuleset = ruleset({
      selector: el('.theme'),
      rules: rules([
        decl({ name: 'color', value: any('blue') })
      ])
    });
    const root = rules([mixinRuleset]);
    context.root = root;
    context.rulesContext = root;
    const name = any('source-name');
    name.eval = function evalForRulesetName() {
      return mixinRuleset;
    };
    const rule = call({ name });
    const evalStateCalls = countEvalStateUse();

    try {
      const rendered = await Promise.resolve(rule.render(context));

      expect(rendered).toContain('color: blue');
      expect(evalStateCalls.count).toBe(0);
      expect(rule.evaluated).toBe(false);
      expect(rule.registrationPrepared).toBe(false);
    } finally {
      evalStateCalls.restore();
    }
  });

  it('renders dynamic mixin collection names without calling public eval state', async () => {
    const mixinDef = mixin({
      name: any('.theme'),
      rules: rules([
        decl({ name: 'color', value: any('green') })
      ])
    });
    const root = rules([mixinDef]);
    context.root = root;
    context.rulesContext = root;
    const collection = new MixinCollection([mixinDef]);
    const name = any('source-name');
    name.eval = function evalForMixinCollectionName() {
      return collection;
    };
    const rule = call({ name });
    const evalStateCalls = countEvalStateUse();

    try {
      const rendered = await Promise.resolve(rule.render(context));

      expect(rendered).toContain('color: green');
      expect(evalStateCalls.count).toBe(0);
      expect(rule.evaluated).toBe(false);
      expect(rule.registrationPrepared).toBe(false);
    } finally {
      evalStateCalls.restore();
    }
  });

  it('renders dynamic callable array names without calling public eval state', async () => {
    const mixinDef = mixin({
      name: any('.theme'),
      rules: rules([
        decl({ name: 'color', value: any('purple') })
      ])
    });
    const root = rules([mixinDef]);
    context.root = root;
    context.rulesContext = root;
    const name = any('source-name');
    name.eval = function evalForCallableArrayName() {
      return [mixinDef];
    };
    const rule = call({ name });
    const evalStateCalls = countEvalStateUse();

    try {
      const rendered = await Promise.resolve(rule.render(context));

      expect(rendered).toContain('color: purple');
      expect(evalStateCalls.count).toBe(0);
      expect(rule.evaluated).toBe(false);
      expect(rule.registrationPrepared).toBe(false);
    } finally {
      evalStateCalls.restore();
    }
  });

  it('renders dynamic call alias names without calling public eval state', async () => {
    const mixinDef = mixin({
      name: any('.theme'),
      rules: rules([
        decl({ name: 'color', value: any('orange') })
      ])
    });
    const root = rules([mixinDef]);
    context.root = root;
    context.rulesContext = root;
    const alias = call({
      name: ref({ key: '.theme' }, { type: 'mixin' })
    });
    const name = any('source-name');
    name.eval = function evalForCallAliasName() {
      return alias;
    };
    const rule = call({ name });
    const evalStateCalls = countEvalStateUse();

    try {
      const rendered = await Promise.resolve(rule.render(context));

      expect(rendered).toContain('color: orange');
      expect(evalStateCalls.count).toBe(0);
      expect(rule.evaluated).toBe(false);
      expect(rule.registrationPrepared).toBe(false);
    } finally {
      evalStateCalls.restore();
    }
  });

  it('renders silent-fail dynamic callable failures without owning a fallback call', async () => {
    const mixinDef = mixin({
      name: any('.theme'),
      rules: rules([
        decl({ name: 'color', value: ref('missing-color', { type: 'variable' }) })
      ])
    });
    const root = rules([mixinDef]);
    context.root = root;
    context.rulesContext = root;
    const collection = new MixinCollection([mixinDef]);
    const name = any('missing-theme');
    name.eval = function evalForMissingCallableName() {
      return collection;
    };
    const rule = call({ name }, { silentFail: true });
    const originalClone = Call.prototype.clone;
    const derivedCalls = countDeriveCallUse();
    const evalStateCalls = countEvalStateUse();
    let clonedCalls = 0;
    Call.prototype.clone = function cloneForCounting(
      this: Call,
      ...cloneArgs: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      clonedCalls++;
      return originalClone.apply(this, cloneArgs);
    };

    try {
      await expect(Promise.resolve(rule.render(context))).resolves.toBe('missing-theme()');

      expect(derivedCalls.count).toBe(0);
      expect(clonedCalls).toBe(0);
      expect(evalStateCalls.count).toBe(0);
      expect(rule.evaluated).toBe(false);
      expect(rule.registrationPrepared).toBe(false);
    } finally {
      Call.prototype.clone = originalClone;
      derivedCalls.restore();
      evalStateCalls.restore();
    }
  });

  it('streams dynamic CSS call arguments without materializing a replacement arg list', async () => {
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
    const descriptor = Object.getOwnPropertyDescriptor(List.prototype, 'withResolvedValue');
    if (!descriptor) {
      throw new Error('Expected List.withResolvedValue for call arg materialization proof');
    }
    const rule = call({
      name: 'rgb',
      args: list([
        ref({ key: 'red-channel' }, { type: 'variable' }),
        num(100),
        num(100)
      ])
    });

    Object.defineProperty(List.prototype, 'withResolvedValue', {
      ...descriptor,
      value: () => {
        throw new Error('CSS call render should stream arguments without a replacement list');
      }
    });
    try {
      expect(await Promise.resolve(rule.render(context))).toBe('rgb(100, 100, 100)');
    } finally {
      Object.defineProperty(List.prototype, 'withResolvedValue', descriptor);
    }
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

  it('uses source args directly for plain dynamic JS function render and resolve', async () => {
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

    const root = rules([]);
    const originalLeaf = any('red');
    const originalValue = new CountingSequence([originalLeaf, dimension(10, 'px')]);
    const originalArgs = list([originalValue]);
    root.register('function', new JsFunction({
      name: 'echo',
      fn: (value: Sequence) => any(value === originalValue ? 'ok' : 'bad')
    }));
    context.root = root;
    context.rulesContext = root;
    const rule = call({
      name: ref({ key: 'echo' }, { type: 'function' }),
      args: originalArgs
    });
    const buffer = createRenderBuffer('flat');

    CountingSequence.countConstructions = true;
    try {
      await expect(Promise.resolve(rule.render(context))).resolves.toBe('ok');
      expect(await rule.render(context, buffer)).toBe('ok');
      expect((await rule.resolve(context)).toTrimmedString()).toBe('ok');
      expect(buffer.parts).toEqual(['ok']);
      expect(CountingSequence.constructedCopies).toBe(0);
      expect(rule.evaluated).toBe(false);
      expect(originalValue.parent).toBe(originalArgs);
      expect(originalArgs.parent).toBe(rule);
    } finally {
      CountingSequence.countConstructions = false;
      CountingSequence.constructedCopies = 0;
    }
  });

  it('renders optional non-string fallback calls through native output', async () => {
    const derivedCalls = countDeriveCallUse();
    const args = list([seq([any('red'), dimension([10, 'px'])])]);
    const name = ref({ key: 'missing-fn' }, { type: 'function', fallbackValue: true });
    const rule = call({
      name,
      args
    }, { silentFail: true });
    rule.resolve = () => {
      throw new Error('Call dynamic fallback render should evaluate locally');
    };
    const buffer = createRenderBuffer('flat');

    try {
      await expect(Promise.resolve(rule.render(context))).resolves.toBe('missing-fn(red 10px)');
      expect(await rule.render(context, buffer)).toBe('missing-fn(red 10px)');
      expect(buffer.parts).toEqual(['missing-fn(red 10px)']);
      expect(derivedCalls.count).toBe(0);
      expect(args.parent).toBe(rule);
      expect(name.parent).toBe(rule);
      expect(name.evaluated).toBe(false);
      expect(rule.evaluated).toBe(false);
      expect(rule.registrationPrepared).toBe(false);
    } finally {
      derivedCalls.restore();
    }
  });

  it('resolves optional missing dynamic function fallback without evaluating the source call surface', async () => {
    const args = list([seq([any('red'), dimension([10, 'px'])])]);
    const name = ref({ key: 'missing-fn' }, { type: 'function', fallbackValue: true });
    const rule = call({ name, args }, { silentFail: true });

    const resolved = await rule.resolve(context);

    expect(isNode(resolved, N.Call)).toBe(false);
    expect(resolved.toTrimmedString()).toBe('missing-fn(red 10px)');
    expect(args.parent).toBe(rule);
    expect(name.parent).toBe(rule);
    expect(name.evaluated).toBe(false);
    expect(rule.evaluated).toBe(false);
  });

  it('renders important optional CSS fallback syntax without deriving output', async () => {
    const derivedCalls = countDeriveCallUse();
    const name = ref({ key: 'missing-fn' }, { type: 'function', fallbackValue: true });
    const originalEval = name.eval.bind(name);
    let nameEvaluations = 0;
    name.eval = function evalForCounting(evalContext: Context) {
      nameEvaluations++;
      return originalEval(evalContext);
    };
    const rule = call({
      name,
      args: list([any('red')])
    }, { silentFail: true, markImportant: true });

    try {
      await expect(Promise.resolve(rule.render(context))).resolves.toBe('missing-fn(red) !important');
      expect(nameEvaluations).toBe(1);
      expect(derivedCalls.count).toBe(0);
      expect(rule.evaluated).toBe(false);
      expect(rule.registrationPrepared).toBe(false);
    } finally {
      derivedCalls.restore();
    }
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
    expect(writer.readbacks).toBe(0);
  });

  it('renders token CSS call arguments without per-arg trim marks', () => {
    const writer = new CountingWriter();
    const rule = call({
      name: 'var',
      args: list([any('--brand'), any('red')])
    });

    expect(rule.render(context, { writer })).toBe('var(--brand, red)');
    expect(writer.toString()).toBe('var(--brand, red)');
    expect(writer.marks).toBe(1);
    expect(writer.readbacks).toBe(0);
  });

  it('renders async scalar CSS call arguments without per-arg trim readback', async () => {
    const writer = new CountingWriter();
    const arg = new AsyncRenderedAny('source', '20');
    const rule = call({
      name: 'rgb',
      args: list([num(10), arg, num(30)])
    });

    await expect(Promise.resolve(rule.render(context, { writer }))).resolves.toBe('rgb(10, 20, 30)');
    expect(writer.toString()).toBe('rgb(10, 20, 30)');
    expect(writer.marks).toBe(1);
    expect(writer.readbacks).toBe(0);
  });

  it('renders async scalar CSS call content without whole-call readback', async () => {
    const writer = new CountingWriter();
    const content = new AsyncRenderedAny('source-content', 'body-output');
    const rule = call({
      name: 'wrap',
      contentNode: content
    });

    await expect(Promise.resolve(rule.render(context, { writer }))).resolves.toBe('wrap(): body-output');
    expect(writer.toString()).toBe('wrap(): body-output');
    expect(writer.marks).toBe(1);
    expect(writer.readbacks).toBe(0);
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

  it('resolves already evaluated calls without re-entering eval', () => {
    class EvaluatedCall extends Call {
      override evalNode(): never {
        throw new Error('evaluated calls should not resolve through evalNode');
      }
    }
    const rule = new EvaluatedCall({
      name: 'rgb',
      args: list([any('red')])
    });
    rule.evaluated = true;

    const resolved = rule.resolve(context);

    expect(resolved).toBe(rule);
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

  it('reduces safe direct arithmetic and nested calc calls like buffer render', async () => {
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
    await expect(Promise.resolve(nested.render(context))).resolves.toBe('calc(15vh)');
    const buffer = createRenderBuffer('flat');
    await expect(nested.render(context, buffer)).resolves.toBe('calc(15vh)');
    expect(buffer.parts).toEqual(['calc(15vh)']);
  });

  it('restores calc eval frames when synchronous CSS call argument evaluation throws', async () => {
    const rule = call({
      name: 'calc',
      args: list([new ThrowingAny('bad arg')])
    });

    await expect(rule.eval(context)).rejects.toThrow('bad arg');
    expect(context.calcFrames).toBe(0);
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
      expect(name.evaluated).toBe(false);
      expect(rule.evaluated).toBe(false);
    } finally {
      Reference.prototype.clone = originalClone;
    }
  });

  it('keeps rules-like variable call names canonical across render and resolve', async () => {
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
    const name = ref('themeBlock', { type: 'variable' });
    const rule = call({ name });
    const evalStateCalls = countEvalStateUse();

    try {
      const rendered = await Promise.resolve(rule.render(context));
      expect(evalStateCalls.count).toBe(0);
      const resolved = await rule.resolve(context);

      expect(rendered).toContain('color: blue');
      expect(isNode(resolved, N.Rules)).toBe(true);
      expect(resolved.toTrimmedString()).toContain('color: blue');
      expect(name.parent).toBe(rule);
      expect(name.evaluated).toBe(false);
      expect(rule.evaluated).toBe(false);
    } finally {
      evalStateCalls.restore();
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

    const originalLeaf = any('red');
    const originalValue = new CountingSequence([originalLeaf, dimension(10, 'px')]);
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
      expect(rawArg instanceof Sequence ? rawArg.value[0] : undefined).toBe(originalLeaf);
      expect(rawArg?.parent?.parent).toBe(rule);
      expect(originalValue.parent).toBe(originalArgs);
      expect(originalArgs.parent).toBe(rule);
    } finally {
      CountingSequence.countConstructions = false;
      CountingSequence.constructedCopies = 0;
    }
  });

  it('keeps metadata rawArgs mutations isolated from source call arguments', async () => {
    let rawArgsDuringCall: List | undefined;
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'mutate-raw',
      fn: defineFunction(
        'mutate-raw',
        async function(this: { rawArgs: List }) {
          rawArgsDuringCall = this.rawArgs;
          this.rawArgs.value.push(any('mutated'));
          return any(String(this.rawArgs.value.length));
        },
        { params: [{ name: 'value', type: Sequence }] }
      )
    }));
    context.root = root;
    context.rulesContext = root;

    const originalValue = seq([any('red'), dimension(10, 'px')]);
    const originalArgs = list([originalValue]);
    const rule = call({
      name: ref({ key: 'mutate-raw' }, { type: 'function' }),
      args: originalArgs
    });

    const result = await rule.eval(context);

    expect(result.toTrimmedString()).toBe('2');
    expect(rawArgsDuringCall).toBeDefined();
    expect(rawArgsDuringCall).not.toBe(originalArgs);
    expect(originalArgs.value).toEqual([originalValue]);
    expect(originalValue.parent).toBe(originalArgs);
    expect(originalArgs.parent).toBe(rule);
  });

  it('records metadata rawArgs placement beside the owned argument surface', async () => {
    let rawArgsDuringCall: List | undefined;
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'inspect-raw',
      fn: defineFunction(
        'inspect-raw',
        async function(this: { rawArgs: List }) {
          rawArgsDuringCall = this.rawArgs;
          return any('ok');
        },
        { params: [{ name: 'value', type: Sequence }] }
      )
    }));
    context.root = root;
    context.rulesContext = root;

    const originalValue = seq([any('red'), dimension(10, 'px')]);
    const originalArgs = list([originalValue]);
    const rule = call({
      name: ref({ key: 'inspect-raw' }, { type: 'function' }),
      args: originalArgs
    });

    const result = await rule.eval(context);

    expect(result.toTrimmedString()).toBe('ok');
    expect(rawArgsDuringCall).toBeDefined();
    if (!rawArgsDuringCall) {
      throw new Error('Expected metadata rawArgs');
    }
    expect(rawArgsDuringCall).not.toBe(originalArgs);
    expect(getCallRawArgsPlacement(rawArgsDuringCall)).toEqual({
      source: rule,
      sourceArgs: originalArgs
    });
    expect(getCallRawArgSourceNode(rawArgsDuringCall, 0)).toBe(originalValue);
    expect(getCallRawArgDiagnosticSource(rawArgsDuringCall, 0)).toEqual({
      source: rule,
      sourceArg: originalValue,
      index: 0
    });
    expect(getCallRawArgDiagnosticMessageSource(rawArgsDuringCall, 0)).toBe('argument 1 from $red 10');
  });

  it('keeps metadata rawArgs owned across dynamic render and resolve', async () => {
    const seenRawArgs: List[] = [];
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'mutate-raw',
      fn: defineFunction(
        'mutate-raw',
        async function(this: { rawArgs: List }) {
          seenRawArgs.push(this.rawArgs);
          this.rawArgs.value.push(any('mutated'));
          return any(String(this.rawArgs.value.length));
        },
        { params: [{ name: 'value', type: Sequence }] }
      )
    }));
    context.root = root;
    context.rulesContext = root;

    const makeRule = () => {
      const originalValue = seq([any('red'), dimension(10, 'px')]);
      const originalArgs = list([originalValue]);
      return {
        originalValue,
        originalArgs,
        rule: call({
          name: ref({ key: 'mutate-raw' }, { type: 'function' }),
          args: originalArgs
        })
      };
    };
    const direct = makeRule();
    const buffered = makeRule();
    const resolved = makeRule();
    const buffer = createRenderBuffer('flat');

    await expect(Promise.resolve(direct.rule.render(context))).resolves.toBe('2');
    expect(await buffered.rule.render(context, buffer)).toBe('2');
    expect((await resolved.rule.resolve(context)).toTrimmedString()).toBe('2');
    expect(buffer.parts).toEqual(['2']);
    expect(seenRawArgs).toHaveLength(3);
    for (const rawArgs of seenRawArgs) {
      expect(rawArgs).not.toBe(direct.originalArgs);
      expect(rawArgs).not.toBe(buffered.originalArgs);
      expect(rawArgs).not.toBe(resolved.originalArgs);
    }
    for (const { originalValue, originalArgs, rule } of [direct, buffered, resolved]) {
      expect(originalArgs.value).toEqual([originalValue]);
      expect(originalValue.parent).toBe(originalArgs);
      expect(originalArgs.parent).toBe(rule);
      expect(rule.evaluated).toBe(false);
    }
  });

  it('renders metadata dynamic functions without evaluating the dynamic name twice', async () => {
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'raw-length',
      fn: defineFunction(
        'raw-length',
        async function(this: { rawArgs: List }) {
          return any(String(this.rawArgs.value.length));
        },
        { params: [{ name: 'value', type: Sequence }] }
      )
    }));
    context.root = root;
    context.rulesContext = root;

    const name = ref({ key: 'raw-length' }, { type: 'function' });
    const originalEval = name.eval.bind(name);
    let nameEvaluations = 0;
    name.eval = function evalForCounting(evalContext: Context) {
      nameEvaluations++;
      return originalEval(evalContext);
    };

    const rendered = await Promise.resolve(call({
      name,
      args: list([seq([any('red'), dimension(10, 'px')])])
    }).render(context));

    expect(rendered).toBe('1');
    expect(nameEvaluations).toBe(1);
  });

  it('renders and resolves metadata JS functions without reconstructing the source call', async () => {
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

    const seenRawArgs: List[] = [];
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'mutate-raw',
      fn: defineFunction(
        'mutate-raw',
        async function(this: { rawArgs: List }) {
          seenRawArgs.push(this.rawArgs);
          this.rawArgs.value.push(any('mutated'));
          return any(String(this.rawArgs.value.length));
        },
        { params: [{ name: 'value', type: Sequence }] }
      )
    }));
    context.root = root;
    context.rulesContext = root;

    const makeRule = () => {
      const originalValue = seq([any('red'), dimension(10, 'px')]);
      const originalArgs = list([originalValue]);
      return {
        originalValue,
        originalArgs,
        rule: new CountingCall({
          name: ref({ key: 'mutate-raw' }, { type: 'function' }),
          args: originalArgs
        })
      };
    };
    const direct = makeRule();
    const buffered = makeRule();
    const resolved = makeRule();
    const buffer = createRenderBuffer('flat');

    CountingCall.countConstructions = true;
    try {
      await expect(Promise.resolve(direct.rule.render(context))).resolves.toBe('2');
      expect(await buffered.rule.render(context, buffer)).toBe('2');
      expect((await resolved.rule.resolve(context)).toTrimmedString()).toBe('2');
      expect(buffer.parts).toEqual(['2']);
      expect(CountingCall.constructedCopies).toBe(0);
      expect(seenRawArgs).toHaveLength(3);
      for (const rawArgs of seenRawArgs) {
        expect(rawArgs).not.toBe(direct.originalArgs);
        expect(rawArgs).not.toBe(buffered.originalArgs);
        expect(rawArgs).not.toBe(resolved.originalArgs);
      }
      for (const { originalValue, originalArgs, rule } of [direct, buffered, resolved]) {
        expect(originalArgs.value).toEqual([originalValue]);
        expect(originalValue.parent).toBe(originalArgs);
        expect(originalArgs.parent).toBe(rule);
        expect(rule.evaluated).toBe(false);
      }
    } finally {
      CountingCall.countConstructions = false;
      CountingCall.constructedCopies = 0;
    }
  });

  it('keeps optional metadata failures on the owned rawArgs surface before rethrowing', async () => {
    let rawArgsDuringCall: List | undefined;
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'badMeta',
      fn: defineFunction(
        'badMeta',
        async function(this: { rawArgs: List }) {
          rawArgsDuringCall = this.rawArgs;
          this.rawArgs.value.push(any('mutated'));
          throw new Error('bad metadata function');
        },
        { params: [{ name: 'value', type: Any }] }
      )
    }));
    context.root = root;
    context.rulesContext = root;
    const originalArgs = list([any('red')]);
    const rule = call({
      name: ref({ key: 'badMeta' }, { type: 'function', fallbackValue: true }),
      args: originalArgs
    }, { silentFail: true });

    await expect(Promise.resolve(rule.render(context))).rejects.toThrow('bad metadata function');

    expect(rawArgsDuringCall).toBeDefined();
    expect(rawArgsDuringCall).not.toBe(originalArgs);
    expect(rawArgsDuringCall?.value).toHaveLength(2);
    expect(originalArgs.value).toHaveLength(1);
    expect(originalArgs.parent).toBe(rule);
    expect(rule.evaluated).toBe(false);
  });

  it('evaluates metadata JS function params from the owned arg surface', async () => {
    let receivedArg: Sequence | undefined;
    const originalValue = seq([any('red'), dimension(10, 'px')]);
    const originalArgs = list([originalValue]);
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'inspect-owned',
      fn: defineFunction(
        'inspect-owned',
        async function(value: Sequence) {
          receivedArg = value;
          return any(value !== originalValue ? 'ok' : 'bad');
        },
        { params: [{ name: 'value', type: Sequence }] }
      )
    }));
    context.root = root;
    context.rulesContext = root;

    const rule = call({
      name: ref({ key: 'inspect-owned' }, { type: 'function' }),
      args: originalArgs
    });

    const result = await rule.eval(context);

    expect(result.toTrimmedString()).toBe('ok');
    expect(receivedArg).toBeDefined();
    expect(receivedArg).not.toBe(originalValue);
    expect(originalValue.evaluated).toBe(false);
    expect(originalValue.parent).toBe(originalArgs);
    expect(originalArgs.parent).toBe(rule);
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

      expect(isNode(resolved, N.Call)).toBe(false);
      expect(resolved.toTrimmedString()).toBe('missing-fn(red 10px)');
      expect(clonedCalls).toBe(0);
      expect(args.parent).toBe(rule);
      expect(originalArg.parent).toBe(args);
    } finally {
      Call.prototype.clone = originalClone;
    }
  });

  it('does not copy source-free static fallback call arg containers', async () => {
    const originalCopy = Sequence.prototype.copy;
    let sequenceCopies = 0;
    Sequence.prototype.copy = function copyForCounting(
      this: Sequence,
      ...args: Parameters<typeof originalCopy>
    ): ReturnType<typeof originalCopy> {
      sequenceCopies++;
      return originalCopy.apply(this, args);
    };

    const arg = seq([any('red'), dimension([10, 'px'])]);
    const args = list([arg]);
    const rule = call({
      name: ref({ key: 'missing-fn' }, { type: 'function', fallbackValue: true }),
      args
    }, { silentFail: true });

    try {
      const resolved = await rule.eval(context);

      expect(isNode(resolved, N.Call)).toBe(false);
      expect(resolved.toTrimmedString()).toBe('missing-fn(red 10px)');
      expect(sequenceCopies).toBe(0);
      expect(args.parent).toBe(rule);
      expect(arg.parent).toBe(args);
    } finally {
      Sequence.prototype.copy = originalCopy;
    }
  });

  it('keeps source fallback call content canonical when optional function evaluation falls back', async () => {
    const originalCopy = Sequence.prototype.copy;
    let sequenceCopies = 0;
    Sequence.prototype.copy = function copyForCounting(
      this: Sequence,
      ...args: Parameters<typeof originalCopy>
    ): ReturnType<typeof originalCopy> {
      sequenceCopies++;
      return originalCopy.apply(this, args);
    };
    const content = seq([any('raw'), any('content')]);
    const rule = call({
      name: ref({ key: 'missing-fn' }, { type: 'function', fallbackValue: true }),
      args: list([any('red')]),
      contentNode: content
    }, { silentFail: true });

    try {
      const rendered = await Promise.resolve(rule.render(context));
      const resolved = await rule.resolve(context);

      expect(rendered).toBe('missing-fn(red): raw content');
      expect(isNode(resolved, N.Call)).toBe(false);
      expect(resolved.toTrimmedString()).toBe('missing-fn(red): raw content');
      expect(sequenceCopies).toBe(0);
      expect(content.parent).toBe(rule);
    } finally {
      Sequence.prototype.copy = originalCopy;
    }
  });

  it('resolves source-backed fallback call content without owning a fallback Call', async () => {
    const content = new Sequence(
      [any('raw'), any('content')],
      undefined,
      [10, 1, 11, 20, 1, 21]
    );
    const rule = call({
      name: ref({ key: 'missing-fn' }, { type: 'function', fallbackValue: true }),
      args: list([any('red')]),
      contentNode: content
    }, { silentFail: true });

    const resolved = await rule.resolve(context);

    expect(isNode(resolved, N.Call)).toBe(false);
    expect(resolved.toTrimmedString()).toBe('missing-fn(red): raw content');
    expect(content.parent).toBe(rule);
  });

  it('renders source-backed fallback call content without owning output content', async () => {
    const originalCopy = Sequence.prototype.copy;
    const derivedCalls = countDeriveCallUse();
    let sequenceCopies = 0;
    Sequence.prototype.copy = function copyForCounting(
      this: Sequence,
      ...args: Parameters<typeof originalCopy>
    ): ReturnType<typeof originalCopy> {
      sequenceCopies++;
      return originalCopy.apply(this, args);
    };
    const content = new Sequence(
      [any('raw'), any('content')],
      undefined,
      [10, 1, 11, 20, 1, 21]
    );
    const rule = call({
      name: ref({ key: 'missing-fn' }, { type: 'function', fallbackValue: true }),
      args: list([any('red')]),
      contentNode: content
    }, { silentFail: true });
    const buffer = createRenderBuffer('flat');

    try {
      await expect(Promise.resolve(rule.render(context))).resolves.toBe('missing-fn(red): raw content');
      expect(await rule.render(context, buffer)).toBe('missing-fn(red): raw content');

      expect(sequenceCopies).toBe(0);
      expect(derivedCalls.count).toBe(0);
      expect(buffer.parts).toEqual(['missing-fn(red): raw content']);
      expect(content.parent).toBe(rule);
      expect(rule.evaluated).toBe(false);
      expect(rule.registrationPrepared).toBe(false);
    } finally {
      Sequence.prototype.copy = originalCopy;
      derivedCalls.restore();
    }
  });

  it('renders and resolves source-backed fallback content without deriving a fallback Call', async () => {
    const originalCopy = Sequence.prototype.copy;
    const derivedCalls = countDeriveCallUse();
    let sequenceCopies = 0;
    Sequence.prototype.copy = function copyForCounting(
      this: Sequence,
      ...args: Parameters<typeof originalCopy>
    ): ReturnType<typeof originalCopy> {
      sequenceCopies++;
      return originalCopy.apply(this, args);
    };
    const content = new Sequence(
      [any('raw'), any('content')],
      undefined,
      [10, 1, 11, 20, 1, 21]
    );
    const rule = call({
      name: ref({ key: 'missing-fn' }, { type: 'function', fallbackValue: true }),
      args: list([any('red')]),
      contentNode: content
    }, { silentFail: true });

    try {
      await expect(Promise.resolve(rule.render(context))).resolves.toBe('missing-fn(red): raw content');
      expect(derivedCalls.count).toBe(0);
      expect(sequenceCopies).toBe(0);

      const resolved = await rule.resolve(context);

      expect(isNode(resolved, N.Call)).toBe(false);
      expect(resolved.toTrimmedString()).toBe('missing-fn(red): raw content');
      expect(derivedCalls.count).toBe(0);
      expect(sequenceCopies).toBe(0);
      expect(content.parent).toBe(rule);
      expect(rule.evaluated).toBe(false);
    } finally {
      Sequence.prototype.copy = originalCopy;
      derivedCalls.restore();
    }
  });

  it('renders optional JS failure fallback content without owning a fallback Call surface', async () => {
    const originalCopy = Sequence.prototype.copy;
    const derivedCalls = countDeriveCallUse();
    let sequenceCopies = 0;
    Sequence.prototype.copy = function copyForCounting(
      this: Sequence,
      ...args: Parameters<typeof originalCopy>
    ): ReturnType<typeof originalCopy> {
      sequenceCopies++;
      return originalCopy.apply(this, args);
    };
    let calls = 0;
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'bad',
      fn: () => {
        calls++;
        throw new Error('bad function');
      },
      allowOptional: true
    }));
    context.root = root;
    context.rulesContext = root;
    const content = new Sequence(
      [any('raw'), any('content')],
      undefined,
      [10, 1, 11, 20, 1, 21]
    );
    const rule = call({
      name: ref({ key: 'bad' }, { type: 'function', fallbackValue: true }),
      args: list([any('red')]),
      contentNode: content
    }, { silentFail: true });
    const buffer = createRenderBuffer('flat');

    try {
      await expect(Promise.resolve(rule.render(context))).resolves.toBe('bad(red): raw content');
      expect(await rule.render(context, buffer)).toBe('bad(red): raw content');

      expect(sequenceCopies).toBe(0);
      expect(derivedCalls.count).toBe(0);
      expect(calls).toBe(2);
      expect(buffer.parts).toEqual(['bad(red): raw content']);
      expect(content.parent).toBe(rule);
      expect(rule.evaluated).toBe(false);
      expect(rule.registrationPrepared).toBe(false);
    } finally {
      Sequence.prototype.copy = originalCopy;
      derivedCalls.restore();
    }
  });

  it('does not probe optional JS calls with content before rendering them', async () => {
    let calls = 0;
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'wrap',
      fn: () => {
        calls++;
        return any('wrapped');
      },
      allowOptional: true
    }));
    context.root = root;
    context.rulesContext = root;
    const name = ref({ key: 'wrap' }, { type: 'function', fallbackValue: true });
    const originalEval = name.eval.bind(name);
    let nameEvaluations = 0;
    name.eval = function evalForCounting(evalContext: Context) {
      nameEvaluations++;
      return originalEval(evalContext);
    };
    const rule = call({
      name,
      args: list([]),
      contentNode: new Sequence(
        [any('raw'), any('content')],
        undefined,
        [10, 1, 11, 20, 1, 21]
      )
    }, { silentFail: true });

    await expect(Promise.resolve(rule.render(context))).resolves.toBe('wrapped');

    expect(calls).toBe(1);
    expect(nameEvaluations).toBe(1);
  });

  it('renders optional JS success output once without deriving fallback syntax', async () => {
    const derivedCalls = countDeriveCallUse();
    let calls = 0;
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'ok',
      fn: () => {
        calls++;
        return any('ok');
      },
      allowOptional: true
    }));
    context.root = root;
    context.rulesContext = root;
    const name = ref({ key: 'ok' }, { type: 'function', fallbackValue: true });
    const originalEval = name.eval.bind(name);
    let nameEvaluations = 0;
    name.eval = function evalForCounting(evalContext: Context) {
      nameEvaluations++;
      return originalEval(evalContext);
    };
    const buffer = createRenderBuffer('flat');
    const rule = call({
      name,
      args: list([])
    }, { silentFail: true });

    try {
      await expect(Promise.resolve(rule.render(context, buffer))).resolves.toBe('ok');

      expect(buffer.parts).toEqual(['ok']);
      expect(calls).toBe(1);
      expect(nameEvaluations).toBe(1);
      expect(derivedCalls.count).toBe(0);
      expect(rule.evaluated).toBe(false);
    } finally {
      derivedCalls.restore();
    }
  });

  it('resolves dynamic source-free fallback call content without owning a fallback Call', async () => {
    const content = seq([any('raw'), any('content')]);
    content.addFlag(F_NON_STATIC);
    const rule = call({
      name: ref({ key: 'missing-fn' }, { type: 'function', fallbackValue: true }),
      args: list([any('red')]),
      contentNode: content
    }, { silentFail: true });

    const resolved = await rule.resolve(context);

    expect(isNode(resolved, N.Call)).toBe(false);
    expect(resolved.toTrimmedString()).toBe('missing-fn(red): raw content');
    expect(content.parent).toBe(rule);
  });

  it('resolves optional JS failure fallback without shallow-cloning the source call', async () => {
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

      expect(isNode(resolved, N.Call)).toBe(false);
      expect(resolved.toTrimmedString()).toBe('bad(red 10px)');
      expect(clonedCalls).toBe(0);
      expect(args.parent).toBe(rule);
      expect(originalArg.parent).toBe(args);
    } finally {
      Call.prototype.clone = originalClone;
    }
  });

  it('renders and resolves optional JS failure fallback without evaluating the source call surface', async () => {
    const derivedCalls = countDeriveCallUse();
    let calls = 0;
    const root = rules([]);
    root.register('function', new JsFunction({
      name: 'bad',
      fn: () => {
        calls++;
        throw new Error('bad function');
      },
      allowOptional: true
    }));
    context.root = root;
    context.rulesContext = root;
    const args = list([seq([any('red'), dimension([10, 'px'])])]);
    const name = ref({ key: 'bad' }, { type: 'function', fallbackValue: true });
    const rule = call({ name, args }, { silentFail: true });
    const buffer = createRenderBuffer('flat');

    try {
      await expect(Promise.resolve(rule.render(context))).resolves.toBe('bad(red 10px)');
      expect(derivedCalls.count).toBe(0);
      expect(await rule.render(context, buffer)).toBe('bad(red 10px)');
      expect(derivedCalls.count).toBe(0);
      const resolved = await rule.resolve(context);

      expect(buffer.parts).toEqual(['bad(red 10px)']);
      expect(isNode(resolved, N.Call)).toBe(false);
      expect(resolved.toTrimmedString()).toBe('bad(red 10px)');
      expect(derivedCalls.count).toBe(0);
      expect(calls).toBe(3);
      expect(args.parent).toBe(rule);
      expect(name.parent).toBe(rule);
      expect(name.evaluated).toBe(false);
      expect(rule.evaluated).toBe(false);
    } finally {
      derivedCalls.restore();
    }
  });

  it('renders empty optional JS failure fallback syntax without call-level readback', async () => {
    const writer = new CountingWriter();
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
    const rule = call({
      name: ref({ key: 'bad' }, { type: 'function', fallbackValue: true }),
      args: list([])
    }, { silentFail: true });

    await expect(Promise.resolve(rule.render(context, { writer }))).resolves.toBe('bad()');

    expect(writer.toString()).toBe('bad()');
    expect(writer.marks).toBe(0);
    expect(writer.readbacks).toBe(0);
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
