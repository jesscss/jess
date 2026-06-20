import { type Context } from '../context.js';
import { Node, defineType, F_VISIBLE, type LocationInfo } from './node.js';
import { type MaybePromise } from '@jesscss/awaitable-pipe';
import { getPrintOptions, type FinalPrintOptions, type PrintOptions } from './util/print.js';
import { isRenderBuffer, type RenderBuffer } from './util/render-buffer.js';

export type ProgressiveVariableDeclarationValue = {
  name: string;
  value: Array<string | Node>;
};

/**
 * Experimental scanner-first variable declaration node.
 *
 * It keeps Less-style variable names and source-backed values as cheap structural
 * data. The node is invisible during normal render, so supported references can
 * resolve to declaration text without allocating canonical variable or
 * reference nodes in the first proof path.
 */
export class ProgressiveVariableDeclaration extends Node<ProgressiveVariableDeclarationValue> {
  static override childKeys = ['name', 'value'] as const;

  readonly name: string;
  readonly value: Array<string | Node>;

  override allowRuleRoot = true;
  override allowRoot = true;

  constructor(
    value: ProgressiveVariableDeclarationValue,
    options?: undefined,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    this._treeContext = treeContext;
    this.name = value.name;
    this.value = value.value;
    this.removeFlag(F_VISIBLE);
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
    for (const segment of this.value) {
      if (typeof segment === 'string') {
        writer.add(segment, this);
      } else {
        segment.writeSyntax(options);
      }
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

export const progressivevardecl = defineType(
  ProgressiveVariableDeclaration,
  'ProgressiveVariableDeclaration',
  'progressive-vardecl'
) as (
  value: ProgressiveVariableDeclarationValue,
  options?: undefined,
  location?: LocationInfo
) => ProgressiveVariableDeclaration;
