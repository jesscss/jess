import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { co } from '../index.js';
import { createRenderBuffer } from '../util/render-buffer.js';

describe('Combinator', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders combinator syntax through toTrimmedString()', () => {
    expect(co('>').toTrimmedString()).toBe('>');
    expect(co('+').toTrimmedString()).toBe('+');
  });

  it('renders combinators through render(context)', () => {
    const child = co('>');
    const adjacent = co('+');

    expect(child.render(context)).toBe('>');
    expect(adjacent.render(context)).toBe('+');
    expect(child.evaluated).toBe(false);
    expect(child.registrationPrepared).toBe(false);
    expect(adjacent.evaluated).toBe(false);
    expect(adjacent.registrationPrepared).toBe(false);
  });

  it('writes combinator render output into flat buffers', async () => {
    const buffer = createRenderBuffer('flat');
    const node = co('>');
    let resolveCalls = 0;
    node.resolve = () => {
      resolveCalls++;
      return node;
    };

    expect(await node.render(context, buffer)).toBe('>');
    expect(buffer.parts).toEqual(['>']);
    expect(resolveCalls).toBe(0);
  });

  it('resolves combinators without touching render state', async () => {
    const node = co('>');

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBe('>');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });
});
