import { type Context } from '../context.js';
import { Node, defineType } from './node.js';
import { Selector } from './selector.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';

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
  private renderCaptureSyntax(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('*[', this);
    this.value.toString(options);
    w.add(']', this);
    return w.getSince(mark);
  }

  override valueOf(): string {
    return String(this.value.valueOf());
  }

  override toTrimmedString(options?: PrintOptions): string {
    return this.renderCaptureSyntax(options);
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
  location?: Params[2],
  treeContext?: Params[3]
) => SelectorCapture;
