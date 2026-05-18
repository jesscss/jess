import { describe, expect, it } from 'vitest';
import { ExtendFlag, el, extend } from '../index.js';
import { Context } from '../../context.js';
import { extendList } from '../extend-list.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer, renderNodeToBuffer } from '../util/render-buffer.js';

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

describe('Extend', () => {
  it('streams source and target selectors without capture scaffolding', () => {
    const writer = new CountingWriter();
    const node = extend({
      selector: el('.source'),
      target: el('.target'),
      flag: ExtendFlag.Exact
    });

    expect(node.toTrimmedString({ writer })).toBe('$extend .source -> .target !exact;');
    expect(writer.captures).toBe(0);
  });

  it('writes no CSS for extend buffers while evaluating without public resolve', async () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    const node = extend({
      target: el('.target'),
      flag: ExtendFlag.Exact
    });
    node.resolve = () => {
      throw new Error('Extend buffer render should use evalNode');
    };

    await expect(Promise.resolve(renderNodeToBuffer(node, context, buffer))).resolves.toBe('');

    expect(buffer.parts).toEqual([]);
    expect(node.evaluated).toBe(false);
  });

  it('writes no CSS for extend-list buffers without public resolve', async () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    const node = extendList([
      extend({ target: el('.one'), flag: ExtendFlag.Exact }),
      extend({ target: el('.two'), flag: ExtendFlag.All })
    ]);
    node.resolve = () => {
      throw new Error('ExtendList buffer render should stay invisible');
    };

    await expect(Promise.resolve(renderNodeToBuffer(node, context, buffer))).resolves.toBe('');

    expect(buffer.parts).toEqual([]);
    expect(node.evaluated).toBe(false);
  });
});
