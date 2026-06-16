import { describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { Node } from '../node-base.js';
import { OutputWriter, getPrintOptions, type PrintOptions } from '../util/print.js';
import { createRenderBuffer } from '../util/render-buffer.js';

class BaseSyntaxNode extends Node<unknown[]> {}

class CustomTrimmedNode extends Node<string> {
  override toTrimmedString(options?: PrintOptions): string {
    getPrintOptions(options).writer.add(`custom-${this.value}`);
    return `custom-${this.value}`;
  }
}

describe('base Node render', () => {
  it('renders inherited source syntax without calling public toTrimmedString', () => {
    const original = Node.prototype.toTrimmedString;
    Node.prototype.toTrimmedString = function toTrimmedString() {
      throw new Error('base render should use writeSyntax directly');
    };
    try {
      const context = new Context();
      const writer = new OutputWriter();
      const node = new BaseSyntaxNode(['base']);
      writer.add('prefix:');

      expect(node.render(context, { writer })).toBe('base');
      expect(writer.toString()).toBe('prefix:base');

      const buffer = createRenderBuffer('flat');
      expect(node.render(context, buffer)).toBe('base');
      expect(buffer.parts).toEqual(['base']);
    } finally {
      Node.prototype.toTrimmedString = original;
    }
  });

  it('preserves custom toTrimmedString render compatibility boundaries', () => {
    const context = new Context();
    const writer = new OutputWriter();
    const node = new CustomTrimmedNode('value');

    expect(node.render(context, { writer })).toBe('custom-value');
    expect(writer.toString()).toBe('custom-value');
  });
});
