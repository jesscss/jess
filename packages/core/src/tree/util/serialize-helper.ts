import type { AtRule } from '../at-rule.js';
import type { Declaration } from '../declaration.js';
import type { Rules } from '../rules.js';
import type { Ruleset } from '../ruleset.js';
import { F_EXTENDED, isVisibleInContext, type Node } from '../node.js';
import { type FinalPrintOptions, getPrintOptions, OutputWriter } from './print.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
import { hasExtendedSelector } from './selector-utils.js';
import { isBareAmpersandOwnSelector } from './selector-utils.js';
import type { FlatRulePosition } from '../rules.js';

function isRulesNode(node: Node): node is Rules {
  return isNode(node, N.Rules);
}

function isRulesetNode(node: Node): node is Ruleset {
  return isNode(node, N.Ruleset);
}

function isAtRuleNode(node: Node): node is AtRule {
  return isNode(node, N.AtRule);
}

function isDeclarationNode(node: Node): node is Declaration {
  return isNode(node, N.Declaration);
}

function isContainerNode(node: Node): node is Rules | Ruleset | AtRule {
  return isRulesNode(node) || isRulesetNode(node) || isAtRuleNode(node);
}

function getRulesVisibility(node: Rules | Ruleset): Record<string, string> | undefined {
  return isRulesNode(node)
    ? node.options.rulesVisibility
    : node.options.rulesVisibility;
}

function getRenderableSelectorString(node: Ruleset, collapseNesting: boolean | undefined, context: FinalPrintOptions['context']): string {
  return String(node.getRenderableSelector(collapseNesting, context)?.valueOf?.() ?? '');
}

function isReferenceModeRules(node: Node): node is Rules {
  return isRulesNode(node) && node.options.referenceMode === true;
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

function rulesetExtendsReference(node: Ruleset, options: FinalPrintOptions): boolean {
  return (
    (options.context ? node._hasFlag(F_EXTENDED, options.context) : node.hasFlag(F_EXTENDED))
    || hasExtendedSelector(node.getRenderableSelector(options.collapseNesting, options.context), options.context)
  );
}

function rulesHaveReferenceRenderableDescendant(rules: Rules, options: FinalPrintOptions): boolean {
  for (const child of rules._getRenderChildren(options.context)) {
    if (isRulesNode(child)) {
      if (rulesHaveReferenceRenderableDescendant(child, options)) {
        return true;
      }
      continue;
    }
    if (isRulesetNode(child)) {
      if (!isVisibleInContext(child, options.context) && !child.fullRender) {
        const nestedRules = child.enterRules(options.context);
        if (nestedRules && rulesHaveReferenceRenderableDescendant(nestedRules, options)) {
          return true;
        }
        continue;
      }
      if (rulesetExtendsReference(child, options)) {
        return true;
      }
      const nestedRules = child.enterRules(options.context);
      if (nestedRules && rulesHaveReferenceRenderableDescendant(nestedRules, options)) {
        return true;
      }
      continue;
    }
    if (isAtRuleNode(child)) {
      if (!isVisibleInContext(child, options.context) && !child.fullRender) {
        const nestedRules = child.enterRules(options.context);
        if (nestedRules && rulesHaveReferenceRenderableDescendant(nestedRules, options)) {
          return true;
        }
        continue;
      }
      const nestedRules = child.enterRules(options.context);
      if (nestedRules && rulesHaveReferenceRenderableDescendant(nestedRules, options)) {
        return true;
      }
      continue;
    }
    if (!isVisibleInContext(child, options.context) && !child.fullRender) {
      continue;
    }
  }
  return false;
}

function nodeExtendsReference(node: AtRule | Ruleset, options: FinalPrintOptions): boolean {
  if (isRulesetNode(node)) {
    if (rulesetExtendsReference(node, options)) {
      return true;
    }
    const rules = node.enterRules(options.context);
    return rules ? rulesHaveReferenceRenderableDescendant(rules, options) : false;
  }
  const rules = node.enterRules(options.context);
  return rules ? rulesHaveReferenceRenderableDescendant(rules, options) : false;
}

/**
 * Handles flattening and serializing of at-rules and rulesets
 */
export function serializeRulesContainer(node: AtRule | Ruleset, options: FinalPrintOptions): string {
  const w = options.writer;
  let inFrames = options.inFrames;
  const frameHeaders = options.frameHeaders;

  if (isRulesetNode(node) && node.getRenderableSelector(options.collapseNesting, options.context) instanceof Nil) {
    return '';
  }
  // let header = node.getHeaderString(options);

  const mark = w.mark();
  const previousReferenceMode = options.referenceMode === true;
  const previousReferenceRenderEnabled = options.referenceRenderEnabled !== false;
  const previousReferenceRenderOnExtend = options.referenceRenderOnExtend !== false;
  const inReferenceMode = previousReferenceMode;
  const enteringReferenceMode = false;
  const inheritedRenderEnabled = enteringReferenceMode ? false : previousReferenceRenderEnabled;
  const renderEnabled = inReferenceMode
    ? (inheritedRenderEnabled || (previousReferenceRenderOnExtend && nodeExtendsReference(node, options)))
    : true;
  const isOptionalReferenceBoundary = isRulesNode(node)
    && getRulesVisibility(node)?.Ruleset === 'optional';
  options.referenceMode = inReferenceMode;
  options.referenceRenderEnabled = renderEnabled;
  options.referenceRenderOnExtend = previousReferenceRenderOnExtend;
  if (isRulesetNode(node) && inReferenceMode && renderEnabled) {
    const previewHeader = node.getHeaderString(options, false);
    if (!previewHeader) {
      const nestedRules = node.enterRules(options.context);
      if (!nestedRules || !rulesHaveReferenceRenderableDescendant(nestedRules, options)) {
        options.referenceMode = previousReferenceMode;
        options.referenceRenderEnabled = previousReferenceRenderEnabled;
        options.referenceRenderOnExtend = previousReferenceRenderOnExtend;
        return '';
      }
    }
  }
  const rules = node.enterRules(options.context);
  if (!rules) {
    if (inReferenceMode && !renderEnabled) {
      options.referenceMode = previousReferenceMode;
      options.referenceRenderEnabled = previousReferenceRenderEnabled;
      options.referenceRenderOnExtend = previousReferenceRenderOnExtend;
      return '';
    }
    // Leaf at-rules (no body) are not "frame headers". Always emit them with comments
    // preserved; comment-stripping should only apply to repeated *frame* headers.
    w.add(node.getHeaderString(options, false));
    options.referenceMode = previousReferenceMode;
    options.referenceRenderEnabled = previousReferenceRenderEnabled;
    options.referenceRenderOnExtend = previousReferenceRenderOnExtend;
    return w.getSince(mark);
  }

  const positionMap = new WeakMap<Node, FlatRulePosition>();
  let rulesToRender = rules.flatRules(true, options.context, positionMap);
  if (isRulesetNode(node) && inReferenceMode && renderEnabled) {
    const mergedMirrorBodyRules: Node[] = [];
    const expandedRulesToRender: Node[] = [];
    for (const child of rulesToRender) {
      if (isRulesetNode(child)) {
        const ownSelector = child.getOwnSelector();
        if (
          ownSelector
          && !(ownSelector instanceof Nil)
          && isBareAmpersandOwnSelector(ownSelector)
        ) {
          const childRules = child.enterRules(options.context);
          if (childRules) {
            for (const innerChild of childRules.flatRules(true, options.context, positionMap)) {
              if (isContainerNode(innerChild)) {
                expandedRulesToRender.push(innerChild);
              } else {
                mergedMirrorBodyRules.push(innerChild);
              }
            }
            continue;
          }
        }
      }
      expandedRulesToRender.push(child);
    }
    if (mergedMirrorBodyRules.length > 0) {
      const finalRulesToRender: Node[] = [];
      let insertedMergedMirrorBodyRules = false;
      for (const child of expandedRulesToRender) {
        const isContainer = isContainerNode(child);
        if (!insertedMergedMirrorBodyRules && isContainer) {
          finalRulesToRender.push(...mergedMirrorBodyRules);
          insertedMergedMirrorBodyRules = true;
        }
        finalRulesToRender.push(child);
      }
      if (!insertedMergedMirrorBodyRules) {
        finalRulesToRender.push(...mergedMirrorBodyRules);
      }
      rulesToRender = finalRulesToRender;
    } else {
      rulesToRender = expandedRulesToRender;
    }
  }
  const declarationOutputCache = new Map<object, string>();
  const skippedDuplicateDeclarations = new Set<object>();
  const seenDeclarationsByProp = new Map<string, Set<string>>();
  const deferredExpandedChildren: Node[] = [];
  const withNodePosition = <T>(target: Node, fn: () => T): T => {
    const ctx = options.context;
    const position = positionMap.get(target);
    if (!ctx || !position) {
      return fn();
    }

    const previousRenderKey = ctx.renderKey;
    if (position.renderKey !== undefined) {
      ctx.renderKey = position.renderKey;
    }
    try {
      return fn();
    } finally {
      ctx.renderKey = previousRenderKey;
    }
  };
  const sourceChainHas = (start: Node | undefined, predicate: (n: Node) => boolean): boolean => {
    const seen = new Set<Node>();
    const queue: Array<Node | undefined> = [start];
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
  const originatesFromCall = (n: Node | undefined): boolean => sourceChainHas(n, current => current.type === 'Call');
  if (rulesToRender.length === 0) {
    options.referenceMode = previousReferenceMode;
    options.referenceRenderEnabled = previousReferenceRenderEnabled;
    options.referenceRenderOnExtend = previousReferenceRenderOnExtend;
    return '';
  }

  // Less-style duplicate declaration handling:
  // for each property, keep the last exact serialized declaration and skip earlier duplicates.
  for (let i = rulesToRender.length - 1; i >= 0; i--) {
    const node = rulesToRender[i]!;
    if (!isDeclarationNode(node) || isNode(node, N.VarDeclaration)) {
      continue;
    }
    // Push per-node position so patched fields are visible during dedup
    const declWriter = new OutputWriter();
    const declOptions = getPrintOptions({ ...options, writer: declWriter, depth: options.depth + 1 });
    const declOut = withNodePosition(node, () => node.toTrimmedString(declOptions));
    declarationOutputCache.set(node, declOut);
    const declKey = `${declOut}${node.requiresSemi(options.context) ? ';' : ''}`;
    const declProp = node.get('name', options.context).valueOf();
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
    const getLaterExternalNonContainer = (currentChild: Node, childSelector?: string): Node | undefined => {
      const laterCandidates = rulesToRender.slice(idx + 1);
      return laterCandidates.find((later) => {
        if (!isVisibleInContext(later, options.context) && !later.fullRender) {
          return false;
        }
        if (isContainerNode(later)) {
          return false;
        }
        if (isDeclarationNode(later) && skippedDuplicateDeclarations.has(later)) {
          return false;
        }
        const ownedByCurrentChild = sourceChainHas(later, (current) => {
          if (current === currentChild) {
            return true;
          }
          if (!childSelector || !isRulesetNode(current)) {
            return false;
          }
          const currentSelector = getRenderableSelectorString(current, options.collapseNesting, options.context);
          return currentSelector !== '' && currentSelector === childSelector;
        });
        return !ownedByCurrentChild;
      });
    };

    // Push per-node position from the position map so patched fields resolve
    const skipped = withNodePosition(n, () => {
      if (!isVisibleInContext(n, options.context) && !n.fullRender) {
        return true;
      }
      if (inReferenceMode && !renderEnabled && !isOptionalReferenceBoundary && isContainer) {
        return true;
      }
      if (inReferenceMode && !renderEnabled && !isContainer) {
        return true;
      }
      if (isNode(n, N.Declaration) && !isNode(n, N.VarDeclaration) && skippedDuplicateDeclarations.has(n)) {
        return true;
      }

      if (isRulesNode(n)) {
        const ownRefMode = isReferenceModeRules(n);
        const childRefMode = inReferenceMode || ownRefMode;
        const entering = !inReferenceMode && ownRefMode;
        const childRenderEnabled = childRefMode
          ? (entering ? false : renderEnabled)
          : true;
        const childOptions: FinalPrintOptions = {
          ...options,
          referenceMode: childRefMode,
          referenceRenderEnabled: childRenderEnabled,
          referenceRenderOnExtend: previousReferenceRenderOnExtend
        };
        const childOut = w.capture(() => n.toTrimmedString(childOptions));
        if (childOut) {
          w.add(childOut, n);
        }
        return true;
      }
      const isLeafAtRule = isAtRuleNode(n) && !n.enterRules(options.context);
      if (isContainerNode(n) && !isLeafAtRule) {
        if (isRulesetNode(node) && isRulesetNode(n)) {
          const parentSelector = getRenderableSelectorString(node, options.collapseNesting, options.context);
          const childSelector = getRenderableSelectorString(n, options.collapseNesting, options.context);
          const childContinuation = parentSelector !== '' && childSelector.startsWith(parentSelector)
            ? childSelector[parentSelector.length]
            : undefined;
          const isExpandedDescendant = parentSelector !== '' && (
            childContinuation === ' '
            || childContinuation === '.'
            || childContinuation === '#'
            || childContinuation === ':'
            || childContinuation === '['
            || childContinuation === '>'
            || childContinuation === '+'
            || childContinuation === '~'
            || childContinuation === '|'
          );
          const isSelfWrappedDescendant = parentSelector !== ''
            && (
              childSelector === `${parentSelector} ${parentSelector}`
              || childSelector.startsWith(`${parentSelector} ${parentSelector} `)
            );
          const hasLaterExternalNonContainer = Boolean(getLaterExternalNonContainer(n, childSelector));
          const shouldDeferExpandedDescendant = (
            options.collapseNesting === true
            && isExpandedDescendant
            && !isSelfWrappedDescendant
            && hasLaterExternalNonContainer
          );
          if (
            (shouldDeferExpandedDescendant || hasLaterExternalNonContainer)
            && (
              isExpandedDescendant
              || isAtRuleNode(n)
              || originatesFromCall(n)
            )
            && !isSelfWrappedDescendant
          ) {
            deferredExpandedChildren.push(n);
            return true;
          }
        }
        const childReferenceRenderEnabled = (
          inReferenceMode
          && isAtRuleNode(node)
          && isContainerNode(n)
        )
          ? nodeExtendsReference(n, options)
          : renderEnabled;
        const keepReferenceFilteringForBareMirror = (
          inReferenceMode
          && renderEnabled
          && isRulesetNode(node)
          && isRulesetNode(n)
          && Boolean(
            (() => {
              const ownSelector = n.getOwnSelector();
              return ownSelector
                && !(ownSelector instanceof Nil)
                && isBareAmpersandOwnSelector(ownSelector);
            })()
          )
        );
        const childReferenceMode = (
          inReferenceMode
          && isAtRuleNode(node)
          && isContainerNode(n)
        )
          ? true
          : keepReferenceFilteringForBareMirror
            ? true
            : (inReferenceMode && renderEnabled && !isOptionalReferenceBoundary) ? false : inReferenceMode;
        const childOptions: FinalPrintOptions = {
          ...options,
          referenceMode: childReferenceMode,
          referenceRenderEnabled: childReferenceRenderEnabled,
          referenceRenderOnExtend: previousReferenceRenderOnExtend,
          preserveCapturedContainerFrame: true
        };
        const childOut = w.capture(() => n.toTrimmedString(childOptions));
        if (!childOut) {
          return true;
        }
        w.add(childOut, n);
        return true;
      }

      return false;
    });
    if (skipped) {
      continue;
    }

    withNodePosition(n, () => {
      let matches = -1;
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
        const f = inFrames[i]!;
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

      const idt = indent(options.depth + 1);
      const nn = n;
      let pre = w.capture(() => nn.processPrePost('pre', undefined, options));
      const out = isDeclarationNode(nn)
        ? (declarationOutputCache.get(nn) ?? w.capture(() => nn.toTrimmedString({ ...options, depth: options.depth + 1 })))
        : w.capture(() => nn.toTrimmedString({ ...options, depth: options.depth + 1 }));
      if (
        isNode(nn, N.Any)
        && !nn.requiredSemi
        && !out.trim()
        && !pre.trim()
      ) {
        return;
      }
      if (isDeclarationNode(nn)) {
        pre = pre.replace(/^[\s\S]*\n([ \t]*)$/g, '$1');
        const declIn = pre + out;
        const hasEmptyValue = /:\s*$/.test(out);
        const declNormalized = hasEmptyValue && (!pre || pre.trim() === '')
          ? `${idt}${out}`
          : normalizeIndent(declIn, idt, true);
        if (nn.isCustomProperty(options.context)) {
          w.add(idt);
          w.add(out, nn);
        } else {
          w.add(declNormalized, nn);
        }
      } else if (isRulesNode(nn)) {
        w.add(out, nn);
      } else if (isAtRuleNode(nn) && !nn.enterRules(options.context)) {
        w.add(out, nn);
      } else {
        w.add(idt);
        w.add(out, nn);
      }
      if (isDeclarationNode(nn) ? nn.requiresSemi(options.context) : nn.requiredSemi) {
        w.add(';');
      }

      w.add('\n');
      const post = w.capture(() => nn.processPrePost('post', undefined, options));
      if (!/^\s*$/.test(post)) {
        w.add(normalizeIndent(post, idt));
      }
    });
  }
  inFrames.pop();
  frameHeaders.pop();
  const frameCloseBase = options.preserveCapturedContainerFrame
    ? treeFrames.length + 1
    : treeFrames.length;
  while (lastRenderedFrames.length > frameCloseBase) {
    w.add(indent(lastRenderedFrames.length - 1) + '}\n');
    options.depth = Math.max(frameCloseBase, options.depth - 1);
    lastRenderedFrames.pop();
  }
  if (prevTreeFrames) {
    treeFrames.splice(0, treeFrames.length, ...prevTreeFrames);
  }
  for (const deferred of deferredExpandedChildren) {
    const deferredWriter = new OutputWriter();
    const childOptions: FinalPrintOptions = {
      ...options,
      writer: deferredWriter,
      frameHeaders,
      lastRenderedFrames,
      treeFrames,
      inFrames: treeFrames,
      referenceMode: inReferenceMode,
      referenceRenderEnabled: renderEnabled,
      referenceRenderOnExtend: previousReferenceRenderOnExtend
    };
    const childOut = withNodePosition(deferred, () => deferred.toTrimmedString(childOptions));
    if (!childOut) {
      continue;
    }

    w.add(childOut, deferred);
  }
  options.referenceMode = previousReferenceMode;
  options.referenceRenderEnabled = previousReferenceRenderEnabled;
  options.referenceRenderOnExtend = previousReferenceRenderOnExtend;
  return w.getSince(mark);
}
