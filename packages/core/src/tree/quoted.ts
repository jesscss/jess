import { type Interpolated } from './interpolated.js';
import { Any } from './any.js';
import { Node, F_STATIC, F_NON_STATIC, defineType, type OptionalLocation, type TreeContext } from './node.js';
import type { Context } from '../context.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';

export type QuotedOptions = {
  quote?: '"' | '\'';
  escaped?: boolean;
};

export type QuotedChildData = { value: string | Any | Interpolated };

export interface Quoted extends Node<string | Any | Interpolated, QuotedOptions, QuotedChildData> {
  type: 'Quoted';
  shortType: 'quoted';
  eval(context: Context): MaybePromise<Quoted | Any | Interpolated>;
}

/**
 * A quoted string value. Called a `String` in CSS, but calling it Quoted
 * to avoid conflict with the built-in `String` class.
 */
export class Quoted extends Node<string | Any | Interpolated, QuotedOptions, QuotedChildData> {
  static override childKeys = ['value'] as const;

  value!: string | Any | Interpolated;
  readonly quote: '"' | '\'' | undefined;
  readonly escaped: boolean;

  constructor(value: string | Any | Interpolated, options?: QuotedOptions, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.value = value;
    this.quote = options?.quote;
    this.escaped = !!options?.escaped;
    if (value instanceof Node) {
      this.adopt(value);
    }
    if (typeof value === 'string' && !this.escaped) {
      this.addFlag(F_STATIC);
    } else {
      this.addFlag(F_NON_STATIC);
    }
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const value = this.value;
    let { quote = '"', escaped } = this;
    let escapeChar = escaped ? '~' : '';
    if (escapeChar) {
      w.add(escapeChar, this);
    }
    w.add(quote);
    if (value instanceof Node) {
      value.toString(options);
    } else if (value !== undefined && value !== '') {
      w.add(String(value), this);
    }
    w.add(quote);
    return w.getSince(mark);
  }

  override valueOf(): string {
    const value = this.value;
    return value instanceof Node ? value.valueOf() : value as string;
  }

  override compare(other: Node): 0 | 1 | -1 | undefined {
    if (other.type === 'Quoted' && !this.escaped && !(other as Quoted).escaped) {
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
    const originalValue = this.value;
    let value: string | Any | Interpolated | Node = originalValue;
    const cont = (v: string | Any | Interpolated | Node): Quoted | Any | Interpolated => {
      value = v;
      if (this.escaped) {
        if (value instanceof Node) {
          return value as Node as Quoted | Any | Interpolated;
        }
        return new Any(value as string);
      }
      if (value === originalValue) {
        return this;
      }
      const quoted = this.clone();
      if (originalValue instanceof Node) {
        originalValue.parent = this;
      }
      quoted.value = value as string | Any | Interpolated;
      if (value instanceof Node) {
        quoted.adopt(value);
      }
      return quoted;
    };
    if (value instanceof Node) {
      const out = value.eval(context);
      if (isThenable(out)) {
        return (out as Promise<Node | Any | Interpolated>).then(cont);
      }
      return cont(out as Node | Any | Interpolated);
    }
    return cont(value as string | Any | Interpolated);
  }
}

export const quoted = defineType(Quoted, 'Quoted');
