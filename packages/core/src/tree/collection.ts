import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { defineType } from './node.js';
import { Rules } from './rules.js';
import { type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import type { Context } from '../context.js';
import {
  isRenderBuffer,
  type RenderBuffer,
  writeRenderText
} from './util/render-buffer.js';

/**
 * A collection is essentially like an anonymous mixin,
 * except that properties are arbitrary, so its intended
 * for map data.
 *
 * Even though it doesn't allow everything that a regular set
 * of rules does, we extend Rules just to make evaluation easier.
 *
 * Can be used like Sass property nesting.
 * @see https://sass-lang.com/documentation/style-rules/declarations/#nesting
 */
export class Collection extends Rules {
  override toTrimmedString(options?: PrintOptions) {
    return this.toBraced(options);
  }

  /**
   * Collection rules aren't evaluated by default. They're evaluated
   * at access time OR if assigned to a property.
   */
  override evalNode(_context: Context): MaybePromise<this> {
    return this;
  }

  override resolve(context: Context): MaybePromise<this> {
    return this.evalNode(context);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      return writeRenderText(
        bufferOrOptions,
        this.toTrimmedString(getPrintOptions({ ...options, context }))
      );
    }
    return this.toTrimmedString(prepareRenderPrintState(context, bufferOrOptions));
  }

  override prepareRegistration(_context: Context): this | Promise<this> {
    if (this.preEvaluated) {
      return this;
    }
    this.preEvaluated = true;
    return this;
  }
}

type Params = ConstructorParameters<typeof Collection>;

export const coll = defineType(Collection, 'Collection', 'coll') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => Collection;
