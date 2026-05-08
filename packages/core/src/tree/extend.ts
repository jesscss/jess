import { defineType, Node, F_VISIBLE, F_NON_STATIC, F_IMPLICIT_AMPERSAND } from './node.js';
import { type Context } from '../context.js';
import { attachSelectorBitLibrary, Selector } from './selector.js';
import { Ampersand } from './ampersand.js';
import type { Ruleset } from './ruleset.js';
import { Nil } from './nil.js';
import { ComplexSelector, type ComplexSelectorComponent } from './selector-complex.js';
import { Combinator } from './combinator.js';
import { PseudoSelector } from './selector-pseudo.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';

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
    const emitTrimmed = (node: Selector) => {
      const saved = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      try {
        node.toString(options);
      } finally {
        options.suppressBoundaryTrivia = saved;
      }
    };
    w.add('$extend');
    if (selector) {
      w.add(' ');
      emitTrimmed(selector);
      w.add(' ->');
    }
    w.add(' ');
    if (namespace) {
      w.add(`${namespace}|`);
    }
    emitTrimmed(target);
    if (flag === ExtendFlag.Exact) {
      w.add(' !exact');
    }
    w.add(';');
    return w.getSince(mark);
  }

  // Don't prepare Extend early; evaluate it when the ruleset is in the frame.
  // This ensures the ampersand resolves to the correct ruleset selector, not the parent frame

  override evalNode(context: Context): MaybePromise<Nil> {
    let { selector, target, flag } = this.value;
    const { selectorBits } = context;
    attachSelectorBitLibrary(target, selectorBits);

    const currentFrame = context.rulesetFrames.at(-1);

    // If selector is undefined, convert it to ampersand so it resolves to the ruleset's selector
    // If selector is already set to a non-ampersand (e.g., from a bubbled extend), keep it as-is
    // The parser sets the selector correctly when bubbling extends, so we should preserve it
    if (!selector) {
      // Set selector to ampersand - it will resolve to the current ruleset's selector when evaluated
      // This matches the conceptual model: .c:extend(.ext all) is like { &:extend(.ext all); } inside .c
      // The frame selector should already be :is(.a, .b) .c (the evaluated selector from ruleset prep).
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
          const rs = currentFrame;
          const fullSel = rs.value?.selector;
          let usedParentListComposition = false;
          if (!this.value.selector) {
            const ownSel = getRulesetOwnSelector(rs);
            const parentFrame = context.rulesetFrames.at(-2);
            const parentSel = (
              parentFrame && isNode(parentFrame, N.Ruleset)
                ? parentFrame.value?.selector
                : undefined
            );
            if (
              ownSel
              && parentSel
              && !(parentSel instanceof Nil)
              && isNode(parentSel, N.SelectorList)
            ) {
              const parentIs = attachSelectorBitLibrary(PseudoSelector.create({
                name: ':is',
                arg: parentSel.copy(true)
              }), selectorBits);
              parentIs.generated = true;
              resolvedSel = attachSelectorBitLibrary(ComplexSelector.create([
                parentIs,
                Combinator.create(' '),
                ownSel.copy(true)
              ]), selectorBits);
              usedParentListComposition = true;
            }
          }
          if (!this.value.selector && !usedParentListComposition) {
            if (fullSel && !(fullSel instanceof Nil)) {
              resolvedSel = fullSel;
            } else {
              // Extend ran during selector eval (e.g. .content:extend(...)); current frame is the parent.
              // Build full selector as parent + ' ' + resolvedSel (e.g. .issue-2586-somepage .content).
              if (isNode(currentFrame, N.Ruleset)) {
                const parentSel = currentFrame.value?.selector;
                if (parentSel && !(parentSel instanceof Nil) && resolvedSel.valueOf() !== parentSel.valueOf()) {
                  resolvedSel = attachSelectorBitLibrary(ComplexSelector.create([
                    parentSel.copy(true),
                    Combinator.create(' '),
                    resolvedSel.copy(true)
                  ]), selectorBits);
                }
              }
            }
          }
        }
        resolvedSel = materializeImplicitAmpersands(resolvedSel, flag !== ExtendFlag.All);
        attachSelectorBitLibrary(resolvedSel, selectorBits);
        const rs = currentFrame;
        const docOrder = getDocumentOrderForExtend(rs, context);
        const extendRootOptions = extendRoot.options;
        // Extends declared while traversing a reference branch are tagged so the
        // extend resolver can keep them non-side-effecting outside that branch.
        const fromReferenceScope = (
          context.inReferenceImportScope
          || ('referenceMode' in extendRootOptions && extendRootOptions.referenceMode === true)
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
    if (isNode(sel, N.Ampersand)) {
      const ampResolved = sel.getResolvedSelector();
      if (ampResolved && !(ampResolved instanceof Nil)) {
        resolvedSel = ampResolved;
      }
    }
    // Prefer the current ruleset's full selector (includes implicit &) so extend merges the full
    // selector (e.g. .issue-2586-somepage .content not just .content).
    if (currentFrame && isNode(currentFrame, N.Ruleset)) {
      const rs = currentFrame;
      const fullSel = rs.value?.selector;
      let usedParentListComposition = false;
      if (!this.value.selector) {
        const ownSel = getRulesetOwnSelector(rs);
        const parentFrame = context.rulesetFrames.at(-2);
        const parentSel = (
          parentFrame && isNode(parentFrame, N.Ruleset)
            ? parentFrame.value?.selector
            : undefined
        );
        if (
          ownSel
          && parentSel
          && !(parentSel instanceof Nil)
          && isNode(parentSel, N.SelectorList)
        ) {
          const parentIs = attachSelectorBitLibrary(PseudoSelector.create({
            name: ':is',
            arg: parentSel.copy(true)
          }), selectorBits);
          parentIs.generated = true;
          resolvedSel = attachSelectorBitLibrary(ComplexSelector.create([
            parentIs,
            Combinator.create(' '),
            ownSel.copy(true)
          ]), selectorBits);
          usedParentListComposition = true;
        }
      }
      if (!this.value.selector && !usedParentListComposition) {
        if (fullSel && !(fullSel instanceof Nil)) {
          resolvedSel = fullSel;
        } else {
          // Extend ran during selector eval (e.g. .content:extend(...)); current frame is the parent.
          // Build full selector as parent + ' ' + resolvedSel (e.g. .issue-2586-somepage .content).
          if (isNode(currentFrame, N.Ruleset)) {
            const parentSel = currentFrame.value?.selector;
            if (parentSel && !(parentSel instanceof Nil) && resolvedSel.valueOf() !== parentSel.valueOf()) {
              resolvedSel = attachSelectorBitLibrary(ComplexSelector.create([
                parentSel.copy(true),
                Combinator.create(' '),
                resolvedSel.copy(true)
              ]), selectorBits);
            }
          }
        }
      }
    }
    resolvedSel = materializeImplicitAmpersands(resolvedSel, flag !== ExtendFlag.All);
    attachSelectorBitLibrary(resolvedSel, selectorBits);
    const rs = currentFrame && isNode(currentFrame, N.Ruleset) ? currentFrame : undefined;
    const docOrder = getDocumentOrderForExtend(rs, context);
    const extendRootOptions = extendRoot.options;
    // Same reference-scope tagging for sync path.
    const fromReferenceScope = (
      context.inReferenceImportScope
      || ('referenceMode' in extendRootOptions && extendRootOptions.referenceMode === true)
    );
    context.extends.push([target, resolvedSel, flag === ExtendFlag.All, extendRoot, this, docOrder, fromReferenceScope]);
    return new Nil();
  }

  override resolve(context: Context): MaybePromise<Nil> {
    return this.evalNode(context);
  }
}

function getRulesetOwnSelector(ruleset: Ruleset): Selector | undefined {
  const { options } = ruleset;
  const ownSelector = options && 'ownSelector' in options ? options.ownSelector : undefined;
  return ownSelector instanceof Nil ? undefined : ownSelector;
}

function isSelectorNode(node: unknown): node is Selector {
  return node instanceof Selector;
}

function materializeImplicitAmpersands(
  selector: Selector,
  includeNonListImplicit: boolean
): Selector {
  const library = selector.keySetLibrary;
  const materialize = (node: Selector): Selector => {
    if (isNode(node, N.Ampersand)) {
      const amp = node;
      if (amp.hasFlag(F_IMPLICIT_AMPERSAND)) {
        const resolved = amp.getResolvedSelector();
        if (
          resolved
          && !(resolved instanceof Nil)
          && (includeNonListImplicit || isNode(resolved, N.SelectorList))
        ) {
          return materialize(attachSelectorBitLibrary(resolved.copy(true) as Selector, library));
        }
      }
      return attachSelectorBitLibrary(node.copy(true) as Selector, library);
    }

    if (isNode(node, N.ComplexSelector)) {
      const complex = node;
      const parts: ComplexSelectorComponent[] = [];
      for (const part of complex.value) {
        if (isNode(part, N.Ampersand)) {
          const amp = part;
          if (amp.hasFlag(F_IMPLICIT_AMPERSAND)) {
            const resolved = amp.getResolvedSelector();
            if (
              resolved
              && !(resolved instanceof Nil)
              && (includeNonListImplicit || isNode(resolved, N.SelectorList))
            ) {
              const repl = materialize(attachSelectorBitLibrary(resolved.copy(true) as Selector, library));
              if (isNode(repl, N.ComplexSelector)) {
                parts.push(...repl.value.map(item => item.copy(true)));
              } else {
                parts.push(repl.copy(true) as ComplexSelectorComponent);
              }
              continue;
            }
          }
        }
        const repl = materialize(part);
        parts.push(repl.copy(true) as ComplexSelectorComponent);
      }
      return attachSelectorBitLibrary(ComplexSelector.create(parts).inherit(node), library);
    }

    const value = Reflect.get(node, 'value');
    if (Array.isArray(value)) {
      const cloned = attachSelectorBitLibrary(node.copy(true), library);
      Reflect.set(cloned, 'value', value.map(item => isSelectorNode(item) ? materialize(item) : item));
      return cloned;
    }

    return attachSelectorBitLibrary(node.copy(true), library);
  };

  return attachSelectorBitLibrary(materialize(selector), library);
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
