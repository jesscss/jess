import { type Context } from '../context.js';
import {
  defineType,
  F_STATIC,
  Node,
  NO_VALUE,
  type LocationInfo,
  type NodeOptions
} from './node.js';
import { type FinalPrintOptions, getPrintOptions, type PrintOptions } from './util/print.js';

export type AtRuleStatementField = string | Node;

export type AtRuleStatementValue = {
  name: AtRuleStatementField;
  prelude?: AtRuleStatementField;
};

/**
 * Statement-form at-rule such as `@charset "utf-8";` or `@import "x.css";`.
 *
 * This node deliberately does not inherit from `Rules`: it has no block body
 * and should not carry the frame/eval machinery that block at-rules need.
 */
export class AtRuleStatement extends Node<AtRuleStatementValue, NodeOptions> {
  static override childKeys = ['name', 'prelude'] as const;

  override allowRoot = true;
  override allowRuleRoot = true;

  name: AtRuleStatementField;
  prelude: AtRuleStatementField | undefined;

  constructor(
    value: AtRuleStatementValue,
    options?: NodeOptions,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    super(NO_VALUE, options, location);
    this.name = this._processNodes(value.name);
    this.prelude = this._processNodes(value.prelude);
    this._treeContext = treeContext;
    this.addFlag(F_STATIC);
  }

  override clone(deep?: boolean, cloneFn?: (n: Node) => Node): AtRuleStatement {
    cloneFn ??= n => n.clone(deep);
    const name = deep && this.name instanceof Node ? cloneFn(this.name) : this.name;
    const prelude = deep && this.prelude instanceof Node ? cloneFn(this.prelude) : this.prelude;
    return new AtRuleStatement(
      {
        name,
        prelude
      },
      this._options ? { ...this._options } : undefined,
      this._location?.length ? this._location : undefined,
      this._treeContext
    ).inherit(this);
  }

  override resolve(_context: Context): this {
    return this;
  }

  override toTrimmedString(options?: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    const mark = printOptions.writer.mark();
    this.writeSyntax(printOptions);
    return printOptions.writer.getSince(mark);
  }

  override valueOf(): string {
    return this.prelude === undefined || this.prelude === ''
      ? String(this.name.valueOf())
      : `${String(this.name.valueOf())} ${String(this.prelude.valueOf())}`;
  }

  private writeField(field: AtRuleStatementField, options: FinalPrintOptions): void {
    if (field instanceof Node) {
      field.toTrimmedString(options);
      return;
    }
    options.writer.add(field, this);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    const writer = options.writer;
    this.writeField(this.name, options);
    if (this.prelude !== undefined && this.prelude !== '') {
      writer.add(' ');
      this.writeField(this.prelude, options);
    }
    writer.add(';', this);
  }
}

export const atrulestatement = defineType(AtRuleStatement, 'AtRuleStatement', 'atrulestatement');
