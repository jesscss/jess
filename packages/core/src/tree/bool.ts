import type { Context } from '../context.js';
import { Node, F_STATIC, defineType } from './node.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';

export interface Bool extends Node<boolean> {
  eval(context: Context): Bool;
}

/**
 * A boolean. Named `Bool` to avoid conflict with the built-in `Boolean` class.
 */
export class Bool extends Node<boolean> {
  constructor(...args: ConstructorParameters<typeof Node<boolean>>) {
    super(...args);
    this.addFlag(F_STATIC);
  }

  override compare(other: Node): 0 | 1 | -1 | undefined {
    if (other instanceof Bool) {
      return this.value === other.value ? 0 : undefined;
    }
    return undefined;
  }

  override toTrimmedString(options?: PrintOptions) {
    const out = this.value ? 'true' : 'false';
    getPrintOptions(options).writer.add(out, this);
    return out;
  }

  override writeSyntax(options: FinalPrintOptions): void {
    options.writer.add(this.value ? 'true' : 'false', this);
  }

  override resolve(_context: Context): this {
    return this;
  }
}

export function createPublicBool(value: boolean): Bool {
  return new Bool(value);
}

export const bool = defineType(Bool, 'Bool');
