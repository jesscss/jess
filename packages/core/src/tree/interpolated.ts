import { Node, F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC, defineType, type NodeLocation } from './node.js';
import { Any, type AnyRole, type AnyOptions } from './any.js';
import type { Context } from '../context.js';
import { BasicSelector } from './selector-basic.js';
import { CompoundSelector } from './selector-compound.js';
import type { Selector } from './selector.js';
import { PseudoSelector } from './selector-pseudo.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { OutputWriter, type FinalPrintOptions, type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  writeRenderText,
  type RenderBuffer
} from './util/render-buffer.js';
import { copyWithReusableLeaves } from './util/cloning.js';

// Placeholder that's very unlikely to appear in user strings
// but is also easily typeable for tests
export const INTERPOLATION_PLACEHOLDER = '%%';

function shouldWrapSelectorInIs(replacement: Node): boolean {
  if (isNode(replacement, N.SelectorList)) {
    return true;
  }
  if (isNode(replacement, N.ComplexSelector)) {
    return true;
  }
  if (replacement.type === 'SelectorCapture') {
    const arg = replacement.value;
    return isNode(arg, N.SelectorList) || isNode(arg, N.ComplexSelector);
  }
  const str = String(replacement.valueOf?.() ?? replacement);
  return str.includes(',');
}

function getIsWrapperArg(replacement: Node): Node {
  if (replacement.type === 'SelectorCapture') {
    const value = replacement.value;
    if (value instanceof Node) {
      return value;
    }
  }
  return replacement;
}

function serializeGeneratedIsWrapper(replacement: Node): string {
  const arg = getIsWrapperArg(replacement);
  const pseudo = PseudoSelector.create({ name: ':is', arg });
  pseudo.generated = true;
  const writer = new OutputWriter();
  pseudo.writeSyntax(getPrintOptions({ writer }));
  return writer.toString().replace(/\n\s*/g, ' ');
}

function stringifyReplacement(replacement: Node, options: PrintOptions, preserveQuotedSyntax?: boolean): string {
  const printOpts = getPrintOptions(options);
  const writer = new OutputWriter();
  const mark = writer.mark();
  writeReplacementSyntax(replacement, {
    ...printOpts,
    writer
  }, preserveQuotedSyntax);
  const result = writer.getSince(mark);
  return isNode(replacement, N.Reference) ? result : result.trim();
}

function writeReplacementSyntax(replacement: Node, options: FinalPrintOptions, preserveQuotedSyntax?: boolean): void {
  const w = options.writer;
  if (isNode(replacement, N.Quoted) && !preserveQuotedSyntax) {
    // Interpolated string slots merge raw string content.
    // Using valueOf() avoids re-emitting inner quote delimiters.
    w.add(String(replacement.valueOf()), replacement);
    return;
  }
  replacement.writeSyntax(options);
}

function createSimpleInterpolatedSelector(output: string, source: Node): BasicSelector | CompoundSelector {
  if (output.includes(':') || output.includes('[') || output.includes('&')) {
    return new BasicSelector(output).inherit(source);
  }
  let firstToken: string | undefined;
  let selectors: BasicSelector[] | undefined;
  let tokenStart = -1;
  for (let i = 0; i < output.length; i++) {
    const code = output.charCodeAt(i);
    if (
      code === 0x20
      || code === 0x09
      || code === 0x0a
      || code === 0x0c
      || code === 0x0d
    ) {
      if (tokenStart >= 0 && i > tokenStart) {
        const token = output.slice(tokenStart, i);
        if (firstToken === undefined) {
          firstToken = token;
        } else {
          selectors ??= [new BasicSelector(firstToken)];
          selectors.push(new BasicSelector(token));
        }
      }
      tokenStart = -1;
      continue;
    }
    if (code === 0x23 || code === 0x2e) {
      if (tokenStart >= 0 && i > tokenStart) {
        const token = output.slice(tokenStart, i);
        if (firstToken === undefined) {
          firstToken = token;
        } else {
          selectors ??= [new BasicSelector(firstToken)];
          selectors.push(new BasicSelector(token));
        }
      }
      tokenStart = i;
      continue;
    }
    if (tokenStart < 0) {
      tokenStart = i;
    }
  }
  if (tokenStart >= 0 && output.length > tokenStart) {
    const token = output.slice(tokenStart);
    if (firstToken === undefined) {
      firstToken = token;
    } else {
      selectors ??= [new BasicSelector(firstToken)];
      selectors.push(new BasicSelector(token));
    }
  }
  if (selectors) {
    return new CompoundSelector(selectors).inherit(source);
  }
  return new BasicSelector(firstToken ?? output).inherit(source);
}

export type InterpolatedValue = {
  /** String with INTERPOLATION_PLACEHOLDER placeholders */
  source: string;
  replacements: Node[];
};

export type InterpolatedOptions<Role extends AnyRole = AnyRole> = AnyOptions<Role> & {
  preserveQuotedSyntax?: boolean;
};

/**
 * Merge an interface to declare the specific types
 *
 * @todo - Instead of extending simple selector, create a selector "wrapper"
 * that goes around expressions and interpolated values, so that it
 * casts as a selector after evaluation.
 *
 * This would eliminate the need for the `evalToSelector` and `evalToGeneric`
 * methods, because the wrapper would handle the returned node type.
 */
export interface Interpolated<
  Role extends AnyRole = AnyRole
> extends Node<InterpolatedValue, InterpolatedOptions<Role>> {
  eval(context: Context): MaybePromise<Any<Role>>;
}
/**
 * An interpolated value is one that contains
 * reference variables, or expressions, but
 * which MUST resolve to a node with a string value
 * (like Anonymous) when evaluated.
 *
 * @example
 *   in Less:
 *     - `@@foo` is an interpolated variable
 *     - `--prop-@{foo}` is an interpolated property
 */
export class Interpolated<
  Role extends AnyRole = AnyRole
> extends Node<InterpolatedValue, InterpolatedOptions<Role>> {
  static override childKeys = ['source', 'replacements'] as const;

  readonly source: string;
  readonly replacements: Node[];
  readonly role: Role | undefined;

  constructor(
    value: InterpolatedValue,
    options?: InterpolatedOptions<Role>,
    location?: NodeLocation,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    this._treeContext = treeContext;
    this.source = value.source;
    this.replacements = value.replacements;
    this.role = options?.role as Role | undefined;
    // Interpolated nodes are always non-static and may be async
    this.addFlags(F_VISIBLE, F_MAY_ASYNC, F_NON_STATIC);
  }

  override valueOf(): string {
    return this.source;
  }

  replace(replacements: Node[], options?: PrintOptions): string {
    const { source } = this;
    let output = '';
    let sourceOffset = 0;
    let i = 0;
    let printOpts = getPrintOptions(options);
    while (sourceOffset < source.length) {
      const next = source.indexOf(INTERPOLATION_PLACEHOLDER, sourceOffset);
      if (next < 0) {
        output += source.slice(sourceOffset);
        break;
      }
      output += source.slice(sourceOffset, next);
      const replacement = replacements[i++];
      if (replacement) {
        output += stringifyReplacement(replacement, printOpts, this.options.preserveQuotedSyntax);
      }
      sourceOffset = next + INTERPOLATION_PLACEHOLDER.length;
    }

    return output;
  }

  private writeReplacement(replacement: Node, options: PrintOptions): void {
    const w = getPrintOptions(options).writer!;
    const mark = w.mark();
    writeReplacementSyntax(replacement, getPrintOptions(options), this.options.preserveQuotedSyntax);
    if (!isNode(replacement, N.Reference)) {
      w.trimStartSince(mark);
      w.trimEndSince(mark);
    }
  }

  private writeInterpolated(replacements: Node[], options: PrintOptions): void {
    const w = getPrintOptions(options).writer!;
    const { source } = this;
    let sourceOffset = 0;
    for (let i = 0; i < replacements.length; i++) {
      sourceOffset = this.writeNextSourceSegment(w, source, sourceOffset);
      this.writeReplacement(replacements[i]!, options);
    }
    w.add(source.slice(sourceOffset), this);
  }

  writeWithReplacements(replacements: Node[], options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    this.writeInterpolated(replacements, options);
    return w.getSince(mark);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    this.writeSyntax(options);
    return w.getSince(mark);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    this.writeInterpolated(this.replacements, options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareBufferPrintState(context, options)
      : prepareRenderPrintState(context, bufferOrOptions);
    const out = this.renderEvaluatedReplacementText(context, prepared);
    const finish = (rendered: string): string => buffer ? writeRenderText(buffer, rendered) : rendered;
    return isThenable(out)
      ? (out as Promise<string>).then(finish)
      : finish(out as string);
  }

  /**
   * Can turn simple #id, .class, element or SelectorCapture into a selector.
   * Legacy "list of mixin references" (e.g. @var: .a, .b, .c) is not supported; use *[.a, .b, .c].
   */
  createSelector(mode: 'eval' | 'resolve' = 'eval') {
    let { source, replacements } = this;
    const firstPlaceholder = source.indexOf(INTERPOLATION_PLACEHOLDER);
    const secondPlaceholder = firstPlaceholder < 0
      ? -1
      : source.indexOf(INTERPOLATION_PLACEHOLDER, firstPlaceholder + INTERPOLATION_PLACEHOLDER.length);
    const isWholeSelectorInterpolation = (
      replacements.length === 1
      && firstPlaceholder >= 0
      && secondPlaceholder < 0
      && source.slice(0, firstPlaceholder).trim() === ''
      && source.slice(firstPlaceholder + INTERPOLATION_PLACEHOLDER.length).trim() === ''
    );
    // For full-selector interpolation, collapse directly to the resolved selector/text.
    // Generated :is wrappers are only needed for embedded interpolation fragments.
    if (isWholeSelectorInterpolation) {
      const replacement = replacements[0]!;
      if (mode === 'eval' && !replacement.evaluated) {
        throw new Error('Cannot create selector from un-evaluated interpolated node');
      }
      if (isNode(replacement, N.Selector)) {
        const copied = copyWithReusableLeaves(replacement);
        if (!isNode(copied, N.Selector)) {
          throw new TypeError('Expected selector copy');
        }
        return copied.inherit(this);
      }
      return new BasicSelector(stringifyReplacement(replacement, {}, this.options.preserveQuotedSyntax).trim()).inherit(this);
    }
    let output = '';
    let sourceOffset = 0;
    for (let i = 0; i < replacements.length; i++) {
      const replacement = replacements[i]!;
      const nextPlaceholder = source.indexOf(INTERPOLATION_PLACEHOLDER, sourceOffset);
      if (mode === 'eval' && !replacement.evaluated) {
        throw new Error('Cannot create selector from un-evaluated interpolated node');
      }
      const part = shouldWrapSelectorInIs(replacement)
        ? serializeGeneratedIsWrapper(replacement)
        : stringifyReplacement(replacement, {}, this.options.preserveQuotedSyntax).trim();
      if (nextPlaceholder < 0) {
        output += source.slice(sourceOffset) + part;
        sourceOffset = source.length;
      } else {
        output += source.slice(sourceOffset, nextPlaceholder) + part;
        sourceOffset = nextPlaceholder + INTERPOLATION_PLACEHOLDER.length;
      }
    }
    // Preserve any trailing literal segment after the last interpolation placeholder.
    if (sourceOffset < source.length) {
      output += source.slice(sourceOffset);
    }
    // Interpolated selector output can produce compound selectors (e.g. ".a#b").
    // Preserve token boundaries so direct callable lookup can match correctly.
    return createSimpleInterpolatedSelector(output, this);
  }

  createGeneric() {
    const writer = new OutputWriter();
    const options = getPrintOptions({ writer });
    this.writeInterpolated(this.replacements, options);
    const trimmedString = writer.toString();
    return new Any<Role>(trimmedString, { role: this.role }).inherit(this);
  }

  /** Convenience: evaluate replacements then convert to Selector (BasicSelector or SelectorList) */
  evalToSelector(context: Context, mode: 'eval' | 'resolve' = 'eval'): MaybePromise<Selector> {
    const out = this._evalToInterpolated(context, mode);
    if (isThenable(out)) {
      return (out as Promise<Interpolated<Role>>).then(node => node.createSelector(mode));
    }
    return (out as Interpolated<Role>).createSelector(mode);
  }

  override evalNode(context: Context): MaybePromise<Any> {
    const out = this._evalToInterpolated(context);
    if (isThenable(out)) {
      return (out as Promise<Interpolated<Role>>).then((node) => {
        return node.createGeneric();
      });
    }
    const result = (out as Interpolated<Role>).createGeneric();
    return result;
  }

  override resolve(context: Context): MaybePromise<Any> {
    return this.resolveValue(context);
  }

  private resolveValue(context: Context): MaybePromise<Any<Role>> {
    const out = this._evalToInterpolated(context, 'resolve');
    if (isThenable(out)) {
      return (out as Promise<Interpolated<Role>>).then((node) => {
        return node.createGeneric();
      });
    }
    const result = (out as Interpolated<Role>).createGeneric();
    return result;
  }

  private renderEvaluatedReplacementText(context: Context, options: PrintOptions): MaybePromise<string> {
    const w = getPrintOptions(options).writer!;
    const mark = w.mark();
    const { source, replacements } = this;
    let sourceOffset = 0;
    for (let i = 0; i < replacements.length; i++) {
      sourceOffset = this.writeNextSourceSegment(w, source, sourceOffset);
      const out = replacements[i]!.resolve(context);
      if (isThenable(out)) {
        return (out as Promise<Node>).then((replacement) => {
          this.writeReplacement(replacement, options);
          return this.renderEvaluatedReplacementTextRest(context, options, mark, sourceOffset, i + 1);
        });
      }
      this.writeReplacement(out as Node, options);
    }
    w.add(source.slice(sourceOffset), this);
    return w.getSince(mark);
  }

  private renderEvaluatedReplacementTextRest(
    context: Context,
    options: PrintOptions,
    mark: number,
    sourceOffset: number,
    start: number
  ): MaybePromise<string> {
    const w = getPrintOptions(options).writer!;
    const { source } = this;
    const replacements = this.replacements;
    for (let i = start; i < replacements.length; i++) {
      sourceOffset = this.writeNextSourceSegment(w, source, sourceOffset);
      const out = replacements[i]!.resolve(context);
      if (isThenable(out)) {
        return (out as Promise<Node>).then((replacement) => {
          this.writeReplacement(replacement, options);
          return this.renderEvaluatedReplacementTextRest(context, options, mark, sourceOffset, i + 1);
        });
      }
      this.writeReplacement(out as Node, options);
    }
    w.add(source.slice(sourceOffset), this);
    return w.getSince(mark);
  }

  private writeNextSourceSegment(w: OutputWriter, source: string, sourceOffset: number): number {
    const next = source.indexOf(INTERPOLATION_PLACEHOLDER, sourceOffset);
    if (next < 0) {
      w.add(source.slice(sourceOffset), this);
      return source.length;
    }
    w.add(source.slice(sourceOffset, next), this);
    return next + INTERPOLATION_PLACEHOLDER.length;
  }

  /**
   * Just evaluate replacements and return. We don't stringify yet,
   * because depending on the context, it will turn into different
   * node types.
   */
  _evalToInterpolated(context: Context, mode: 'eval' | 'resolve' = 'eval'): MaybePromise<Interpolated<Role>> {
    const node = this;
    const currentReplacements = node.replacements;
    const evaluatedReplacements = new Array<Node>(currentReplacements.length);
    let changed = false;
    for (let idx = 0; idx < currentReplacements.length; idx++) {
      const n = currentReplacements[idx]!;
      const out = this.evaluateReplacement(context, n, mode);
      if (isThenable(out)) {
        return (out as Promise<Node>).then((result) => {
          evaluatedReplacements[idx] = result;
          changed ||= result !== n;
          return this.evaluateInterpolatedRest(context, mode, evaluatedReplacements, idx + 1, changed);
        });
      }
      const result = out as Node;
      evaluatedReplacements[idx] = result;
      changed ||= result !== n;
    }
    return this.finalizeEvaluatedInterpolated(evaluatedReplacements, changed);
  }

  private evaluateInterpolatedRest(
    context: Context,
    mode: 'eval' | 'resolve',
    evaluatedReplacements: Node[],
    start: number,
    changed: boolean
  ): MaybePromise<Interpolated<Role>> {
    const currentReplacements = this.replacements;
    for (let idx = start; idx < currentReplacements.length; idx++) {
      const n = currentReplacements[idx]!;
      const out = this.evaluateReplacement(context, n, mode);
      if (isThenable(out)) {
        return (out as Promise<Node>).then((result) => {
          evaluatedReplacements[idx] = result;
          return this.evaluateInterpolatedRest(context, mode, evaluatedReplacements, idx + 1, changed || result !== n);
        });
      }
      const result = out as Node;
      evaluatedReplacements[idx] = result;
      changed ||= result !== n;
    }
    return this.finalizeEvaluatedInterpolated(evaluatedReplacements, changed);
  }

  private evaluateReplacement(context: Context, node: Node, mode: 'eval' | 'resolve'): MaybePromise<Node> {
    return mode === 'eval' ? node.eval(context) : node.resolve(context);
  }

  private finalizeEvaluatedInterpolated(evaluatedReplacements: Node[], changed: boolean): Interpolated<Role> {
    if (!changed) {
      return this;
    }
    return new Interpolated<Role>(
      {
        source: this.source,
        replacements: evaluatedReplacements
      },
      this._options ? { ...this._options } : undefined,
      this.location,
      this.sourceRoot?._treeContext
    ).inherit(this);
  }
}

export const interpolated = defineType(Interpolated, 'Interpolated');
