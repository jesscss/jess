import { describe, it, expect, beforeEach } from 'vitest';
import { nil } from '../index.js';
import { Context } from '../../context.js';

describe('Nil', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('keeps nil source serializers empty', () => {
    const node = nil();

    expect(node.toTrimmedString()).toBe('');
    expect(`${node}`).toBe('');
  });

  it('renders nil values through render(context) as empty output', () => {
    expect(nil().render(context)).toBe('');
  });

  it('resolves nil values without touching render state', async () => {
    const resolved = await nil().resolve(context);

    expect(resolved).toBeInstanceOf((nil()).constructor);
    expect(resolved.value).toBe('');
    expect(context.printState.writer).toBeUndefined();
  });
});
