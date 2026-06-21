import {
  Node,
  defineType,
  F_MAY_ASYNC,
  type NodeLocation,
  type NodeOptions
} from './node.js';
import type { Context } from '../context.js';
import { createPublicNil, Nil } from './nil.js';
import { attachSelectorBitLibrary, Selector } from './selector.js';
import type { SimpleSelector } from './selector-simple.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions, savePrintState, restorePrintState } from './util/print.js';
import { consumeTrivia, emitTriviaTokens } from './util/trivia.js';
import { ownCollapsedSourceChild } from './util/own-collapsed-source-child.js';

/**
 * @example
 * .class#id
 *
 * Must have at least 2 selectors. Otherwise it would be collapsed.
 */
/** Anything other than type (element) or universal, which must come first */
const nonElementRegex = /^[.#:[]/;

function emitCompoundPart(
  part: CompoundSelectorComponent,
  options: ReturnType<typeof getPrintOptions>,
  emitLeadingTrivia: boolean
): void {
  if (typeof part === 'string') {
    options.writer.add(part);
    return;
  }
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

export type CompoundSelectorComponent = SimpleSelector | string;

export function isStringCompoundSelectorComponent(value: unknown): value is string {
  return typeof value === 'string';
}

export class CompoundSelector extends Selector<CompoundSelectorComponent[]> {
  static override childKeys = ['value'] as const;

  readonly value: CompoundSelectorComponent[];

  constructor(
    value: CompoundSelectorComponent[],
    options?: NodeOptions,
    location?: NodeLocation,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    this._treeContext = treeContext;
    this.value = value;
  }

  private ownSelector(item: CompoundSelectorComponent): CompoundSelectorComponent {
    if (typeof item === 'string') {
      return item;
    }
    const owned = item.canReuseAsLeaf() ? item.reuseAsLeaf() : item.cloneForPlacement();
    if (!(owned instanceof Selector)) {
      throw new TypeError('Expected selector copy');
    }
    return owned;
  }

  private withComponents(
    value: CompoundSelectorComponent[],
    sourceValue: readonly CompoundSelectorComponent[] = this.value
  ): this {
    const ownedValue = new Array<CompoundSelectorComponent>(value.length);
    let hoistToRoot = false;
    for (let i = 0; i < value.length; i++) {
      const item = value[i]!;
      ownedValue[i] = this.isSourceSelector(item, sourceValue) ? this.ownSelector(item) : item;
      if (typeof item !== 'string' && item.hoistToRoot) {
        hoistToRoot = true;
      }
    }
    // Own unchanged source children; evaluated clones may carry runtime state.
    const node = new CompoundSelector(
      ownedValue,
      this._options ? { ...this._options } : undefined,
      this.location
    ).inherit(this) as this;
    if (hoistToRoot) {
      node.hoistToRoot = true;
    }
    return node.inherit(this);
  }

  private isSourceSelector(
    item: CompoundSelectorComponent,
    sourceValue: readonly CompoundSelectorComponent[]
  ): boolean {
    for (let i = 0; i < sourceValue.length; i++) {
      if (sourceValue[i] === item) {
        return true;
      }
    }
    return false;
  }

  private createEvaluatedComponentSurface(
    value: CompoundSelectorComponent[],
    sourceValue: readonly CompoundSelectorComponent[]
  ): this {
    return this.withComponents(value, sourceValue);
  }

  private collapsedSelector(item: SimpleSelector, sourceValue: readonly CompoundSelectorComponent[]): Selector {
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

  private renderCompoundSyntax(options?: PrintOptions): string {
    if (this.value.length === 0) {
      return '';
    }
    const printOptions = getPrintOptions(options);
    const w = printOptions.writer;
    const mark = w.mark();
    this.writeSyntax(printOptions);
    return w.getSince(mark);
  }

  protected override computeKeySets(): void {
    if (this._keySet && this._visibleKeySet && this._requiredKeySet) {
      return;
    }
    const library = this._requireKeySetLibrary();
    const value = this.value;
    let keySet = library.getBitset();
    let visibleKeySet = library.getBitset();
    let requiredKeySet = library.getBitset();
    for (const selector of value) {
      if (typeof selector === 'string') {
        const selectorKeySet = library.getBitset([selector]);
        keySet = keySet.or(selectorKeySet);
        visibleKeySet = visibleKeySet.or(selectorKeySet);
        requiredKeySet = requiredKeySet.or(selectorKeySet);
        continue;
      }
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
        const item = this.value[i]!;
        const component = String(typeof item === 'string' ? item : item.valueOf());
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
    return this.renderCompoundSyntax(options);
  }

  override evalNode(context: Context): MaybePromise<CompoundSelector | Selector | Nil> {
    attachSelectorBitLibrary(this, context.selectorBits);
    if (!this.hasFlag(F_MAY_ASYNC)) {
      return this.finalizeComponents(this.evaluateComponentsSync(context, false), true);
    }
    const evaluatedValue = this.evaluateComponents(context, false);
    return isThenable(evaluatedValue)
      ? (evaluatedValue as Promise<Array<Selector | Nil | string>>).then(value => this.finalizeComponents(value, true))
      : this.finalizeComponents(evaluatedValue as Array<Selector | Nil | string>, true);
  }

  protected override resolveForRender(context: Context): MaybePromise<Node> {
    attachSelectorBitLibrary(this, context.selectorBits);
    if (!this.hasFlag(F_MAY_ASYNC)) {
      return this.finalizeComponents(this.evaluateComponentsSync(context, true), false);
    }
    const resolvedValue = this.evaluateComponents(context, true);
    return isThenable(resolvedValue)
      ? (resolvedValue as Promise<Array<Selector | Nil | string>>).then(value => this.finalizeComponents(value, false))
      : this.finalizeComponents(resolvedValue as Array<Selector | Nil | string>, false);
  }

  private evaluateComponentsSync(context: Context, resolve: boolean): Array<Selector | Nil | string> {
    const currentValue = this.value;
    const evaluatedValue = new Array<Selector | Nil | string>(currentValue.length);
    for (let i = 0; i < currentValue.length; i++) {
      const item = currentValue[i]!;
      if (typeof item === 'string') {
        evaluatedValue[i] = item;
        continue;
      }
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

  private evaluateComponents(context: Context, resolve: boolean): MaybePromise<Array<Selector | Nil | string>> {
    const currentValue = this.value;
    const evaluatedValue = new Array<Selector | Nil | string>(currentValue.length);
    for (let i = 0; i < currentValue.length; i++) {
      const item = currentValue[i]!;
      if (typeof item === 'string') {
        evaluatedValue[i] = item;
        continue;
      }
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
    evaluatedValue: Array<Selector | Nil | string>,
    start: number
  ): MaybePromise<Array<Selector | Nil | string>> {
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
          evaluatedValue[i] = res instanceof Selector || res instanceof Nil ? res : item;
          return this.evaluateComponentsRest(context, resolve, evaluatedValue, i + 1);
        });
      }
      evaluatedValue[i] = out instanceof Selector || out instanceof Nil ? out : item;
    }
    return evaluatedValue;
  }

  private finalizeComponents(evaluatedValue: Array<Selector | Nil | string>, evaluated: boolean): Node {
    const currentValue = this.value;
    const value: CompoundSelectorComponent[] = [];
    for (let i = 0; i < evaluatedValue.length; i++) {
      const item = evaluatedValue[i]!;
      if (typeof item === 'string') {
        value.push(item);
      } else if (item instanceof Selector) {
        value.push(item as SimpleSelector);
      }
    }
    this.sortComponents(value);
    if (value.length === 0) {
      return createPublicNil().inherit(this);
    }
    if (value.length === 1) {
      const only = value[0]!;
      return typeof only === 'string' ? this.withComponents(value, currentValue) : this.collapsedSelector(only, currentValue);
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

  private sortComponents(value: CompoundSelectorComponent[]): void {
    value.sort((a, b) => {
      const aValue = String(typeof a === 'string' ? a : a.valueOf());
      const bValue = String(typeof b === 'string' ? b : b.valueOf());
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
