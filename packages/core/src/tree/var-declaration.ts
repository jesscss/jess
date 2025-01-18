import {
  Declaration,
  type DeclarationValue,
  type DeclarationOptions
} from './declaration'
import { defineType } from './node'
import { isNode } from './util'
import { type DeclarationName } from './base-declaration'

export type VarDeclarationOptions = DeclarationOptions

/**
 * @example
 *   Jess: `$foo: 1`
 *   Less: `@foo: 1`
 *   SCSS: `$foo: 1`
 *
 * @example `setDefined`
 *   Jess: `$$foo: 1`
 *   SCSS: `$foo: 1 !global`
 *
 * @note This is extended by mixins, who also implicitly
 * declare a type of var in scope.
 *
 * @todo Support destructuring
 * e.g. `$(var1, var2): 1 2`
 */
export class VarDeclaration<N extends DeclarationName = DeclarationName> extends Declaration<VarDeclarationOptions, N> {
  // register(context: Context, name: string, node: Declaration<string>): void {
  //   context.scope.setVar(name, node, this.options)
  // }
  requiredSemi = true
  constructor(
    ...args: ConstructorParameters<typeof Declaration<VarDeclarationOptions, N>>
  ) {
    super(...args)
    if (isNode(this.value, 'Mixin')) {
      this.requiredSemi = false
    }
  }

  toTrimmedString(depth?: number): string {
    const rule = this.options?.setDefined ? '$$' : '$'
    const { name, value } = this.value
    const semi = this.options?.paramVar
      || isNode(value, 'Collection')
      || this.options?.semi !== true
      ? ''
      : ';'
    return `${rule}${name}:${value.toString(depth)}${semi}`
  }
}
VarDeclaration.prototype.allowRuleRoot = false
VarDeclaration.prototype.allowRoot = false

export const vardecl = defineType<DeclarationValue>(VarDeclaration, 'VarDeclaration', 'vardecl')
