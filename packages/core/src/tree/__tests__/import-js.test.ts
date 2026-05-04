import { describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { js, quoted } from '../index.js';

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
});
