import {
  Declaration,
  type DeclarationValue,
  type DeclarationParams,
  type DeclarationOptions
} from './declaration';
import { type General, Name } from './general';
import { defineType, type LocationInfo, type Node, type TreeContext } from './node';

export type VarDeclarationOptions = DeclarationOptions & {
  paramVar?: boolean;
};

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
export class VarDeclaration extends Declaration<VarDeclarationOptions> {
  override type = 'VarDeclaration';
  override shortType = 'vardecl';
  override allowRuleRoot = true;
  override allowRoot = true;
  override visible = false;

  constructor(
    value: DeclarationValue,
    options?: VarDeclarationOptions,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    super(value, options, location, treeContext);
    /** Parameter declarations are not like var declarations */
    if (options?.paramVar) {
      this.visible = true;
    }
  }

  override toTrimmedString(depth?: number): string {
    const rule = this.options?.setDefined ? '$^' : '$';
    return `${rule}${this.declTrimmedString(depth)}`;
  }
}
defineType<DeclarationValue>(VarDeclaration, 'VarDeclaration', 'vardecl');

export const vardecl = (
  value: DeclarationValue | { name: string; value: Node; important?: General<'Flag'> },
  options?: VarDeclarationOptions,
  location?: LocationInfo,
  treeContext?: TreeContext
) => {
  let { name } = value;
  value.name = typeof name === 'string' ? new Name(name) : name;
  return new VarDeclaration(value as DeclarationValue, options, location, treeContext);
};
