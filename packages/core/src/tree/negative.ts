import { Node, defineType, F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC, type LocationInfo, type NodeOptions } from './node.js';
import type { Context } from '../context.js';
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
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('-', this);
    this.value.writeSyntax(options);
  }

  constructor(value: Node, options?: NodeOptions, location?: LocationInfo) {
    super(value, options, location);
    // Negative operations are always non-static, but can inherit may_async from children
    this.addFlags(F_VISIBLE, F_NON_STATIC);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    if (this.value instanceof Dimension && !this.isCompoundDimension(this.value)) {
      const unit = this.value.value.unit ?? '';
      const out = `-${`${round(this.value.value.number, 8)}`.toLowerCase()}${unit}`;
      options.writer.add(out, this);
      return out;
    }
    const mark = options.writer.mark();
    this.writeSyntax(options);
    const w = options.writer;
    return w.getSince(mark);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (!this.value.hasFlag(F_MAY_ASYNC)) {
      const evaluated = this.value.evalImmediateSync(context);
      return this.renderEvaluatedValue(context, evaluated, bufferOrOptions, options);
    }
    const value = this.value.eval(context);
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
      const rendered = this.renderNegatedDimension(value, isRenderBuffer(bufferOrOptions) ? options : bufferOrOptions);
      return isRenderBuffer(bufferOrOptions)
        ? writeRenderText(bufferOrOptions, rendered)
        : rendered;
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
    const unit = value.value.unit;
    return Boolean(unit && (unit.includes('/') || unit.includes('*') || unit.includes('±')));
  }

  private renderNegatedDimension(value: Dimension, options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const unit = value.value.unit ?? '';
    const out = `${round(value.value.number * -1, 8)}`.toLowerCase() + unit;
    w.add(out, value);
    return out;
  }

  override evalNode(context: Context): MaybePromise<Node> {
    if (!this.value.hasFlag(F_MAY_ASYNC)) {
      const evaluated = this.value.evalImmediateSync(context);
      return this.operateNegativeValue(evaluated, context);
    }
    const value = this.value.eval(context);
    return isThenable(value)
      ? value.then(evaluated => this.operateNegativeValue(evaluated, context))
      : this.operateNegativeValue(value, context);
  }

  private operateNegativeValue(value: Node, context: Context): MaybePromise<Node> {
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
