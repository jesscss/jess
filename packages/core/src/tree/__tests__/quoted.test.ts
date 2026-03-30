import { describe, expect, it } from 'vitest';
import { any, expr, interpolated, quoted } from '../index.js';
import { Context } from '../../context.js';
import { setField } from '../util/field-helpers.js';
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

  it('evaluates through a eval state without overwriting the canonical value', async () => {
    const context = new Context();
    const node = quoted(interpolated({
      source: '%%',
      replacements: [expr(any('blue'))]
    }));

    const evald = await node.eval(context);

    expect(evald).toBe(node);
    expect(node.toTrimmedString({ context })).toBe('"blue"');
    expect(node.toTrimmedString()).toBe('"$(blue)"');
    expect(node.get('value')).toBeTypeOf('object');
    expect(node.get('value')).not.toBe('blue');
  });

  it('keeps valueOf() canonical across different eval states', () => {
    const node = quoted('red');
    const ctx1 = new Context();
    const ctx2 = new Context();

    setField(node, 'value', 'cyan', ctx1);
    setField(node, 'value', 'magenta', ctx2);

    expect(node.toTrimmedString({ context: ctx1 })).toBe('"cyan"');
    expect(node.toTrimmedString({ context: ctx2 })).toBe('"magenta"');
    expect(node.valueOf()).toBe('red');
  });

  it('keeps compare() canonical across different eval states', () => {
    const left = quoted('red');
    const right = quoted('red');
    const ctx1 = new Context();
    const ctx2 = new Context();

    setField(left, 'value', 'cyan', ctx1);
    setField(left, 'value', 'magenta', ctx2);

    expect(left.toTrimmedString({ context: ctx1 })).toBe('"cyan"');
    expect(left.toTrimmedString({ context: ctx2 })).toBe('"magenta"');
    expect(left.compare(right)).toBe(0);
  });

  it('reads a render-key alternate child without mutating the canonical value', () => {
    const canonical = expr(any('blue'));
    const alternate = expr(any('green'));
    const node = quoted(canonical);
    const key = {} as RenderKey;
    const cursor = { node, key };

    expect(node.value).toBe(canonical);
    expect(getEdge(cursor, 'value')?.node).toBe(canonical);

    addEdge(node, 'value', key, alternate);

    expect(getEdge(cursor, 'value')?.node).toBe(alternate);
    expect(node.value).toBe(canonical);
  });
});
