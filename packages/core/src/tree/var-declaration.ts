import { Declaration, type DeclarationOptions, type DeclarationValue } from './declaration'
import { defineType, type Node } from './node'
import type { Interpolated } from './interpolated'
import { isNode } from './util'

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
 *   Jess: `@let foo: 1`
 *   Less: `@foo: 1`
 *   SCSS: `$foo: 1`
 *
 * @example `setDefined`
 *   Jess: `@set foo: 1`
 *   SCSS: `$foo: 1 !global`
 *
 * @note This is extended by mixins, who also implicitly
 * declare a type of var in scope.
 *
 * @todo Support destructuring
 * e.g. `@let (var1, var2): 1 2`
 */
export class VarDeclaration<
  T extends Interpolated | string = Interpolated | string,
  U extends Node = Node
> extends Declaration <T, U, VarDeclarationOptions> {
  // register(context: Context, name: string, node: Declaration<string>): void {
  //   context.scope.setVar(name, node, this.options)
  // }
  toTrimmedString(depth?: number): string {
    const rule = this.options?.setDefined ? '@set ' : '@let '
    const { name, value } = this
    const semi = isNode(value, 'Collection') ? '' : ';'
    return `${rule}${name}: ${value.toString(depth)}${semi}`
  }
}

export const vardecl = defineType<DeclarationValue>(VarDeclaration, 'VarDeclaration', 'vardecl')
