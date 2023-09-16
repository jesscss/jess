import { defineType, Node } from './node'

/**
 * This is a variable reference, which
 * can include imported (JS) variables.
 */
export class Variable extends Node<string> {
  // register(context: Context, name: string, node: Declaration<string>): void {
  //   context.scope.setVar(name, node, this.options)
  // }
}

export const varref = defineType(Variable, 'Variable', 'varref')