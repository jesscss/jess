import { Node, F_VISIBLE, F_AMPERSAND, F_EXTENDED, F_EXTEND_TARGET, F_IMPLICIT_AMPERSAND, F_NON_STATIC, defineType, type NodeOptions } from './node.js';
import { Rules } from './rules.js';
import type { Context, TreeContext } from '../context.js';
import { type LocationInfo } from './node.js';
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
import { processLeadingIs } from './util/process-leading-is.js';
import { ensureRulesetTraceId, getOptionalRulesetTraceId } from './util/ruleset-trace.js';

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

  constructor(value: NarrowRulesetValue<T>, options?: RulesetOptions, location?: LocationInfo, treeContext?: TreeContext) {
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

  isHoisted(options: PrintOptions) {
    return this.hoistToRoot ?? options.collapseNesting ?? false;
  }

  protected _valueOf: string | undefined;

  /**
   * Returns the selector shape that should be printed for this ruleset.
   *
   * Nested rulesets keep rendering their local selector shape unless they are
   * being serialized from root (`hoistToRoot`) or collapse nesting is enabled.
   * In those cases, the selector must be recomposed against its parent.
   */
  getRenderableSelector(collapseNesting = this.treeContext?.opts?.collapseNesting ?? false): Selector | Nil {
    const ownSelector = (this.options as RulesetOptions | undefined)?.ownSelector;
    const parentRs = getParentRuleset(this);
    if (
      !this.hoistToRoot
      && !collapseNesting
      && parentRs
      && ownSelector
      && !(ownSelector instanceof Nil)
    ) {
      return ownSelector as Selector;
    }

    return this.getEffectiveSelector(collapseNesting);
  }

  /**
   * Returns the selector that should be used for matching/rendering right now.
   *
   * For nested rulesets that keep a local `ownSelector`, this recomposes the
   * selector against the current parent selector on demand instead of requiring
   * eager mutation of `data.selector` after extends. Hoisted rulesets keep their
   * concrete selector unchanged because they already serialize from root.
   */
  getEffectiveSelector(collapseNesting = this.treeContext?.opts?.collapseNesting ?? false): Selector | Nil {
    const selector = this.selector;
    if (!selector || selector instanceof Nil) {
      return selector;
    }

    const ownSelector = (this.options as RulesetOptions | undefined)?.ownSelector;
    const parentRs = getParentRuleset(this);
    if (
      collapseNesting
      && this.hoistToRoot
      && !this.selectorBeforeExtend
      && ownSelector
      && !(ownSelector instanceof Nil)
      && ownSelector.valueOf() !== selector.valueOf()
    ) {
      let parentSelector = parentRs?.getEffectiveSelector(collapseNesting);
      if (parentSelector && !(parentSelector instanceof Nil)) {
        if (parentRs!.selectorBeforeExtend && Ruleset.isInReferenceScope(parentRs!)) {
          parentSelector = Ruleset.filterReferenceVisibleSelectorItems(
            parentSelector as Selector,
            parentRs!.selectorBeforeExtend
          );
        }
        if (parentSelector && !(parentSelector instanceof Nil)) {
          return getImplicitSelectorUtil(ownSelector as Selector, parentSelector as Selector, false);
        }
      }
    }

    if (this.hoistToRoot) {
      return selector;
    }

    const parentSelector = parentRs?.getEffectiveSelector(collapseNesting);
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
  override valueOf() {
    if (this._valueOf !== undefined) {
      return this._valueOf;
    }
    const selector = (
      this.hoistToRoot || this.treeContext?.opts?.collapseNesting === true
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
      const ownSelector = (this.options as RulesetOptions | undefined)?.ownSelector;
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
            return (resolved.copy(true) as Selector);
          }
        }
        return node.copy(true) as Selector;
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
                  parts.push(...(repl as ComplexSelector).value.map(c => c.copy(true) as ComplexSelectorComponent));
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
      return node.copy(true) as Selector;
    };
    return materialize(sel as Selector);
  }

  private static isBareAmpersandSelector(sel: Selector | Nil): boolean {
    if (!sel || sel instanceof Nil) {
      return false;
    }
    if (isNode(sel, N.Ampersand)) {
      return true;
    }
    if (isNode(sel, N.SelectorList)) {
      return (sel as SelectorList).value.every(item => isNode(item, N.Ampersand));
    }
    return false;
  }

  private static isInReferenceScope(node: Node): boolean {
    let current: Node | undefined = node;
    while (current) {
      if (isNode(current, N.Rules) && (current as Rules).options?.referenceMode === true) {
        return true;
      }
      current = current.parent as Node | undefined;
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
      kept.push(item.copy(true) as Selector);
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
    const selector = this.getRenderableSelector(options.collapseNesting);
    const idt = indent(options.depth);

    // Should never be called for Nil selectors (serializeRulesContainer guards this),
    // but keep it safe for TypeScript and invariants.
    if (selector instanceof Nil) {
      return '';
    }
    if (withoutComments) {
      options = { ...options, suppressComments: true };
    }
    let renderSelector = selector;
    if (this.hoistToRoot && options.depth === 0 && !(renderSelector instanceof Nil)) {
      renderSelector = Ruleset.materializeHoistedImplicitAmpersands(renderSelector as Selector) as typeof selector;
    }
    // Unwrap leading generated :is() for rendering (e.g. :is(* b)[e] → * b[e]).
    // TODO: move this logic to PseudoSelector.toTrimmedString or composition.
    const renderNormalizedResult = processLeadingIs(renderSelector as Selector);
    renderSelector = Array.isArray(renderNormalizedResult)
      ? SelectorList.create(renderNormalizedResult as Selector[]).inherit(renderSelector as Selector) as typeof selector
      : renderNormalizedResult as typeof selector;
    if (
      options.referenceMode === true
      && options.referenceRenderEnabled === true
      && !(renderSelector instanceof Nil)
      && Ruleset.hasExtendedTopLevelSelector(renderSelector as Selector | Nil)
    ) {
      renderSelector = Ruleset.filterReferenceVisibleSelectorItems(
        renderSelector as Selector,
        this.selectorBeforeExtend
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
      let { rules, guard } = node;
      // On re-eval (e.g. mixin clone), use the pre-composition ownSelector so we
      // compose from the authored selector, not the already-composed one.
      let selector: Selector | Nil = (node.options as RulesetOptions)?.ownSelector ?? node.selector;
      // Generated wrapper rulesets (e.g. implicit `& { ... }` created by AtRule hoisting)
      // should not force var visibility to `private`, otherwise sibling vars inside the wrapper
      // (like Less `@base`) become inaccessible.
      if (!node.options.generated) {
        if (context.leakyRules) {
          rules.options.rulesVisibility.Mixin = 'public';
          rules.options.rulesVisibility.VarDeclaration = 'optional';
        } else {
          rules.options.rulesVisibility.Mixin = 'private';
          rules.options.rulesVisibility.VarDeclaration = 'private';
        }
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

      const parentSelector = parentRuleset?.selector;
      // Store own selector before parent resolution so extend can extend .replace,.c not the resolved form.
      if (node.options) {
        (node.options as RulesetOptions).ownSelector = selector;
      } else {
        node.options = { ownSelector: selector } as RulesetOptions;
      }
      if (parentSelector && !(parentSelector instanceof Nil) && !(selector instanceof Nil) && parentRuleset) {
        selector = getImplicitSelectorUtil(selector as Selector, parentRuleset as Ruleset, false);
        selector.sourceNode = node === this ? selector.clone(true) : selector;
      }
      // DO NOT evaluate guard here - guards are evaluated at call time in getFunctionFromMixins
      // Just evaluate the selector
      const ownSelector = (node.options as RulesetOptions)?.ownSelector;
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
                (node.options as RulesetOptions).ownSelector = evaledOwn as Selector;
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
          node.setData('selector', sel as Selector | Nil);
          if (sel.hoistToRoot) {
            node.hoistToRoot = true;
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
          const childRules = node.rules;
          if (childRules && !(childRules as unknown as Ruleset)._isPreEvaluated(context)) {
            context.rulesetFrames.push(node as Ruleset);
            if (extendRoot) {
              context.extendRoots.registerRoot(childRules, extendRoot);
            }
            const preEvaldRules = childRules.preEval(context);
            if (isThenable(preEvaldRules)) {
              return (preEvaldRules as Promise<Rules>).then((rules) => {
                context.rulesetFrames.pop();
                node.setData('rules', rules);
                if (extendRoot && rules !== childRules) {
                  context.extendRoots.registerRoot(rules, extendRoot);
                }
                return node;
              });
            }
            context.rulesetFrames.pop();
            node.setData('rules', preEvaldRules as Rules);
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
    if (this.selector instanceof Nil) {
      return this.selector;
    }
    return getImplicitSelectorUtil(this.selector, parentSelector, collapseNesting);
  }

  override copy(deep?: boolean): this {
    const node = super.copy(deep);
    const selectorSourceNode = this.selector.sourceNode;
    node.setData('selector', selectorSourceNode.copy(true) as Selector | Nil);
    node.selector.sourceNode = selectorSourceNode;
    return node;
  }

  override evalNode(context: Context): MaybePromise<Ruleset | Rules | Nil> {
    if (this.evaluated) {
      return this;
    }
    let pushedFrames = false;
    /** Should have been maybe cloned in preEval */
    this.evaluated = true;
    const collapseNesting = context.opts.collapseNesting;

    // Store frames snapshot for collapseNesting serialization
    if (collapseNesting) {
      this.frames = [...context.frames];
    }

    return pipe(
      () => {
        const selectorText = String(this.selector?.valueOf?.() ?? '');
        if (
          selectorText.includes('.call-lock-mixin')
          || selectorText.includes('#guarded-caller')
          || selectorText.includes('#guarded-deeper')
        ) {
        }
        let { guard } = this;
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
              const selectorText = String(this.selector?.valueOf?.() ?? '');
              const guardPasses = Boolean(guardResult instanceof Bool && guardResult.value === true);
              if (selectorText.includes('#guarded') || selectorText.includes('#top') || selectorText.includes('#deeper')) {
              }
              if (!guardPasses) {
                // Guard failed - mark as Nil and return it
                this.setData('guard', new Nil() as Condition | Nil);
                return new Nil();
              }
              // Guard passed - clear it and continue with selector evaluation
              this.setData('guard', undefined as Condition | Nil | undefined);
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
        let { selector } = this;
        const frame = atIndex(context.rulesetFrames, -1);
        if (frame && (this.hoistToRoot ?? context.opts.collapseNesting)) {
          this.hoistToRoot = true;
        }

        if (selector instanceof Nil) {
          // If selector evaluates to Nil, return the rules body directly instead of the ruleset
          // This allows rules to be output even when there's no selector context
          // We don't push frames because there's no selector context
          // Store Nil in selector so next step can detect this case
          this.setData('selector', selector as Selector | Nil);
          const evaluatedRules = this.rules.eval(context);
          // Update this.rules to point to evaluated Rules to prevent circular reference
          // when debug code traverses the AST
          if (isThenable(evaluatedRules)) {
            return (evaluatedRules as Promise<Rules>).then((rules) => {
              this.setData('rules', rules);
              return rules;
            });
          }
          this.setData('rules', evaluatedRules as Rules);
          return evaluatedRules;
        }
        // Preserve the sourceNode from the current selector before replacing it
        const preservedSourceNode = this.selector?.sourceNode;
        this.setData('selector', selector as Selector | Nil);
        // Restore the sourceNode on the new selector so it's available when copying
        if (preservedSourceNode && this.selector) {
          this.selector.sourceNode = preservedSourceNode;
        }
        if (context.opts.collapseNesting) {
          this.hoistToRoot = true;
        }
        context.rulesetFrames.push(this as Ruleset);
        context.frames.push(this);
        pushedFrames = true;
        return this.rules.eval(context);
      },
      (evaluatedRules: Rules | Nil) => {
        if (pushedFrames) {
          context.rulesetFrames.pop();
          context.frames.pop();
        }
        if (evaluatedRules instanceof Nil) {
          return evaluatedRules;
        }
        const selectorText = String(this.selector?.valueOf?.() ?? '');
        if (
          selectorText.includes('.call-lock-mixin')
          || selectorText.includes('#guarded-caller')
          || selectorText.includes('#guarded-deeper')
        ) {
        }

        // If selector was Nil, evaluatedRules is already Rules (not wrapped in Ruleset)
        // In that case, return it directly without wrapping back in Ruleset
        if (this.selector instanceof Nil) {
          // Selector was Nil, so we already returned Rules directly - just return it
          return evaluatedRules;
        }

        this.setData('rules', evaluatedRules as Rules);
        const rules = this.rules;

        if (rules.visibleRules().length === 0) {
          this.removeFlag(F_VISIBLE);
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
