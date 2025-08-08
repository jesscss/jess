import { defineType } from './node';
import { Rules } from './rules';

/**
 * A collection is essentially like an anonymous mixin,
 * except that properties are arbitrary, so its intended
 * for map data.
 *
 * Even though it doesn't allow everything that a regular set
 * of rules does, we extend Rules just to make evaluation easier.
 *
 * Can be used like Sass property nesting.
 * @see https://sass-lang.com/documentation/style-rules/declarations/#nesting
 */
export class Collection extends Rules {
  override type = 'Collection' as const;
  override shortType = 'coll' as const;

  override toTrimmedString(depth: number = 0) {
    return this.toBraced(depth);
  }
}

type Params = ConstructorParameters<typeof Collection>;

export const coll = defineType(Collection, 'Collection', 'coll') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => Collection;