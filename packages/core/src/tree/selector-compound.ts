import {
  Node,
  defineType,
  F_MAY_ASYNC
} from './node.js';
import type { Context } from '../context.js';
import { createPublicNil, Nil } from './nil.js';
import { attachSelectorBitLibrary, Selector } from './selector.js';
import type { SimpleSelector } from './selector-simple.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions, savePrintState, restorePrintState } from './util/print.js';
import { consumeTrivia, emitTriviaTokens } from './util/trivia.js';
import { canReuseLeaf, copyWithReusableLeaves, ownCollapsedSourceChild, reuseLeaf } from './util/cloning.js';

/**
 * @example
 * .class#id
 *
 * Must have at least 2 selectors. Otherwise it would be collapsed.
 */
/** Anything other than type (element) or universal, which must come first */
const nonElementRegex = /^[.#:[]/;

function emitCompoundPart(
  part: SimpleSelector,
  options: ReturnType<typeof getPrintOptions>,
  emitLeadingTrivia: boolean
): void {
  if (emitLeadingTrivia && options.trivia) {
    emitTriviaTokens(
      consumeTrivia(options.trivia, part.location[0], 'before', options),
      options,
      { skipLeadingWhitespace: true }
    );
  }
  const saved = options.suppressBoundaryTrivia;
  options.suppressBoundaryTrivia = 'pre';
  try {
    part.writeSyntax(options);
  } finally {
    options.suppressBoundaryTrivia = saved;
  }
}

export class CompoundSelector extends Selector<SimpleSelector[]> {
  private ownSelector(item: Selector): Selector {
    const owned = canReuseLeaf(item) ? reuseLeaf(item) : copyWithReusableLeaves(item);
    if (!(owned instanceof Selector)) {
      throw new TypeError('Expected selector copy');
    }
    return owned;
  }

  private withComponents(value: Selector[], sourceValue: readonly Selector[] = this.value): this {
    const ownedValue = new Array<Selector>(value.length);
    let hoistToRoot = false;
    for (let i = 0; i < value.length; i++) {
      const item = value[i]!;
      ownedValue[i] = this.isSourceSelector(item, sourceValue) ? this.ownSelector(item) : item;
      if (item.hoistToRoot) {
        hoistToRoot = true;
      }
    }
    const node: this = Reflect.construct(
      this.constructor,
      [
        // Own unchanged source children; evaluated clones may carry runtime state.
        ownedValue,
        this._options ? { ...this._options } : undefined,
        this.location
      ]
    );
    if (hoistToRoot) {
      node.hoistToRoot = true;
    }
    return node.inherit(this);
  }

  private isSourceSelector(item: Selector, sourceValue: readonly Selector[]): boolean {
    for (let i = 0; i < sourceValue.length; i++) {
      if (sourceValue[i] === item) {
        return true;
      }
    }
    return false;
  }

  private createEvaluatedComponentSurface(value: Selector[], sourceValue: readonly Selector[]): this {
    return this.withComponents(value, sourceValue);
  }

  private collapsedSelector(item: Selector, sourceValue: readonly Selector[]): Selector {
    const owned = ownCollapsedSourceChild(item, sourceValue, this);
    if (!(owned instanceof Selector)) {
      throw new TypeError('Expected selector copy');
    }
    return owned;
  }

  override writeSyntax(printOptions: FinalPrintOptions): void {
    const value = this.value;
    const saved = savePrintState(printOptions, ['ampersandFirst']);
    for (let i = 0; i < value.length; i++) {
      printOptions.ampersandFirst = (i === 0);
      emitCompoundPart(value[i]!, printOptions, i > 0);
    }
    restorePrintState(printOptions, saved);
  }

  protected override computeKeySets(): void {
    if (this._keySet && this._visibleKeySet && this._requiredKeySet) {
      return;
    }
    const library = this._requireKeySetLibrary();
    const { value } = this;
    let keySet = library.getBitset();
    let visibleKeySet = library.getBitset();
    let requiredKeySet = library.getBitset();
    for (const selector of value) {
      selector.keySetLibrary ??= library;
      keySet = keySet.or(selector.keySet);
      visibleKeySet = visibleKeySet.or(selector.visibleKeySet);
      requiredKeySet = requiredKeySet.or(selector.requiredKeySet);
    }
    this._keySet = keySet;
    this._visibleKeySet = visibleKeySet;
    this._requiredKeySet = requiredKeySet;
  }

  override valueOf() {
    let value = this._valueOf;
    if (!value) {
      // Find element selectors (those that don't start with .#:[)
      const elementSelectors: string[] = [];
      const nonElementSelectors: string[] = [];
      for (let i = 0; i < this.value.length; i++) {
        const component = String(this.value[i]!.valueOf());
        if (!nonElementRegex.test(component)) {
          elementSelectors.push(component);
        } else {
          nonElementSelectors.push(component);
        }
      }

      // Element selectors must come first for valid CSS
      // Non-element selectors maintain their original order (no sorting)
      value = '';
      for (let i = 0; i < elementSelectors.length; i++) {
        value += elementSelectors[i]!;
      }
      for (let i = 0; i < nonElementSelectors.length; i++) {
        value += nonElementSelectors[i]!;
      }
      this._valueOf = value;
    }
    return value;
  }

  override toTrimmedString(options?: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    if (this.value.length === 0) {
      return '';
    }
    const w = printOptions.writer;
    const mark = w.mark();
    this.writeSyntax(printOptions);
    return w.getSince(mark);
  }

  override evalNode(context: Context): MaybePromise<CompoundSelector | Selector | Nil> {
    attachSelectorBitLibrary(this, context.selectorBits);
    if (!this.hasFlag(F_MAY_ASYNC)) {
      return this.finalizeComponents(this.evaluateComponentsSync(context, false), true);
    }
    const evaluatedValue = this.evaluateComponents(context, false);
    return isThenable(evaluatedValue)
      ? (evaluatedValue as Promise<Array<Selector | Nil>>).then(value => this.finalizeComponents(value, true))
      : this.finalizeComponents(evaluatedValue as Array<Selector | Nil>, true);
  }

  protected override resolveForRender(context: Context): MaybePromise<Node> {
    attachSelectorBitLibrary(this, context.selectorBits);
    if (!this.hasFlag(F_MAY_ASYNC)) {
      return this.finalizeComponents(this.evaluateComponentsSync(context, true), false);
    }
    const resolvedValue = this.evaluateComponents(context, true);
    return isThenable(resolvedValue)
      ? (resolvedValue as Promise<Array<Selector | Nil>>).then(value => this.finalizeComponents(value, false))
      : this.finalizeComponents(resolvedValue as Array<Selector | Nil>, false);
  }

  private evaluateComponentsSync(context: Context, resolve: boolean): Array<Selector | Nil> {
    const currentValue = this.value;
    const evaluatedValue = new Array<Selector | Nil>(currentValue.length);
    for (let i = 0; i < currentValue.length; i++) {
      const item = currentValue[i]!;
      const out = resolve ? item.resolve(context) : item.eval(context);
      if (!(out instanceof Node)) {
        if (out !== null && typeof out === 'object') {
          throw new TypeError('Expected sync compound selector evaluation to return a node');
        }
        evaluatedValue[i] = item;
        continue;
      }
      evaluatedValue[i] = out instanceof Selector || out instanceof Nil ? out : item;
    }
    return evaluatedValue;
  }

  private evaluateComponents(context: Context, resolve: boolean): MaybePromise<Array<Selector | Nil>> {
    const currentValue = this.value;
    const evaluatedValue = new Array<Selector | Nil>(currentValue.length);
    for (let i = 0; i < currentValue.length; i++) {
      const item = currentValue[i]!;
      const out = resolve ? item.resolve(context) : item.eval(context);
      if (isThenable(out)) {
        return out.then((res) => {
          evaluatedValue[i] = res instanceof Selector || res instanceof Nil ? res : item;
          return this.evaluateComponentsRest(context, resolve, evaluatedValue, i + 1);
        });
      }
      evaluatedValue[i] = out instanceof Selector || out instanceof Nil ? out : item;
    }
    return evaluatedValue;
  }

  private evaluateComponentsRest(
    context: Context,
    resolve: boolean,
    evaluatedValue: Array<Selector | Nil>,
    start: number
  ): MaybePromise<Array<Selector | Nil>> {
    const currentValue = this.value;
    for (let i = start; i < currentValue.length; i++) {
      const item = currentValue[i]!;
      const out = resolve ? item.resolve(context) : item.eval(context);
      if (isThenable(out)) {
        return out.then((res) => {
          evaluatedValue[i] = res instanceof Selector || res instanceof Nil ? res : item;
          return this.evaluateComponentsRest(context, resolve, evaluatedValue, i + 1);
        });
      }
      evaluatedValue[i] = out instanceof Selector || out instanceof Nil ? out : item;
    }
    return evaluatedValue;
  }

  private finalizeComponents(evaluatedValue: Array<Selector | Nil>, evaluated: boolean): Node {
    const currentValue = this.value;
    const value: Selector[] = [];
    for (let i = 0; i < evaluatedValue.length; i++) {
      const item = evaluatedValue[i]!;
      if (!(item instanceof Nil)) {
        value.push(item);
      }
    }
    this.sortComponents(value);
    if (value.length === 0) {
      return createPublicNil().inherit(this);
    }
    if (value.length === 1) {
      return this.collapsedSelector(value[0]!, currentValue);
    }
    let changed = value.length !== currentValue.length;
    if (!changed) {
      for (let i = 0; i < value.length; i++) {
        if (value[i] !== currentValue[i]) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) {
      return this;
    }
    return evaluated
      ? this.createEvaluatedComponentSurface(value, currentValue)
      : this.withComponents(value, currentValue);
  }

  private sortComponents(value: Selector[]): void {
    value.sort((a, b) => {
      const aValue = String(a.valueOf());
      const bValue = String(b.valueOf());
      const aIsElement = !nonElementRegex.test(aValue);
      const bIsElement = !nonElementRegex.test(bValue);
      if (aIsElement && bIsElement) {
        return aValue < bValue ? -1 : 1;
      }
      return aIsElement ? -1 : bIsElement ? 1 : 0;
    });
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.resolveForRender(context);
  }

  /** @todo move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   this.value.forEach(node => node.toCSS(context, out))
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.sel([', this.location)
  //   const length = this.value.length - 1
  //   this.value.forEach((node, i) => {
  //     node.toModule(context, out)
  //     if (i < length) {
  //       out.add(', ')
  //     }
  //   })
  //   out.add('])')
  // }
}

export const compound = defineType(CompoundSelector, 'CompoundSelector', 'compound');
