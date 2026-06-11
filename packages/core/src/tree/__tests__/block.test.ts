import { beforeEach, describe, expect, it } from 'vitest';
import type { IToken } from 'chevrotain';
import { Context } from '../../context.js';
import { any, block, Block, ref, rules, type Rules as RulesClass, vardecl } from '../index.js';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap } from '../util/trivia.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';

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

async function setEvaluatedRoot(context: Context, node: RulesClass): Promise<void> {
  const evald = await node.eval(context);
  if (!isNode(evald, N.Rules)) {
    throw new Error(`Expected Rules root, received ${evald.type}`);
  }
  context.root = evald;
  context.rulesContext = evald;
}

describe('Block', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders block syntax through toTrimmedString()', () => {
    expect(block(any('foo')).toTrimmedString()).toBe('{foo}');
  });

  it('does not allocate options when rendering block syntax with defaults', () => {
    const rule = block(any('foo'));

    expect(rule.toTrimmedString()).toBe('{foo}');
    expect(Object.getOwnPropertyDescriptor(rule, '_options')?.value).toBeUndefined();
  });

  it('emits source trivia before the closing delimiter', () => {
    const value = any('foo', undefined, [1, 1, 2, 3, 1, 4]);
    const node = block(value, undefined, [0, 1, 1, 7, 2, 3]);
    const trivia = createTriviaMap({
      before: new Map([[node.location[3], [token('\n  ')]]]),
      after: new Map<number, IToken[]>()
    }) satisfies TriviaMap;

    expect(node.toTrimmedString({ trivia })).toBe('{foo\n  }');
  });

  it('writes block values without public toString transport when trivia is inactive', () => {
    const value = any('foo');
    let stringCalls = 0;
    value.toString = () => {
      stringCalls++;
      return '';
    };

    expect(block(value).toTrimmedString()).toBe('{foo}');
    expect(stringCalls).toBe(0);
  });

  it('renders resolved block values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
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
    expect(blockNode.evaluated).toBe(false);
    expect(blockNode.registrationPrepared).toBe(false);
  });

  it('writes resolved block render output into flat buffers', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
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
    expect(blockNode.evaluated).toBe(false);
    expect(blockNode.registrationPrepared).toBe(false);
  });

  it('renders resolved block values without materializing a replacement block', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
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
        name: any('value'),
        value: any('foo')
      })
    ]);
    await setEvaluatedRoot(context, node);

    const blockNode = block(ref({ key: 'value' }, { type: 'variable' }));
    const resolved = await blockNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('{foo}');
    expect(blockNode.evaluated).toBe(false);
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
        name: any('value'),
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
