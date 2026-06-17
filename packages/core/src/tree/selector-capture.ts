import { type Context } from '../context.js';
import { Node, F_STATIC, defineType } from './node.js';
import { Selector } from './selector.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  type RenderBuffer
} from './util/render-buffer.js';

export interface SelectorCapture extends Node<Selector> {
  eval(context: Context): MaybePromise<Selector>;
}

const isSelectorNode = (value: unknown): value is Selector => (
  value !== null
  && typeof value === 'object'
  && 'isSelector' in value
  && value.isSelector === true
);

/**
 * Explicit selector-capture wrapper used by parsers for selector-valued payloads
 * (e.g. Less `*[ ... ]`, Sass `selector.parse(\"...\")`).
 */
export class SelectorCapture extends Node<Selector> {
  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('*[', this);
    this.value.writeSyntax(options);
    w.add(']', this);
  }

  override valueOf(): string {
    return String(this.value.valueOf());
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const mark = options.writer.mark();
    this.writeSyntax(options);
    const w = options.writer;
    return w.getSince(mark);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const node = this.resolveValue(context);
    if (!isRenderBuffer(bufferOrOptions)) {
      return isThenable(node)
        ? node.then(resolved => resolved.render(context, bufferOrOptions))
        : node.render(context, bufferOrOptions);
    }
    return isThenable(node)
      ? node.then(resolved => resolved.render(context, bufferOrOptions, options))
      : node.render(context, bufferOrOptions, options);
  }

  private requireSelector(value: unknown): Selector {
    if (isSelectorNode(value)) {
      return value;
    }
    throw new Error('SelectorCapture requires a selector-valued payload');
  }

  override evalNode(context: Context): MaybePromise<Selector> {
    const out = this.value.eval(context);
    if (isThenable(out)) {
      return out.then(value => this.requireSelector(value));
    }
    return this.requireSelector(out);
  }

  override resolve(context: Context): MaybePromise<Selector> {
    return this.resolveValue(context);
  }

  private resolveValue(context: Context): MaybePromise<Selector> {
    if (this.hasFlag(F_STATIC)) {
      return this.value;
    }
    const out = this.value.resolve(context);
    if (isThenable(out)) {
      return out.then(value => this.requireSelector(value));
    }
    return this.requireSelector(out);
  }
}

type Params = ConstructorParameters<typeof SelectorCapture>;

export const selcap = defineType(SelectorCapture, 'SelectorCapture', 'selcap') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2]
) => SelectorCapture;
