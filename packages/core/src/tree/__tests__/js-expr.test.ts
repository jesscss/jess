import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { JsExpression } from '../js-expr.js';
import { createRenderBuffer } from '../util/render-buffer.js';

let context: Context;

describe('JsExpression', () => {
  beforeEach(() => {
    context = new Context();
  });

  it('resolves JavaScript expressions without touching render state', async () => {
    const node = new JsExpression('"blue"');

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBe('blue');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('writes evaluated JavaScript expression output into render buffers', async () => {
    const node = new JsExpression('"blue"');
    const buffer = createRenderBuffer('segmented');
    const originalResolve = node.resolve;
    let resolveCalls = 0;
    node.resolve = function countResolveCalls(
      this: JsExpression,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };

    const rendered = await Promise.resolve(node.render(context, buffer));

    expect(rendered).toBe('blue');
    expect(buffer.segments).toEqual(['blue']);
    expect(resolveCalls).toBe(0);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('renders evaluated JavaScript expression output directly without public resolve', async () => {
    const node = new JsExpression('"blue"');
    node.resolve = () => {
      throw new Error('JsExpression direct render should evaluate natively');
    };

    await expect(Promise.resolve(node.render(context))).resolves.toBe('blue');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });
});
