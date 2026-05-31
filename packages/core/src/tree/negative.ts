import { Node, defineType, F_VISIBLE, F_NON_STATIC, type LocationInfo, type NodeOptions, type TreeContext } from './node.js';
import type { Context } from '../context.js';
import { Dimension } from './dimension.js';
import { type MaybePromise, pipe, tryStep } from '@jesscss/awaitable-pipe';
import { getPrintOptions, type PrintOptions } from './util/print.js';
import {
  isRenderBuffer,
  writeRenderTextResult,
  type RenderBuffer
} from './util/render-buffer.js';
import round from 'lodash-es/round.js';

const NEGATIVE_ONE = new Dimension({ number: -1 });

export class Negative extends Node<Node> {
  private renderNegativeSyntax(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('-');
    this.value.toString(options);
    return w.getSince(mark);
  }

  constructor(value: Node, options?: NodeOptions, location?: LocationInfo, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    // Negative operations are always non-static, but can inherit may_async from children
    this.addFlags(F_VISIBLE, F_NON_STATIC);
  }

  override toTrimmedString(options?: PrintOptions): string {
    return this.renderNegativeSyntax(options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    return pipe(
      () => this.value.eval(context),
      value => this.renderEvaluatedValue(context, value, bufferOrOptions, options)
    );
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
        ? writeRenderTextResult(bufferOrOptions, rendered)
        : rendered;
    }
    return pipe(
      () => this.operateNegativeValue(value, context),
      node => isRenderBuffer(bufferOrOptions)
        ? node.render(context, bufferOrOptions, options)
        : node.render(context, bufferOrOptions)
    );
  }

  private isCompoundDimension(value: Dimension): boolean {
    const unit = value.value.unit;
    return Boolean(unit && (unit.includes('/') || unit.includes('*') || unit.includes('±')));
  }

  private renderNegatedDimension(value: Dimension, options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const unit = value.value.unit ?? '';
    w.add(`${round(value.value.number * -1, 8)}`.toLowerCase(), value);
    if (unit) {
      w.add(unit);
    }
    return w.getSince(mark);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    return pipe(
      () => this.value.eval(context),
      tryStep((value: Node) => {
        return this.operateNegativeValue(value, context);
      }, { rethrow: true })
    );
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
