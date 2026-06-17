import type { Context } from '../context.js';
import { defineType, F_STATIC, F_VISIBLE, type Node } from './node.js';
import { Selector } from './selector.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { getPrintOptions, type FinalPrintOptions, type PrintOptions } from './util/print.js';
import { isRenderBuffer, type RenderBuffer, writeRenderText } from './util/render-buffer.js';

export type Combinators = ' ' | '>' | '+' | '~' | '|' | '||';

export interface Combinator extends Selector<Combinators> {
  eval(context: Context): Combinator;
}

export class Combinator extends Selector<Combinators> {
  constructor(...args: ConstructorParameters<typeof Selector<Combinators>>) {
    super(...args);
    this.addFlag(F_STATIC);
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    options.writer.add(this.value, this);
  }

  override toTrimmedString(options?: PrintOptions): string {
    getPrintOptions(options).writer.add(this.value, this);
    return this.value;
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): string;
  override render(context: Context, options?: PrintOptions): string;
  override render(_context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, _options?: PrintOptions): string {
    if (!this.hasFlag(F_VISIBLE) && !this.fullRender) {
      return '';
    }
    const out = this.value;
    if (isRenderBuffer(bufferOrOptions)) {
      return writeRenderText(bufferOrOptions, out);
    }
    getPrintOptions(bufferOrOptions).writer.add(out, this);
    return out;
  }

  /** @todo move to visitor */
  // toCSS(context: Context, out: OutputCollector) {
  //   const val = this.value
  //   out.add(val === ' ' ? val : ` ${val} `, this.location)
  // }

  /** @todo move to visitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add(`$J.co("${this.value}")`)
  // }
}
export const co = defineType(Combinator, 'Combinator', 'co');
