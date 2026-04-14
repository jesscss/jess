import { Node, F_VISIBLE, F_AMPERSAND, F_EXTENDED, F_EXTEND_TARGET, F_IMPLICIT_AMPERSAND, defineType, type NodeOptions, type RenderKey } from './node.js';
import { Rules } from './rules.js';
import type { Context } from '../context.js';
import { Nil } from './nil.js';
import { Bool } from './bool.js';
import type { Condition } from './condition.js';
import { attachSelectorBitLibrary, type Selector } from './selector.js';
import { atIndex } from './util/collections.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { Ampersand } from './ampersand.js';
import { Combinator } from './combinator.js';
import { ComplexSelector, type ComplexSelectorComponent } from './selector-complex.js';
import { CompoundSelector } from './selector-compound.js';
import type { SimpleSelector } from './selector-simple.js';
import { SelectorList } from './selector-list.js';
import { PseudoSelector } from './selector-pseudo.js';
import { type PrintOptions, type FinalPrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, pipe, isThenable } from '@jesscss/awaitable-pipe';
import type { AtRule } from './at-rule.js';
import { serializeRulesContainer, normalizeIndent, indent } from './util/serialize-helper.js';
import { getImplicitSelector as getImplicitSelectorUtil } from './util/selector-utils.js';
import { registerRulesetWithRoot } from './util/extend-roots.js';
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
export class Ruleset<T = RulesetValue> extends Node<NarrowRulesetValue<T>, RulesetOptions> {
  override allowRuleRoot = true;
  override allowRoot = true;
  // Ruleset has preEval method but doesn't need to set flags - preEvaluated is tracked as boolean
  frames: (Ruleset | AtRule)[] | undefined;
  /**
   * Cached composed (parent-merged) selector per render key. Mixin calls and
   * $for iterations adopt shared body Rulesets into distinct per-call wrapper
   * Rules; the composed selector differs by call because the effective parent
   * chain differs. Keyed by the serializer's `options.renderKey` with
   * `undefined` treated as the canonical slot.
   */
  private _composedSelectorByKey: Map<number | symbol | undefined, Selector> | undefined;

  /** Read a cached composed selector for the given renderKey. */
  getComposedSelector(renderKey?: number | symbol): Selector | undefined {
    return this._composedSelectorByKey?.get(renderKey);
  }

  /** Store a cached composed selector for the given renderKey. */
  setComposedSelector(selector: Selector, renderKey?: number | symbol): void {
    (this._composedSelectorByKey ??= new Map()).set(renderKey, selector);
  }

  /** Clear all cached composed selectors (used by extend post-processing). */
  clearComposedSelectorCache(): void {
    this._composedSelectorByKey = undefined;
  }

  /**
   * Back-compat shim for call sites that haven't been converted to the
   * renderKey-aware get/set yet. Reads/writes the canonical slot only.
   * Prefer `getComposedSelector(rk)` / `setComposedSelector(sel, rk)`.
   */
  get _composedSelector(): Selector | undefined {
    return this._composedSelectorByKey?.get(undefined);
  }

  set _composedSelector(selector: Selector | undefined) {
    if (selector === undefined) {
      this._composedSelectorByKey?.delete(undefined);
      return;
    }
    (this._composedSelectorByKey ??= new Map()).set(undefined, selector);
  }

  get selector() {
    return this.value.selector;
  }

  /**
   * If this ruleset shares its value object with a descendant ruleset, give those
   * descendants their own value so mutating this ruleset's value.selector does not
   * overwrite the descendant's selector (e.g. .rep_ace nested ruleset case).
   *
   * @todo - this is LLM garbage, remove later
   */
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

  private static _prependParent(parent: Selector, child: Selector): Selector {
    const library = child.keySetLibrary ?? parent.keySetLibrary;
    const leading: ComplexSelectorComponent[] = isNode(parent, N.ComplexSelector)
      ? ((parent as ComplexSelector).value.slice() as ComplexSelectorComponent[])
      : isNode(parent, N.SelectorList)
        ? [Ruleset._wrapIs(parent)]
        : [parent as unknown as ComplexSelectorComponent];

    const trailing: ComplexSelectorComponent[] = isNode(child, N.ComplexSelector)
      ? ((child as ComplexSelector).value.slice() as ComplexSelectorComponent[])
      : [child as unknown as ComplexSelectorComponent];

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
        Ruleset._substituteAmpInCompound(child as CompoundSelector, parent, insideComplex),
        library
      );
    }

    if (isNode(child, N.ComplexSelector)) {
      return attachSelectorBitLibrary(Ruleset._substituteAmpInComplex(child as ComplexSelector, parent), library);
    }

    if (isNode(child, N.PseudoSelector)) {
      return attachSelectorBitLibrary(Ruleset._substituteAmpInPseudo(child as PseudoSelector, parent), library);
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
          ? ((parent as CompoundSelector).value as SimpleSelector[])
          : [parent as unknown as SimpleSelector];
        const merged = [...parentComponents, ...suffix];
        if (merged.length === 1) {
          return attachSelectorBitLibrary(merged[0] as unknown as Selector, library);
        }
        return attachSelectorBitLibrary(CompoundSelector.create(merged).inherit(compound), library);
      }
      // ComplexSelector parent — attach the suffix to the parent's last
      // non-combinator part, returning a new complex.
      if (isNode(parent, N.ComplexSelector)) {
        const parentParts = (parent as ComplexSelector).value.slice() as ComplexSelectorComponent[];
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
            ? ((lastPart as CompoundSelector).value as SimpleSelector[])
            : [lastPart as SimpleSelector];
          const merged = [...existing, ...suffix];
          parentParts[lastIdx] = merged.length === 1
            ? (merged[0] as ComplexSelectorComponent)
            : (CompoundSelector.create(merged) as ComplexSelectorComponent);
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
          newComponents.push(...((parent as CompoundSelector).value as SimpleSelector[]));
        } else {
          newComponents.push(parent as unknown as SimpleSelector);
        }
      } else if (comp.hasFlag(F_AMPERSAND)) {
        // `&` is nested deeper (e.g. inside a pseudo arg).
        const sub = Ruleset._substituteAmpersand(comp as unknown as Selector, parent);
        if (isNode(sub, N.CompoundSelector)) {
          newComponents.push(...((sub as CompoundSelector).value as SimpleSelector[]));
        } else {
          newComponents.push(sub as unknown as SimpleSelector);
        }
      } else {
        newComponents.push(comp);
      }
    }
    if (newComponents.length === 1) {
      return attachSelectorBitLibrary(newComponents[0] as unknown as Selector, library);
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
            newParts.push(...((parent as ComplexSelector).value as ComplexSelectorComponent[]));
          }
        } else {
          // Simple or Compound parent: single-component insertion, always safe.
          newParts.push(parent as unknown as ComplexSelectorComponent);
        }
      } else if (!isNode(part, N.Combinator) && (part as Node).hasFlag(F_AMPERSAND)) {
        const rightTight = Ruleset._isTightCombinatorAt(parts, i + 1);
        const allowSmartSpliceInPlace = i === 0 && !rightTight;
        const sub = Ruleset._substituteAmpersand(
          part as unknown as Selector,
          parent,
          !allowSmartSpliceInPlace
        );
        if (isNode(sub, N.ComplexSelector)) {
          // Flatten a complex sub into this complex's components.
          newParts.push(...((sub as ComplexSelector).value as ComplexSelectorComponent[]));
        } else {
          newParts.push(sub as unknown as ComplexSelectorComponent);
        }
      } else {
        newParts.push(part);
      }
    }
    return attachSelectorBitLibrary(ComplexSelector.create(newParts).inherit(complex), library);
  }

  private static _substituteAmpInPseudo(pseudo: PseudoSelector, parent: Selector): Selector {
    const library = pseudo.keySetLibrary ?? parent.keySetLibrary;
    const arg = pseudo.value.arg as Selector | undefined;
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
    return attachSelectorBitLibrary(newPseudo.inherit(pseudo) as unknown as Selector, library);
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
        (rs as Ruleset).set(null, {
          selector: rs.value.selector,
          rules: rs.value.rules,
          ...(rs.value.guard !== undefined && { guard: rs.value.guard })
        });
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
  invalidateSelectorValueCache(): void {
    this._valueOf = undefined;
    this.clearComposedSelectorCache();
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
      if (Array.isArray(list.value)) {
        for (const item of list.value) {
          Ruleset.ensureSelectorVisible(item);
        }
      }
      return;
    }
    if (isNode(sel, N.ComplexSelector)) {
      const comps = (sel as ComplexSelector).value;
      if (Array.isArray(comps)) {
        for (const c of comps) {
          Ruleset.ensureSelectorVisible(c as Selector);
        }
      }
      return;
    }
    const v = (sel as Selector & { value?: Selector[] }).value;
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
      const arr = (node as Selector & { value?: Selector[] }).value;
      if (Array.isArray(arr)) {
        const cloned = node.copy(true) as Selector & { value?: Selector[] };
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

  private static hasExtendedTopLevelSelector(sel: Selector | Nil): boolean {
    if (!sel || sel instanceof Nil) {
      return false;
    }
    if (isNode(sel, N.SelectorList)) {
      return (sel as SelectorList).value.some(item => item.hasFlag(F_EXTENDED));
    }
    return (sel as Selector).hasFlag(F_EXTENDED);
  }

  private static filterExtendedTopLevelSelectorItems(sel: Selector): Selector | Nil {
    if (!isNode(sel, N.SelectorList)) {
      return (sel.hasFlag(F_EXTENDED) || sel.hasFlag(F_EXTEND_TARGET)) ? sel : new Nil();
    }
    const seen = new Set<string>();
    const kept: Selector[] = [];
    let sawAddedSelector = false;
    for (const item of (sel as SelectorList).value) {
      if (item.hasFlag(F_EXTENDED) && !item.hasFlag(F_EXTEND_TARGET)) {
        sawAddedSelector = true;
        const key = item.valueOf();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        kept.push(item.copy(true) as Selector);
      }
    }
    if (!sawAddedSelector) {
      for (const item of (sel as SelectorList).value) {
        if (!item.hasFlag(F_EXTENDED) && !item.hasFlag(F_EXTEND_TARGET)) {
          continue;
        }
        const key = item.valueOf();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        kept.push(item.copy(true) as Selector);
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
  static filterExtendedForReferenceCompose(parent: Selector): Selector | undefined {
    if (!isNode(parent, N.SelectorList)) {
      return undefined;
    }
    const list = parent as SelectorList;
    const hasAnyAdded = list.value.some(
      item => item.hasFlag(F_EXTENDED) && !item.hasFlag(F_EXTEND_TARGET)
    );
    if (!hasAnyAdded) {
      return undefined;
    }
    const seen = new Set<string>();
    const kept: Selector[] = [];
    for (const item of list.value) {
      if (!item.hasFlag(F_EXTENDED) || item.hasFlag(F_EXTEND_TARGET)) {
        continue;
      }
      const key = item.valueOf();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      kept.push(item);
    }
    if (kept.length === 0 || kept.length === list.value.length) {
      return undefined;
    }
    if (kept.length === 1) {
      return kept[0]!;
    }
    return SelectorList.create(kept).inherit(parent) as Selector;
  }

  getHeaderString(options: FinalPrintOptions, withoutComments?: boolean): string {
    const w = options.writer;
    const { selector } = this.getValue(options.renderKey) as RulesetValue;
    const idt = indent(options.depth);

    // Should never be called for Nil selectors (serializeRulesContainer guards this),
    // but keep it safe for TypeScript and invariants.
    if (selector instanceof Nil) {
      return '';
    }

    let renderSelector = withoutComments ? (selector.copy(true) as typeof selector) : selector;
    const referenceFilteredLocal = (
      options.referenceMode === true
      && options.referenceRenderEnabled === true
      && !(renderSelector instanceof Nil)
      && Ruleset.hasExtendedTopLevelSelector(renderSelector as Selector | Nil)
    )
      ? Ruleset.filterExtendedTopLevelSelectorItems(renderSelector as Selector) as typeof renderSelector
      : undefined;
    if (options.collapseNesting && !(renderSelector instanceof Nil)) {
      const rawParentComposed = options.composedSelectorStack?.at(-1);
      const parentComposed = (
        options.referenceMode === true
        && options.referenceRenderEnabled === true
        && rawParentComposed
      )
        ? Ruleset.filterExtendedForReferenceCompose(rawParentComposed as Selector) ?? rawParentComposed
        : rawParentComposed;
      const structuralParent = (
        this.hoistToRoot === true
        && this.parent?.parent
        && isNode(this.parent.parent, N.Ruleset)
      )
        ? ((this.parent.parent as Ruleset).value.selector as Selector | Nil)
        : null;
      const composeParent = parentComposed ?? (
        structuralParent && !(structuralParent instanceof Nil) ? structuralParent : null
      );
      const rk = options.renderKey;
      let cached = this.getComposedSelector(rk);
      if (!cached) {
        const ownSelector = (this.options as RulesetOptions | undefined)?.ownSelector;
        const hasExtendedComposeContext = Boolean(
          Ruleset.hasExtendedTopLevelSelector(renderSelector as Selector)
          || (composeParent && Ruleset.hasExtendedTopLevelSelector(composeParent as Selector))
          || this.hasFlag(F_EXTENDED)
        );
        const composeInput: Selector = (
          ownSelector
          && ownSelector.hasFlag(F_AMPERSAND)
          && !Ruleset.isBareAmpersandSelector(ownSelector)
          && composeParent
          && hasExtendedComposeContext
        )
          ? (ownSelector as Selector)
          : (referenceFilteredLocal ?? (renderSelector as Selector));
        cached = composeParent
          ? (
              composeInput.valueOf() === (composeParent as Selector).valueOf()
                ? composeInput
                : Ruleset.composeSelector(composeInput, composeParent as Selector)
            )
          : composeInput;
        this.setComposedSelector(cached as Selector, rk);
      }
      renderSelector = cached as typeof selector;
    }
    // Header filter: in reference mode, top-level selector output should
    // reflect the selectors that were actually unlocked. When an extend adds
    // visible selectors, we emit those; for self-extends with no added items,
    // we fall back to the touched original selector.
    if (referenceFilteredLocal) {
      renderSelector = (
        renderSelector.valueOf() === referenceFilteredLocal.valueOf()
          ? renderSelector
          : Ruleset.filterExtendedTopLevelSelectorItems(renderSelector as Selector) as typeof renderSelector
      );
      if (renderSelector instanceof Nil) {
        return '';
      }
      this.value.selector = renderSelector as typeof selector;
      this.invalidateSelectorValueCache();
    }
    const prevReferenceFilterTargets = options.referenceFilterTargets === true;
    options.referenceFilterTargets = (
      options.referenceMode === true
      && options.referenceRenderEnabled === true
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
    if (!this.preEvaluated) {
      const node = this.maybeClone(context);
      node.preEvaluated = true;
      // Index should already be assigned by parent Rules
      node.sourceNode ??= this;
      let { selector, rules, guard } = node.value;
      const { selectorBits } = context;
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
      if ('keySetLibrary' in selector && !(selector instanceof Nil)) {
        (selector as Selector).keySetLibrary ??= selectorBits;
      }
      const ownSelector = !(selector instanceof Nil)
        ? ((selector as Selector).copy(true) as Selector)
        : selector;
      if ('keySetLibrary' in ownSelector && !(ownSelector instanceof Nil)) {
        (ownSelector as Selector).keySetLibrary ??= selectorBits;
      }
      if (node.options) {
        (node.options as RulesetOptions).ownSelector = ownSelector;
      } else {
        node.options = { ownSelector } as RulesetOptions;
      }
      /* getImplicitSelector removed — selector stays as-authored.
       * Composed form (with parent context) computed on-demand during:
       * - serialization (composedSelectorStack in PrintOptions)
       * - extend matching (parent context parameter)
       */
      // DO NOT evaluate guard here - guards are evaluated at call time in getFunctionFromMixins
      // Just evaluate the selector
      return pipe(
        () => selector.eval(context),
        (sel) => {
          // If this ruleset shares its value with a descendant ruleset, give descendants
          // their own value before we overwrite value.selector so they keep their selector.
          Ruleset.ensureDescendantRulesetsHaveOwnValue(node as Ruleset, node.value);
          // Store the evaluated selector - this is what will be in the frame
          node.value.selector = sel as Selector | Nil;
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
            (sel as Selector).keySetLibrary ??= selectorBits;
          }
          // Register the concrete Ruleset with the current extend root.
          const extendRoot = context.extendRoots.getCurrentExtendRoot();
          if (extendRoot) {
            registerRulesetWithRoot(extendRoot, node as Ruleset);
          }
          // Depth-first: preEval child rules immediately so all nested rulesets/extends
          // are registered in source order before we process extends.
          // Push this ruleset to the frame so nested rulesets get the correct parent selector
          // when building implicit selectors (e.g. .header-nav inside .header → .header .header-nav).
          const childRules = node.value.rules;
          if (childRules && !childRules.preEvaluated) {
            context.rulesetFrames.push(node as Ruleset);
            if (extendRoot) {
              context.extendRoots.registerRoot(childRules, extendRoot);
            }
            const preEvaldRules = childRules.preEval(context);
            if (isThenable(preEvaldRules)) {
              return (preEvaldRules as Promise<Rules>).then((rules) => {
                context.rulesetFrames.pop();
                node.value.rules = rules;
                if (extendRoot && rules !== childRules) {
                  context.extendRoots.registerRoot(rules, extendRoot);
                }
                return node;
              });
            }
            context.rulesetFrames.pop();
            node.value.rules = preEvaldRules as Rules;
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
    const selectorSourceNode = this.value.selector.sourceNode;
    node.value.selector = selectorSourceNode.copy(true) as Selector | Nil;
    node.value.selector.sourceNode = selectorSourceNode;
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
    /**
     * Local non-generic alias for `this.set` so we can write field-typed
     * mutations (`'guard'`, `'selector'`, `'rules'`) without TS losing the
     * key constraints to the class generic `T`.
     */
    const setOnRuleset = (key: 'guard' | 'selector' | 'rules', value: any) => {
      (this as Ruleset).set(key as any, value, context.renderKey);
    };

    // Store frames snapshot for collapseNesting serialization
    if (collapseNesting) {
      this.frames = [...context.frames];
    }

    return pipe(
      () => {
        const selectorText = String(this.value.selector?.valueOf?.() ?? '');
        if (
          selectorText.includes('.call-lock-mixin')
          || selectorText.includes('#guarded-caller')
          || selectorText.includes('#guarded-deeper')
        ) {
        }
        let { guard } = this.value;
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
              const selectorText = String(this.value.selector?.valueOf?.() ?? '');
              const guardPasses = Boolean(guardResult instanceof Bool && guardResult.value === true);
              if (selectorText.includes('#guarded') || selectorText.includes('#top') || selectorText.includes('#deeper')) {
              }
              if (!guardPasses) {
                setOnRuleset('guard', new Nil());
                return new Nil();
              }
              setOnRuleset('guard', undefined);
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
        let { selector } = this.value;
        const frame = atIndex(context.rulesetFrames, -1);

        if (selector instanceof Nil) {
          // If selector evaluates to Nil, return the rules body directly instead of the ruleset
          // This allows rules to be output even when there's no selector context
          // We don't push frames because there's no selector context
          // Store Nil in selector so next step can detect this case
          setOnRuleset('selector', selector);
          const evaluatedRules = this.value.rules.eval(context);
          if (isThenable(evaluatedRules)) {
            return (evaluatedRules as Promise<Rules>).then((rules) => {
              setOnRuleset('rules', rules);
              return rules;
            });
          }
          setOnRuleset('rules', evaluatedRules as Rules);
          return evaluatedRules;
        }
        // Preserve the sourceNode from the current selector before replacing it
        const preservedSourceNode = this.value.selector?.sourceNode;
        setOnRuleset('selector', selector);
        if (preservedSourceNode && this.value.selector) {
          this.value.selector.sourceNode = preservedSourceNode;
        }
        if (context.opts.collapseNesting) {
          this.hoistToRoot = true;
        }
        context.rulesetFrames.push(this as Ruleset);
        context.frames.push(this);
        pushedFrames = true;
        return this.value.rules.eval(context);
      },
      (evaluatedRules: Rules | Nil) => {
        if (pushedFrames) {
          context.rulesetFrames.pop();
          context.frames.pop();
        }
        if (evaluatedRules instanceof Nil) {
          return evaluatedRules;
        }
        const selectorText = String(this.value.selector?.valueOf?.() ?? '');
        if (
          selectorText.includes('.call-lock-mixin')
          || selectorText.includes('#guarded-caller')
          || selectorText.includes('#guarded-deeper')
        ) {
        }

        // If selector was Nil, evaluatedRules is already Rules (not wrapped in Ruleset)
        // In that case, return it directly without wrapping back in Ruleset
        if (this.value.selector instanceof Nil) {
          // Selector was Nil, so we already returned Rules directly - just return it
          return evaluatedRules;
        }

        setOnRuleset('rules', evaluatedRules);
        const rules = this.value.rules;

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
  //   this.value.toModule(context, out)
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
