import type { Context } from '../context.js';
import { defineType, type NodeLocation, type NodeOptions } from './node.js';
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
  static override childKeys = ['node'] as const;

  readonly node: Interpolated;

  constructor(
    value: Interpolated,
    options?: NodeOptions,
    location?: NodeLocation,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location, false);
    this._treeContext = treeContext;
    this.node = value;
    this.adopt(value);
  }

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

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    this.node.writeSyntax(options);
  }

  override evalNode(context: Context): MaybePromise<Selector> {
    const { selectorBits } = context;
    this.keySetLibrary ??= selectorBits;
    const out = this.node.evalToSelector(context);
    if (isThenable(out)) {
      return out.then(selector => attachSelectorBitLibrary(selector, selectorBits));
    }
    return attachSelectorBitLibrary(out, selectorBits);
  }

  override resolve(context: Context): MaybePromise<Selector> {
    return this.resolveValue(context);
  }

  private resolveValue(context: Context): MaybePromise<Selector> {
    const { selectorBits } = context;
    this.keySetLibrary ??= selectorBits;
    const out = this.node.evalToSelector(context, 'resolve');
    if (isThenable(out)) {
      return out.then(selector => attachSelectorBitLibrary(selector, selectorBits));
    }
    return attachSelectorBitLibrary(out, selectorBits);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const node = this.resolveValue(context);
    return isThenable(node)
      ? node.then(resolved => this.renderOutput(context, resolved, bufferOrOptions, options))
      : this.renderOutput(context, node, bufferOrOptions, options);
  }

  override valueOf(): string {
    return this.node.valueOf();
  }
}

export const interpolatedSelector = defineType(InterpolatedSelector, 'InterpolatedSelector', 'interpolated-selector');
