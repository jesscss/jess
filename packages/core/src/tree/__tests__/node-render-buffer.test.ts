import { describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any } from '../index.js';
import { Node } from '../node-base.js';
import { createRenderBuffer, renderNodeToBuffer } from '../util/render-buffer.js';

class AsyncResolvedNode extends Node<string> {
  override resolve() {
    return Promise.resolve(any('resolved'));
  }

  override toTrimmedString() {
    return 'source';
  }
}

describe('renderNodeToBuffer', () => {
  it('writes resolved node output into flat buffers', () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    const node = any('red');

    const out = renderNodeToBuffer(node, context, buffer);

    expect(out).toBe('red');
    expect(buffer.parts).toEqual(['red']);
  });

  it('keeps node render as the string path', () => {
    const context = new Context();
    const node = any('blue');

    expect(node.render(context)).toBe('blue');
  });

  it('keeps async resolution on the explicit buffer path', async () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    const node = new AsyncResolvedNode('source');

    await expect(renderNodeToBuffer(node, context, buffer)).resolves.toBe('resolved');
    expect(buffer.parts).toEqual(['resolved']);
  });

  it('requires explicit implementations for segmented rendering', () => {
    const context = new Context();
    const buffer = createRenderBuffer('segmented');
    const node = any('green');

    expect(() => renderNodeToBuffer(node, context, buffer)).toThrow(/segmented rendering/u);
  });
});
