import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { Bool, defaultguard } from '../index.js';
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
    expect(truthy.registrationPrepared).toBe(false);

    context.isDefault = false;
    expect(falsy.render(context)).toBe('false');
    expect(falsy.evaluated).toBe(false);
    expect(falsy.registrationPrepared).toBe(false);
  });

  it('writes resolved default guard render output into flat buffers', async () => {
    const buffer = createRenderBuffer('flat');
    const node = defaultguard('default');
    let resolveCalls = 0;
    node.resolve = () => {
      resolveCalls++;
      return node.evalNode(context);
    };

    context.isDefault = true;

    expect(await node.render(context, buffer)).toBe('true');
    expect(buffer.parts).toEqual(['true']);
    expect(resolveCalls).toBe(0);
  });

  it('renders default guard values without allocating a Bool output node', () => {
    const originalToTrimmedString = Bool.prototype.toTrimmedString;
    let boolStringCalls = 0;
    Bool.prototype.toTrimmedString = function toTrimmedStringForCounting(
      this: Bool,
      ...args: Parameters<Bool['toTrimmedString']>
    ) {
      boolStringCalls++;
      return originalToTrimmedString.apply(this, args);
    };
    try {
      context.isDefault = true;

      expect(defaultguard('default').render(context)).toBe('true');
      expect(boolStringCalls).toBe(0);
    } finally {
      Bool.prototype.toTrimmedString = originalToTrimmedString;
    }
  });

  it('resolves default guard values without touching render state', async () => {
    context.isDefault = true;
    const node = defaultguard('default');

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBe('true');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('returns fresh public Bool nodes because resolved values are mutable', () => {
    context.isDefault = true;
    const node = defaultguard('default');

    const first = node.resolve(context);
    const second = node.resolve(context);
    first.value = false;

    expect(first).not.toBe(second);
    expect(second.value).toBe(true);
  });
});
