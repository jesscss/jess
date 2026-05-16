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
    expect(node.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('writes evaluated JavaScript expression output into render buffers', async () => {
    const node = new JsExpression('"blue"');
    const buffer = createRenderBuffer('segmented');

    const rendered = await Promise.resolve(node.render(context, buffer));

    expect(rendered).toBe('blue');
    expect(buffer.segments).toEqual(['blue']);
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
  });
});
