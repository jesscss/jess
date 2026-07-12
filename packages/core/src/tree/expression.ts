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
  toTrimmedString(depth?: number): string {
    return `#(${this.value.toString(depth)})`
  }
}
export const expr = defineType(Expression, 'Expression', 'expr')