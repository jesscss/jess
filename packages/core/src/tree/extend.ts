import {
  defineType,
  Node,
  F_VISIBLE,
  F_NON_STATIC,
  F_IMPLICIT_AMPERSAND,
  F_MAY_ASYNC,
  type NodeLocation,
  type NodeOptions
} from './node.js';
import { type Context } from '../context.js';
import { attachSelectorBitLibrary, Selector } from './selector.js';
import { Ampersand } from './ampersand.js';
import type { Rules } from './rules.js';
import type { Ruleset } from './ruleset.js';
import { createPublicNil, Nil } from './nil.js';
import { ComplexSelector, type ComplexSelectorComponent } from './selector-complex.js';
import { Combinator } from './combinator.js';
import { createGeneratedIsPseudo } from './selector-pseudo.js';
import { SelectorList } from './selector-list.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { copySelectorForPlacement } from './util/selector-utils.js';
import {
  renderInvisibleEffect,
  type RenderBuffer
} from './util/render-buffer.js';

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
  constructor(value: ExtendValue, options?: NodeOptions, location?: NodeLocation) {
    super(value, options, location);
    this.removeFlag(F_VISIBLE);
    this.addFlags(F_NON_STATIC, F_MAY_ASYNC);
  }

  override valueOf() {
    return `$extend ${this.value.target.valueOf()}`;
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    let { target, selector, flag, namespace } = this.value;
    w.add('$extend');
    if (selector) {
      w.add(' ');
      const saved = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      selector.writeSyntax(options);
      options.suppressBoundaryTrivia = saved;
      w.add(' ->');
    }
    w.add(' ');
    if (namespace) {
      w.add(`${namespace}|`);
    }
    const saved = options.suppressBoundaryTrivia;
    options.suppressBoundaryTrivia = 'pre';
    target.writeSyntax(options);
    options.suppressBoundaryTrivia = saved;
    if (flag === ExtendFlag.Exact) {
      w.add(' !exact');
    }
    w.add(';');
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const mark = options.writer.mark();
    this.writeSyntax(options);
    const w = options.writer;
    return w.getSince(mark);
  }

  // Don't prepare Extend early; evaluate it when the ruleset is in the frame.
  // This ensures the ampersand resolves to the correct ruleset selector, not the parent frame

  /** @internal Run the invisible extend registration effect without public render/eval materialization. */
  runEffect(context: Context): MaybePromise<void> {
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
      return undefined;
    }

    const maybeSel = selector.eval(context);
    const register = (sel: Selector | Nil): void => {
      if (sel instanceof Nil) {
        return;
      }
      registerExtendRecord({
        context,
        extendNode: this,
        extendRoot,
        target,
        selector: sel,
        authoredSelector: this.value.selector,
        flag,
        currentFrame: currentFrame && isNode(currentFrame, N.Ruleset) ? currentFrame : undefined
      });
    };
    return isThenable(maybeSel)
      ? maybeSel.then(register)
      : register(maybeSel);
  }

  override evalNode(context: Context): MaybePromise<Nil> {
    const effect = this.runEffect(context);
    return isThenable(effect)
      ? effect.then(createPublicNil)
      : createPublicNil();
  }

  override resolve(context: Context): MaybePromise<Nil> {
    return this.evalNode(context);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, _options?: PrintOptions): string | MaybePromise<string> {
    return renderInvisibleEffect(this.runEffect(context), bufferOrOptions);
  }
}

type RegisterExtendRecordArgs = {
  context: Context;
  extendNode: Extend;
  extendRoot: Rules;
  target: Selector;
  selector: Selector;
  authoredSelector: Selector | undefined;
  flag: ExtendFlag | undefined;
  currentFrame: Ruleset | undefined;
};

function registerExtendRecord(args: RegisterExtendRecordArgs): void {
  const {
    context,
    extendNode,
    extendRoot,
    target,
    selector,
    authoredSelector,
    flag,
    currentFrame
  } = args;
  const { selectorBits } = context;
  // Resolve ampersand to its current parent selector if needed (live resolution for extend)
  let resolvedSel: Selector = selector;
  if (isNode(selector, N.Ampersand)) {
    const ampResolved = selector.getResolvedSelector();
    if (ampResolved && !(ampResolved instanceof Nil)) {
      resolvedSel = ampResolved;
    }
  }
  // Prefer the current ruleset's full selector (includes implicit &) so extend merges the full
  // selector (e.g. .issue-2586-somepage .content not just .content).
  if (currentFrame) {
    const rs = currentFrame;
    const fullSel = rs.value?.selector;
    let usedParentListComposition = false;
    if (!authoredSelector) {
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
        const parentIs = attachSelectorBitLibrary(
          createGeneratedIsPseudo(copySelectorForExtendRecord(parentSel, selectorBits)),
          selectorBits
        );
        resolvedSel = attachSelectorBitLibrary(ComplexSelector.create([
          parentIs,
          Combinator.create(' '),
          copySelectorForExtendRecord(ownSel, selectorBits)
        ]), selectorBits);
        usedParentListComposition = true;
      }
    }
    if (!authoredSelector && !usedParentListComposition) {
      if (fullSel && !(fullSel instanceof Nil)) {
        resolvedSel = fullSel;
      } else {
        // Extend ran during selector eval (e.g. .content:extend(...)); current frame is the parent.
        // Build full selector as parent + ' ' + resolvedSel (e.g. .issue-2586-somepage .content).
        const parentSel = currentFrame.value?.selector;
        if (parentSel && !(parentSel instanceof Nil) && resolvedSel.valueOf() !== parentSel.valueOf()) {
          resolvedSel = attachSelectorBitLibrary(ComplexSelector.create([
            copySelectorForExtendRecord(parentSel, selectorBits),
            Combinator.create(' '),
            copySelectorForExtendRecord(resolvedSel, selectorBits)
          ]), selectorBits);
        }
      }
    }
  }
  resolvedSel = materializeImplicitAmpersands(resolvedSel, flag !== ExtendFlag.All);
  attachSelectorBitLibrary(resolvedSel, selectorBits);
  const docOrder = getDocumentOrderForExtend(currentFrame, context);
  const extendRootOptions = extendRoot.options;
  // Same reference-scope tagging for sync path.
  const fromReferenceScope = (
    context.inReferenceImportScope
    || ('referenceMode' in extendRootOptions && extendRootOptions.referenceMode === true)
  );
  context.extends.push([target, resolvedSel, flag === ExtendFlag.All, extendRoot, extendNode, docOrder, fromReferenceScope]);
}

function getRulesetOwnSelector(ruleset: Ruleset): Selector | undefined {
  const { options } = ruleset;
  const ownSelector = options && 'ownSelector' in options ? options.ownSelector : undefined;
  return ownSelector instanceof Nil ? undefined : ownSelector;
}

function copySelectorForExtendRecord(
  selector: Selector,
  library: Selector['keySetLibrary']
): Selector {
  return copySelectorForPlacement(selector, library ?? selector.keySetLibrary);
}

function materializeImplicitAmpersands(
  selector: Selector,
  includeNonListImplicit: boolean
): Selector {
  if (!hasMaterializableImplicitAmpersand(selector, includeNonListImplicit)) {
    return selector;
  }
  const library = selector.keySetLibrary;
  const copySelector = (node: Selector): Selector => copySelectorForExtendRecord(node, library);
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
          return materialize(copySelector(resolved));
        }
      }
      return copySelector(node);
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
              const repl = materialize(copySelector(resolved));
              if (isNode(repl, N.ComplexSelector)) {
                parts.push(...repl.value.map(item => copySelector(item) as ComplexSelectorComponent));
              } else {
                parts.push(copySelector(repl) as ComplexSelectorComponent);
              }
              continue;
            }
          }
        }
        const repl = materialize(part);
        parts.push(copySelector(repl) as ComplexSelectorComponent);
      }
      return attachSelectorBitLibrary(ComplexSelector.create(parts).inherit(node), library);
    }

    if (isNode(node, N.SelectorList)) {
      return attachSelectorBitLibrary(
        SelectorList.create(node.value.map(item => materialize(item as Selector))).inherit(node),
        library
      );
    }

    return copySelector(node);
  };

  return attachSelectorBitLibrary(materialize(selector), library);
}

function hasMaterializableImplicitAmpersand(
  selector: Selector,
  includeNonListImplicit: boolean
): boolean {
  const isMaterializableResolvedSelector = (value: Selector | Nil | undefined): value is Selector => (
    !!value
    && !(value instanceof Nil)
    && (includeNonListImplicit || isNode(value, N.SelectorList))
  );

  const visit = (node: Selector): boolean => {
    if (isNode(node, N.Ampersand)) {
      return node.hasFlag(F_IMPLICIT_AMPERSAND)
        && isMaterializableResolvedSelector(node.getResolvedSelector());
    }

    if (isNode(node, N.ComplexSelector)) {
      return node.value.some(part => (
        !isNode(part, N.Combinator)
        && visit(part)
      ));
    }

    if (isNode(node, N.SelectorList)) {
      return node.value.some(item => visit(item as Selector));
    }

    return false;
  };

  return visit(selector);
}

/** Document order for extend: prefer parse location startOffset (source order), else assigned map, else push order (length). */
function getDocumentOrderForExtend(rs: Ruleset | undefined, context: Context): number {
  if (!rs) {
    return context.extends.length;
  }
  const loc = rs.location;
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
