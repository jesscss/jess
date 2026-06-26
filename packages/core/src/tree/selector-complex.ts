import { type Combinator } from './combinator.js';
import { type Ampersand } from './ampersand.js';
import {
  Node,
  defineType,
  F_MAY_ASYNC,
  type NodeLocation,
  type NodeOptions
} from './node.js';
import type { Context } from '../context.js';
import { createPublicNil, Nil } from './nil.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { attachSelectorBitLibrary, Selector } from './selector.js';
import type { SimpleSelector } from './selector-simple.js';
import type { CompoundSelector } from './selector-compound.js';

import { type FinalPrintOptions, type PrintOptions, getPrintOptions, savePrintState, restorePrintState } from './util/print.js';
import { consumeTriviaBetween, consumeTriviaBetweenOffsets, emitTriviaTokens } from './util/trivia.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { WARN, toDiagnostic } from '../jess-error.js';
import { ownCollapsedSourceChild } from './util/own-collapsed-source-child.js';

/** Components that may appear in a complex or relative selector. */
export type ComplexSelectorComponent = SimpleSelector | CompoundSelector | Combinator | Ampersand | string;
export type ComplexSelectorValue = ComplexSelectorComponent[];

const isUnresolvedAmpersand = (part: Node): part is Ampersand => {
  return isNode(part, N.Ampersand) && !part.getResolvedSelector();
};

const isComplexSelectorComponentNode = (part: Node): part is Exclude<ComplexSelectorComponent, string> => {
  return part instanceof Selector
    && !isNode(part, N.SelectorList)
    && !isNode(part, N.ComplexSelector);
};

function isComplexSelectorComponent(part: Node | string): part is ComplexSelectorComponent {
  return typeof part === 'string' || isComplexSelectorComponentNode(part);
}

export function isStringCombinator(value: string): boolean {
  return value === ' ' || value === '>' || value === '+' || value === '~' || value === '|';
}

/**
 * Selectors with combinators.
 *
 * @example
 * #id > .class.class
 *
 */
export class ComplexSelector extends Selector<ComplexSelectorValue> {
  static override childKeys = ['value'] as const;

  override readonly value: ComplexSelectorValue;

  constructor(
    value: ComplexSelectorValue,
    options?: NodeOptions,
    location?: NodeLocation,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    this._treeContext = treeContext;
    this.value = value;
  }

  private ownComponent(component: ComplexSelectorComponent): ComplexSelectorComponent {
    if (typeof component === 'string') {
      return component;
    }
    const owned = component.canReuseAsLeaf() ? component.reuseAsLeaf() : component.cloneForPlacement();
    if (!isComplexSelectorComponentNode(owned)) {
      throw new TypeError('Expected complex selector component copy');
    }
    return owned;
  }

  private withComponents(
    value: ComplexSelectorValue,
    sourceValue: readonly ComplexSelectorComponent[] = this.value
  ): ComplexSelector {
    const ownedValue = new Array<ComplexSelectorComponent>(value.length);
    let hoistToRoot = false;
    for (let i = 0; i < value.length; i++) {
      const component = value[i]!;
      ownedValue[i] = this.isSourceComponent(component, sourceValue) ? this.ownComponent(component) : component;
      if (typeof component !== 'string' && component.hoistToRoot) {
        hoistToRoot = true;
      }
    }
    // Own unchanged source children; evaluated clones may carry runtime state.
    const node = this instanceof RelativeSelector
      ? new RelativeSelector(ownedValue, this._options ? { ...this._options } : undefined, this.location)
      : new ComplexSelector(ownedValue, this._options ? { ...this._options } : undefined, this.location);
    if (hoistToRoot) {
      node.hoistToRoot = true;
    }
    return node.inherit(this);
  }

  private isSourceComponent(component: ComplexSelectorComponent, sourceValue: readonly ComplexSelectorComponent[]): boolean {
    for (let i = 0; i < sourceValue.length; i++) {
      if (sourceValue[i] === component) {
        return true;
      }
    }
    return false;
  }

  private createEvaluatedComponentSurface(
    value: Array<Node | string>,
    sourceValue: readonly ComplexSelectorComponent[]
  ): this {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return this.withComponents(this.compactComplexComponents(value), sourceValue) as this;
  }

  private collapsedComponent(
    component: Selector,
    sourceValue: readonly ComplexSelectorComponent[]
  ): Selector {
    const owned = ownCollapsedSourceChild(component, sourceValue, this);
    if (!(owned instanceof Selector)) {
      throw new TypeError('Expected selector result');
    }
    return owned;
  }

  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer!;
    let { value } = this;
    let length = value.length;
    let isFirstSelector = true;
    const saved = savePrintState(options, ['ampersandFirst']);
    const emitComponent = (component: ComplexSelectorComponent) => {
      if (typeof component === 'string') {
        w.add(component);
        return;
      }
      const savedBoundaryTrivia = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      try {
        // All non-string ComplexSelectorComponent types extend Selector
        component.writeSyntax(options);
      } finally {
        options.suppressBoundaryTrivia = savedBoundaryTrivia;
      }
    };
    for (let i = 0; i < length; i++) {
      let component = value[i]!;
      if (!(isNode(component, N.Combinator) || (typeof component === 'string' && isStringCombinator(component)))) {
        options.ampersandFirst = isFirstSelector;
        isFirstSelector = false;
      }
      if (isNode(component, N.Combinator) || (typeof component === 'string' && isStringCombinator(component))) {
        if (isNode(value[i - 1], N.Nil)) {
          continue;
        }
        let co = typeof component === 'string' ? component : component.value;
        if (co !== ' ') {
          if (co !== '|') {
            w.add(i === 0 ? `${co} ` : ` ${co} `, typeof component === 'string' ? this : component);
          } else {
            w.add(co, typeof component === 'string' ? this : component);
          }
        } else {
          const prev = value[i - 1];
          const next = value[i + 1];
          const spans = this.valueSpans;
          let tokens: ReturnType<typeof consumeTriviaBetween>;
          if (options.trivia && prev instanceof Node && next instanceof Node) {
            tokens = consumeTriviaBetween(options.trivia, prev, next, options);
          } else if (options.trivia && spans) {
            // String components: recover surrounding offsets from valueSpans
            // (prev component end, next component start).
            tokens = consumeTriviaBetweenOffsets(
              options.trivia, spans[(i - 1) * 3 + 1], spans[(i + 1) * 3], options
            );
          }
          if (typeof component === 'string') {
            // String descendant combinator: the captured trivia already carries
            // the exact whitespace/comments; emit it verbatim, or a single space
            // when no trivia was recorded.
            if (tokens) {
              emitTriviaTokens(tokens, options);
            } else {
              w.add(' ', this);
            }
          } else {
            const coStart = component.location[0];
            const spaceBeforeTrivia = coStart !== undefined
              && tokens?.start !== undefined
              && coStart < tokens.start;
            if (spaceBeforeTrivia) {
              w.add(' ', component);
            }
            emitTriviaTokens(tokens, options);
            if (!spaceBeforeTrivia) {
              w.add(' ', component);
            }
          }
        }
      } else {
        emitComponent(component);
      }
    }
    restorePrintState(options, saved);
  }

  private renderComplexSyntax(rawOptions?: PrintOptions): string {
    if (this.value.length === 0) {
      return '';
    }
    const options = getPrintOptions(rawOptions);
    const w = options.writer!;
    const mark = w.mark();
    this.writeSyntax(options);
    return w.getSince(mark);
  }

  /**
   * Essentially, a#id.class === a.class#id as being identical selectors,
   * so we normalize groups and combinators
   *
   */
  override valueOf() {
    let value = this._valueOf;
    if (value === undefined) {
      value = '';
      for (let i = 0; i < this.value.length; i++) {
        value += String(this.value[i]!.valueOf());
      }
      this._valueOf = value;
    }
    return value;
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
    for (const component of value) {
      if (typeof component === 'string') {
        const componentKeySet = library.getBitset([component]);
        keySet = keySet.or(componentKeySet);
        if (!isStringCombinator(component)) {
          visibleKeySet = visibleKeySet.or(componentKeySet);
        }
        requiredKeySet = requiredKeySet.or(componentKeySet);
        continue;
      }
      if (isNode(component, N.Combinator)) {
        component.keySetLibrary ??= library;
        keySet = keySet.or(component.keySet);
        requiredKeySet = requiredKeySet.or(component.requiredKeySet);
        continue;
      }
      if (component instanceof Selector) {
        component.keySetLibrary ??= library;
        keySet = keySet.or(component.keySet);
        visibleKeySet = visibleKeySet.or(component.visibleKeySet);
        requiredKeySet = requiredKeySet.or(component.requiredKeySet);
      }
    }
    this._keySet = keySet;
    this._visibleKeySet = visibleKeySet;
    this._requiredKeySet = requiredKeySet;
  }

  override toTrimmedString(options?: PrintOptions): string {
    return this.renderComplexSyntax(options);
  }

  /**
   * @todo - Re-write and simplify, now that we have a distinct CompoundSelector
   */
  override evalNode(context: Context): MaybePromise<Node> {
    attachSelectorBitLibrary(this, context.selectorBits);
    if (!this.hasFlag(F_MAY_ASYNC)) {
      return this.finalizeComponents(context, this.evaluateComponentsSync(context, false), true);
    }
    const evaluatedValue = this.evaluateComponents(context, false);
    return isThenable(evaluatedValue)
      ? (evaluatedValue as Promise<Array<Node | string>>).then(value => this.finalizeComponents(context, value, true))
      : this.finalizeComponents(context, evaluatedValue as Array<Node | string>, true);
  }

  protected override resolveForRender(context: Context): MaybePromise<Node> {
    attachSelectorBitLibrary(this, context.selectorBits);
    if (!this.hasFlag(F_MAY_ASYNC)) {
      return this.finalizeComponents(context, this.evaluateComponentsSync(context, true), false);
    }
    const resolvedValue = this.evaluateComponents(context, true);
    return isThenable(resolvedValue)
      ? (resolvedValue as Promise<Array<Node | string>>).then(value => this.finalizeComponents(context, value, false))
      : this.finalizeComponents(context, resolvedValue as Array<Node | string>, false);
  }

  private evaluateComponentsSync(context: Context, resolve: boolean): Array<Node | string> {
    const currentValue = this.value;
    const evaluatedValue = new Array<Node | string>(currentValue.length);
    for (let i = 0; i < currentValue.length; i++) {
      const component = currentValue[i]!;
      if (typeof component === 'string') {
        evaluatedValue[i] = component;
        continue;
      }
      const out = resolve ? component.resolve(context) : component.eval(context);
      if (!(out instanceof Node)) {
        if (out !== null && typeof out === 'object') {
          throw new TypeError('Expected sync complex selector evaluation to return a node');
        }
        evaluatedValue[i] = component;
        continue;
      }
      evaluatedValue[i] = this.isAllowedEvaluatedComponent(out) ? out : component;
    }
    return evaluatedValue;
  }

  private evaluateComponents(context: Context, resolve: boolean): MaybePromise<Array<Node | string>> {
    const currentValue = this.value;
    const evaluatedValue = new Array<Node | string>(currentValue.length);
    for (let i = 0; i < currentValue.length; i++) {
      const component = currentValue[i]!;
      if (typeof component === 'string') {
        evaluatedValue[i] = component;
        continue;
      }
      const out = resolve ? component.resolve(context) : component.eval(context);
      if (isThenable(out)) {
        return out.then((res) => {
          evaluatedValue[i] = this.isAllowedEvaluatedComponent(res) ? res : component;
          return this.evaluateComponentsRest(context, resolve, evaluatedValue, i + 1);
        });
      }
      evaluatedValue[i] = this.isAllowedEvaluatedComponent(out) ? out : component;
    }
    return evaluatedValue;
  }

  private evaluateComponentsRest(
    context: Context,
    resolve: boolean,
    evaluatedValue: Array<Node | string>,
    start: number
  ): MaybePromise<Array<Node | string>> {
    const currentValue = this.value;
    for (let i = start; i < currentValue.length; i++) {
      const component = currentValue[i]!;
      if (typeof component === 'string') {
        evaluatedValue[i] = component;
        continue;
      }
      const out = resolve ? component.resolve(context) : component.eval(context);
      if (isThenable(out)) {
        return out.then((res) => {
          evaluatedValue[i] = this.isAllowedEvaluatedComponent(res) ? res : component;
          return this.evaluateComponentsRest(context, resolve, evaluatedValue, i + 1);
        });
      }
      evaluatedValue[i] = this.isAllowedEvaluatedComponent(out) ? out : component;
    }
    return evaluatedValue;
  }

  private isAllowedEvaluatedComponent(value: Node): boolean {
    return value instanceof Selector || value instanceof Nil;
  }

  private finalizeComponents(context: Context, evaluatedValue: Array<Node | string>, evaluated: boolean): Node {
    const currentValue = this.value;
    const value = this.compactSelectorParts(context, evaluatedValue);
    this.compactCombinators(value);
    if (value.length === 0) {
      return createPublicNil().inherit(this);
    }
    if (value.length === 1) {
      return this.finalizeSingleComponent(value[0]!, evaluated);
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
      : this.withComponents(this.compactComplexComponents(value), currentValue);
  }

  private finalizeSingleComponent(only: Node | string, evaluated: boolean): Node {
    if (typeof only === 'string') {
      return this.withComponents([only], this.value);
    }
    if (only instanceof Nil) {
      return only;
    }
    if (!(only instanceof Selector)) {
      if (evaluated) {
        return only.inherit(this);
      }
      throw new TypeError('Expected selector result');
    }
    const collapsed = this.collapsedComponent(only, this.value);
    if (this.hoistToRoot) {
      collapsed.hoistToRoot = true;
    }
    return collapsed;
  }

  private compactSelectorParts(context: Context, evaluatedValue: Array<Node | string>): Array<Node | string> {
    let hasOtherSelectorParts = false;
    let unresolvedAmpersandCount = 0;
    for (let i = 0; i < evaluatedValue.length; i++) {
      const part = evaluatedValue[i]!;
      if (typeof part !== 'string' && isUnresolvedAmpersand(part)) {
        unresolvedAmpersandCount++;
      } else if (
        typeof part === 'string'
        || (!isNode(part, N.Combinator) && !isNode(part, N.Nil) && !isNode(part, N.Ampersand))
      ) {
        hasOtherSelectorParts = true;
      }
    }
    if (hasOtherSelectorParts && unresolvedAmpersandCount > 0) {
      this.emitParentlessAmpersandWarnings(context, evaluatedValue.filter((p): p is Node => typeof p !== 'string'));
    }
    const value: Array<Node | string> = [];
    for (let i = 0; i < evaluatedValue.length; i++) {
      const part = evaluatedValue[i]!;
      if (typeof part !== 'string' && isNode(part, N.Nil)) {
        continue;
      }
      if (typeof part !== 'string' && hasOtherSelectorParts && isUnresolvedAmpersand(part)) {
        continue;
      }
      value.push(part);
    }
    return value;
  }

  private emitParentlessAmpersandWarnings(context: Context, value: Node[]): void {
    for (let i = 0; i < value.length; i++) {
      const amp = value[i]!;
      if (!isUnresolvedAmpersand(amp)) {
        continue;
      }
      const file = amp.sourceRoot?._treeContext?.file;
      const selectorText = String(this.valueOf?.() ?? '&');
      context.warnings.push(toDiagnostic(WARN.parentlessAmpersand({
        ctx: file ? { file } : undefined,
        filePath: file?.fullPath,
        line: amp.location?.[1],
        column: amp.location?.[2],
        meta: { selector: selectorText }
      })));
    }
  }

  private compactCombinators(value: Array<Node | string>): void {
    let outIndex = 0;
    for (let i = 0; i < value.length; i++) {
      const part = value[i]!;
      if (isNode(part, N.Combinator) || (typeof part === 'string' && isStringCombinator(part))) {
        const prev = outIndex > 0 ? value[outIndex - 1] : undefined;
        let next: Node | string | undefined;
        for (let j = i + 1; j < value.length; j++) {
          const candidate = value[j]!;
          if (!(isNode(candidate, N.Combinator) || (typeof candidate === 'string' && isStringCombinator(candidate)))) {
            next = candidate;
            break;
          }
        }
        if (i === 0) {
          if (next && !(isNode(next, N.Combinator) || (typeof next === 'string' && isStringCombinator(next)))) {
            value[outIndex++] = part;
          }
          continue;
        }
        if (
          prev
          && next
          && !(isNode(prev, N.Combinator) || (typeof prev === 'string' && isStringCombinator(prev)))
          && !(isNode(next, N.Combinator) || (typeof next === 'string' && isStringCombinator(next)))
        ) {
          value[outIndex++] = part;
        }
        continue;
      }
      value[outIndex++] = part;
    }
    value.length = outIndex;
  }

  private compactComplexComponents(items: Array<Node | string>): ComplexSelectorValue {
    const value: ComplexSelectorComponent[] = [];
    for (let i = 0; i < items.length; i++) {
      const component = items[i]!;
      if (isComplexSelectorComponent(component)) {
        value.push(component);
      }
    }
    return value;
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.resolveForRender(context);
  }
  // override async evalNode(context: Context): Promise<ComplexSelector | SelectorList | Nil> {
  //   let elements = [...selector.value] as ComplexSelectorValue
  //   selector.value = elements

  //   let collapseNesting = context.opts.collapseNesting
  //   if (collapseNesting) {
  //     let hasAmp = elements.find(el => el instanceof Ampersand)
  //     /**
  //      * Try to evaluate all selectors as if they are prepended by `&`
  //      */
  //     if (!hasAmp && context.rulesetFrames.length > 0) {
  //       if (elements[0] instanceof Combinator) {
  //         elements.unshift(new Ampersand())
  //       } else {
  //         elements.unshift(new Ampersand(), new Combinator(' '))
  //       }
  //     }
  //   }

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

type SelectorParams = ConstructorParameters<typeof ComplexSelector>;

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
export const sel = defineType<ComplexSelectorValue>(ComplexSelector, 'ComplexSelector', 'sel') as (
  value: ComplexSelectorValue,
  options?: SelectorParams[1],
  location?: SelectorParams[2],
  treeContext?: SelectorParams[3]
) => ComplexSelector;

/** A selector branch that starts with a combinator and is resolved relative to a parent selector. */
export class RelativeSelector extends ComplexSelector {}

export const rel = defineType<ComplexSelectorValue, typeof RelativeSelector>(RelativeSelector, 'RelativeSelector', 'rel') as (
  value: ComplexSelectorValue,
  options?: SelectorParams[1],
  location?: SelectorParams[2],
  treeContext?: SelectorParams[3]
) => RelativeSelector;
