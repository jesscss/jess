import type { AtRule } from '../at-rule.js';
import type { Rules } from '../rules.js';
import { Ruleset } from '../ruleset.js';
import { F_EXTENDED, type Node } from '../node.js';
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
  withScratchEmittedTrivia
} from './print.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
import type { Selector } from '../selector.js';
import { consumeTriviaText, getPrintableTriviaTokens, isBlockCommentTriviaToken } from './trivia.js';
import { keepsDuplicateMixinOutputDeclaration } from './mixin-output-slot.js';

type TriviaSide = 'before' | 'after';
type SerializeProfileCounter =
  | 'duplicateDeclarationComparisonContainers'
  | 'duplicateDeclarationPrerenderedDeclarations'
  | 'emissionRenderNodeTextPreviewCalls'
  | 'emissionRenderNodeTextRulesPreviewCalls'
  | 'emissionRenderNodeTextDeclarationFallbackCalls'
  | 'emissionRenderNodeTextLeafCalls';

const SERIALIZE_PROFILE_COUNTERS_KEY = '__JESS_SERIALIZE_PROFILE_COUNTERS__';

type SerializeProfileGlobals = typeof globalThis & {
  [SERIALIZE_PROFILE_COUNTERS_KEY]?: Partial<Record<SerializeProfileCounter, number>>;
};

const serializeProfileGlobals = globalThis as SerializeProfileGlobals;
const serializeProfileCounters = serializeProfileGlobals[SERIALIZE_PROFILE_COUNTERS_KEY];

function incrementSerializeProfileCounter(counter: SerializeProfileCounter): void {
  serializeProfileCounters![counter] = (serializeProfileCounters![counter] ?? 0) + 1;
}

function boundaryOffset(node: Node, side: TriviaSide): number | undefined {
  return side === 'before' ? node.location[0] : node.location[3];
}

export function hasPrintableTriviaAt(
  node: Node,
  side: TriviaSide,
  options?: Pick<FinalPrintOptions, 'context' | 'trivia'>
): boolean {
  const trivia = options?.trivia ?? node.sourceRoot?._treeContext?.opts?.trivia;
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
  const trivia: TriviaMap | undefined = options.trivia ?? node.sourceRoot?._treeContext?.opts?.trivia;
  if (trivia && options.trivia !== trivia) {
    options.trivia = trivia;
  }
  if (!trivia) {
    return '';
  }
  return consumeTriviaText(trivia, boundaryOffset(node, side), side, options);
}

function renderNodeText(
  node: Node,
  options: FinalPrintOptions,
  reason: 'rules-preview' | 'declaration-fallback' | 'leaf' = 'leaf'
): string {
  if (serializeProfileCounters) {
    incrementSerializeProfileCounter('emissionRenderNodeTextPreviewCalls');
    if (reason === 'rules-preview') {
      incrementSerializeProfileCounter('emissionRenderNodeTextRulesPreviewCalls');
    } else if (reason === 'declaration-fallback') {
      incrementSerializeProfileCounter('emissionRenderNodeTextDeclarationFallbackCalls');
    } else {
      incrementSerializeProfileCounter('emissionRenderNodeTextLeafCalls');
    }
  }
  if (reason === 'declaration-fallback') {
    const writer = new OutputWriter();
    node.writeSyntax(getPrintOptions({
      ...options,
      writer
    }));
    return writer.toString();
  }
  if (reason === 'rules-preview') {
    const writer = new OutputWriter();
    node.writeSyntax(getPrintOptions({
      ...options,
      writer
    }));
    return writer.toString();
  }
  const writer = new OutputWriter();
  node.writeSyntax(getPrintOptions({
    ...options,
    writer
  }));
  return writer.toString();
}

type RenderRuleEntry = {
  node: Node;
};

function hasLeadingBlockComment(node: Node, options?: Pick<FinalPrintOptions, 'context' | 'trivia'>): boolean {
  const trivia = options?.trivia ?? node.sourceRoot?._treeContext?.opts?.trivia;
  const tokens = getPrintableTriviaTokens(trivia?.lookup(node.location[0], 'before'), options);
  if (!tokens) {
    return false;
  }
  return tokens.some(isBlockCommentTriviaToken);
}

function getContainerRules(node: AtRule | Ruleset, options?: FinalPrintOptions): Rules | undefined {
  return isNode(node, N.AtRule)
    ? (
        node === options?.atRuleBodyNode
          ? options.atRuleBodyOverride
          : node.getRenderRules()
      )
    : node.rules;
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
  const currentSelector = currentOwn ?? currentFrame.selector;
  const priorSelector = priorOwn ?? priorFrame.selector;
  return (
    currentFrame.hasFlag(F_EXTENDED)
    || priorFrame.hasFlag(F_EXTENDED)
    || Ruleset.hasExtendedTopLevelSelector(currentFrame.selector)
    || Ruleset.hasExtendedTopLevelSelector(priorFrame.selector)
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
    for (const child of current.rules) {
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
        && getContainerRules(child)
      ) {
        const ownSelector = (child.options as { ownSelector?: Selector | Nil } | undefined)?.ownSelector;
        if (
          ownSelector
          && Ruleset.isBareAmpersandSelector(ownSelector)
          && !Ruleset.isBareAmpersandSelector(child.selector)
        ) {
          const childRules = getContainerRules(child)!.rules;
          let hasVisibleContainers = false;
          for (let i = 0; i < childRules.length; i++) {
            const visibleChild = childRules[i]!;
            if (
              (visibleChild.visible || visibleChild.fullRender)
              && isNode(visibleChild, N.Rules | N.Ruleset | N.AtRule)
            ) {
              hasVisibleContainers = true;
              break;
            }
          }
          if (!hasVisibleContainers) {
            for (let i = 0; i < childRules.length; i++) {
              const leaf = childRules[i]!;
              if (leaf.visible || leaf.fullRender) {
                pushLeaf(leaf, true);
              }
            }
            continue;
          }
        }
      }
      if (
        allowTransparentFlatten
        && isNode(child, N.Ruleset)
        && Ruleset.isBareAmpersandSelector(child.selector)
        && getContainerRules(child)
      ) {
        iterateRules(getContainerRules(child)!, true, true);
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

function getHoistedParent(
  node: AtRule | Ruleset,
  options: FinalPrintOptions
): { frame: Ruleset; selector: Selector } | undefined {
  if (!isNode(node, N.AtRule)) {
    return undefined;
  }
  const atRule = node as AtRule;
  const runtimeFrames = options.atRuleFrameNode === atRule
    ? options.atRuleFrameOverride
    : undefined;
  const runtimeHoist = options.atRuleHoistNode === atRule
    ? options.atRuleHoistOverride
    : undefined;
  const hoisted = runtimeFrames !== undefined && atRule.isNestable()
    ? true
    : (runtimeHoist ?? atRule.isHoisted(options));
  if (!atRule.isNestable() || atRule.isRootOnly() || !hoisted) {
    return undefined;
  }
  const renderFrames = runtimeFrames ?? atRule.getRenderFrames();
  let frame: Ruleset | undefined;
  let parentSelector: Selector | undefined;
  const frameCount = renderFrames?.length ?? 0;
  for (let i = 0; i < frameCount; i++) {
    const currentFrame = renderFrames![i]!;
    if (!isNode(currentFrame, N.Ruleset)) {
      continue;
    }
    frame = currentFrame;
    const currentSelector = currentFrame.selector;
    if (!currentSelector || currentSelector instanceof Nil) {
      continue;
    }
    const nextSelector = currentSelector as Selector;
    parentSelector = parentSelector
      ? Ruleset.composeSelector(nextSelector, parentSelector)
      : nextSelector;
  }
  if (!frame) {
    return undefined;
  }
  return parentSelector ? { frame, selector: parentSelector } : undefined;
}

function renderHoistedParentHeader(
  parent: { frame: Ruleset; selector: Selector },
  options: FinalPrintOptions,
  depth: number
): string {
  const writer = new OutputWriter();
  parent.selector.writeSyntax({
    ...options,
    writer,
    collapseNesting: false,
    composedSelectorStack: []
  });
  const selectorOut = writer.toString();
  return normalizeIndent(selectorOut.replace(/\s+$/, '') + ' {', indent(depth)) + '\n';
}

const DIRECT_RULESET_HEADER = '\u0000';

function renderHoistedParentComparableHeader(
  parent: { frame: Ruleset; selector: Selector },
  options: FinalPrintOptions
): string {
  const writer = new OutputWriter();
  parent.selector.writeSyntax({
    ...options,
    writer,
    collapseNesting: false,
    composedSelectorStack: []
  });
  writer.trimEndSince(0);
  return writer.toString();
}

function serializeRulesContainerInternal(node: AtRule | Ruleset, options: FinalPrintOptions, closeFramesOnExit: boolean): string {
  const w = options.writer;
  let inFrames = options.inFrames;
  const frameHeaders = options.frameHeaders;

  if (isNode(node, N.Ruleset) && (node as Ruleset).selector instanceof Nil) {
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
    const sel = rs.selector;
    const isBareAmp = sel && !(sel instanceof Nil) && isNode(sel, N.Ampersand);
    if (isBareAmp) {
      isTransparentWrapper = true;
    } else {
      const cached = sel && !(sel instanceof Nil)
        ? rs.composeHeaderSelector(options, sel, undefined, {
            skipCurrentCachedParent: false,
            skipSameSelectorCompose: false
          })
        : undefined;
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
    const nodeExtendsReference = isNode(node, N.Ruleset)
      && (node.hasFlag(F_EXTENDED) || Ruleset.hasExtendedTopLevelSelector(node.selector));
    const inheritedRenderEnabled = enteringReferenceMode ? false : previousReferenceRenderEnabled;
    const renderEnabled = inReferenceMode ? (inheritedRenderEnabled || nodeExtendsReference) : true;
    options.referenceMode = inReferenceMode;
    options.referenceRenderEnabled = renderEnabled;
    const rules = getContainerRules(node, options);
    if (!rules) {
      if (inReferenceMode && !renderEnabled) {
        return '';
      }
      // Leaf at-rules (no body) are not "frame headers". Always emit them with comments
      // preserved; comment-stripping should only apply to repeated *frame* headers.
      node.writeSyntax(options);
      return w.getSince(mark);
    }
    const rulesToRender = flattenVisibleRulesForRender(
      rules,
      options,
      options.collapseNesting === true
      && (isNode(node, N.Ruleset) || Boolean(getHoistedParent(node, options)))
    );
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
    const originatesFromMixin = (n: any): boolean => sourceChainHas(n, current => current?.type === 'Mixin');
    const originatesFromControl = (n: any): boolean => sourceChainHas(n, current =>
      current?.type === 'For' || current?.type === 'While' || current?.type === 'If'
    );
    const keepsDuplicateGeneratedOutput = (n: any): boolean => keepsDuplicateMixinOutputDeclaration(n);
    if (rulesToRender.length === 0) {
      return '';
    }

    // Less-style duplicate declaration handling:
    // for each property, keep the last exact serialized declaration and skip earlier duplicates.
    if (serializeProfileCounters) {
      incrementSerializeProfileCounter('duplicateDeclarationComparisonContainers');
    }
    const declarationCountsByProp = new Map<string, number>();
    for (let i = 0; i < rulesToRender.length; i++) {
      const node = rulesToRender[i]!.node;
      if (!isNode(node, N.Declaration) || isNode(node, N.VarDeclaration)) {
        continue;
      }
      const declProp = node.name.valueOf();
      declarationCountsByProp.set(declProp, (declarationCountsByProp.get(declProp) ?? 0) + 1);
    }
    for (let i = rulesToRender.length - 1; i >= 0; i--) {
      const node = rulesToRender[i]!.node;
      if (!isNode(node, N.Declaration) || isNode(node, N.VarDeclaration)) {
        continue;
      }
      const declProp = node.name.valueOf();
      if ((declarationCountsByProp.get(declProp) ?? 0) < 2) {
        continue;
      }
      const declWriter = new OutputWriter();
      const declSaved = savePrintState(options, ['writer', 'depth']);
      options.writer = declWriter;
      options.depth = options.depth + 1;
      if (serializeProfileCounters) {
        incrementSerializeProfileCounter('duplicateDeclarationPrerenderedDeclarations');
      }
      withScratchEmittedTrivia(options, () => {
        node.writeSyntax(options);
      });
      const declOut = declWriter.toString();
      restorePrintState(options, declSaved);
      const declKey = `${declOut}${node.requiredSemi ? ';' : ''}`;
      let seenValues = seenDeclarationsByProp.get(declProp);
      if (!seenValues) {
        seenValues = new Set<string>();
        seenDeclarationsByProp.set(declProp, seenValues);
      }
      if (
        seenValues.has(declKey)
        && !originatesFromCall(node)
        && !originatesFromMixin(node)
        && !originatesFromControl(node)
        && !keepsDuplicateGeneratedOutput(node)
      ) {
        skippedDuplicateDeclarations.add(i);
      } else {
        seenValues.add(declKey);
      }
    }

    const hoisted = isNode(node, N.AtRule) && options.atRuleFrameNode === node
      ? true
      : isNode(node, N.AtRule) && options.atRuleHoistNode === node
        ? (options.atRuleHoistOverride ?? node.isHoisted(options))
        : node.isHoisted(options);
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
          const [currentHeader, priorComparableHeader] = withScratchEmittedTrivia(options, () => [
            (
              hoistedParent && i === leafFrames.length - 1 && currentFrame === hoistedParent.frame
            )
              ? renderHoistedParentComparableHeader(hoistedParent, options)
              : isNode(currentFrame, N.Ruleset)
                ? currentFrame.getComparableHeaderString(options)
                : currentFrame.getHeaderString(options, true),
            (
              hoistedParent && i === leafFrames.length - 1 && priorFrame === hoistedParent.frame
            )
              ? renderHoistedParentComparableHeader(hoistedParent, options)
              : isNode(priorFrame, N.Ruleset)
                ? priorFrame.getComparableHeaderString(options)
                : priorFrame.getHeaderString(options, true)
          ]);
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
          if (s === undefined || s === DIRECT_RULESET_HEADER) {
            s = (
              hoistedParent && i === leafFrames.length - 1 && f === hoistedParent.frame
            )
              ? renderHoistedParentHeader(hoistedParent, options, i)
              : isNode(f, N.Ruleset) && !options.trivia
                ? (f.writeHeader(options) ? DIRECT_RULESET_HEADER : '')
                : leafFrames[i]!.getHeaderString(options);
            frameHeaders[i] = s;
          } else if (s === '') {
            s = (
              hoistedParent && i === leafFrames.length - 1 && f === hoistedParent.frame
            )
              ? renderHoistedParentHeader(hoistedParent, options, i)
              : isNode(f, N.Ruleset) && !options.trivia
                ? (f.writeHeader(options, true) ? DIRECT_RULESET_HEADER : '')
                : leafFrames[i]!.getHeaderString(options, true);
            frameHeaders[i] = s;
          }
          if (s !== DIRECT_RULESET_HEADER) {
            w.add(s!);
          }
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

        const isLeafAtRule = isNode(n, N.AtRule) && !getContainerRules(n as AtRule, options);
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
        let leafFrames = inFrames;
        if (hoistedParent) {
          leafFrames = [...inFrames, hoistedParent.frame];
        }
        let renderedRulesOutput: string | undefined;
        let renderedRulesTrivia: Set<IToken[]> | undefined;
        if (isNode(nn, N.Rules)) {
          const hasRenderableChild = nn.rules.some(child =>
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
          const rulesSaved = savePrintState(options, [
            'depth',
            'referenceMode',
            'referenceRenderEnabled'
          ]);
          const rulesInFramesLength = options.inFrames.length;
          const rulesTreeFramesLength = options.treeFrames.length;
          const rulesLastRenderedFramesLength = options.lastRenderedFrames.length;
          const rulesFrameHeadersLength = options.frameHeaders.length;
          const rulesComposedSelectorStackLength = options.composedSelectorStack?.length;
          renderedRulesTrivia = new Set<IToken[]>();
          const previousEmittedTrivia = options.emittedTrivia;
          options.depth = leafFrames.length;
          options.referenceMode = childReferenceMode;
          options.referenceRenderEnabled = childReferenceRenderEnabled;
          options.emittedTrivia = renderedRulesTrivia;
          renderedRulesOutput = renderNodeText(nn, getPrintOptions(options), 'rules-preview');
          options.emittedTrivia = previousEmittedTrivia;
          options.inFrames.length = rulesInFramesLength;
          options.treeFrames.length = rulesTreeFramesLength;
          options.lastRenderedFrames.length = rulesLastRenderedFramesLength;
          options.frameHeaders.length = rulesFrameHeadersLength;
          if (options.composedSelectorStack && rulesComposedSelectorStackLength !== undefined) {
            options.composedSelectorStack.length = rulesComposedSelectorStackLength;
          }
          restorePrintState(options, rulesSaved);
          if (!renderedRulesOutput && !hasPrintableTrivia(nn, options)) {
            continue;
          }
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
            ? renderNodeText(nn, options, 'declaration-fallback')
            : renderedRulesOutput !== undefined
              ? renderedRulesOutput
              : renderNodeText(nn, options);
        if (renderedRulesTrivia) {
          const emittedTrivia = options.emittedTrivia ?? (options.emittedTrivia = new Set());
          for (const tokens of renderedRulesTrivia) {
            emittedTrivia.add(tokens);
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
        if (
          isNode(nn, N.Rules)
          && !out
          && !leading.trim()
          && !hasPrintableTrivia(nn, options)
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
          if (nn.name.valueOf().startsWith('--')) {
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
      let atRuleCount = 0;
      for (let i = 0; i < treeFrames.length; i++) {
        const frame = treeFrames[i]!;
        if (isNode(frame, N.AtRule)) {
          treeFrames[atRuleCount++] = frame;
        }
      }
      treeFrames.length = atRuleCount;
      treeFrames.push(node);
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
