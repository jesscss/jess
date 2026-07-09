import { type Context } from '../context.js';
import { Node, F_STATIC, defineType, type LocationInfo } from './node.js';
import { Selector, type SelectorLike } from './selector.js';
import { asExtendSelectorNode } from './util/extend-roots.js';
import { isSelectorListLike, emitSelectorListLike, selectorListValueOf, selectorListItems } from './selector-list.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  type RenderBuffer
} from './util/render-buffer.js';

export interface SelectorCapture extends Node<SelectorLike> {
  eval(context: Context): MaybePromise<Selector>;
}

const isSelectorNode = (value: unknown): value is Selector => (
  value instanceof Selector
);

/**
 * Explicit selector-capture wrapper used by parsers for selector-valued payloads
 * (e.g. Less `*[ ... ]`, Sass `selector.parse(\"...\")`).
 *
 * The payload is stored in the lean parser-delivered form — a bare STRING for a
 * simple selector (no `BasicSelector` allocation at parse time) — and lifted to a
 * `Selector` node on demand only where the eval/render contract structurally needs
 * one (`asNode`, cached).
 */
export class SelectorCapture extends Node<SelectorLike> {
  static override childKeys = ['selector'] as const;

  readonly selector: SelectorLike;
  private _selectorNode?: Selector;

  constructor(value: SelectorLike, options?: undefined, location?: LocationInfo) {
    super(value, options, location);
    this.selector = value;
  }

  /** Lift a lean string/array payload to a `Selector` node once, on demand. */
  private asNode(): Selector {
    if (this.selector instanceof Selector) {
      return this.selector;
    }
    return (this._selectorNode ??= asExtendSelectorNode(this.selector));
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    const sel = this.selector;
    w.add('*[', this);
    if (typeof sel === 'string') {
      w.add(sel, this);
    } else if (isSelectorListLike(sel)) {
      emitSelectorListLike(sel, options, true);
    } else {
      sel.writeSyntax(options);
    }
    w.add(']', this);
  }

  override valueOf(): string {
    const sel = this.selector;
    if (typeof sel === 'string') {
      return sel;
    }
    if (isSelectorListLike(sel)) {
      return selectorListValueOf(selectorListItems(sel));
    }
    return String(sel.valueOf());
  }

  override toTrimmedString(rawOptions?: PrintOptions): string {
    const options = getPrintOptions(rawOptions);
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
    const out = this.asNode().eval(context);
    if (isThenable(out)) {
      return out.then(value => this.requireSelector(value));
    }
    return this.requireSelector(out);
  }

  override resolve(context: Context): MaybePromise<Selector> {
    return this.resolveValue(context);
  }

  private resolveValue(context: Context): MaybePromise<Selector> {
    const node = this.asNode();
    if (this.hasFlag(F_STATIC)) {
      return node;
    }
    const out = node.resolve(context);
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
