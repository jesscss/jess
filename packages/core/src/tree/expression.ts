import type { Context } from '../context';
import { Node, defineType } from './node';
import { Selector } from './selector';

export type ExpressionOptions = {
  parens?: boolean;
};

/**
 * An expression is a node that returns a value.
 * It can contain values, references, and operations.
 *
 * When parsing Less/Sass, everything containing an operation is
 * considered an expression.
 *
 * @note This extends Selector just because it can be
 * in the selector position (initially).
 */
export class Expression extends Selector<Node, ExpressionOptions> {
  type = 'Expression' as const;
  shortType = 'expr' as const;

  override get keySet(): Set<string> {
    return new Set();
  }

  override async evalNode(context: Context) {
    let { value } = this;
    let evald = await value.eval(context);
    return evald;
  }

  override toTrimmedString(depth?: number): string {
    let { parens } = this.options;
    let left = parens ? '(' : '';
    let right = parens ? ')' : '';
    return `$${left}${this.value.toString(depth)}${right}`;
  }
}

type Params = ConstructorParameters<typeof Expression>;

export const expr = defineType(Expression, 'Expression', 'expr') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => Expression;