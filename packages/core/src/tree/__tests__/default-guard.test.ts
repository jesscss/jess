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
    context.isDefault = true;
    expect(defaultguard('default').render(context)).toBe('true');

    context.isDefault = false;
    expect(defaultguard('default').render(context)).toBe('false');
  });

  it('resolves default guard values without touching render state', async () => {
    context.isDefault = true;
    const resolved = await defaultguard('default').resolve(context);

    expect(resolved.toTrimmedString()).toBe('true');
    expect(context.printState.writer).toBeUndefined();
  });
});
