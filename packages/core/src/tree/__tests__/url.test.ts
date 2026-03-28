import { describe, expect, it, vi } from 'vitest';
import { any, quoted, url } from '../index.js';
import { Context } from '../../context.js';

describe('Url', () => {
  it('eval stores an evaluated child in the eval state without mutating the canonical value', async () => {
    const ctx = new Context();
    const original = quoted('a.png');
    const replacement = quoted('b.png');
    vi.spyOn(original, 'eval').mockReturnValue(replacement);

    const node = url(original);
    const evald = await node.eval(ctx);

    expect(evald).toBe(node);
    expect(node.get('value', ctx)).toBe(replacement);
    expect(node.get('value')).toBe(original);
    expect(node.toTrimmedString({ context: ctx })).toBe('url("b.png")');
    expect(node.toTrimmedString()).toBe('url("a.png")');
  });

  it('keeps valueOf canonical after a state-only eval replacement', async () => {
    const ctx = new Context();
    const original = quoted('a.png');
    const replacement = quoted('b.png');
    vi.spyOn(original, 'eval').mockReturnValue(replacement);

    const node = url(original);
    const evald = await node.eval(ctx);

    expect(evald).toBe(node);
    expect(node.get('value', ctx)).toBe(replacement);
    expect(node.valueOf()).toBe('a.png');
    expect(evald.valueOf()).toBe('a.png');
    expect(node.pathValue(ctx)).toBe('b.png');
    expect(evald.pathValue(ctx)).toBe('b.png');
    expect(node.toTrimmedString({ context: ctx })).toBe('url("b.png")');
  });

  it('eval still replaces the child directly', async () => {
    const ctx = new Context();

    const original = any('a.png');
    const replacement = any('b.png');
    vi.spyOn(original, 'eval').mockReturnValue(replacement);

    const node = url(original);
    const evald = await node.eval(ctx);

    expect(evald).toBe(node);
    expect(node.get('value', ctx)).toBe(replacement);
    expect(node.toTrimmedString({ context: ctx })).toBe('url(b.png)');
  });
});
