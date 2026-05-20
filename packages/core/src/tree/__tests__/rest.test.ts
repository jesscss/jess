import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, rest } from '../index.js';
import { createRenderBuffer } from '../util/render-buffer.js';

describe('Rest', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders rest syntax through toTrimmedString()', () => {
    expect(rest('items').toTrimmedString()).toBe('...$$items');
    expect(rest(any('items')).toTrimmedString()).toBe('...$items');
  });

  it('renders rest values through render(context)', () => {
    const named = rest('items');
    const nodeNamed = rest(any('items'));

    expect(named.render(context)).toBe('...$$items');
    expect(nodeNamed.render(context)).toBe('...$items');
    expect(named.evaluated).toBe(false);
    expect(named.registrationPrepared).toBe(false);
    expect(nodeNamed.evaluated).toBe(false);
    expect(nodeNamed.registrationPrepared).toBe(false);
  });

  it('writes rest render output into flat buffers', async () => {
    const buffer = createRenderBuffer('flat');
    const node = rest('items');
    let resolveCalls = 0;
    node.resolve = () => {
      resolveCalls++;
      return node;
    };

    expect(await node.render(context, buffer)).toBe('...$$items');
    expect(buffer.parts).toEqual(['...$$items']);
    expect(resolveCalls).toBe(0);
  });

  it('resolves rest values without touching render state', async () => {
    const node = rest('items');

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBe('...$$items');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });
});
