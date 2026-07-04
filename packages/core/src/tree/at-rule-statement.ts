import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { type Context } from '../context.js';
import {
  defineType,
  F_ALLOW_ROOT,
  F_STATIC,
  Node,
  type LocationInfo,
  type NodeOptions
} from './node.js';
import { type FinalPrintOptions, getPrintOptions, type PrintOptions } from './util/print.js';
import { type RenderBuffer } from './util/render-buffer.js';
import { Interpolated } from './interpolated.js';

export type AtRuleStatementField = string | Node;

export type AtRuleStatementName = string | Interpolated;

export type AtRuleStatementValue = {
  name: AtRuleStatementName;
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

  name: AtRuleStatementName;
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
    // Invariant 7: store, don't adopt. `parentChildren()` (factory) parents.
    this.name = value.name;
    this.prelude = value.prelude;
    this._treeContext = treeContext;
    this.addFlag(F_ALLOW_ROOT);
  }

  override clone(cloneFn?: (n: Node) => Node): this {
    const name = cloneFn && this.name instanceof Interpolated
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- cloneFn preserves the Interpolated name type
      ? cloneFn(this.name) as Interpolated
      : this.name;
    const prelude = cloneFn && this.prelude instanceof Node ? cloneFn(this.prelude) : this.prelude;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return new AtRuleStatement(
      {
        name,
        prelude
      },
      this._options ? { ...this._options } : undefined,
      this._location?.length ? this._location : undefined,
      this._treeContext
    ).inherit(this) as this;
  }

  override resolve(context: Context): MaybePromise<AtRuleStatement> {
    if (this.hasFlag(F_STATIC)) {
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return this.eval(context) as MaybePromise<AtRuleStatement>;
  }

  protected override evalNode(context: Context): MaybePromise<AtRuleStatement> {
    const evalField = (field: AtRuleStatementField): MaybePromise<AtRuleStatementField> => (
      field instanceof Node ? field.eval(context) : field
    );
    const finish = (
      name: AtRuleStatementName,
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
    // Interpolated names resolve to a plain string; the stored name stays string | Interpolated.
    const name: MaybePromise<AtRuleStatementName> = this.name instanceof Interpolated
      ? (() => {
          const resolved = this.name.eval(context);
          return isThenable(resolved)
            ? resolved.then(value => String(value.valueOf()))
            : String(resolved.valueOf());
        })()
      : this.name;
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
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

  override writeSyntax(options: FinalPrintOptions): void {
    const writer = options.writer;
    if (typeof this.name === 'string') {
      writer.add(this.name, this);
    } else {
      this.name.writeSyntax(options);
    }
    if (this.prelude !== undefined && this.prelude !== '') {
      writer.add(' ');
      if (typeof this.prelude === 'string') {
        writer.add(trimLeadingHeaderWhitespace(this.prelude), this);
      } else {
        const type = this.prelude.type;
        if (type === 'Any' || type === 'Anonymous' || type === 'Keyword') {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const v = (this.prelude as { value?: unknown }).value;
          writer.add(trimLeadingHeaderWhitespace(typeof v === 'string' ? v : String(this.prelude.valueOf())), this.prelude);
        } else {
          this.prelude.writeSyntax(options);
        }
      }
    }
    writer.add(';', this);
  }
}

export const atrulestatement = defineType(AtRuleStatement, 'AtRuleStatement', 'atrulestatement');
