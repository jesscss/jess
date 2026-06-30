import { describe, expect, it } from 'vitest';
import { Context, TreeContext } from '../../context.js';
import { JsArray, JsFunction, JsObject } from '../index.js';

describe('JS host wrapper nodes', () => {
  it('preserves parser tree context on JS function construction', () => {
    const treeContext = new TreeContext();
    const node = new JsFunction({ name: 'unit', fn: () => 'ok' }, undefined, undefined, treeContext);

    expect(node._treeContext).toBe(treeContext);
  });

  it('resolves JS functions without eval stamping host values', () => {
    const context = new Context();
    const node = new JsFunction({ name: 'unit', fn: () => 'ok' });

    const resolved = node.resolve(context);

    expect(resolved).toBe(node);
    expect(node.registrationPrepared).toBe(false);
  });

  it('resolves JS objects without eval stamping host values', () => {
    const context = new Context();
    const node = new JsObject({ color: 'red' });

    const resolved = node.resolve(context);

    expect(resolved).toBe(node);
    expect(node.registrationPrepared).toBe(false);
  });

  it('resolves JS arrays without eval stamping host values', () => {
    const context = new Context();
    const node = new JsArray(['a', 'b']);

    const resolved = node.resolve(context);

    expect(resolved).toBe(node);
    expect(node.registrationPrepared).toBe(false);
  });
});
