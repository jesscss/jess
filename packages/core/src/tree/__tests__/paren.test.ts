import { describe, expect, it } from 'vitest';
import { any, paren, ref, rules, vardecl } from '../index.js';
import { Context } from '../../context.js';
import { addEdge, getEdge } from '../util/cursor.js';
import type { RenderKey } from '../node.js';

describe('Paren', () => {
  it('serializes wrapped values on the public render path', () => {
    const node = paren(any('red'));

    expect(node.toTrimmedString()).toBe('(red)');
  });

  it('reads a cloned value without changing canonical render output', () => {
    const ctx = new Context();
    const node = paren(any('red'));
    const clonedNode = node.clone();
    const patchedValue = any('blue');

    clonedNode.adopt(patchedValue, ctx);
    (clonedNode as unknown as { value: ReturnType<typeof any> }).value = patchedValue;

    expect(clonedNode.toTrimmedString({ context: ctx })).toBe('(blue)');
    expect(node.toTrimmedString()).toBe('(red)');
  });

  it('reads a cloned escaped option without changing canonical render output', () => {
    const ctx = new Context();
    const node = paren(any('red'));
    const clonedNode = node.clone();

    clonedNode.options = { escaped: true };

    expect(clonedNode.toTrimmedString({ context: ctx })).toBe('~(red)');
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

  it('eval uses a cloned escaped option without mutating canonical wrapper behavior', async () => {
    const ctx = new Context();
    const original = ref({ key: 'color' }, { type: 'variable' });
    const root = rules([
      vardecl({ name: 'color', value: any('red') })
    ]);
    const node = paren(original);
    const clonedNode = node.clone();
    ctx.root = root;
    ctx.rulesContext = root;

    clonedNode.options = { escaped: true };

    const evald = await clonedNode.eval(ctx);

    expect(evald.toTrimmedString({ context: ctx })).toBe('red');
    expect(node.get('value')).toBe(original);
    expect(clonedNode.toTrimmedString({ context: ctx })).toBe('~($color)');
    expect(node.toTrimmedString()).toBe('($color)');
  });

  it('reads a singular child through the cursor model', () => {
    const canonical = any('red');
    const alternate = any('blue');
    const node = paren(canonical);
    const key = {} as RenderKey;
    const cursor = { node, renderKey: key };

    expect(getEdge(cursor, 'value')?.node).toBe(canonical);

    addEdge(node, 'value', key, alternate);

    expect(getEdge(cursor, 'value')?.node).toBe(alternate);
    expect(node.value).toBe(canonical);
  });
});
