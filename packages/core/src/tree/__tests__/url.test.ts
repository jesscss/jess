import { describe, expect, it, vi } from 'vitest';
import { any, expr, interpolated, quoted, url } from '../index.js';
import { Context } from '../../context.js';
import { addEdge, getEdge } from '../util/cursor.js';
import type { RenderKey } from '../node.js';

describe('Url', () => {
  it('eval returns a derived url without mutating the canonical child', async () => {
    const ctx = new Context();
    const original = quoted(interpolated({
      source: '%%',
      replacements: [expr(any('b.png'))]
    }));

    const node = url(original);
    const evald = await node.eval(ctx);

    expect(evald).not.toBe(node);
    expect(node.value).toBe(original);
    expect(evald.toTrimmedString({ context: ctx })).toBe('url("b.png")');
    expect(node.toTrimmedString()).toBe('url("$(b.png)")');
  });

  it('keeps derived valueOf aligned with the evaluated child while the canonical root stays unchanged', async () => {
    const ctx = new Context();
    const original = quoted(interpolated({
      source: '%%',
      replacements: [expr(any('b.png'))]
    }));

    const node = url(original);
    const evald = await node.eval(ctx);

    expect(evald).not.toBe(node);
    expect(node.value).toBe(original);
    expect(evald.valueOf()).toBe('b.png');
    expect(evald.pathValue(ctx)).toBe('b.png');
    expect(evald.toTrimmedString({ context: ctx })).toBe('url("b.png")');
  });

  it('eval returns a derived url when an unquoted child changes', async () => {
    const ctx = new Context();

    const original = any('a.png');
    const replacement = any('b.png');
    vi.spyOn(original, 'eval').mockReturnValue(replacement);

    const node = url(original);
    const evald = await node.eval(ctx);

    expect(evald).not.toBe(node);
    expect(node.value).toBe(original);
    expect(evald.toTrimmedString({ context: ctx })).toBe('url(b.png)');
    expect(node.toTrimmedString()).toBe('url(a.png)');
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
