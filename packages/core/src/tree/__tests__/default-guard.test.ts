import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { defaultguard } from '../index.js';

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

  it('resolves default guard values without touching render state', async () => {
    context.isDefault = true;
    const resolved = await defaultguard('default').resolve(context);

    expect(resolved.toTrimmedString()).toBe('true');
    expect(context.printState.writer).toBeUndefined();
  });
});
