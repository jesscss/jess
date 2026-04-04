import { describe, expect, it } from 'vitest';
import { any, rest } from '../index.js';
import { addEdge, getEdge } from '../util/cursor.js';
import type { RenderKey } from '../node.js';

describe('Rest', () => {
  it('serializes string-backed rest params with the current wrapper shape', () => {
    expect(rest('args').toTrimmedString()).toBe('...$$args');
  });

  it('serializes node-backed rest params through the wrapped value', () => {
    expect(rest(any('args')).toTrimmedString()).toBe('...$args');
  });

  it('keeps the canonical node-backed child direct while a render key selects an alternate child', () => {
    const canonical = any('args');
    const alternate = any('other');
    const node = rest(canonical);
    const key = {} as RenderKey;
    const cursor = { node, renderKey: key };

    expect(getEdge(cursor, 'value')?.node).toBe(canonical);

    addEdge(node, 'value', key, alternate);

    expect(getEdge(cursor, 'value')?.node).toBe(alternate);
    expect(node.value).toBe(canonical);
  });
});
