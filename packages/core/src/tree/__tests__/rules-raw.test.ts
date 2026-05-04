import { describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, decl, rawrules } from '../index.js';

describe('RawRules', () => {
  it('serializes raw rules children without parent formatting', () => {
    const node = rawrules([
      decl({ name: any('color'), value: any('red') })
    ]);

    expect(node.toBraced()).toBe('{color: red}');
  });

  it('resolves raw rules as source-owned containers without eval stamping', () => {
    const context = new Context();
    const node = rawrules([
      decl({ name: any('color'), value: any('red') })
    ]);

    const resolved = node.resolve(context);

    expect(resolved).toBe(node);
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });
});
