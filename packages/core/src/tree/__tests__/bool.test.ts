import { describe, it, expect, beforeEach } from 'vitest';
import { Bool, bool } from '../index.js';
import { Context } from '../../context.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { cast } from '../util/cast.js';

describe('Bool', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders bool syntax through toTrimmedString()', () => {
    expect(bool(true).toTrimmedString()).toBe('true');
    expect(bool(false).toTrimmedString()).toBe('false');
  });

  it('renders bool values through render(context)', () => {
    const truthy = bool(true);
    const falsy = bool(false);

    expect(truthy.render(context)).toBe('true');
    expect(falsy.render(context)).toBe('false');
    expect(truthy.evaluated).toBe(false);
    expect(truthy.registrationPrepared).toBe(false);
    expect(falsy.evaluated).toBe(false);
    expect(falsy.registrationPrepared).toBe(false);
  });

  it('writes bool render output into flat buffers', async () => {
    const buffer = createRenderBuffer('flat');
    const node = bool(true);
    let resolveCalls = 0;
    node.resolve = () => {
      resolveCalls++;
      return node;
    };

    expect(await node.render(context, buffer)).toBe('true');
    expect(buffer.parts).toEqual(['true']);
    expect(resolveCalls).toBe(0);
  });

  it('resolves bool values without touching render state', async () => {
    const node = bool(true);

    const resolved = await node.resolve(context);

    expect(resolved).toBeInstanceOf((bool(true)).constructor);
    expect(resolved.value).toBe(true);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('casts boolean primitives to fresh public Bool nodes', () => {
    const first = cast(true);
    const second = cast(true);

    expect(first).toBeInstanceOf(Bool);
    expect(second).toBeInstanceOf(Bool);
    if (!(first instanceof Bool) || !(second instanceof Bool)) {
      throw new Error('Expected Bool cast results');
    }
    first.value = false;

    expect(first).not.toBe(second);
    expect(second.value).toBe(true);
  });
});
