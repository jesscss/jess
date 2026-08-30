import { defineType, Node } from './node.js';
import { Rules } from './rules.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import type { Context } from '../context.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { isRenderBuffer, type RenderBuffer } from './util/render-buffer.js';

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
    const opts = getPrintOptions(options);
    const w = opts.writer;
    const mark = w.mark();
    this.writeSyntax(opts);
    return w.getSince(mark);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    this.writeBraced(options);
  }

  /**
   * Collection rules aren't evaluated by default. They're evaluated
   * at access time OR if assigned to a property.
   */
  override evalNode(_context: Context): this {
    return this;
  }

  override resolve(context: Context): this {
    return this.evalNode(context);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    // Collection is source-only even though it inherits from Rules, whose render
    // path evaluates child rules. Opt back into the base Node source renderer.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const render = Node.prototype.render as (context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions) => string | MaybePromise<string>;
    return isRenderBuffer(bufferOrOptions)
      ? render.call(this, context, bufferOrOptions, options)
      : render.call(this, context, bufferOrOptions);
  }
}

type Params = ConstructorParameters<typeof Collection>;

export const coll = defineType(Collection, 'Collection', 'coll') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2]
) => Collection;
