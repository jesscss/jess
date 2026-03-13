import type { AtRule } from '../at-rule.js';
import type { Ruleset } from '../ruleset.js';
import { F_EXTENDED, type Node } from '../node.js';
import { type FinalPrintOptions, getPrintOptions, OutputWriter } from './print.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
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
  const selector = node.data.selector;
  if (!selector || selector instanceof Nil) {
    return false;
  }
  if (isNode(selector, N.SelectorList)) {
    return selector.data.some(item => item.hasFlag(F_EXTENDED));
  }
  return selector.hasFlag(F_EXTENDED);
}

/**
 * Handles flattening and serializing of at-rules and rulesets
 */
export function serializeRulesContainer(node: AtRule | Ruleset, options: FinalPrintOptions): string {
  const w = options.writer;
  let inFrames = options.inFrames;
  const frameHeaders = options.frameHeaders;

  if (node.type === 'Ruleset' && node.data.selector instanceof Nil) {
    return '';
  }
  // let header = node.getHeaderString(options);

  const mark = w.mark();
  const previousReferenceMode = options.referenceMode === true;
  const previousReferenceRenderEnabled = options.referenceRenderEnabled !== false;
  const inReferenceMode = previousReferenceMode;
  const enteringReferenceMode = false;
  const nodeExtendsReference = node.type === 'Ruleset' && rulesetHasExtendedTopLevelSelector(node as Ruleset);
  const inheritedRenderEnabled = enteringReferenceMode ? false : previousReferenceRenderEnabled;
  const renderEnabled = inReferenceMode ? (inheritedRenderEnabled || nodeExtendsReference) : true;
  options.referenceMode = inReferenceMode;
  options.referenceRenderEnabled = renderEnabled;
  const rules = node.data.rules;
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

  const rulesToRender = rules.flatRules(true);
  const declarationOutputCache = new Map<object, string>();
  const skippedDuplicateDeclarations = new Set<object>();
  const seenDeclarationsByProp = new Map<string, Set<string>>();
  const deferredExpandedChildren: any[] = [];
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
    const declOptions = getPrintOptions({ ...options, writer: declWriter, depth: options.depth + 1 });
    const declOut = node.toTrimmedString(declOptions);
    declarationOutputCache.set(node, declOut);
    const declKey = `${declOut}${node.requiredSemi ? ';' : ''}`;
    const declProp = node.data.name.valueOf();
    let seenValues = seenDeclarationsByProp.get(declProp);
    if (!seenValues) {
      seenValues = new Set<string>();
      seenDeclarationsByProp.set(declProp, seenValues);
    }
    if (seenValues.has(declKey)) {
      skippedDuplicateDeclarations.add(node);
    } else {
      seenValues.add(declKey);
    }
  }

  const hoisted = node.isHoisted(options);
  // const isRuleset = isNode(node, 'Ruleset');
  const treeFrames = options.treeFrames!;
  const prevTreeFrames = hoisted ? treeFrames.slice() : undefined;
  if (hoisted) {
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
    const isContainer = isNode(n, N.Ruleset | N.AtRule | N.Rules);

    if (!n.visible && !n.fullRender) {
      continue;
    }
    if (inReferenceMode && !renderEnabled && !isContainer) {
      continue;
    }
    if (isNode(n, N.Declaration) && !isNode(n, N.VarDeclaration) && skippedDuplicateDeclarations.has(n)) {
      continue;
    }

    if (isNode(n, N.Rules)) {
      // Reference-mode Rules preserved by flatRules — serialize with referenceMode cascading
      const ownRefMode = (n as any).options?.referenceMode === true;
      const childRefMode = inReferenceMode || ownRefMode;
      const entering = !inReferenceMode && ownRefMode;
      const childRenderEnabled = childRefMode
        ? (entering ? false : renderEnabled)
        : true;
      const childOptions = {
        ...options,
        referenceMode: childRefMode,
        referenceRenderEnabled: childRenderEnabled
      } as FinalPrintOptions;
      const childOut = w.capture(() => n.toTrimmedString(childOptions));
      if (childOut) {
        w.add(childOut, n);
      }
      continue;
    }
    if (isNode(n, N.Ruleset | N.AtRule)) {
      if (node.type === 'Ruleset' && isNode(n, N.Ruleset)) {
        const parentSelector = String(node.data.selector?.valueOf?.() ?? '');
        const childSelector = String(n.data.selector?.valueOf?.() ?? '');
        const isExpandedDescendant = parentSelector !== '' && (
          childSelector.startsWith(`${parentSelector} `)
          || childSelector.startsWith(`${parentSelector}.`)
          || childSelector.startsWith(`${parentSelector}#`)
          || childSelector.startsWith(`${parentSelector}:`)
          || childSelector.startsWith(`${parentSelector}[`)
        );
        const isSelfWrappedDescendant = parentSelector !== ''
          && (
            childSelector === `${parentSelector} ${parentSelector}`
            || childSelector.startsWith(`${parentSelector} ${parentSelector} `)
          );
        const fromCall = originatesFromCall(n as any);
        const laterCandidates = rulesToRender.slice(idx + 1);
        const hasLaterExternalNonContainer = laterCandidates.some((later) => {
          if (!later.visible && !later.fullRender) {
            return false;
          }
          if (isNode(later, N.Ruleset | N.AtRule | N.Rules)) {
            return false;
          }
          if (isNode(later, N.Declaration) && skippedDuplicateDeclarations.has(later)) {
            return false;
          }
          const ownedByCurrentChild = sourceChainHas(later, (current) => {
            if (current === n) {
              return true;
            }
            if (current?.type !== 'Ruleset') {
              return false;
            }
            const currentSelector = String(current.data?.selector?.valueOf?.() ?? '');
            return currentSelector !== '' && currentSelector === childSelector;
          });
          return !ownedByCurrentChild;
        });
        const hasRepeatedExpandedSelectorAny = rulesToRender.some((other, otherIdx) => {
          return otherIdx !== idx
            && isNode(other, N.Ruleset)
            && String(other.data.selector?.valueOf?.() ?? '') === childSelector;
        });
        if (isExpandedDescendant
          && !isSelfWrappedDescendant
          && fromCall
          && hasLaterExternalNonContainer
          && hasRepeatedExpandedSelectorAny
        ) {
          deferredExpandedChildren.push(n);
          continue;
        }
      }
      const childOptions = {
        ...options,
        referenceMode: inReferenceMode,
        referenceRenderEnabled: renderEnabled
      } as FinalPrintOptions;
      const childOut = w.capture(() => n.toTrimmedString(childOptions));
      if (!childOut) {
        continue;
      }
      w.add(childOut, n);
      continue;
    }

    let matches = -1;
    /** Close current frames if needed */
    for (let i = 0; i < lastRenderedFrames.length; i++) {
      const currentFrame = inFrames[i];
      const priorFrame = lastRenderedFrames[i];
      const sameValueOf = currentFrame?.valueOf() === priorFrame?.valueOf();
      if (!sameValueOf) {
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
      if (s === undefined) {
        s = inFrames[i]!.getHeaderString({ ...options, depth: i });
        frameHeaders[i] = s;
      } else if (s === '') {
        s = inFrames[i]!.getHeaderString({ ...options, depth: i }, true);
        frameHeaders[i] = s;
      }
      options.depth = i;
      w.add(s!);
    }

    // if (isNode(n, N.Declaration)) {
    let idt = indent(options.depth + 1);
    /** Re-widen type after accumulated isNode narrowing above */
    const nn = n as Node;
    let pre = w.capture(() => nn.processPrePost('pre', undefined, options));
    /** normalize pre spacing */
    let out = isNode(nn, N.Declaration)
      ? (declarationOutputCache.get(nn) ?? w.capture(() => nn.toTrimmedString({ ...options, depth: options.depth + 1 })))
      : w.capture(() => nn.toTrimmedString({ ...options, depth: options.depth + 1 }));
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
      if (nn.data.name.valueOf().startsWith('--')) {
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
  inFrames.pop();
  frameHeaders.pop();
  if (prevTreeFrames) {
    treeFrames.splice(0, treeFrames.length, ...prevTreeFrames);
  }
  let renderedLength = lastRenderedFrames.length;
  if (treeFrames.length < renderedLength) {
    w.add(indent(renderedLength - 1) + '}\n');
    options.depth--;
    lastRenderedFrames.pop();
  }
  for (const deferred of deferredExpandedChildren) {
    const deferredWriter = new OutputWriter();
    const childOptions = {
      ...options,
      writer: deferredWriter,
      frameHeaders: [],
      lastRenderedFrames: [],
      treeFrames: [],
      inFrames: [],
      referenceMode: inReferenceMode,
      referenceRenderEnabled: renderEnabled
    } as FinalPrintOptions;
    const childOut = deferred.toTrimmedString(childOptions);
    if (!childOut) {
      continue;
    }

    w.add(childOut, deferred);
  }
  options.referenceMode = previousReferenceMode;
  options.referenceRenderEnabled = previousReferenceRenderEnabled;
  return w.getSince(mark);
}