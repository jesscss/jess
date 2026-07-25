import { spanStartOf, spanEndOf, sourceSpanOf, valueSpansOf, type SourceSpan } from './util/provenance.js';
import {
  Node,
  defineType,
  F_EXTENDED,
  F_EXTEND_TARGET,
  type NodeLocation,
  type NodeOptions
} from './node.js';
import { type Context } from '../context.js';
import { attachSelectorBitLibrary, Selector, type SelectorLike } from './selector.js';

import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { selectorCompare } from './util/compare.js';
import {
  consumeTrivia,
  emitCommentTriviaBeforeDelimiter,
  emitCommentTriviaAfterOffset,
  emitTriviaTokens
} from './util/trivia.js';
import { ownCollapsedSourceChild } from './util/own-collapsed-source-child.js';

export type SelectorListItem = Selector | string;

function emitSelectorListItem(
  item: SelectorListItem,
  options: FinalPrintOptions,
  suppressPre = false
): void {
  if (typeof item === 'string') {
    options.writer.add(item);
    return;
  }
  const saved = options.suppressBoundaryTrivia;
  options.suppressBoundaryTrivia = suppressPre ? 'both' : 'post';
  try {
    item.writeSyntax(options);
  } finally {
    options.suppressBoundaryTrivia = saved;
  }
}

/** Constructs */
export class SelectorList extends Selector<SelectorListItem[]> {
  static override childKeys = ['value'] as const;

  override readonly value: SelectorListItem[];

  constructor(
    value: SelectorListItem[],
    options?: NodeOptions,
    location?: NodeLocation
  ) {
    super(value, options, location);
    this.value = value;
  }

  private ownSelector(item: Selector): Selector {
    const owned = item.canReuseAsLeaf() ? item.reuseAsLeaf() : item.cloneForPlacement();
    if (!(owned instanceof Selector)) {
      throw new TypeError('Expected selector copy');
    }
    return owned;
  }

  private withSelectors(value: SelectorListItem[], sourceValue: readonly SelectorListItem[] = this.value): SelectorList {
    const ownedValue = new Array<SelectorListItem>(value.length);
    for (let i = 0; i < value.length; i++) {
      const item = value[i]!;
      ownedValue[i] = typeof item !== 'string' && this.isSourceSelector(item, sourceValue)
        ? this.ownSelector(item)
        : item;
    }

    // Own unchanged source children; evaluated clones may carry runtime state.
    return new SelectorList(
      ownedValue,
      this._options ? { ...this._options } : undefined,
      sourceSpanOf(this)
    ).inherit(this);
  }

  private isSourceSelector(item: Selector, sourceValue: readonly SelectorListItem[]): boolean {
    for (let i = 0; i < sourceValue.length; i++) {
      if (sourceValue[i] === item) {
        return true;
      }
    }
    return false;
  }

  private createEvaluatedSelectorListSurface(value: SelectorListItem[], sourceValue: readonly SelectorListItem[]): SelectorList {
    return this.withSelectors(value, sourceValue);
  }

  private collapsedSelector(item: Selector, sourceValue: readonly SelectorListItem[]): Selector {
    const owned = ownCollapsedSourceChild(item, sourceValue, this);
    if (!(owned instanceof Selector)) {
      throw new TypeError('Expected selector result');
    }
    return owned;
  }

  override writeSyntax(printOptions: FinalPrintOptions): void {
    emitSelectorListItems(this.value, printOptions, false, valueSpansOf(this));
  }

  /** Normalize value on separate lines with indentation */
  override toTrimmedString(options?: PrintOptions) {
    if (this.value.length === 0) {
      return '';
    }
    const printOptions = getPrintOptions(options);
    const w = printOptions.writer;
    const mark = w.mark();
    this.writeSyntax(printOptions);
    return w.getSince(mark);
  }

  override valueOf() {
    const value = this.value;
    if (value.length === 0) {
      return '';
    }
    let out = String(value[0]!.valueOf());
    for (let i = 1; i < value.length; i++) {
      out += `,${String(value[i]!.valueOf())}`;
    }
    return out;
  }

  override compare(b: Selector): 0 | 1 | -1 | undefined {
    if (!isNode(b, N.Selector)) {
      return super.compare(b);
    }
    const semantic = selectorCompare(this, b);
    if (semantic.isEquivalent) {
      return 0;
    }
    return super.compare(b);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    attachSelectorBitLibrary(this, context.selectorBits);
    const evaluatedValue = this.evaluateSelectors(context, false);
    return isThenable(evaluatedValue)
      ? (evaluatedValue as Promise<SelectorListItem[]>).then(value => this.finalizeEvaluatedSelectors(value, true))
      : this.finalizeEvaluatedSelectors(evaluatedValue as SelectorListItem[], true);
  }

  protected override resolveForRender(context: Context): MaybePromise<Node> {
    attachSelectorBitLibrary(this, context.selectorBits);
    const resolvedValue = this.evaluateSelectors(context, true);
    return isThenable(resolvedValue)
      ? (resolvedValue as Promise<SelectorListItem[]>).then(value => this.finalizeEvaluatedSelectors(value, false))
      : this.finalizeEvaluatedSelectors(resolvedValue as SelectorListItem[], false);
  }

  private evaluateSelectors(context: Context, resolve: boolean): MaybePromise<SelectorListItem[]> {
    const currentValue = this.value;
    const evaluatedValue = new Array<SelectorListItem>(currentValue.length);
    for (let i = 0; i < currentValue.length; i++) {
      const item = currentValue[i]!;
      if (typeof item === 'string') {
        evaluatedValue[i] = item;
        continue;
      }
      const out = resolve ? item.resolve(context) : item.eval(context);
      if (isThenable(out)) {
        return out.then((res) => {
          evaluatedValue[i] = isNode(res, N.Selector) ? res : item;
          return this.evaluateSelectorsRest(context, resolve, evaluatedValue, i + 1);
        });
      }
      evaluatedValue[i] = isNode(out, N.Selector) ? out : item;
    }
    return evaluatedValue;
  }

  private evaluateSelectorsRest(
    context: Context,
    resolve: boolean,
    evaluatedValue: SelectorListItem[],
    start: number
  ): MaybePromise<SelectorListItem[]> {
    const currentValue = this.value;
    for (let i = start; i < currentValue.length; i++) {
      const item = currentValue[i]!;
      if (typeof item === 'string') {
        evaluatedValue[i] = item;
        continue;
      }
      const out = resolve ? item.resolve(context) : item.eval(context);
      if (isThenable(out)) {
        return out.then((res) => {
          evaluatedValue[i] = isNode(res, N.Selector) ? res : item;
          return this.evaluateSelectorsRest(context, resolve, evaluatedValue, i + 1);
        });
      }
      evaluatedValue[i] = isNode(out, N.Selector) ? out : item;
    }
    return evaluatedValue;
  }

  private finalizeEvaluatedSelectors(evaluatedValue: SelectorListItem[], evaluated: boolean): Node {
    const currentValue = this.value;
    const flattened: SelectorListItem[] = [];
    for (let i = 0; i < evaluatedValue.length; i++) {
      this.appendFlattenedSelector(evaluatedValue[i]!, flattened);
    }
    if (flattened.length === 1 && typeof flattened[0] !== 'string') {
      return this.collapsedSelector(flattened[0]!, currentValue);
    }
    let changed = flattened.length !== currentValue.length;
    if (!changed) {
      for (let i = 0; i < flattened.length; i++) {
        if (flattened[i] !== currentValue[i]) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) {
      return this;
    }
    return evaluated
      ? this.createEvaluatedSelectorListSurface(flattened, currentValue)
      : this.withSelectors(flattened, currentValue);
  }

  private appendFlattenedSelector(item: SelectorListItem, flattened: SelectorListItem[]): void {
    if (typeof item === 'string') {
      flattened.push(item);
      return;
    }

    /*
     * Flatten top-level `:is(a, b)` items into the selector list.
     * This is safe in SelectorList context (it is equivalent to `a, b`).
     */
    if (isNode(item, N.PseudoSelector) && item.name === ':is') {
      const arg = item.arg;
      if (arg && isNode(arg, N.SelectorList)) {
        this.appendSelectorListValue(arg.value, flattened);
        return;
      }
    }
    if (isNode(item, N.CompoundSelector) && item.value.length === 1) {
      const only = item.value[0]!;
      if (isNode(only, N.PseudoSelector) && only.name === ':is') {
        const arg = only.arg;
        if (arg && isNode(arg, N.SelectorList)) {
          this.appendSelectorListValue(arg.value, flattened);
          return;
        }
      }
    }
    if (isNode(item, N.ComplexSelector) && item.value.length === 1) {
      const only = item.value[0]!;
      if (isNode(only, N.PseudoSelector) && only.name === ':is') {
        const arg = only.arg;
        if (arg && isNode(arg, N.SelectorList)) {
          this.appendSelectorListValue(arg.value, flattened);
          return;
        }
      }
    }
    flattened.push(item);
  }

  private appendSelectorListValue(value: SelectorListItem[], out: SelectorListItem[]): void {
    for (let i = 0; i < value.length; i++) {
      out.push(value[i]!);
    }
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.resolveForRender(context);
  }
}

export const sellist = defineType(SelectorList, 'SelectorList', 'sellist');

/** A selector list stored as a node or a plain array (parser-delivered form). */
export type SelectorListLike = SelectorList | SelectorListItem[];

export function isSelectorListLike(value: unknown): value is SelectorListLike {
  return Array.isArray(value) || isNode(value, N.SelectorList);
}

export function selectorListItems(value: SelectorListLike): SelectorListItem[] {
  return Array.isArray(value) ? value : value.value;
}

export function selectorListValueOf(items: readonly SelectorListItem[]): string {
  return items.map(item => (typeof item === 'string' ? item : item.valueOf())).join(', ');
}

export function selectorSurfaceValueOf(value: SelectorLike): string {
  if (Array.isArray(value)) {
    return selectorListValueOf(value);
  }
  return value.valueOf();
}

/** Finish a selector-list result: a singleton collapses to its selector value;
 * multi-item arrays stay arrays and node-backed surfaces stay SelectorList nodes. */
export function finishSelectorListSurface(items: Selector[], inheritFrom: Selector): Selector;
export function finishSelectorListSurface(items: SelectorListItem[], inheritFrom: SelectorListItem[]): SelectorLike;
export function finishSelectorListSurface(items: SelectorListItem[], inheritFrom: Selector | SelectorListItem[]): SelectorLike;
export function finishSelectorListSurface(
  items: SelectorListItem[],
  inheritFrom: Selector | SelectorListItem[]
): SelectorLike {
  if (items.length === 1) {
    return items[0]!;
  }
  if (Array.isArray(inheritFrom)) {
    return items;
  }
  return SelectorList.create(items).inherit(inheritFrom);
}

/**
 * Emit a selector list — the single writer shared by `SelectorList.writeSyntax`
 * and the bare string/array header surface. Hoists inner `:is(...)` lists to the
 * top level, applies reference-mode extend filtering, and separates items with
 * `,\n<indent>` so multi-selector headers break onto their own lines.
 */
export function emitSelectorListItems(
  rawItems: readonly SelectorListItem[],
  printOptions: FinalPrintOptions,
  suppressPre = false,
  memberSpans?: readonly (SourceSpan | undefined)[]
): void {
  const w = printOptions.writer;
  const space = ''.padStart(printOptions.depth * 2);

  /*
   * Per-slot member spans only line up with `rawItems` when no inner `:is(...)`
   * hoisting rewrites the list. If any hoist happens (length changes), drop the
   * spans — the offsets would no longer correspond to the emitted members.
   */
  const value: SelectorListItem[] = [];
  for (const item of rawItems) {
    if (isNode(item, N.PseudoSelector) && item.name === ':is') {
      const arg = item.arg;
      if (arg && isNode(arg, N.SelectorList)) {
        value.push(...arg.value);
        continue;
      }
    }
    if (isNode(item, N.CompoundSelector) && item.value.length === 1) {
      const only = item.value[0]!;
      if (isNode(only, N.PseudoSelector) && only.name === ':is') {
        const arg = only.arg;
        if (arg && isNode(arg, N.SelectorList)) {
          value.push(...arg.value);
          continue;
        }
      }
    }
    if (isNode(item, N.ComplexSelector) && item.value.length === 1) {
      const only = item.value[0]!;
      if (isNode(only, N.PseudoSelector) && only.name === ':is') {
        const arg = only.arg;
        if (arg && isNode(arg, N.SelectorList)) {
          value.push(...arg.value);
          continue;
        }
      }
    }
    value.push(item);
  }
  if (
    printOptions.referenceMode === true
    && printOptions.referenceRenderEnabled === true
    && printOptions.referenceFilterTargets === true
  ) {
    let extendedCount = 0;
    for (let i = 0; i < value.length; i++) {
      const item = value[i]!;
      if (typeof item !== 'string' && item.hasFlag(F_EXTENDED) && !item.hasFlag(F_EXTEND_TARGET)) {
        value[extendedCount++] = item;
      }
    }
    if (extendedCount > 0) {
      value.length = extendedCount;
    }
  }
  const length = value.length;
  if (length === 0) {
    return;
  }

  /*
   * Only trust member spans when the emitted list matches the raw list 1:1
   * (no `:is(...)` hoisting rewrote it).
   */
  const spans = memberSpans?.length === length ? memberSpans : undefined;
  let item = value[0]!;
  emitSelectorListItem(item, printOptions, suppressPre);
  for (let i = 1; i < length; i++) {
    const prevItem = item;
    item = value[i]!;

    /*
     * Comment authored AFTER the previous member, before the `,` (e.g.
     * `#comments /* boo *\/,`). A node member exposes its own end; a bare-string
     * member recovers it from the per-slot span.
     */
    const prevEnd = typeof prevItem !== 'string'
      ? spanEndOf(prevItem)
      : spans?.[i - 1]?.end;
    if (typeof prevItem !== 'string' && typeof item !== 'string') {
      emitCommentTriviaBeforeDelimiter(prevItem, item, printOptions);
    } else if (printOptions.trivia && prevEnd !== undefined) {
      emitCommentTriviaAfterOffset(printOptions.trivia, prevEnd, printOptions);
    }
    w.add(`,\n${space}`);

    // Comment authored BEFORE the next member (e.g. `, /* of */ .comments`).
    const nextStart = typeof item !== 'string' ? spanStartOf(item) : spans?.[i]?.start;
    if (printOptions.trivia && nextStart !== undefined) {
      emitTriviaTokens(
        consumeTrivia(printOptions.trivia, nextStart, 'before', printOptions),
        printOptions,
        { skipLeadingWhitespace: true }
      );
    }
    emitSelectorListItem(item, printOptions, true);
  }
}

export function emitSelectorListLike(
  value: SelectorListLike,
  options: FinalPrintOptions,
  suppressPre = false,
  memberSpans?: readonly (SourceSpan | undefined)[]
): void {
  /*
   * A `SelectorList` node carries its own per-member spans; a bare-array surface
   * does not, so the caller (e.g. the owning Ruleset) supplies them.
   */
  const spans = memberSpans ?? (Array.isArray(value) ? undefined : valueSpansOf(value));
  emitSelectorListItems(selectorListItems(value), options, suppressPre, spans);
}
