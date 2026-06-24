import { Any } from './any.js';
import { defineType, Node, type NodeLocation, type NodeOptions } from './node.js';
import type { Context } from '../context.js';
import { isNode } from './util/is-node.js';
import { isRenderBuffer, type RenderBuffer, writeRenderText } from './util/render-buffer.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';

/**
 * A rest expression (e.g. ...$var). By itself it doesn't do much.
 * It's used by lists to merge values. Sequences already bubble
 * lists / sequences, so this is mostly for serialization.
 */
export class Rest extends Node<Node | string | undefined> {
  static override childKeys = ['value'] as const;

  declare readonly value: Node | string | undefined;

  constructor(
    value?: Node | string,
    options?: NodeOptions,
    location?: NodeLocation,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    this._treeContext = treeContext;
  }

  get name(): string {
    const value = this.value;
    if (value) {
      if (isNode(value)) {
        if (value instanceof Any) {
          return value.value;
        }
        return String(value.valueOf());
      }
      return `$${value}`;
    }
    return '';
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('...$');
    const value = this.value;
    if (value) {
      if (isNode(value)) {
        value.writeSyntax(options);
      } else {
        w.add(`$${value}`, this);
      }
    }
  }

  override toTrimmedString(rawOptions?: PrintOptions): string {
    const options = getPrintOptions(rawOptions);
    const value = this.value;
    if (!value || !isNode(value)) {
      const out = value ? `...$$${value}` : '...$';
      options.writer.add(out, this);
      return out;
    }
    if (value instanceof Any) {
      const out = `...$${value.value}`;
      const w = options.writer;
      w.add('...$');
      w.add(value.value, value);
      return out;
    }
    const mark = options.writer.mark();
    this.writeSyntax(options);
    const w = options.writer;
    return w.getSince(mark);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): string;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string {
    const value = this.value;
    if (value && isNode(value) && !(value instanceof Any)) {
      return this.renderSource(context, bufferOrOptions, options);
    }
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    let out: string;
    if (!value) {
      out = '...$';
    } else if (value instanceof Any) {
      out = `...$${value.value}`;
    } else {
      out = `...$$${value}`;
    }
    if (buffer) {
      return writeRenderText(buffer, out);
    }
    const prepared = prepareRenderPrintState(context, bufferOrOptions);
    if (value instanceof Any) {
      prepared.writer.add('...$');
      prepared.writer.add(value.value, value);
    } else {
      prepared.writer.add(out, this);
    }
    return out;
  }

  override resolve(_context: Context): this {
    return this;
  }
}

export const rest = defineType(Rest, 'Rest');
