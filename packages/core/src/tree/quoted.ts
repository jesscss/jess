import { type Interpolated } from './interpolated';
import { General } from './general';
import { Node, defineType } from './node';
import type { Context } from '../context';

export type QuotedOptions = {
  quote?: '"' | '\'';
  escaped?: boolean;
};

export interface Quoted extends Node<string | General | Interpolated, QuotedOptions> {
  eval(context: Context): Promise<Quoted | General | Interpolated>;
}

/**
 * An quoted value
 */
export class Quoted extends Node<string | General | Interpolated, QuotedOptions> {
  type = 'Quoted' as const;
  shortType = 'quoted' as const;

  override toTrimmedString() {
    let { quote = '"', escaped } = this.options ?? {};
    let output = super.toTrimmedString();
    let escapeChar = escaped ? '~' : '';
    return `${escapeChar}${quote}${output}${quote}`;
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