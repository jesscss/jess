import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { type Context } from '../context.js';
import {
  defineType,
  F_STATIC,
  Node,
  type LocationInfo,
  type NodeOptions
} from './node.js';
import { type FinalPrintOptions, getPrintOptions, type PrintOptions } from './util/print.js';
import { type RenderBuffer } from './util/render-buffer.js';

export type AtRuleStatementField = string | Node;

export type AtRuleStatementValue = {
  name: AtRuleStatementField;
  prelude?: AtRuleStatementField;
};

function trimLeadingHeaderWhitespace(text: string): string {
  return text.replace(/^\s+/u, '');
}

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
    super();
    this._location = location;
    this._options = options;
    this.name = this._processNodes(value.name);
    this.prelude = this._processNodes(value.prelude);
    this._treeContext = treeContext;
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

  override resolve(context: Context): MaybePromise<AtRuleStatement> {
    if (this.hasFlag(F_STATIC)) {
      return this;
    }
    return this.eval(context);
  }

  protected override evalNode(context: Context): MaybePromise<AtRuleStatement> {
    const evalField = (field: AtRuleStatementField): MaybePromise<AtRuleStatementField> => (
      field instanceof Node ? field.eval(context) : field
    );
    const finish = (
      name: AtRuleStatementField,
      prelude: AtRuleStatementField | undefined
    ): AtRuleStatement => {
      if (name === this.name && prelude === this.prelude) {
        return this;
      }
      return new AtRuleStatement(
        {
          name,
          ...(prelude !== undefined && { prelude })
        },
        this._options ? { ...this._options } : undefined,
        this._location?.length ? this._location : undefined,
        this._treeContext
      ).inherit(this);
    };
    const name = evalField(this.name);
    if (isThenable(name)) {
      return name.then((evaluatedName) => {
        const prelude = this.prelude === undefined ? undefined : evalField(this.prelude);
        return isThenable(prelude)
          ? prelude.then(evaluatedPrelude => finish(evaluatedName, evaluatedPrelude))
          : finish(evaluatedName, prelude);
      });
    }
    const prelude = this.prelude === undefined ? undefined : evalField(this.prelude);
    return isThenable(prelude)
      ? prelude.then(evaluatedPrelude => finish(name, evaluatedPrelude))
      : finish(name, prelude);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): MaybePromise<string>;
  override render(
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): MaybePromise<string> {
    if (this.hasFlag(F_STATIC)) {
      return super.render(context, bufferOrOptions as RenderBuffer, options);
    }
    const evaluated = this.eval(context);
    return isThenable(evaluated)
      ? evaluated.then(node => this.renderOutput(context, node, bufferOrOptions, options))
      : this.renderOutput(context, evaluated, bufferOrOptions, options);
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

  private writeField(field: AtRuleStatementField, options: FinalPrintOptions, trimLeading = false): void {
    if (typeof field === 'string') {
      options.writer.add(trimLeading ? trimLeadingHeaderWhitespace(field) : field, this);
      return;
    }
    const scalarValue = (field as { value?: unknown }).value;
    if (typeof scalarValue === 'string') {
      options.writer.add(trimLeading ? trimLeadingHeaderWhitespace(scalarValue) : scalarValue, field);
      return;
    }
    if (field instanceof Node) {
      field.writeSyntax(options);
      return;
    }
  }

  override writeSyntax(options: FinalPrintOptions): void {
    const writer = options.writer;
    this.writeField(this.name, options);
    if (this.prelude !== undefined && this.prelude !== '') {
      writer.add(' ');
      this.writeField(this.prelude, options, true);
    }
    writer.add(';', this);
  }
}

export const atrulestatement = defineType(AtRuleStatement, 'AtRuleStatement', 'atrulestatement');
