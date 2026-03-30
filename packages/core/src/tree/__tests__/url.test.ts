import { describe, expect, it, vi } from 'vitest';
import { any, quoted, url } from '../index.js';
import { Context } from '../../context.js';
import { addEdge, getEdge } from '../util/cursor.js';
import type { RenderKey } from '../node.js';

describe('Url', () => {
  it('eval stores an evaluated child in the eval state without mutating the canonical value', async () => {
    const ctx = new Context();
    const original = quoted('a.png');
    const replacement = quoted('b.png');
    vi.spyOn(original, 'eval').mockReturnValue(replacement);

    const node = url(original);
    const evald = await node.eval(ctx);

    expect(evald).toBe(node);
    expect(node.value).toBe(replacement);
    expect(node.toTrimmedString({ context: ctx })).toBe('url("b.png")');
    expect(node.toTrimmedString()).toBe('url("b.png")');
  });

  it('keeps valueOf aligned with the evaluated child', async () => {
    const ctx = new Context();
    const original = quoted('a.png');
    const replacement = quoted('b.png');
    vi.spyOn(original, 'eval').mockReturnValue(replacement);

    const node = url(original);
    const evald = await node.eval(ctx);

    expect(evald).toBe(node);
    expect(node.value).toBe(replacement);
    expect(node.valueOf()).toBe('b.png');
    expect(evald.valueOf()).toBe('b.png');
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
    expect(node.value).toBe(replacement);
    expect(node.toTrimmedString({ context: ctx })).toBe('url(b.png)');
  });

  it('reads a singular child through the render-key cursor model', () => {
    const canonical = quoted('a.png');
    const alternate = quoted('b.png');
    const node = url(canonical);
    const key = {} as RenderKey;
    const cursor = { node, renderKey: key };

    expect(node.value).toBe(canonical);
    expect(getEdge(cursor, 'value')?.node).toBe(canonical);

    addEdge(node, 'value', key, alternate);

    expect(getEdge(cursor, 'value')?.node).toBe(alternate);
    expect(node.value).toBe(canonical);
  });
});
