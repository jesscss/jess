import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from '../../context.js';
import {
  any,
  Dimension,
  dimension,
  negative,
  num,
  ref,
  Rules,
  rules,
  vardecl
} from '../index.js';
import { createRenderBuffer } from '../util/render-buffer.js';

describe('Negative', () => {
  let context: Context;

  const setRoot = async (node: Rules): Promise<void> => {
    const evald = await node.eval(context);
    expect(evald).toBeInstanceOf(Rules);
    if (!(evald instanceof Rules)) {
      throw new Error('Expected Rules');
    }
    context.root = evald;
    context.rulesContext = evald;
  };

  beforeEach(() => {
    context = new Context();
  });

  it('renders negative syntax through toTrimmedString()', () => {
    expect(negative(num(10)).toTrimmedString()).toBe('-10');
  });

  it('renders negative values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: num(20)
      })
    ]);
    await setRoot(node);

    const negativeNode = negative(ref({ key: 'rhs' }, { type: 'variable' }));
    let negativeResolveCalls = 0;
    negativeNode.resolve = (renderContext: Context) => {
      negativeResolveCalls++;
      return negativeNode.evalNode(renderContext);
    };
    const rendered = negativeNode.render(context);

    expect(rendered).toBe('-20');
    expect(negativeResolveCalls).toBe(0);
    expect(negativeNode.evaluated).toBe(false);
    expect(negativeNode.registrationPrepared).toBe(false);
  });

  it('writes resolved negative render output into flat buffers', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: num(20)
      })
    ]);
    await setRoot(node);

    const buffer = createRenderBuffer('flat');
    const negativeNode = negative(ref({ key: 'rhs' }, { type: 'variable' }));
    let negativeResolveCalls = 0;
    negativeNode.resolve = (renderContext: Context) => {
      negativeResolveCalls++;
      return negativeNode.evalNode(renderContext);
    };
    expect(negativeNode.toTrimmedString()).not.toBe('-20');

    expect(await negativeNode.render(context, buffer)).toBe('-20');
    expect(buffer.parts).toEqual(['-20']);
    expect(negativeResolveCalls).toBe(0);
    expect(negativeNode.evaluated).toBe(false);
    expect(negativeNode.registrationPrepared).toBe(false);
  });

  it('renders resolved dimensions without creating an operated result node', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: num(20)
      })
    ]);
    await setRoot(node);

    const operate = vi.spyOn(Dimension.prototype, 'operate').mockImplementation(() => {
      throw new Error('Negative.render should not operate scalar dimensions');
    });
    try {
      const negativeNode = negative(ref({ key: 'rhs' }, { type: 'variable' }));

      expect(negativeNode.render(context)).toBe('-20');
      expect(operate).not.toHaveBeenCalled();
      expect(negativeNode.evaluated).toBe(false);
      expect(negativeNode.registrationPrepared).toBe(false);
    } finally {
      operate.mockRestore();
    }
  });

  it('keeps compound dimension negatives on the public operation boundary', async () => {
    context.opts.unitMode = 'preserve';
    const value = dimension({ number: 10, unit: 'px*em' });
    let operateCalls = 0;
    const originalOperate = value.operate;
    value.operate = function countOperateCalls(
      this: typeof value,
      ...args: Parameters<typeof originalOperate>
    ): ReturnType<typeof originalOperate> {
      operateCalls++;
      return originalOperate.apply(this, args);
    };
    const negativeNode = negative(value);

    const rendered = await Promise.resolve(negativeNode.render(context));

    expect(rendered).toContain('calc(');
    expect(rendered).toContain('px');
    expect(rendered).toContain('em');
    expect(operateCalls).toBe(1);
  });

  it('resolves negative values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: num(20)
      })
    ]);
    await setRoot(node);

    const negativeNode = negative(ref({ key: 'rhs' }, { type: 'variable' }));
    const resolved = await negativeNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('-20');
    expect(negativeNode.evaluated).toBe(false);
    expect(negativeNode.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });
});
