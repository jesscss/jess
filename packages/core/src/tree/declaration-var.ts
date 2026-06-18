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
import type { Context } from '../context.js';

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
    location?: NodeLocation,
    treeContext?: Context['treeContext']
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
    if (this._options?.paramVar && this.valueNode instanceof Nil) {
      if (this.name instanceof Any) {
        const nameText = this.name.value.replace(/\s+$/u, '');
        w.add('$', this);
        w.add(nameText, this.name);
        return `$${nameText}`;
      }
      this.writeBareParameterSyntax(options);
      return w.getSince(mark);
    }
    this.writeSyntax(options);
    return w.getSince(mark);
  }

  private writeBareParameterSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('$', this);
    if (this.name instanceof Any) {
      w.add(this.name.value.replace(/\s+$/u, ''), this.name);
      return;
    }
    const nameMark = w.mark();
    this.name.writeSyntax(options);
    w.trimEndSince(nameMark);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    if (this._options?.paramVar && this.valueNode instanceof Nil) {
      this.writeBareParameterSyntax(options);
      return;
    }
    const w = options.writer;
    w.add('$', this);
    const before = w.mark();
    const s = this.declTrimmedString(options);
    const emitted = w.getSince(before);
    if (!emitted && s) {
      w.add(s);
    }
  }
}
defineType<DeclarationValue>(VarDeclaration, 'VarDeclaration', 'vardecl');

export const vardecl = (
  value: DeclarationValue<AnyRole> | { name: string; value: Node; important?: Any<'flag'> },
  options?: VarDeclarationOptions,
  location?: NodeLocation,
  treeContext?: Context['treeContext']
) => {
  const { name } = value;
  const nameNode: DeclarationValue['name'] = typeof name === 'string'
    ? new Any(name, { role: 'property' })
    : name instanceof Any
      ? new Any(name.value, { role: 'property' })
      : name instanceof Interpolated
        ? new Interpolated(
          { source: name.source, replacements: name.replacements },
          { ...name.options, role: 'property' },
          name.location,
          name.sourceRoot?._treeContext
        )
        : name;
  const declarationValue: DeclarationValue = {
    ...value,
    name: nameNode
  };
  return new VarDeclaration(declarationValue, options, location, treeContext);
};
