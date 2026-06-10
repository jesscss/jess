import type { Context } from '../context.js';
import { defineType } from './node.js';
import { SimpleSelector } from './selector-simple.js';
import { attachSelectorBitLibrary, Selector } from './selector.js';
import { Interpolated } from './interpolated.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import type { FinalPrintOptions, PrintOptions } from './util/print.js';
import type { RenderBuffer } from './util/render-buffer.js';

export interface InterpolatedSelector extends SimpleSelector<Interpolated> {
  eval(context: Context): MaybePromise<Selector>;
}

/**
 * A selector that wraps an interpolated value
 * This allows interpolation to be used in selector contexts
 */
export class InterpolatedSelector extends SimpleSelector<Interpolated> {
  get isClass() {
    return this.valueOf()[0] === '.';
  }

  get isId() {
    return this.valueOf()[0] === '#';
  }

  get isTag() {
    const first = this.valueOf()[0];
    return first !== undefined && first !== '.' && first !== '#' && first !== '*';
  }

  override writeSyntax(options: FinalPrintOptions): void {
    this.value.writeSyntax(options);
  }

  override evalNode(context: Context): MaybePromise<Selector> {
    const { selectorBits } = context;
    this.keySetLibrary ??= selectorBits;
    const out = this.value.evalToSelector(context);
    if (isThenable(out)) {
      return (out as Promise<Selector>).then(selector => attachSelectorBitLibrary(selector, selectorBits));
    }
    return attachSelectorBitLibrary(out as Selector, selectorBits);
  }

  override resolve(context: Context): MaybePromise<Selector> {
    return this.resolveValue(context);
  }

  private resolveValue(context: Context): MaybePromise<Selector> {
    const { selectorBits } = context;
    this.keySetLibrary ??= selectorBits;
    const out = this.value.evalToSelector(context, 'resolve');
    if (isThenable(out)) {
      return (out as Promise<Selector>).then(selector => attachSelectorBitLibrary(selector, selectorBits));
    }
    return attachSelectorBitLibrary(out as Selector, selectorBits);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const node = this.resolveValue(context);
    return isThenable(node)
      ? (node as Promise<Selector>).then(resolved => this.renderOutput(context, resolved, bufferOrOptions, options))
      : this.renderOutput(context, node as Selector, bufferOrOptions, options);
  }

  override valueOf(): string {
    return this.value.valueOf();
  }
}

export const interpolatedSelector = defineType(InterpolatedSelector, 'InterpolatedSelector', 'interpolated-selector');
