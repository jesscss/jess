import { type Interpolated } from './interpolated';
import { General } from './general';
import { Node, defineType } from './node';
import type { Context } from '../context';
import { type PrintOptions, getPrintOptions } from './util/print';

export type QuotedOptions = {
  quote?: '"' | '\'';
  escaped?: boolean;
};

export interface Quoted extends Node<string | General | Interpolated, QuotedOptions> {
  eval(context: Context): Promise<Quoted | General | Interpolated>;
}

/**
 * A quoted string value. Called a `String` in CSS, but calling it Quoted
 * to avoid conflict with the built-in `String` class.
 */
export class Quoted extends Node<string | General | Interpolated, QuotedOptions> {
  type = 'Quoted' as const;
  shortType = 'quoted' as const;

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let { quote = '"', escaped } = this.options ?? {};
    let escapeChar = escaped ? '~' : '';
    if (escapeChar) w.add(escapeChar, this);
    w.add(quote);
    super.toTrimmedString(options);
    w.add(quote);
    return w.getSince(mark);
  }

  override valueOf(): string {
    const { value } = this;
    return value instanceof Node ? value.valueOf() : value;
  }

  override async evalNode(context: Context): Promise<Quoted | General | Interpolated> {
    let { value } = this;
    if (value instanceof Node) {
      value = (await value.eval(context));
    }
    if (this.options.escaped) {
      if (value instanceof Node) {
        return value;
      }
      return new General<'Anonymous'>(value);
    }
    let quoted = this.maybeClone(context);
    quoted.value = value;
    return quoted;
  }
}
export const quoted = defineType(Quoted, 'Quoted');