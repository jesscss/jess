import {
  Node,
  F_VISIBLE,
  F_AMPERSAND,
  F_EXTENDED,
  F_EXTEND_TARGET,
  F_IMPLICIT_AMPERSAND,
  F_NON_STATIC,
  defineType,
  type NodeOptions,
  type OptionalLocation
} from './node.js';
import { Rules } from './rules.js';
import type { Context, TreeContext } from '../context.js';
import { Nil } from './nil.js';
import { Bool } from './bool.js';
import type { Condition } from './condition.js';
import type { Selector } from './selector.js';
import { atIndex } from './util/collections.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { Ampersand } from './ampersand.js';
import { Combinator } from './combinator.js';
import { ComplexSelector, type ComplexSelectorComponent } from './selector-complex.js';
import type { CompoundSelector } from './selector-compound.js';
import { SelectorList } from './selector-list.js';
import { type PrintOptions, type FinalPrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, pipe, isThenable } from '@jesscss/awaitable-pipe';
import type { AtRule } from './at-rule.js';
import { serializeRulesContainer, normalizeIndent, indent } from './util/serialize-helper.js';
import { getImplicitSelector as getImplicitSelectorUtil, getParentRuleset, hasExtendedSelector } from './util/selector-utils.js';
import { ensureRulesetTraceId, getOptionalRulesetTraceId } from './util/ruleset-trace.js';
import { getField, getParent, patchField } from './util/session-helpers.js';

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

type RulesetOptions = NodeOptions & {
  parentSelector?: Selector | Nil;
  /** Own selector before parent resolution (getImplicitSelector); used by extend so nested rulesets extend .replace,.c not the resolved form. */
  ownSelector?: Selector | Nil;
  /** Hoisted at-rule wrapper already carries the caller selector; do not prepend the parent again in preEval. */
  resolvedHoistWrapper?: boolean;
};

/** @todo - Fix typing */
type NarrowRulesetValue<T> = T extends RulesetValue ? T : RulesetValue;
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
export interface Ruleset {
  type: 'Ruleset';
  shortType: 'ruleset';
}

export class Ruleset<T = RulesetValue> extends Node<NarrowRulesetValue<T>, RulesetOptions> {
  static override childKeys = ['selector', 'rules', 'guard', 'selectorBeforeExtend'] as const;

  // Ruleset has preEval method but doesn't need to set flags - preEvaluated is tracked as boolean
  frames: (Ruleset | AtRule)[] | undefined;

  selector!: Selector | Nil;
  rules!: Rules;
  guard: Condition | Nil | undefined;
  selectorBeforeExtend: Selector | Nil | undefined;
  /** Patched selector from extend — used by serialization instead of canonical selector. */
  _extendedSelector: Selector | Nil | undefined;

  constructor(value: NarrowRulesetValue<T>, options?: RulesetOptions, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.selector = value.selector;
    this.rules = value.rules;
    this.guard = value.guard;
    this.selectorBeforeExtend = value.selectorBeforeExtend;
    if (this.selector instanceof Node) {
      this.adopt(this.selector);
    }
    if (this.rules instanceof Node) {
      this.adopt(this.rules);
    }
    if (this.guard instanceof Node) {
      this.adopt(this.guard);
    }
    if (this.selectorBeforeExtend instanceof Node) {
      this.adopt(this.selectorBeforeExtend);
    }
    this.allowRoot = true;
    this.allowRuleRoot = true;
  }

  /**
   * If this ruleset shares its value object with a descendant ruleset, give those
   * descendants their own value so mutating this ruleset's value.selector does not
   * overwrite the descendant's selector (e.g. .rep_ace nested ruleset case).
   */
  static ensureDescendantRulesetsHaveOwnValue(
    ruleset: Ruleset,
    sharedValue: RulesetValue
  ): void {
    const rules = ruleset.rules;
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
      // With instance fields (no shared data object), shallow clones already
      // have independent fields, so this identity check is always false.
      // Kept for structural safety until full clone audit.
      Ruleset.ensureDescendantRulesetsHaveOwnValue(rs, sharedValue);
    }
  }

  static collapseRedundantGeneratedChildren(ruleset: Ruleset): void {
    const rules = ruleset.rules;
    if (!rules || !isNode(rules, N.Rules)) {
      return;
    }
    const children = [...rules.value];
    const normalized: Node[] = [];
    for (const child of children) {
      if (!isNode(child, N.Ruleset)) {
        normalized.push(child);
        continue;
      }
      const childRuleset = child as Ruleset;
      Ruleset.collapseRedundantGeneratedChildren(childRuleset);
      const shouldInline =
        Boolean(ruleset.options?.generated)
        && Boolean(childRuleset.options?.generated)
        && String(ruleset.selector?.valueOf?.() ?? '') === String(childRuleset.selector?.valueOf?.() ?? '');
      if (shouldInline) {
        normalized.push(...childRuleset.rules.value);
        continue;
      }
      normalized.push(childRuleset);
    }
    if (normalized.length !== rules.value.length || normalized.some((node, index) => node !== rules.value[index])) {
      rules.setData(normalized);
      for (const child of normalized) {
        rules.adopt(child);
      }
    }
  }

  isHoisted(options: PrintOptions) {
    return this._getHoistToRoot(options.context) ?? options.collapseNesting ?? false;
  }

  protected _valueOf: string | undefined;

  private _getRulesetOptions(context?: Context): RulesetOptions {
    return context
      ? getField<RulesetOptions>(this, 'options', context)
      : this.options;
  }

  getOwnSelector(context?: Context): Selector | Nil | undefined {
    return this._getRulesetOptions(context).ownSelector;
  }

  setOwnSelector(selector: Selector | Nil | undefined, context?: Context): void {
    if (!context) {
      this.options.ownSelector = selector;
      return;
    }
    const nextOptions: RulesetOptions = {
      ...this._getRulesetOptions(context),
      ownSelector: selector
    };
    if (context.session && this === this.sourceNode) {
      patchField(this, 'options', nextOptions, context);
    } else {
      this.options = nextOptions;
    }
  }

  private _getSelector(context?: Context): Selector | Nil {
    return context
      ? getField<Selector | Nil>(this, 'selector', context)
      : this.selector;
  }

  private _getHoistToRoot(context?: Context): boolean | undefined {
    return context
      ? getField<boolean | undefined>(this, 'hoistToRoot', context)
      : this.hoistToRoot;
  }

  private _setHoistToRoot(value: boolean | undefined, context: Context): void {
    if (context.session && this === this.sourceNode) {
      patchField(this, 'hoistToRoot', value, context);
    } else {
      this.hoistToRoot = value;
    }
    this.invalidateSelectorValueCache();
  }

  getCurrentSelector(context?: Context): Selector | Nil {
    return this._getSelector(context);
  }

  private _setSelector(selector: Selector | Nil, context: Context): void {
    if (selector instanceof Node) {
      this.adopt(selector, context);
    }
    if (context.session && this === this.sourceNode) {
      patchField(this, 'selector', selector, context);
    } else {
      this.selector = selector;
    }
    this.invalidateSelectorValueCache();
  }

  private _getSelectorSourceNode(selector: Selector | Nil | undefined, context?: Context): Node | undefined {
    if (!(selector instanceof Node)) {
      return undefined;
    }
    if (context?.session && context.session.hasRuntime(selector)) {
      const runtime = context.session.getRuntime(selector);
      if (Object.prototype.hasOwnProperty.call(runtime, 'sourceNode') && runtime.sourceNode) {
        return runtime.sourceNode;
      }
    }
    return selector.sourceNode;
  }

  private _setSelectorSourceNode(selector: Selector | Nil | undefined, sourceNode: Node, context: Context): void {
    if (!(selector instanceof Node)) {
      return;
    }
    if (context.session) {
      context.session.getRuntime(selector).sourceNode = sourceNode;
    } else {
      selector.sourceNode = sourceNode;
    }
  }

  private _getRulesContainer(context?: Context): Rules {
    const rules = context
      ? getField<Rules>(this, 'rules', context)
      : this.rules;
    if (context?.session && getParent(rules, context) !== this) {
      this.adopt(rules, context);
    }
    return rules;
  }

  getCurrentRules(context?: Context): Rules {
    return this._getRulesContainer(context);
  }

  private _setRulesContainer(rules: Rules, context: Context): void {
    if (context.session && this !== this.sourceNode) {
      this.adopt(rules);
    } else {
      this.adopt(rules, context);
    }
    if (context.session && this === this.sourceNode) {
      patchField(this, 'rules', rules, context);
    } else {
      this.rules = rules;
    }
  }

  private _getGuard(context?: Context): Condition | Nil | undefined {
    return context
      ? getField<Condition | Nil | undefined>(this, 'guard', context)
      : this.guard;
  }

  getCurrentGuard(context?: Context): Condition | Nil | undefined {
    return this._getGuard(context);
  }

  private _setGuard(guard: Condition | Nil | undefined, context: Context): void {
    if (guard instanceof Node) {
      this.adopt(guard, context);
    }
    if (context.session && this === this.sourceNode) {
      patchField(this, 'guard', guard, context);
    } else {
      this.guard = guard;
    }
  }

  private _getSelectorBeforeExtend(context?: Context): Selector | Nil | undefined {
    return context
      ? getField<Selector | Nil | undefined>(this, 'selectorBeforeExtend', context)
      : this.selectorBeforeExtend;
  }

  getSelectorBeforeExtend(context?: Context): Selector | Nil | undefined {
    return this._getSelectorBeforeExtend(context);
  }

  setSelectorBeforeExtend(selector: Selector | Nil | undefined, context?: Context): void {
    if (!context) {
      this.selectorBeforeExtend = selector;
      return;
    }
    if (selector instanceof Node) {
      this.adopt(selector, context);
    }
    if (context.session && this === this.sourceNode) {
      patchField(this, 'selectorBeforeExtend', selector, context);
    } else {
      this.selectorBeforeExtend = selector;
    }
  }

  private _getExtendedSelector(context?: Context): Selector | Nil | undefined {
    return context
      ? getField<Selector | Nil | undefined>(this, '_extendedSelector', context)
      : this._extendedSelector;
  }

  getExtendedSelector(context?: Context): Selector | Nil | undefined {
    return this._getExtendedSelector(context);
  }

  setExtendedSelector(selector: Selector | Nil | undefined, context?: Context): void {
    if (!context) {
      this._extendedSelector = selector;
      this.invalidateSelectorValueCache();
      return;
    }
    if (selector instanceof Node) {
      this.adopt(selector, context);
    }
    if (context.session && this === this.sourceNode) {
      patchField(this, '_extendedSelector', selector, context);
    } else {
      this._extendedSelector = selector;
    }
    this.invalidateSelectorValueCache();
  }

  /**
   * Returns the selector shape that should be printed for this ruleset.
   *
   * Nested rulesets keep rendering their local selector shape unless they are
   * being serialized from root (`hoistToRoot`) or collapse nesting is enabled.
   * In those cases, the selector must be recomposed against its parent.
   */
  getRenderableSelector(collapseNesting = this.treeContext?.opts?.collapseNesting ?? false, context?: Context): Selector | Nil {
    const ownSelector = this.getOwnSelector(context);
    if (
      !this._getHoistToRoot(context)
      && !collapseNesting
      && ownSelector
      && !(ownSelector instanceof Nil)
      && this._hasAncestorRuleset(context)
    ) {
      return ownSelector as Selector;
    }

    return this.getEffectiveSelector(collapseNesting, context);
  }

  private _hasAncestorRuleset(context?: Context): boolean {
    let current = context ? getParent(this, context) : this.parent;
    while (current) {
      if (isNode(current, N.Ruleset)) {
        return true;
      }
      current = context ? getParent(current, context) : current.parent;
    }
    return false;
  }

  /**
   * Returns the selector that should be used for matching/rendering right now.
   *
   * For nested rulesets that keep a local `ownSelector`, this recomposes the
   * selector against the current parent selector on demand instead of requiring
   * eager mutation of `data.selector` after extends. Hoisted rulesets keep their
   * concrete selector unchanged because they already serialize from root.
   */
  getEffectiveSelector(collapseNesting = this.treeContext?.opts?.collapseNesting ?? false, context?: Context): Selector | Nil {
    // Use extend-patched selector if available, else canonical
    const extendedSelector = this._getExtendedSelector(context);
    const selector = (extendedSelector ?? this._getSelector(context)) as Selector | Nil;
    if (!selector || selector instanceof Nil) {
      return selector;
    }

    const ownSelector = this.getOwnSelector(context);
    const parentRs = getParentRuleset(this, context);
    if (
      collapseNesting
      && this._getHoistToRoot(context)
      && ownSelector
      && !(ownSelector instanceof Nil)
      && Ruleset.isBareAmpersandSelector(ownSelector)
    ) {
      return selector;
    }
    const normalizeParentSelector = (parentSelector: Selector | Nil | undefined): Selector | Nil | undefined => {
      if (
        parentRs
        && parentSelector
        && !(parentSelector instanceof Nil)
        && Ruleset.isBareAmpersandSelector(parentSelector)
      ) {
        const parentOwn = parentRs.getOwnSelector(context);
        if (
          parentOwn
          && !(parentOwn instanceof Nil)
          && Ruleset.isBareAmpersandSelector(parentOwn)
          && parentRs.getCurrentSelector(context)
          && !(parentRs.getCurrentSelector(context) instanceof Nil)
          && !Ruleset.isBareAmpersandSelector(parentRs.getCurrentSelector(context))
        ) {
          return parentRs.getCurrentSelector(context);
        }
      }
      return parentSelector;
    };
    const getComposedParentSelector = (): Selector | Nil | undefined => {
      let parentSelector = normalizeParentSelector(parentRs?.getEffectiveSelector(collapseNesting, context));
      if (
        parentSelector
        && !(parentSelector instanceof Nil)
        && parentRs?._getSelectorBeforeExtend(context)
        && Ruleset.isInReferenceScope(parentRs, context)
      ) {
        parentSelector = Ruleset.filterReferenceVisibleSelectorItems(
          parentSelector as Selector,
          parentRs._getSelectorBeforeExtend(context)
        );
      }
      return parentSelector;
    };
    if (
      collapseNesting
      && this._getHoistToRoot(context)
      && !this._getSelectorBeforeExtend(context)
      && ownSelector
      && !(ownSelector instanceof Nil)
      && ownSelector.valueOf() !== selector.valueOf()
    ) {
      let parentSelector = getComposedParentSelector();
      if (parentSelector && !(parentSelector instanceof Nil)) {
        return getImplicitSelectorUtil(ownSelector as Selector, parentSelector as Selector, false);
      }
    }

    if (this._getHoistToRoot(context)) {
      return selector;
    }

    const parentSelector = getComposedParentSelector();
    if (
      ownSelector
      && !(ownSelector instanceof Nil)
      && parentSelector
      && !(parentSelector instanceof Nil)
      && ownSelector.valueOf() !== selector.valueOf()
    ) {
      return getImplicitSelectorUtil(ownSelector as Selector, parentSelector as Selector, collapseNesting);
    }

    return selector;
  }

  /** Used for equality comparison with other rulesets */
  override valueOf(context?: Context) {
    if (context) {
      const collapseNesting = context.opts.collapseNesting ?? this.treeContext?.opts?.collapseNesting ?? false;
      const selector = (
        this._getExtendedSelector(context)
        || this._getHoistToRoot(context)
        || collapseNesting === true
      )
        ? this.getEffectiveSelector(collapseNesting, context)
        : this._getSelector(context);
      return selector instanceof Nil ? '' : (selector as Selector).valueOf();
    }
    if (this._valueOf !== undefined) {
      return this._valueOf;
    }
    const selector = (
      this._extendedSelector
      || this.hoistToRoot
      || this.treeContext?.opts?.collapseNesting === true
    )
      ? this.getEffectiveSelector()
      : this.selector;
    if (selector instanceof Nil) {
      this._valueOf = '';
      return this._valueOf;
    }
    this._valueOf = selector instanceof Nil ? '' : (selector as Selector).valueOf();
    return this._valueOf;
  }

  /**
   * Invalidate cached selector-based string value.
   *
   * `Ruleset.valueOf()` is used by serialization frame tracking; when an extend
   * mutates `value.selector`, we must clear this cache so frame/header caching
   * reflects the updated selector.
   */
  invalidateSelectorValueCache(): void {
    this._valueOf = undefined;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const opts = options as FinalPrintOptions;
    if (
      opts.referenceMode === true
      && opts.referenceRenderEnabled !== false
      && this._getHoistToRoot(opts.context)
    ) {
      const ownSelector = this.getOwnSelector(opts.context);
      if (ownSelector && Ruleset.isBareAmpersandSelector(ownSelector)) {
        return '';
      }
    }
    return serializeRulesContainer(this, opts);
  }

  /**
   * Render the opening of this ruleset (selector)
   * @todo - Efficiently serialize the selector with and without comments?
  */
  /** Ensure every node in the selector has F_VISIBLE so toString() does not skip them (rep_ace bug).
   * Do NOT add F_VISIBLE to implicit ampersands: they must stay invisible so nested output stays short. */
  private static ensureSelectorVisible(sel: Selector | Nil): void {
    if (!sel || sel instanceof Nil || typeof (sel as Node).addFlag !== 'function') {
      return;
    }
    const n = sel as Node;
    if (isNode(sel, N.Ampersand) && n.hasFlag(F_IMPLICIT_AMPERSAND)) {
      return;
    }
    if (!n.hasFlag(F_VISIBLE)) {
      n.addFlag(F_VISIBLE);
    }
    if (isNode(sel, N.SelectorList)) {
      const list = sel as SelectorList;
      for (const item of list.value) {
        Ruleset.ensureSelectorVisible(item);
      }
      return;
    }
    if (isNode(sel, N.ComplexSelector)) {
      const comps = (sel as ComplexSelector).value;
      for (const c of comps) {
        Ruleset.ensureSelectorVisible(c as Selector);
      }
      return;
    }
    const v = (sel as any).value;
    if (Array.isArray(v)) {
      for (const c of v) {
        Ruleset.ensureSelectorVisible(c);
      }
    }
  }

  private static materializeHoistedImplicitAmpersands(sel: Selector | Nil): Selector | Nil {
    if (!sel || sel instanceof Nil) {
      return sel;
    }
    const materialize = (node: Selector): Selector => {
      if (isNode(node, N.Ampersand)) {
        const amp = node as Ampersand;
        const n = amp as unknown as Node;
        if (n.hasFlag(F_IMPLICIT_AMPERSAND)) {
          const resolved = amp.getResolvedSelector();
          if (resolved && !(resolved instanceof Nil)) {
            return resolved as Selector;
          }
        }
        return node;
      }
      if (isNode(node, N.SelectorList)) {
        const list = node as SelectorList;
        return SelectorList.create(list.value.map(item => materialize(item as Selector))).inherit(node) as Selector;
      }
      if (isNode(node, N.ComplexSelector)) {
        const complex = node as ComplexSelector;
        const parts: ComplexSelectorComponent[] = [];
        for (const part of complex.value) {
          if (isNode(part, N.Ampersand)) {
            const amp = part as Ampersand;
            const n = amp as unknown as Node;
            if (n.hasFlag(F_IMPLICIT_AMPERSAND)) {
              const resolved = amp.getResolvedSelector();
              if (resolved && !(resolved instanceof Nil)) {
                const repl = materialize(resolved as Selector);
                if (isNode(repl, N.ComplexSelector)) {
                  parts.push(...(repl as ComplexSelector).value as ComplexSelectorComponent[]);
                } else {
                  parts.push(repl as ComplexSelectorComponent);
                }
                continue;
              }
            }
          }
          parts.push(materialize(part as Selector) as ComplexSelectorComponent);
        }
        return ComplexSelector.create(parts).inherit(node) as Selector;
      }
      const arr = (node as any).value;
      if (Array.isArray(arr)) {
        const cloned = node.copy(true) as any;
        cloned.value = arr.map(item => materialize(item as Selector));
        return cloned as Selector;
      }
      return node;
    };
    return materialize(sel as Selector);
  }

  static isBareAmpersandSelector(sel: Selector | Nil): boolean {
    if (!sel || sel instanceof Nil) {
      return false;
    }
    if (isNode(sel, N.Ampersand)) {
      return (sel as Ampersand).isPlainAmpersand();
    }
    if (isNode(sel, N.CompoundSelector | N.ComplexSelector)) {
      const items = (sel as unknown as { value?: unknown[] }).value;
      if (!Array.isArray(items)) {
        return false;
      }
      return items.length === 1
        && isNode(items[0] as Node, N.Ampersand)
        && (items[0] as Ampersand).isPlainAmpersand();
    }
    if (isNode(sel, N.SelectorList)) {
      return (sel as SelectorList).value.every(
        item => isNode(item, N.Ampersand) && (item as Ampersand).isPlainAmpersand()
      );
    }
    return false;
  }

  private static isInReferenceScope(node: Node, context?: Context): boolean {
    let current: Node | undefined = node;
    while (current) {
      if (isNode(current, N.Rules) && (current as Rules).options?.referenceMode === true) {
        return true;
      }
      current = (context
        ? getParent(current, context)
        : current.parent) as Node | undefined;
    }
    return false;
  }

  static hasExtendedTopLevelSelector(sel: Selector | Nil): boolean {
    return hasExtendedSelector(sel);
  }

  private static filterSelectorItems(
    sel: Selector,
    shouldKeep: (item: Selector) => boolean
  ): Selector | Nil {
    if (!isNode(sel, N.SelectorList)) {
      return shouldKeep(sel) ? sel : new Nil();
    }
    const seen = new Set<string>();
    const kept: Selector[] = [];
    for (const item of (sel as SelectorList).value) {
      if (!shouldKeep(item)) {
        continue;
      }
      const key = item.valueOf();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      kept.push(item as Selector);
    }
    if (kept.length === 0) {
      return new Nil();
    }
    if (kept.length === 1) {
      return kept[0]!;
    }
    return SelectorList.create(kept).inherit(sel);
  }

  private static filterExtendedTopLevelSelectorItems(sel: Selector): Selector | Nil {
    return Ruleset.filterSelectorItems(sel, item =>
      item.hasFlag(F_EXTENDED) && !item.hasFlag(F_EXTEND_TARGET)
    );
  }

  private static filterReferenceVisibleSelectorItems(
    current: Selector,
    original?: Selector | Nil
  ): Selector | Nil {
    if (!original || original instanceof Nil) {
      return Ruleset.filterExtendedTopLevelSelectorItems(current);
    }
    const originalValues = new Set<string>();
    if (isNode(original, N.SelectorList)) {
      for (const item of (original as SelectorList).value) {
        originalValues.add(item.valueOf());
      }
    } else {
      originalValues.add(original.valueOf());
    }
    return Ruleset.filterSelectorItems(current, item =>
      !originalValues.has(item.valueOf())
    );
  }

  getHeaderString(options: FinalPrintOptions, withoutComments?: boolean): string {
    const w = options.writer;
    const selector = this.getRenderableSelector(options.collapseNesting, options.context);
    const idt = indent(options.depth);

    // Should never be called for Nil selectors (serializeRulesContainer guards this),
    // but keep it safe for TypeScript and invariants.
    if (selector instanceof Nil) {
      return '';
    }
    if (withoutComments) {
      options = { ...options, suppressComments: true };
    }
    let renderSelector: Selector | Nil = selector;
    const ownSelector = this.getOwnSelector(options.context);
    const currentSelector = this._getSelector(options.context);
    if (
      this._getHoistToRoot(options.context)
      && Ruleset.isBareAmpersandSelector(renderSelector)
      && ownSelector
      && !(ownSelector instanceof Nil)
      && Ruleset.isBareAmpersandSelector(ownSelector)
      && !Ruleset.isBareAmpersandSelector(currentSelector)
    ) {
      renderSelector = currentSelector;
    }
    if (this._getHoistToRoot(options.context) && options.depth === 0 && !(renderSelector instanceof Nil)) {
      renderSelector = Ruleset.materializeHoistedImplicitAmpersands(renderSelector as Selector) as typeof selector;
    }
    if (
      options.referenceMode === true
      && options.referenceRenderEnabled === true
      && !(renderSelector instanceof Nil)
      && Ruleset.hasExtendedTopLevelSelector(renderSelector as Selector | Nil)
    ) {
      renderSelector = Ruleset.filterReferenceVisibleSelectorItems(
        renderSelector as Selector,
        this._getSelectorBeforeExtend(options.context)
      ) as typeof renderSelector;
      if (renderSelector instanceof Nil) {
        return '';
      }
    }
    const prevReferenceFilterTargets = options.referenceFilterTargets === true;
    const disableTargetFilteringForTopLevelList = (
      this.hasFlag(F_EXTENDED)
      && !(renderSelector instanceof Nil)
      && isNode(renderSelector as Selector, N.SelectorList)
    );
    options.referenceFilterTargets = (
      options.referenceMode === true
      && options.referenceRenderEnabled === true
      && !disableTargetFilteringForTopLevelList
    );
    Ruleset.ensureSelectorVisible(renderSelector);
    const rulesetId = ensureRulesetTraceId(this as unknown as Ruleset);
    let out = withoutComments ? '' : w.capture(() => this.processPrePost('pre', undefined, options));
    let selOut = w.capture(() => renderSelector.toString(options));
    options.referenceFilterTargets = prevReferenceFilterTargets;
    /** Normalize single spacing */
    out += selOut.replace(/[ \t]+/g, ' ');
    return normalizeIndent(selOut.replace(/\s+$/, '') + ' {', idt) + '\n';
  }

  override preEval(context: Context): MaybePromise<this> {
    if (!this._isPreEvaluated(context)) {
      const node = this.maybeClone(context);
      node._setPreEvaluated(true, context);
      // Index should already be assigned by parent Rules
      node.sourceNode ??= this;
      const rulesetOptions = node._getRulesetOptions(context);
      let rules = node._getRulesContainer(context);
      let guard = node._getGuard(context);
      // On re-eval (e.g. mixin clone), use the pre-composition ownSelector so we
      // compose from the authored selector, not the already-composed one.
      let selector: Selector | Nil = rulesetOptions.ownSelector ?? node._getSelector(context);
      // Generated wrapper rulesets (e.g. implicit `& { ... }` created by AtRule hoisting)
      // should not force var visibility to `private`, otherwise sibling vars inside the wrapper
      // (like Less `@base`) become inaccessible.
      if (!rulesetOptions.generated) {
        const nextRulesOptions = {
          ...rules.getCurrentOptions(context),
          rulesVisibility: {
            ...rules.getCurrentOptions(context).rulesVisibility
          }
        };
        if (context.leakyRules) {
          nextRulesOptions.rulesVisibility.Mixin = 'public';
          nextRulesOptions.rulesVisibility.VarDeclaration = 'optional';
        } else {
          nextRulesOptions.rulesVisibility.Mixin = 'private';
          nextRulesOptions.rulesVisibility.VarDeclaration = 'private';
        }
        rules.setCurrentOptions(nextRulesOptions, context);
      }
      // Check if there's a root-only at-rule between us and the parent ruleset
      // If so, don't inherit the parent selector (root-only at-rules like @keyframes
      // don't propagate parent selectors to their children)
      let shouldInheritSelector = true;
      const parentRuleset = context.rulesetFrames.at(-1);
      const parentRulesetIndex = parentRuleset ? context.frames.lastIndexOf(parentRuleset) : -1;
      if (parentRulesetIndex >= 0) {
        // Check frames after the parent ruleset for any root-only at-rules
        for (let i = parentRulesetIndex + 1; i < context.frames.length; i++) {
          const frame = context.frames[i];
          if (isNode(frame, N.AtRule) && (frame as AtRule).isRootOnly()) {
            shouldInheritSelector = false;
            break;
          }
        }
      }

      const parentSelector = parentRuleset?._getSelector(context);
      // Store own selector before parent resolution so extend can extend .replace,.c not the resolved form.
      node.setOwnSelector(selector, context);
      if (
        !node._getRulesetOptions(context).resolvedHoistWrapper
        && parentSelector
        && !(parentSelector instanceof Nil)
        && !(selector instanceof Nil)
        && parentRuleset
      ) {
        selector = getImplicitSelectorUtil(selector as Selector, parentRuleset as Ruleset, false);
        this._setSelectorSourceNode(selector, node === this ? selector.clone(true) : selector, context);
      }
      // DO NOT evaluate guard here - guards are evaluated at call time in getFunctionFromMixins
      // Just evaluate the selector
      const ownSelector = node.getOwnSelector(context);
      return pipe(
        () => selector.eval(context),
        (sel) => {
          // If ownSelector has non-static children (e.g. interpolated attr values),
          // evaluate it so extend matching uses the resolved form.
          // Evaluate with collapseNesting=false so Ampersand nodes stay lazy
          // (pointing at their parent container) rather than expanding into
          // :is(parent). The combined selector was already correctly composed
          // by getImplicitSelectorUtil; expanding & here corrupts the relative
          // form and causes getEffectiveSelector to prepend the parent twice.
          if (
            ownSelector
            && !isNode(ownSelector, N.Nil)
            && ownSelector !== selector
            && ownSelector.hasFlag(F_NON_STATIC)
          ) {
            const savedCollapseNesting = context.opts.collapseNesting;
            context.opts.collapseNesting = false;
            return pipe(
              () => ownSelector.eval(context),
              (evaledOwn) => {
                context.opts.collapseNesting = savedCollapseNesting;
                node.setOwnSelector(evaledOwn as Selector, context);
                return sel;
              }
            );
          }
          return sel;
        },
        (sel) => {
          // If this ruleset shares its value with a descendant ruleset, give descendants
          // their own value before we overwrite value.selector so they keep their selector.
          Ruleset.ensureDescendantRulesetsHaveOwnValue(node as Ruleset, {} as any);
          // Store the evaluated selector - this is what will be in the frame
          node._setSelector(sel as Selector | Nil, context);
          if (sel.hoistToRoot) {
            node._setHoistToRoot(true, context);
          }
          // Register to extend root's registry for extend lookups
          const extendRoot = context.extendRoots.getCurrentExtendRoot();
          if (extendRoot) {
            extendRoot.getRegistry('ruleset').add(node as Ruleset);
            // Keep a per-root registry list for visibility processing
            context.extendRoots.registerRuleset(extendRoot, node as Ruleset);
          }
          // Depth-first: preEval child rules immediately so all nested rulesets/extends
          // are registered in source order before we process extends.
          // Push this ruleset to the frame so nested rulesets get the correct parent selector
          // when building implicit selectors (e.g. .header-nav inside .header → .header .header-nav).
          const childRules = node._getRulesContainer(context);
          if (childRules && !(childRules as unknown as Ruleset)._isPreEvaluated(context)) {
            context.rulesetFrames.push(node as Ruleset);
            if (extendRoot) {
              context.extendRoots.registerRoot(childRules, extendRoot);
            }
            const preEvaldRules = childRules.preEval(context);
            if (isThenable(preEvaldRules)) {
              return (preEvaldRules as Promise<Rules>).then((rules) => {
                context.rulesetFrames.pop();
                node._setRulesContainer(rules, context);
                if (extendRoot && rules !== childRules) {
                  context.extendRoots.registerRoot(rules, extendRoot);
                }
                return node;
              });
            }
            context.rulesetFrames.pop();
            node._setRulesContainer(preEvaldRules as Rules, context);
            if (extendRoot && preEvaldRules !== childRules) {
              context.extendRoots.registerRoot(preEvaldRules as Rules, extendRoot);
            }
          }
          return node;
        }
      );
    }
    return this;
  }

  /** Attach an (invisible) ampersand to the selector(s) if it's not already there */
  getImplicitSelector(parentSelector: Selector, collapseNesting = false) {
    const selector = this._getSelector();
    if (selector instanceof Nil) {
      return selector;
    }
    return getImplicitSelectorUtil(selector, parentSelector, collapseNesting);
  }

  override clone(deep?: boolean, cloneFn?: (n: Node) => Node, ctx?: Context): this {
    const cloned = super.clone(deep, cloneFn, ctx) as this;
    if (!deep && ctx?.session) {
      const selector = cloned._getSelector(ctx);
      if (selector instanceof Node) {
        cloned.setData(
          'selector',
          selector.clone(false, undefined, ctx) as Selector | Nil
        );
      }
    }
    if (!deep && ctx?.session && this !== this.sourceNode) {
      const rules = cloned._getRulesContainer(ctx);
      cloned.setData('rules', rules.cloneLookupSafeShallowWrapper(ctx));
    }
    return cloned;
  }

  override copy(deep?: boolean): this {
    const node = super.copy(deep);
    const selectorSource = this.getOwnSelector() ?? this._getSelector();
    node.setData('selector', selectorSource.materializeCopy(true) as Selector | Nil);
    return node;
  }

  override evalNode(context: Context): MaybePromise<Ruleset | Rules | Nil> {
    if (this._isEvaluated(context)) {
      return this;
    }
    let pushedFrames = false;
    /** Should have been maybe cloned in preEval */
    this._setEvaluated(true, context);
    const collapseNesting = context.opts.collapseNesting;

    // Store frames snapshot for collapseNesting serialization
    if (collapseNesting) {
      this.frames = [...context.frames];
    }

    return pipe(
      () => {
        const selectorText = String(this._getSelector(context)?.valueOf?.() ?? '');
        if (
          selectorText.includes('.call-lock-mixin')
          || selectorText.includes('#guarded-caller')
          || selectorText.includes('#guarded-deeper')
        ) {
        }
        let guard = this._getGuard(context);
        // Guard was already set to Nil (failed in a previous eval)
        if (guard instanceof Nil) {
          return guard;
        }
        // Evaluate guard at definition time (not call time like mixins)
        // This is different from mixins because rulesets can't use caller scope for guards
        if (guard) {
          return pipe(
            () => guard.eval(context),
            (guardResult) => {
              const selectorText = String(this._getSelector(context)?.valueOf?.() ?? '');
              const guardPasses = Boolean(guardResult instanceof Bool && guardResult.value === true);
              if (selectorText.includes('#guarded') || selectorText.includes('#top') || selectorText.includes('#deeper')) {
              }
              if (!guardPasses) {
                // Guard failed - mark as Nil and return it
                this._setGuard(new Nil() as Condition | Nil, context);
                return new Nil();
              }
              // Guard passed - clear it and continue with selector evaluation
              this._setGuard(undefined as Condition | Nil | undefined, context);
              return undefined;
            }
          );
        }
        return undefined;
      },
      (guardResult) => {
        // If guard failed, return Nil (ruleset produces no output)
        if (guardResult instanceof Nil) {
          return guardResult;
        }
        let selector = this._getSelector(context);
        const frame = atIndex(context.rulesetFrames, -1);
        if (frame && (this._getHoistToRoot(context) ?? context.opts.collapseNesting)) {
          this._setHoistToRoot(true, context);
        }

        if (selector instanceof Nil) {
          // If selector evaluates to Nil, return the rules body directly instead of the ruleset
          // This allows rules to be output even when there's no selector context
          // We don't push frames because there's no selector context
          // Store Nil in selector so next step can detect this case
          this._setSelector(selector as Selector | Nil, context);
          const evaluatedRules = this._getRulesContainer(context).eval(context);
          // Update this.rules to point to evaluated Rules to prevent circular reference
          // when debug code traverses the AST
          if (isThenable(evaluatedRules)) {
            return (evaluatedRules as Promise<Rules>).then((rules) => {
              this._setRulesContainer(rules, context);
              return rules;
            });
          }
          this._setRulesContainer(evaluatedRules as Rules, context);
          return evaluatedRules;
        }
        // Preserve the sourceNode from the current selector before replacing it
        const preservedSourceNode = this._getSelectorSourceNode(this._getSelector(context), context);
        this._setSelector(selector as Selector | Nil, context);
        // Restore the sourceNode on the new selector so it's available when copying
        if (preservedSourceNode && this._getSelector(context)) {
          this._setSelectorSourceNode(this._getSelector(context), preservedSourceNode, context);
        }
        if (context.opts.collapseNesting) {
          this._setHoistToRoot(true, context);
        }
        context.rulesetFrames.push(this as Ruleset);
        context.frames.push(this);
        pushedFrames = true;
        return this._getRulesContainer(context).eval(context);
      },
      (evaluatedRules: Rules | Nil) => {
        if (pushedFrames) {
          context.rulesetFrames.pop();
          context.frames.pop();
        }
        if (evaluatedRules instanceof Nil) {
          return evaluatedRules;
        }
        const selectorText = String(this._getSelector(context)?.valueOf?.() ?? '');
        if (
          selectorText.includes('.call-lock-mixin')
          || selectorText.includes('#guarded-caller')
          || selectorText.includes('#guarded-deeper')
        ) {
        }

        // If selector was Nil, evaluatedRules is already Rules (not wrapped in Ruleset)
        // In that case, return it directly without wrapping back in Ruleset
        if (this._getSelector(context) instanceof Nil) {
          // Selector was Nil, so we already returned Rules directly - just return it
          return evaluatedRules;
        }

        this._setRulesContainer(evaluatedRules as Rules, context);
        const rules = this._getRulesContainer(context);
        if (rules.visibleRules(context).length === 0) {
          this._removeFlag(F_VISIBLE, context);
        }
        return this;
      }
    );
  }

  /** @todo move to ToCssVisitor */
  // toCSS(context: Context, out: OutputCollector) {
  //   const { sels, value } = this
  //   context.inSelector = true
  //   sels.toCSS(context, out)
  //   context.inSelector = false
  //   out.add(' ')
  //   value.toCSS(context, out)
  // }

  /** @todo Move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.rule({\n', this.location)
  //   context.indent++
  //   const pre = context.pre
  //   out.add(`${pre}sels: `)
  //   this.sels.toModule(context, out)
  //   out.add(`,\n${pre}value: `)
  //   this.data.toModule(context, out)
  //   context.indent--
  //   out.add(`},${JSON.stringify(this.location)})`)
  // }
}

type RulesetParams = ConstructorParameters<typeof Ruleset>;

export const ruleset = defineType<RulesetValue>(Ruleset, 'Ruleset') as (
  value: RulesetValue | RulesetParams[0],
  options?: RulesetParams[1],
  location?: RulesetParams[2],
  treeContext?: RulesetParams[3]
) => Ruleset;
