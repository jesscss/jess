import { describe, expect, it } from 'vitest';
import { any, paren, ref, rules, vardecl } from '../index.js';
import { Context } from '../../context.js';
import { setField } from '../util/field-helpers.js';
import { addEdge, getEdge } from '../util/cursor.js';
import type { RenderKey } from '../node.js';

describe('Paren', () => {
  it('serializes wrapped values on the public render path', () => {
    const node = paren(any('red'));

    expect(node.toTrimmedString()).toBe('(red)');
  });

  it('reads a state-patched value without changing canonical render output', () => {
    const ctx = new Context();
    const node = paren(any('red'));

    setField(node, 'value', any('blue'), ctx);

    expect(node.toTrimmedString({ context: ctx })).toBe('(blue)');
    expect(node.toTrimmedString()).toBe('(red)');
  });

  it('reads a state-patched escaped option without changing canonical render output', () => {
    const ctx = new Context();
    const node = paren(any('red'));

    setField(node, 'options', { escaped: true }, ctx);

    expect(node.toTrimmedString({ context: ctx })).toBe('~(red)');
    expect(node.toTrimmedString()).toBe('(red)');
  });

  it('evals without overwriting the canonical child when the wrapper is preserved', async () => {
    const ctx = new Context();
    const original = ref({ key: 'color' }, { type: 'variable' });
    const root = rules([
      vardecl({ name: 'color', value: any('red') })
    ]);
    const node = paren(original);
    ctx.root = root;
    ctx.rulesContext = root;

    const evald = await node.eval(ctx);

    expect(evald.toTrimmedString({ context: ctx })).toBe('(red)');
    expect(node.get('value')).toBe(original);
    expect(node.toTrimmedString()).toBe('($color)');
  });

  it('eval uses a state-patched escaped option without mutating canonical wrapper behavior', async () => {
    const ctx = new Context();
    const original = ref({ key: 'color' }, { type: 'variable' });
    const root = rules([
      vardecl({ name: 'color', value: any('red') })
    ]);
    const node = paren(original);
    ctx.root = root;
    ctx.rulesContext = root;

    setField(node, 'options', { escaped: true }, ctx);

    const evald = await node.eval(ctx);

    expect(evald.toTrimmedString({ context: ctx })).toBe('red');
    expect(node.get('value')).toBe(original);
    expect(node.toTrimmedString({ context: ctx })).toBe('~($color)');
    expect(node.toTrimmedString()).toBe('($color)');
  });

  it('reads a singular child through the cursor model', () => {
    const canonical = any('red');
    const alternate = any('blue');
    const node = paren(canonical);
    const key = {} as RenderKey;
    const cursor = { node, key };

    expect(getEdge(cursor, 'value')?.node).toBe(canonical);

    addEdge(node, 'value', key, alternate);

    expect(getEdge(cursor, 'value')?.node).toBe(alternate);
    expect(node.value).toBe(canonical);
  });
});
