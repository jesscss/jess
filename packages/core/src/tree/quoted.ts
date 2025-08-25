import { type Interpolated } from './interpolated';
import { Any } from './any';
import { Node, defineType } from './node';
import type { Context } from '../context';
import { type PrintOptions, getPrintOptions } from './util/print';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';

export type QuotedOptions = {
  quote?: '"' | '\'';
  escaped?: boolean;
};

export interface Quoted extends Node<string | Any | Interpolated, QuotedOptions> {
  eval(context: Context): Promise<Quoted | Any | Interpolated>;
}

/**
 * A quoted string value. Called a `String` in CSS, but calling it Quoted
 * to avoid conflict with the built-in `String` class.
 */
export class Quoted extends Node<string | Any | Interpolated, QuotedOptions> {
  type = 'Quoted' as const;
  shortType = 'quoted' as const;

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let { quote = '"', escaped } = this.options ?? {};
    let escapeChar = escaped ? '~' : '';
    if (escapeChar) {
      w.add(escapeChar, this);
    }
    w.add(quote);
    super.toTrimmedString(options);
    w.add(quote);
    return w.getSince(mark);
  }

  override valueOf(): string {
    const { value } = this;
    return value instanceof Node ? value.valueOf() : value;
  }

  override evalNode(context: Context): MaybePromise<Quoted | Any | Interpolated> {
    let { value } = this;
    const cont = (v: string | Any | Interpolated | Node): Quoted | Any | Interpolated => {
      value = v as any;
      if (this.options.escaped) {
        if (value instanceof Node) {
          return value as Node as Quoted | Any | Interpolated;
        }
        return new Any(value as string);
      }
      let quoted = this.maybeClone(context);
      quoted.value = value as any;
      return quoted;
    };
    if (value instanceof Node) {
      const out = value.eval(context);
      if (isThenable(out)) {
        return (out as Promise<Node | Any | Interpolated>).then(cont);
      }
      return cont(out as Node | Any | Interpolated);
    }
    return cont(value);
  }
}
export const quoted = defineType(Quoted, 'Quoted');