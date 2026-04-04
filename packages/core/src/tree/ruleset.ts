import {
  CALLER,
  CANONICAL,
  Node,
  F_VISIBLE,
  F_EXTENDED,
  F_EXTEND_TARGET,
  F_IMPLICIT_AMPERSAND,
  F_NON_STATIC,
  defineType,
  type NodeOptions,
  type OptionalLocation,
  type RenderKey,
  type NodeEdge
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
import { ComplexSelector, type ComplexSelectorComponent } from './selector-complex.js';
import { SelectorList } from './selector-list.js';
import { type PrintOptions, type FinalPrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, pipe, isThenable } from '@jesscss/awaitable-pipe';
import type { AtRule } from './at-rule.js';
import { serializeRulesContainer, normalizeIndent, indent } from './util/serialize-helper.js';
import { getCurrentParentNode, getImplicitSelector as getImplicitSelectorUtil, getParentRuleset, hasExtendedSelector, hasSourceExtendWrapperParent, selectorHasAuthoredAmpersand } from './util/selector-utils.js';
import { addEdge } from './util/cursor.js';
import { processLeadingIs } from './util/process-leading-is.js';

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

export type RulesetChildData = {
  selector: Selector | Nil;
  rules: Rules;
  guard: Condition | Nil | undefined;
  selectorBeforeExtend: Selector | Nil | undefined;
  /** Patched selector from extend — used by serialization instead of canonical selector. */
  _extendedSelector: Selector | Nil | undefined;
  frames: (Ruleset | AtRule)[] | undefined;
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
export interface Ruleset {
  type: 'Ruleset';
  shortType: 'ruleset';
}

export class Ruleset<T = RulesetValue> extends Node<NarrowRulesetValue<T>, RulesetOptions, RulesetChildData> {
  static override childKeys = ['selector', 'rules', 'guard', 'selectorBeforeExtend'] as const;

  // Ruleset has preEval method but doesn't need to set flags - preEvaluated is tracked as boolean
  private frames: (Ruleset | AtRule)[] | undefined;

  selector!: Selector | Nil;
  declare selectorEdge: NodeEdge<Selector | Nil> | undefined;
  rules!: Rules;
  declare rulesEdge: NodeEdge<Rules> | undefined;
  guard: Condition | Nil | undefined;
  declare guardEdge: NodeEdge<Condition | Nil | undefined> | undefined;
  selectorBeforeExtend: Selector | Nil | undefined;
  declare selectorBeforeExtendEdge: NodeEdge<Selector | Nil | undefined> | undefined;
  /** Patched selector from extend — used by serialization instead of canonical selector. */
  private _extendedSelector: Selector | Nil | undefined;
  declare _extendedSelectorEdge: NodeEdge<Selector | Nil | undefined> | undefined;

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
      rules._setValueArray(normalized);
      for (const child of normalized) {
        rules.adopt(child);
      }
    }
  }

  isHoisted(options: PrintOptions) {
    return this.hoistToRoot ?? options.collapseNesting ?? false;
  }

  protected _valueOf: string | undefined;

  private _resolveRenderKey(context?: Context): RenderKey {
    return context?.renderKey ?? context?.rulesContext?.renderKey ?? this.renderKey;
  }

  getOwnSelector(): Selector | Nil | undefined {
    return this.options.ownSelector;
  }

  setOwnSelector(selector: Selector | Nil | undefined): void {
    this.options = {
      ...this.options,
      ownSelector: selector
    };
  }

  getSelector(renderKey?: RenderKey): Selector | Nil {
    return renderKey !== undefined
      ? this.selectorEdge?.get(renderKey) ?? this.selector
      : this.selector;
  }

  private _getSelectorSourceNode(selector: Selector | Nil | undefined): Node | undefined {
    if (!(selector instanceof Node)) {
      return undefined;
    }
    return selector.sourceNode;
  }

  /**
   * Transitional edge/cursor seam: enter the render-owned Rules container for
   * this ruleset. This is intentionally explicit because it may wrap/adopt.
   */
  enterRules(context?: Context): Rules {
    const renderKey = this._resolveRenderKey(context);
    const rules = this.getRules(renderKey);
    if (
      renderKey !== undefined
      && renderKey !== CANONICAL
      && rules === this.rules
      && this.rules.renderKey !== CANONICAL
      && this.rules.renderKey !== renderKey
    ) {
      const wrappedRules = this.rules.createShallowBodyWrapper(undefined, renderKey);
      addEdge(this, 'rules', renderKey, wrappedRules);
      if (context && getCurrentParentNode(wrappedRules, { ...context, renderKey }) !== this) {
        this.adopt(wrappedRules, { ...context, renderKey });
      }
      return wrappedRules;
    }
    if (rules !== this.rules) {
      if (context && getCurrentParentNode(rules, context) !== this) {
        this.adopt(rules, context);
      }
      return rules;
    }
    return rules.withRenderOwner(this, renderKey, context);
  }

  getRules(renderKey?: RenderKey): Rules {
    return renderKey !== undefined
      ? this.rulesEdge?.get(renderKey) ?? this.rules
      : this.rules;
  }

  private _assignRules(rules: Rules, context: Context): void {
    const renderKey = this._resolveRenderKey(context);
    if (renderKey !== undefined && renderKey !== CANONICAL) {
      this.rulesEdge?.delete(renderKey);
      if (this.rulesEdge?.size === 0) {
        this.rulesEdge = undefined;
      }
    }
    this.rules = rules;
    this.adopt(rules, context);
  }

  getGuard(renderKey?: RenderKey): Condition | Nil | undefined {
    return renderKey !== undefined
      ? this.guardEdge?.get(renderKey) ?? this.guard
      : this.guard;
  }

  getSelectorBeforeExtend(renderKey?: RenderKey): Selector | Nil | undefined {
    return renderKey !== undefined
      ? this.selectorBeforeExtendEdge?.get(renderKey) ?? this.selectorBeforeExtend
      : this.selectorBeforeExtend;
  }

  setSelectorBeforeExtend(selector: Selector | Nil | undefined, context: Context): void {
    const renderKey = this._resolveRenderKey(context);
    if (renderKey === undefined || renderKey === CANONICAL) {
      this.selectorBeforeExtend = selector;
      return;
    }
    if (selector instanceof Node) {
      this.adopt(selector, { ...context, renderKey });
    }
    addEdge(this, 'selectorBeforeExtend', renderKey, selector as Selector | Nil);
  }

  getExtendedSelector(renderKey?: RenderKey): Selector | Nil | undefined {
    return renderKey !== undefined
      ? this._extendedSelectorEdge?.get(renderKey) ?? this._extendedSelector
      : this._extendedSelector;
  }

  setExtendedSelector(selector: Selector | Nil | undefined, context?: Context): void {
    const renderKey = context ? this._resolveRenderKey(context) : undefined;
    if (renderKey === undefined || renderKey === CANONICAL) {
      this._extendedSelector = selector;
      this.invalidateSelectorValueCache();
      return;
    }
    if (selector instanceof Node) {
      this.adopt(selector, { ...context, renderKey });
    }
    addEdge(this, '_extendedSelector', renderKey, selector as Selector | Nil);
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
    const ownSelector = this.getOwnSelector();
    if (
      !hasSourceExtendWrapperParent(this)
      && !this.hoistToRoot
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
    const seen = new Set<Node>();
    const pending: Node[] = [];
    const enqueue = (node: Node | undefined) => {
      if (!node || seen.has(node)) {
        return;
      }
      seen.add(node);
      pending.push(node);
    };

    enqueue(getCurrentParentNode(this, context));
    enqueue(this.parent);
    for (const parent of this.parentEdges?.values?.() ?? []) {
      enqueue(parent);
    }

    while (pending.length > 0) {
      const current = pending.shift()!;
      if (isNode(current, N.Ruleset)) {
        return true;
      }
      enqueue(getCurrentParentNode(current, context));
      enqueue(current.parent);
      for (const parent of current.parentEdges?.values?.() ?? []) {
        enqueue(parent);
      }
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
    const renderKey = this._resolveRenderKey(context);
    const extendedSelector = this.getExtendedSelector(renderKey);
    const selector = (extendedSelector ?? this.getSelector(renderKey)) as Selector | Nil;
    if (!selector || selector instanceof Nil) {
      return selector;
    }

    const ownSelector = this.getOwnSelector();
    const parentRs = getParentRuleset(this, context);
    if (
      collapseNesting
      && this.hoistToRoot
      && ownSelector
      && !(ownSelector instanceof Nil)
      && isNode(ownSelector as Selector, N.SelectorList)
      && isNode(selector as Selector, N.SelectorList)
      && ownSelector.valueOf() !== selector.valueOf()
    ) {
      return selector;
    }
    if (
      collapseNesting
      && this.hoistToRoot
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
        const parentOwn = parentRs.getOwnSelector();
        if (
          parentOwn
          && !(parentOwn instanceof Nil)
          && Ruleset.isBareAmpersandSelector(parentOwn)
          && parentRs.getSelector(parentRs._resolveRenderKey(context))
          && !(parentRs.getSelector(parentRs._resolveRenderKey(context)) instanceof Nil)
          && !Ruleset.isBareAmpersandSelector(parentRs.getSelector(parentRs._resolveRenderKey(context)))
        ) {
          return parentRs.getSelector(parentRs._resolveRenderKey(context));
        }
      }
      return parentSelector;
    };
    const getComposedParentSelector = (): Selector | Nil | undefined => {
      let parentSelector = normalizeParentSelector(parentRs?.getEffectiveSelector(collapseNesting, context));
      if (
        parentSelector
        && !(parentSelector instanceof Nil)
        && parentRs?.getSelectorBeforeExtend(parentRs._resolveRenderKey(context))
        && Ruleset.hasReferenceBoundaryParent(parentRs, context)
      ) {
        parentSelector = Ruleset.filterReferenceVisibleSelectorItems(
          parentSelector as Selector,
          parentRs.getSelectorBeforeExtend(parentRs._resolveRenderKey(context))
        );
      }
      return parentSelector;
    };
    const parentSelector = getComposedParentSelector();
    if (
      this.hoistToRoot
      && extendedSelector
      && !(extendedSelector instanceof Nil)
      && ownSelector
      && !(ownSelector instanceof Nil)
      && selectorHasAuthoredAmpersand(ownSelector as Selector)
    ) {
      return selector;
    }
    if (
      ownSelector
      && !(ownSelector instanceof Nil)
      && parentSelector
      && !(parentSelector instanceof Nil)
      && ownSelector.valueOf() !== selector.valueOf()
    ) {
      return getImplicitSelectorUtil(ownSelector as Selector, parentSelector as Selector, collapseNesting);
    }

    if (this.hoistToRoot) {
      return selector;
    }

    return selector;
  }

  /** Used for equality comparison with other rulesets */
  override valueOf(context?: Context) {
    if (context) {
      const collapseNesting = context.opts.collapseNesting ?? this.treeContext?.opts?.collapseNesting ?? false;
      const renderKey = this._resolveRenderKey(context);
      const selector = (
        this.getExtendedSelector(renderKey)
        || this.hoistToRoot
        || collapseNesting === true
      )
        ? this.getEffectiveSelector(collapseNesting, context)
        : this.getSelector(renderKey);
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
      && this.hoistToRoot
    ) {
      const ownSelector = this.getOwnSelector();
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
      for (const item of list.get('value')) {
        Ruleset.ensureSelectorVisible(item);
      }
      return;
    }
    if (isNode(sel, N.ComplexSelector)) {
      const comps = (sel as ComplexSelector).get('value');
      for (const c of comps) {
        Ruleset.ensureSelectorVisible(c as Selector);
      }
      return;
    }
    const v = 'value' in sel ? sel.value : undefined;
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
        return SelectorList.create(list.get('value').map(item => materialize(item as Selector))).inherit(node) as Selector;
      }
      if (isNode(node, N.ComplexSelector)) {
        const complex = node as ComplexSelector;
        const parts: ComplexSelectorComponent[] = [];
        for (const part of complex.get('value')) {
          if (isNode(part, N.Ampersand)) {
            const amp = part as Ampersand;
            const n = amp as unknown as Node;
            if (n.hasFlag(F_IMPLICIT_AMPERSAND)) {
              const resolved = amp.getResolvedSelector();
              if (resolved && !(resolved instanceof Nil)) {
                const repl = materialize(resolved as Selector);
                if (isNode(repl, N.ComplexSelector)) {
                  parts.push(...(repl as ComplexSelector).get('value') as ComplexSelectorComponent[]);
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
      const arr = 'value' in node ? node.value : undefined;
      if (Array.isArray(arr)) {
        const cloned = node.copy(true) as Selector & { value?: Selector[] };
        cloned.value = arr.map(item => materialize(item as Selector));
        return cloned as Selector;
      }
      return node;
    };
    const materialized = materialize(sel as Selector);
    return processLeadingIs(materialized) as Selector;
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
      return (sel as SelectorList).get('value').every(
        item => isNode(item, N.Ampersand) && (item as Ampersand).isPlainAmpersand()
      );
    }
    return false;
  }

  private static hasReferenceBoundaryParent(node: Node, context?: Context): boolean {
    const parent = getCurrentParentNode(node, context);
    return Boolean(
      parent
      && isNode(parent, N.Rules)
      && (parent as Rules).options?.referenceMode === true
    );
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
    for (const item of (sel as SelectorList).get('value')) {
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

  private static filterExtendedTopLevelSelectorItems(sel: Selector, context?: Context): Selector | Nil {
    return Ruleset.filterSelectorItems(sel, item =>
      (context ? item._hasFlag(F_EXTENDED, context) : item.hasFlag(F_EXTENDED))
      && !(context ? item._hasFlag(F_EXTEND_TARGET, context) : item.hasFlag(F_EXTEND_TARGET))
    );
  }

  private static filterReferenceVisibleSelectorItems(
    current: Selector,
    original?: Selector | Nil,
    context?: Context
  ): Selector | Nil {
    if (!original || original instanceof Nil) {
      return Ruleset.filterExtendedTopLevelSelectorItems(current, context);
    }
    const originalValues = new Set<string>();
    if (isNode(original, N.SelectorList)) {
      for (const item of (original as SelectorList).get('value')) {
        originalValues.add(item.valueOf());
      }
    } else {
      originalValues.add(original.valueOf());
    }
    const changedItems = Ruleset.filterSelectorItems(current, item =>
      !originalValues.has(item.valueOf())
    );
    if (!(changedItems instanceof Nil)) {
      return changedItems;
    }
    return Ruleset.filterSelectorItems(current, item =>
      (context ? item._hasFlag(F_EXTENDED, context) : item.hasFlag(F_EXTENDED))
      && !(context ? item._hasFlag(F_EXTEND_TARGET, context) : item.hasFlag(F_EXTEND_TARGET))
    );
  }

  getHeaderString(options: FinalPrintOptions, withoutComments?: boolean): string {
    const w = options.writer;
    const renderKey = this.renderKey !== CANONICAL
      ? this.renderKey
      : this._resolveRenderKey(options.context);
    const selector = this.getRenderableSelector(
      options.collapseNesting,
      options.context ? { ...options.context, renderKey } : options.context
    );
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
    const ownSelector = this.getOwnSelector();
    const currentSelector = this.getSelector(renderKey);
    if (
      this.hoistToRoot
      && Ruleset.isBareAmpersandSelector(renderSelector)
      && ownSelector
      && !(ownSelector instanceof Nil)
      && Ruleset.isBareAmpersandSelector(ownSelector)
      && !Ruleset.isBareAmpersandSelector(currentSelector)
    ) {
      renderSelector = currentSelector;
    }
    if (this.hoistToRoot && options.depth === 0 && !(renderSelector instanceof Nil)) {
      renderSelector = Ruleset.materializeHoistedImplicitAmpersands(renderSelector as Selector) as typeof selector;
    }
    if (
      options.referenceMode === true
      && options.referenceRenderEnabled === true
      && !(renderSelector instanceof Nil)
    ) {
      const filteredReferenceSelector = Ruleset.filterReferenceVisibleSelectorItems(
        renderSelector as Selector,
        this.getSelectorBeforeExtend(renderKey),
        options.context
      ) as typeof renderSelector;
      const rulesetExtended = options.context
        ? this._hasFlag(F_EXTENDED, options.context)
        : this.hasFlag(F_EXTENDED);
      if (!(filteredReferenceSelector instanceof Nil)) {
        renderSelector = filteredReferenceSelector;
      } else if (!rulesetExtended) {
        return '';
      }
    }
    const prevReferenceFilterTargets = options.referenceFilterTargets === true;
    const disableTargetFilteringForTopLevelList = (
      (options.context ? this._hasFlag(F_EXTENDED, options.context) : this.hasFlag(F_EXTENDED))
      && !(renderSelector instanceof Nil)
      && isNode(renderSelector as Selector, N.SelectorList)
    );
    options.referenceFilterTargets = (
      options.referenceMode === true
      && options.referenceRenderEnabled === true
      && !disableTargetFilteringForTopLevelList
    );
    Ruleset.ensureSelectorVisible(renderSelector);
    const ctx = options.context;
    const previousRenderKey = ctx?.renderKey;
    if (ctx && renderKey !== undefined) {
      ctx.renderKey = renderKey;
    }
    const selOut = w.capture(() => renderSelector.toString(options));
    if (ctx) {
      ctx.renderKey = previousRenderKey;
    }
    options.referenceFilterTargets = prevReferenceFilterTargets;
    return normalizeIndent(selOut.replace(/\s+$/, '') + ' {', idt) + '\n';
  }

  override preEval(context: Context): MaybePromise<this> {
    if (!this.preEvaluated) {
      const node = this.clone(false, undefined, context);
      node.preEvaluated = true;
      const renderKey = node._resolveRenderKey(context);
      const selectorText = String(this.getSelector(renderKey)?.valueOf?.() ?? '');
      if (process.env.JESS_DEBUG_LOCK === 'throw-pre-ruleset' && selectorText.includes('.call-inner-lock-mixin')) {
        throw new Error(`[lock-pre-ruleset] ${JSON.stringify({
          selectorText,
          parent: this.parent?.type,
          sourceParent: this.sourceParent?.type,
          renderKey: String(renderKey)
        })}`);
      }
      // Index should already be assigned by parent Rules
      node.sourceNode ??= this;
      const rulesetOptions = node.options;
      let rules = node.enterRules(context);
      // On re-eval (e.g. mixin clone), use the pre-composition ownSelector so we
      // compose from the authored selector, not the already-composed one.
      let selector: Selector | Nil = rulesetOptions.ownSelector ?? node.getSelector(renderKey);
      // Generated wrapper rulesets (e.g. implicit `& { ... }` created by AtRule hoisting)
      // should not force var visibility to `private`, otherwise sibling vars inside the wrapper
      // (like Less `@base`) become inaccessible.
      if (!rulesetOptions.generated) {
        if (rules.renderKey === CANONICAL) {
          const wrappedRules = rules.createShallowBodyWrapper(context);
          node.rules = wrappedRules;
          node.adopt(wrappedRules, context);
          rules = wrappedRules;
        }
        const nextRulesOptions = {
          ...rules.options,
          rulesVisibility: {
            ...rules.options.rulesVisibility
          }
        };
        if (context.leakyRules) {
          nextRulesOptions.rulesVisibility.Mixin = 'public';
          nextRulesOptions.rulesVisibility.VarDeclaration = 'optional';
        } else {
          nextRulesOptions.rulesVisibility.Mixin = 'private';
          nextRulesOptions.rulesVisibility.VarDeclaration = 'private';
        }
        rules.options = nextRulesOptions;
      }
      const parentRuleset = context.rulesetFrames.at(-1);
      const parentSelector = parentRuleset?.getSelector(parentRuleset._resolveRenderKey(context));
      // Store own selector before parent resolution so extend can extend .replace,.c not the resolved form.
      node.setOwnSelector(selector);
      if (
        !node.options.resolvedHoistWrapper
        && parentSelector
        && !(parentSelector instanceof Nil)
        && !(selector instanceof Nil)
        && parentRuleset
      ) {
        const collapseForComposition = Boolean(
          context.opts.collapseNesting
          && !selectorHasAuthoredAmpersand(selector as Selector)
        );
        selector = getImplicitSelectorUtil(
          selector as Selector,
          parentSelector as Selector,
          collapseForComposition
        );
        {
          const selectorSourceNode = node === this
            ? selector.clone(false, undefined, context)
            : selector;
          if (selector instanceof Node) {
            selector.sourceNode = selectorSourceNode;
          }
        }
      }
      // DO NOT evaluate guard here - guards are evaluated at call time in getFunctionFromMixins
      // Just evaluate the selector
      const ownSelector = node.getOwnSelector();
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
          ) {
            const savedCollapseNesting = context.opts.collapseNesting;
            context.opts.collapseNesting = false;
            return pipe(
              () => ownSelector.eval(context),
              (evaledOwn) => {
                context.opts.collapseNesting = savedCollapseNesting;
                node.setOwnSelector(evaledOwn as Selector);
                return sel;
              }
            );
          }
          return sel;
        },
        (sel) => {
          if (isNode(sel as Node, N.Selector)) {
            sel = processLeadingIs(sel as Selector) as Selector | Nil;
          }
          // If this ruleset shares its value with a descendant ruleset, give descendants
          // their own value before we overwrite value.selector so they keep their selector.
          Ruleset.ensureDescendantRulesetsHaveOwnValue(node as Ruleset, {} as RulesetValue);
          // Store the evaluated selector - this is what will be in the frame
          node.selector = sel as Selector | Nil;
          if (sel instanceof Node) {
            node.adopt(sel, context);
          }
          if (sel.hoistToRoot) {
            node.hoistToRoot = true;
          }
          // Register to extend root's registry for extend lookups
          const extendRoot = context.extendRoots.getCurrentExtendRoot();
          if (extendRoot) {
            extendRoot.register('ruleset', node as Ruleset);
            // Keep a per-root registry list for visibility processing
            context.extendRoots.registerRuleset(extendRoot, node as Ruleset);
          }
          // Depth-first: preEval child rules immediately so all nested rulesets/extends
          // are registered in source order before we process extends.
          // Push this ruleset to the frame so nested rulesets get the correct parent selector
          // when building implicit selectors (e.g. .header-nav inside .header → .header .header-nav).
          const childRules = node.enterRules(context);
          if (childRules && !(childRules as unknown as Ruleset).preEvaluated) {
            context.rulesetFrames.push(node as Ruleset);
            if (extendRoot) {
              context.extendRoots.registerRoot(childRules, extendRoot);
            }
            const preEvaldRules = childRules.preEval(context);
            if (isThenable(preEvaldRules)) {
              return (preEvaldRules as Promise<Rules>).then((rules) => {
                context.rulesetFrames.pop();
                node.rules = rules;
                node.adopt(rules, context);
                if (extendRoot && rules !== childRules) {
                  context.extendRoots.registerRoot(rules, extendRoot);
                }
                return node;
              });
            }
            context.rulesetFrames.pop();
            node._assignRules(preEvaldRules as Rules, context);
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
    const selector = this.get('selector');
    if (selector instanceof Nil) {
      return selector;
    }
    return getImplicitSelectorUtil(selector, parentSelector, collapseNesting);
  }

  override clone(deep?: boolean, cloneFn?: (n: Node) => Node, ctx?: Context): this {
    const priorSelectorParent = !deep && this.selector instanceof Node
      ? this.selector.parent
      : undefined;
    const priorRulesParent = !deep && this.rules instanceof Node
      ? this.rules.parent
      : undefined;
    const cloned = super.clone(deep, cloneFn, ctx) as this;
    if (!deep) {
      if (this.selector instanceof Node) {
        (this.selector as unknown as { parent?: Node }).parent = priorSelectorParent;
      }
      if (this.rules instanceof Node) {
        (this.rules as unknown as { parent?: Node }).parent = priorRulesParent;
      }
      const renderKey = ctx ? cloned._resolveRenderKey(ctx) : this.renderKey;
      const selector = cloned.getSelector(renderKey);
      if (selector instanceof Node) {
        if (ctx || this !== this.sourceNode) {
          cloned.selector = selector.clone(false, undefined, ctx) as Selector | Nil;
          cloned.adopt(cloned.selector, ctx);
        }
      }
      const currentRules = this.getRules(renderKey);
      if (ctx && currentRules !== this.rules) {
        cloned.rules = currentRules;
        cloned.adopt(currentRules, ctx);
      }
      if (this !== this.sourceNode && cloned.rules === this.rules) {
        const rules = ctx ? cloned.enterRules(ctx) : cloned.rules;
        cloned.rules = rules.createShallowBodyWrapper(ctx);
        cloned.adopt(cloned.rules, ctx);
      }
    }
    if (!deep && ctx && this !== this.sourceNode && cloned.rules !== this.rules && cloned.rules.parent !== cloned) {
      cloned.adopt(cloned.rules, ctx);
    }
    return cloned;
  }

  override copy(deep?: boolean): this {
    const node = super.copy(deep);
    const selectorSource = this.getOwnSelector() ?? this.selector;
    node.selector = selectorSource.sourceNode.copy(true) as Selector | Nil;
    node.adopt(node.selector);
    return node;
  }

  override evalNode(context: Context): MaybePromise<Ruleset | Rules | Nil> {
    if (this.evaluated) {
      return this;
    }
    let pushedFrames = false;
    const renderKey = this._resolveRenderKey(context);
    const previousRenderKey = context.renderKey;
    if (renderKey !== undefined && renderKey !== CANONICAL) {
      context.renderKey = renderKey;
    }
    /** Should have been maybe cloned in preEval */
    this.evaluated = true;
    const collapseNesting = context.opts.collapseNesting;

    // Store frames snapshot for collapseNesting serialization
    if (collapseNesting) {
      this.frames = [...context.frames];
    }

    const out = pipe(
      () => {
        const selectorText = String(this.getSelector(renderKey)?.valueOf?.() ?? '');
        if (process.env.JESS_DEBUG_LOCK === 'throw-ruleset' && selectorText.includes('.call-inner-lock-mixin')) {
          throw new Error(`[lock-ruleset] ${JSON.stringify({
            selectorText,
            parent: this.parent?.type,
            sourceParent: this.sourceParent?.type,
            renderKey: String(renderKey),
            childCount: this.enterRules(context).get('value', context).length
          })}`);
        }
        if (
          selectorText.includes('.call-lock-mixin')
          || selectorText.includes('#guarded-caller')
          || selectorText.includes('#guarded-deeper')
        ) {
        }
        let guard = this.getGuard(renderKey);
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
              const selectorText = String(this.getSelector(renderKey)?.valueOf?.() ?? '');
              const guardPasses = Boolean(guardResult instanceof Bool && guardResult.value === true);
              if (selectorText.includes('#guarded') || selectorText.includes('#top') || selectorText.includes('#deeper')) {
              }
              if (!guardPasses) {
                // Guard failed - mark as Nil and return it
                this.guard = new Nil() as Condition | Nil;
                return new Nil();
              }
              // Guard passed - clear it and continue with selector evaluation
              this.guard = undefined as Condition | Nil | undefined;
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
        let selector = this.getSelector(renderKey);
        const frame = atIndex(context.rulesetFrames, -1);
        if (frame && (this.hoistToRoot ?? context.opts.collapseNesting)) {
          this.hoistToRoot = true;
        }

        if (selector instanceof Nil) {
          // If selector evaluates to Nil, return the rules body directly instead of the ruleset
          // This allows rules to be output even when there's no selector context
          // We don't push frames because there's no selector context
          // Store Nil in selector so next step can detect this case
          this.selector = selector as Selector | Nil;
          const evaluatedRules = this.enterRules(context).eval(context);
          // Update this.rules to point to evaluated Rules to prevent circular reference
          // when debug code traverses the AST
          if (isThenable(evaluatedRules)) {
            return (evaluatedRules as Promise<Rules>).then((rules) => {
              this._assignRules(rules, context);
              return rules;
            });
          }
          this._assignRules(evaluatedRules as Rules, context);
          return evaluatedRules;
        }
        // Preserve the sourceNode from the current selector before replacing it
        const preservedSourceNode = this._getSelectorSourceNode(this.getSelector(renderKey));
        this.selector = selector as Selector | Nil;
        this.adopt(this.selector, context);
        // Restore the sourceNode on the new selector so it's available when copying
        const currentSelector = this.getSelector(renderKey);
        if (preservedSourceNode && currentSelector) {
          {
            const selectorForSourceNode = currentSelector;
            if (selectorForSourceNode instanceof Node && preservedSourceNode) {
              selectorForSourceNode.sourceNode = preservedSourceNode;
            }
          }
        }
        if (context.opts.collapseNesting) {
          this.hoistToRoot = true;
        }
        context.rulesetFrames.push(this as Ruleset);
        context.frames.push(this);
        pushedFrames = true;
        return this.enterRules(context).eval(context);
      },
      (evaluatedRules: Rules | Nil) => {
        if (pushedFrames) {
          context.rulesetFrames.pop();
          context.frames.pop();
        }
        if (evaluatedRules instanceof Nil) {
          return evaluatedRules;
        }

        // If selector was Nil, evaluatedRules is already Rules (not wrapped in Ruleset)
        // In that case, return it directly without wrapping back in Ruleset
        if (this.getSelector(renderKey) instanceof Nil) {
          // Selector was Nil, so we already returned Rules directly - just return it
          return evaluatedRules;
        }

        this._assignRules(evaluatedRules as Rules, context);
        const rules = this.enterRules(context);
        if (rules.visibleRules(context).length === 0) {
          this._removeFlag(F_VISIBLE, context);
        }
        return this;
      }
    );

    if (isThenable(out)) {
      return (out as Promise<Ruleset | Rules | Nil>).then(
        (result) => {
          context.renderKey = previousRenderKey;
          return result;
        },
        (error) => {
          context.renderKey = previousRenderKey;
          throw error;
        }
      );
    }
    context.renderKey = previousRenderKey;
    return out;
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
