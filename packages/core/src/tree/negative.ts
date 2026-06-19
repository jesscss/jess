import { Node, defineType, F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC, type LocationInfo, type NodeOptions } from './node.js';
import type { Context } from '../context.js';
import { Any } from './any.js';
import { Dimension } from './dimension.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { type FinalPrintOptions, getPrintOptions, type PrintOptions } from './util/print.js';
import {
  isRenderBuffer,
  writeRenderText,
  type RenderBuffer
} from './util/render-buffer.js';
import round from 'lodash-es/round.js';

const NEGATIVE_ONE = new Dimension({ number: -1 });

export class Negative extends Node<Node> {
  static override childKeys = ['node'] as const;

  readonly node: Node;

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('-', this);
    this.node.writeSyntax(options);
  }

  constructor(value: Node, options?: NodeOptions, location?: LocationInfo, treeContext?: Context['treeContext']) {
    super(value, options, location, false);
    this._treeContext = treeContext;
    this.node = value;
    if (value instanceof Node) {
      this.adopt(value);
    }
    // Negative operations are always non-static, but can inherit may_async from children
    this.addFlags(F_VISIBLE, F_NON_STATIC);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const node = this.node;
    if (node instanceof Dimension && !this.isCompoundDimension(node)) {
      const value = node;
      const unit = value.unit ?? '';
      const out = `-${`${round(value.number, 8)}`.toLowerCase()}${unit}`;
      options.writer.add(out, this);
      return out;
    }
    if (node instanceof Any) {
      const value = node;
      const out = `-${value.value}`;
      options.writer.add('-', this);
      options.writer.add(value.value, value);
      return out;
    }
    const mark = options.writer.mark();
    this.writeSyntax(options);
    const w = options.writer;
    return w.getSince(mark);
  }

  private renderNegativeAnyText(value: Any, bufferOrOptions?: RenderBuffer | PrintOptions): string {
    const out = `-${value.value}`;
    if (isRenderBuffer(bufferOrOptions)) {
      return writeRenderText(bufferOrOptions, out);
    }
    const writer = getPrintOptions(bufferOrOptions).writer;
    writer.add('-', this);
    writer.add(value.value, value);
    return out;
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (!this.node.hasFlag(F_MAY_ASYNC)) {
      const evaluated = this.node.eval(context) as Node;
      return this.renderEvaluatedValue(context, evaluated, bufferOrOptions, options);
    }
    const value = this.node.eval(context);
    return isThenable(value)
      ? value.then(evaluated => this.renderEvaluatedValue(context, evaluated, bufferOrOptions, options))
      : this.renderEvaluatedValue(context, value, bufferOrOptions, options);
  }

  private renderEvaluatedValue(
    context: Context,
    value: Node,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): MaybePromise<string> {
    if (value instanceof Dimension && !this.isCompoundDimension(value)) {
      const rendered = this.negatedDimensionText(value);
      if (!isRenderBuffer(bufferOrOptions)) {
        getPrintOptions(bufferOrOptions).writer.add(rendered, value);
        return rendered;
      }
      return writeRenderText(bufferOrOptions, rendered);
    }
    if (value instanceof Any) {
      return this.renderNegativeAnyText(value, bufferOrOptions);
    }
    const operated = this.operateNegativeValue(value, context);
    return isThenable(operated)
      ? operated.then(node => isRenderBuffer(bufferOrOptions)
          ? node.render(context, bufferOrOptions, options)
          : node.render(context, bufferOrOptions))
      : isRenderBuffer(bufferOrOptions)
        ? operated.render(context, bufferOrOptions, options)
        : operated.render(context, bufferOrOptions);
  }

  private isCompoundDimension(value: Dimension): boolean {
    const unit = value.unit;
    return Boolean(unit && (unit.includes('/') || unit.includes('*') || unit.includes('±')));
  }

  private negatedDimensionText(value: Dimension): string {
    const unit = value.unit ?? '';
    return `${round(value.number * -1, 8)}`.toLowerCase() + unit;
  }

  override evalNode(context: Context): MaybePromise<Node> {
    if (!this.node.hasFlag(F_MAY_ASYNC)) {
      const evaluated = this.node.eval(context) as Node;
      return this.operateNegativeValue(evaluated, context);
    }
    const value = this.node.eval(context);
    return isThenable(value)
      ? value.then(evaluated => this.operateNegativeValue(evaluated, context))
      : this.operateNegativeValue(value, context);
  }

  private operateNegativeValue(value: Node, context: Context): MaybePromise<Node> {
    if (value instanceof Any) {
      return new Any(`-${value.value}`).inherit(value);
    }
    if (!value.operate) {
      throw new TypeError(`Cannot operate on ${value.type}`);
    }
    return value.operate(NEGATIVE_ONE, '*', context);
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }
}

export const negative = defineType(Negative, 'Negative');
