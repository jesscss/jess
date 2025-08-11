import { type Node, defineType } from './node';
import { Any, type AnyRole, type AnyOptions } from './any';
import type { Context } from '../context';
import { isNode } from './util/is-node';
import { BasicSelector } from './selector-basic';
import { SelectorList } from './selector-list';
import { SimpleSelector } from './selector-simple';
import { type PrintOptions, getPrintOptions } from './util/print';

export type InterpolatedValue = {
  /** String with {} placeholders */
  source: string;
  replacements: Node[];
};

/**
 * Merge an interface to declare the specific types
 */
export interface Interpolated<
  Role extends AnyRole = AnyRole
> extends SimpleSelector<InterpolatedValue, AnyOptions<Role>> {
  eval(context: Context): Promise<Interpolated<Role>>;
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
> extends SimpleSelector<InterpolatedValue, AnyOptions<Role>> {
  type = 'Interpolated' as const;
  shortType = 'interpolated' as const;

  override valueOf(): string {
    return this.value.source;
  }

  replace(replacements: Node[], options?: PrintOptions): string {
    let { source } = this.value;
    let output = source;
    let i = 0;
    output = output.replace(/{}/g, (_) => {
      return replacements[i++]?.toTrimmedString(options) ?? '';
    });
    return output;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add(this.replace(this.value.replacements, options), this);
    return w.getSince(mark);
  }

  /**
   * Can turn simple #id, .class, element and list into a selector
   */
  createSelector() {
    let { source, replacements } = this.value;
    let segments = source.split('{}');
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
    let any = new Any<Role>(this.toTrimmedString()).inherit(this);
    any.options.role = this.options.role;
    return any;
  }

  /**
   * Just evaluate replacements and return. We don't stringify yet,
   * because depending on the context, it will turn into different
   * node types.
   */
  override async evalNode(context: Context) {
    let node = this.maybeClone(context);
    let { replacements } = node.value;
    node.value.replacements = await Promise.all(replacements.map(async (n: Node) => await n.eval(context)));
    return node;
  }
}

export const interpolated = defineType(Interpolated, 'Interpolated');