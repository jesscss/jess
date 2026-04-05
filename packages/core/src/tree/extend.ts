import { defineType, Node, F_VISIBLE, F_NON_STATIC, F_IMPLICIT_AMPERSAND, F_AMPERSAND, type NodeOptions } from './node.js';
import { type Context } from '../context.js';
import { Selector } from './selector.js';
import { Ampersand } from './ampersand.js';
import type { Ruleset } from './ruleset.js';
import { Nil } from './nil.js';
import { ComplexSelector, type ComplexSelectorComponent } from './selector-complex.js';
import { Combinator } from './combinator.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { getImplicitSelector, selectorHasAuthoredAmpersand, wrapParentSelectorForNestedContext } from './util/selector-utils.js';
import { addParentEdge } from './util/cursor.js';
import { CANONICAL, EVAL } from './node-base.js';
import { activeExtendWorkCounters } from './util/extend-work-counters.js';

export enum ExtendFlag {
  /** Sass and Jess default */
  All = 0,
  /** Less default - must not be a partial selector match */
  Exact = 1
}

export type ExtendValue = {
  /** The current selector. By default is `&` */
  selector?: Selector;
  /** The target to extend */
  target: Selector;
  /**
   * Optional namespace scoping for extend targets.
   *
   * - `namespace: '*'` means "search all extend roots in this file (ignore namespace scoping)".
   * - `namespace: 'ns'` means "search the extend root(s) assigned to namespace `ns`".
   */
  namespace?: string;
  flag?: ExtendFlag;
};
/**
 * Extends selectors - parsed by Less as an independent statement
 * at the beginning of rules.
 *
 * @todo - figure out eval -- use Rules lookups
 * @note - there is some pseudo-code somewhere that smartly
 * registers selectors by a string code.
 */
export type ExtendChildData = {
  selector: Selector | undefined;
  target: Selector;
  namespace: string | undefined;
  flag: ExtendFlag | undefined;
};

export interface Extend extends Node<ExtendValue, NodeOptions, ExtendChildData> {
  type: 'Extend';
  shortType: 'extend';
  eval(context: Context): MaybePromise<Selector>;
}

export class Extend extends Node<ExtendValue, NodeOptions, ExtendChildData> {
  static override childKeys = ['selector', 'target'] as const;

  readonly selector: ExtendValue['selector'];
  readonly target!: Selector;
  private readonly namespace: string | undefined;
  private readonly flag: ExtendFlag | undefined;

  override clone(deep?: boolean, cloneFn?: (n: Node) => Node, ctx?: Context): this {
    const selector = this.get('selector', ctx);
    const target = this.get('target', ctx);
    const namespace = this.get('namespace', ctx);
    const flag = this.get('flag', ctx);
    const cloneChild = cloneFn ?? ((n: Node) => n.clone(deep, cloneFn, ctx));
    const options = this._meta?.options;
    let priorChildParents: Array<[Node, Node | undefined]> | undefined;
    if (!deep) {
      priorChildParents = [];
      if (selector instanceof Node) {
        priorChildParents.push([selector, selector.parent]);
      }
      if (target instanceof Node) {
        priorChildParents.push([target, target.parent]);
      }
    }
    const newNode: this = Reflect.construct(this.constructor, [
      {
        selector: deep && selector instanceof Node ? cloneChild(selector) : selector,
        target: deep ? cloneChild(target) : target,
        namespace,
        flag
      },
      options ? { ...options } : undefined,
      this.location,
      this.treeContext
    ]);
    if (priorChildParents) {
      const renderKey = ctx?.renderKey ?? (this.renderKey === CANONICAL ? EVAL : this.renderKey);
      for (const [child, priorParent] of priorChildParents) {
        addParentEdge(child, renderKey, newNode);
        Reflect.set(child, 'parent', priorParent);
      }
    }
    newNode.inherit(this);
    return newNode;
  }

  constructor(value: ExtendValue, options?: any, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    this.selector = value.selector;
    this.target = value.target;
    this.namespace = value.namespace;
    this.flag = value.flag;
    if (this.selector instanceof Node) {
      this.adopt(this.selector);
    }
    if (this.target instanceof Node) {
      this.adopt(this.target);
    }
    this.removeFlag(F_VISIBLE);
    this.addFlag(F_NON_STATIC);
  }

  override valueOf(context?: Context) {
    return `$extend ${this.get('target', context).valueOf()}`;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const context = options.context;
    let target = this.get('target', context);
    let selector = this.get('selector', context);
    let flag = this.get('flag', context);
    let namespace = this.get('namespace', context);
    const mark = w.mark();
    w.add('$extend');
    if (selector) {
      let out = w.capture(() => selector.toString(options)).trim();
      w.add(' ');
      w.add(out, selector);
      w.add(' ->');
    }
    let out = w.capture(() => target.toString(options)).trim();
    w.add(' ');
    if (namespace) {
      w.add(`${namespace}|`);
    }
    w.add(out, target);
    if (flag === ExtendFlag.Exact) {
      w.add(' !exact');
    }
    w.add(';');
    return w.getSince(mark);
  }

  // Don't preEval Extend - let it be evaluated in evalNode when the ruleset is in the frame
  // This ensures the ampersand resolves to the correct ruleset selector, not the parent frame

  override evalNode(context: Context): MaybePromise<Nil> {
    let selector = this.get('selector', context);
    let target = this.get('target', context);
    let flag = this.get('flag', context);
    let namespace = this.get('namespace', context);
    const hasExplicitSelector = selector !== undefined;

    const currentFrame = context.rulesetFrames.at(-1);

    // If selector is undefined, convert it to ampersand so it resolves to the ruleset's selector
    // If selector is already set to a non-ampersand (e.g., from a bubbled extend), keep it as-is
    // The parser sets the selector correctly when bubbling extends, so we should preserve it
    if (!selector) {
      // Set selector to ampersand - it will resolve to the current ruleset's selector when evaluated
      // This matches the conceptual model: .c:extend(.ext all) is like { &:extend(.ext all); } inside .c
      // The frame selector should already be :is(.a, .b) .c (the evaluated selector from preEval)
      selector = Ampersand.create(undefined);
      // Make the ampersand visible so it's included in the selector when evaluated
      // This ensures the parent selector is properly included in the extend selector
      selector.addFlag(F_VISIBLE);
    }
    // If selector is already set (e.g., .ext7 from a bubbled extend), use it directly
    // Don't convert non-ampersand selectors to ampersand - they should be used as-is
    // Get current extend root from registry stack
    const extendRoot = context.extendRoots.getCurrentExtendRoot();
    if (!extendRoot) {
      /** Throw error? */
      return new Nil();
    }

    const maybeSel = selector.eval(context);
    const finalize = (resolvedTarget: Selector, sel: Selector | Nil): Nil => {
      if (sel instanceof Nil) {
        return new Nil();
      }
      // Resolve ampersand to its current parent selector if needed (live resolution for extend)
      let resolvedSel: Selector = sel;
      if (isNode(sel, N.Ampersand)) {
        const ampResolved = sel.getResolvedSelector();
        if (ampResolved && !(ampResolved instanceof Nil)) {
          resolvedSel = ampResolved;
        }
      }
      resolvedSel = resolveExtendSelectorInFrame(
        resolvedSel,
        hasExplicitSelector,
        currentFrame,
        context
      );
      resolvedSel = materializeImplicitAmpersands(resolvedSel, flag !== ExtendFlag.All);
      if (activeExtendWorkCounters) {
        activeExtendWorkCounters.recordedExtendInstructions++;
        if (!resolvedTarget.keySetLibrary) {
          activeExtendWorkCounters.recordedExtendTargetsMissingKeySetLibrary++;
        }
        if (resolvedTarget.hasFlag(F_AMPERSAND)) {
          activeExtendWorkCounters.recordedExtendTargetsWithAmpersand++;
        }
        if (resolvedTarget.hasFlag(F_NON_STATIC)) {
          activeExtendWorkCounters.recordedExtendTargetsNonStatic++;
        }
        if (!resolvedTarget.hasFlag(F_AMPERSAND) && !resolvedTarget.hasFlag(F_NON_STATIC)) {
          activeExtendWorkCounters.recordedExtendTargetsStaticNoAmpersand++;
        }
        if (!resolvedSel.keySetLibrary) {
          activeExtendWorkCounters.recordedExtendWithMissingKeySetLibrary++;
        }
        if (resolvedSel.hasFlag(F_AMPERSAND)) {
          activeExtendWorkCounters.recordedExtendWithAmpersand++;
        }
        if (resolvedSel.hasFlag(F_NON_STATIC)) {
          activeExtendWorkCounters.recordedExtendWithNonStatic++;
        }
      }
      const rs = currentFrame && isNode(currentFrame, N.Ruleset) ? currentFrame as Ruleset : undefined;
      const docOrder = getDocumentOrderForExtend(rs, context);
      const fromReferenceScope = context.inReferenceImportScope;
      context.extends.push([resolvedTarget, resolvedSel, flag === ExtendFlag.All, extendRoot, this, docOrder, fromReferenceScope, namespace]);
      return new Nil();
    };

    if (isThenable(maybeSel)) {
      return (maybeSel as Promise<Selector | Nil>).then((sel) => {
        return finalize(target, sel);
      });
    }
    return finalize(target, maybeSel as Selector | Nil);
  }
}

function materializeImplicitAmpersands(
  selector: Selector,
  includeNonListImplicit: boolean
): Selector {
  const pushSelectorIntoComplexParts = (
    parts: ComplexSelectorComponent[],
    selector: Selector
  ): void => {
    const candidate = isNode(selector, N.SelectorList)
      ? wrapParentSelectorForNestedContext(selector)
      : selector;
    if (isNode(candidate, N.ComplexSelector)) {
      parts.push(...candidate.value);
      return;
    }
    if (!isNode(candidate, N.SelectorList)) {
      parts.push(candidate);
    }
  };

  const materialize = (node: Selector): Selector => {
    if (isNode(node, N.Ampersand)) {
      const amp = node as Ampersand;
      if (amp.hasFlag(F_IMPLICIT_AMPERSAND)) {
        const resolved = amp.getResolvedSelector();
        if (
          resolved
          && !(resolved instanceof Nil)
          && (includeNonListImplicit || isNode(resolved, N.SelectorList))
        ) {
          return materialize(resolved.copy(true) as Selector);
        }
      }
      return node.copy(true) as Selector;
    }

    if (isNode(node, N.ComplexSelector)) {
      const complex = node as ComplexSelector;
      const parts: ComplexSelectorComponent[] = [];
      for (const part of complex.value) {
        if (isNode(part, N.Combinator)) {
          parts.push(part);
          continue;
        }
        if (isNode(part, N.Ampersand)) {
          const amp = part as Ampersand;
          if (amp.hasFlag(F_IMPLICIT_AMPERSAND)) {
            const resolved = amp.getResolvedSelector();
            if (
              resolved
              && !(resolved instanceof Nil)
              && (includeNonListImplicit || isNode(resolved, N.SelectorList))
            ) {
              const repl = materialize(resolved.copy(true) as Selector);
              if (isNode(repl, N.ComplexSelector)) {
                parts.push(...repl.value);
              } else {
                pushSelectorIntoComplexParts(parts, repl);
              }
              continue;
            }
          }
        }
        const repl = materialize(part);
        pushSelectorIntoComplexParts(parts, repl);
      }
      return ComplexSelector.create(parts).inherit(node) as Selector;
    }

    const value = (node as Selector & { value?: Selector[] }).value;
    if (Array.isArray(value)) {
      const cloned = node.copy(true) as Selector & { value?: Selector[] };
      cloned.value = value.map(item => materialize(item as Selector));
      return cloned as Selector;
    }

    return node.copy(true) as Selector;
  };

  return materialize(selector);
}

/** Document order for extend: prefer parse location startOffset (source order), else assigned map, else push order (length). */
function getDocumentOrderForExtend(rs: Ruleset | undefined, context: Context): number {
  if (!rs) {
    return context.extends.length;
  }
  const loc = (rs as Node).location;
  const fromLoc = Array.isArray(loc) && loc.length >= 1 && typeof loc[0] === 'number' ? loc[0] : undefined;
  if (fromLoc !== undefined) {
    return fromLoc;
  }
  const fromMap = context.documentOrderByRuleset?.get(rs);
  if (fromMap !== undefined) {
    return fromMap;
  }
  return context.extends.length;
}
export const extend = defineType(Extend, 'Extend');

function resolveExtendSelectorInFrame(
  selector: Selector,
  hasExplicitSelector: boolean,
  currentFrame: Node | undefined,
  context: Context
): Selector {
  if (!currentFrame || !isNode(currentFrame, N.Ruleset)) {
    return selector;
  }

  const rs = currentFrame as Ruleset;
  const fullSel = rs.getEffectiveSelector(false, context);
  let resolvedSel = selector;
  let usedParentListComposition = false;

  if (!hasExplicitSelector) {
    const ownSel = rs.getOwnSelector(context);
    const parentFrame = context.rulesetFrames.at(-2);
    const parentSel = (
      parentFrame && isNode(parentFrame, N.Ruleset)
        ? (parentFrame as Ruleset).getEffectiveSelector(false, context)
        : undefined
    );
    if (
      ownSel
      && parentSel
      && !(parentSel instanceof Nil)
      && isNode(parentSel, N.SelectorList)
    ) {
      const composedParts: ComplexSelectorComponent[] = [];
      const wrappedParent = wrapParentSelectorForNestedContext(parentSel);
      if (isNode(wrappedParent, N.ComplexSelector)) {
        composedParts.push(...wrappedParent.value);
      } else if (!isNode(wrappedParent, N.SelectorList)) {
        composedParts.push(wrappedParent);
      }
      composedParts.push(Combinator.create(' '));
      const ownCopy = ownSel.copy(true);
      if (isNode(ownCopy, N.ComplexSelector)) {
        composedParts.push(...ownCopy.value);
      } else if (!isNode(ownCopy, N.SelectorList)) {
        composedParts.push(ownCopy);
      }
      resolvedSel = ComplexSelector.create(composedParts);
      usedParentListComposition = true;
    }
  }

  if (!hasExplicitSelector && !usedParentListComposition) {
    if (fullSel && !(fullSel instanceof Nil)) {
      return fullSel as Selector;
    }

    const parentSel = rs.getEffectiveSelector(false, context);
    if (parentSel && !(parentSel instanceof Nil) && resolvedSel.valueOf() !== (parentSel as Selector).valueOf()) {
      const composedParts: ComplexSelectorComponent[] = [];
      const parentCopy = parentSel.copy(true);
      if (isNode(parentCopy, N.ComplexSelector)) {
        composedParts.push(...parentCopy.value);
      } else if (!isNode(parentCopy, N.SelectorList)) {
        composedParts.push(parentCopy);
      }
      composedParts.push(Combinator.create(' '));
      const resolvedCopy = resolvedSel.copy(true);
      if (isNode(resolvedCopy, N.ComplexSelector)) {
        composedParts.push(...resolvedCopy.value);
      } else if (!isNode(resolvedCopy, N.SelectorList)) {
        composedParts.push(resolvedCopy);
      }
      return ComplexSelector.create(composedParts);
    }

    return resolvedSel;
  }

  if (
    hasExplicitSelector
    && selectorHasAuthoredAmpersand(resolvedSel)
    && fullSel
    && !(fullSel instanceof Nil)
  ) {
    return getImplicitSelector(resolvedSel, fullSel as Selector, false);
  }

  return resolvedSel;
}
