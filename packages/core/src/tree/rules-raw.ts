import { defineType, Node } from './node.js';
import type { Context } from '../context.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { Rules } from './rules.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { isRenderBuffer, type RenderBuffer } from './util/render-buffer.js';

/**
 * A rules container that emits its content verbatim inside braces,
 * without parent-managed newlines or indentation.
 */
export class RawRules extends Rules {
  override allowRuleRoot = true;

  // Do not add newlines/indent; emit children exactly as-is
  override toBraced(options?: PrintOptions) {
    options = getPrintOptions(options);
    const mark = options.writer.mark();
    this.writeBracedSyntax(options);
    const w = options.writer;
    return w.getSince(mark);
  }

  private writeBracedSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('{');
    // Emit children using toString to preserve exact whitespace/comments
    for (const child of this.value) {
      child.toString(options);
    }
    w.add('}');
  }

  // Keep trimmed output minimal – emit children verbatim without extras
  override writeSyntax(options: FinalPrintOptions): void {
    for (const child of this.value) {
      child.toString(options);
    }
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const mark = options.writer.mark();
    this.writeSyntax(options);
    const w = options.writer;
    return w.getSince(mark);
  }

  override resolve(_context: Context): this {
    return this;
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    // RawRules is source-only even though it inherits from Rules, whose render
    // path evaluates child rules. Opt back into the base Node source renderer.
    return isRenderBuffer(bufferOrOptions)
      ? Node.prototype.render.call(this, context, bufferOrOptions, options)
      : Node.prototype.render.call(this, context, bufferOrOptions);
  }
}

export const rawrules = defineType(RawRules, 'RawRules', 'rules-raw');
