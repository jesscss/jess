import type { Context } from '../context.js';
import { defineType } from './node.js';
import { SimpleSelector } from './selector-simple.js';
import { isNode } from './util/is-node.js';
import { type MaybePromise, pipe } from '@jesscss/awaitable-pipe';

export interface BasicSelector extends SimpleSelector<string> {
  eval(context: Context): BasicSelector;
}

/**
 * A basic selector
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_selectors/Selectors_and_combinators#basic_selectors
 *   e.g. div, .foo, #bar
*/
export class BasicSelector extends SimpleSelector<string> {
  type = 'BasicSelector' as const;
  shortType = 'el' as const;

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
    return pipe(
      () => super.evalNode(context) as BasicSelector,
      (node: BasicSelector) => {
        // Handle unresolved selector interpolation tokens that can be left by parser/eval,
        // e.g. "@{a2}" in selector position should resolve to the variable selector value.
        const raw = node.value.trim();
        const m = raw.match(/^@\{([^}]+)\}$/);
        if (m) {
          const key = m[1]!;
          const rules = node.rulesParent;
          if (rules) {
            const found = rules.find('declaration', key, 'VarDeclaration');
            const decl = Array.isArray(found) ? found[0] : found;
            if (decl && isNode(decl, 'VarDeclaration')) {
              const resolved = String(decl.value.value.valueOf?.() ?? decl.value.value ?? '');
              node.value = resolved;
            }
          }
        }
        if (node.isClass) {
          context.hashClass(node.value);
        }
        return node;
      }
    );
  }

  override valueOf(): string {
    return (this._valueOf ??= (this.isTag ? this.value.toLowerCase() : this.value));
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