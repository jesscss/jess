import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { extend, el, N } from '../index.js';
import { ExtendList } from '../extend-list.js';
import { isNode } from '../util/is-node.js';

let context: Context;

describe('Extend', () => {
  beforeEach(() => {
    context = new Context();
  });

  it('resolves unrooted extend directives without touching render state', async () => {
    const node = extend({ target: el('.base') });

    const resolved = await node.resolve(context);

    expect(isNode(resolved, N.Nil)).toBe(true);
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('resolves extend lists without eval stamping the source list', () => {
    const node = new ExtendList([
      extend({ target: el('.base') })
    ]);

    const resolved = node.resolve(context);

    expect(resolved).toBe(node);
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });
});
