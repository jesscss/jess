import { Node, F_STATIC, F_VISIBLE, F_AMPERSAND, F_EXTENDED, F_EXTEND_TARGET, F_IMPLICIT_AMPERSAND, defineType, type NodeOptions } from './node.js';
import { Rules } from './rules.js';
import type { Context } from '../context.js';
import { createPublicNil, Nil } from './nil.js';
import { Bool } from './bool.js';
import { Condition } from './condition.js';
import { attachSelectorBitLibrary, Selector } from './selector.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { Combinator } from './combinator.js';
import { ComplexSelector, type ComplexSelectorComponent } from './selector-complex.js';
import { CompoundSelector } from './selector-compound.js';
import { SimpleSelector } from './selector-simple.js';
import { SelectorList } from './selector-list.js';
import { PseudoSelector } from './selector-pseudo.js';
import {
  type PrintOptions,
  type FinalPrintOptions,
  getPrintOptions,
  prepareRenderPrintState,
  savePrintState,
  restorePrintState,
  getCachedComposedSelector,
  setCachedComposedSelector
} from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import type { AtRule } from './at-rule.js';
import { serializeRulesContainer, normalizeIndent, normalizeLeadingBlockTrivia, indent } from './util/serialize-helper.js';
import { isRenderBuffer, prepareBufferPrintState, writeRenderText, type RenderBuffer } from './util/render-buffer.js';
import { getImplicitSelector as getImplicitSelectorUtil } from './util/selector-utils.js';
import { registerRulesetWithRoot } from './util/extend-roots.js';
import { createTriviaMap } from './util/trivia.js';
import { copyOwnedWithReusableLeaves } from './util/cloning.js';
import { canRenderStaticRulesDirectly } from './util/static-rules.js';

export type RulesetValue = {
  selector: Selector | Nil;
  /**
   * It's important that any Node that defines a Rules
   * sets it to the `rules` property. This allows us to
   * generalize nodes for the `frames` property in Context
   */
  rules: Rules;
  guard?: Condition | Nil;
  /**
   * When this ruleset is extended, we store its selector before the first extend.
   * Nested rulesets' implicit & (selectorContainer → parent value) use this when set, so they
   * do not "see" the extended form (EXTEND_RULES §5: do not materialize ampersands
   * that were not matched and extended).
   */
  selectorBeforeExtend?: Selector | Nil;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function copySelectorForRulesetMetadata(selector: Selector): Selector {
  const copied = copyOwnedWithReusableLeaves(selector);
  if (isRulesetSelectorMetadata(copied)) {
    return copied;
  }
  throw new TypeError('Expected selector metadata copy to remain selector-like');
}

function isRulesetSelectorMetadata(value: unknown): value is Selector {
  return value instanceof Selector
    || (
      !!value
      && typeof value === 'object'
      && (value as { isSelector?: unknown }).isSelector === true
    )
    || value instanceof Node;
}

type RulesetOptions = NodeOptions & {
  parentSelector?: Selector | Nil;
  /** Own selector before parent resolution (getImplicitSelector); used by extend so nested rulesets extend .replace,.c not the resolved form. */
  ownSelector?: Selector | Nil;
};

/**
 * A qualified rule. This is historically called a "Ruleset"
 * by older CSS documentation and by Less.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Syntax#css_rulesets
 *
 * @example
 * .box {
 *   color: black;
 * }
 */
export class Ruleset extends Node<RulesetValue, RulesetOptions> {
  override allowRuleRoot = true;
  override allowRoot = true;
  // Ruleset owns registration prep and marks `registrationPrepared` directly.
  frames: (Ruleset | AtRule)[] | undefined;
  /** Legacy canonical composed selector slot still used by extend post-processing. */
  declare _composedSelector?: Selector;
  /** Canonical selector-cache owner for derived registration-prep wrappers. */
  declare _selectorCacheOwner?: Ruleset;

  private ownSelector(value: RulesetValue['selector']): RulesetValue['selector'] {
    if (value instanceof Nil) {
      return value;
    }
    if (!(value instanceof Selector)) {
      return value;
    }
    const owned = copyOwnedWithReusableLeaves(value);
    if (owned instanceof Selector) {
      return owned;
    }
    throw new TypeError('Expected ruleset selector copy');
  }

  private ownRules(value: RulesetValue['rules']): RulesetValue['rules'] {
    const owned = copyOwnedWithReusableLeaves(value);
    if (owned instanceof Rules) {
      return owned;
    }
    throw new TypeError('Expected ruleset rules copy');
  }

  private attachSelectorBits(selector: RulesetValue['selector'], selectorBits: Context['selectorBits']): void {
    if (selector instanceof Nil) {
      return;
    }
    if (!(selector instanceof Selector)) {
      return;
    }
    this.attachSelectorBitsToNode(selector, selectorBits);
  }

  private attachSelectorBitsToNode(node: Node, selectorBits: Context['selectorBits']): void {
    if (node instanceof Selector) {
      node.keySetLibrary ??= selectorBits;
      const { sourceNode } = node;
      if (sourceNode !== node && sourceNode instanceof Selector) {
        this.attachSelectorBitsToNode(sourceNode, selectorBits);
      }
    }
    this.attachSelectorBitsToValue(node.value, selectorBits);
  }

  private attachSelectorBitsToValue(value: unknown, selectorBits: Context['selectorBits']): void {
    if (value instanceof Node) {
      this.attachSelectorBitsToNode(value, selectorBits);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        this.attachSelectorBitsToValue(item, selectorBits);
      }
      return;
    }
    if (isRecord(value)) {
      for (const key in value) {
        this.attachSelectorBitsToValue(value[key], selectorBits);
      }
    }
  }

  private deriveRuleset(
    value: RulesetValue,
    sourceValue: RulesetValue = this.value,
    options: { ownRules?: boolean } = {}
  ): Ruleset {
    const node = new Ruleset(
      {
        selector: value.selector === sourceValue.selector ? this.ownSelector(value.selector) : value.selector,
        rules: options.ownRules && value.rules === sourceValue.rules ? this.ownRules(value.rules) : value.rules,
        ...(value.guard !== undefined && { guard: value.guard }),
        ...(value.selectorBeforeExtend !== undefined && {
          selectorBeforeExtend: value.selectorBeforeExtend
        })
      },
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined,
      this.treeContext
    ).inherit(this);
    node.hoistToRoot = this.hoistToRoot;
    node.frames = this.frames ? [...this.frames] : undefined;
    return node;
  }

  get selector() {
    return this.value.selector;
  }

  /**
   * Compose a child selector with its parent selector, resolving `&`.
   *
   * Two cases:
   * - **Child contains `&`** (explicit): recursively substitutes every `&`
   *   with `parent`, wrapping `parent` in `:is()` only at positions where a
   *   raw substitution would change combinator precedence, break a tight
   *   compound, or require distributing across a list.
   * - **Child has no `&`** (implicit): prepends `parent` to `child` via a
   *   descendant combinator. A `SelectorList` parent is wrapped in `:is()`
   *   to avoid distribution; simple/compound/complex parents splice inline.
   */
  static composeSelector(child: Selector, parent: Selector): Selector {
    const library = child.keySetLibrary ?? parent.keySetLibrary;
    // Child is a parent-replacement: its `&` has already been fully resolved
    // against the parent context (e.g. `.a, .b { &-1 { ... } }` →
    // `.a-1, .b-1`). The selector already contains the parent; composing
    // further would re-prepend it. Signaled by `hoistToRoot` on the selector,
    // set by `Ampersand.evalNode` when substituting a bare `&` or `&-X`.
    if (child.hoistToRoot === true) {
      return attachSelectorBitLibrary(child, library);
    }
    // Child is a SelectorList: compose each item independently. Each item
    // carries its own explicit-vs-implicit & semantics.
    if (isNode(child, N.SelectorList)) {
      const items = (child as SelectorList).value as Selector[];
      const out: Selector[] = [];
      for (const item of items) {
        const composed = Ruleset.composeSelector(item, parent);
        // A bare-& item substituted with a list parent comes back as a list:
        // flatten its items into the outer result.
        if (isNode(composed, N.SelectorList)) {
          out.push(...((composed as SelectorList).value as Selector[]));
        } else {
          out.push(composed);
        }
      }
      if (out.length === 1) {
        return attachSelectorBitLibrary(out[0]!, library);
      }
      return attachSelectorBitLibrary(SelectorList.create(out).inherit(child), library);
    }

    const childHasAmp = child.hasFlag(F_AMPERSAND)
      || (child.sourceNode ?? child).hasFlag(F_AMPERSAND);

    if (childHasAmp) {
      return attachSelectorBitLibrary(Ruleset._substituteAmpersand(child, parent), library);
    }

    // Implicit descendant compose: `parent child`.
    return attachSelectorBitLibrary(Ruleset._prependParent(parent, child), library);
  }

  private static _toComplexComponent(selector: Selector): ComplexSelectorComponent {
    if (
      selector instanceof SimpleSelector
      || isNode(selector, N.CompoundSelector)
      || isNode(selector, N.Combinator)
      || isNode(selector, N.Ampersand)
    ) {
      return selector;
    }
    return Ruleset._wrapIs(selector);
  }

  private static _toSimpleSelector(selector: Selector): SimpleSelector {
    if (selector instanceof SimpleSelector || isNode(selector, N.Ampersand)) {
      return selector;
    }
    return Ruleset._wrapIs(selector);
  }

  private static _prependParent(parent: Selector, child: Selector): Selector {
    const library = child.keySetLibrary ?? parent.keySetLibrary;
    const leading: ComplexSelectorComponent[] = isNode(parent, N.ComplexSelector)
      ? parent.value.slice()
      : isNode(parent, N.SelectorList)
        ? [Ruleset._wrapIs(parent)]
        : [Ruleset._toComplexComponent(parent)];

    const trailing: ComplexSelectorComponent[] = isNode(child, N.ComplexSelector)
      ? child.value.slice()
      : [Ruleset._toComplexComponent(child)];

    const childStartsWithCombinator = trailing.length > 0 && isNode(trailing[0]!, N.Combinator);
    const merged = childStartsWithCombinator
      ? [...leading, ...trailing]
      : [...leading, Combinator.create(' '), ...trailing];

    return attachSelectorBitLibrary(ComplexSelector.create(merged).inherit(child), library);
  }

  /**
   * Recursively substitute every `&` in `child` with `parent`. Assumes
   * `child` contains at least one `&`. Does not mutate `child` or `parent`.
   *
   * `insideComplex` signals that `child` is a component of an enclosing
   * ComplexSelector. In that case a compound with leading `&` cannot be
   * smart-spliced into a complex parent, because the surrounding
   * combinators in the outer complex would misattach to the wrong end of
   * the parent chain.
   */
  private static _substituteAmpersand(child: Selector, parent: Selector, insideComplex = false): Selector {
    const library = child.keySetLibrary ?? parent.keySetLibrary;
    // Bare `&` — substitute raw. `&` is in "whole position": no wrapping.
    if (isNode(child, N.Ampersand)) {
      return attachSelectorBitLibrary(parent, library);
    }

    // SelectorList — delegate back to composeSelector so per-item semantics apply.
    if (isNode(child, N.SelectorList)) {
      return Ruleset.composeSelector(child, parent);
    }

    if (isNode(child, N.CompoundSelector)) {
      return attachSelectorBitLibrary(
        Ruleset._substituteAmpInCompound(child, parent, insideComplex),
        library
      );
    }

    if (isNode(child, N.ComplexSelector)) {
      return attachSelectorBitLibrary(Ruleset._substituteAmpInComplex(child, parent), library);
    }

    if (isNode(child, N.PseudoSelector)) {
      return attachSelectorBitLibrary(Ruleset._substituteAmpInPseudo(child, parent), library);
    }

    return attachSelectorBitLibrary(child, library);
  }

  private static _substituteAmpInCompound(compound: CompoundSelector, parent: Selector, insideComplex = false): Selector {
    const library = compound.keySetLibrary ?? parent.keySetLibrary;
    const components = compound.value as SimpleSelector[];

    // Count direct `&` components and find the position of the first one.
    let ampCount = 0;
    let firstAmpIdx = -1;
    for (let i = 0; i < components.length; i++) {
      if (isNode(components[i]!, N.Ampersand)) {
        ampCount++;
        if (firstAmpIdx === -1) {
          firstAmpIdx = i;
        }
      }
    }

    // Smart splice candidate: exactly one `&`, at the leading position, and
    // the compound is not itself a component of an enclosing complex where
    // splicing would misattach surrounding combinators.
    const canSmartSplice = ampCount === 1 && firstAmpIdx === 0 && !insideComplex;

    if (canSmartSplice) {
      const suffix = components.slice(1);
      // Simple / Compound parent — splice directly into the compound.
      if (!isNode(parent, N.ComplexSelector) && !isNode(parent, N.SelectorList)) {
        const parentComponents: SimpleSelector[] = isNode(parent, N.CompoundSelector)
          ? parent.value
          : [Ruleset._toSimpleSelector(parent)];
        const merged = [...parentComponents, ...suffix];
        if (merged.length === 1) {
          return attachSelectorBitLibrary(merged[0]!, library);
        }
        return attachSelectorBitLibrary(CompoundSelector.create(merged).inherit(compound), library);
      }
      // ComplexSelector parent — attach the suffix to the parent's last
      // non-combinator part, returning a new complex.
      if (isNode(parent, N.ComplexSelector)) {
        const parentParts = parent.value.slice();
        let lastIdx = -1;
        for (let i = parentParts.length - 1; i >= 0; i--) {
          if (!isNode(parentParts[i]!, N.Combinator)) {
            lastIdx = i;
            break;
          }
        }
        if (lastIdx !== -1 && suffix.length > 0) {
          const lastPart = parentParts[lastIdx]!;
          const existing: SimpleSelector[] = isNode(lastPart, N.CompoundSelector)
            ? lastPart.value
            : [Ruleset._toSimpleSelector(lastPart)];
          const merged = [...existing, ...suffix];
          parentParts[lastIdx] = merged.length === 1
            ? Ruleset._toComplexComponent(merged[0]!)
            : CompoundSelector.create(merged);
        }
        return attachSelectorBitLibrary(ComplexSelector.create(parentParts).inherit(compound), library);
      }
      // SelectorList parent falls through to the general path below.
    }

    // General path: walk components, substituting each `&` in place.
    // Simple/Compound parents splice; Complex/List parents wrap in `:is()`.
    const newComponents: SimpleSelector[] = [];
    for (const comp of components) {
      if (isNode(comp, N.Ampersand)) {
        if (isNode(parent, N.ComplexSelector) || isNode(parent, N.SelectorList)) {
          newComponents.push(Ruleset._wrapIs(parent));
        } else if (isNode(parent, N.CompoundSelector)) {
          newComponents.push(...parent.value);
        } else {
          newComponents.push(Ruleset._toSimpleSelector(parent));
        }
      } else if (comp.hasFlag(F_AMPERSAND)) {
        // `&` is nested deeper (e.g. inside a pseudo arg).
        const sub = Ruleset._substituteAmpersand(comp, parent);
        if (isNode(sub, N.CompoundSelector)) {
          newComponents.push(...sub.value);
        } else {
          newComponents.push(Ruleset._toSimpleSelector(sub));
        }
      } else {
        newComponents.push(comp);
      }
    }
    if (newComponents.length === 1) {
      return attachSelectorBitLibrary(newComponents[0]!, library);
    }
    return attachSelectorBitLibrary(CompoundSelector.create(newComponents).inherit(compound), library);
  }

  private static _substituteAmpInComplex(complex: ComplexSelector, parent: Selector): Selector {
    const library = complex.keySetLibrary ?? parent.keySetLibrary;
    const parts = complex.value;
    const newParts: ComplexSelectorComponent[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (isNode(part, N.Ampersand)) {
        const leftTight = Ruleset._isTightCombinatorAt(parts, i - 1);
        const rightTight = Ruleset._isTightCombinatorAt(parts, i + 1);
        if (isNode(parent, N.SelectorList)) {
          // Lists can't be distributed; wrap in `:is()`.
          newParts.push(Ruleset._wrapIs(parent));
        } else if (isNode(parent, N.ComplexSelector)) {
          if (leftTight || rightTight) {
            // Splicing would attach a tight combinator to the wrong end of
            // the parent chain; wrap in `:is()` to preserve meaning.
            newParts.push(Ruleset._wrapIs(parent));
          } else {
            newParts.push(...parent.value);
          }
        } else {
          // Simple or Compound parent: single-component insertion, always safe.
          newParts.push(Ruleset._toComplexComponent(parent));
        }
      } else if (!isNode(part, N.Combinator) && part.hasFlag(F_AMPERSAND)) {
        const rightTight = Ruleset._isTightCombinatorAt(parts, i + 1);
        const allowSmartSpliceInPlace = i === 0 && !rightTight;
        const sub = Ruleset._substituteAmpersand(
          part,
          parent,
          !allowSmartSpliceInPlace
        );
        if (isNode(sub, N.ComplexSelector)) {
          // Flatten a complex sub into this complex's components.
          newParts.push(...sub.value);
        } else {
          newParts.push(Ruleset._toComplexComponent(sub));
        }
      } else {
        newParts.push(part);
      }
    }
    return attachSelectorBitLibrary(ComplexSelector.create(newParts).inherit(complex), library);
  }

  private static _substituteAmpInPseudo(pseudo: PseudoSelector, parent: Selector): Selector {
    const library = pseudo.keySetLibrary ?? parent.keySetLibrary;
    const { arg } = pseudo.value;
    if (arg && !isNode(arg, N.Selector)) {
      return attachSelectorBitLibrary(pseudo, library);
    }
    if (!arg) {
      return attachSelectorBitLibrary(pseudo, library);
    }
    // Pseudo arg is a full selector slot, so its content is effectively in
    // "whole position" w.r.t. the enclosing pseudo. Recurse without any
    // extra wrapping at the arg boundary.
    const newArg = Ruleset._substituteAmpersand(arg, parent);
    const newPseudo = PseudoSelector.create({
      name: pseudo.value.name,
      arg: newArg
    });
    if (pseudo.generated) {
      newPseudo.generated = true;
    }
    return attachSelectorBitLibrary(newPseudo.inherit(pseudo), library);
  }

  private static _isTightCombinatorAt(parts: ComplexSelectorComponent[], idx: number): boolean {
    if (idx < 0 || idx >= parts.length) {
      return false;
    }
    const c = parts[idx];
    if (!c || !isNode(c, N.Combinator)) {
      return false;
    }
    const v = String((c as Combinator).valueOf() ?? '');
    return v.trim().length > 0;
  }

  private static _wrapIs(selector: Selector): PseudoSelector {
    const library = selector.keySetLibrary;
    const is = PseudoSelector.create({ name: ':is', arg: selector });
    is.generated = true;
    return attachSelectorBitLibrary(is, library);
  }

  static ensureDescendantRulesetsHaveOwnValue(
    ruleset: Ruleset,
    sharedValue: RulesetValue
  ): void {
    const rules = ruleset.value?.rules;
    if (!rules || !isNode(rules, N.Rules)) {
      return;
    }
    const children = (rules as Rules).value;
    if (!Array.isArray(children)) {
      return;
    }
    for (const child of children) {
      if (!isNode(child, N.Ruleset)) {
        continue;
      }
      const rs = child as Ruleset;
      if (rs.value === sharedValue) {
        rs.value = {
          selector: rs.value.selector,
          rules: rs.value.rules,
          ...(rs.value.guard !== undefined && { guard: rs.value.guard })
        };
      }
      Ruleset.ensureDescendantRulesetsHaveOwnValue(rs, sharedValue);
    }
  }

  isHoisted(options: PrintOptions) {
    return this.hoistToRoot ?? options.collapseNesting ?? false;
  }

  protected _valueOf: string | undefined;

  /** Used for equality comparison with other rulesets */
  override valueOf() {
    if (this._valueOf !== undefined) {
      return this._valueOf;
    }
    const selector = this.selector;
    if (selector instanceof Nil) {
      this._valueOf = '';
      return this._valueOf;
    }
    this._valueOf = (selector as Selector).valueOf();
    return this._valueOf;
  }

  /**
   * Invalidate cached selector-based string value.
   *
   * `Ruleset.valueOf()` is used by serialization frame tracking; when an extend
   * mutates `value.selector`, we must clear this cache so frame/header caching
   * reflects the updated selector.
   */
  invalidateSelectorValueCache(nextSelector?: Selector | Nil): void {
    this._valueOf = undefined;
    this._composedSelector = undefined;
    nextSelector ??= this.value.selector as Selector | Nil | undefined;

    const cacheOwner = this._selectorCacheOwner;
    if (!cacheOwner || cacheOwner === this) {
      return;
    }

    cacheOwner._composedSelector = undefined;
    if (nextSelector instanceof Nil) {
      cacheOwner._valueOf = '';
      return;
    }
    if (nextSelector) {
      cacheOwner._valueOf = nextSelector.valueOf();
      return;
    }
    cacheOwner._valueOf = undefined;
  }

  override toTrimmedString(options?: PrintOptions): string {
    const opts = getPrintOptions(options);
    if (
      opts.referenceMode === true
      && opts.referenceRenderEnabled !== false
      && this.hoistToRoot
    ) {
      const ownSelector = (this.options as RulesetOptions | undefined)?.ownSelector;
      if (ownSelector && Ruleset.isBareAmpersandSelector(ownSelector)) {
        return '';
      }
    }
    return serializeRulesContainer(this, opts);
  }

  private canSourceRenderStaticRule(rule: Node, context: Context): boolean {
    if (isNode(rule, N.Comment | N.Nil)) {
      return true;
    }
    if (isNode(rule, N.Declaration) && rule.hasFlag(F_STATIC)) {
      return true;
    }
    if (isNode(rule, N.VarDeclaration) && rule.hasFlag(F_STATIC) && !rule.visible) {
      return true;
    }
    if (!isNode(rule, N.AtRule) || !rule.hasFlag(F_STATIC)) {
      return false;
    }
    const atRule = rule as AtRule;
    if (!atRule.getRenderRules()) {
      return true;
    }
    return !context.opts.collapseNesting
      && !context.bubbleRootAtRules
      && atRule.isRootOnly();
  }

  private canRenderSourceDirectly(context: Context): boolean {
    if (this.evaluated || this.registrationPrepared || this.value.guard) {
      return false;
    }
    const { selector, rules } = this.value;
    if (selector instanceof Nil || !selector.hasFlag(F_STATIC) || !rules.hasFlag(F_STATIC)) {
      return false;
    }
    return rules.value.every(rule => this.canSourceRenderStaticRule(rule, context));
  }

  private evalNilSelectorBodyForRender(context: Context): MaybePromise<Rules | Nil> {
    const ownedBody = copyOwnedWithReusableLeaves(this.value.rules);
    if (!(ownedBody instanceof Rules)) {
      throw new TypeError('Expected nil-selector render body copy to remain Rules');
    }
    return ownedBody.eval(context);
  }

  private canRenderNilSelectorBodyDirectly(): boolean {
    return !this.value.guard
      && !this.registrationPrepared
      && canRenderStaticRulesDirectly(this.value.rules);
  }

  private evalNilSelectorForRender(context: Context): MaybePromise<Rules | Nil> {
    if (this.canRenderNilSelectorBodyDirectly()) {
      return this.value.rules;
    }
    const { guard } = this.value;
    if (!guard) {
      return this.evalNilSelectorBodyForRender(context);
    }
    if (guard instanceof Nil) {
      return guard;
    }
    if (guard instanceof Condition) {
      const guardPasses = guard.evaluateBoolean(context);
      return isThenable(guardPasses)
        ? (guardPasses as Promise<boolean>).then(passes => passes ? this.evalNilSelectorBodyForRender(context) : new Nil())
        : guardPasses ? this.evalNilSelectorBodyForRender(context) : new Nil();
    }
    const ownedGuard = copyOwnedWithReusableLeaves(guard);
    if (!(ownedGuard instanceof Node)) {
      throw new TypeError('Expected nil-selector render guard copy to remain a Node');
    }
    const finishGuard = (guardResult: Node): MaybePromise<Rules | Nil> => {
      const guardPasses = Boolean(guardResult instanceof Bool && guardResult.value === true);
      return guardPasses ? this.evalNilSelectorBodyForRender(context) : new Nil();
    };
    const guardResult = ownedGuard.eval(context);
    return isThenable(guardResult)
      ? guardResult.then(finishGuard)
      : finishGuard(guardResult);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const finishNilSelectorBodyRender = (rendered: string): string => {
      if (rendered.endsWith('\n')) {
        return rendered;
      }
      if (isRenderBuffer(bufferOrOptions)) {
        writeRenderText(bufferOrOptions, '\n');
      }
      return `${rendered}\n`;
    };
    const renderNilSelectorBodyDirectly = (): MaybePromise<string> => {
      const rendered = isRenderBuffer(bufferOrOptions)
        ? this.value.rules.render(context, bufferOrOptions, options)
        : this.value.rules.render(context, bufferOrOptions);
      return isThenable(rendered)
        ? rendered.then(finishNilSelectorBodyRender)
        : finishNilSelectorBodyRender(rendered);
    };
    const renderEvaluatedRuleset = (node: Ruleset) => {
      if (isRenderBuffer(bufferOrOptions)) {
        return writeRenderText(
          bufferOrOptions,
          serializeRulesContainer(node, prepareBufferPrintState(context, options))
        );
      }
      return serializeRulesContainer(node, prepareRenderPrintState(context, bufferOrOptions));
    };
    const renderEvaluated = (node: Node) => {
      if (node instanceof Nil) {
        return '';
      }
      if (node instanceof Ruleset) {
        return renderEvaluatedRuleset(node);
      }
      return isRenderBuffer(bufferOrOptions)
        ? node.render(context, bufferOrOptions, options)
        : node.render(context, bufferOrOptions);
    };
    if (
      this.value.selector instanceof Nil
      && this.canRenderNilSelectorBodyDirectly()
    ) {
      return renderNilSelectorBodyDirectly();
    }
    const evalForRender = (): MaybePromise<Node> => {
      if (this.evaluated) {
        return this;
      }
      if (this.canRenderSourceDirectly(context)) {
        return this;
      }
      if (
        this.value.selector instanceof Nil
        && !this.registrationPrepared
      ) {
        return this.evalNilSelectorForRender(context);
      }
      return this.registrationPrepared
        ? this.eval(context)
        : this.evalPrepared(context, { ownRules: true });
    };
    const node = evalForRender();
    return isThenable(node)
      ? node.then(renderEvaluated)
      : renderEvaluated(node);
  }

  override resolve(context: Context): MaybePromise<Node> {
    if (this.evaluated) {
      return this;
    }
    if (this.registrationPrepared) {
      return this.eval(context);
    }
    return this.evalPrepared(context, { ownRules: true });
  }

  private evalPrepared(context: Context, options: { ownRules?: boolean } = {}): MaybePromise<Node> {
    const node = this.registrationPrepared
      ? this
      : this._prepareRulesetRegistration(context, options);
    return isThenable(node)
      ? node.then(prepared => prepared.evalNode(context))
      : node.evalNode(context);
  }

  /**
   * Make authored selector nodes printable while keeping implicit ampersands
   * invisible so nested output stays short.
   */
  private static ensureSelectorVisible(sel: Selector | Nil): void {
    if (!sel || sel instanceof Nil) {
      return;
    }
    if (isNode(sel, N.Ampersand) && sel.hasFlag(F_IMPLICIT_AMPERSAND)) {
      return;
    }
    if (!sel.hasFlag(F_VISIBLE)) {
      sel.addFlag(F_VISIBLE);
    }
    if (isNode(sel, N.SelectorList)) {
      if (Array.isArray(sel.value)) {
        for (const item of sel.value) {
          Ruleset.ensureSelectorVisible(item);
        }
      }
      return;
    }
    if (isNode(sel, N.ComplexSelector)) {
      if (Array.isArray(sel.value)) {
        for (const c of sel.value) {
          Ruleset.ensureSelectorVisible(c);
        }
      }
      return;
    }
    if (isNode(sel, N.CompoundSelector)) {
      for (const c of sel.value) {
        Ruleset.ensureSelectorVisible(c);
      }
    }
  }

  private static needsVisibleSelectorClone(sel: Selector | Nil): boolean {
    if (!sel || sel instanceof Nil) {
      return false;
    }
    if (!(isNode(sel, N.Ampersand) && sel.hasFlag(F_IMPLICIT_AMPERSAND)) && !sel.hasFlag(F_VISIBLE)) {
      return true;
    }
    if (isNode(sel, N.SelectorList)) {
      if (!Array.isArray(sel.value)) {
        return false;
      }
      for (let i = 0; i < sel.value.length; i++) {
        if (Ruleset.needsVisibleSelectorClone(sel.value[i]!)) {
          return true;
        }
      }
      return false;
    }
    if (isNode(sel, N.ComplexSelector)) {
      if (!Array.isArray(sel.value)) {
        return false;
      }
      for (let i = 0; i < sel.value.length; i++) {
        if (Ruleset.needsVisibleSelectorClone(sel.value[i]!)) {
          return true;
        }
      }
      return false;
    }
    if (!isNode(sel, N.CompoundSelector)) {
      return false;
    }
    for (let i = 0; i < sel.value.length; i++) {
      if (Ruleset.needsVisibleSelectorClone(sel.value[i]!)) {
        return true;
      }
    }
    return false;
  }

  static isBareAmpersandSelector(sel: Selector | Nil): boolean {
    const isBareAmpNode = (node: Selector): boolean => {
      return isNode(node, N.Ampersand)
        && (node.value.appendValue === undefined || node.value.appendValue === '');
    };
    if (!sel || sel instanceof Nil) {
      return false;
    }
    if (isBareAmpNode(sel)) {
      return true;
    }
    if (isNode(sel, N.ComplexSelector) || isNode(sel, N.CompoundSelector)) {
      return sel.value.length === 1 && isBareAmpNode(sel.value[0]!);
    }
    if (isNode(sel, N.SelectorList)) {
      return sel.value.every(item => Ruleset.isBareAmpersandSelector(item));
    }
    return false;
  }

  static hasExtendedTopLevelSelector(sel: Selector | Nil): boolean {
    if (!sel || sel instanceof Nil) {
      return false;
    }
    if (isNode(sel, N.SelectorList)) {
      for (let i = 0; i < sel.value.length; i++) {
        if (sel.value[i]!.hasFlag(F_EXTENDED)) {
          return true;
        }
      }
      return false;
    }
    return sel.hasFlag(F_EXTENDED);
  }

  private static filterExtendedTopLevelSelectorItems(sel: Selector): Selector | Nil {
    if (!isNode(sel, N.SelectorList)) {
      return (sel.hasFlag(F_EXTENDED) || sel.hasFlag(F_EXTEND_TARGET)) ? sel : new Nil();
    }
    const seen = new Set<string>();
    const kept: Selector[] = [];
    let sawAddedSelector = false;
    for (const item of sel.value) {
      if (item.hasFlag(F_EXTENDED) && !item.hasFlag(F_EXTEND_TARGET)) {
        sawAddedSelector = true;
        const key = item.valueOf();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        kept.push(copySelectorForRulesetMetadata(item));
      }
    }
    if (!sawAddedSelector) {
      for (const item of sel.value) {
        if (!item.hasFlag(F_EXTENDED) && !item.hasFlag(F_EXTEND_TARGET)) {
          continue;
        }
        const key = item.valueOf();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        kept.push(copySelectorForRulesetMetadata(item));
      }
    }
    if (kept.length === 0) {
      return new Nil();
    }
    if (kept.length === 1) {
      return kept[0]!;
    }
    return SelectorList.create(kept).inherit(sel);
  }

  /**
   * Filter a compose-parent selector for reference-mode rendering. Reference
   * imports hide non-extended selectors from output, so when we compose a
   * child against a parent that came from a reference import, the compose
   * parent should contain only the items that remain visible.
   *
   * Returns the filtered parent, or `undefined` if the original parent is
   * already correct for use as-is (nothing to filter, no visibility flags
   * present). Returns `undefined` rather than the original so callers can
   * distinguish "filter was no-op" from "filter reduced the parent".
   */
  /**
   * Filter a compose-parent selector for reference-mode rendering. Reference
   * imports hide content not reached by an extend; when a reference-imported
   * parent gains visible selector items via extend, nested descendants should
   * compose against those visible items rather than the hidden original targets.
   *
   * Returns the filtered parent, or `undefined` when the filter is a no-op
   * so callers can fall through to their own parent handling.
   */
  static filterExtendedForReferenceCompose(parent: Selector, includeUntouchedSiblings: boolean = false): Selector | undefined {
    if (!isNode(parent, N.SelectorList)) {
      return undefined;
    }
    let hasAnyAdded = false;
    for (let i = 0; i < parent.value.length; i++) {
      const item = parent.value[i]!;
      if (item.hasFlag(F_EXTENDED) && !item.hasFlag(F_EXTEND_TARGET)) {
        hasAnyAdded = true;
        break;
      }
    }
    if (!hasAnyAdded) {
      return undefined;
    }
    const seen = new Set<string>();
    const kept: Selector[] = [];
    for (const item of parent.value) {
      const keepItem = includeUntouchedSiblings
        ? !item.hasFlag(F_EXTEND_TARGET)
        : item.hasFlag(F_EXTENDED) && !item.hasFlag(F_EXTEND_TARGET);
      if (!keepItem) {
        continue;
      }
      const key = item.valueOf();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      kept.push(item);
    }
    if (kept.length === 0 || kept.length === parent.value.length) {
      return undefined;
    }
    if (kept.length === 1) {
      return kept[0]!;
    }
    return SelectorList.create(kept).inherit(parent);
  }

  static expandGeneratedIsForReferenceCompose(selector: Selector): Selector | undefined {
    if (isNode(selector, N.SelectorList)) {
      const expanded: Selector[] = [];
      let changed = false;
      const seen = new Set<string>();
      for (const item of selector.value) {
        const next = Ruleset.expandGeneratedIsForReferenceCompose(item) ?? item;
        const items = isNode(next, N.SelectorList) ? next.value : [next];
        changed ||= next !== item;
        for (const expandedItem of items) {
          const key = expandedItem.valueOf();
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          expanded.push(expandedItem);
        }
      }
      if (!changed) {
        return undefined;
      }
      if (expanded.length === 1) {
        return expanded[0]!;
      }
      return SelectorList.create(expanded).inherit(selector);
    }

    if (!isNode(selector, N.ComplexSelector)) {
      return undefined;
    }

    const slots: Array<Array<{ parts: ComplexSelectorComponent[]; hasAdded: boolean }>> = [];
    let sawGeneratedIs = false;
    const complex = selector;
    for (const part of complex.value) {
      if (isNode(part, N.PseudoSelector)) {
        const { arg } = part.value;
        if (!(part.generated === true && part.value.name === ':is' && isNode(arg, N.SelectorList))) {
          slots.push([{ parts: [part], hasAdded: false }]);
          continue;
        }
        const alternatives: Array<{ parts: ComplexSelectorComponent[]; hasAdded: boolean }> = [];
        for (const item of arg.value) {
          if (item.hasFlag(F_EXTEND_TARGET)) {
            continue;
          }
          alternatives.push({
            parts: isNode(item, N.ComplexSelector)
              ? [...item.value]
              : [Ruleset._toComplexComponent(item)],
            hasAdded: item.hasFlag(F_EXTENDED)
          });
        }
        if (alternatives.length === 0) {
          slots.push([{ parts: [part], hasAdded: false }]);
          continue;
        }
        sawGeneratedIs = true;
        slots.push(alternatives);
        continue;
      }
      slots.push([{ parts: [part], hasAdded: false }]);
    }

    if (!sawGeneratedIs) {
      return undefined;
    }

    const expanded: Selector[] = [];
    const seen = new Set<string>();
    const build = (
      index: number,
      parts: ComplexSelectorComponent[],
      hasAdded: boolean
    ): void => {
      if (index >= slots.length) {
        if (!hasAdded) {
          return;
        }
        const built = attachSelectorBitLibrary(
          ComplexSelector.create(parts).inherit(complex),
          complex.keySetLibrary
        ) as Selector;
        built.addFlag(F_EXTENDED);
        const key = built.valueOf();
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        expanded.push(built);
        return;
      }
      for (const option of slots[index]!) {
        build(index + 1, [...parts, ...option.parts], hasAdded || option.hasAdded);
      }
    };

    build(0, [], false);
    if (expanded.length === 0) {
      return undefined;
    }
    if (expanded.length === 1) {
      return expanded[0]!;
    }
    return SelectorList.create(expanded).inherit(selector);
  }

  composeHeaderSelector(
    options: FinalPrintOptions,
    renderSelector: Selector,
    referenceFilteredLocal?: Selector | Nil,
    behavior: { skipCurrentCachedParent?: boolean; skipSameSelectorCompose?: boolean } = {}
  ): Selector {
    let rawParentComposed = options.composedSelectorStack?.at(-1);
    const cachedCurrentComposed = getCachedComposedSelector(options, this);
    if (
      behavior.skipCurrentCachedParent !== false
      && rawParentComposed
      && cachedCurrentComposed
      && rawParentComposed.valueOf() === cachedCurrentComposed.valueOf()
    ) {
      rawParentComposed = options.composedSelectorStack?.at(-2);
    }
    const ownSelector = (this.options as RulesetOptions | undefined)?.ownSelector;
    const referenceComposeAmpCount = ((ownSelector ?? renderSelector).valueOf()?.match(/&/g) ?? []).length;
    const parentComposed = (
      options.referenceMode === true
      && options.referenceRenderEnabled === true
      && rawParentComposed
    )
      ? Ruleset.filterExtendedForReferenceCompose(
        rawParentComposed,
        referenceComposeAmpCount > 1
      ) ?? rawParentComposed
      : rawParentComposed;
    const structuralParent = (
      this.hoistToRoot === true
      && this.parent?.parent
      && isNode(this.parent.parent, N.Ruleset)
    )
      ? this.parent.parent.value.selector
      : null;
    const composeParent = parentComposed ?? (
      structuralParent && !(structuralParent instanceof Nil) ? structuralParent : null
    );
    let cached = getCachedComposedSelector(options, this);
    if (!cached) {
      const hasExtendedComposeContext = Boolean(
        Ruleset.hasExtendedTopLevelSelector(renderSelector)
        || (composeParent && Ruleset.hasExtendedTopLevelSelector(composeParent))
        || this.hasFlag(F_EXTENDED)
      );
      const composeInput: Selector = (
        ownSelector
        && !(ownSelector instanceof Nil)
        && ownSelector.hasFlag(F_AMPERSAND)
        && !Ruleset.isBareAmpersandSelector(ownSelector)
        && composeParent
        && hasExtendedComposeContext
      )
        ? ownSelector
        : (referenceFilteredLocal instanceof Nil ? renderSelector : (referenceFilteredLocal ?? renderSelector));
      cached = composeParent
        ? (
            behavior.skipSameSelectorCompose !== false
            && composeInput.valueOf() === composeParent.valueOf()
              ? composeInput
              : Ruleset.composeSelector(composeInput, composeParent)
          )
        : composeInput;
      if (options.referenceMode === true && options.referenceRenderEnabled === true) {
        cached = Ruleset.expandGeneratedIsForReferenceCompose(cached) ?? cached;
      }
      if (composeParent) {
        setCachedComposedSelector(options, this, cached);
      }
    }
    return cached;
  }

  getHeaderString(options: FinalPrintOptions, withoutComments?: boolean): string {
    const { selector } = this.value as RulesetValue;
    const idt = indent(options.depth);

    // Should never be called for Nil selectors (serializeRulesContainer guards this),
    // but keep it safe for TypeScript and invariants.
    if (selector instanceof Nil) {
      return '';
    }

    let renderSelector: Selector | Nil = withoutComments ? this.ownSelector(selector) : selector;
    const referenceFilteredLocal = (
      options.referenceMode === true
      && options.referenceRenderEnabled === true
      && !(renderSelector instanceof Nil)
      && Ruleset.hasExtendedTopLevelSelector(renderSelector)
    )
      ? Ruleset.filterExtendedTopLevelSelectorItems(renderSelector)
      : undefined;
    if (options.collapseNesting && !(renderSelector instanceof Nil)) {
      renderSelector = this.composeHeaderSelector(options, renderSelector, referenceFilteredLocal);
    }
    // Header filter: in reference mode, top-level selector output should
    // reflect the selectors that were actually unlocked. When an extend adds
    // visible selectors, we emit those; for self-extends with no added items,
    // we fall back to the touched original selector.
    if (referenceFilteredLocal) {
      renderSelector = (
        renderSelector.valueOf() === referenceFilteredLocal.valueOf()
          ? renderSelector
          : renderSelector instanceof Nil
            ? renderSelector
            : Ruleset.filterExtendedTopLevelSelectorItems(renderSelector)
      );
      if (renderSelector instanceof Nil) {
        return '';
      }
    }
    const saved = savePrintState(options, ['referenceFilterTargets']);
    if (
      options.referenceMode === true
      && options.referenceRenderEnabled === true
    ) {
      options.referenceFilterTargets = true;
    }
    if (!(renderSelector instanceof Nil)) {
      const needsVisibleSelectorClone = Ruleset.needsVisibleSelectorClone(renderSelector);
      if (options.referenceFilterTargets || needsVisibleSelectorClone) {
        renderSelector = copySelectorForRulesetMetadata(renderSelector);
      }
    }
    Ruleset.ensureSelectorVisible(renderSelector);
    const savedTrivia = options.trivia;
    if (withoutComments) {
      options.trivia = createTriviaMap();
    }
    let selOut: string;
    const writer = options.writer;
    const mark = writer.mark();
    try {
      renderSelector.toString(options);
      selOut = writer.getSince(mark);
    } finally {
      writer.restore(mark);
      options.trivia = savedTrivia;
    }
    restorePrintState(options, saved);
    const header = selOut.replace(/\s+$/, '') + ' {';
    return (/^\s*\/\*/u.test(header)
      ? normalizeLeadingBlockTrivia(header, idt)
      : normalizeIndent(header, idt)) + '\n';
  }

  override prepareRegistration(context: Context): MaybePromise<Ruleset> {
    if (!this.registrationPrepared) {
      return this._prepareRulesetRegistration(context);
    }
    return this;
  }

  private _prepareRulesetRegistration(
    context: Context,
    options: { ownRules?: boolean } = {}
  ): MaybePromise<Ruleset> {
    this.attachSelectorBits(this.value.selector, context.selectorBits);
    const node = this.deriveRuleset(this.value, this.value, options);
    node._selectorCacheOwner = this;
    node.registrationPrepared = true;
    const { selector } = node.value;
    const { selectorBits } = context;
    this._prepareRulesVisibility(node, context);
    this._storeOwnSelector(node, selector, selectorBits);
    /* getImplicitSelector removed — selector stays as-authored.
     * Composed form (with parent context) computed on-demand during:
     * - serialization (composedSelectorStack in PrintOptions)
     * - extend matching (parent context parameter)
     */
    // DO NOT evaluate guard here - guards are evaluated at call time in getFunctionFromMixins
    // Just evaluate the selector
    const sel = this._prepareRulesetSelectorIdentity(selector, context);
    return isThenable(sel)
      ? sel.then(resolved => this._finishRulesetSelectorPrep(node, resolved, context))
      : this._finishRulesetSelectorPrep(node, sel, context);
  }

  private _prepareRulesetSelectorIdentity(selector: Selector | Nil, context: Context): MaybePromise<Selector | Nil> {
    return selector.eval(context);
  }

  private _setGuard(value: Condition | Nil | undefined): void {
    if (value instanceof Node) {
      this.adopt(value);
    }
    this.value.guard = value;
  }

  private _setSelector(value: Selector | Nil): void {
    this.adopt(value);
    this.value.selector = value;
  }

  private _setRules(value: Rules): void {
    this.adopt(value);
    this.value.rules = value;
  }

  private _prepareRulesVisibility(node: Ruleset, context: Context): void {
    const { rules } = node.value;
    // Generated wrapper rulesets (e.g. implicit `& { ... }` created by AtRule hoisting)
    // should not force var visibility to `private`, otherwise sibling vars inside the wrapper
    // (like Less `@base`) become inaccessible.
    if (node.options.generated) {
      return;
    }
    if (context.leakyRules) {
      rules.options.rulesVisibility.Mixin = 'public';
      rules.options.rulesVisibility.VarDeclaration = 'optional';
    } else {
      rules.options.rulesVisibility.Mixin = 'private';
      rules.options.rulesVisibility.VarDeclaration = 'private';
    }
  }

  private _storeOwnSelector(node: Ruleset, selector: Selector | Nil, selectorBits: Context['selectorBits']): void {
    // Store own selector before parent resolution so extend can extend .replace,.c not the resolved form.
    this.attachSelectorBits(selector, selectorBits);
    const ownSelector = !(selector instanceof Nil)
      ? copySelectorForRulesetMetadata(selector as Selector)
      : selector;
    this.attachSelectorBits(ownSelector, selectorBits);
    if (node.options) {
      (node.options as RulesetOptions).ownSelector = ownSelector;
    } else {
      node.options = { ownSelector } as RulesetOptions;
    }
  }

  private _finishRulesetSelectorPrep(
    node: Ruleset,
    sel: Selector | Nil,
    context: Context
  ): MaybePromise<Ruleset> {
    // If this ruleset shares its value with a descendant ruleset, give descendants
    // their own value before we overwrite value.selector so they keep their selector.
    const rulesetNode: Ruleset = node;
    Ruleset.ensureDescendantRulesetsHaveOwnValue(rulesetNode, node.value);
    // Store the evaluated selector - this is what will be in the frame
    node.value.selector = sel;
    if (sel.hoistToRoot) {
      node.hoistToRoot = true;
    }
    // Wire up the BitSet library on the evaluated selector so that
    // extend fast-rejection via keySet/requiredKeySet works. The
    // library is shared across all selectors in a compilation via
    // context.selectorBits; assigning it here ensures that when the
    // lazy `keySet` getter fires during extend matching, it produces
    // real BitSets instead of undefined.
    if ('keySetLibrary' in sel && !(sel instanceof Nil)) {
      (sel as Selector).keySetLibrary ??= context.selectorBits;
    }
    // Register the concrete Ruleset with the current extend root.
    const extendRoot = context.extendRoots.getCurrentExtendRoot();
    if (extendRoot) {
      registerRulesetWithRoot(extendRoot, rulesetNode);
    }
    return this._prepareChildRulesRegistration(node, context, extendRoot);
  }

  private _prepareChildRulesRegistration(node: Ruleset, context: Context, extendRoot: Rules | undefined): MaybePromise<Ruleset> {
    // Depth-first: prepare child rules immediately so all nested rulesets/extends
    // are registered in source order before we process extends.
    // Push this ruleset to the frame so nested rulesets get the correct parent selector
    // when building implicit selectors (e.g. .header-nav inside .header → .header .header-nav).
    const childRules = node.value.rules;
    if (childRules && !childRules.registrationPrepared) {
      const rulesetNode: Ruleset = node;
      const rulesetFrameCount = context.rulesetFrames.length;
      context.rulesetFrames.push(rulesetNode);
      if (extendRoot) {
        context.extendRoots.registerRoot(childRules, extendRoot);
      }
      let preparedRules: MaybePromise<Node>;
      try {
        preparedRules = childRules.prepareRegistration(context);
      } catch (error) {
        context.rulesetFrames.length = rulesetFrameCount;
        throw error;
      }
      if (isThenable(preparedRules)) {
        return preparedRules.then(
          (rules) => {
            context.rulesetFrames.pop();
            if (!(rules instanceof Rules)) {
              throw new TypeError('Expected child rules registration prep to return Rules');
            }
            node.value.rules = rules;
            if (extendRoot && rules !== childRules) {
              context.extendRoots.registerRoot(rules, extendRoot);
            }
            return node;
          },
          (error) => {
            context.rulesetFrames.length = rulesetFrameCount;
            throw error;
          }
        );
      }
      context.rulesetFrames.pop();
      if (!(preparedRules instanceof Rules)) {
        throw new TypeError('Expected child rules registration prep to return Rules');
      }
      node.value.rules = preparedRules;
      if (extendRoot && preparedRules !== childRules) {
        context.extendRoots.registerRoot(preparedRules as Rules, extendRoot);
      }
    }
    return node;
  }

  /** Attach an (invisible) ampersand to the selector(s) if it's not already there */
  getImplicitSelector(parentSelector: Selector, collapseNesting = false) {
    if (this.selector instanceof Nil) {
      return this.selector;
    }
    return getImplicitSelectorUtil(this.selector, parentSelector, collapseNesting);
  }

  override evalNode(context: Context): MaybePromise<Ruleset | Rules | Nil> {
    if (this.evaluated) {
      return this;
    }
    let pushedFrames = false;
    let pushedRulesetFrameCount = 0;
    let pushedFrameCount = 0;
    const restorePushedEvalFrames = () => {
      if (!pushedFrames) {
        return;
      }
      context.rulesetFrames.length = pushedRulesetFrameCount;
      context.frames.length = pushedFrameCount;
      pushedFrames = false;
    };
    /** Registration prep may already have produced the wrapper being evaluated. */
    this.evaluated = true;
    const collapseNesting = context.opts.collapseNesting;
    // Store frames snapshot for collapseNesting serialization
    if (collapseNesting) {
      this.frames = [...context.frames];
    }

    const finishEvaluatedRules = (evaluatedRules: Rules | Nil): Ruleset | Rules | Nil => {
      restorePushedEvalFrames();
      if (evaluatedRules instanceof Nil) {
        return evaluatedRules;
      }

      // If selector was Nil, evaluatedRules is already Rules (not wrapped in Ruleset)
      // In that case, return it directly without wrapping back in Ruleset
      if (this.value.selector instanceof Nil) {
        return evaluatedRules;
      }

      this._setRules(evaluatedRules);
      const rules = this.value.rules;

      if (!rules.hasVisibleRules()) {
        this.removeFlag(F_VISIBLE);
      }
      return this;
    };
    const evalBodyAfterGuard = (guardResult: Nil | undefined): MaybePromise<Ruleset | Rules | Nil> => {
      // If guard failed, return Nil (ruleset produces no output)
      if (guardResult instanceof Nil) {
        return finishEvaluatedRules(guardResult);
      }
      let { selector } = this.value;

      if (selector instanceof Nil) {
        // If selector evaluates to Nil, return the rules body directly instead of the ruleset.
        this._setSelector(selector);
        const evaluatedRules = this.value.rules.eval(context);
        if (isThenable(evaluatedRules)) {
          return (evaluatedRules as Promise<Rules>).then((rules) => {
            this._setRules(rules);
            return finishEvaluatedRules(rules);
          });
        }
        this._setRules(evaluatedRules as Rules);
        return finishEvaluatedRules(evaluatedRules);
      }
      this._setSelector(selector);
      if (context.opts.collapseNesting) {
        this.hoistToRoot = true;
      }
      pushedRulesetFrameCount = context.rulesetFrames.length;
      pushedFrameCount = context.frames.length;
      context.rulesetFrames.push(this);
      context.frames.push(this);
      pushedFrames = true;
      let evaluatedRules: MaybePromise<Rules>;
      try {
        evaluatedRules = this.value.rules.eval(context);
      } catch (error) {
        restorePushedEvalFrames();
        throw error;
      }
      return isThenable(evaluatedRules)
        ? (evaluatedRules as Promise<Rules>).then(
            finishEvaluatedRules,
            (error) => {
              restorePushedEvalFrames();
              throw error;
            }
          )
        : finishEvaluatedRules(evaluatedRules);
    };
    let { guard } = this.value;
    // Guard was already set to Nil (failed in a previous eval)
    if (guard instanceof Nil) {
      return finishEvaluatedRules(guard);
    }
    // Evaluate guard at definition time (not call time like mixins)
    // This is different from mixins because rulesets can't use caller scope for guards
    if (guard) {
      const guardResult = guard instanceof Condition
        ? guard.evaluateBoolean(context)
        : guard.eval(context);
      const finishGuard = (result: boolean | Node): Nil | undefined => {
        const guardPasses = typeof result === 'boolean'
          ? result
          : Boolean(result instanceof Bool && result.value === true);
        if (!guardPasses) {
          this._setGuard(createPublicNil());
          return createPublicNil();
        }
        this._setGuard(undefined);
        return undefined;
      };
      return isThenable(guardResult)
        ? guardResult.then(result => evalBodyAfterGuard(finishGuard(result)))
        : evalBodyAfterGuard(finishGuard(guardResult));
    }
    return evalBodyAfterGuard(undefined);
  }
}

type RulesetParams = ConstructorParameters<typeof Ruleset>;

export const ruleset = defineType<RulesetValue>(Ruleset, 'Ruleset') as (
  value: RulesetValue | RulesetParams[0],
  options?: RulesetParams[1],
  location?: RulesetParams[2],
  treeContext?: RulesetParams[3]
) => Ruleset;
