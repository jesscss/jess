import { Node, defineType } from './node';
import { Selector } from './selector';

/**
 * An expression is a node that returns a value.
 * It can contain values, references, and operations.
 *
 * In Less/Sass, everything containing an operation is
 * an expression.
 *
 * @note This extends Selector just because it can be
 * in the selector position (initially).
 */
export class Expression extends Selector<Node> {
  type = 'Expression' as const;
  shortType = 'expr' as const;

  override get keySet(): Set<string> {
    return new Set();
  }

  override toTrimmedString(depth?: number): string {
    return `#(${this.value.toString(depth)})`;
  }
}

type Params = ConstructorParameters<typeof Expression>;

export const expr = defineType(Expression, 'Expression', 'expr') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => Expression;