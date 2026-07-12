import { describe, it, expect, beforeEach } from 'vitest';
import { nil } from '../index.js';
import { Context, TreeContext } from '../../context.js';
import { createRenderBuffer } from '../util/render-buffer.js';

describe('Nil', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('preserves parser tree context on construction', () => {
    const treeContext = new TreeContext();
    const node = nil(undefined, undefined, undefined, treeContext);

    expect(node._treeContext).toBe(treeContext);
  });

  it('keeps nil source serializers empty', () => {
    const node = nil();

    expect(node.toTrimmedString()).toBe('');
    expect(node.toString()).toBe('');
  });

  it('renders nil values through render(context) as empty output', () => {
    const node = nil();

    expect(node.render(context)).toBe('');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('keeps flat buffers empty for nil render output', () => {
    const buffer = createRenderBuffer('flat');
    const node = nil();

    expect(node.render(context, buffer)).toBe('');
    expect(buffer.parts).toEqual([]);
  });

  it('resolves nil values without touching render state', async () => {
    const node = nil();

    const resolved = await node.resolve(context);

    expect(resolved).toBeInstanceOf((nil()).constructor);
    expect(resolved.value).toBe('');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });
});
