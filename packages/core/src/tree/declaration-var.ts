import {
  Declaration,
  type DeclarationValue,
  type DeclarationOptions
} from './declaration';
import { Any, type AnyRole } from './any';
import { defineType, F_VISIBLE, type LocationInfo, type Node, type TreeContext } from './node';
import { type PrintOptions, getPrintOptions } from './util/print.js';

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
  override state = 0b0000; // 0b0000 means no flags are set

  constructor(
    value: DeclarationValue,
    options?: VarDeclarationOptions,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    super(value, options, location, treeContext);
    /** Parameter declarations are not like var declarations */
    if (options?.paramVar) {
      this.addFlag(F_VISIBLE);
    }
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const rule = this.options?.setDefined ? '$^' : '$';
    w.add(rule, this);
    const before = w.mark();
    const s = this.declTrimmedString(options);
    const emitted = w.getSince(before);
    if (!emitted && s) w.add(s);
    return w.getSince(mark);
  }
}
defineType<DeclarationValue>(VarDeclaration, 'VarDeclaration', 'vardecl');

export const vardecl = (
  value: DeclarationValue<AnyRole> | { name: string; value: Node; important?: Any<'flag'> },
  options?: VarDeclarationOptions,
  location?: LocationInfo,
  treeContext?: TreeContext
) => {
  let { name } = value;
  value.name = typeof name === 'string' ? new Any(name, { role: 'property' }) : name;
  return new VarDeclaration(value as DeclarationValue, options, location, treeContext);
};
