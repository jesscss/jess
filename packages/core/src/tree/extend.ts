import { defineType, Node, F_VISIBLE, F_NON_STATIC, F_IMPLICIT_AMPERSAND } from './node.js';
import { type Context } from '../context.js';
import { Selector } from './selector.js';
import { Ampersand } from './ampersand.js';
import type { Ruleset } from './ruleset.js';
import { Nil } from './nil.js';
import { ComplexSelector } from './selector-complex.js';
import { Combinator } from './combinator.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { wrapParentSelectorForNestedContext } from './util/selector-utils.js';
import { sessionGetField } from './util/session-helpers.js';

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
export interface Extend extends Node<ExtendValue> {
  type: 'Extend';
  shortType: 'extend';
  eval(context: Context): MaybePromise<Selector>;
}

export class Extend extends Node<ExtendValue> {
  static override childKeys = ['selector', 'target'] as const;

  selector: ExtendValue['selector'];
  target!: Selector;
  namespace: string | undefined;
  flag: ExtendFlag | undefined;

  override clone(deep?: boolean, cloneFn?: (n: Node) => Node, ctx?: Context): this {
    const selector = this._getSelector(ctx);
    const target = this._getTarget(ctx);
    const namespace = this._getNamespace(ctx);
    const flag = this._getFlag(ctx);
    const cloneChild = cloneFn ?? ((n: Node) => n.clone(deep, cloneFn, ctx));
    const options = (this as any)._meta?.options;
    let priorChildParents: Array<[Node, Node | undefined]> | undefined;
    if (!deep && ctx?.session) {
      priorChildParents = [];
      if (selector instanceof Node) {
        priorChildParents.push([selector, selector.parent]);
      }
      if (target instanceof Node) {
        priorChildParents.push([target, target.parent]);
      }
    }
    const newNode = new (this.constructor as any)(
      {
        selector: deep && selector instanceof Node ? cloneChild(selector) : selector,
        target: deep ? cloneChild(target) : target,
        namespace,
        flag
      },
      options ? { ...options } : undefined,
      this.location,
      this.treeContext
    );
    if (priorChildParents) {
      const session = ctx.session;
      for (const [child, priorParent] of priorChildParents) {
        session.getRuntime(child).parent = newNode;
        (child as unknown as { parent?: Node }).parent = priorParent;
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

  private _getSelector(context?: Context): Selector | undefined {
    return context
      ? sessionGetField<Selector | undefined>(this, 'selector', context)
      : this.selector;
  }

  private _getTarget(context?: Context): Selector {
    return context
      ? sessionGetField<Selector>(this, 'target', context)
      : this.target;
  }

  private _getNamespace(context?: Context): string | undefined {
    return context
      ? sessionGetField<string | undefined>(this, 'namespace', context)
      : this.namespace;
  }

  private _getFlag(context?: Context): ExtendFlag | undefined {
    return context
      ? sessionGetField<ExtendFlag | undefined>(this, 'flag', context)
      : this.flag;
  }

  override valueOf() {
    return `$extend ${this.target.valueOf()}`;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const context = options.context;
    let target = this._getTarget(context);
    let selector = this._getSelector(context);
    let flag = this._getFlag(context);
    let namespace = this._getNamespace(context);
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
    let selector = this._getSelector(context);
    let target = this._getTarget(context);
    let flag = this._getFlag(context);
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
    if (isThenable(maybeSel)) {
      return (maybeSel as Promise<Selector | Nil>).then((sel) => {
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
        // Prefer the current ruleset's full selector (includes implicit &) so extend merges the full
        // selector (e.g. .issue-2586-somepage .content not just .content).
        if (currentFrame && isNode(currentFrame, N.Ruleset)) {
          const rs = currentFrame as Ruleset;
          const fullSel = rs.getEffectiveSelector(false, context);
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
              resolvedSel = ComplexSelector.create([
                wrapParentSelectorForNestedContext(parentSel as Selector),
                Combinator.create(' '),
                ownSel.copy(true)
              ]) as unknown as Selector;
              usedParentListComposition = true;
            }
          }
          if (!hasExplicitSelector && !usedParentListComposition) {
            if (fullSel && !(fullSel instanceof Nil)) {
              resolvedSel = fullSel as Selector;
            } else {
              // Extend ran during selector eval (e.g. .content:extend(...)); current frame is the parent.
              // Build full selector as parent + ' ' + resolvedSel (e.g. .issue-2586-somepage .content).
              if (isNode(currentFrame, N.Ruleset)) {
                const parentSel = (currentFrame as Ruleset).getEffectiveSelector(false, context);
                if (parentSel && !(parentSel instanceof Nil) && resolvedSel.valueOf() !== (parentSel as Selector).valueOf()) {
                  resolvedSel = ComplexSelector.create([
                    (parentSel as Selector).copy(true),
                    Combinator.create(' '),
                    resolvedSel.copy(true)
                  ]) as unknown as Selector;
                }
              }
            }
          }
        }
        const beforeMaterialize = resolvedSel.valueOf();
        resolvedSel = materializeImplicitAmpersands(resolvedSel, flag !== ExtendFlag.All);
        const rs = currentFrame as Ruleset;
        const docOrder = getDocumentOrderForExtend(rs, context);
        const fromReferenceScope = context.inReferenceImportScope;
        context.extends.push([target, resolvedSel, flag === ExtendFlag.All, extendRoot, this, docOrder, fromReferenceScope]);
        return new Nil();
      });
    }
    const sel = maybeSel as Selector | Nil;
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
    // Prefer the current ruleset's full selector (includes implicit &) so extend merges the full
    // selector (e.g. .issue-2586-somepage .content not just .content).
    if (currentFrame && isNode(currentFrame, N.Ruleset)) {
      const rs = currentFrame as Ruleset;
      const fullSel = rs.getEffectiveSelector(false, context);
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
          resolvedSel = ComplexSelector.create([
            wrapParentSelectorForNestedContext(parentSel as Selector),
            Combinator.create(' '),
            ownSel.copy(true)
          ]) as unknown as Selector;
          usedParentListComposition = true;
        }
      }
      if (!hasExplicitSelector && !usedParentListComposition) {
        if (fullSel && !(fullSel instanceof Nil)) {
          resolvedSel = fullSel as Selector;
        } else {
          // Extend ran during selector eval (e.g. .content:extend(...)); current frame is the parent.
          // Build full selector as parent + ' ' + resolvedSel (e.g. .issue-2586-somepage .content).
          if (isNode(currentFrame, N.Ruleset)) {
            const parentSel = (currentFrame as Ruleset).getEffectiveSelector(false, context);
            if (parentSel && !(parentSel instanceof Nil) && resolvedSel.valueOf() !== (parentSel as Selector).valueOf()) {
              resolvedSel = ComplexSelector.create([
                (parentSel as Selector).copy(true),
                Combinator.create(' '),
                resolvedSel.copy(true)
              ]) as unknown as Selector;
            }
          }
        }
      }
    }
    const beforeMaterialize = resolvedSel.valueOf();
    resolvedSel = materializeImplicitAmpersands(resolvedSel, flag !== ExtendFlag.All);
    const rs = currentFrame && isNode(currentFrame, N.Ruleset) ? currentFrame as Ruleset : undefined;
    const docOrder = getDocumentOrderForExtend(rs, context);
    const fromReferenceScope = context.inReferenceImportScope;
    context.extends.push([target, resolvedSel, flag === ExtendFlag.All, extendRoot, this, docOrder, fromReferenceScope]);
    return new Nil();
  }
}

function materializeImplicitAmpersands(
  selector: Selector,
  includeNonListImplicit: boolean
): Selector {
  const materialize = (node: Selector): Selector => {
    if (isNode(node, N.Ampersand)) {
      const amp = node as Ampersand;
      const n = amp as unknown as Node;
      if (n.hasFlag(F_IMPLICIT_AMPERSAND)) {
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
      const parts: Selector[] = [];
      for (const part of complex.value as unknown as Selector[]) {
        if (isNode(part, N.Ampersand)) {
          const amp = part as Ampersand;
          const n = amp as unknown as Node;
          if (n.hasFlag(F_IMPLICIT_AMPERSAND)) {
            const resolved = amp.getResolvedSelector();
            if (
              resolved
              && !(resolved instanceof Nil)
              && (includeNonListImplicit || isNode(resolved, N.SelectorList))
            ) {
              const repl = materialize(resolved.copy(true) as Selector);
              if (isNode(repl, N.ComplexSelector)) {
                parts.push(...((repl as ComplexSelector).value as unknown as Selector[]).map(x => x.copy(true) as Selector));
              } else {
                parts.push(repl);
              }
              continue;
            }
          }
        }
        const repl = materialize(part);
        parts.push(repl);
      }
      return ComplexSelector.create(parts as any).inherit(node) as Selector;
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
