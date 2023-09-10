import { Declaration } from './declaration'
import type { Node } from './node'

export type VariableOptions = {
  /**
   * Instead of implicitly declaring or overriding,
   * requires a variable to previously be explicitly
   * declared within scope.
   *
   * Used by SCSS (!global) and Jess (@set)
   */
  setDefined?: boolean

  /** Used by SCSS (!default) and Jess (?:) */
  setIfUndefined?: boolean
  /**
   * Throw if already defined in the immediate scope
   * Will not throw if defined in a parent scope.
   *
   * Used by Jess (@let)
   */
  throwIfDefined?: boolean
}

/** A variable declaration */
export class Variable<T = Node | string, U extends Node = Node> extends Declaration <T, U, VariableOptions> {
  // register(context: Context, name: string, node: Declaration<string>): void {
  //   context.scope.setVar(name, node, this.options)
  // }
}