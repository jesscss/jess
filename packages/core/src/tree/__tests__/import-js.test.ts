import { describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, expr, js, quoted } from '../index.js';

describe('JsImport', () => {
  it('evaluates a dynamic path on the normal public path', async () => {
    const context = new Context();
    const node = js({
      path: quoted(expr(any('module.js'))),
      imports: ['foo']
    });

    const evald = await node.eval(context);

    expect(evald.toTrimmedString({ context })).toBe('@-from "module.js" import ( foo );');
  });

  it('does not overwrite the canonical path', async () => {
    const context = new Context();
    const originalPath = quoted(expr(any('module.js')));
    const node = js({
      path: originalPath,
      imports: ['foo']
    });

    const evald = await node.eval(context);

    expect(evald.toTrimmedString({ context })).toBe('@-from "module.js" import ( foo );');
    expect(node.toTrimmedString()).toBe('@-from "$(module.js)" import ( foo );');
    expect(evald).not.toBe(node);
    expect(node.get('path')).toBe(originalPath);
  });
});
