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
import { consumeTriviaBetween, emitTriviaTokens } from './util/trivia.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { WARN, toDiagnostic } from '../jess-error.js';
import { canReuseLeaf, copyWithReusableLeaves, ownCollapsedSourceChild, reuseLeaf } from './util/cloning.js';

/** Components that may appear in a complex or relative selector. */
export type ComplexSelectorComponent = SimpleSelector | CompoundSelector | Combinator | Ampersand;
export type ComplexSelectorValue = ComplexSelectorComponent[];

const isUnresolvedAmpersand = (part: Node): part is Ampersand => {
  return isNode(part, N.Ampersand) && !part.getResolvedSelector();
};

const isComplexSelectorComponentNode = (part: Node): part is ComplexSelectorComponent => {
  return part instanceof Selector
    && !isNode(part, N.SelectorList)
    && !isNode(part, N.ComplexSelector);
};

function isComplexSelectorComponent(part: Node): part is ComplexSelectorComponent {
  return isComplexSelectorComponentNode(part);
}

/**
 * Selectors with combinators.
 *
 * @example
 * #id > .class.class
 *
 * @note A complex selector may not always start with a selector. We also use this for a
 * relative selector, which means it may start with a combinator.
 */
export class ComplexSelector extends Selector<ComplexSelectorValue> {
  static override childKeys = ['components'] as const;

  readonly components: ComplexSelectorValue;

  constructor(
    value: ComplexSelectorValue,
    options?: NodeOptions,
    location?: NodeLocation,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location, false);
    this._treeContext = treeContext;
    this.components = value;
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (item instanceof Node) {
        this.adopt(item);
      }
    }
  }

  private ownComponent(component: ComplexSelectorComponent): ComplexSelectorComponent {
    const owned = canReuseLeaf(component) ? reuseLeaf(component) : copyWithReusableLeaves(component);
    if (!isComplexSelectorComponentNode(owned)) {
      throw new TypeError('Expected complex selector component copy');
    }
    return owned;
  }

  private withComponents(
    value: ComplexSelectorValue,
    sourceValue: readonly ComplexSelectorComponent[] = this.components
  ): this {
    const ownedValue = new Array<ComplexSelectorComponent>(value.length);
    let hoistToRoot = false;
    for (let i = 0; i < value.length; i++) {
      const component = value[i]!;
      ownedValue[i] = this.isSourceComponent(component, sourceValue) ? this.ownComponent(component) : component;
      if (component.hoistToRoot) {
        hoistToRoot = true;
      }
    }
    // Own unchanged source children; evaluated clones may carry runtime state.
    const node = new ComplexSelector(
      ownedValue,
      this._options ? { ...this._options } : undefined,
      this.location
    ).inherit(this) as this;
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
    value: Node[],
    sourceValue: readonly ComplexSelectorComponent[]
  ): this {
    return this.withComponents(this.compactComplexComponents(value), sourceValue);
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
    let { components } = this;
    let length = components.length;
    let isFirstSelector = true;
    const saved = savePrintState(options, ['ampersandFirst']);
    const emitComponent = (component: ComplexSelectorComponent) => {
      const savedBoundaryTrivia = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      try {
        if (component instanceof Selector) {
          component.writeSyntax(options);
        } else {
          component.toTrimmedString(options);
        }
      } finally {
        options.suppressBoundaryTrivia = savedBoundaryTrivia;
      }
    };
    for (let i = 0; i < length; i++) {
      let component = components[i]!;
      if (!isNode(component, N.Combinator)) {
        options.ampersandFirst = isFirstSelector;
        isFirstSelector = false;
      }
      if (isNode(component, N.Combinator)) {
        if (isNode(components[i - 1], N.Nil)) {
          continue;
        }
        let co = component.value;
        if (co !== ' ') {
          if (co !== '|') {
            w.add(i === 0 ? `${co} ` : ` ${co} `, component);
          } else {
            w.add(co, component);
          }
        } else {
          const prev = components[i - 1];
          const next = components[i + 1];
          const tokens = options.trivia && prev && next
            ? consumeTriviaBetween(options.trivia, prev, next, options)
            : undefined;
          const coStart = component.location[0];
          const spaceBeforeTrivia = coStart !== undefined
            && tokens?.[0]?.startOffset !== undefined
            && coStart < tokens[0]!.startOffset!;
          if (spaceBeforeTrivia) {
            w.add(' ', component);
          }
          emitTriviaTokens(tokens, options);
          if (!spaceBeforeTrivia) {
            w.add(' ', component);
          }
        }
      } else {
        emitComponent(component);
      }
    }
    restorePrintState(options, saved);
  }

  private renderComplexSyntax(options?: PrintOptions): string {
    if (this.components.length === 0) {
      return '';
    }
    options = getPrintOptions(options);
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
      for (let i = 0; i < this.components.length; i++) {
        value += String(this.components[i]!.valueOf());
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
    const { components } = this;
    let keySet = library.getBitset();
    let visibleKeySet = library.getBitset();
    let requiredKeySet = library.getBitset();
    for (const component of components) {
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
      ? (evaluatedValue as Promise<Node[]>).then(value => this.finalizeComponents(context, value, true))
      : this.finalizeComponents(context, evaluatedValue as Node[], true);
  }

  protected override resolveForRender(context: Context): MaybePromise<Node> {
    attachSelectorBitLibrary(this, context.selectorBits);
    if (!this.hasFlag(F_MAY_ASYNC)) {
      return this.finalizeComponents(context, this.evaluateComponentsSync(context, true), false);
    }
    const resolvedValue = this.evaluateComponents(context, true);
    return isThenable(resolvedValue)
      ? (resolvedValue as Promise<Node[]>).then(value => this.finalizeComponents(context, value, false))
      : this.finalizeComponents(context, resolvedValue as Node[], false);
  }

  private evaluateComponentsSync(context: Context, resolve: boolean): Node[] {
    const currentValue = this.components;
    const evaluatedValue = new Array<Node>(currentValue.length);
    for (let i = 0; i < currentValue.length; i++) {
      const component = currentValue[i]!;
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

  private evaluateComponents(context: Context, resolve: boolean): MaybePromise<Node[]> {
    const currentValue = this.components;
    const evaluatedValue = new Array<Node>(currentValue.length);
    for (let i = 0; i < currentValue.length; i++) {
      const component = currentValue[i]!;
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
    evaluatedValue: Node[],
    start: number
  ): MaybePromise<Node[]> {
    const currentValue = this.components;
    for (let i = start; i < currentValue.length; i++) {
      const component = currentValue[i]!;
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

  private finalizeComponents(context: Context, evaluatedValue: Node[], evaluated: boolean): Node {
    const currentValue = this.components;
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

  private finalizeSingleComponent(only: Node, evaluated: boolean): Node {
    if (only instanceof Nil) {
      return only;
    }
    if (!(only instanceof Selector)) {
      if (evaluated) {
        return only.inherit(this);
      }
      throw new TypeError('Expected selector result');
    }
    const collapsed = this.collapsedComponent(only, this.components);
    if (this.hoistToRoot) {
      collapsed.hoistToRoot = true;
    }
    return collapsed;
  }

  private compactSelectorParts(context: Context, evaluatedValue: Node[]): Node[] {
    let hasOtherSelectorParts = false;
    let unresolvedAmpersandCount = 0;
    for (let i = 0; i < evaluatedValue.length; i++) {
      const part = evaluatedValue[i]!;
      if (isUnresolvedAmpersand(part)) {
        unresolvedAmpersandCount++;
      } else if (!isNode(part, N.Combinator) && !isNode(part, N.Nil) && !isNode(part, N.Ampersand)) {
        hasOtherSelectorParts = true;
      }
    }
    if (hasOtherSelectorParts && unresolvedAmpersandCount > 0) {
      this.emitParentlessAmpersandWarnings(context, evaluatedValue);
    }
    const value: Node[] = [];
    for (let i = 0; i < evaluatedValue.length; i++) {
      const part = evaluatedValue[i]!;
      if (isNode(part, N.Nil)) {
        continue;
      }
      if (hasOtherSelectorParts && isUnresolvedAmpersand(part)) {
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

  private compactCombinators(value: Node[]): void {
    let outIndex = 0;
    for (let i = 0; i < value.length; i++) {
      const part = value[i]!;
      if (isNode(part, N.Combinator)) {
        const prev = outIndex > 0 ? value[outIndex - 1] : undefined;
        let next: Node | undefined;
        for (let j = i + 1; j < value.length; j++) {
          const candidate = value[j]!;
          if (!isNode(candidate, N.Combinator)) {
            next = candidate;
            break;
          }
        }
        if (i === 0) {
          if (next && !isNode(next, N.Combinator)) {
            value[outIndex++] = part;
          }
          continue;
        }
        if (prev && next && !isNode(prev, N.Combinator) && !isNode(next, N.Combinator)) {
          value[outIndex++] = part;
        }
        continue;
      }
      value[outIndex++] = part;
    }
    value.length = outIndex;
  }

  private compactComplexComponents(value: Node[]): ComplexSelectorValue {
    const components: ComplexSelectorComponent[] = [];
    for (let i = 0; i < value.length; i++) {
      const component = value[i]!;
      if (isComplexSelectorComponent(component)) {
        components.push(component);
      }
    }
    return components;
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

export const sel = defineType<ComplexSelectorValue>(ComplexSelector, 'ComplexSelector', 'sel') as (
  value: ComplexSelectorValue,
  options?: SelectorParams[1],
  location?: SelectorParams[2],
  treeContext?: SelectorParams[3]
) => ComplexSelector;
