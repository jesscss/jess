import { sourceSpanOf } from '../util/provenance.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, block, Block, ref, rules, type Rules as RulesClass, vardecl } from '../index.js';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap, makeTrivia } from '../util/trivia.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';
import { OutputWriter } from '../util/print.js';
import { Node } from '../node.js';

// A trivia run is now a source range; build one whose text is exactly `text`.
const run = (text: string) => makeTrivia(text, 0, text.length);

async function setEvaluatedRoot(context: Context, node: RulesClass): Promise<void> {
  const evald = await node.eval(context);
  if (!isNode(evald, N.Rules)) {
    throw new Error(`Expected Rules root, received ${evald.type}`);
  }
  context.root = evald;
  context.rulesContext = evald;
}

class CountingWriter extends OutputWriter {
  reads = 0;

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }
}

class WriteOnlyNode extends Node<string> {
  readonly value: string;
  constructor(value: string) {
    super(value);
    this.value = value;
  }

  override writeSyntax(options: Parameters<Node['writeSyntax']>[0]): void {
    options.writer.add(this.value);
  }

  override toString(): string {
    throw new Error('Block.toTrimmedString should not use child public string transport');
  }
}

describe('Block', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders block syntax through toTrimmedString()', () => {
    expect(block(any('foo')).toTrimmedString()).toBe('{foo}');
  });

  it('writes block syntax without child public string transport', () => {
    const writer = new CountingWriter();
    const node = block(new WriteOnlyNode('foo'));

    expect(node.toTrimmedString({ writer })).toBe('{foo}');
    expect(writer.toString()).toBe('{foo}');
    expect(writer.reads).toBe(1);
  });

  it('stores the block child on a constructor-owned direct field', () => {
    const value = any('foo');
    const node = block(value);

    expect(node.value).toBe(value);
    expect(Block.childKeys).toEqual(['value']);
  });

  it('does not allocate options when rendering block syntax with defaults', () => {
    const rule = block(any('foo'));

    expect(rule.toTrimmedString()).toBe('{foo}');
    expect(Object.getOwnPropertyDescriptor(rule, '_options')?.value).toBeUndefined();
  });

  it('emits source trivia before the closing delimiter', () => {
    const value = any('foo', undefined, { start: 1, end: 3 });
    const node = block(value, undefined, { start: 0, end: 7 });
    const trivia = createTriviaMap({
      before: new Map([[sourceSpanOf(node)?.end, run('\n  ')]]),
      after: new Map()
    }) satisfies TriviaMap;

    expect(node.toTrimmedString({ trivia })).toBe('{foo\n  }');
  });

  it('renders resolved block values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: 'value',
        value: any('foo')
      })
    ]);
    await setEvaluatedRoot(context, node);

    const blockNode = block(ref({ key: 'value' }, { type: 'variable' }));
    const originalResolve = blockNode.resolve;
    let resolveCalls = 0;
    blockNode.resolve = function countResolveCalls(
      this: typeof blockNode,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };
    const rendered = blockNode.render(context);

    expect(rendered).toBe('{foo}');
    expect(resolveCalls).toBe(0);
    expect(blockNode.registrationPrepared).toBe(false);
  });

  it('writes resolved block render output into flat buffers', async () => {
    const node = rules([
      vardecl({
        name: 'value',
        value: any('foo')
      })
    ]);
    await setEvaluatedRoot(context, node);

    const buffer = createRenderBuffer('flat');
    const blockNode = block(ref({ key: 'value' }, { type: 'variable' }));
    const originalResolve = blockNode.resolve;
    let resolveCalls = 0;
    blockNode.resolve = function countResolveCalls(
      this: typeof blockNode,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };

    expect(await blockNode.render(context, buffer)).toBe('{foo}');
    expect(buffer.parts).toEqual(['{foo}']);
    expect(resolveCalls).toBe(0);
    expect(blockNode.registrationPrepared).toBe(false);
  });

  it('renders resolved block values without materializing a replacement block', async () => {
    const node = rules([
      vardecl({
        name: 'value',
        value: any('foo')
      })
    ]);
    await setEvaluatedRoot(context, node);
    const descriptor = Object.getOwnPropertyDescriptor(Block.prototype, 'withValue');
    if (!descriptor) {
      throw new Error('Expected Block.withValue for render materialization proof');
    }

    Object.defineProperty(Block.prototype, 'withValue', {
      ...descriptor,
      value: () => {
        throw new Error('Block render should not materialize a replacement block');
      }
    });
    try {
      const blockNode = block(ref({ key: 'value' }, { type: 'variable' }));

      expect(await blockNode.render(context)).toBe('{foo}');
    } finally {
      Object.defineProperty(Block.prototype, 'withValue', descriptor);
    }
  });

  it('resolves block values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: 'value',
        value: any('foo')
      })
    ]);
    await setEvaluatedRoot(context, node);

    const blockNode = block(ref({ key: 'value' }, { type: 'variable' }));
    const resolved = await blockNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('{foo}');
    expect(blockNode.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('returns static blocks without resolving child values', async () => {
    const value = any('foo');
    const blockNode = block(value);
    value.resolve = () => {
      throw new Error('static block child should not resolve');
    };

    const resolved = await blockNode.resolve(context);

    expect(resolved).toBe(blockNode);
    expect(resolved.toTrimmedString()).toBe('{foo}');
  });

  it('keeps source block values canonical after resolve(context)', async () => {
    const node = rules([
      vardecl({
        name: 'value',
        value: any('foo')
      })
    ]);
    await setEvaluatedRoot(context, node);

    const blockNode = block(ref({ key: 'value' }, { type: 'variable' }));
    const sourceValue = blockNode.value;
    const resolved = await blockNode.resolve(context);

    expect(resolved.render(context)).toBe('{foo}');
    expect(sourceValue.parent).toBe(blockNode);
    expect(blockNode.toTrimmedString()).toBe('{$value}');
  });
});
