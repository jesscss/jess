import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, coll, decl } from '../index.js';

describe('Collection', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders collection syntax through toTrimmedString()', () => {
    const node = coll([
      decl({ name: any('color'), value: any('red') })
    ]);

    expect(node.toTrimmedString()).toBeString(`
      {
        color: red;
      }
    `);
  });

  it('renders collection values through render(context)', () => {
    const node = coll([
      decl({ name: any('color'), value: any('red') })
    ]);

    expect(node.render(context)).toBeString(`
      {
        color: red;
      }
    `);
  });

  it('resolves collections without touching render state', async () => {
    const node = coll([
      decl({ name: any('color'), value: any('red') })
    ]);

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBeString(`
      {
        color: red;
      }
    `);
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });
});
