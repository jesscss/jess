import { Node, defineType } from './node'

/**
 * An expression is a node that returns a value.
 * It can contain values, references, and operations.
 *
 * In Less/Sass, everything containing an operation is
 * an expression.
 *
 * A "live expression" is bound to a var() function.
 * AHHHH THIS IS SO SMART
 *   e.g. `var(--foo, $foo)`
 *   - $foo and all it's dependencies are exported into
 *     the module. This is waaaay smarter than Vue's v-bind
 */
export class Expression extends Node<Node> {
  declare value: Node
  type = 'Expression' as const
  shortType = 'expr' as const

  override toTrimmedString(depth?: number): string {
    return `#(${this.value.toString(depth)})`
  }
}

type Params = ConstructorParameters<typeof Expression>

export const expr = defineType(Expression, 'Expression', 'expr') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => Expression