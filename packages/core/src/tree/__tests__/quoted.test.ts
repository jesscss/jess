import { describe, expect, it } from 'vitest';
import { any, expr, interpolated, quoted } from '../index.js';
import { Context } from '../../context.js';
import { addEdge, getEdge } from '../util/cursor.js';
import type { RenderKey } from '../node.js';

describe('Quoted', () => {
  it('serializes a quoted string', () => {
    const node = quoted('red');

    expect(node.toTrimmedString()).toBe('"red"');
  });

  it('evaluates to a materialized quoted node without mutating the canonical node', async () => {
    const context = new Context();
    const node = quoted(interpolated({
      source: '%%',
      replacements: [expr(any('blue'))]
    }));

    const evald = await node.eval(context);

    expect(evald.toTrimmedString({ context })).toBe('"blue"');
    expect(node.toTrimmedString()).toBe('"$(blue)"');
    expect(node.get('value')).toBeTypeOf('object');
    expect(node.get('value')).not.toBe('blue');
  });

  it('keeps the canonical root unchanged when eval returns a derived quoted node', async () => {
    const context = new Context();
    const node = quoted(interpolated({
      source: '%%',
      replacements: [expr(any('blue'))]
    }));

    const evald = await node.eval(context);

    expect(evald).not.toBe(node);
    expect(evald.toTrimmedString({ context })).toBe('"blue"');
    expect(node.toTrimmedString()).toBe('"$(blue)"');
    expect(node.toTrimmedString({ context })).toBe('"$(blue)"');
    expect(node.get('value')).toBeTypeOf('object');
    expect(node.get('value')).not.toBe('blue');
  });

  it('keeps valueOf() canonical on the original node', () => {
    const node = quoted('red');
    expect(node.valueOf()).toBe('red');
  });

  it('keeps compare() canonical on the original node', () => {
    const left = quoted('red');
    const right = quoted('red');
    expect(left.compare(right)).toBe(0);
  });

  it('reads a render-key alternate child without mutating the canonical value', () => {
    const canonical = expr(any('blue'));
    const alternate = expr(any('green'));
    const node = quoted(canonical);
    const key = {} as RenderKey;
    const cursor = { node, renderKey: key };

    expect(node.value).toBe(canonical);
    expect(getEdge(cursor, 'value')?.node).toBe(canonical);

    addEdge(node, 'value', key, alternate);

    expect(getEdge(cursor, 'value')?.node).toBe(alternate);
    expect(node.value).toBe(canonical);
  });
});
