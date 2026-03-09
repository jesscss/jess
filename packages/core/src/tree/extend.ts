import { defineType, Node, F_VISIBLE, F_NON_STATIC, F_IMPLICIT_AMPERSAND } from './node.js';
import { type Context } from '../context.js';
import { Selector } from './selector.js';
import { Ampersand } from './ampersand.js';
import type { Ruleset } from './ruleset.js';
import { Nil } from './nil.js';
import { ComplexSelector } from './selector-complex.js';
import { Combinator } from './combinator.js';
import { PseudoSelector } from './selector-pseudo.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';

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
  eval(context: Context): MaybePromise<Selector>;
}

export class Extend extends Node<ExtendValue> {
  type = 'Extend' as const;
  shortType = 'extend' as const;

  constructor(value: ExtendValue, options?: any, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    this.removeFlag(F_VISIBLE);
    this.addFlag(F_NON_STATIC);
  }

  override valueOf() {
    return `$extend ${this.value.target.valueOf()}`;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    let { target, selector, flag, namespace } = this.value;
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
    let { selector, target, flag } = this.value;

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
        if (isNode(sel, 'Ampersand')) {
          const ampResolved = sel.getResolvedSelector();
          if (ampResolved && !(ampResolved instanceof Nil)) {
            resolvedSel = ampResolved;
          }
        }
        // Prefer the current ruleset's full selector (includes implicit &) so extend merges the full
        // selector (e.g. .issue-2586-somepage .content not just .content).
        if (currentFrame && isNode(currentFrame, 'Ruleset')) {
          const rs = currentFrame as Ruleset;
          const fullSel = rs.value?.selector;
          let usedParentListComposition = false;
          if (!this.value.selector) {
            const ownSel = (rs.options as { ownSelector?: Selector } | undefined)?.ownSelector;
            const parentFrame = context.rulesetFrames.at(-2);
            const parentSel = (
              parentFrame && isNode(parentFrame, 'Ruleset')
                ? (parentFrame as Ruleset).value?.selector
                : undefined
            );
            if (
              ownSel
              && parentSel
              && !(parentSel instanceof Nil)
              && isNode(parentSel, 'SelectorList')
            ) {
              const parentIs = PseudoSelector.create({
                name: ':is',
                arg: (parentSel as Selector).copy(true)
              });
              parentIs.generated = true;
              resolvedSel = ComplexSelector.create([
                parentIs,
                Combinator.create(' '),
                ownSel.copy(true)
              ]) as unknown as Selector;
              usedParentListComposition = true;
            }
          }
          if (!this.value.selector && !usedParentListComposition) {
            if (fullSel && !(fullSel instanceof Nil)) {
              resolvedSel = fullSel as Selector;
            } else {
              // Extend ran during selector eval (e.g. .content:extend(...)); current frame is the parent.
              // Build full selector as parent + ' ' + resolvedSel (e.g. .issue-2586-somepage .content).
              if (isNode(currentFrame, 'Ruleset')) {
                const parentSel = (currentFrame as Ruleset).value?.selector;
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
        const extendRootOptions = extendRoot.options as { referenceMode?: boolean };
        // Extends declared while traversing a reference branch are tagged so the
        // extend resolver can keep them non-side-effecting outside that branch.
        const fromReferenceScope = (
          context.inReferenceImportScope
          || extendRootOptions.referenceMode === true
        );
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
    if (isNode(sel, 'Ampersand')) {
      const ampResolved = sel.getResolvedSelector();
      if (ampResolved && !(ampResolved instanceof Nil)) {
        resolvedSel = ampResolved;
      }
    }
    // Prefer the current ruleset's full selector (includes implicit &) so extend merges the full
    // selector (e.g. .issue-2586-somepage .content not just .content).
    if (currentFrame && isNode(currentFrame, 'Ruleset')) {
      const rs = currentFrame as Ruleset;
      const fullSel = rs.value?.selector;
      let usedParentListComposition = false;
      if (!this.value.selector) {
        const ownSel = (rs.options as { ownSelector?: Selector } | undefined)?.ownSelector;
        const parentFrame = context.rulesetFrames.at(-2);
        const parentSel = (
          parentFrame && isNode(parentFrame, 'Ruleset')
            ? (parentFrame as Ruleset).value?.selector
            : undefined
        );
        if (
          ownSel
          && parentSel
          && !(parentSel instanceof Nil)
          && isNode(parentSel, 'SelectorList')
        ) {
          const parentIs = PseudoSelector.create({
            name: ':is',
            arg: (parentSel as Selector).copy(true)
          });
          parentIs.generated = true;
          resolvedSel = ComplexSelector.create([
            parentIs,
            Combinator.create(' '),
            ownSel.copy(true)
          ]) as unknown as Selector;
          usedParentListComposition = true;
        }
      }
      if (!this.value.selector && !usedParentListComposition) {
        if (fullSel && !(fullSel instanceof Nil)) {
          resolvedSel = fullSel as Selector;
        } else {
          // Extend ran during selector eval (e.g. .content:extend(...)); current frame is the parent.
          // Build full selector as parent + ' ' + resolvedSel (e.g. .issue-2586-somepage .content).
          if (isNode(currentFrame, 'Ruleset')) {
            const parentSel = (currentFrame as Ruleset).value?.selector;
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
    const rs = currentFrame && isNode(currentFrame, 'Ruleset') ? currentFrame as Ruleset : undefined;
    const docOrder = getDocumentOrderForExtend(rs, context);
    const extendRootOptions = extendRoot.options as { referenceMode?: boolean };
    // Same reference-scope tagging for sync path.
    const fromReferenceScope = (
      context.inReferenceImportScope
      || extendRootOptions.referenceMode === true
    );
    context.extends.push([target, resolvedSel, flag === ExtendFlag.All, extendRoot, this, docOrder, fromReferenceScope]);
    return new Nil();
  }
}

function materializeImplicitAmpersands(
  selector: Selector,
  includeNonListImplicit: boolean
): Selector {
  const materialize = (node: Selector): Selector => {
    if (isNode(node, 'Ampersand')) {
      const amp = node as Ampersand;
      const n = amp as unknown as Node;
      if (n.hasFlag(F_IMPLICIT_AMPERSAND)) {
        const resolved = amp.getResolvedSelector();
        if (
          resolved
          && !(resolved instanceof Nil)
          && (includeNonListImplicit || isNode(resolved, 'SelectorList'))
        ) {
          return materialize(resolved.copy(true) as Selector);
        }
      }
      return node.copy(true) as Selector;
    }

    if (isNode(node, 'ComplexSelector')) {
      const complex = node as ComplexSelector;
      const parts: Selector[] = [];
      for (const part of complex.value as unknown as Selector[]) {
        if (isNode(part, 'Ampersand')) {
          const amp = part as Ampersand;
          const n = amp as unknown as Node;
          if (n.hasFlag(F_IMPLICIT_AMPERSAND)) {
            const resolved = amp.getResolvedSelector();
            if (
              resolved
              && !(resolved instanceof Nil)
              && (includeNonListImplicit || isNode(resolved, 'SelectorList'))
            ) {
              const repl = materialize(resolved.copy(true) as Selector);
              if (isNode(repl, 'ComplexSelector')) {
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