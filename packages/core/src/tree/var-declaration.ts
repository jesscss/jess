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
  override requiredSemi = true
  override allowRuleRoot = true
  override allowRoot = true

  constructor(
    ...args: ConstructorParameters<typeof Declaration<VarDeclarationOptions, N>>
  ) {
    super(...args)
    if (isNode(this.value, 'Mixin')) {
      this.requiredSemi = false
    }
  }

  override toTrimmedString(depth?: number): string {
    const rule = this.options?.setDefined ? '$$' : '$'
    return `${rule}${this._declTrimmedString(depth)}`
  }
}

export const vardecl = defineType<DeclarationValue>(VarDeclaration, 'VarDeclaration', 'vardecl')
