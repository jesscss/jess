import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Context, TreeContext } from '../../context.js';
import {
  any,
  Any,
  Dimension,
  Negative,
  dimension,
  negative,
  num,
  ref,
  Rules,
  rules,
  vardecl
} from '../index.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { OutputWriter } from '../util/print.js';

class CountingWriter extends OutputWriter {
  marks = 0;
  reads = 0;

  override mark(): number {
    this.marks++;
    return super.mark();
  }

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }
}

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

  it('preserves parser tree context on construction', () => {
    const treeContext = new TreeContext();
    const node = new Negative(num(10), undefined, undefined, treeContext);

    expect(node._treeContext).toBe(treeContext);
  });

  it('stores the negative child on a constructor-owned direct field', () => {
    const value = num(10);
    const node = negative(value);

    expect(node.value).toBe(value);
    expect(Negative.childKeys).toEqual(['value']);
  });

  it('returns simple dimension negative syntax without writer readback', () => {
    const writer = new CountingWriter();

    expect(negative(dimension([10, 'px'])).toTrimmedString({ writer })).toBe('-10px');
    expect(writer.toString()).toBe('-10px');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('returns simple Any negative syntax without writer readback', () => {
    const writer = new CountingWriter();

    expect(negative(any('token')).toTrimmedString({ writer })).toBe('-token');
    expect(writer.toString()).toBe('-token');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
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
    expect(negativeNode.registrationPrepared).toBe(false);
  });

  it('writes scalar negative dimensions to flat buffers without print-state setup', () => {
    const buffer = createRenderBuffer('flat');

    expect(negative(num(20)).render(context, buffer)).toBe('-20');
    expect(buffer.parts).toEqual(['-20']);
    expect(context.printState.writer).toBeUndefined();
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
      expect(negativeNode.registrationPrepared).toBe(false);
    } finally {
      operate.mockRestore();
    }
  });

  it('renders resolved Any values without child render or operation transport', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: any('token')
      })
    ]);
    await setRoot(node);
    const originalRender = Any.prototype.render;
    const originalOperate = Any.prototype.operate;
    Any.prototype.render = function renderForCounting() {
      throw new Error('Negative.render should write resolved Any values directly');
    };
    Any.prototype.operate = function operateForCounting() {
      throw new Error('Negative.render should not operate resolved Any values');
    };

    try {
      const negativeNode = negative(ref({ key: 'rhs' }, { type: 'variable' }));

      expect(negativeNode.render(context)).toBe('-token');
      expect(negativeNode.registrationPrepared).toBe(false);
    } finally {
      Any.prototype.render = originalRender;
      Any.prototype.operate = originalOperate;
    }
  });

  it('renders sync negative values without may-async continuation scaffolding', () => {
    const negativeNode = negative(num(20));
    const originalEval = negativeNode.value.eval;
    negativeNode.value.eval = function evalSyncOnly(
      this: typeof negativeNode.value,
      renderContext: Context
    ) {
      const out = originalEval.call(this, renderContext);
      if (out instanceof Promise) {
        throw new Error('Negative.render should keep sync values on the sync path');
      }
      return out;
    };

    expect(negativeNode.render(context)).toBe('-20');
  });

  it('renders scalar negative dimensions without writer readback', () => {
    const writer = new CountingWriter();

    expect(negative(num(20)).render(context, { writer })).toBe('-20');
    expect(writer.toString()).toBe('-20');
    expect(writer.reads).toBe(0);
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
    expect(negativeNode.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('resolves negative Any values as scalar output nodes', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: any('token')
      })
    ]);
    await setRoot(node);
    const originalOperate = Any.prototype.operate;
    Any.prototype.operate = function operateForCounting() {
      throw new Error('Negative.resolve should not operate resolved Any values');
    };

    try {
      const negativeNode = negative(ref({ key: 'rhs' }, { type: 'variable' }));
      const resolved = await negativeNode.resolve(context);

      expect(resolved).toBeInstanceOf(Any);
      expect(resolved.toTrimmedString()).toBe('-token');
      expect(negativeNode.registrationPrepared).toBe(false);
      expect(context.printState.writer).toBeUndefined();
    } finally {
      Any.prototype.operate = originalOperate;
    }
  });
});
