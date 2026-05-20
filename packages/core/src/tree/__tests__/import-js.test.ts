import { describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { js, quoted } from '../index.js';
import { createRenderBuffer } from '../util/render-buffer.js';

describe('JsImport', () => {
  it('serializes JS import source syntax through toTrimmedString()', () => {
    const node = js({ path: quoted('foo.js') }, { namespace: 'foo' });

    expect(node.toTrimmedString()).toBe('@-use "foo.js" as foo;');
  });

  it('resolves JS import directives without eval stamping source nodes', () => {
    const context = new Context();
    const node = js({ path: quoted('foo.js') }, { namespace: 'foo' });

    const resolved = node.resolve(context);

    expect(resolved).toBe(node);
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('writes source import syntax into render buffers', () => {
    const context = new Context();
    const buffer = createRenderBuffer('segmented');
    const node = js({ path: quoted('foo.js') }, { namespace: 'foo' });
    let resolveCalls = 0;
    node.resolve = () => {
      resolveCalls++;
      return node;
    };

    expect(node.render(context, buffer)).toBe('@-use "foo.js" as foo;');
    expect(buffer.segments).toEqual(['@-use "foo.js" as foo;']);
    expect(resolveCalls).toBe(0);
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
  });

  it('renders source import syntax directly without public resolve', () => {
    const context = new Context();
    const node = js({ path: quoted('foo.js') }, { namespace: 'foo' });
    node.resolve = () => {
      throw new Error('JsImport direct render should serialize source syntax');
    };

    expect(node.render(context)).toBe('@-use "foo.js" as foo;');
    expect(node.evaluated).toBe(false);
    expect(node.preEvaluated).toBe(false);
  });
});
