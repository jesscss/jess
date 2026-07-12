import {
  Declaration,
  type DeclarationValue,
  type DeclarationOptions
} from './declaration.js';
import { Any, type AnyRole } from './any.js';
import { Interpolated } from './interpolated.js';
import { defineType, F_VISIBLE, type Node, type NodeLocation, type TreeContext } from './node.js';
import { Nil } from './nil.js';
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
  override allowRuleRoot = true;
  override allowRoot = true;
  constructor(
    value: DeclarationValue<AnyRole>,
    options?: VarDeclarationOptions,
    location?: NodeLocation,
    treeContext?: TreeContext
  ) {
    super(value, options, location, treeContext);
    this.removeFlag(F_VISIBLE);
    /** Parameter declarations are not like var declarations */
    if (options?.paramVar) {
      this.addFlag(F_VISIBLE);
    }
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    // Vars always print with `$` prefix; setDefined affects the assignment token.
    //
    // Special-case parameter vars (used in mixin signatures) that have no default value:
    // print `$name` (no `: <value>`).
    if (this._options?.paramVar && this.value.value instanceof Nil) {
      w.add('$', this);
      const normalizedName = String(this.value.name).replace(/\s+$/, '');
      w.add(normalizedName, this.value.name);
      return w.getSince(mark);
    }

    w.add('$', this);
    const before = w.mark();
    const s = this.declTrimmedString(options);
    const emitted = w.getSince(before);
    if (!emitted && s) {
      w.add(s);
    }
    return w.getSince(mark);
  }
}
defineType<DeclarationValue>(VarDeclaration, 'VarDeclaration', 'vardecl');

export const vardecl = (
  value: DeclarationValue<AnyRole> | { name: string; value: Node; important?: Any<'flag'> },
  options?: VarDeclarationOptions,
  location?: NodeLocation,
  treeContext?: TreeContext
) => {
  const { name } = value;
  const nameNode: DeclarationValue['name'] = typeof name === 'string'
    ? new Any(name, { role: 'property' })
    : name instanceof Any
      ? new Any(name.value, { role: 'property' })
      : name instanceof Interpolated
        ? new Interpolated(name.value, { ...name.options, role: 'property' }, name.location, name.treeContext)
        : name;
  const declarationValue: DeclarationValue = {
    ...value,
    name: nameNode
  };
  return new VarDeclaration(declarationValue, options, location, treeContext);
};
