import { Declaration, type DeclarationOptions } from './declaration'
import { defineType, type Node } from './node'
import type { Interpolated } from './interpolated'

export type VarDeclarationOptions = DeclarationOptions & {
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
   * Used by Jess (@let) and SCSS in the case of mixins
   */
  throwIfDefined?: boolean
}

/**
 * @example
 *   Jess: `@let var: 1`
 *   Less: `@var: 1`
 *   SCSS: `$var: 1`
 *
 * @example `setDefined`
 *   Jess: `@set var: 1`
 *   SCSS: `$var: 1 !global`
 *
 * @note This is extended by mixins, who also implicitly
 * declare a type of var in scope.
 */
export class VarDeclaration<
  T extends Interpolated | string = Interpolated | string,
  U extends Node = Node
> extends Declaration <T, U, VarDeclarationOptions> {
  // register(context: Context, name: string, node: Declaration<string>): void {
  //   context.scope.setVar(name, node, this.options)
  // }
}

export const vardecl = defineType(VarDeclaration, 'VarDeclaration', 'vardecl')