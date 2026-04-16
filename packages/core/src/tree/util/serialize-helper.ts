import type { AtRule } from '../at-rule.js';
import type { Rules } from '../rules.js';
import { Ruleset } from '../ruleset.js';
import { F_AMPERSAND, F_EXTENDED, type Node } from '../node.js';
import {
  type FinalPrintOptions,
  OutputWriter,
  savePrintState,
  restorePrintState,
  saveArrayState,
  restoreArrayState,
  getCachedComposedSelector,
  setCachedComposedSelector
} from './print.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
import type { Selector } from '../selector.js';
import { SelectorList } from '../selector-list.js';

function isBareAmpersandSelectorForSerialize(sel: Selector | Nil | undefined): boolean {
  if (!sel || sel instanceof Nil) {
    return false;
  }
  if (isNode(sel, N.Ampersand)) {
    return true;
  }
  if (isNode(sel, N.SelectorList)) {
    return (sel as SelectorList).value.every((item: Selector) => isNode(item, N.Ampersand));
  }
  return false;
}

type RenderRuleEntry = {
  node: Node;
};

function flattenVisibleRulesForRender(rules: Rules): RenderRuleEntry[] {
  const entries: RenderRuleEntry[] = [];
  const iterateRules = (current: Rules) => {
    for (const child of current.value) {
      if (isNode(child, N.Rules)) {
        if (!child.visible && !child.fullRender) {
          continue;
        }
        if ((child.options as { referenceMode?: boolean } | undefined)?.referenceMode === true) {
          entries.push({
            node: child
          });
          continue;
        }
        iterateRules(child);
        continue;
      }
      if (child.visible || child.fullRender) {
        entries.push({
          node: child
        });
      }
    }
  };
  iterateRules(rules);
  return entries;
}
/**
 * Normalizes the indent of a multi-line string by replacing initial whitespace.
 */
export function normalizeIndent(multiLineString: string, indent: string, maintainRelative?: boolean): string {
  if (!maintainRelative) {
    return multiLineString.replace(/^\s*/, indent).replace(/[ \t\r\f]*\n\s*/g, '\n' + indent);
  }

  // Find the first line's original indent length
  const firstLineMatch = multiLineString.match(/^(?:\n*|[ \t\r\f]*\n+)(\s*)/);
  const firstLineOriginalIndentLength = firstLineMatch ? firstLineMatch[1]!.length : 0;

  // Use replace with callback to process each line in one pass
  let isFirstLine = true;
  return multiLineString.replace(/(?:^|\n)(\s*)([^\n]*)/g, (match, lineIndent, lineContent) => {
    if (isFirstLine) {
      isFirstLine = false;
      return indent + lineContent.trimEnd();
    }

    const lineOriginalIndentLength = lineIndent.length;
    // Calculate the difference from the first line's indent
    const indentDifference = lineOriginalIndentLength - firstLineOriginalIndentLength;
    // Apply the difference to the new indent to maintain relative spacing
    const newLineIndent = indent + ' '.repeat(Math.max(0, indentDifference));
    return '\n' + newLineIndent + lineContent.trimEnd();
  });
}

export function indent(depth: number): string {
  return ''.padStart(depth * 2);
}

function rulesetHasExtendedTopLevelSelector(node: Ruleset): boolean {
  // The ruleset itself gets F_EXTENDED when an extend points at (or through)
  // it, even in the self-extend case where the items themselves don't carry
  // the flag (a self-extend adds nothing new). Check the ruleset first, then
  // fall back to the item-level check for selectors where the ruleset flag
  // hasn't propagated.
  if (node.hasFlag(F_EXTENDED)) {
    return true;
  }
  const selector = node.value.selector;
  if (!selector || selector instanceof Nil) {
    return false;
  }
  if (isNode(selector, N.SelectorList)) {
    return selector.value.some(item => item.hasFlag(F_EXTENDED));
  }
  return selector.hasFlag(F_EXTENDED);
}

function getHoistedRulesetCarrier(
  node: AtRule | Ruleset,
  options: FinalPrintOptions
): { frame: Ruleset; selector: Selector } | undefined {
  if (!isNode(node, N.AtRule)) {
    return undefined;
  }
  const atRule = node as AtRule;
  if (!atRule.isNestable() || atRule.isRootOnly() || !atRule.isHoisted(options)) {
    return undefined;
  }
  const rulesetFrames = (atRule.frames ?? []).filter(frame => isNode(frame, N.Ruleset));
  if (rulesetFrames.length === 0) {
    return undefined;
  }
  const frame = rulesetFrames[rulesetFrames.length - 1]!;
  let carriedSelector: Selector | undefined;
  for (let i = 0; i < rulesetFrames.length; i++) {
    const currentFrame = rulesetFrames[i]!;
    const currentSelector = currentFrame.value.selector;
    if (!currentSelector || currentSelector instanceof Nil) {
      continue;
    }
    const nextSelector = currentSelector as Selector;
    carriedSelector = carriedSelector
      ? Ruleset.composeSelector(nextSelector, carriedSelector)
      : nextSelector;
  }
  return carriedSelector ? { frame, selector: carriedSelector } : undefined;
}

function getCarriedRulesetHeader(
  carrier: { frame: Ruleset; selector: Selector },
  options: FinalPrintOptions,
  depth: number
): string {
  const previousComposedSelectorStack = options.composedSelectorStack;
  const saved = savePrintState(options, ['collapseNesting', 'composedSelectorStack']);
  options.collapseNesting = false;
  options.composedSelectorStack = previousComposedSelectorStack ?? [];
  const savedStack = saveArrayState(options.composedSelectorStack);
  if (options.composedSelectorStack) {
    options.composedSelectorStack.length = 0;
  }
  const selectorOut = options.writer.capture(() => carrier.selector.toString(options));
  restoreArrayState(options.composedSelectorStack, savedStack);
  restorePrintState(options, saved);
  return normalizeIndent(selectorOut.replace(/\s+$/, '') + ' {', indent(depth)) + '\n';
}

function serializeRulesContainerInternal(node: AtRule | Ruleset, options: FinalPrintOptions, closeFramesOnExit: boolean): string {
  const w = options.writer;
  let inFrames = options.inFrames;
  const frameHeaders = options.frameHeaders;

  if (isNode(node, N.Ruleset) && (node as Ruleset).value.selector instanceof Nil) {
    return '';
  }
  // Ensure every Ruleset pushes to composedSelectorStack for collapseNesting.
  // getHeaderString normally handles this, but cached frame headers skip it.
  let pushedComposed = false;
  let pushedComposedSelector: Selector | undefined;
  // A bare `&` selector with no real parent on the stack is a generated
  // wrapper (e.g. synthetic `& { ... }` wrapping @media body when hoisted).
  // It must be fully transparent: don't compose, don't push, don't emit as a
  // frame — just render children as if they were direct children of the
  // parent at-rule.
  let isTransparentWrapper = false;
  if (options.collapseNesting && isNode(node, N.Ruleset)) {
    const rs = node as Ruleset;
    const rawParentComposed = options.composedSelectorStack?.at(-1);
    // In reference mode, strip non-extended items from a SelectorList parent
    // before composing. This mirrors the filter applied at header render time
    // for reference-imported rulesets — the visible compose parent is only
    // the items that will actually appear in the output.
    const parentComposed = (
      options.referenceMode === true
      && options.referenceRenderEnabled === true
      && rawParentComposed
    )
      ? Ruleset.filterExtendedForReferenceCompose(rawParentComposed) ?? rawParentComposed
      : rawParentComposed;
    const sel = rs.value.selector;
    const isBareAmp = sel && !(sel instanceof Nil) && isNode(sel, N.Ampersand);
    if (isBareAmp && !parentComposed) {
      isTransparentWrapper = true;
    } else {
      let cached = getCachedComposedSelector(options, rs);
      if (!cached && sel && !(sel instanceof Nil)) {
        const ownSelector = rs.options?.ownSelector;
        const structuralParentFrame = rs.hoistToRoot === true ? rs.parent?.parent : undefined;
        const structuralParent = isNode(structuralParentFrame, N.Ruleset)
          ? structuralParentFrame.value.selector
          : null;
        const composeParent = parentComposed ?? (
          structuralParent && !(structuralParent instanceof Nil) ? structuralParent : null
        );
        const hasExtendedComposeContext = Boolean(
          rulesetHasExtendedTopLevelSelector(rs)
          || (composeParent && !(composeParent instanceof Nil) && (
            composeParent.hasFlag(F_EXTENDED)
            || (isNode(composeParent, N.SelectorList)
              && composeParent.value.some(item => item.hasFlag(F_EXTENDED)))
          ))
        );
        const composeInput = (
          ownSelector
          && ownSelector.hasFlag(F_AMPERSAND)
          && !isBareAmpersandSelectorForSerialize(ownSelector)
          && composeParent
          && hasExtendedComposeContext
        )
          ? ownSelector
          : sel;
        cached = composeParent
          ? Ruleset.composeSelector(composeInput, composeParent)
          : composeInput;
        if (composeParent) {
          setCachedComposedSelector(options, rs, cached);
        }
      }
      if (cached) {
        pushedComposed = true;
        pushedComposedSelector = cached;
      }
    }
  }
  const run = () => {
    const mark = w.mark();
    const previousReferenceMode = options.referenceMode === true;
    const previousReferenceRenderEnabled = options.referenceRenderEnabled !== false;
    const ownReferenceMode = Boolean(
      node.options
      && 'referenceMode' in node.options
      && node.options.referenceMode === true
    );
    const inReferenceMode = previousReferenceMode || ownReferenceMode;
    const enteringReferenceMode = !previousReferenceMode && ownReferenceMode;
    const nodeExtendsReference = isNode(node, N.Ruleset) && rulesetHasExtendedTopLevelSelector(node);
    const inheritedRenderEnabled = enteringReferenceMode ? false : previousReferenceRenderEnabled;
    const renderEnabled = inReferenceMode ? (inheritedRenderEnabled || nodeExtendsReference) : true;
    options.referenceMode = inReferenceMode;
    options.referenceRenderEnabled = renderEnabled;
    const rules = node.value.rules;
    if (!rules) {
      if (inReferenceMode && !renderEnabled) {
        return '';
      }
      // Leaf at-rules (no body) are not "frame headers". Always emit them with comments
      // preserved; comment-stripping should only apply to repeated *frame* headers.
      w.add(node.getHeaderString(options, false));
      return w.getSince(mark);
    }

    const rulesToRender = flattenVisibleRulesForRender(rules);
    const declarationOutputCache = new Map<number, string>();
    const skippedDuplicateDeclarations = new Set<number>();
    const seenDeclarationsByProp = new Map<string, Set<string>>();
    const sourceChainHas = (start: any, predicate: (n: any) => boolean): boolean => {
      const seen = new Set<any>();
      const queue: any[] = [start];
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || seen.has(current)) {
          continue;
        }
        seen.add(current);
        if (predicate(current)) {
          return true;
        }
        queue.push(current.sourceNode, current.sourceParent, current.parent);
      }
      return false;
    };
    const originatesFromReferenceImport = (n: any): boolean => {
      return sourceChainHas(n, (current) => {
        if (current?.type !== 'StyleImport') {
          return false;
        }
        const importOptions = current.options?.importOptions;
        return importOptions?.reference === true || importOptions?._dedupe === true;
      });
    };
    const originatesFromCall = (n: any): boolean => sourceChainHas(n, current => current?.type === 'Call');
    if (rulesToRender.length === 0) {
      return '';
    }

    // Less-style duplicate declaration handling:
    // for each property, keep the last exact serialized declaration and skip earlier duplicates.
    for (let i = rulesToRender.length - 1; i >= 0; i--) {
      const node = rulesToRender[i]!.node;
      if (!isNode(node, N.Declaration) || isNode(node, N.VarDeclaration)) {
        continue;
      }
      const declWriter = new OutputWriter();
      const declSaved = savePrintState(options, ['writer', 'depth']);
      options.writer = declWriter;
      options.depth = options.depth + 1;
      const declOut = node.toTrimmedString(options);
      restorePrintState(options, declSaved);
      declarationOutputCache.set(i, declOut);
      const declKey = `${declOut}${node.requiredSemi ? ';' : ''}`;
      const declProp = node.value.name.valueOf();
      let seenValues = seenDeclarationsByProp.get(declProp);
      if (!seenValues) {
        seenValues = new Set<string>();
        seenDeclarationsByProp.set(declProp, seenValues);
      }
      if (seenValues.has(declKey)) {
        skippedDuplicateDeclarations.add(i);
      } else {
        seenValues.add(declKey);
      }
    }

    const hoisted = node.isHoisted(options);
    // const isRuleset = isNode(node, 'Ruleset');
    const treeFrames = options.treeFrames!;
    const renderRulesBody = () => {
      if (isTransparentWrapper) {
      // Transparent `&` wrapper: don't add self as a frame, just render children
      // using the parent frame context.
        options.inFrames = inFrames = treeFrames!;
      } else if (!hoisted) {
        options.inFrames = inFrames = treeFrames!;
        inFrames.push(node);
      }
      // Note: in the hoisted branch above, `node` is already included.

      let lastRenderedFrames = options.lastRenderedFrames;

      /** Don't output selector yet. Let's see if any child rules need hoisting. */
      for (let idx = 0; idx < rulesToRender.length; idx++) {
        const entry = rulesToRender[idx]!;
        let n = entry.node;
        const isContainer = isNode(n, N.Ruleset | N.AtRule | N.Rules);

        if (!n.visible && !n.fullRender) {
          continue;
        }
        if (isNode(n, N.Comment) && originatesFromReferenceImport(n) && !originatesFromCall(n)) {
          continue;
        }
        if (
          isNode(n, N.Any)
          && String(n.valueOf?.() ?? '').trimStart().startsWith('/*')
          && originatesFromReferenceImport(n)
          && !originatesFromCall(n)
        ) {
          continue;
        }
        if (inReferenceMode && !renderEnabled && !isContainer) {
          continue;
        }
        if (isNode(n, N.Declaration) && !isNode(n, N.VarDeclaration) && skippedDuplicateDeclarations.has(idx)) {
          continue;
        }

        const isLeafAtRule = isNode(n, N.AtRule) && !(n as AtRule).value.rules;
        if (isNode(n, N.Ruleset) || (isNode(n, N.AtRule) && !isLeafAtRule)) {
          const childOut = serializeRulesContainerInternal(n as AtRule | Ruleset, options, false);
          if (!childOut) {
            continue;
          }
          continue;
        }

        /** Re-widen type after accumulated isNode narrowing above */
        const nn = n as Node;
        if (isNode(nn, N.Rules)) {
          const ownReferenceMode = (nn.options as { referenceMode?: boolean } | undefined)?.referenceMode === true;
          const childReferenceMode = inReferenceMode || ownReferenceMode;
          const enteringReferenceMode = !inReferenceMode && ownReferenceMode;
          const childReferenceRenderEnabled = childReferenceMode
            ? (enteringReferenceMode ? false : renderEnabled)
            : true;
          const previewSaved = savePrintState(options, [
            'depth',
            'referenceMode',
            'referenceRenderEnabled'
          ]);
          options.depth = options.depth + 1;
          options.referenceMode = childReferenceMode;
          options.referenceRenderEnabled = childReferenceRenderEnabled;
          const previewOut = w.capture(() => nn.toTrimmedString(options));
          restorePrintState(options, previewSaved);
          if (!previewOut) {
            continue;
          }
        }
        let leafFrames = inFrames;
        const carriedRuleset = getHoistedRulesetCarrier(node, options);
        if (carriedRuleset) {
          leafFrames = [...inFrames, carriedRuleset.frame];
        }

        let matches = -1;
        /** Close current frames if needed */
        for (let i = 0; i < lastRenderedFrames.length; i++) {
          const currentFrame = leafFrames[i];
          const priorHeader = frameHeaders[i];
          if (!currentFrame || priorHeader === undefined) {
            break;
          }
          options.depth = i;
          const currentHeader = (
            carriedRuleset && i === leafFrames.length - 1 && currentFrame === carriedRuleset.frame
          )
            ? getCarriedRulesetHeader(carriedRuleset, options, i)
            : currentFrame.getHeaderString(options);
          const priorFrame = lastRenderedFrames[i];
          const sameHeader = (
            currentHeader === priorHeader
            && (
              !isNode(currentFrame, N.AtRule)
              || currentFrame === priorFrame
            )
          );
          if (!sameHeader) {
            break;
          }
          matches = i;
        }
        for (let i = lastRenderedFrames.length - 1; i > matches; i--) {
          w.add(indent(i) + '}\n');
          frameHeaders.pop();
          lastRenderedFrames.pop();
          options.depth = i;
        }

        for (let i = matches + 1; i < leafFrames.length; i++) {
          let s = frameHeaders[i];
          let f = leafFrames[i]!;
          lastRenderedFrames.push(f);
          options.depth = i;
          if (s === undefined) {
            s = (
              carriedRuleset && i === leafFrames.length - 1 && f === carriedRuleset.frame
            )
              ? getCarriedRulesetHeader(carriedRuleset, options, i)
              : leafFrames[i]!.getHeaderString(options);
            frameHeaders[i] = s;
          } else if (s === '') {
            s = (
              carriedRuleset && i === leafFrames.length - 1 && f === carriedRuleset.frame
            )
              ? getCarriedRulesetHeader(carriedRuleset, options, i)
              : leafFrames[i]!.getHeaderString(options, true);
            frameHeaders[i] = s;
          }
          w.add(s!);
        }

        // if (isNode(n, N.Declaration)) {
        const leafDepth = lastRenderedFrames.length;
        let idt = indent(leafDepth);
        const ownReferenceMode = isNode(nn, N.Rules)
          && (nn.options as { referenceMode?: boolean } | undefined)?.referenceMode === true;
        const childReferenceMode = isNode(nn, N.Rules)
          ? (inReferenceMode || ownReferenceMode)
          : inReferenceMode;
        const enteringChildReferenceMode = isNode(nn, N.Rules)
          ? (!inReferenceMode && ownReferenceMode)
          : false;
        const childReferenceRenderEnabled = isNode(nn, N.Rules)
          ? (
              childReferenceMode
                ? (enteringChildReferenceMode ? false : renderEnabled)
                : true
            )
          : renderEnabled;
        const leafSaved = savePrintState(options, [
          'depth',
          'referenceMode',
          'referenceRenderEnabled'
        ]);
        options.depth = leafDepth;
        options.referenceMode = childReferenceMode;
        options.referenceRenderEnabled = childReferenceRenderEnabled;
        const pre = w.capture(() => nn.processPrePost('pre', undefined, options));
        const out = isNode(nn, N.Declaration)
          ? (declarationOutputCache.get(idx) ?? w.capture(() => nn.toTrimmedString(options)))
          : w.capture(() => nn.toTrimmedString(options));
        restorePrintState(options, leafSaved);
        // Suppress pure-void Any nodes from generating blank output lines.
        if (
          isNode(nn, N.Any)
          && !nn.requiredSemi
          && !out.trim()
          && !pre.trim()
        ) {
          continue;
        }
        if (isNode(nn, N.Declaration)) {
          const normalizedPre = pre.replace(/^[\s\S]*\n([ \t]*)$/g, '$1');
          const declIn = normalizedPre + out;
          const hasEmptyValue = /:\s*$/.test(out);
          // Preserve the single post-colon space for empty declaration values (Less parity: `x: ;`).
          // `normalizeIndent(..., true)` trims end-of-line whitespace and would collapse this to `x:;`.
          const declNormalized = hasEmptyValue && (!normalizedPre || normalizedPre.trim() === '')
            ? `${idt}${out}`
            : normalizeIndent(declIn, idt, true);
          if (nn.value.name.valueOf().startsWith('--')) {
            w.add(idt);
            w.add(out, nn);
          } else {
            w.add(declNormalized, nn);
          }
        } else if (isNode(nn, N.Rules)) {
          /**
       * `Rules` nodes can be produced by evaluations like detached ruleset calls.
       * `Rules.toTrimmedString()` already emits correctly indented child declarations for the
       * provided depth, so do not prefix another `idt` here (that would double-indent).
       */
          w.add(out, nn);
        } else if (isLeafAtRule) {
          w.add(out, nn);
        } else {
          w.add(idt);
          w.add(out, nn);
        }
        /** @todo - optionally add semi-colon for compression */
        // if (n.requiredSemi && next) {
        //   w.add(';');
        // }
        if (nn.requiredSemi) {
          w.add(';');
        }

        w.add('\n');
        let post = w.capture(() => nn.processPrePost('post', undefined, options));

        if (!/^\s*$/.test(post)) {
          w.add(normalizeIndent(post, idt));
        }
      // }
      // else {
      //   n.toString({ ...options, depth: options.depth + 1 });
      // }
      }
      if (!isTransparentWrapper) {
        inFrames.pop();
        if (closeFramesOnExit) {
          frameHeaders.pop();
        }
      }
      if (closeFramesOnExit) {
        let renderedLength = lastRenderedFrames.length;
        while (treeFrames.length < renderedLength) {
          w.add(indent(renderedLength - 1) + '}\n');
          options.depth--;
          lastRenderedFrames.pop();
          renderedLength = lastRenderedFrames.length;
        }
      }
      return w.getSince(mark);
    };
    if (hoisted && !isTransparentWrapper) {
      const savedFrames = saveArrayState(treeFrames);
      // When hoisting, we must reset the active frame stack to at-rules only.
      // Otherwise, previously-rendered non-hoisted rulesets (e.g. `.header`) can remain
      // in `treeFrames` and cause nested output like:
      //   .header { :is(.header-nav, .footer .footer-nav) { ... } }
      // even though the current node is hoisted to root.
      const atRulesOnly = treeFrames.filter(f => isNode(f, N.AtRule));
      treeFrames.splice(0, treeFrames.length, ...atRulesOnly, node);
      options.inFrames = inFrames = treeFrames;
      const out = renderRulesBody();
      restoreArrayState(treeFrames, savedFrames);
      return out;
    }
    return renderRulesBody();
  };

  const saved = savePrintState(options, [
    'referenceMode',
    'referenceRenderEnabled',
    'depth',
    'inFrames',
    'composedSelectorStack'
  ]);
  const runWithCurrentComposedStack = () => {
    if (!pushedComposed || !pushedComposedSelector) {
      return run();
    }
    const stack = options.composedSelectorStack ?? (options.composedSelectorStack = []);
    const pushedStackSnapshot = saveArrayState(stack);
    stack.push(pushedComposedSelector);
    const out = run();
    restoreArrayState(stack, pushedStackSnapshot);
    return out;
  };
  let runResult: string;
  if (isNode(node, N.AtRule) && (node as AtRule).isRootOnly()) {
    const currentStack = options.composedSelectorStack;
    if (currentStack) {
      const rootStackSnapshot = saveArrayState(currentStack);
      currentStack.length = 0;
      options.composedSelectorStack = currentStack;
      runResult = runWithCurrentComposedStack();
      restoreArrayState(currentStack, rootStackSnapshot);
    } else {
      options.composedSelectorStack = [];
      runResult = runWithCurrentComposedStack();
    }
  } else {
    runResult = runWithCurrentComposedStack();
  }
  restorePrintState(options, saved);
  return runResult;
}

/**
 * Handles flattening and serializing of at-rules and rulesets.
 * This is the normal entrypoint: the container fully owns opening and closing
 * its rendered frame stack.
 */
export function serializeRulesContainer(node: AtRule | Ruleset, options: FinalPrintOptions): string {
  return serializeRulesContainerInternal(node, options, true);
}

/**
 * Serialize a rules container as part of an already-linear parent body flow.
 * Parent `Rules` owns final frame closure, so this leaves matching rendered
 * frames open for subsequent sibling reconciliation.
 */
export function serializeRulesContainerInline(node: AtRule | Ruleset, options: FinalPrintOptions): string {
  return serializeRulesContainerInternal(node, options, false);
}
