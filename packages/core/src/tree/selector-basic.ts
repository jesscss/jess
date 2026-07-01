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
  static override childKeys = null;

  override readonly value: string;

  constructor(
    value: string,
    options?: ConstructorParameters<typeof SimpleSelector<string>>[1],
    location?: ConstructorParameters<typeof SimpleSelector<string>>[2],
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    // Invariant 7: each node owns its value; the base stores nothing.
    this.value = value;
    this._treeContext = treeContext;
    this.addFlag(F_STATIC);
  }

  get isClass() {
    return /^\./.test(this.value);
  }

  get isId() {
    return /^#/.test(this.value);
  }

  /** A tag-type selector */
  get isTag() {
    return /^[^.#*]/.test(this.value);
  }

  override evalNode(context: Context): BasicSelector {
    const node = this;
    void super.evalNode(context);
    if (node.isClass) {
      context.hashClass(node.value);
    }
    return node;
  }

  override valueOf(): string {
    return (this._valueOf ??= (this.isTag && !this.value.includes('\\') ? this.value.toLowerCase() : this.value));
  }

  override toTrimmedString(options?: PrintOptions): string {
    const out = this.valueOf();
    options?.writer?.add(out, this);
    return out;
  }

  override writeSyntax(options: FinalPrintOptions): void {
    options.writer.add(this.valueOf(), this);
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
