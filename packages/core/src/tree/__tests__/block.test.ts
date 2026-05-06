import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, block, ref, rules, type Rules as RulesClass, vardecl } from '../index.js';
import { createRenderBuffer } from '../util/render-buffer.js';

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

    expect(await blockNode.render(context, buffer)).toBe('{foo}');
    expect(buffer.parts).toEqual(['{foo}']);
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

    expect(`${resolved}`).toBe('{foo}');
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
    const resolved = await blockNode.resolve(context);

    expect(`${resolved}`).toBe('{foo}');
    expect(blockNode.toTrimmedString()).toBe('{$value}');
  });
});
