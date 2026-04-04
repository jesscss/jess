import { describe, expect, it } from 'vitest';
import { el, selcap } from '../index.js';
import { addEdge, getEdge } from '../util/cursor.js';
import type { RenderKey } from '../node.js';

describe('SelectorCapture', () => {
  it('keeps canonical selector access direct while render-key edges can diverge', () => {
    const canonical = el('.a');
    const alternate = el('.b');
    const node = selcap(canonical);
    const key = {} as RenderKey;
    const cursor = { node, renderKey: key };

    expect(node.value).toBe(canonical);
    expect(getEdge(cursor, 'value')?.node).toBe(canonical);

    addEdge(node, 'value', key, alternate);

    expect(node.value).toBe(canonical);
    expect(getEdge(cursor, 'value')?.node).toBe(alternate);
  });
});
