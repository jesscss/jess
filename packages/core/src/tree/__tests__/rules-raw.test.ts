import { describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, decl, rawrules } from '../index.js';
import { createRenderBuffer } from '../util/render-buffer.js';

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

  it('writes raw child output into render buffers', () => {
    const context = new Context();
    const buffer = createRenderBuffer('segmented');
    const node = rawrules([
      decl({ name: any('color'), value: any('red') })
    ]);
    let resolveCalls = 0;
    node.resolve = () => {
      resolveCalls++;
      return node;
    };

    expect(node.render(context, buffer)).toBe('color: red');
    expect(buffer.segments).toEqual(['color: red']);
    expect(resolveCalls).toBe(0);
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
  });

  it('renders raw child output directly without public resolve', () => {
    const context = new Context();
    const node = rawrules([
      decl({ name: any('color'), value: any('red') })
    ]);
    node.resolve = () => {
      throw new Error('RawRules direct render should serialize source syntax');
    };

    expect(node.render(context)).toBe('color: red');
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
  });
});
