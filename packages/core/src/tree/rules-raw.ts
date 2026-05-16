import { defineType } from './node.js';
import type { Context } from '../context.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { Rules } from './rules.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import {
  isRenderBuffer,
  renderNodeToBuffer,
  type RenderBuffer
} from './util/render-buffer.js';

/**
 * A rules container that emits its content verbatim inside braces,
 * without parent-managed newlines or indentation.
 */
export class RawRules extends Rules {
  override allowRuleRoot = true;

  // Do not add newlines/indent; emit children exactly as-is
  override toBraced(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('{');
    // Emit children using toString to preserve exact whitespace/comments
    for (const child of this.value) {
      child.toString(options);
    }
    w.add('}');
    return w.getSince(mark);
  }

  // Keep trimmed output minimal – emit children verbatim without extras
  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    for (const child of this.value) {
      child.toString(options);
    }
    return w.getSince(mark);
  }

  override resolve(_context: Context): this {
    return this;
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      return renderNodeToBuffer(this, context, bufferOrOptions, options);
    }
    return super.render(context, bufferOrOptions);
  }
}

export const rawrules = defineType(RawRules, 'RawRules', 'rules-raw');
