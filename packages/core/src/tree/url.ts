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
  static override childKeys = ['node'] as const;

  readonly node: Node;

  constructor(
    value: Node,
    options?: NodeOptions,
    location?: NodeLocation,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location, false);
    this._treeContext = treeContext;
    this.node = value;
    if (value instanceof Node) {
      this.adopt(value);
    }
  }

  private withValue(value: Node): Url {
    return new Url(
      value,
      this._options ? { ...this._options } : undefined,
      this.location,
      this.sourceRoot?._treeContext
    ).inherit(this);
  }

  private renderUrlSyntax(value = this.node, options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('url(');
    if (options.context) {
      const valueMark = w.mark();
      value.toString(options);
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
    const value = this.node;
    if (isNode(value, N.Quoted)) {
      const quotedValue = value.value;
      if (isNode(quotedValue)) {
        return String(quotedValue.value);
      }
      return quotedValue;
    }
    return String(value.valueOf());
  }

  override toTrimmedString(options?: PrintOptions) {
    return this.renderUrlSyntax(this.node, options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareBufferPrintState(context, options)
      : prepareRenderPrintState(context, bufferOrOptions);
    const value = this.hasFlag(F_STATIC) ? this.node : this.node.eval(context);
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
    const value = this.node.eval(context);
    const finalize = (resolvedValue: Node): Node => {
      if (resolvedValue === this.node) {
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
