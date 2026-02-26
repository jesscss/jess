import { Node, F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC, defineType } from './node.js';
import { Any, type AnyRole, type AnyOptions } from './any.js';
import type { Context } from '../context.js';
import { isNode } from './util/is-node.js';
import { BasicSelector } from './selector-basic.js';
import { SelectorList } from './selector-list.js';
import type { Selector } from './selector.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, serialForEach, isThenable } from '@jesscss/awaitable-pipe';

// Placeholder that's very unlikely to appear in user strings
// but is also easily typeable for tests
export const INTERPOLATION_PLACEHOLDER = '%%';
const INTERPOLATION_PLACEHOLDER_REGEXP = /%%/g;

export type InterpolatedValue = {
  /** String with INTERPOLATION_PLACEHOLDER placeholders */
  source: string;
  replacements: Node[];
};

/**
 * Merge an interface to declare the specific types
 *
 * @todo - Instead of extending simple selector, create a selector "wrapper"
 * that goes around expressions and interpolated values, so that it
 * casts as a selector after evaluation.
 *
 * This would eliminate the need for the `evalToSelector` and `evalToGeneric`
 * methods, because the wrapper would handle the returned node type.
 */
export interface Interpolated<
  Role extends AnyRole = AnyRole
> extends Node<InterpolatedValue, AnyOptions<Role>> {
  eval(context: Context): MaybePromise<Any<Role>>;
}
/**
 * An interpolated value is one that contains
 * reference variables, or expressions, but
 * which MUST resolve to a node with a string value
 * (like Anonymous) when evaluated.
 *
 * @example
 *   in Less:
 *     - `@@foo` is an interpolated variable
 *     - `--prop-@{foo}` is an interpolated property
 */
export class Interpolated<
  Role extends AnyRole = AnyRole
> extends Node<InterpolatedValue, AnyOptions<Role>> {
  type = 'Interpolated' as const;
  shortType = 'interpolated' as const;

  constructor(value: InterpolatedValue, options?: AnyOptions<Role>, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    // Interpolated nodes are always non-static and may be async
    this.addFlags(F_VISIBLE, F_MAY_ASYNC, F_NON_STATIC);
  }

  override valueOf(): string {
    return this.value.source;
  }

  replace(replacements: Node[]): string {
    let { source } = this.value;
    let output = source;
    let i = 0;
    output = output.replace(INTERPOLATION_PLACEHOLDER_REGEXP, () => {
      let replacement: Node | undefined;
      try {
        replacement = replacements[i++];
      } catch (error: unknown) {
        throw error;
      }
      let result = '';
      if (replacement) {
        try {
          result = String(replacement.valueOf());
        } catch (error: unknown) {
          throw error;
        }
      }
      // Trim whitespace to avoid issues with Sequence nodes that have pre/post spacing
      return result.trim();
    });

    return output;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const result = this.replace(this.value.replacements);
    w.add(result, this);
    return w.getSince(mark);
  }

  /**
   * Can turn simple #id, .class, element and list into a selector
   */
  createSelector() {
    let { source, replacements } = this.value;
    let segments = source.split(INTERPOLATION_PLACEHOLDER);
    let output = '';
    let list: string[] = [];
    for (let [i, replacement] of replacements.entries()) {
      if (!replacement.evaluated) {
        throw new Error('Cannot create selector from un-evaluated interpolated node');
      }
      if (isNode(replacement, 'List')) {
        for (let item of replacement.value) {
          list.push(this.replace([item, ...replacements.slice(i + 1)]));
        }
      } else {
        output += (segments[i] ?? '') + replacement.toTrimmedString();
      }
    }
    if (!list.length) {
      return new BasicSelector(output).inherit(this);
    } else {
      return new SelectorList(
        list.map(item => new BasicSelector(item))
      ).inherit(this);
    }
  }

  createGeneric() {
    const trimmedString = this.toTrimmedString();
    let any = new Any<Role>(trimmedString).inherit(this);
    any.options.role = this.options.role;
    return any;
  }

  /** Convenience: evaluate replacements then convert to Selector (BasicSelector or SelectorList) */
  evalToSelector(context: Context): MaybePromise<Selector> {
    const out = this._evalToInterpolated(context);
    if (isThenable(out)) {
      return (out as Promise<Interpolated<Role>>).then(node => node.createSelector());
    }
    return (out as Interpolated<Role>).createSelector();
  }

  override evalNode(context: Context): MaybePromise<Any> {
    const out = this._evalToInterpolated(context);
    if (isThenable(out)) {
      return (out as Promise<Interpolated<Role>>).then((node) => {
        return node.createGeneric();
      });
    }
    const result = (out as Interpolated<Role>).createGeneric();
    return result;
  }

  /**
   * Just evaluate replacements and return. We don't stringify yet,
   * because depending on the context, it will turn into different
   * node types.
   */
  _evalToInterpolated(context: Context): MaybePromise<this> {
    let node = this;
    let { replacements } = node.value;

    let maybe = serialForEach(replacements, (n, idx) => {
      const out = n.eval(context);
      if (isThenable(out)) {
        return (out as Promise<Node>).then((result) => {
          replacements[idx] = result;
        });
      }
      replacements[idx] = out as Node;
      return undefined;
    });
    if (isThenable(maybe)) {
      return maybe.then(() => node);
    }
    return node;
  }
}

export const interpolated = defineType(Interpolated, 'Interpolated');