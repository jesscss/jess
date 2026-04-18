import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { comment } from '../index.js';

describe('Comment', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders block comment syntax through toTrimmedString()', () => {
    expect(comment('/* keep me */').toTrimmedString()).toBe('/* keep me */');
  });

  it('renders visible block comments through render(context)', () => {
    expect(comment('/* keep me */').render(context)).toBe('/* keep me */');
  });

  it('resolves comments without touching render state', async () => {
    const resolved = await comment('/* keep me */').resolve(context);

    expect(resolved.toTrimmedString()).toBe('/* keep me */');
    expect(context.printState.writer).toBeUndefined();
  });
});
