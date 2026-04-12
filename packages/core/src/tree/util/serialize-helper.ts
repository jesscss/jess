import type { AtRule } from '../at-rule.js';
import { Ruleset } from '../ruleset.js';
import { F_EXTENDED, type Node, type RenderKey } from '../node.js';
import { type FinalPrintOptions, getPrintOptions, OutputWriter } from './print.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
import type { Selector } from '../selector.js';
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
      ? Ruleset.filterExtendedForReferenceCompose(rawParentComposed as Selector) ?? rawParentComposed
      : rawParentComposed;
    const sel = rs.value.selector;
    const isBareAmp = sel && !(sel instanceof Nil) && isNode(sel, N.Ampersand);
    if (isBareAmp && !parentComposed) {
      isTransparentWrapper = true;
    } else {
      const rk = options.renderKey;
      let cached = rs.getComposedSelector(rk);
      if (!cached && sel && !(sel instanceof Nil)) {
        cached = parentComposed
          ? (rs.constructor as typeof Ruleset).composeSelector(sel as Selector, parentComposed as Selector)
          : (sel as Selector);
        rs.setComposedSelector(cached, rk);
      }
      if (cached) {
        (options.composedSelectorStack ??= []).push(cached as Selector);
        pushedComposed = true;
      }
    }
  }
  // let header = node.getHeaderString(options);

  const mark = w.mark();
  const previousReferenceMode = options.referenceMode === true;
  const previousReferenceRenderEnabled = options.referenceRenderEnabled !== false;
  const isInMixinOutputScope = (): boolean => {
    const seen = new Set<any>();
    const queue: any[] = [(node as any).parent, (node as any).sourceParent];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) {
        continue;
      }
      seen.add(current);
      if (current.options?.isMixinOutput === true) {
        return true;
      }
      queue.push(current.parent, current.sourceParent);
    }
    return false;
  };
  const ownReferenceMode = Boolean(
    (node as any).options?.referenceMode === true
  );
  const inReferenceMode = previousReferenceMode || ownReferenceMode;
  const enteringReferenceMode = !previousReferenceMode && ownReferenceMode;
  const nodeExtendsReference = node.type === 'Ruleset' && rulesetHasExtendedTopLevelSelector(node as Ruleset);
  const inheritedRenderEnabled = enteringReferenceMode ? false : previousReferenceRenderEnabled;
  const renderEnabled = inReferenceMode ? (inheritedRenderEnabled || nodeExtendsReference) : true;
  options.referenceMode = inReferenceMode;
  options.referenceRenderEnabled = renderEnabled;
  const rules = node.value.rules;
  if (!rules) {
    if (inReferenceMode && !renderEnabled) {
      options.referenceMode = previousReferenceMode;
      options.referenceRenderEnabled = previousReferenceRenderEnabled;
      return '';
    }
    // Leaf at-rules (no body) are not "frame headers". Always emit them with comments
    // preserved; comment-stripping should only apply to repeated *frame* headers.
    w.add(node.getHeaderString(options, false));
    options.referenceMode = previousReferenceMode;
    options.referenceRenderEnabled = previousReferenceRenderEnabled;
    return w.getSince(mark);
  }

  const { nodes: rulesToRender, renderKeys: rulesRenderKeys } = rules.flatRulesWithKeys(true);
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
    options.referenceMode = previousReferenceMode;
    options.referenceRenderEnabled = previousReferenceRenderEnabled;
    return '';
  }

  // Less-style duplicate declaration handling:
  // for each property, keep the last exact serialized declaration and skip earlier duplicates.
  for (let i = rulesToRender.length - 1; i >= 0; i--) {
    const node = rulesToRender[i]!;
    if (!isNode(node, N.Declaration) || isNode(node, N.VarDeclaration)) {
      continue;
    }
    const declWriter = new OutputWriter();
    const entryRenderKey = rulesRenderKeys[i];
    const declOptions = getPrintOptions({
      ...options,
      writer: declWriter,
      depth: options.depth + 1,
      renderKey: entryRenderKey ?? options.renderKey
    });
    const declOut = node.toTrimmedString(declOptions);
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
  const prevTreeFrames = hoisted && !isTransparentWrapper ? treeFrames.slice() : undefined;
  if (isTransparentWrapper) {
    // Transparent `&` wrapper: don't add self as a frame, just render children
    // using the parent frame context.
    options.inFrames = inFrames = treeFrames!;
  } else if (hoisted) {
    // When hoisting, we must reset the active frame stack to at-rules only.
    // Otherwise, previously-rendered non-hoisted rulesets (e.g. `.header`) can remain
    // in `treeFrames` and cause nested output like:
    //   .header { :is(.header-nav, .footer .footer-nav) { ... } }
    // even though the current node is hoisted to root.
    const atRulesOnly = treeFrames.filter(f => isNode(f, N.AtRule));
    treeFrames.splice(0, treeFrames.length, ...atRulesOnly, node);
    options.inFrames = inFrames = treeFrames;
  } else {
    options.inFrames = inFrames = treeFrames!;
    inFrames.push(node);
  }
  // Note: in the hoisted branch above, `node` is already included.

  let lastRenderedFrames = options.lastRenderedFrames;

  /** Don't output selector yet. Let's see if any child rules need hoisting. */
  for (let idx = 0; idx < rulesToRender.length; idx++) {
    let n = rulesToRender[idx]!;
    // Per-leaf renderKey: for leaves pulled up from nested Rules(_renderKey=X)
    // in mixin call / $for output, this is the call's renderKey. Used to
    // read the matching fork when serializing shared body nodes.
    const entryRenderKey = rulesRenderKeys[idx];
    const effectiveRenderKey = (entryRenderKey ?? options.renderKey) as RenderKey | undefined;
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

    if (isNode(n, N.Ruleset | N.AtRule)) {
      const childOptions = getPrintOptions({
        ...options,
        referenceMode: inReferenceMode,
        referenceRenderEnabled: renderEnabled,
        renderKey: effectiveRenderKey
      });
      const childMark = w.mark();
      const childOut = serializeRulesContainerInternal(n as AtRule | Ruleset, childOptions, false);
      if (!w.getSince(childMark) && !childOut) {
        continue;
      }
      continue;
    }

    /** Re-widen type after accumulated isNode narrowing above */
    const nn = n as Node;
    let leafChildOptions: FinalPrintOptions = { ...options, depth: options.depth + 1, renderKey: effectiveRenderKey };
    if (isNode(nn, N.Rules)) {
      const ownReferenceMode = (nn.options as { referenceMode?: boolean } | undefined)?.referenceMode === true;
      const childReferenceMode = inReferenceMode || ownReferenceMode;
      const enteringReferenceMode = !inReferenceMode && ownReferenceMode;
      const childReferenceRenderEnabled = childReferenceMode
        ? (enteringReferenceMode ? false : renderEnabled)
        : true;
      leafChildOptions = {
        ...leafChildOptions,
        referenceMode: childReferenceMode,
        referenceRenderEnabled: childReferenceRenderEnabled
      };
      const previewOut = w.capture(() => nn.toTrimmedString(leafChildOptions));
      if (!previewOut) {
        continue;
      }
    }

    let matches = -1;
    /** Close current frames if needed */
    for (let i = 0; i < lastRenderedFrames.length; i++) {
      const currentFrame = inFrames[i];
      const priorHeader = frameHeaders[i];
      if (!currentFrame || priorHeader === undefined) {
        break;
      }
      options.depth = i;
      const currentHeader = currentFrame.getHeaderString(options as FinalPrintOptions);
      const sameHeader = currentHeader === priorHeader;
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

    for (let i = matches + 1; i < inFrames.length; i++) {
      let s = frameHeaders[i];
      let f = inFrames[i]!;
      lastRenderedFrames.push(f);
      options.depth = i;
      if (s === undefined) {
        s = inFrames[i]!.getHeaderString(options as FinalPrintOptions);
        frameHeaders[i] = s;
      } else if (s === '') {
        s = inFrames[i]!.getHeaderString(options as FinalPrintOptions, true);
        frameHeaders[i] = s;
      }
      w.add(s!);
    }

    // if (isNode(n, N.Declaration)) {
    let idt = indent(options.depth + 1);
    let pre = w.capture(() => nn.processPrePost('pre', undefined, leafChildOptions));
    /** normalize pre spacing */
    let out = isNode(nn, N.Declaration)
      ? (declarationOutputCache.get(idx) ?? w.capture(() => nn.toTrimmedString(leafChildOptions)))
      : w.capture(() => nn.toTrimmedString(leafChildOptions));
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
      pre = pre.replace(/^[\s\S]*\n([ \t]*)$/g, '$1');
      const declIn = pre + out;
      const hasEmptyValue = /:\s*$/.test(out);
      // Preserve the single post-colon space for empty declaration values (Less parity: `x: ;`).
      // `normalizeIndent(..., true)` trims end-of-line whitespace and would collapse this to `x:;`.
      const declNormalized = hasEmptyValue && (!pre || pre.trim() === '')
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
  if (prevTreeFrames) {
    treeFrames.splice(0, treeFrames.length, ...prevTreeFrames);
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
  if (pushedComposed) {
    options.composedSelectorStack!.pop();
  }
  options.referenceMode = previousReferenceMode;
  options.referenceRenderEnabled = previousReferenceRenderEnabled;
  return w.getSince(mark);
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
