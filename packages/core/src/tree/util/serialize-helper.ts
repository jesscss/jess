import { spanStartOf, spanEndOf } from './provenance.js';
import type { AtRule, AtRulePrelude } from '../at-rule.js';
import type { Rules } from '../rules.js';
import { Ruleset } from '../ruleset.js';
import { F_EXTENDED, Node } from '../node.js';
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
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { Selector, type SelectorLike } from '../selector.js';
import { consumeTriviaText, printableTriviaText, triviaHasBlockComment } from './trivia.js';
import { keepsDuplicateMixinOutputDeclaration } from './mixin-output-slot.js';
import { assignSpineChildIndices, isSpineEligibleMixinCall, resolveSpineMixinCall, type SpineMixinCallResolution } from './emit-walk.js';
import { planBodyMerges, type SpineMergePlan } from './spine-merge.js';

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
  return side === 'before' ? spanStartOf(node) : spanEndOf(node);
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
  const run = trivia.lookup(boundaryOffset(node, side), side);
  return printableTriviaText(run, options?.context).trim() !== '';
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

/**
 * Spine-mode leaf resolution (P1 §2).
 *
 * Contract: resolve `node` against the LIVE value-frame (`options.context`, whose
 * `rulesContext` is the frame the container descent pushed) and return its
 * serialized bytes. `eval` is MaybePromise, so this returns `MaybePromise<string>`
 * — the caller threads the promise (see `renderRulesBody`'s `processNode`).
 *
 * Load-bearing invariant: this is the SAME resolution the eval pass produced,
 * now done in place with NO output tree — the resolved node is transient and
 * dropped after serialization. Replaces static `writeSyntax` (which would print
 * `$w`, not the resolved value).
 */
/**
 * Fire the registered generic EMIT-visitor `enter` hooks (design §6) on a
 * resolved output node, threading the shape: `shape = enter(shape) ?? shape`. A
 * `void` return leaves the node unchanged; a `Node` return re-seats it for the
 * next visitor and becomes what is serialized (§6.5). ZERO-cost fast path: with
 * no registered visitors (`spineVisitors` undefined/empty) the node is returned
 * as-is with no iteration — the §4.0-style "pay only for real work" gate.
 *
 * @see docs/future/core-architecture/UNIFIED-EVAL-EMIT-DESIGN.md §6.
 */
function applySpineVisitorsEnter(
  node: Node,
  context: FinalPrintOptions['context']
): Node {
  const visitors = context?.spineVisitors;
  if (!visitors || visitors.length === 0) {
    return node;
  }
  let shape = node;
  for (let i = 0; i < visitors.length; i++) {
    const replaced = visitors[i]!.enter(shape);
    if (replaced) {
      shape = replaced;
    }
  }
  return shape;
}

function resolveSpineLeafText(node: Node, options: FinalPrintOptions): MaybePromise<string> {
  const serialize = (resolved: Node | Nil | undefined): string => {
    if (!resolved || resolved instanceof Nil) {
      return '';
    }
    // Generic EMIT visitor hook (design §6): fire the registered `(node)=>Node|
    // void` enter hooks on the RESOLVED output node at its emit moment. ZERO-cost
    // when nothing is registered — `applySpineVisitorsEnter` returns the node
    // untouched if `context.spineVisitors` is empty. A visitor may REPLACE the
    // node (fresh transient), which is what gets serialized here.
    const hooked = applySpineVisitorsEnter(resolved, options.context);
    if (!hooked || hooked instanceof Nil) {
      return '';
    }
    const writer = new OutputWriter();
    hooked.toString(getPrintOptions({ ...options, writer }));
    return writer.toString();
  };
  // `+:`/`+_:` merge (P1): a suppressed member emits nothing; the anchor emits
  // the coalesced value. Eval the decl FIRST so its assign normalizes (`+:` → a
  // plain `:` printed form, via `normalizedFromAssign`), THEN swap in the combined
  // value (a genuinely new node — no canonical mutation). The combined value was
  // resolved against the live frame during planning.
  const mergeEntry = options.spineMergePlan?.get(node);
  if (mergeEntry) {
    if (mergeEntry.kind === 'suppress') {
      return '';
    }
    const withMergedValue = (resolved: Node | Nil | undefined): string => {
      if (isNode(resolved, N.Declaration)) {
        const anchorDecl = resolved.deriveWithParts({ value: mergeEntry.value });
        // Print the anchor as a plain `prop: value` (not `prop+: …`). `withParts`
        // copies options into a fresh transient, so recording that this declaration
        // was NORMALIZED from a merge assign (`normalizedFromAssign`) — which the
        // decl serializer reads to print `:` — mutates only this per-emit node,
        // never the canonical source.
        const anchorOptions = anchorDecl.options as { assign?: string; normalizedFromAssign?: string };
        if (anchorOptions.normalizedFromAssign === undefined && anchorOptions.assign && anchorOptions.assign !== ':') {
          anchorOptions.normalizedFromAssign = anchorOptions.assign;
        }
        return serialize(anchorDecl);
      }
      return serialize(resolved);
    };
    const evaluatedAnchor = node.eval(options.context!);
    return isThenable(evaluatedAnchor) ? evaluatedAnchor.then(withMergedValue) : withMergedValue(evaluatedAnchor);
  }
  const resolved = node.eval(options.context!);
  return isThenable(resolved) ? resolved.then(serialize) : serialize(resolved);
}

/**
 * Build the `+:`/`+_:` merge plan for `children` (a body about to be descended)
 * and install it on `options.spineMergePlan` for the duration of `fn`, restoring
 * the prior plan on exit (nested bodies each get their own; save/restore keeps
 * them scoped). The plan resolves each merge decl's VALUE against the live frame
 * (`node.eval`) to combine — so it runs AFTER the frame is pushed. No plan is
 * built (and no cost paid) when the body has no merge-flagged declarations.
 */
function withSpineMergePlan(
  children: readonly Node[],
  options: FinalPrintOptions,
  context: NonNullable<FinalPrintOptions['context']>,
  fn: () => MaybePromise<string>
): MaybePromise<string> {
  const resolveValue = (decl: Node): MaybePromise<Node | undefined> => {
    const resolved = decl.eval(context);
    const toValue = (node: Node | undefined): Node | undefined =>
      isNode(node, N.Declaration) ? node.valueNode() : undefined;
    return isThenable(resolved) ? resolved.then(toValue) : toValue(resolved);
  };
  const planResult = planBodyMerges(children, resolveValue);
  const run = (plan: SpineMergePlan | undefined): MaybePromise<string> => {
    if (!plan) {
      return fn();
    }
    const saved = options.spineMergePlan;
    options.spineMergePlan = plan;
    const restorePlan = (text: string): string => {
      options.spineMergePlan = saved;
      return text;
    };
    const out = fn();
    return isThenable(out) ? out.then(restorePlan) : restorePlan(out);
  };
  return isThenable(planResult) ? planResult.then(run) : run(planResult);
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
  /**
   * Spine mixin-fold (cutover increment 2, UNIFIED-EVAL-EMIT-DESIGN §2/§3): the
   * bound SURFACE this entry's node was folded from. When set, the leaf/container
   * is resolved with `context.rulesContext` pushed to this surface (its wired
   * value-frame carries the mixin's lexical/closure/param bindings), so a
   * body reference resolves against the DEFINITION scope — not the enclosing
   * caller frame. Undefined for authored (non-folded) entries.
   */
  spineFrame?: Rules;
};

function hasLeadingBlockComment(node: Node, options?: Pick<FinalPrintOptions, 'context' | 'trivia'>): boolean {
  const trivia = options?.trivia ?? node.sourceRoot?._treeContext?.opts?.trivia;
  return triviaHasBlockComment(trivia?.lookup(spanStartOf(node), 'before'));
}

function getContainerRules(node: AtRule | Ruleset, options?: FinalPrintOptions): Rules | undefined {
  if (!isNode(node, N.AtRule)) {
    return node;
  }
  // AtRuleStatement shares the AtRule bit but extends Node (not Rules) — always a leaf.
  if (!isNode(node, N.Rules)) {
    return undefined;
  }
  if (node === options?.atRuleBodyNode) {
    return options.atRuleBodyOverride;
  }
  // AtRules with no rules are statement at-rules (leaf form, no `{}` block).
  // Return undefined so the serializer calls writeSyntax directly instead of
  // trying to recurse into an empty container.
  return (node as AtRule).getRenderRules().length > 0 ? node : undefined;
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
  if (Array.isArray(value)) {
    return value.some(child => containsNodeType(child, type));
  }
  if (!(value instanceof Node)) {
    return false;
  }
  if (value.type === type) {
    return true;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const childKeys = (value.constructor as typeof Node).childKeys;
  if (!childKeys) {
    return false;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const fields = value as unknown as Record<string, unknown>;
  for (let i = 0; i < childKeys.length; i++) {
    if (containsNodeType(fields[childKeys[i]!], type)) {
      return true;
    }
  }
  return false;
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
    || (currentFrame.selector != null && Ruleset.hasExtendedTopLevelSelector(currentFrame.selector))
    || (priorFrame.selector != null && Ruleset.hasExtendedTopLevelSelector(priorFrame.selector))
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
      const isEvaluatedDefinitionNode = isNode(child, N.Mixin | N.VarDeclaration);
      if (isEvaluatedDefinitionNode && !hasPrintableTrivia(child, options)) {
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
          && (child.selector == null || !Ruleset.isBareAmpersandSelector(child.selector))
        ) {
          const childRules = getContainerRules(child)!.rules;
          let hasVisibleContainers = false;
          for (let i = 0; i < childRules.length; i++) {
            const visibleChild = childRules[i]!;
            if (
              (visibleChild.visible)
              && isNode(visibleChild, N.Rules | N.Ruleset | N.AtRule)
            ) {
              hasVisibleContainers = true;
              break;
            }
          }
          if (!hasVisibleContainers) {
            for (let i = 0; i < childRules.length; i++) {
              const leaf = childRules[i]!;
              if (leaf.visible) {
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
        && child.selector != null
        && Ruleset.isBareAmpersandSelector(child.selector)
        && getContainerRules(child)
      ) {
        iterateRules(getContainerRules(child)!, true, true);
        continue;
      }
      if (child.visible || hasPrintableTrivia(child, options)) {
        if (isNode(child, N.Ruleset | N.AtRule)) {
          pushContainer(child);
          continue;
        }
        if (isNode(child, N.Rules)) {
          if (hasLeadingBlockComment(child, options)) {
            pushContainer(child);
            continue;
          }
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          if (((child as Node).options as { referenceMode?: boolean } | undefined)?.referenceMode === true) {
            pushContainer(child);
            continue;
          }
          iterateRules(child, allowTransparentFlatten, forceLeadingLeaves);
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

// The comparable header a frame emitted the LAST time it was written directly.
// A hoisted (flat) ruleset shared across call sites keeps a single canonical
// frame identity, so `currentFrame === priorFrame` can't tell two emissions of
// the same body apart (e.g. `#foo-foo.bar()` from `mi-test-c-1` vs `mi-test-c-2`
// both emit the shared `.baz`). Recomputing the prior header against the current
// context yields the current call site's selector, hiding the boundary. Comparing
// against the header ACTUALLY emitted last keeps the blocks separate.
const lastEmittedComparableHeader = new WeakMap<AtRule | Ruleset, string>();

function getHoistedParent(
  node: AtRule | Ruleset,
  options: FinalPrintOptions
): { frame: Ruleset; selector: SelectorLike } | undefined {
  if (!isNode(node, N.AtRule)) {
    return undefined;
  }
  const atRule = node as AtRule;
  const hoisted = atRule.isHoisted(options);
  if (!atRule.isNestable() || atRule.isRootOnly() || !hoisted) {
    return undefined;
  }
  // The render walk already descends THROUGH every enclosing ruleset before it
  // reaches this hoisted at-rule, composing each into `composedSelectorStack`.
  // Its top entry IS the full severed selector-ancestor chain (`.card .body`),
  // so the hoisted at-rule recovers its parent selector directly from the live
  // walk — no eval-captured frame snapshot needed.
  const parentSelector = options.composedSelectorStack?.at(-1);
  if (!parentSelector) {
    return undefined;
  }
  // The identity key for the frame-diff loop: the nearest enclosing ruleset in
  // structural context. Under collapse every ruleset ancestor is folded into the
  // composed selector and dropped from the live frame stack, so recover it from
  // the at-rule's structural parent chain.
  let frameCandidate: Node | undefined = atRule.parent;
  while (frameCandidate && !isNode(frameCandidate, N.Ruleset)) {
    frameCandidate = frameCandidate.parent;
  }
  if (!frameCandidate) {
    return undefined;
  }
  return { frame: frameCandidate as Ruleset, selector: parentSelector as SelectorLike };
}

/**
 * Write a hoisted parent selector to `writer`. The selector may be a string
 * (strings-not-nodes model) or an array of string/Selector items (a selector
 * list); a plain string is emitted verbatim, so no BasicSelector `valueOf`
 * tag-lowercasing is applied to an already-composed multi-part selector.
 */
function writeSelectorLike(selector: SelectorLike, options: FinalPrintOptions): void {
  const items = Array.isArray(selector) ? selector : [selector];
  items.forEach((item, i) => {
    if (i > 0) {
      options.writer.add(', ', undefined);
    }
    if (typeof item === 'string') {
      options.writer.add(item, undefined);
    } else {
      item.writeSyntax(options);
    }
  });
}

function renderHoistedParentHeader(
  parent: { frame: Ruleset; selector: SelectorLike },
  options: FinalPrintOptions,
  depth: number
): string {
  const writer = options.writer;
  const mark = writer.mark();
  writeSelectorLike(parent.selector, {
    ...options,
    collapseNesting: false,
    composedSelectorStack: []
  });
  const selectorOut = writer.getSince(mark);
  writer.restore(mark);
  return normalizeIndent(selectorOut.replace(/\s+$/, '') + ' {', indent(depth)) + '\n';
}

const DIRECT_RULESET_HEADER = '\u0000';

function renderHoistedParentComparableHeader(
  parent: { frame: Ruleset; selector: SelectorLike },
  options: FinalPrintOptions
): string {
  const writer = options.writer;
  const mark = writer.mark();
  writeSelectorLike(parent.selector, {
    ...options,
    collapseNesting: false,
    composedSelectorStack: []
  });
  writer.trimEndSince(mark);
  const frag = writer.getSince(mark);
  writer.restore(mark);
  return frag;
}

function serializeRulesContainerInternal(node: AtRule | Ruleset, options: FinalPrintOptions, closeFramesOnExit: boolean): MaybePromise<string> {
  const w = options.writer;
  let inFrames = options.inFrames;
  const frameHeaders = options.frameHeaders;

  if (isNode(node, N.Ruleset) && (node as Ruleset).selector instanceof Nil) {
    return '';
  }

  // Spine mode (P1 §2): the resolved value-frame + header override (selector for a
  // Ruleset, prelude for an AtRule) must be live BEFORE header composition below.
  // Route through the per-kind setup, which pushes the frame + override for the
  // whole descent and restores on exit (chaining on the async path — never a sync
  // `finally`, which would pop before an async leaf resolves, the B1s bug). The
  // `!== node` guards break the re-entry (the marker doubles as "frame pushed").
  const spineCtx = options.spineMode ? options.context : undefined;
  if (spineCtx && node instanceof Ruleset && isNode(node, N.Rules) && options.spineSelectorNode !== node) {
    return serializeSpineFrameContainer(node, options, closeFramesOnExit, spineCtx);
  }
  if (spineCtx && isNode(node, N.AtRule) && isNode(node, N.Rules) && options.spineAtRuleNode !== node) {
    return serializeSpineFrameAtRule(node, options, closeFramesOnExit, spineCtx);
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
      const cached = rs.composePushedSelector(options);
      if (cached) {
        pushedComposed = true;
        pushedComposedSelector = cached;
      }
    }
  }
  const run = (): MaybePromise<string> => {
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
      && (node.hasFlag(F_EXTENDED) || (node.selector != null && Ruleset.hasExtendedTopLevelSelector(node.selector)));
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
    const recomputeDeclCounts = (): void => {
      declarationCountsByProp.clear();
      for (let i = 0; i < rulesToRender.length; i++) {
        const node = rulesToRender[i]!.node;
        if (!isNode(node, N.Declaration) || isNode(node, N.VarDeclaration)) {
          continue;
        }
        const declProp = node.name.valueOf();
        declarationCountsByProp.set(declProp, (declarationCountsByProp.get(declProp) ?? 0) + 1);
      }
    };
    recomputeDeclCounts();
    // Per-declaration dedup KEY. Eval path: the static `writeSyntax` of the
    // already-resolved node IS its final bytes. Spine path: the value is still
    // UNRESOLVED at this point, so `writeSyntax` emits opaque `$??(…)` placeholders
    // that collapse distinct calls (e.g. `rgb(var(--x))` vs `hsla(var(--x))`) to
    // one key and would wrongly dedupe them. In spine mode the key must be the
    // LIVE-resolved bytes (`resolveSpineLeafText`, MaybePromise), computed against
    // the frame the container descent pushed — the same resolution the emit uses.
    const computeDeclKey = (node: Node): MaybePromise<string> => {
      if (options.spineMode && options.context) {
        // Isolate trivia CONSUMPTION for the throwaway key resolution: `resolve`
        // → `.toString` calls `consumeTrivia`, which marks runs in
        // `options.emittedTrivia` so each comment prints ONCE. Without a scratch
        // Set the key resolution would consume the declaration's field-gap
        // comment (e.g. `color/*c*/:red`), and the REAL emit would then find it
        // already consumed and drop it. Swap in a scratch Set for the whole
        // resolution (including the async `.then` serialize) and restore after —
        // an async-safe form of `withScratchEmittedTrivia` (whose sync `finally`
        // would restore before the awaited serialize runs).
        const savedEmitted = options.emittedTrivia;
        options.emittedTrivia = new Set();
        const restore = (): void => { options.emittedTrivia = savedEmitted; };
        const withSemi = (text: string): string => `${text}${node.requiredSemi ? ';' : ''}`;
        let resolved: MaybePromise<string>;
        try {
          resolved = resolveSpineLeafText(node, options);
        } catch (error) {
          restore();
          throw error;
        }
        if (isThenable(resolved)) {
          return resolved.then(
            (text: string) => { restore(); return withSemi(text); },
            (error: unknown) => { restore(); throw error; }
          );
        }
        restore();
        return withSemi(resolved);
      }
      const declWriter = options.writer;
      const declMark = declWriter.mark();
      const declSaved = savePrintState(options, ['depth']);
      options.depth = options.depth + 1;
      if (serializeProfileCounters) {
        incrementSerializeProfileCounter('duplicateDeclarationPrerenderedDeclarations');
      }
      withScratchEmittedTrivia(options, () => {
        node.writeSyntax(options);
      });
      const declOut = declWriter.getSince(declMark);
      declWriter.restore(declMark);
      restorePrintState(options, declSaved);
      return `${declOut}${node.requiredSemi ? ';' : ''}`;
    };
    const recordDeclKey = (i: number, declProp: string, declKey: string): void => {
      let seenValues = seenDeclarationsByProp.get(declProp);
      if (!seenValues) {
        seenValues = new Set<string>();
        seenDeclarationsByProp.set(declProp, seenValues);
      }
      const node = rulesToRender[i]!.node;
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
    };
    // Spine mixin-fold (cutover increment 1, UNIFIED-EVAL-EMIT-DESIGN §2/§3):
    // resolve each spine-eligible no-arg mixin CALL entry and splice its
    // guard-passed bound-surface children into `rulesToRender` in place, BEFORE
    // dedup + body render — so the folded declarations participate in the same
    // duplicate-declaration handling and statement framing as authored decls
    // (byte-identical to the eval path, which flattens the mixin output surface).
    // FOLD splices the surfaces' children; the EVAL fallback (a non-simple
    // candidate) splices the terminal's flattened output `Rules`. Off the spine
    // (`!spineMode`) this is a no-op. Resolution is async (a mixin call always
    // resolves async).
    const runSpineMixinExpansion = (): MaybePromise<void> => {
      const spineContext = options.spineMode ? options.context : undefined;
      if (!spineContext) {
        return undefined;
      }
      const expandFrom = (start: number): MaybePromise<void> => {
        for (let i = start; i < rulesToRender.length; i++) {
          const entryNode = rulesToRender[i]!.node;
          if (!isSpineEligibleMixinCall(entryNode)) {
            continue;
          }
          const resolution = resolveSpineMixinCall(entryNode, spineContext);
          const apply = (resolved: SpineMixinCallResolution): MaybePromise<void> => {
            // FOLD: splice each bound surface's children, TAGGED with the surface
            // as their `spineFrame` — so a body reference resolves against the
            // mixin's DEFINITION scope (closure/lexical/param bindings on the
            // surface's wired frame), not the enclosing caller frame (increment 2).
            // EVAL fallback: flatten the terminal's output `Rules` (no frame tag —
            // the eval path already resolved it).
            const childEntries: RenderRuleEntry[] = resolved.kind === 'fold'
              ? resolved.surfaces.flatMap(surface =>
                  surface.rules.map(child => ({ node: child, spineFrame: surface })))
              : isNode(resolved.output, N.Rules)
                ? flattenVisibleRulesForRender(resolved.output, options, false)
                : [{ node: resolved.output }];
            rulesToRender.splice(i, 1, ...childEntries);
            recomputeDeclCounts();
            return expandFrom(i + childEntries.length);
          };
          return isThenable(resolution) ? resolution.then(apply) : apply(resolution);
        }
        return undefined;
      };
      return expandFrom(0);
    };

    const runDedupPass = (): MaybePromise<void> => {
      const stepFrom = (i: number): MaybePromise<void> => {
        for (let idx = i; idx >= 0; idx--) {
          const node = rulesToRender[idx]!.node;
          if (!isNode(node, N.Declaration) || isNode(node, N.VarDeclaration)) {
            continue;
          }
          const declProp = node.name.valueOf();
          if ((declarationCountsByProp.get(declProp) ?? 0) < 2) {
            continue;
          }
          const key = computeDeclKey(node);
          if (isThenable(key)) {
            return key.then((resolvedKey: string) => {
              recordDeclKey(idx, declProp, resolvedKey);
              return stepFrom(idx - 1);
            });
          }
          recordDeclKey(idx, declProp, key);
        }
        return undefined;
      };
      return stepFrom(rulesToRender.length - 1);
    };

    const proceed = (): MaybePromise<string> => {
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
          const [currentHeader, recomputedPriorHeader] = withScratchEmittedTrivia(options, () => [
            (
              hoistedParent && i === leafFrames.length - 1 && currentFrame === hoistedParent.frame
            )
              ? renderHoistedParentComparableHeader(hoistedParent, options)
              : currentFrame.getComparableHeaderString(options),
            (
              hoistedParent && i === leafFrames.length - 1 && priorFrame === hoistedParent.frame
            )
              ? renderHoistedParentComparableHeader(hoistedParent, options)
              : priorFrame.getComparableHeaderString(options)
          ]);
          // For a frame shared across call sites (same object, different emission),
          // the recompute reflects the CURRENT site. Prefer the header the prior
          // frame actually emitted last so distinct call-site blocks stay closed.
          const priorComparableHeader = (
            currentFrame === priorFrame
              ? lastEmittedComparableHeader.get(priorFrame) ?? recomputedPriorHeader
              : recomputedPriorHeader
          );
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
              : (isNode(f, N.Ruleset) || isNode(f, N.AtRule)) && !options.trivia
                  ? (f.writeHeader(options) ? DIRECT_RULESET_HEADER : '')
                  : leafFrames[i]!.getHeaderString(options);
            frameHeaders[i] = s;
          } else if (s === '') {
            s = (
              hoistedParent && i === leafFrames.length - 1 && f === hoistedParent.frame
            )
              ? renderHoistedParentHeader(hoistedParent, options, i)
              : (isNode(f, N.Ruleset) || isNode(f, N.AtRule)) && !options.trivia
                  ? (f.writeHeader(options, true) ? DIRECT_RULESET_HEADER : '')
                  : leafFrames[i]!.getHeaderString(options, true);
            frameHeaders[i] = s;
          }
          if (s === '') {
            frameHeaders.pop();
            lastRenderedFrames.pop();
            continue;
          }
          // Record the header this frame just emitted, so a later render of the
          // SAME (shared, hoisted) frame at a different call site compares against
          // what was actually written rather than a fresh recompute.
          lastEmittedComparableHeader.set(
            f,
            withScratchEmittedTrivia(options, () => f.getComparableHeaderString(options))
          );
          if (s !== DIRECT_RULESET_HEADER) {
            w.add(s!);
          }
        }
      };

      /** Don't output selector yet. Let's see if any child rules need hoisting. */
      // Per-node emit. Returns MaybePromise<void>: sync unless a spine-mode leaf
      // or a nested container resolves ASYNC (a `calc()`/function value), in which
      // case the promise is threaded up through `processFrom` → `renderRulesBody`.
      // `continue` in the original loop maps to `return` here; the trivia/indent
      // side-effect tails stay synchronous (only value resolution is async).
      const processNodeInner = (idx: number): MaybePromise<void> => {
        const entry = rulesToRender[idx]!;
        let n = entry.node;
        const isContainer = isNode(n, N.Ruleset | N.AtRule | N.Rules);

        if (!n.visible && !hasPrintableTrivia(n, options)) {
          return;
        }
        // `+:`/`+_:` merge (P1): a suppressed member is coalesced into a later
        // anchor — skip it entirely (like a hidden decl), unless it carries
        // printable trivia to preserve.
        if (options.spineMergePlan?.get(n)?.kind === 'suppress' && !hasPrintableTrivia(n, options)) {
          return;
        }
        if (isNode(n, N.Comment) && originatesFromReferenceImport(n) && !originatesFromCall(n)) {
          return;
        }
        if (inReferenceMode && !renderEnabled && !isContainer) {
          return;
        }
        if (isNode(n, N.Declaration) && !isNode(n, N.VarDeclaration) && skippedDuplicateDeclarations.has(idx)) {
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
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
          const childFrameSnapshot = saveArrayState(lastRenderedFrames);
          const childHeaderSnapshot = saveArrayState(frameHeaders);
          const childPositionBaseline = w.position();
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const childOutResult = serializeRulesContainerInternal(n as AtRule | Ruleset, options, false);
          const finishChild = (childOut: string): void => {
            if (!childOut && !hasPrintableTrivia(n, options)) {
              w.restore(childPositionBaseline);
              restoreArrayState(lastRenderedFrames, childFrameSnapshot);
              restoreArrayState(frameHeaders, childHeaderSnapshot);
            }
          };
          return isThenable(childOutResult) ? childOutResult.then(finishChild) : finishChild(childOutResult);
        }

        /** Re-widen type after accumulated isNode narrowing above */
        const nn = n as Node;
        let leafFrames = inFrames;
        if (hoistedParent) {
          leafFrames = [...inFrames, hoistedParent.frame];
        }
        const renderedFrameSnapshot = saveArrayState(lastRenderedFrames);
        const frameHeaderSnapshot = saveArrayState(frameHeaders);
        const renderedPositionBaseline = w.position();
        if (isNode(nn, N.Rules) && !isLeafAtRule) {
          const hasRenderableChild = nn.rules.some(child =>
            child.visible || hasPrintableTrivia(child, options)
          );
          if (!hasRenderableChild && !hasPrintableTrivia(nn, options)) {
            return;
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
        const isHiddenStructuralNode = !nn.visible;
        const leading = captureNodeTrivia(nn, 'before', options);
        if (isNode(nn, N.Rules)) {
          if (!/^\s*$/.test(leading)) {
            w.add(/\/\*/u.test(leading) ? normalizeBlockTrivia(leading, idt) : normalizeIndent(leading, idt));
          }
          const before = w.position();
          nn.writeSyntax(getPrintOptions(options));
          const wrote = w.position() !== before;
          restorePrintState(options, leafSaved);
          if (!wrote && !leading.trim() && !hasPrintableTrivia(nn, options)) {
            w.restore(renderedPositionBaseline);
            restoreArrayState(lastRenderedFrames, renderedFrameSnapshot);
            restoreArrayState(frameHeaders, frameHeaderSnapshot);
            return;
          }
          w.add('\n');
          const trailing = captureNodeTrivia(nn, 'after', options);
          if (!/^\s*$/.test(trailing)) {
            w.add(/\/\*/u.test(trailing) ? normalizeBlockTrivia(trailing, idt) : normalizeIndent(trailing, idt));
          }
          return;
        }
        // Leaf value resolution. In spineMode a declaration resolves LIVE against
        // the pushed frame (`resolveSpineLeafText`, MaybePromise for `calc()`/
        // functions); otherwise it is the static/eval-tree serializer. The
        // sync trivia/indent tail below runs in `finishLeaf` once `out` is known.
        const outResult: MaybePromise<string> = isHiddenStructuralNode
          ? ''
          : options.spineMode && options.context && isNode(nn, N.Declaration)
            ? resolveSpineLeafText(nn, options)
            : isNode(nn, N.Declaration)
              ? renderNodeText(nn, options, 'declaration-fallback')
              : renderNodeText(nn, options);
        const finishLeaf = (out: string): void => {
          restorePrintState(options, leafSaved);
          // Suppress pure-void Any nodes from generating blank output lines.
          if (
            isNode(nn, N.Any)
            && !nn.requiredSemi
            && !out.trim()
            && !leading.trim()
          ) {
            return;
          }
          if (
            isNode(nn, N.Rules)
            && !out
            && !leading.trim()
            && !hasPrintableTrivia(nn, options)
          ) {
            return;
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
            return;
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
            // `out` already carries continuation indentation relative to the
            // property line (see `formatNonCustomValue`), so measure the relative
            // baseline from `out` itself (first line at column 0) — not from any
            // authored leading indent, which is empty for non-first declarations
            // and would otherwise re-base multi-line values inconsistently.
            const hasEmptyValue = /:\s*$/.test(out);
            // Preserve the single post-colon space for empty declaration values (Less parity: `x: ;`).
            // `normalizeIndent(..., true)` trims end-of-line whitespace and would collapse this to `x:;`.
            const declNormalized = hasEmptyValue && (!normalizedLeading || normalizedLeading.trim() === '')
              ? `${idt}${out}`
              : normalizeIndent(out, idt, true);
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
            w.add(idt);
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
        };
        return isThenable(outResult) ? outResult.then(finishLeaf) : finishLeaf(outResult);
      };
      // Spine mixin-fold (cutover increment 2): a FOLDED entry (`entry.spineFrame`
      // set — a bound mixin surface) is processed with `context.rulesContext`
      // pushed to that surface, so a body reference resolves against the mixin's
      // DEFINITION scope (the surface's wired lexical/closure/param frame), not the
      // enclosing caller frame (the B1s frame-threading discipline, §2, applied to
      // a shared mixin body — no copy). The pop chains on the async result (never a
      // sync `finally` that would pop before an async leaf resolves — the B1s
      // early-pop guard). Authored entries (no `spineFrame`) run unwrapped.
      const processNode = (idx: number): MaybePromise<void> => {
        const spineFrame = rulesToRender[idx]!.spineFrame;
        if (!spineFrame || !options.context) {
          return processNodeInner(idx);
        }
        const ctx = options.context;
        const savedRulesContext = ctx.rulesContext;
        ctx.rulesContext = spineFrame;
        const restore = <T>(value: T): T => {
          ctx.rulesContext = savedRulesContext;
          return value;
        };
        try {
          const step = processNodeInner(idx);
          return isThenable(step)
            ? step.then(restore, (error: unknown) => {
                restore(undefined);
                throw error;
              })
            : restore(step);
        } catch (error) {
          restore(undefined);
          throw error;
        }
      };
      // Drive the per-node processor in source order, threading a promise only if
      // a node resolved async (spine-mode `calc()`/function leaf or nested async
      // container). The common all-sync case never allocates a promise.
      const processFrom = (idx: number): MaybePromise<void> => {
        for (let i = idx; i < rulesToRender.length; i++) {
          const step = processNode(i);
          if (isThenable(step)) {
            return step.then(() => processFrom(i + 1));
          }
        }
        return undefined;
      };
      const bodyResult = processFrom(0);
      const finishBody = (): string => {
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
      return isThenable(bodyResult) ? bodyResult.then(finishBody) : finishBody();
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
      const restoreFrames = (text: string): string => {
        restoreArrayState(treeFrames, savedFrames);
        return text;
      };
      return isThenable(out) ? out.then(restoreFrames) : restoreFrames(out);
    }
    return renderRulesBody();
    };
    // Expand spine-eligible mixin calls into their (fold surface / eval fallback)
    // children BEFORE dedup + body render, so folded decls share the enclosing
    // body's dedup + statement framing.
    const expand = runSpineMixinExpansion();
    const afterExpand = (): MaybePromise<string> => {
      // The duplicate-declaration dedup pass may resolve keys ASYNC in spine mode
      // (live value resolution); the body render must wait for the skip set to be
      // populated. Eval path stays fully sync (keys are static `writeSyntax`).
      const dedup = runDedupPass();
      return isThenable(dedup) ? dedup.then(proceed) : proceed();
    };
    return isThenable(expand) ? expand.then(afterExpand) : afterExpand();
  };

  const saved = savePrintState(options, [
    'referenceMode',
    'referenceRenderEnabled',
    'depth',
    'inFrames',
    'composedSelectorStack'
  ]);
  const runWithCurrentComposedStack = (): MaybePromise<string> => {
    if (!pushedComposed || !pushedComposedSelector) {
      return run();
    }
    const stack = options.composedSelectorStack ?? (options.composedSelectorStack = []);
    const pushedStackSnapshot = saveArrayState(stack);
    stack.push(pushedComposedSelector);
    const out = run();
    const restoreStack = (text: string): string => {
      restoreArrayState(stack, pushedStackSnapshot);
      return text;
    };
    return isThenable(out) ? out.then(restoreStack) : restoreStack(out);
  };
  // Spine mode (P1 §2): push this container's VALUE-FRAME for the duration of
  // its body descent, so leaves resolve against the SAME frame eval would have
  // used — no eval pass, no output tree. The frame is the source container's own
  // `_scopeFrame` (built lazily, lexical parent via the `.parent` chain). Popped
  // (rulesContext restored) after the body's bytes are in the buffer.
  const runContainer = (): MaybePromise<string> => {
    if (isNode(node, N.AtRule) && (node as AtRule).isRootOnly()) {
      const currentStack = options.composedSelectorStack;
      if (currentStack) {
        const rootStackSnapshot = saveArrayState(currentStack);
        currentStack.length = 0;
        options.composedSelectorStack = currentStack;
        const inner = runWithCurrentComposedStack();
        const restoreRootStack = (text: string): string => {
          restoreArrayState(currentStack, rootStackSnapshot);
          return text;
        };
        return isThenable(inner) ? inner.then(restoreRootStack) : restoreRootStack(inner);
      }
      options.composedSelectorStack = [];
      return runWithCurrentComposedStack();
    }
    return runWithCurrentComposedStack();
  };
  // Restore the print state after the body's bytes are in the buffer — for the
  // async path this MUST chain on the promise, never a sync `finally` (which
  // would pop before an async leaf resolves — the B1s bug). The spine value-frame
  // + selector override (when present) are pushed/popped by
  // `serializeSpineFrameContainer`, which wraps this call.
  const finishRun = (text: string): string => {
    restorePrintState(options, saved);
    return text;
  };
  const runResult = runContainer();
  return isThenable(runResult) ? runResult.then(finishRun) : finishRun(runResult);
}

/**
 * Spine-mode container setup (P1 §2, OQ-A): push the container's value-frame,
 * resolve its (possibly interpolated) selector against that live frame, install
 * the resolved selector as a render-local override, then descend the body. The
 * frame + override are popped AFTER the body's bytes are in the buffer (chaining
 * on the async path). Restoring only on the outbound edge keeps the frame live
 * through header composition (`composePushedSelector` reads the effective
 * selector) and every leaf resolution.
 *
 * OQ-A: because the selector is resolved to its CONCRETE form here (before the
 * body — hence before any nested extend participates), extend sees the resolved
 * selector, not the raw `@{…}` template.
 */
function serializeSpineFrameContainer(
  node: Ruleset,
  options: FinalPrintOptions,
  closeFramesOnExit: boolean,
  context: NonNullable<FinalPrintOptions['context']>
): MaybePromise<string> {
  const savedRulesContext = context.rulesContext;
  const savedSelectorNode = options.spineSelectorNode;
  const savedSelector = options.spineSelector;
  const rawSelector = node.selector;
  // Per-position bookkeeping BEFORE the scope frame is built, so this ruleset's
  // declaration buckets carry source indices (re-declared / `snapshot` reads
  // resolve against the binding at their position). See `assignSpineChildIndices`.
  assignSpineChildIndices(node);
  // Link this container's scope frame to the ENCLOSING live frame explicitly.
  // The lexical parent is `savedRulesContext` (the frame live at container-enter
  // — the root or an outer ruleset). `getScopeFrame`'s default parent discovery
  // walks `node.parent`, but a PARSED source ruleset carries no `.parent` back-
  // pointer (only the eval pass, which the spine replaces, established those), so
  // the walk finds no enclosing `Rules` and the frame is orphaned — a var read
  // then can't see an ancestor-scope (e.g. root-level) binding. Passing the live
  // enclosing frame reproduces the eval-path lexical chain without `.parent`.
  const enclosingFrame = savedRulesContext?.getScopeFrame();
  node.getScopeFrame(enclosingFrame);
  context.rulesContext = node;
  const rulesetFrameBaseline = context.rulesetFrames.length;
  const restore = (text: string): string => {
    context.rulesContext = savedRulesContext;
    options.spineSelectorNode = savedSelectorNode;
    options.spineSelector = savedSelector;
    context.rulesetFrames.length = rulesetFrameBaseline;
    return text;
  };
  // Descend with the override MARKER set on this node (`spineSelectorNode`), so
  // the re-entry below skips this setup — the marker is what breaks the recursion
  // AND signals "this node's frame is already pushed". `spineSelector` carries the
  // resolved selector when one was computed; when undefined the header falls back
  // to the authored `this.selector`. Node's OWN ruleset frame is pushed HERE (not
  // before selector eval) so its `&` resolves against the PARENT frame — node's
  // frame is only the parent for its DESCENDANTS' `&`.
  const descend = (resolvedSelector: Selector | Nil | undefined): MaybePromise<string> => {
    options.spineSelectorNode = node;
    options.spineSelector = resolvedSelector;
    context.rulesetFrames.push(node);
    return withSpineMergePlan(node.rules, options, context, () => {
      const out = serializeRulesContainerInternal(node, options, closeFramesOnExit);
      return isThenable(out) ? out.then(restore) : restore(out);
    });
  };
  // Resolve the selector against the live frame. A Selector node carries either
  // interpolation (`@{…}` → concrete via `eval`) or ampersand (`&-x` → the
  // composed form via `eval` reading `context.rulesetFrames`, whose top is the
  // enclosing ruleset). Either way the resolved selector becomes the header
  // override, so it emits concretely AND extend sees the resolved form (OQ-A).
  // string/array/Nil pass through unevaled.
  try {
    if (rawSelector instanceof Selector) {
      const resolved = rawSelector.eval(context);
      return isThenable(resolved) ? resolved.then(descend) : descend(resolved);
    }
    return descend(undefined);
  } catch (error) {
    restore('');
    throw error;
  }
}

/**
 * Spine-mode AT-RULE setup (P1 §4/§7): the at-rule analogue of
 * `serializeSpineFrameContainer`. Resolve the prelude against the ENCLOSING live
 * frame (a `@media (@w)` prelude reads the enclosing scope, not the at-rule's own
 * body scope — so eval BEFORE pushing this at-rule's frame), install it as the
 * render-local header override (`atRuleHeaderNode`/`atRuleHeaderPrelude`, the
 * existing prelude-override the header write already consults), push the at-rule
 * body value-frame, then descend. The hoist / root-only composed-stack reset /
 * body machinery is the KEPT walk machinery (§7) — `serializeRulesContainerInternal`
 * already handles `@media`→root hoisting via `runContainer` + the `hoisted`
 * branch. Frame + override restored on the outbound edge (chaining on the async
 * path, never a sync `finally` — the B1s early-pop guard).
 */
function serializeSpineFrameAtRule(
  node: AtRule,
  options: FinalPrintOptions,
  closeFramesOnExit: boolean,
  context: NonNullable<FinalPrintOptions['context']>
): MaybePromise<string> {
  const savedRulesContext = context.rulesContext;
  const savedAtRuleNode = options.spineAtRuleNode;
  const savedHeaderNode = options.atRuleHeaderNode;
  const savedHeaderPrelude = options.atRuleHeaderPrelude;
  const restore = (text: string): string => {
    context.rulesContext = savedRulesContext;
    options.spineAtRuleNode = savedAtRuleNode;
    options.atRuleHeaderNode = savedHeaderNode;
    options.atRuleHeaderPrelude = savedHeaderPrelude;
    return text;
  };
  // Descend with the marker + prelude override set. The marker (`spineAtRuleNode`)
  // breaks re-entry; the prelude override feeds the header write. Push the at-rule
  // body frame AFTER the prelude is resolved against the enclosing scope.
  const descend = (resolvedPrelude: AtRulePrelude | undefined): MaybePromise<string> => {
    options.spineAtRuleNode = node;
    if (resolvedPrelude !== undefined) {
      options.atRuleHeaderNode = node;
      options.atRuleHeaderPrelude = resolvedPrelude;
    }
    assignSpineChildIndices(node);
    node.getScopeFrame();
    context.rulesContext = node;
    return withSpineMergePlan(node.rules, options, context, () => {
      const out = serializeRulesContainerInternal(node, options, closeFramesOnExit);
      return isThenable(out) ? out.then(restore) : restore(out);
    });
  };
  const rawPrelude = node.prelude;
  try {
    // Resolve the prelude against the ENCLOSING frame (current rulesContext), not
    // the at-rule's own — mirrors `liftedAtRulePreludeRulesContext` intent. Only a
    // Node prelude carries interpolation; string/undefined pass through unchanged.
    if (rawPrelude instanceof Node) {
      const resolved = rawPrelude.eval(context);
      return isThenable(resolved) ? resolved.then(descend) : descend(resolved);
    }
    return descend(undefined);
  } catch (error) {
    restore('');
    throw error;
  }
}

/**
 * Handles flattening and serializing of at-rules and rulesets.
 * This is the normal entrypoint: the container fully owns opening and closing
 * its rendered frame stack.
 */
export function serializeRulesContainer(node: AtRule | Ruleset, options: FinalPrintOptions): MaybePromise<string> {
  return serializeRulesContainerInternal(node, options, true);
}

/**
 * Serialize a rules container as part of an already-linear parent body flow.
 * Parent `Rules` owns final frame closure, so this leaves matching rendered
 * frames open for subsequent sibling reconciliation.
 */
export function serializeRulesContainerInline(node: AtRule | Ruleset, options: FinalPrintOptions): MaybePromise<string> {
  return serializeRulesContainerInternal(node, options, false);
}
