import {
  Node,
  defineType,
  F_EXTENDED,
  F_EXTEND_TARGET,
  F_MAY_ASYNC,
  type NodeLocation,
  type NodeOptions
} from './node.js';
import { type Context } from '../context.js';
import { attachSelectorBitLibrary, Selector, type SelectorLike, type SelectorValue } from './selector.js';

import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { selectorCompare } from './util/compare.js';
import {
  consumeTrivia,
  emitCommentTriviaBeforeDelimiter,
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
    location?: NodeLocation,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    this._treeContext = treeContext;
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
      this.location
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
    const w = printOptions.writer;
    let depth = printOptions.depth;
    let space = ''.padStart(depth * 2);
    const value: SelectorListItem[] = [];
    for (const item of this.value) {
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
    let length = value.length;
    if (length === 0) {
      return;
    }
    let item = value[0]!;

    emitSelectorListItem(item, printOptions);

    for (let i = 1; i < length; i++) {
      const prevItem = item;
      item = value[i]!;
      if (typeof prevItem !== 'string' && typeof item !== 'string') {
        emitCommentTriviaBeforeDelimiter(prevItem, item, printOptions);
      }
      w.add(`,\n${space}`);
      if (printOptions.trivia && typeof item !== 'string') {
        emitTriviaTokens(
          consumeTrivia(printOptions.trivia, item.location[0], 'before', printOptions),
          printOptions,
          { skipLeadingWhitespace: true }
        );
      }
      emitSelectorListItem(item, printOptions, true);
    }
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
    if (!this.hasFlag(F_MAY_ASYNC)) {
      return this.finalizeEvaluatedSelectors(this.evaluateSelectorsSync(context, false), true);
    }
    const evaluatedValue = this.evaluateSelectors(context, false);
    return isThenable(evaluatedValue)
      ? (evaluatedValue as Promise<SelectorListItem[]>).then(value => this.finalizeEvaluatedSelectors(value, true))
      : this.finalizeEvaluatedSelectors(evaluatedValue as SelectorListItem[], true);
  }

  protected override resolveForRender(context: Context): MaybePromise<Node> {
    attachSelectorBitLibrary(this, context.selectorBits);
    if (!this.hasFlag(F_MAY_ASYNC)) {
      return this.finalizeEvaluatedSelectors(this.evaluateSelectorsSync(context, true), false);
    }
    const resolvedValue = this.evaluateSelectors(context, true);
    return isThenable(resolvedValue)
      ? (resolvedValue as Promise<SelectorListItem[]>).then(value => this.finalizeEvaluatedSelectors(value, false))
      : this.finalizeEvaluatedSelectors(resolvedValue as SelectorListItem[], false);
  }

  private evaluateSelectorsSync(context: Context, resolve: boolean): SelectorListItem[] {
    const currentValue = this.value;
    const evaluatedValue = new Array<SelectorListItem>(currentValue.length);
    for (let i = 0; i < currentValue.length; i++) {
      const item = currentValue[i]!;
      if (typeof item === 'string') {
        evaluatedValue[i] = item;
        continue;
      }
      const out = resolve ? item.resolve(context) : item.eval(context);
      if (!(out instanceof Node)) {
        if (out !== null && typeof out === 'object') {
          throw new TypeError('Expected sync selector evaluation to return a node');
        }
        evaluatedValue[i] = item;
        continue;
      }
      evaluatedValue[i] = isNode(out, N.Selector) ? out : item;
    }
    return evaluatedValue;
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
    // Flatten top-level `:is(a, b)` items into the selector list.
    // This is safe in SelectorList context (it is equivalent to `a, b`).
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

/**
 * Normalize a {@link SelectorLike} to the canonical stored form. An array becomes a
 * `SelectorList` (an array stands in for a list — no caller-built wrapper needed);
 * a single node or string is returned as-is.
 */
export function normalizeSelectorLike(value: SelectorLike): SelectorValue {
  if (Array.isArray(value)) {
    return SelectorList.create(value);
  }
  return value;
}
