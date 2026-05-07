import type { AtRule } from '../at-rule.js';
import type { Rules } from '../rules.js';
import { Ruleset } from '../ruleset.js';
import { F_AMPERSAND, F_EXTENDED, type Node } from '../node.js';
import type { IToken } from 'chevrotain';
import type { TriviaMap } from '../../types/index.js';
import {
  type FinalPrintOptions,
  OutputWriter,
  getPrintOptions,
  savePrintState,
  restorePrintState,
  saveArrayState,
  restoreArrayState,
  saveSetState,
  restoreSetState,
  getCachedComposedSelector,
  setCachedComposedSelector
} from './print.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
import type { Selector } from '../selector.js';
import { SelectorList } from '../selector-list.js';
import { consumeTriviaText, getPrintableTriviaTokens, isBlockCommentTriviaToken } from './trivia.js';

type TriviaSide = 'before' | 'after';

function boundaryOffset(node: Node, side: TriviaSide): number | undefined {
  return side === 'before' ? node.location[0] : node.location[3];
}

export function hasPrintableTriviaAt(
  node: Node,
  side: TriviaSide,
  options?: Pick<FinalPrintOptions, 'context' | 'trivia'>
): boolean {
  const trivia = options?.trivia ?? node.treeContext?.opts?.trivia;
  if (!trivia) {
    return false;
  }
  const tokens = trivia.lookup(boundaryOffset(node, side), side);
  const printable = getPrintableTriviaTokens(tokens, options);
  return Boolean(printable?.some(token => token.image.trim() !== ''));
}

function hasPrintableTrivia(
  node: Node,
  options?: Pick<FinalPrintOptions, 'context' | 'trivia'>
): boolean {
  return hasPrintableTriviaAt(node, 'before', options)
    || hasPrintableTriviaAt(node, 'after', options);
}

function captureNodeTrivia(
  node: Node,
  side: TriviaSide,
  options: FinalPrintOptions
): string {
  const trivia: TriviaMap | undefined = options.trivia ?? node.treeContext?.opts?.trivia;
  if (trivia && options.trivia !== trivia) {
    options.trivia = trivia;
  }
  if (!trivia) {
    return '';
  }
  return consumeTriviaText(trivia, boundaryOffset(node, side), side, options);
}

function renderNodeText(node: Node, options: FinalPrintOptions): string {
  const writer = options.writer;
  const mark = writer.mark();
  const out = node.toTrimmedString(options);
  const text = writer.getSince(mark) || out;
  writer.restore(mark);
  return text;
}

function isBareAmpersandSelectorForSerialize(sel: Selector | Nil | undefined): boolean {
  const isBareAmpNode = (node: Selector): boolean => {
    return isNode(node, N.Ampersand)
      && (node.value.appendValue === undefined || node.value.appendValue === '');
  };
  if (!sel || sel instanceof Nil) {
    return false;
  }
  if (isBareAmpNode(sel)) {
    return true;
  }
  if (isNode(sel, N.ComplexSelector) || isNode(sel, N.CompoundSelector)) {
    const [first] = sel.value;
    return sel.value.length === 1 && first !== undefined && isBareAmpNode(first);
  }
  if (isNode(sel, N.SelectorList)) {
    return (sel as SelectorList).value.every((item: Selector) => isBareAmpersandSelectorForSerialize(item));
  }
  return false;
}

type RenderRuleEntry = {
  node: Node;
};

function hasLeadingBlockComment(node: Node, options?: Pick<FinalPrintOptions, 'context' | 'trivia'>): boolean {
  const trivia = options?.trivia ?? node.treeContext?.opts?.trivia;
  const tokens = getPrintableTriviaTokens(trivia?.lookup(node.location[0], 'before'), options);
  if (!tokens) {
    return false;
  }
  return tokens.some(isBlockCommentTriviaToken);
}

function isAncestorFrame(frame: AtRule | Ruleset, node: AtRule | Ruleset): boolean {
  let current: Node | undefined = node.parent;
  while (current) {
    if (current === frame) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function containsNodeType(value: unknown, type: string): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const node = value as { type?: unknown; value?: unknown };
  if (node.type === type) {
    return true;
  }
  const childValue = node.value;
  if (Array.isArray(childValue)) {
    return childValue.some(child => containsNodeType(child, type));
  }
  return containsNodeType(childValue, type);
}

function canMergeSameHeaderRuleset(
  currentFrame: Ruleset,
  priorFrame: Ruleset
): boolean {
  const currentOwn = (currentFrame.options as { ownSelector?: Selector | Nil } | undefined)?.ownSelector;
  const priorOwn = (priorFrame.options as { ownSelector?: Selector | Nil } | undefined)?.ownSelector;
  const currentSelector = currentOwn ?? currentFrame.value.selector;
  const priorSelector = priorOwn ?? priorFrame.value.selector;
  return (
    rulesetHasExtendedTopLevelSelector(currentFrame)
    || rulesetHasExtendedTopLevelSelector(priorFrame)
    || isNode(currentOwn, N.Ampersand)
    || isNode(priorOwn, N.Ampersand)
    || containsNodeType(currentSelector, 'InterpolatedSelector')
    || containsNodeType(priorSelector, 'InterpolatedSelector')
  );
}

export function flattenVisibleRulesForRender(
  rules: Rules,
  options: Pick<FinalPrintOptions, 'context' | 'trivia'>,
  allowTransparentRulesetFlatten: boolean = false
): RenderRuleEntry[] {
  const leadingLeafEntries: RenderRuleEntry[] = [];
  const trailingEntries: RenderRuleEntry[] = [];
  let encounteredContainer = false;

  const pushLeaf = (node: Node, forceLeading: boolean = false) => {
    if (forceLeading || !encounteredContainer) {
      leadingLeafEntries.push({ node });
      return;
    }
    trailingEntries.push({ node });
  };

  const pushContainer = (node: Node) => {
    encounteredContainer = true;
    trailingEntries.push({ node });
  };

  const iterateRules = (
    current: Rules,
    allowTransparentFlatten: boolean,
    forceLeadingLeaves: boolean = false
  ) => {
    for (const child of current.value) {
      const isEvaluatedDefinitionNode = current.evaluated && isNode(child, N.Mixin | N.VarDeclaration);
      if (isEvaluatedDefinitionNode && !hasPrintableTrivia(child, options)) {
        continue;
      }
      if (isNode(child, N.Rules)) {
        if (!child.visible && !child.fullRender && !hasPrintableTrivia(child, options)) {
          continue;
        }
        if (hasLeadingBlockComment(child, options)) {
          pushContainer(child);
          continue;
        }
        if ((child.options as { referenceMode?: boolean } | undefined)?.referenceMode === true) {
          pushContainer(child);
          continue;
        }
        iterateRules(child, allowTransparentFlatten, forceLeadingLeaves);
        continue;
      }
      if (
        allowTransparentFlatten
        && isNode(child, N.Ruleset)
        && child.value.rules
      ) {
        const ownSelector = (child.options as { ownSelector?: Selector | Nil } | undefined)?.ownSelector;
        if (
          ownSelector
          && isBareAmpersandSelectorForSerialize(ownSelector)
          && !isBareAmpersandSelectorForSerialize(child.value.selector)
        ) {
          const visibleChildren = child.value.rules.value.filter(node => node.visible || node.fullRender);
          const hasVisibleContainers = visibleChildren.some(node => isNode(node, N.Rules | N.Ruleset | N.AtRule));
          if (!hasVisibleContainers) {
            for (const leaf of visibleChildren) {
              pushLeaf(leaf, true);
            }
            continue;
          }
        }
      }
      if (
        allowTransparentFlatten
        && isNode(child, N.Ruleset)
        && isBareAmpersandSelectorForSerialize(child.value.selector)
        && child.value.rules
      ) {
        iterateRules(child.value.rules, true, true);
        continue;
      }
      if (child.visible || child.fullRender || hasPrintableTrivia(child, options)) {
        if (isNode(child, N.Ruleset | N.AtRule)) {
          pushContainer(child);
          continue;
        }
        pushLeaf(child, forceLeadingLeaves);
      }
    }
  };
  iterateRules(rules, allowTransparentRulesetFlatten);
  return [...leadingLeafEntries, ...trailingEntries];
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

export function normalizeBlockTrivia(trivia: string, idt: string): string {
  const comments = trivia.match(/\/\*[\s\S]*?\*\//gu);
  if (!comments?.length) {
    return normalizeIndent(trivia, idt);
  }
  const out = comments.join('\n');
  return idt ? normalizeIndent(out, idt, true) : out;
}

export function normalizeLeadingBlockTrivia(text: string, idt: string): string {
  let pos = 0;
  const comments: string[] = [];
  while (pos < text.length) {
    const whitespace = /^[ \t\r\n\f]*/u.exec(text.slice(pos))?.[0] ?? '';
    pos += whitespace.length;
    const comment = /^\/\*[\s\S]*?\*\//u.exec(text.slice(pos))?.[0];
    if (!comment) {
      pos -= whitespace.length;
      break;
    }
    comments.push(comment);
    pos += comment.length;
  }
  if (!comments.length) {
    return normalizeIndent(text, idt);
  }
  const rest = text.slice(pos).replace(/^[ \t\r\n\f]+/u, '');
  const trivia = normalizeBlockTrivia(comments.join('\n'), idt);
  return rest ? `${trivia}\n${normalizeIndent(rest, idt)}` : trivia;
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

function getHoistedParent(
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
  let parentSelector: Selector | undefined;
  for (let i = 0; i < rulesetFrames.length; i++) {
    const currentFrame = rulesetFrames[i]!;
    const currentSelector = currentFrame.value.selector;
    if (!currentSelector || currentSelector instanceof Nil) {
      continue;
    }
    const nextSelector = currentSelector as Selector;
    parentSelector = parentSelector
      ? Ruleset.composeSelector(nextSelector, parentSelector)
      : nextSelector;
  }
  return parentSelector ? { frame, selector: parentSelector } : undefined;
}

function renderHoistedParentHeader(
  parent: { frame: Ruleset; selector: Selector },
  options: FinalPrintOptions,
  depth: number
): string {
  const writer = new OutputWriter();
  parent.selector.toString({
    ...options,
    writer,
    collapseNesting: false,
    composedSelectorStack: []
  });
  const selectorOut = writer.toString();
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
  // A bare `&` selector is a selector-transparent wrapper. Whether authored
  // directly or generated around hoisted content, it should not emit its own
  // header; its children render against the current parent frame instead.
  let isTransparentWrapper = false;
  if (options.collapseNesting && isNode(node, N.Ruleset)) {
    const rs = node as Ruleset;
    const rawParentComposed = options.composedSelectorStack?.at(-1);
    const referenceComposeAmpCount = ((rs.options?.ownSelector ?? rs.value.selector)?.valueOf()?.match(/&/g) ?? []).length;
    // In reference mode, strip non-extended items from a SelectorList parent
    // before composing. This mirrors the filter applied at header render time
    // for reference-imported rulesets — the visible compose parent is only
    // the items that will actually appear in the output.
    const parentComposed = (
      options.referenceMode === true
      && options.referenceRenderEnabled === true
      && rawParentComposed
    )
      ? Ruleset.filterExtendedForReferenceCompose(
        rawParentComposed,
        referenceComposeAmpCount > 1
      ) ?? rawParentComposed
      : rawParentComposed;
    const sel = rs.value.selector;
    const isBareAmp = sel && !(sel instanceof Nil) && isNode(sel, N.Ampersand);
    if (isBareAmp) {
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
        if (options.referenceMode === true && options.referenceRenderEnabled === true) {
          cached = Ruleset.expandGeneratedIsForReferenceCompose(cached) ?? cached;
        }
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
    const rulesToRender = flattenVisibleRulesForRender(
      rules,
      options,
      options.collapseNesting === true
      && (isNode(node, N.Ruleset) || Boolean(getHoistedParent(node, options)))
    );
    const declarationOutputCache = new Map<number, string>();
    const declarationTriviaCache = new Map<number, Set<IToken[]>>();
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
        queue.push(current.sourceNode, current.parent);
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
      const declEmittedTrivia = saveSetState(options.emittedTrivia);
      options.writer = declWriter;
      options.depth = options.depth + 1;
      const declOut = node.toTrimmedString(options);
      const emittedDuringCapture = new Set<IToken[]>();
      if (options.emittedTrivia) {
        for (const tokens of options.emittedTrivia) {
          if (!declEmittedTrivia?.has(tokens)) {
            emittedDuringCapture.add(tokens);
          }
        }
      }
      restoreSetState(options.emittedTrivia, declEmittedTrivia);
      restorePrintState(options, declSaved);
      declarationOutputCache.set(i, declOut);
      declarationTriviaCache.set(i, emittedDuringCapture);
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
      const hoistedParent = getHoistedParent(node, options);
      const ensureRenderedFrames = (leafFrames: Array<AtRule | Ruleset>) => {
        let matches = -1;
        for (let i = 0; i < lastRenderedFrames.length; i++) {
          const currentFrame = leafFrames[i];
          const priorHeader = frameHeaders[i];
          if (!currentFrame || priorHeader === undefined) {
            break;
          }
          const priorFrame = lastRenderedFrames[i];
          if (!priorFrame) {
            break;
          }
          options.depth = i;
          const headerProbeEmittedTrivia = saveSetState(options.emittedTrivia);
          const currentHeader = (
            hoistedParent && i === leafFrames.length - 1 && currentFrame === hoistedParent.frame
          )
            ? renderHoistedParentHeader(hoistedParent, options, i)
            : currentFrame.getHeaderString(options, true);
          const priorComparableHeader = (
            hoistedParent && i === leafFrames.length - 1 && priorFrame === hoistedParent.frame
          )
            ? renderHoistedParentHeader(hoistedParent, options, i)
            : priorFrame.getHeaderString(options, true);
          restoreSetState(options.emittedTrivia, headerProbeEmittedTrivia);
          const sameRenderedRulesetFrame = isNode(currentFrame, N.Ruleset)
            && isNode(priorFrame, N.Ruleset)
            && (
              currentFrame === priorFrame
              || isAncestorFrame(priorFrame, currentFrame)
              || isAncestorFrame(currentFrame, priorFrame)
              || canMergeSameHeaderRuleset(currentFrame, priorFrame)
            );
          const sameHeader = (
            currentHeader === priorComparableHeader
            && (
              currentFrame === priorFrame
              || sameRenderedRulesetFrame
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
          const f = leafFrames[i]!;
          lastRenderedFrames.push(f);
          options.depth = i;
          if (s === undefined) {
            s = (
              hoistedParent && i === leafFrames.length - 1 && f === hoistedParent.frame
            )
              ? renderHoistedParentHeader(hoistedParent, options, i)
              : leafFrames[i]!.getHeaderString(options);
            frameHeaders[i] = s;
          } else if (s === '') {
            s = (
              hoistedParent && i === leafFrames.length - 1 && f === hoistedParent.frame
            )
              ? renderHoistedParentHeader(hoistedParent, options, i)
              : leafFrames[i]!.getHeaderString(options, true);
            frameHeaders[i] = s;
          }
          w.add(s!);
        }
      };

      /** Don't output selector yet. Let's see if any child rules need hoisting. */
      for (let idx = 0; idx < rulesToRender.length; idx++) {
        const entry = rulesToRender[idx]!;
        let n = entry.node;
        const isContainer = isNode(n, N.Ruleset | N.AtRule | N.Rules);

        if (!n.visible && !n.fullRender && !hasPrintableTrivia(n, options)) {
          continue;
        }
        if (isNode(n, N.Comment) && originatesFromReferenceImport(n) && !originatesFromCall(n)) {
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
          const leadingSaved = savePrintState(options, ['depth', 'referenceMode', 'referenceRenderEnabled']);
          options.depth = options.depth + 1;
          options.referenceMode = inReferenceMode;
          options.referenceRenderEnabled = renderEnabled;
          const leading = captureNodeTrivia(n, 'before', options);
          restorePrintState(options, leadingSaved);
          if (!/^\s*$/.test(leading)) {
            let leafFrames = inFrames;
            if (hoistedParent) {
              leafFrames = [...inFrames, hoistedParent.frame];
            }
            ensureRenderedFrames(leafFrames);
            const idt = indent(lastRenderedFrames.length);
            const normalized = /\/\*/u.test(leading) ? normalizeBlockTrivia(leading, idt) : normalizeIndent(leading, idt);
            w.add(normalized);
            if (/\/\*/u.test(leading) && normalized && !normalized.endsWith('\n')) {
              w.add('\n');
            }
          }
          const childOut = serializeRulesContainerInternal(n as AtRule | Ruleset, options, false);
          if (!childOut && !hasPrintableTrivia(n, options)) {
            continue;
          }
          continue;
        }

        /** Re-widen type after accumulated isNode narrowing above */
        const nn = n as Node;
        if (isNode(nn, N.Rules)) {
          const hasRenderableChild = nn.value.some(child =>
            child.visible || child.fullRender || hasPrintableTrivia(child, options)
          );
          if (!hasRenderableChild && !hasPrintableTrivia(nn, options)) {
            continue;
          }
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
          const previewInFramesLength = options.inFrames.length;
          const previewTreeFramesLength = options.treeFrames.length;
          const previewLastRenderedFramesLength = options.lastRenderedFrames.length;
          const previewFrameHeadersLength = options.frameHeaders.length;
          const previewComposedSelectorStackLength = options.composedSelectorStack?.length;
          const previewEmittedTrivia = saveSetState(options.emittedTrivia);
          options.depth = options.depth + 1;
          options.referenceMode = childReferenceMode;
          options.referenceRenderEnabled = childReferenceRenderEnabled;
          const previewOut = renderNodeText(nn, getPrintOptions(options));
          restoreSetState(options.emittedTrivia, previewEmittedTrivia);
          options.inFrames.length = previewInFramesLength;
          options.treeFrames.length = previewTreeFramesLength;
          options.lastRenderedFrames.length = previewLastRenderedFramesLength;
          options.frameHeaders.length = previewFrameHeadersLength;
          if (options.composedSelectorStack && previewComposedSelectorStackLength !== undefined) {
            options.composedSelectorStack.length = previewComposedSelectorStackLength;
          }
          restorePrintState(options, previewSaved);
          if (!previewOut && !hasPrintableTrivia(nn, options)) {
            continue;
          }
        }
        let leafFrames = inFrames;
        if (hoistedParent) {
          leafFrames = [...inFrames, hoistedParent.frame];
        }
        ensureRenderedFrames(leafFrames);

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
        const isHiddenStructuralNode = !nn.visible && !nn.fullRender;
        const leading = captureNodeTrivia(nn, 'before', options);
        const out = isHiddenStructuralNode
          ? ''
          : isNode(nn, N.Declaration)
            ? (declarationOutputCache.get(idx) ?? renderNodeText(nn, options))
            : isNode(nn, N.Rules)
              ? renderNodeText(nn, options)
              : renderNodeText(nn, options);
        if (isNode(nn, N.Declaration) && declarationOutputCache.has(idx)) {
          const emittedTrivia = options.emittedTrivia ?? (options.emittedTrivia = new Set());
          const cachedTrivia = declarationTriviaCache.get(idx);
          if (cachedTrivia) {
            for (const tokens of cachedTrivia) {
              emittedTrivia.add(tokens);
            }
          }
        }
        restorePrintState(options, leafSaved);
        // Suppress pure-void Any nodes from generating blank output lines.
        if (
          isNode(nn, N.Any)
          && !nn.requiredSemi
          && !out.trim()
          && !leading.trim()
        ) {
          continue;
        }
        if (isHiddenStructuralNode) {
          if (!/^\s*$/.test(leading)) {
            const normalized = /\/\*/u.test(leading) ? normalizeBlockTrivia(leading, idt) : normalizeIndent(leading, idt);
            const trimmed = normalized.replace(/[ \t]+$/u, '');
            w.add(trimmed);
            if (/\/\*/u.test(leading) && trimmed && !trimmed.endsWith('\n')) {
              w.add('\n');
            }
          }
          continue;
        }
        if (isNode(nn, N.Declaration)) {
          const hasLeadingDeclarationBlockComment = /\/\*/u.test(leading.trimStart());
          if (hasLeadingDeclarationBlockComment) {
            const normalizedStandaloneLeading = normalizeBlockTrivia(leading, idt).replace(/[ \t]+$/u, '');
            if (normalizedStandaloneLeading) {
              w.add(normalizedStandaloneLeading);
              if (!normalizedStandaloneLeading.endsWith('\n')) {
                w.add('\n');
              }
            }
          }
          const normalizedLeading = hasLeadingDeclarationBlockComment
            ? (leading.match(/\n([ \t]*)$/u)?.[1] ?? '')
            : leading.replace(/^[\s\S]*\n([ \t]*)$/g, '$1');
          const declIn = normalizedLeading + out;
          const hasEmptyValue = /:\s*$/.test(out);
          // Preserve the single post-colon space for empty declaration values (Less parity: `x: ;`).
          // `normalizeIndent(..., true)` trims end-of-line whitespace and would collapse this to `x:;`.
          const declNormalized = hasEmptyValue && (!normalizedLeading || normalizedLeading.trim() === '')
            ? `${idt}${out}`
            : normalizeIndent(declIn, idt, true);
          if (nn.value.name.valueOf().startsWith('--')) {
            w.add(idt);
            w.add(out, nn);
          } else {
            w.add(declNormalized, nn);
          }
        } else if (isNode(nn, N.Rules)) {
          if (!/^\s*$/.test(leading)) {
            w.add(/\/\*/u.test(leading) ? normalizeBlockTrivia(leading, idt) : normalizeIndent(leading, idt));
          }
          /**
       * `Rules` nodes can be produced by evaluations like detached ruleset calls.
       * `Rules.toTrimmedString()` already emits correctly indented child declarations for the
       * provided depth, so do not prefix another `idt` here (that would double-indent).
       */
          w.add(out, nn);
        } else if (isLeafAtRule) {
          if (!/^\s*$/.test(leading)) {
            w.add(/\/\*/u.test(leading) ? normalizeBlockTrivia(leading, idt) : normalizeIndent(leading, idt));
          }
          w.add(out, nn);
        } else {
          if (!/^\s*$/.test(leading)) {
            w.add(/\/\*/u.test(leading) ? normalizeBlockTrivia(leading, idt) : normalizeIndent(leading, idt));
          }
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
        const trailing = captureNodeTrivia(nn, 'after', options);

        if (!/^\s*$/.test(trailing)) {
          w.add(/\/\*/u.test(trailing) ? normalizeBlockTrivia(trailing, idt) : normalizeIndent(trailing, idt));
        }
      // }
      // else {
      //   n.toString({ ...options, depth: options.depth + 1 });
      // }
      }
      if (
        hoistedParent
        && !closeFramesOnExit
        && lastRenderedFrames[lastRenderedFrames.length - 1] === hoistedParent.frame
      ) {
        const parentDepth = lastRenderedFrames.length - 1;
        w.add(indent(parentDepth) + '}\n');
        frameHeaders.pop();
        lastRenderedFrames.pop();
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
