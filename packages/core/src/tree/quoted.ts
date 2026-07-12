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
  private withValue(value: string | Any | Interpolated): this {
    const node = this.clone(false) as this;
    node.value = value;
    return node;
  }

  private renderQuotedSyntax(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const quote = this._options?.quote ?? '"';
    const escaped = this._options?.escaped;
    let escapeChar = escaped ? '~' : '';
    if (escapeChar) {
      w.add(escapeChar, this);
    }
    w.add(quote);
    super.toTrimmedString(options);
    w.add(quote);
    return w.getSince(mark);
  }

  constructor(value: string | Any | Interpolated, options?: QuotedOptions, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    if (typeof value === 'string' && !options?.escaped) {
      this.addFlag(F_STATIC);
    } else {
      this.addFlag(F_NON_STATIC);
    }
  }

  override toTrimmedString(options?: PrintOptions) {
    return this.renderQuotedSyntax(options);
  }

  override valueOf(): string {
    const { value } = this;
    return value instanceof Node ? value.valueOf() : value;
  }

  override compare(other: Node): 0 | 1 | -1 | undefined {
    if (other instanceof Quoted && !this._options?.escaped && !other._options?.escaped) {
      const left = String(this.valueOf());
      const right = String(other.valueOf?.() ?? '');
      if (left === right) {
        return 0;
      }
      return left > right ? 1 : -1;
    }
    return typeof other.toString === 'function' && this.toString() === other.toString() ? 0 : undefined;
  }

  override evalNode(context: Context): MaybePromise<Quoted | Any | Interpolated> {
    const cont = (value: string | Any | Interpolated | Node): Quoted | Any | Interpolated => {
      if (this._options?.escaped) {
        if (value instanceof Node) {
          return value;
        }
        return new Any(value);
      }
      if (value === this.value) {
        return this;
      }
      return this.withValue(value);
    };
    const { value } = this;
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
