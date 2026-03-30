import { describe, expect, it } from 'vitest';
import { any, expr, interpolated, interpolatedSelector } from '../index.js';
import { Context } from '../../context.js';
import { addEdge, getEdge } from '../util/cursor.js';
import type { RenderKey } from '../node.js';

describe('InterpolatedSelector', () => {
  it('serializes the wrapped interpolated selector', () => {
    const node = interpolatedSelector(interpolated({
      source: '.%%',
      replacements: [any('button')]
    }));

    expect(node.toTrimmedString()).toBe('.button');
  });

  it('evaluates the wrapped interpolated selector to a selector node', async () => {
    const ctx = new Context();
    const node = interpolatedSelector(interpolated({
      source: '.%%',
      replacements: [expr(any('button'))]
    }));

    const evald = await node.eval(ctx);

    expect(evald.toTrimmedString()).toBe('.button');
  });

  it('keeps canonical child access direct while a render key selects an alternate child', () => {
    const canonical = interpolated({
      source: '.%%',
      replacements: [any('button')]
    });
    const alternate = interpolated({
      source: '.%%',
      replacements: [any('link')]
    });
    const node = interpolatedSelector(canonical);
    const key = Symbol('selector-interpolated') as RenderKey;
    const cursor = { node, key };

    expect(node.value).toBe(canonical);
    expect(getEdge(cursor, 'value')?.node).toBe(canonical);

    addEdge(node, 'value', key, alternate);

    expect(node.value).toBe(canonical);
    expect(getEdge(cursor, 'value')?.node).toBe(alternate);
  });
});
