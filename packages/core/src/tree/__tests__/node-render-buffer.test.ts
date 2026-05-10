import { describe, expect, it } from 'vitest';
import type { IToken } from 'chevrotain';
import { Context } from '../../context.js';
import { any, atrule, quoted, rules } from '../index.js';
import { Node } from '../node-base.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer, renderNodeToBuffer, renderNodeToString } from '../util/render-buffer.js';

class AsyncResolvedNode extends Node<string> {
  override resolve() {
    return Promise.resolve(any('resolved'));
  }

  override toTrimmedString() {
    return 'source';
  }
}

class RejectingNode extends Node<string> {
  override resolve() {
    return Promise.reject(new Error('nope'));
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

  it('does not write rejected async output into flat buffers', async () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    const node = new RejectingNode('source');

    await expect(renderNodeToBuffer(node, context, buffer)).rejects.toThrow('nope');
    expect(buffer.parts).toEqual([]);
  });

  it('renders async resolved output to strings without eval pre-materialization', async () => {
    const context = new Context();
    const node = new AsyncResolvedNode('source');

    await expect(renderNodeToString(node, context)).resolves.toBe('resolved');
  });

  it('renders through the provided writer when string output is requested', () => {
    const context = new Context();
    const writer = new OutputWriter();
    const node = any('writer-output');

    expect(renderNodeToString(node, context, { writer })).toBe('writer-output');
    expect(writer.toString()).toBe('writer-output');
  });

  it('uses the canonical root serializer for root-only output', () => {
    const context = new Context();
    const root = rules([]);
    context.root = root;
    context.currentCharset = any('@charset "utf-8";', { role: 'charset' });
    context.topImports = [
      atrule({
        name: any('@import', { role: 'atkeyword' }),
        prelude: quoted(any('theme.css'))
      })
    ];

    expect(renderNodeToString(root, context, { context })).toBe('@charset "utf-8";\n@import "theme.css";\n');
  });

  it('reuses active print state instead of resetting it', () => {
    const context = new Context();
    const writer = new OutputWriter();
    const frameHeaders = ['@media screen'];
    const emittedTrivia = new Set<IToken[]>();
    const node = any('stateful-output');
    const options = {
      context,
      writer,
      frameHeaders,
      emittedTrivia
    };

    expect(renderNodeToString(node, context, options)).toBe('stateful-output');

    expect(options.writer).toBe(writer);
    expect(options.frameHeaders).toBe(frameHeaders);
    expect(options.emittedTrivia).toBe(emittedTrivia);
  });

  it('requires explicit implementations for segmented rendering', () => {
    const context = new Context();
    const buffer = createRenderBuffer('segmented');
    const node = any('green');

    expect(() => renderNodeToBuffer(node, context, buffer)).toThrow(/segmented rendering/u);
  });
});
