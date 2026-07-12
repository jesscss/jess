import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { defaultguard } from '../index.js';
import { createRenderBuffer } from '../util/render-buffer.js';

describe('DefaultGuard', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders default guard syntax through toTrimmedString()', () => {
    expect(defaultguard('default').toTrimmedString()).toBe('default');
  });

  it('renders default guard values through render(context)', () => {
    const truthy = defaultguard('default');
    const falsy = defaultguard('default');

    context.isDefault = true;
    expect(truthy.render(context)).toBe('true');
    expect(truthy.evaluated).toBe(false);
    expect(truthy.preEvaluated).toBe(false);

    context.isDefault = false;
    expect(falsy.render(context)).toBe('false');
    expect(falsy.evaluated).toBe(false);
    expect(falsy.preEvaluated).toBe(false);
  });

  it('writes resolved default guard render output into flat buffers', async () => {
    const buffer = createRenderBuffer('flat');
    const node = defaultguard('default');

    context.isDefault = true;

    expect(await node.render(context, buffer)).toBe('true');
    expect(buffer.parts).toEqual(['true']);
  });

  it('resolves default guard values without touching render state', async () => {
    context.isDefault = true;
    const node = defaultguard('default');

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBe('true');
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });
});
