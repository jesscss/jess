import { beforeEach, describe, expect, it } from 'vitest';
import type { IToken } from 'chevrotain';
import { Context } from '../../context.js';
import { any, Bool, call, list, num, Paren, paren, ref, rules, Rules, vardecl } from '../index.js';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer } from '../util/render-buffer.js';

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

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

async function evalRoot(node: Rules, context: Context): Promise<Rules> {
  const evald = await node.eval(context);
  expect(evald).toBeInstanceOf(Rules);
  if (!(evald instanceof Rules)) {
    throw new Error('Expected Rules result');
  }
  context.root = evald;
  context.rulesContext = evald;
  return evald;
}

describe('Paren', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders paren syntax through toTrimmedString()', () => {
    expect(paren(any('foo')).toTrimmedString()).toBe('(foo)');
  });

  it('does not allocate options when rendering paren syntax with defaults', () => {
    const rule = paren(any('foo'));

    expect(rule.toTrimmedString()).toBe('(foo)');
    expect(Object.getOwnPropertyDescriptor(rule, '_options')?.value).toBeUndefined();
  });

  it('renders resolved paren values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    await evalRoot(node, context);

    const parenNode = paren(ref({ key: 'value' }, { type: 'variable' }));
    let parenResolveCalls = 0;
    parenNode.resolve = (renderContext: Context) => {
      parenResolveCalls++;
      return parenNode.evalNode(renderContext);
    };
    const rendered = parenNode.render(context);

    expect(rendered).toBe('(foo)');
    expect(parenResolveCalls).toBe(0);
    expect(parenNode.evaluated).toBe(false);
    expect(parenNode.registrationPrepared).toBe(false);
  });

  it('writes resolved paren render output into flat buffers', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    await evalRoot(node, context);

    const buffer = createRenderBuffer('flat');
    const parenNode = paren(ref({ key: 'value' }, { type: 'variable' }));
    let parenResolveCalls = 0;
    parenNode.resolve = (renderContext: Context) => {
      parenResolveCalls++;
      return parenNode.evalNode(renderContext);
    };

    expect(await parenNode.render(context, buffer)).toBe('(foo)');
    expect(buffer.parts).toEqual(['(foo)']);
    expect(parenResolveCalls).toBe(0);
    expect(parenNode.evaluated).toBe(false);
    expect(parenNode.registrationPrepared).toBe(false);
  });

  it('renders dynamic paren values without materializing a replacement paren', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    await evalRoot(node, context);
    const descriptor = Object.getOwnPropertyDescriptor(Paren.prototype, 'withValue');
    if (!descriptor) {
      throw new Error('Expected Paren.withValue for render materialization proof');
    }
    const parenNode = paren(ref({ key: 'value' }, { type: 'variable' }));

    Object.defineProperty(Paren.prototype, 'withValue', {
      ...descriptor,
      value: () => {
        throw new Error('Paren render should wrap resolved values without a replacement paren');
      }
    });
    try {
      expect(parenNode.render(context)).toBe('(foo)');
    } finally {
      Object.defineProperty(Paren.prototype, 'withValue', descriptor);
    }
  });

  it('renders default() values without allocating temporary Bool nodes', async () => {
    const originalToTrimmedString = Bool.prototype.toTrimmedString;
    let boolStringCalls = 0;
    Bool.prototype.toTrimmedString = function toTrimmedStringForCounting(
      this: Bool,
      ...args: Parameters<Bool['toTrimmedString']>
    ) {
      boolStringCalls++;
      return originalToTrimmedString.apply(this, args);
    };
    try {
      context.isDefault = true;
      const parenNode = paren(call({ name: 'default' }));

      expect(await Promise.resolve(parenNode.render(context))).toBe('true');
      expect(boolStringCalls).toBe(0);
      expect(parenNode.evaluated).toBe(false);
    } finally {
      Bool.prototype.toTrimmedString = originalToTrimmedString;
    }
  });

  it('writes default() render output into flat buffers without temporary Bool nodes', async () => {
    const originalToTrimmedString = Bool.prototype.toTrimmedString;
    let boolStringCalls = 0;
    Bool.prototype.toTrimmedString = function toTrimmedStringForCounting(
      this: Bool,
      ...args: Parameters<Bool['toTrimmedString']>
    ) {
      boolStringCalls++;
      return originalToTrimmedString.apply(this, args);
    };
    try {
      context.isDefault = false;
      const buffer = createRenderBuffer('flat');
      const parenNode = paren(call({ name: 'default' }));

      expect(await parenNode.render(context, buffer)).toBe('false');
      expect(buffer.parts).toEqual(['false']);
      expect(boolStringCalls).toBe(0);
      expect(parenNode.evaluated).toBe(false);
    } finally {
      Bool.prototype.toTrimmedString = originalToTrimmedString;
    }
  });

  it('streams paren values without capture scaffolding', () => {
    const writer = new CountingWriter();
    const value = any('foo');
    value._location = [4, 1, 5, 6, 1, 7];
    const trivia = createTriviaMap({
      before: new Map([[value.location[0], [token(' '), token('/*x*/', 'BlockComment')]]]),
      after: new Map<number, IToken[]>()
    }) satisfies TriviaMap;

    expect(paren(value).toTrimmedString({ trivia, writer })).toBe('(/*x*/foo)');
    expect(writer.captures).toBe(0);
  });

  it('resolves paren values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    await evalRoot(node, context);

    const parenNode = paren(ref({ key: 'value' }, { type: 'variable' }));
    const resolved = await parenNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('(foo)');
    expect(parenNode.evaluated).toBe(false);
    expect(parenNode.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('returns Bool nodes for default() paren resolve without stamping source state', async () => {
    context.isDefault = true;
    const parenNode = paren(call({ name: 'default' }));

    const first = await Promise.resolve(parenNode.resolve(context));
    const second = await Promise.resolve(parenNode.resolve(context));
    expect(first).toBeInstanceOf(Bool);
    expect(second).toBeInstanceOf(Bool);
    if (!(first instanceof Bool) || !(second instanceof Bool)) {
      throw new Error('Expected Bool results');
    }

    expect(first.value).toBe(true);
    expect(second.value).toBe(true);
    expect(parenNode.evaluated).toBe(false);
    expect(parenNode.registrationPrepared).toBe(false);
  });

  it('keeps source paren child containers canonical after resolve(context)', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    await evalRoot(node, context);

    const parenNode = paren(list([
      any('one'),
      ref({ key: 'value' }, { type: 'variable' })
    ]));
    const sourceValue = parenNode.value;
    const resolved = await parenNode.resolve(context);

    expect(resolved.render(context)).toBe('(one, foo)');
    expect(parenNode.toTrimmedString()).toBe('(one, $value)');
    expect(sourceValue?.parent).toBe(parenNode);
  });

  it('normalizes escaped semicolon lists to commas on eval', async () => {
    const resolved = await paren(
      list([num(7), num(8), num(9)], { sep: ';' }),
      { escaped: true }
    ).resolve(context);

    expect(resolved.toTrimmedString()).toBe('7, 8, 9');
    expect(context.printState.writer).toBeUndefined();
  });
});
