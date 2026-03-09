import { type Interpolated } from './interpolated.js';
import { Any } from './any.js';
import { Node, F_STATIC, F_NON_STATIC, defineType } from './node.js';
import type { Context } from '../context.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
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

  constructor(value: string | Any | Interpolated, options?: QuotedOptions, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    if (typeof value === 'string' && !options?.escaped) {
      this.addFlag(F_STATIC);
    } else {
      this.addFlag(F_NON_STATIC);
    }
  }

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

  override compare(other: Node): 0 | 1 | -1 | undefined {
    if (other.type === 'Quoted' && !this.options?.escaped && !(other as any).options?.escaped) {
      const left = String(this.valueOf());
      const right = String(other.valueOf?.() ?? '');
      if (left === right) {
        return 0;
      }
      return left > right ? 1 : -1;
    }
    return (other as any).toString && this.toString() === (other as any).toString() ? 0 : undefined;
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