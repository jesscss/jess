import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { JsExpression } from '../js-expr.js';
import { Any } from '../any.js';
import { Num } from '../number.js';
import { JsObject } from '../js-object.js';
import { createRenderBuffer } from '../util/render-buffer.js';

let context: Context;

declare global {
  // Test-only bridge for JavaScript expressions evaluated through global eval.
  var jessJsExpressionNum: typeof Num | undefined;
}

describe('JsExpression', () => {
  beforeEach(() => {
    context = new Context();
  });

  it('resolves JavaScript expressions without touching render state', async () => {
    const node = new JsExpression('"blue"');

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBe('blue');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('writes evaluated JavaScript expression output into render buffers', async () => {
    const node = new JsExpression('"blue"');
    const buffer = createRenderBuffer('segmented');
    const originalResolve = node.resolve;
    let resolveCalls = 0;
    node.resolve = function countResolveCalls(
      this: JsExpression,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };

    const rendered = await Promise.resolve(node.render(context, buffer));

    expect(rendered).toBe('blue');
    expect(buffer.segments).toEqual(['blue']);
    expect(resolveCalls).toBe(0);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('renders evaluated JavaScript expression output directly without public resolve', async () => {
    const node = new JsExpression('"blue"');
    node.resolve = () => {
      throw new Error('JsExpression direct render should evaluate natively');
    };

    await expect(Promise.resolve(node.render(context))).resolves.toBe('blue');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('renders primitive string results without materializing an Any output node', async () => {
    const node = new JsExpression('"blue"');
    const originalRender = Any.prototype.render;
    Any.prototype.render = function renderShouldNotRun(): never {
      throw new Error('JsExpression.render should not materialize Any for primitive strings');
    };
    try {
      await expect(Promise.resolve(node.render(context))).resolves.toBe('blue');
    } finally {
      Any.prototype.render = originalRender;
    }
  });

  it('renders additional primitive results without materializing Any output nodes', async () => {
    const originalRender = Any.prototype.render;
    Any.prototype.render = function renderShouldNotRun(): never {
      throw new Error('JsExpression.render should not materialize Any for primitive values');
    };
    try {
      await expect(Promise.resolve(new JsExpression('42').render(context))).resolves.toBe('42');
      await expect(Promise.resolve(new JsExpression('true').render(context))).resolves.toBe('true');
      await expect(Promise.resolve(new JsExpression('null').render(context))).resolves.toBe('');
      await expect(Promise.resolve(new JsExpression('undefined').render(context))).resolves.toBe('');
      await expect(Promise.resolve(new JsExpression('Promise.resolve("async-blue")').render(context))).resolves.toBe('async-blue');
    } finally {
      Any.prototype.render = originalRender;
    }
  });

  it('keeps node/object JavaScript results on the public render fallback path', async () => {
    const nodeResult = new JsExpression('new globalThis.jessJsExpressionNum(7)');
    const objectResult = new JsExpression('({ value: "raw-object" })');
    const originalRender = Num.prototype.render;
    const originalGlobal = globalThis.jessJsExpressionNum;
    let nodeRenderCalls = 0;
    globalThis.jessJsExpressionNum = Num;
    Num.prototype.render = function countNumRender(
      this: Num,
      ...args: Parameters<Num['render']>
    ): ReturnType<Num['render']> {
      nodeRenderCalls++;
      return originalRender.apply(this, args);
    };
    try {
      await expect(Promise.resolve(nodeResult.render(context))).resolves.toBe('7');
      await expect(Promise.resolve(objectResult.render(context))).resolves.toBe('raw-object');
      expect(nodeRenderCalls).toBe(1);
    } finally {
      Num.prototype.render = originalRender;
      if (originalGlobal === undefined) {
        delete globalThis.jessJsExpressionNum;
      } else {
        globalThis.jessJsExpressionNum = originalGlobal;
      }
    }
  });

  it('keeps object fallback rendering on the public wrapper path', async () => {
    const objectResult = new JsExpression('({ nested: { value: "kept-public" } })');
    const originalRender = JsObject.prototype.render;
    let objectRenderCalls = 0;
    JsObject.prototype.render = function countObjectRender(
      this: JsObject,
      ...args: Parameters<JsObject['render']>
    ): ReturnType<JsObject['render']> {
      objectRenderCalls++;
      return originalRender.apply(this, args);
    };
    try {
      await expect(Promise.resolve(objectResult.render(context))).resolves.toBe('[object Object]');
      expect(objectRenderCalls).toBe(1);
    } finally {
      JsObject.prototype.render = originalRender;
    }
  });
});
