import type { Context } from '../../context.js';
import type { Rules } from '../rules.js';
import type { Ruleset } from '../ruleset.js';
import type { Selector } from '../selector.js';
import { applyExtendsToSelector } from './extend.js';
import { isNode } from './is-node.js';
import { Nil } from '../nil.js';
import { syncLog } from './__tests__/debug-log.js';
import { ensureRulesetTraceId, getOptionalRulesetTraceId } from './ruleset-trace.js';
import { getImplicitSelector as getImplicitSelectorUtil } from './selector-utils.js';

export { ExtendRootRegistry } from './extend-roots.old.js';

const rulesetsByRoot = new Map<Rules, Set<Ruleset>>();

function getSourceNodeTraceId(ruleset: Ruleset): number | null {
  const sourceNode = ruleset.sourceNode as Ruleset | undefined;
  if (!sourceNode) {
    return null;
  }
  return getOptionalRulesetTraceId(sourceNode) ?? null;
}

export function registerRulesetWithRoot(root: Rules, ruleset: Ruleset): void {
  if (!root || !ruleset) {
    return;
  }
  let set = rulesetsByRoot.get(root);
  if (!set) {
    set = new Set<Ruleset>();
    rulesetsByRoot.set(root, set);
  }
  set.add(ruleset);
  const sourceNode = ruleset.sourceNode;
  const sourceNodeId = sourceNode && isNode(sourceNode, 'Ruleset')
    ? getOptionalRulesetTraceId(sourceNode as Ruleset) ?? null
    : null;
  syncLog({
    runId: 'pre',
    hypothesisId: 'ruleset-registry',
    location: 'extend-roots.ts:registerRulesetWithRoot',
    message: 'registering-ruleset-duplicate-check',
    data: {
      rulesetId: ensureRulesetTraceId(ruleset),
      selector: root.valueOf?.() ?? '',
      parentType: ruleset.parent?.type ?? null,
      setSize: set.size,
      sourceNodeId
    },
    timestamp: Date.now()
  });
  syncLog({
    sessionId: 'debug-session',
    runId: process.env.DEBUG_RUN_ID || 'extend-trace',
    hypothesisId: 'H-extend-roots',
    location: 'extend-roots.ts:registerRulesetWithRoot',
    message: 'ruleset-registered',
    data: {
      rulesetId: ensureRulesetTraceId(ruleset),
      root: root.valueOf?.() ?? null
    },
    timestamp: Date.now()
  });
}

export function processExtends(context: Context): void {
  const instructions = context.extends.map(([target, selectorWithExtend, partial, extendRoot]) => ({
    target,
    extendWith: selectorWithExtend,
    partial,
    extendRoot
  }));

  if (!instructions.length) {
    return;
  }

  for (const [rootRules, rulesetSet] of rulesetsByRoot) {
    if (!rootRules) {
      continue;
    }
    const visibleExtends = instructions.filter((instruction) => {
      if (!instruction.extendRoot) {
        return false;
      }
      if (instruction.extendRoot === rootRules) {
        return true;
      }
      return context.extendRoots.isSameOrDescendantRoot(rootRules, instruction.extendRoot);
    });
    if (!visibleExtends.length) {
      continue;
    }
    for (const ruleset of rulesetSet) {
      const selector = ruleset.value.selector as Selector | undefined;
      if (!selector || isNode(selector, 'Nil')) {
        continue;
      }
      const ownSelector = (ruleset.options as { ownSelector?: Selector })?.ownSelector;
      const hasResolvedNestedSelector = Boolean(
        ownSelector
        && ownSelector.valueOf() !== selector.valueOf()
      );
      const hasOnlyPartialExtends = visibleExtends.length > 0 && visibleExtends.every(instruction => instruction.partial);
      // #region agent log
      try {
        if (
          hasResolvedNestedSelector
          && ownSelector
          && selector.valueOf().includes('.replace')
          && visibleExtends.length > 0
          && visibleExtends.length <= 8
        ) {
          const parentSelectorNode = (
            ruleset.parent?.parent && isNode(ruleset.parent.parent, 'Ruleset')
              ? ((ruleset.parent.parent as Ruleset).value.selector as Selector | Nil | undefined)
              : undefined
          );
          const implicitExpandedSelector = (
            parentSelectorNode && !(parentSelectorNode instanceof Nil)
              ? getImplicitSelectorUtil(
                  ownSelector.copy(true) as Selector,
                  parentSelectorNode as Selector,
                  false
                )
              : null
          );
          const implicitCollapsedSelector = (
            parentSelectorNode && !(parentSelectorNode instanceof Nil)
              ? getImplicitSelectorUtil(
                  ownSelector.copy(true) as Selector,
                  parentSelectorNode as Selector,
                  true
                )
              : null
          );
          const instructionAudit = visibleExtends.map((instruction, idx) => {
            const fullSingle = applyExtendsToSelector(selector, [instruction]);
            const ownSingle = applyExtendsToSelector(ownSelector, [instruction]);
            const implicitExpandedSingle = implicitExpandedSelector
              ? applyExtendsToSelector(implicitExpandedSelector.copy(true) as Selector, [instruction])
              : null;
            const implicitCollapsedSingle = implicitCollapsedSelector
              ? applyExtendsToSelector(implicitCollapsedSelector.copy(true) as Selector, [instruction])
              : null;
            const targetValue = instruction.target?.valueOf?.() ?? '';
            const extendWithValue = instruction.extendWith?.valueOf?.() ?? '';
            return {
              index: idx,
              partial: instruction.partial,
              target: targetValue,
              extendWith: extendWithValue,
              fullChanged: fullSingle.valueOf() !== selector.valueOf(),
              ownChanged: ownSingle.valueOf() !== ownSelector.valueOf(),
              implicitExpandedChanged: implicitExpandedSingle
                ? implicitExpandedSingle.valueOf() !== implicitExpandedSelector!.valueOf()
                : false,
              implicitCollapsedChanged: implicitCollapsedSingle
                ? implicitCollapsedSingle.valueOf() !== implicitCollapsedSelector!.valueOf()
                : false,
              fullAfter: fullSingle.valueOf(),
              ownAfter: ownSingle.valueOf(),
              implicitExpandedAfter: implicitExpandedSingle?.valueOf() ?? null,
              implicitCollapsedAfter: implicitCollapsedSingle?.valueOf() ?? null
            };
          });
          syncLog({
            runId: process.env.DEBUG_RUN_ID || 'run',
            hypothesisId: 'H-INSTRUCTION-SCOPE-AUDIT',
            location: 'extend-roots.ts:processExtends',
            message: 'nested-instruction-audit',
            data: {
              rulesetId: ensureRulesetTraceId(ruleset),
              fullBefore: selector.valueOf(),
              ownBefore: ownSelector.valueOf(),
              parentSelector: (
                ruleset.parent?.parent && isNode(ruleset.parent.parent, 'Ruleset')
                  ? ((ruleset.parent.parent as Ruleset).value.selector as Selector | Nil | undefined)?.valueOf?.() ?? null
                  : null
              ),
              implicitExpanded: implicitExpandedSelector?.valueOf() ?? null,
              implicitCollapsed: implicitCollapsedSelector?.valueOf() ?? null,
              instructionAudit
            },
            timestamp: Date.now()
          });
        }
      } catch {}
      // #endregion
      // #region agent log
      try {
        if (
          ownSelector
          && hasResolvedNestedSelector
        ) {
          const ownResult = applyExtendsToSelector(ownSelector, visibleExtends);
          const fullResult = applyExtendsToSelector(selector, visibleExtends);
          syncLog({
            runId: process.env.DEBUG_RUN_ID || 'run',
            hypothesisId: 'H-OWN-VS-FULL',
            location: 'extend-roots.ts:processExtends',
            message: 'own-vs-full-extend-preview',
            data: {
              rulesetId: ensureRulesetTraceId(ruleset),
              parentRulesetId: (
                ruleset.parent?.parent && isNode(ruleset.parent.parent, 'Ruleset')
                  ? ensureRulesetTraceId(ruleset.parent.parent as Ruleset)
                  : null
              ),
              fullBefore: selector.valueOf(),
              fullAfter: fullResult.valueOf(),
              ownBefore: ownSelector.valueOf(),
              ownAfter: ownResult.valueOf(),
              fullChanged: fullResult.valueOf() !== selector.valueOf(),
              ownChanged: ownResult.valueOf() !== ownSelector.valueOf(),
              hasResolvedNestedSelector,
              hasPartialExtends: visibleExtends.some(instruction => instruction.partial)
            },
            timestamp: Date.now()
          });
        }
      } catch {}
      // #endregion
      if (ownSelector && hasResolvedNestedSelector && hasOnlyPartialExtends) {
        const ownNewSelector = applyExtendsToSelector(ownSelector, visibleExtends);
        const ownBefore = ownSelector.valueOf();
        const ownAfter = ownNewSelector.valueOf();
        syncLog({
          runId: process.env.DEBUG_RUN_ID || 'run',
          hypothesisId: 'H-OWN-ASSIGN-PATH',
          location: 'extend-roots.ts:processExtends',
          message: 'using-own-selector-for-nested-partial-extend',
          data: {
            rulesetId: ensureRulesetTraceId(ruleset),
            ownBefore,
            ownAfter,
            fullBefore: selector.valueOf(),
            changed: ownAfter !== ownBefore
          },
          timestamp: Date.now()
        });
        if (ownNewSelector !== ownSelector && ownAfter !== ownBefore) {
          ruleset.value.selector = ownNewSelector;
          (ruleset.options as { ownSelector?: Selector }).ownSelector = ownNewSelector;
          ruleset.invalidateSelectorValueCache();
          if (ownNewSelector.hoistToRoot) {
            ruleset.hoistToRoot = true;
          }
        }
        continue;
      }
      const newSelector = applyExtendsToSelector(selector, visibleExtends);
      if (newSelector !== selector) {
        const beforeValue = selector.valueOf();
        const afterValue = newSelector.valueOf();
        if (beforeValue === afterValue) {
          // #region agent log
          try {
            if (beforeValue.includes('[data="test3"]') || beforeValue.includes('.aa') || beforeValue.includes('.replace.replace')) {
              syncLog({
                runId: process.env.DEBUG_RUN_ID || 'run',
                hypothesisId: 'H-NOOP-ASSIGNMENT',
                location: 'extend-roots.ts:processExtends',
                message: 'skip-noop-selector-assignment',
                data: {
                  rulesetId: ensureRulesetTraceId(ruleset),
                  before: beforeValue,
                  after: afterValue,
                  requestedHoist: Boolean(newSelector.hoistToRoot)
                },
                timestamp: Date.now()
              });
            }
          } catch {}
          // #endregion
          syncLog({
            sessionId: 'debug-session',
            runId: process.env.DEBUG_RUN_ID || 'extend-trace',
            hypothesisId: 'H-hoist-noop-assignment',
            location: 'extend-roots.ts:processExtends',
            message: 'skip-noop-selector-assignment',
            data: {
              rulesetId: ensureRulesetTraceId(ruleset),
              before: beforeValue,
              after: afterValue,
              requestedHoist: Boolean(newSelector.hoistToRoot)
            },
            timestamp: Date.now()
          });
          continue;
        }
        ruleset.value.selector = newSelector;
        ruleset.invalidateSelectorValueCache();
        syncLog({
          runId: 'pre',
          hypothesisId: 'extend-assignment',
          location: 'extend-roots.ts:processExtends',
          message: 'ruleset-extended',
          data: {
            rulesetId: ensureRulesetTraceId(ruleset),
            before: beforeValue,
            after: afterValue,
            partialCount: visibleExtends.length
          },
          timestamp: Date.now()
        });
        syncLog({
          sessionId: 'debug-session',
          runId: process.env.DEBUG_RUN_ID || 'extend-trace',
          hypothesisId: 'H-extend-assign',
          location: 'extend-roots.ts:processExtends',
          message: 'ruleset-selector-assigned',
          data: {
            before: beforeValue,
            after: afterValue,
            visibleExtends: visibleExtends.length,
            rulesetId: ensureRulesetTraceId(ruleset),
            sourceNodeId: getSourceNodeTraceId(ruleset),
            hoistToRoot: Boolean(newSelector.hoistToRoot),
            parentRulesetId: (
              ruleset.parent?.parent && isNode(ruleset.parent.parent, 'Ruleset')
                ? ensureRulesetTraceId(ruleset.parent.parent as Ruleset)
                : null
            ),
            ownSelector: (ruleset.options as { ownSelector?: Selector })?.ownSelector?.valueOf?.() ?? null,
            parentSelector: (
              ruleset.parent?.parent && isNode(ruleset.parent.parent, 'Ruleset')
                ? ((ruleset.parent.parent as Ruleset).value.selector as Selector | Nil | undefined)?.valueOf?.() ?? null
                : null
            )
          },
          timestamp: Date.now()
        });
        if (newSelector.hoistToRoot) {
          ruleset.hoistToRoot = true;
        }
      }
    }
  }
}
