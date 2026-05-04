import { describe, it, expect, beforeEach } from 'vitest';
import { bool } from '../index.js';
import { Context } from '../../context.js';

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
    expect(truthy.preEvaluated).toBe(false);
    expect(falsy.evaluated).toBe(false);
    expect(falsy.preEvaluated).toBe(false);
  });

  it('resolves bool values without touching render state', async () => {
    const node = bool(true);

    const resolved = await node.resolve(context);

    expect(resolved).toBeInstanceOf((bool(true)).constructor);
    expect(resolved.value).toBe(true);
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });
});
