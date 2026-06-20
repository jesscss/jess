import { type Context } from '../context.js';
import { Node, defineType, type LocationInfo } from './node.js';
import { type MaybePromise } from '@jesscss/awaitable-pipe';
import { getPrintOptions, type FinalPrintOptions, type PrintOptions } from './util/print.js';
import { isRenderBuffer, type RenderBuffer } from './util/render-buffer.js';

export type ProgressiveDeclarationValue = {
  name: string;
  value: Array<string | Node>;
  important?: boolean | string;
};

/**
 * Experimental declaration node for scanner-first progressive parsing.
 *
 * This proves the cheap shape can carry literal string payloads and render or
 * serialize without creating `Any` value nodes. It is intentionally small while
 * the final `Declaration` migration shape is still being measured.
 */
export class ProgressiveDeclaration extends Node<ProgressiveDeclarationValue> {
  static override childKeys = ['name', 'valueSegments', 'important'] as const;

  readonly name: string;
  readonly valueSegments: Array<string | Node>;
  readonly important: boolean | string | undefined;

  override allowRuleRoot = true;

  constructor(
    value: ProgressiveDeclarationValue,
    options?: undefined,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    this._treeContext = treeContext;
    this.name = value.name;
    this.valueSegments = value.value;
    this.important = value.important;
  }

  override toTrimmedString(options?: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    const mark = printOptions.writer.mark();
    this.writeSyntax(printOptions);
    return printOptions.writer.getSince(mark);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    const writer = options.writer;
    writer.add(`${this.name}: `, this);
    for (let i = 0; i < this.valueSegments.length; i++) {
      const segment = this.valueSegments[i]!;
      if (typeof segment === 'string') {
        writer.add(segment, this);
      } else {
        segment.writeSyntax(options);
      }
    }
    if (this.important !== undefined && this.important !== false) {
      writer.add(` ${this.important === true ? '!important' : this.important}`, this);
    }
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    return isRenderBuffer(bufferOrOptions)
      ? Node.prototype.render.call(this, context, bufferOrOptions, options)
      : Node.prototype.render.call(this, context, bufferOrOptions);
  }
}

export const progressivedecl = defineType(ProgressiveDeclaration, 'ProgressiveDeclaration', 'progressive-decl') as (
  value: ProgressiveDeclarationValue,
  options?: undefined,
  location?: LocationInfo
) => ProgressiveDeclaration;
