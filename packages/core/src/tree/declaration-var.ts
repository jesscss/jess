import {
  Declaration,
  type DeclarationValue,
  type DeclarationParams
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
 *   Jess: `$^foo: 1`
 *   SCSS: `$foo: 1 !global`
 *
 *
 * @todo Support destructuring
 * e.g. `$(var1, var2): 1 2`
 */
export class VarDeclaration extends Declaration {
  override type = 'VarDeclaration';
  override shortType = 'vardecl';
  override allowRuleRoot = true;
  override allowRoot = true;
  override visible = false;

  override toTrimmedString(depth?: number): string {
    const rule = this.options?.setDefined ? '$^' : '$';
    return `${rule}${this.declTrimmedString(depth)}`;
  }
}

export const vardecl = defineType<DeclarationValue>(VarDeclaration, 'VarDeclaration', 'vardecl') as (
  value: DeclarationValue | DeclarationParams[0],
  options?: DeclarationParams[1],
  location?: DeclarationParams[2],
  treeContext?: DeclarationParams[3]
) => VarDeclaration;
