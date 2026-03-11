import type { Context } from '../context.js';
import { defineType, F_STATIC } from './node.js';
import { SimpleSelector } from './selector-simple.js';

export interface BasicSelector extends SimpleSelector<string> {
  type: 'BasicSelector';
  shortType: 'el';
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

  get value() {
    return this.data;
  }

  set value(val: string) {
    this.data = val;
  }

  get isClass() {
    return /^\./.test(this.data);
  }

  get isId() {
    return /^#/.test(this.data);
  }

  /** A tag-type selector */
  get isTag() {
    return /^[^.#*]/.test(this.data);
  }

  override evalNode(context: Context): BasicSelector {
    const node = super.evalNode(context) as BasicSelector;
    if (node.isClass) {
      context.hashClass(node.data);
    }
    return node;
  }

  override valueOf(): string {
    return (this._valueOf ??= (this.isTag ? this.data.toLowerCase() : this.data));
  }

  /** @todo - move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   if (this.isClass) {
  //     out.add(context.hashClass(this.data.value), this.location)
  //   } else {
  //     out.add(this.data.value, this.location)
  //   }
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const loc = this.location
  //   out.add('$J.el(', loc)
  //   this.data.toModule(context, out)
  //   out.add(')')
  // }
}

/** Short form of a basic selector is a short 'el' for 'element' */
export const el = defineType(BasicSelector, 'BasicSelector', 'el');