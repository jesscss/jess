import { beforeEach, describe, expect, it } from 'vitest';
import type { IToken } from 'chevrotain';
import { Context } from '../../context.js';
import { any, block, ref, rules, type Rules as RulesClass, vardecl } from '../index.js';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap } from '../util/trivia.js';
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

  it('renders resolved block values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const blockNode = block(ref({ key: 'value' }, { type: 'variable' }));
    const rendered = blockNode.render(context);

    expect(rendered).toBe('{foo}');
    expect(blockNode.evaluated).toBe(false);
    expect(blockNode.preEvaluated).toBe(false);
  });

  it('writes resolved block render output into flat buffers', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

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
    expect(blockNode.preEvaluated).toBe(false);
  });

  it('resolves block values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const blockNode = block(ref({ key: 'value' }, { type: 'variable' }));
    const resolved = await blockNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('{foo}');
    expect(blockNode.evaluated).toBe(false);
    expect(blockNode.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('keeps source block values canonical after resolve(context)', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const blockNode = block(ref({ key: 'value' }, { type: 'variable' }));
    const sourceValue = blockNode.value;
    const resolved = await blockNode.resolve(context);

    expect(resolved.render(context)).toBe('{foo}');
    expect(sourceValue.parent).toBe(blockNode);
    expect(blockNode.toTrimmedString()).toBe('{$value}');
  });
});
