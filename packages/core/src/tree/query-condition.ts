import type { Context } from '../context.js';
import { OutputWriter, type FinalPrintOptions, getPrintOptions, prepareRenderPrintState, type PrintOptions } from './util/print.js';
import { defineType, F_STATIC, type Node } from './node.js';
import { Sequence } from './sequence.js';
import { Paren } from './paren.js';
import { Condition } from './condition.js';
import { Operation } from './operation.js';
import { Any, Anonymous, Keyword } from './any.js';
import { Bool } from './bool.js';
import { Color } from './color.js';
import { Dimension } from './dimension.js';
import { Num } from './number.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  type RenderBuffer,
  writeRenderText
} from './util/render-buffer.js';

function getKnownQueryConditionSourceText(node: Node | string): string | undefined {
  if (typeof node === 'string') {
    return node;
  }
  if (node instanceof Any) {
    return node.value;
  }
  if (node instanceof Dimension) {
    return `${node.number}${node.unit ?? ''}`;
  }
  if (node instanceof Num) {
    return `${node.number}`;
  }
  if (node instanceof Bool) {
    return node.value ? 'true' : 'false';
  }
  if (node instanceof Color) {
    return typeof node.node === 'string' ? node.node : undefined;
  }
  if (node.constructor === QueryCondition) {
    const qc = node as QueryCondition;
    const parts = new Array(qc.value.length);
    for (let i = 0; i < qc.value.length; i++) {
      const text = getKnownQueryConditionSourceText(qc.value[i]!);
      if (text === undefined) {
        return undefined;
      }
      parts[i] = text;
    }
    return parts.join(' ');
  }
  if (node.constructor === Paren) {
    const paren = node as Paren;
    const open = paren.options?.delimiter === 'square' ? '[' : '(';
    const close = paren.options?.delimiter === 'square' ? ']' : ')';
    if (!paren.value) {
      return `${paren.options?.escaped ? '~' : ''}${open}${close}`;
    }
    const value = getKnownQueryConditionSourceText(paren.value);
    if (value === undefined) {
      return undefined;
    }
    return `${paren.options?.escaped ? '~' : ''}${open}${value}${close}`;
  }
  if (node.constructor === Condition) {
    const cond = node as Condition;
    const left = getKnownQueryConditionSourceText(cond.left);
    if (left === undefined) {
      return undefined;
    }
    const needsParens = Boolean(cond.right || cond.negate);
    let out = cond.negate ? 'not ' : '';
    if (needsParens) {
      out += '(';
    }
    out += left;
    if (cond.operator && cond.right) {
      const right = getKnownQueryConditionSourceText(cond.right);
      if (right === undefined) {
        return undefined;
      }
      out += ` ${cond.operator} ${right}`;
    }
    if (needsParens) {
      out += ')';
    }
    return out;
  }
  if (node.constructor === Operation) {
    const op = node as Operation;
    const left = getKnownQueryConditionSourceText(op.left);
    const right = getKnownQueryConditionSourceText(op.right);
    if (left === undefined || right === undefined) {
      return undefined;
    }
    return `${left} ${op.operator} ${right}`;
  }
  return undefined;
}

/**
 * Used by `@media`, `@supports`, and `@container`
 *
 * This just helps identify conditions if we need to
 * merge them later.
 *
 * @todo - add more structure?
 */
export class QueryCondition extends Sequence {
  static override childKeys = ['value'] as const;

  /**
   * Fast-path only node classes whose source syntax writer is known to be
   * concrete in the current tree model.
   *
   * Query conditions are intentionally stricter than generic `Node.writeSyntax`
   * because this path is used to prove static query rendering does not fall
   * back to writer readback, child render, or public string transport. A node
   * should be added here only after its own class owns a direct `writeSyntax`
   * implementation that writes the exact authored syntax and does not rely on
   * `Node.toTrimmedString()` readback.
   *
   * Remove this whitelist when every node type that can appear in parser-owned
   * query conditions has a direct `writeSyntax` contract. At that point
   * `writeStaticChild` can call `node.writeSyntax(options)` unconditionally and
   * the compatibility-lane tests below should be deleted or moved to a cold
   * extension compatibility path.
   */
  private canWriteStaticChildDirect(node: Node): boolean {
    return (
      node.type === 'Any'
      || node.type === 'Anonymous'
      || node.type === 'Keyword'
      || node.type === 'Dimension'
      || node.type === 'Num'
      || node.type === 'Bool'
      || node.type === 'Color'
      || node.constructor === QueryCondition
      || node.constructor === Paren
      || node.constructor === Condition
      || node.constructor === Operation
    );
  }

  /**
   * Static query syntax writer with a temporary compatibility lane for
   * custom/subclassed nodes that may not yet participate in the direct writer
   * contract.
   *
   * This compatibility lane exists only to keep custom overrides, such as a
   * subclassed `Paren.writeSyntax`, correct while the node family migration is
   * incomplete. It intentionally keeps a localized ownership check for unknown
   * static children, so those children must not be normalized into the fast
   * path until their concrete class owns direct syntax output.
   *
   * Expected deletion condition: once query-condition child types no longer use
   * inherited/default `Node.writeSyntax` for real source syntax, delete
   * `canWriteStaticChildDirect`, delete this compatibility branch, and make
   * this method a straight `node.writeSyntax(options)` call.
   */
  private writeStaticChild(node: Node | string, options: FinalPrintOptions): void {
    // A query condition's value may hold plain strings for the feature name and
    // comparison operator (e.g. ['width', '>', <Dimension>]) — write them verbatim.
    if (typeof node === 'string') {
      options.writer.add(node);
      return;
    }
    if (this.canWriteStaticChildDirect(node)) {
      node.writeSyntax(options);
      return;
    }
    const before = options.writer.position();
    node.writeSyntax(options);
    if (options.writer.position() === before) {
      node.toTrimmedString(options);
    }
  }

  /**
   * Dynamic query children can only skip the localized writer readback when
   * their concrete render contract is known to return the same text they emit.
   *
   * Keep this exact-constructor whitelist narrow so custom subclasses and
   * instance-owned render overrides continue to use localized active-writer
   * recovery when they write different text than they return.
   */
  private canTrustDynamicChildRenderText(node: Node): boolean {
    return (
      node.constructor === Any
      || node.constructor === Anonymous
      || node.constructor === Keyword
      || node.constructor === Dimension
      || node.constructor === Num
      || node.constructor === Bool
      || node.constructor === Color
      || node.constructor === QueryCondition
      || node.constructor === Paren
      || node.constructor === Condition
      || node.constructor === Operation
    );
  }

  private writeQueryConditionSyntax(value: Node[], options: FinalPrintOptions): void {
    const w = options.writer;
    const length = value.length;

    if (length === 0) {
      return;
    }

    for (let i = 0; i < length; i++) {
      if (i > 0) {
        w.add(' ');
      }
      const saved = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      try {
        this.writeStaticChild(value[i]!, options);
      } finally {
        options.suppressBoundaryTrivia = saved;
      }
    }
  }

  private renderQueryConditionSyntax(value: Node[], rawOptions?: PrintOptions, context?: Context): string | MaybePromise<string> {
    const options = getPrintOptions(rawOptions);
    const w = options.writer;
    const length = value.length;

    if (length === 0) {
      return '';
    }

    if (!context) {
      const mark = w.mark();
      this.writeQueryConditionSyntax(value, options);
      return w.getSince(mark);
    }

    let out = '';
    for (let i = 0; i < length; i++) {
      if (i > 0) {
        w.add(' ');
        out += ' ';
      }
      const rendered = this.renderQueryConditionChild(value[i]!, options, context);
      if (isThenable(rendered)) {
        return (rendered as Promise<string | void>)
          .then(text => this.renderQueryConditionRest(value, options, context, i + 1, out + (text ?? '')));
      }
      out += rendered ?? '';
    }

    return out;
  }

  private renderQueryConditionChild(
    node: Node,
    options: FinalPrintOptions,
    context: Context
  ): MaybePromise<string | void> {
    const w = options.writer;
    const saved = options.suppressBoundaryTrivia;
    options.suppressBoundaryTrivia = 'pre';
    if (node.hasFlag(F_STATIC)) {
      try {
        const rendered = node.render(context, options);
        if (isThenable(rendered)) {
          const before = w.position();
          return rendered.then(
            (out) => {
              if (w.position() === before) {
                w.add(out);
              } else {
                return w.getSince(before);
              }
              options.suppressBoundaryTrivia = saved;
              return out;
            },
            (error) => {
              options.suppressBoundaryTrivia = saved;
              throw error;
            }
          );
        }
        return rendered;
      } finally {
        options.suppressBoundaryTrivia = saved;
      }
    }

    const before = w.position();
    let asyncOut = false;
    const canTrustText = this.canTrustDynamicChildRenderText(node);
    try {
      const out = node.render(context, options);
      if (isThenable(out)) {
        asyncOut = true;
        return out.then(
          (rendered) => {
            if (w.position() === before) {
              w.add(rendered);
            } else if (!canTrustText) {
              return w.getSince(before);
            }
            options.suppressBoundaryTrivia = saved;
            return rendered;
          },
          (error) => {
            options.suppressBoundaryTrivia = saved;
            throw error;
          }
        );
      }
      if (typeof out === 'string') {
        if (w.position() === before) {
          w.add(out);
        } else if (!canTrustText) {
          return w.getSince(before);
        }
      }
      options.suppressBoundaryTrivia = saved;
      return out;
    } finally {
      if (!asyncOut) {
        options.suppressBoundaryTrivia = saved;
      }
    }
  }

  private async renderQueryConditionRest(
    value: Node[],
    options: FinalPrintOptions,
    context: Context,
    start: number,
    out: string
  ): Promise<string> {
    const w = options.writer;
    const length = value.length;
    for (let i = start; i < length; i++) {
      if (i > 0) {
        w.add(' ');
        out += ' ';
      }
      out += (await this.renderQueryConditionChild(value[i]!, options, context)) ?? '';
    }
    return out;
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    this.writeQueryConditionSyntax(this.value, options);
  }

  override toTrimmedString(options?: PrintOptions): string {
    if (this.value.length === 0) {
      return '';
    }
    const printOptions = getPrintOptions(options);
    if (!printOptions.trivia) {
      const out = getKnownQueryConditionSourceText(this);
      if (out !== undefined) {
        printOptions.writer.add(out, this);
        return out;
      }
    }
    const position = printOptions.writer.position();
    this.writeSyntax(printOptions);
    return printOptions.writer.getSince(position);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const sharesWriter = Boolean(buffer && 'shareWriter' in buffer && buffer.shareWriter);
    const prepared = buffer
      ? sharesWriter
        ? prepareRenderPrintState(context, {
            ...options,
            writer: buffer.kind === 'flat' && context.printState.writer?.writesTo(buffer.parts)
              ? context.printState.writer
              : new OutputWriter(false, buffer.kind === 'flat' ? buffer.parts : undefined)
          })
        : prepareBufferPrintState(context, options)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      : prepareRenderPrintState(context, buffer ? undefined : bufferOrOptions as PrintOptions | undefined);
    if (this.hasFlag(F_STATIC)) {
      const directText = !prepared.trivia ? getKnownQueryConditionSourceText(this) : undefined;
      if (directText !== undefined) {
        if (buffer) {
          if (sharesWriter) {
            this.writeQueryConditionSyntax(this.value, prepared);
            return directText;
          }
          return writeRenderText(buffer, directText);
        }
        prepared.writer.add(directText, this);
        return directText;
      }
      const position = prepared.writer.position();
      this.writeQueryConditionSyntax(this.value, prepared);
      const rendered = prepared.writer.getSince(position);
      return buffer
        ? sharesWriter ? rendered : writeRenderText(buffer, rendered)
        : rendered;
    }
    const rendered = this.renderQueryConditionSyntax(this.value, prepared, context);
    if (isThenable(rendered)) {
      return buffer
        ? (rendered as Promise<string>).then(out => writeRenderText(buffer, out))
        : rendered;
    }
    return buffer
      ? writeRenderText(buffer, rendered as string)
      : rendered as string;
  }
}
export const query = defineType(QueryCondition, 'QueryCondition', 'query');
