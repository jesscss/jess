import type { Context } from '../context.js';
import { defineType, F_STATIC } from './node.js';
import { SimpleSelector } from './selector-simple.js';
import type { FinalPrintOptions, PrintOptions } from './util/print.js';

export interface BasicSelector extends SimpleSelector<string> {
  eval(context: Context): BasicSelector;
}

/**
 * A basic selector
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_selectors/Selectors_and_combinators#basic_selectors
 *   e.g. div, .foo, #bar
*/
export class BasicSelector extends SimpleSelector<string> {
  constructor(...args: ConstructorParameters<typeof SimpleSelector<string>>) {
    super(...args);
    this.addFlag(F_STATIC);
  }

  get isClass() {
    return this.value[0] === '.';
  }

  get isId() {
    return this.value[0] === '#';
  }

  /** A tag-type selector */
  get isTag() {
    const first = this.value[0];
    return first !== undefined && first !== '.' && first !== '#' && first !== '*';
  }

  override evalNode(context: Context): BasicSelector {
    const node = this;
    node.keySetLibrary ??= context.selectorBits;
    if (node.isClass) {
      context.hashClass(node.value);
    }
    return node;
  }

  override valueOf(): string {
    return (this._valueOf ??= (this.isTag ? this.value.toLowerCase() : this.value));
  }

  override toTrimmedString(options?: PrintOptions): string {
    const out = this.value;
    options?.writer?.add(out, this);
    return out;
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    options.writer.add(this.value, this);
  }

  /** @todo - move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   if (this.isClass) {
  //     out.add(context.hashClass(this.value.value), this.location)
  //   } else {
  //     out.add(this.value.value, this.location)
  //   }
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const loc = this.location
  //   out.add('$J.el(', loc)
  //   this.value.toModule(context, out)
  //   out.add(')')
  // }
}

/** Short form of a basic selector is a short 'el' for 'element' */
export const el = defineType(BasicSelector, 'BasicSelector', 'el');
