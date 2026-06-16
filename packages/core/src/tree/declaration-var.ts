import {
  Declaration,
  type DeclarationValue,
  type DeclarationOptions
} from './declaration.js';
import { Any, type AnyRole } from './any.js';
import { Interpolated } from './interpolated.js';
import { defineType, F_VISIBLE, type Node, type NodeLocation } from './node.js';
import { Nil } from './nil.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';

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
 *   Jess: `$foo := 1`
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
    location?: NodeLocation
  ) {
    super(value, options, location);
    this.removeFlag(F_VISIBLE);
    /** Parameter declarations are not like var declarations */
    if (options?.paramVar) {
      this.addFlag(F_VISIBLE);
    }
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    // Vars always print with `$` prefix; setDefined affects the assignment token.
    //
    // Special-case parameter vars (used in mixin signatures) that have no default value:
    // print `$name` (no `: <value>`).
    if (this._options?.paramVar && this.value.value instanceof Nil) {
      w.add('$', this);
      const name = this.value.name;
      if (name instanceof Any) {
        w.add(name.value.replace(/\s+$/, ''), name);
      } else {
        const mark = w.mark();
        name.writeSyntax(options);
        w.trimEndSince(mark);
      }
      return;
    }

    w.add('$', this);
    this.declTrimmedString(options);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    if (this._options?.paramVar && this.value.value instanceof Nil && this.value.name instanceof Any) {
      const out = `$${this.value.name.value.replace(/\s+$/, '')}`;
      options.writer.add(out, this);
      return out;
    }
    const mark = options.writer.mark();
    this.writeSyntax(options);
    const w = options.writer;
    return w.getSince(mark);
  }
}
defineType<DeclarationValue>(VarDeclaration, 'VarDeclaration', 'vardecl');

export const vardecl = (
  value: DeclarationValue<AnyRole> | { name: string; value: Node; important?: Any<'flag'> },
  options?: VarDeclarationOptions,
  location?: NodeLocation
) => {
  const { name } = value;
  const nameNode: DeclarationValue['name'] = typeof name === 'string'
    ? new Any(name, { role: 'property' })
    : name instanceof Any
      ? new Any(name.value, { role: 'property' })
      : name instanceof Interpolated
        ? new Interpolated(name.value, { ...name.options, role: 'property' }, name.location)
        : name;
  const declarationValue: DeclarationValue = {
    ...value,
    name: nameNode
  };
  return new VarDeclaration(declarationValue, options, location);
};
