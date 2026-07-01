import { Node, F_STATIC, defineType, type NodeLocation, type NodeOptions } from './node.js';
import type { Context } from '../context.js';
import { getPrintOptions, type PrintOptions } from './util/print.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { isRenderBuffer, prepareBufferPrintState, writeRenderText, type RenderBuffer } from './util/render-buffer.js';
import { prepareRenderPrintState } from './util/print.js';

/**
 * e.g. url('foo.png')
 */
export class Url extends Node<Node> {
  static override childKeys = ['value'] as const;

  readonly value: Node;

  constructor(
    value: Node,
    options?: NodeOptions,
    location?: NodeLocation,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    // Invariant 7: each node owns its value; the base stores nothing.
    this.value = value;
    this._treeContext = treeContext;
  }

  private withValue(value: Node): Url {
    return new Url(
      value,
      this._options ? { ...this._options } : undefined,
      this.location,
      this.sourceRoot?._treeContext
    ).inherit(this);
  }

  private renderUrlSyntax(value = this.value, options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('url(');
    if (options.context) {
      const valueMark = w.mark();
      value.toString(options);
      // AUDIT: seems smelly. Why do we need to replace something in the URL?
      w.replaceSince(
        valueMark,
        value => value
          .replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, '')
          .replace(/\n[ \t\r\f]+/g, '\n  '),
        value
      );
    } else {
      value.toString(options);
    }
    w.add(')');
    return w.getSince(mark);
  }

  /**
   * @todo - enable URL rewriting
   */
  override valueOf(): string {
    const value = this.value;
    if (isNode(value, N.Quoted)) {
      const quotedValue = value.value;
      if (isNode(quotedValue)) {
        return String(quotedValue.valueOf());
      }
      return quotedValue;
    }
    return String(value.valueOf());
  }

  // AUDIT: toTrimmedString is not supposed to use print buffers and is only supposed to straight serialize. Still todo in the serialization cleanup?
  override toTrimmedString(options?: PrintOptions) {
    return this.renderUrlSyntax(this.value, options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareBufferPrintState(context, options)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      : prepareRenderPrintState(context, bufferOrOptions as import('./util/print.js').PrintOptions | undefined);
    const value = this.hasFlag(F_STATIC) ? this.value : this.value.eval(context);
    if (isThenable(value)) {
      return (value as Promise<Node>).then((resolved) => {
        const out = this.renderUrlSyntax(resolved, prepared);
        return buffer
          ? writeRenderText(buffer, out)
          : out;
      });
    }
    const out = this.renderUrlSyntax(value as Node, prepared);
    return buffer
      ? writeRenderText(buffer, out)
      : out;
  }

  override evalNode(context: Context): MaybePromise<Node> {
    return this.evaluateValue(context);
  }

  private evaluateValue(context: Context): MaybePromise<Node> {
    if (this.hasFlag(F_STATIC)) {
      return this;
    }
    const value = this.value.eval(context);
    const finalize = (resolvedValue: Node): Node => {
      if (resolvedValue === this.value) {
        return this;
      }
      return this.withValue(resolvedValue);
    };
    if (isThenable(value)) {
      return (value as Promise<Node>).then(finalize);
    }
    return finalize(value as Node);
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evaluateValue(context);
  }
}

export const url = defineType(Url, 'Url');
