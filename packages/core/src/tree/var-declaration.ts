import {
  Declaration,
  type DeclarationValue
} from './declaration';
import { defineType } from './node';

export type { DeclarationOptions as VarDeclarationOptions } from './declaration';

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
export class VarDeclaration extends Declaration {
  override type = 'VarDeclaration';
  override shortType = 'vardecl';
  override requiredSemi = true;
  override allowRuleRoot = true;
  override allowRoot = true;

  override toTrimmedString(depth?: number): string {
    const rule = this.options?.setDefined ? '$$' : '$';
    return `${rule}${this.declTrimmedString(depth)}`;
  }
}

export const vardecl = defineType<DeclarationValue>(VarDeclaration, 'VarDeclaration', 'vardecl');
