import { setSourceSpan, sourceSpanOf } from '../util/provenance.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, Any, Bool, call, list, nil, Node, num, Paren, paren, ref, rules, Rules, vardecl } from '../index.js';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap, makeTrivia } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer } from '../util/render-buffer.js';

// A trivia run is now a source range; build one whose text is exactly `text`.
const run = (text: string) => makeTrivia(text, 0, text.length);

class CountingWriter extends OutputWriter {
  captures = 0;
  marks = 0;
  reads = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }

  override mark(): number {
    this.marks++;
    return super.mark();
  }

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
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

  it('stores the wrapped child on a constructor-owned direct field', () => {
    const child = any('foo');
    const node = paren(child);

    expect(node.value).toBe(child);
    expect(Paren.childKeys).toEqual(['value']);
  });

  it('writes empty paren syntax without writer readback', () => {
    const writer = new CountingWriter();
    const escapedWriter = new CountingWriter();
    const squareWriter = new CountingWriter();

    expect(paren().toTrimmedString({ writer })).toBe('()');
    expect(writer.toString()).toBe('()');
    expect(writer.reads).toBe(0);
    expect(paren(undefined, { escaped: true }).toTrimmedString({ writer: escapedWriter })).toBe('~()');
    expect(escapedWriter.toString()).toBe('~()');
    expect(escapedWriter.reads).toBe(0);
    expect(paren(undefined, { delimiter: 'square' }).toTrimmedString({ writer: squareWriter })).toBe('[]');
    expect(squareWriter.toString()).toBe('[]');
    expect(squareWriter.reads).toBe(0);
  });

  it('writes nil paren syntax without writer readback when trivia is inactive', () => {
    const writer = new CountingWriter();
    const squareWriter = new CountingWriter();

    expect(paren(nil()).toTrimmedString({ writer })).toBe('()');
    expect(writer.toString()).toBe('()');
    expect(writer.reads).toBe(0);
    expect(paren(nil(), { delimiter: 'square' }).toTrimmedString({ writer: squareWriter })).toBe('[]');
    expect(squareWriter.toString()).toBe('[]');
    expect(squareWriter.reads).toBe(0);
  });

  it('writes Any paren syntax without writer readback when trivia is inactive', () => {
    const writer = new CountingWriter();
    const squareWriter = new CountingWriter();
    const escapedWriter = new CountingWriter();

    expect(paren(any('foo')).toTrimmedString({ writer })).toBe('(foo)');
    expect(writer.toString()).toBe('(foo)');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(paren(any('foo'), { delimiter: 'square' }).toTrimmedString({ writer: squareWriter })).toBe('[foo]');
    expect(squareWriter.toString()).toBe('[foo]');
    expect(squareWriter.marks).toBe(0);
    expect(squareWriter.reads).toBe(0);
    expect(paren(any('foo'), { escaped: true }).toTrimmedString({ writer: escapedWriter })).toBe('~(foo)');
    expect(escapedWriter.toString()).toBe('~(foo)');
    expect(escapedWriter.marks).toBe(0);
    expect(escapedWriter.reads).toBe(0);
  });

  it('does not allocate options when rendering paren syntax with defaults', () => {
    const rule = paren(any('foo'));

    expect(rule.toTrimmedString()).toBe('(foo)');
    expect(Object.getOwnPropertyDescriptor(rule, '_options')?.value).toBeUndefined();
  });

  it('renders resolved paren values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: 'value',
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
    expect(parenNode.registrationPrepared).toBe(false);
  });

  it('writes resolved paren render output into flat buffers', async () => {
    const node = rules([
      vardecl({
        name: 'value',
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
    expect(parenNode.registrationPrepared).toBe(false);
  });

  it('writes resolved wrapped paren output to explicit writers', async () => {
    const node = rules([
      vardecl({
        name: 'value',
        value: any('foo')
      })
    ]);
    await evalRoot(node, context);
    const writer = new CountingWriter();

    expect(paren(ref({ key: 'value' }, { type: 'variable' })).render(context, { writer })).toBe('(foo)');
    expect(writer.toString()).toBe('(foo)');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('renders resolved Any paren values without child render transport', async () => {
    const node = rules([
      vardecl({
        name: 'value',
        value: any('foo')
      })
    ]);
    await evalRoot(node, context);
    const originalRender = Any.prototype.render;
    Any.prototype.render = function renderForCounting() {
      throw new Error('Resolved Any paren output should use direct syntax');
    };

    try {
      expect(paren(ref({ key: 'value' }, { type: 'variable' })).render(context)).toBe('(foo)');
    } finally {
      Any.prototype.render = originalRender;
    }
  });

  it('keeps resolved wrapped paren buffer output out of explicit writers', async () => {
    const node = rules([
      vardecl({
        name: 'value',
        value: any('foo')
      })
    ]);
    await evalRoot(node, context);
    const writer = new CountingWriter();
    const buffer = createRenderBuffer('flat');

    expect(paren(ref({ key: 'value' }, { type: 'variable' })).render(context, buffer, { writer })).toBe('(foo)');
    expect(buffer.parts).toEqual(['(foo)']);
    expect(writer.toString()).toBe('');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('streams resolved wrapped child output into render buffers', async () => {
    const node = rules([
      vardecl({
        name: 'value',
        value: list([num(1), num(2)])
      })
    ]);
    await evalRoot(node, context);
    const buffer = createRenderBuffer('flat');

    expect(paren(ref({ key: 'value' }, { type: 'variable' })).render(context, buffer))
      .toBe('(1, 2)');
    expect(buffer.parts).toEqual(['(', '1, 2', ')']);
  });

  it('renders empty paren syntax without writer readback', () => {
    const writer = new CountingWriter();
    const buffer = createRenderBuffer('flat');
    const parenNode = paren(undefined, { escaped: true });

    expect(parenNode.render(context, { writer })).toBe('~()');
    expect(writer.toString()).toBe('~()');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(parenNode.render(context, buffer, { writer })).toBe('~()');
    expect(buffer.parts).toEqual(['~()']);
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('renders nil paren syntax without writer readback when trivia is inactive', () => {
    const writer = new CountingWriter();
    const buffer = createRenderBuffer('flat');
    const parenNode = paren(nil(), { delimiter: 'square' });

    expect(parenNode.render(context, { writer })).toBe('[]');
    expect(writer.toString()).toBe('[]');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(parenNode.render(context, buffer, { writer })).toBe('[]');
    expect(buffer.parts).toEqual(['[]']);
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('renders Any paren syntax without writer readback when trivia is inactive', () => {
    const writer = new CountingWriter();
    const buffer = createRenderBuffer('flat');

    expect(paren(any('foo')).render(context, { writer })).toBe('(foo)');
    expect(writer.toString()).toBe('(foo)');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(paren(any('foo'), { delimiter: 'square' }).render(context, buffer, { writer })).toBe('[foo]');
    expect(buffer.parts).toEqual(['[foo]']);
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('renders dynamic paren values without materializing a replacement paren', async () => {
    const node = rules([
      vardecl({
        name: 'value',
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

  it('renders sync paren values without may-async continuation scaffolding', () => {
    const value = any('foo');
    const originalResolve = value.resolve;
    value.resolve = function resolveSyncOnly(
      this: typeof value,
      renderContext: Context
    ) {
      const out = originalResolve.call(this, renderContext);
      if (out instanceof Promise) {
        throw new Error('Paren.render should keep sync values on the sync path');
      }
      return out;
    };
    const parenNode = paren(value);

    expect(parenNode.render(context)).toBe('(foo)');
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
    } finally {
      Bool.prototype.toTrimmedString = originalToTrimmedString;
    }
  });

  it('streams paren values without capture scaffolding', () => {
    const writer = new CountingWriter();
    const value = any('foo');
    setSourceSpan(value, { start: 4, end: 6 });
    const trivia = createTriviaMap({
      before: new Map([[sourceSpanOf(value)?.start, run(' /*x*/')]])
    }) satisfies TriviaMap;

    expect(paren(value).toTrimmedString({ trivia, writer })).toBe('(/*x*/foo)');
    expect(writer.captures).toBe(0);
  });

  it('writes paren source children without public toString transport', () => {
    const value = any('foo');
    let toStringCalls = 0;
    value.toString = () => {
      toStringCalls++;
      return '';
    };

    expect(paren(value).toTrimmedString()).toBe('(foo)');
    expect(toStringCalls).toBe(0);
  });

  it('resolves paren values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: 'value',
        value: any('foo')
      })
    ]);
    await evalRoot(node, context);

    const parenNode = paren(ref({ key: 'value' }, { type: 'variable' }));
    const resolved = await parenNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('(foo)');
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
    expect(parenNode.registrationPrepared).toBe(false);
  });

  it('keeps source paren child containers canonical after resolve(context)', async () => {
    const node = rules([
      vardecl({
        name: 'value',
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

    expect(resolved).toBeInstanceOf(Any);
    expect(resolved.toTrimmedString()).toBe('7, 8, 9');
    expect(context.printState.writer).toBeUndefined();
  });

  it('normalizes escaped semicolon lists without replacement list inheritance on resolve', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'inherit');
    if (!descriptor) {
      throw new Error('Expected Node.inherit for resolve materialization proof');
    }
    Object.defineProperty(Node.prototype, 'inherit', {
      ...descriptor,
      value: () => {
        throw new Error('escaped list resolve should not materialize a replacement List');
      }
    });
    try {
      const resolved = await paren(
        list([num(7), num(8), num(9)], { sep: ';' }),
        { escaped: true }
      ).resolve(context);

      expect(resolved).toBeInstanceOf(Any);
      expect(resolved.toTrimmedString()).toBe('7, 8, 9');
    } finally {
      Object.defineProperty(Node.prototype, 'inherit', descriptor);
    }
  });

  it('renders escaped semicolon lists as commas without replacement list inheritance', () => {
    const node = paren(
      list([num(7), num(8), num(9)], { sep: ';' }),
      { escaped: true }
    );
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'inherit');
    if (!descriptor) {
      throw new Error('Expected Node.inherit for render materialization proof');
    }
    Object.defineProperty(Node.prototype, 'inherit', {
      ...descriptor,
      value: () => {
        throw new Error('escaped list render should not materialize a replacement List');
      }
    });
    try {
      expect(node.render(context)).toBe('7, 8, 9');
    } finally {
      Object.defineProperty(Node.prototype, 'inherit', descriptor);
    }
  });
});
