import type { Context } from '../../context.js';
import type { AtRule } from '../at-rule.js';
import { Combinator } from '../combinator.js';
import { ComplexSelector } from '../selector-complex.js';
import type { Rules } from '../rules.js';
import type { Ruleset } from '../ruleset.js';
import type { Selector } from '../selector.js';
import { SelectorList } from '../selector-list.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { applyExtendsToSelector } from './extend.js';
import { findExtendableLocations } from './extend-helpers.js';
import { isNode } from './is-node.js';
import { Nil } from '../nil.js';
import { syncLog } from './__tests__/debug-log.js';
import { ensureRulesetTraceId, getOptionalRulesetTraceId } from './ruleset-trace.js';
import { getImplicitSelector as getImplicitSelectorUtil } from './selector-utils.js';

export class ExtendRootRegistry {
  private parentRoot = new WeakMap<Rules, Rules>();
  private childrenRoots = new WeakMap<Rules, Set<Rules>>();
  private layerName = new WeakMap<Rules, string>();
  private isProtected = new WeakMap<Rules, boolean>();
  private isCompose = new WeakMap<Rules, boolean>();
  private rootsByLayerName = new Map<string, Set<Rules>>();
  private rootsByNamespace = new Map<string, Set<Rules>>();
  private layerNames = new WeakMap<AtRule, string>();

  root?: Rules;
  extendRootStack: Rules[] = [];

  getCurrentExtendRoot(): Rules | undefined {
    return this.extendRootStack[this.extendRootStack.length - 1];
  }

  registerRoot(
    rules: Rules,
    parent?: Rules,
    options?: { layerName?: string; isProtected?: boolean; isCompose?: boolean; namespace?: string }
  ): void {
    if (!this.root) {
      this.root = rules;
    }

    if (parent) {
      this.parentRoot.set(rules, parent);
      let children = this.childrenRoots.get(parent);
      if (!children) {
        children = new Set<Rules>();
        this.childrenRoots.set(parent, children);
      }
      children.add(rules);
    }

    if (options?.layerName) {
      this.layerName.set(rules, options.layerName);
      let layerRoots = this.rootsByLayerName.get(options.layerName);
      if (!layerRoots) {
        layerRoots = new Set<Rules>();
        this.rootsByLayerName.set(options.layerName, layerRoots);
      }
      layerRoots.add(rules);
    }

    if (options?.namespace) {
      let nsRoots = this.rootsByNamespace.get(options.namespace);
      if (!nsRoots) {
        nsRoots = new Set<Rules>();
        this.rootsByNamespace.set(options.namespace, nsRoots);
      }
      nsRoots.add(rules);
    }

    if (options?.isProtected) {
      this.isProtected.set(rules, true);
    }
    if (options?.isCompose) {
      this.isCompose.set(rules, true);
    }
  }

  pushExtendRoot(rules: Rules): void {
    this.extendRootStack.push(rules);
  }

  popExtendRoot(): void {
    this.extendRootStack.pop();
  }

  getVisibleRoots(root: Rules): Set<Rules> {
    return this.getAccessibleRoots(root);
  }

  getAccessibleRoots(root: Rules): Set<Rules> {
    const accessible = new Set<Rules>();
    const visited = new Set<Rules>();

    const traverseChildren = (currentRoot: Rules): void => {
      if (visited.has(currentRoot)) {
        return;
      }
      visited.add(currentRoot);
      accessible.add(currentRoot);

      if (this.isProtected.get(currentRoot)) {
        return;
      }

      const children = this.childrenRoots.get(currentRoot);
      if (children) {
        for (const child of children) {
          if (this.isProtected.get(child)) {
            continue;
          }
          traverseChildren(child);
        }
      }

      if (currentRoot.value?.length) {
        for (const node of currentRoot.value) {
          if (node && isNode(node, 'Ruleset') && node.value?.rules && isNode(node.value.rules, 'Rules')) {
            const innerRules = node.value.rules as Rules;
            if (!visited.has(innerRules)) {
              accessible.add(innerRules);
              traverseChildren(innerRules);
            }
          } else if (node && isNode(node, 'Rules')) {
            const innerRules = node as Rules;
            if (!visited.has(innerRules)) {
              accessible.add(innerRules);
              traverseChildren(innerRules);
            }
          }
        }
      }

      const layer = this.layerName.get(currentRoot);
      if (layer) {
        const sameLayerRoots = this.rootsByLayerName.get(layer);
        if (sameLayerRoots) {
          for (const layerRoot of sameLayerRoots) {
            if (layerRoot !== currentRoot && !visited.has(layerRoot) && !this.isProtected.get(layerRoot)) {
              accessible.add(layerRoot);
              traverseChildren(layerRoot);
            }
          }
        }
      }
    };

    traverseChildren(root);
    return accessible;
  }

  isSameOrDescendantRoot(rulesetRoot: Rules, extendRoot: Rules): boolean {
    if (rulesetRoot === extendRoot) {
      return true;
    }
    const layerA = this.layerName.get(rulesetRoot);
    const layerB = this.layerName.get(extendRoot);
    if (layerA && layerB && layerA === layerB) {
      return true;
    }
    const children = this.childrenRoots.get(extendRoot);
    if (!children) {
      return false;
    }
    for (const child of children) {
      if (this.isSameOrDescendantRoot(rulesetRoot, child)) {
        return true;
      }
    }
    return false;
  }

  setLayerName(atRule: AtRule, layerName: string): void {
    this.layerNames.set(atRule, layerName);
  }

  getLayerName(atRule: AtRule): string | undefined {
    return this.layerNames.get(atRule);
  }

  takeLayerName(atRule: AtRule): string | undefined {
    const layer = this.layerNames.get(atRule);
    if (layer) {
      this.layerNames.delete(atRule);
    }
    return layer;
  }
}

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
  const debugRunId = process.env.DEBUG_RUN_ID || 'run';
  const debugParity = debugRunId.startsWith('parity-');
  const sendParityLog = (
    hypothesisId: string,
    location: string,
    message: string,
    data: Record<string, unknown>
  ): void => {
    syncLog({
      runId: debugRunId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now()
    });
  };
  const isParitySelector = (value: string): boolean => (
    value.includes('.ma')
    || value.includes('.mb')
    || value.includes('.mc')
    || value.includes('.md')
    || value.includes('.header-nav')
    || value.includes('.footer-nav')
    || value.includes('.issue-2586')
    || value.includes('.content')
  );
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
      if (context.extendRoots.isSameOrDescendantRoot(rootRules, instruction.extendRoot)) {
        return true;
      }
      const visibleRoots = context.extendRoots.getVisibleRoots(instruction.extendRoot);
      return visibleRoots.has(rootRules);
    });
    if (debugParity) {
      // #region agent log
      sendParityLog(
        'H1-root-visibility',
        'extend-roots.ts:processExtends:root-loop',
        'visible-extends-per-root',
        {
          root: rootRules?.valueOf?.() ?? null,
          visibleCount: visibleExtends.length,
          sampleVisible: visibleExtends.slice(0, 6).map(x => ({
            target: x.target?.valueOf?.() ?? null,
            extendWith: x.extendWith?.valueOf?.() ?? null,
            partial: Boolean(x.partial),
            sameRoot: Boolean(x.extendRoot === rootRules)
          }))
        }
      );
      // #endregion
      // #region agent log
      const rootSetSample = Array.from(rulesetSet).slice(0, 8).map(r =>
        (r.value?.selector as Selector | undefined)?.valueOf?.() ?? null
      );
      if (visibleExtends.length === 0) {
        sendParityLog(
          'H5-zero-visible-diagnostics',
          'extend-roots.ts:processExtends:zero-visible',
          'parity-root-has-rulesets-but-no-visible-instructions',
          {
            root: rootRules?.valueOf?.() ?? null,
            rulesetCount: rulesetSet.size,
            rootSetSample,
            instructionChecks: instructions.slice(0, 8).map(ins => ({
              target: ins.target?.valueOf?.() ?? null,
              extendWith: ins.extendWith?.valueOf?.() ?? null,
              extendRoot: ins.extendRoot?.valueOf?.() ?? null,
              sameRoot: ins.extendRoot === rootRules,
              isDescendantCheck: ins.extendRoot
                ? context.extendRoots.isSameOrDescendantRoot(rootRules, ins.extendRoot)
                : false,
              visibleByAccessibleRef: (() => {
                if (!ins.extendRoot) {
                  return false;
                }
                try {
                  return context.extendRoots.getVisibleRoots(ins.extendRoot).has(rootRules);
                } catch {
                  return false;
                }
              })(),
              visibleByAccessibleValue: (() => {
                if (!ins.extendRoot) {
                  return false;
                }
                try {
                  const roots = context.extendRoots.getVisibleRoots(ins.extendRoot);
                  const current = rootRules.valueOf?.() ?? '';
                  for (const r of roots) {
                    if ((r.valueOf?.() ?? '') === current) {
                      return true;
                    }
                  }
                } catch {}
                return false;
              })()
            }))
          }
        );
      }
      // #endregion
    }
    if (!visibleExtends.length) {
      continue;
    }
    for (const ruleset of rulesetSet) {
      const selector = ruleset.value.selector as Selector | undefined;
      if (!selector || isNode(selector, 'Nil')) {
        continue;
      }
      // #region agent log
      try {
        const runId = process.env.DEBUG_RUN_ID || 'run';
        if (runId.startsWith('integration-regressions')) {
          const selectorStr = selector.valueOf();
          if (
            selectorStr.includes('.header-nav')
            || selectorStr.includes('.footer-nav')
            || selectorStr.includes('.replace')
          ) {
            const rulesArr = (ruleset.value.rules as unknown as { value?: unknown[] })?.value ?? [];
            const ruleKinds = Array.isArray(rulesArr)
              ? rulesArr.slice(0, 8).map(x => (x as { type?: string })?.type ?? null)
              : [];
            let declNames: Array<string | null> = [];
            if (Array.isArray(rulesArr)) {
              declNames = rulesArr
                .filter(x => (x as { type?: string })?.type === 'Declaration')
                .slice(0, 8)
                .map(x => (x as { value?: { name?: { valueOf?: () => string } } }).value?.name?.valueOf?.() ?? null);
            }
            syncLog({
              runId,
              hypothesisId: 'H-RULESET-RULE-OWNERSHIP',
              location: 'extend-roots.ts:processExtends',
              message: 'ruleset-before-apply',
              data: {
                rulesetId: ensureRulesetTraceId(ruleset),
                selector: selectorStr,
                ownSelector: (ruleset.options as { ownSelector?: Selector })?.ownSelector?.valueOf?.() ?? null,
                parentSelector: (
                  ruleset.parent?.parent && isNode(ruleset.parent.parent, 'Ruleset')
                    ? (((ruleset.parent.parent as Ruleset).value.selector as Selector | Nil | undefined)?.valueOf?.() ?? null)
                    : null
                ),
                rulesCount: Array.isArray(rulesArr) ? rulesArr.length : null,
                ruleKinds,
                declNames
              },
              timestamp: Date.now()
            });
          }
        }
      } catch {}
      // #endregion
      if (debugParity) {
        const selectorStr = selector.valueOf();
        if (isParitySelector(selectorStr)) {
          // #region agent log
          sendParityLog(
            'H2-ruleset-sees-instructions',
            'extend-roots.ts:processExtends:ruleset-loop',
            'parity-ruleset-input',
            {
              rulesetId: ensureRulesetTraceId(ruleset),
              selector: selectorStr,
              root: rootRules?.valueOf?.() ?? null,
              visibleCount: visibleExtends.length,
              visibleTargets: visibleExtends.slice(0, 8).map(x => x.target?.valueOf?.() ?? null),
              visibleExtenders: visibleExtends.slice(0, 8).map(x => x.extendWith?.valueOf?.() ?? null)
            }
          );
          // #endregion
        }
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
          const fullHasAmpersand = (() => {
            try {
              for (const n of selector.nodes()) {
                if (isNode(n, 'Ampersand')) {
                  return true;
                }
              }
            } catch {}
            return false;
          })();
          const ownHasAmpersand = (() => {
            try {
              for (const n of ownSelector.nodes()) {
                if (isNode(n, 'Ampersand')) {
                  return true;
                }
              }
            } catch {}
            return false;
          })();
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
              fullHasAmpersand,
              ownHasAmpersand,
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
        const fullNewSelector = applyExtendsToSelector(selector, visibleExtends);
        const ownBefore = ownSelector.valueOf();
        const ownAfter = ownNewSelector.valueOf();
        const fullBefore = selector.valueOf();
        const fullAfter = fullNewSelector.valueOf();
        syncLog({
          runId: process.env.DEBUG_RUN_ID || 'run',
          hypothesisId: 'H-OWN-ASSIGN-PATH',
          location: 'extend-roots.ts:processExtends',
          message: 'using-own-selector-for-nested-partial-extend',
          data: {
            rulesetId: ensureRulesetTraceId(ruleset),
            ownBefore,
            ownAfter,
            fullBefore,
            fullAfter,
            ownChanged: ownAfter !== ownBefore,
            fullChanged: fullAfter !== fullBefore
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
          continue;
        }
        if (fullAfter === fullBefore) {
          continue;
        }
      }
      if (ownSelector && hasResolvedNestedSelector) {
        const partialOnly = visibleExtends.filter(instruction => instruction.partial);
        const nonPartialOnly = visibleExtends.filter(instruction => !instruction.partial);
        if (partialOnly.length > 0 && nonPartialOnly.length === 0) {
          const ownAfterPartialOnly = applyExtendsToSelector(ownSelector, partialOnly);
          const fullAfterPartialOnly = applyExtendsToSelector(selector, partialOnly);
          const ownChangedByPartialOnly = ownAfterPartialOnly.valueOf() !== ownSelector.valueOf();
          const fullChangedByPartialOnly = fullAfterPartialOnly.valueOf() !== selector.valueOf();
          // #region agent log
          if (
            ownSelector.valueOf().includes('[data')
            || ownSelector.valueOf().includes('@{attr-data}')
            || selector.valueOf().includes('[data')
          ) {
            syncLog({
              runId: process.env.DEBUG_RUN_ID || 'run',
              hypothesisId: 'H-PARTIAL-OWN-SHAPE',
              location: 'extend-roots.ts:processExtends',
              message: 'partial-only-own-full-shape',
              data: {
                rulesetId: ensureRulesetTraceId(ruleset),
                ownBefore: ownSelector.valueOf(),
                ownAfterPartialOnly: ownAfterPartialOnly.valueOf(),
                fullBefore: selector.valueOf(),
                fullAfterPartialOnly: fullAfterPartialOnly.valueOf(),
                ownChangedByPartialOnly,
                fullChangedByPartialOnly,
                fullAfterType: (fullAfterPartialOnly as any)?.type ?? null
              },
              timestamp: Date.now()
            });
          }
          // #endregion
          const parentSelector = (
            ruleset.parent?.parent && isNode(ruleset.parent.parent, 'Ruleset')
              ? (ruleset.parent.parent as Ruleset).value.selector
              : null
          );
          const canDeriveOwnFromGeneratedIs = Boolean(
            !ownChangedByPartialOnly
            && fullChangedByPartialOnly
            && parentSelector
            && !(parentSelector instanceof Nil)
            && isNode(fullAfterPartialOnly, 'ComplexSelector')
          );
          if (canDeriveOwnFromGeneratedIs) {
            const complex = fullAfterPartialOnly as ComplexSelector;
            const last = complex.value.at(-1);
            // #region agent log
            if (
              ownSelector.valueOf().includes('[data')
              || ownSelector.valueOf().includes('@{attr-data}')
              || selector.valueOf().includes('[data')
            ) {
              syncLog({
                runId: process.env.DEBUG_RUN_ID || 'run',
                hypothesisId: 'H-PARTIAL-OWN-SHAPE',
                location: 'extend-roots.ts:processExtends',
                message: 'partial-only-tail-shape',
                data: {
                  rulesetId: ensureRulesetTraceId(ruleset),
                  canDeriveOwnFromGeneratedIs,
                  lastType: (last as any)?.type ?? null,
                  lastValue: (last as any)?.valueOf?.() ?? null,
                  isPseudoIs: Boolean(last && isNode(last, 'PseudoSelector') && (last as PseudoSelector).value.name === ':is'),
                  hasArg: Boolean(last && isNode(last, 'PseudoSelector') && (last as PseudoSelector).value.arg),
                  argType: last && isNode(last, 'PseudoSelector')
                    ? ((last as PseudoSelector).value.arg as any)?.type ?? null
                    : null
                },
                timestamp: Date.now()
              });
            }
            // #endregion
            if (
              last
              && isNode(last, 'PseudoSelector')
              && (last as PseudoSelector).value.name === ':is'
              && (last as PseudoSelector).value.arg
              && isNode((last as PseudoSelector).value.arg!, 'SelectorList')
            ) {
              const derivedOwn = ((last as PseudoSelector).value.arg as SelectorList).copy(true) as Selector;
              // #region agent log
              syncLog({
                runId: process.env.DEBUG_RUN_ID || 'run',
                hypothesisId: 'H-PARTIAL-OWN-FALLBACK',
                location: 'extend-roots.ts:processExtends',
                message: 'derived-own-from-generated-is-tail',
                data: {
                  rulesetId: ensureRulesetTraceId(ruleset),
                  ownBefore: ownSelector.valueOf(),
                  fullBefore: selector.valueOf(),
                  fullAfterPartialOnly: fullAfterPartialOnly.valueOf(),
                  derivedOwn: derivedOwn.valueOf()
                },
                timestamp: Date.now()
              });
              // #endregion
              ruleset.value.selector = derivedOwn;
              (ruleset.options as { ownSelector?: Selector }).ownSelector = derivedOwn;
              ruleset.invalidateSelectorValueCache();
              continue;
            }
          }
        }
        if (partialOnly.length === 0 && nonPartialOnly.length > 0) {
          const parentSelectorForOwnSplit = (
            ruleset.parent?.parent && isNode(ruleset.parent.parent, 'Ruleset')
              ? (ruleset.parent.parent as Ruleset).value.selector
              : null
          );
          const nonPartialDiagnostics = nonPartialOnly.map((instruction) => {
            const ownAfterSingle = applyExtendsToSelector(ownSelector, [instruction]);
            const fullAfterSingle = applyExtendsToSelector(selector, [instruction]);
            const ownChangedSingle = ownAfterSingle.valueOf() !== ownSelector.valueOf();
            const fullChangedSingle = fullAfterSingle.valueOf() !== selector.valueOf();
            const parentHasTargetMatch = Boolean(
              parentSelectorForOwnSplit
              && !(parentSelectorForOwnSplit instanceof Nil)
              && findExtendableLocations(
                parentSelectorForOwnSplit as Selector,
                instruction.target
              ).hasMatches
            );
            return {
              instruction,
              ownChangedSingle,
              fullChangedSingle,
              parentHasTargetMatch
            };
          });
          const fullChangedExtendWith = new Set(
            nonPartialDiagnostics
              .filter(d => d.fullChangedSingle)
              .map(d => d.instruction.extendWith.valueOf())
          );
          const nonPartialWithInclusion = nonPartialDiagnostics.map((d) => {
            const includeOwnOnly = (
              d.ownChangedSingle
              && !d.fullChangedSingle
              && !d.parentHasTargetMatch
              && !fullChangedExtendWith.has(d.instruction.extendWith.valueOf())
            );
            return { ...d, includeOwnOnly };
          });
          const nonPartialOwnOnly = nonPartialWithInclusion
            .filter(x => x.includeOwnOnly)
            .map(x => x.instruction);
          const ownAfterOwnOnly = applyExtendsToSelector(ownSelector, nonPartialOwnOnly);
          const hasAncestorDrivenNonPartial = nonPartialWithInclusion.some(d =>
            !d.ownChangedSingle
            && d.fullChangedSingle
            && d.parentHasTargetMatch
          );
          // #region agent log
          syncLog({
            runId: process.env.DEBUG_RUN_ID || 'run',
            hypothesisId: 'H-NONPARTIAL-OWN-FULL-SPLIT',
            location: 'extend-roots.ts:processExtends',
            message: 'nonpartial-only-own-full-decision',
            data: {
              rulesetId: ensureRulesetTraceId(ruleset),
              ownBefore: ownSelector.valueOf(),
              ownAfterOwnOnly: ownAfterOwnOnly.valueOf(),
              fullBefore: selector.valueOf(),
              hasAncestorDrivenNonPartial,
              nonPartialOwnOnlyCount: nonPartialOwnOnly.length,
              nonPartialDiagnostics: nonPartialWithInclusion.map(d => ({
                target: d.instruction.target.valueOf(),
                extendWith: d.instruction.extendWith.valueOf(),
                ownChangedSingle: d.ownChangedSingle,
                fullChangedSingle: d.fullChangedSingle,
                parentHasTargetMatch: d.parentHasTargetMatch,
                includeOwnOnly: d.includeOwnOnly
              }))
            },
            timestamp: Date.now()
          });
          // #endregion
          if (hasAncestorDrivenNonPartial) {
            // Parent already carries this non-partial effect; keep nested selector local.
            ruleset.value.selector = ownAfterOwnOnly;
            (ruleset.options as { ownSelector?: Selector }).ownSelector = ownAfterOwnOnly;
            ruleset.invalidateSelectorValueCache();
            continue;
          }
        }
        if (partialOnly.length > 0 && nonPartialOnly.length > 0) {
          const parentSelectorForOwnSplit = (
            ruleset.parent?.parent && isNode(ruleset.parent.parent, 'Ruleset')
              ? (ruleset.parent.parent as Ruleset).value.selector
              : null
          );
          const nonPartialDiagnostics = nonPartialOnly.map((instruction) => {
            const ownAfterSingle = applyExtendsToSelector(ownSelector, [instruction]);
            const fullAfterSingle = applyExtendsToSelector(selector, [instruction]);
            const ownChangedSingle = ownAfterSingle.valueOf() !== ownSelector.valueOf();
            const fullChangedSingle = fullAfterSingle.valueOf() !== selector.valueOf();
            const parentHasTargetMatch = Boolean(
              parentSelectorForOwnSplit
              && !(parentSelectorForOwnSplit instanceof Nil)
              && findExtendableLocations(
                parentSelectorForOwnSplit as Selector,
                instruction.target
              ).hasMatches
            );
            return {
              instruction,
              ownChangedSingle,
              fullChangedSingle,
              parentHasTargetMatch
            };
          });
          const fullChangedExtendWith = new Set(
            nonPartialDiagnostics
              .filter(d => d.fullChangedSingle)
              .map(d => d.instruction.extendWith.valueOf())
          );
          const nonPartialWithInclusion = nonPartialDiagnostics.map((d) => {
            const includeOwnOnly = (
              d.ownChangedSingle
              && !d.fullChangedSingle
              && !d.parentHasTargetMatch
              && !fullChangedExtendWith.has(d.instruction.extendWith.valueOf())
            );
            return { ...d, includeOwnOnly };
          });
          const nonPartialOwnOnly = nonPartialWithInclusion
            .filter(x => x.includeOwnOnly)
            .map(x => x.instruction);
          const ownAfterPartialAndOwnOnlyNonPartial = applyExtendsToSelector(
            ownSelector,
            [...partialOnly, ...nonPartialOwnOnly]
          );
          const ownAfterPartial = applyExtendsToSelector(ownSelector, partialOnly);
          const ownAfterNonPartial = applyExtendsToSelector(ownSelector, nonPartialOnly);
          const ownAfterAll = applyExtendsToSelector(ownSelector, visibleExtends);
          const fullAfterNonPartial = applyExtendsToSelector(selector, nonPartialOnly);
          const ownChangedByNonPartial = ownAfterNonPartial.valueOf() !== ownSelector.valueOf();
          const fullChangedByNonPartial = fullAfterNonPartial.valueOf() !== selector.valueOf();
          const nonPartialBoundaryOnly = !ownChangedByNonPartial && fullChangedByNonPartial;
          const ownChangedByPartial = ownAfterPartial.valueOf() !== ownSelector.valueOf();
          const hasAncestorDrivenNonPartial = nonPartialWithInclusion.some(d =>
            !d.ownChangedSingle
            && d.fullChangedSingle
            && d.parentHasTargetMatch
          );
          const shouldDeferToParentForNonPartial = Boolean(
            !ownChangedByPartial
            && nonPartialOwnOnly.length === 0
            && hasAncestorDrivenNonPartial
          );
          // #region agent log
          syncLog({
            runId: process.env.DEBUG_RUN_ID || 'run',
            hypothesisId: 'H-MIXED-OWN-FULL-SPLIT',
            location: 'extend-roots.ts:processExtends',
            message: 'mixed-own-full-decision',
            data: {
              rulesetId: ensureRulesetTraceId(ruleset),
              ownBefore: ownSelector.valueOf(),
              ownAfterPartial: ownAfterPartial.valueOf(),
              ownAfterPartialAndOwnOnlyNonPartial: ownAfterPartialAndOwnOnlyNonPartial.valueOf(),
              ownAfterNonPartial: ownAfterNonPartial.valueOf(),
              ownAfterAll: ownAfterAll.valueOf(),
              fullBefore: selector.valueOf(),
              fullAfterNonPartial: fullAfterNonPartial.valueOf(),
              ownChangedByPartial,
              ownChangedByNonPartial,
              fullChangedByNonPartial,
              nonPartialOwnOnlyCount: nonPartialOwnOnly.length,
              nonPartialOwnOnly: nonPartialOwnOnly.map(instruction => ({
                target: instruction.target.valueOf(),
                extendWith: instruction.extendWith.valueOf()
              })),
              hasAncestorDrivenNonPartial,
              shouldDeferToParentForNonPartial,
              nonPartialDiagnostics: nonPartialWithInclusion.map(d => ({
                target: d.instruction.target.valueOf(),
                extendWith: d.instruction.extendWith.valueOf(),
                ownChangedSingle: d.ownChangedSingle,
                fullChangedSingle: d.fullChangedSingle,
                parentHasTargetMatch: d.parentHasTargetMatch,
                includeOwnOnly: d.includeOwnOnly
              })),
              nonPartialBoundaryOnly
            },
            timestamp: Date.now()
          });
          // #endregion
          // For nested rulesets, apply partial (`all`) updates to own selector, but do not
          // fold non-partial changes into own selector. Non-partial changes are handled
          // through full-selector assignment path below when needed.
          if (ownChangedByPartial || nonPartialOwnOnly.length > 0) {
            ruleset.value.selector = ownAfterPartialAndOwnOnlyNonPartial;
            (ruleset.options as { ownSelector?: Selector }).ownSelector = ownAfterPartialAndOwnOnlyNonPartial;
            ruleset.invalidateSelectorValueCache();
            continue;
          }
          if (shouldDeferToParentForNonPartial) {
            // Parent selector already carries the non-partial extend effect.
            // Keep this nested ruleset relative to its own selector to avoid
            // re-materializing parent prefixes inside nested blocks.
            ruleset.value.selector = ownAfterPartial;
            (ruleset.options as { ownSelector?: Selector }).ownSelector = ownAfterPartial;
            ruleset.invalidateSelectorValueCache();
            continue;
          }
        }
      }
      // #region agent log
      try {
        if (ownSelector && hasResolvedNestedSelector) {
          const partialOnly = visibleExtends.filter(instruction => instruction.partial);
          const nonPartialOnly = visibleExtends.filter(instruction => !instruction.partial);
          if (partialOnly.length > 0 && nonPartialOnly.length > 0) {
            const ownPartialOnly = applyExtendsToSelector(ownSelector, partialOnly);
            const fullNonPartialOnly = applyExtendsToSelector(selector, nonPartialOnly);
            syncLog({
              runId: process.env.DEBUG_RUN_ID || 'run',
              hypothesisId: 'H-MIXED-OWN-FULL-SPLIT',
              location: 'extend-roots.ts:processExtends',
              message: 'mixed-own-full-split-preview',
              data: {
                rulesetId: ensureRulesetTraceId(ruleset),
                ownBefore: ownSelector.valueOf(),
                ownAfterPartialOnly: ownPartialOnly.valueOf(),
                fullBefore: selector.valueOf(),
                fullAfterNonPartialOnly: fullNonPartialOnly.valueOf(),
                ownChangedByPartial: ownPartialOnly.valueOf() !== ownSelector.valueOf(),
                fullChangedByNonPartial: fullNonPartialOnly.valueOf() !== selector.valueOf(),
                partialCount: partialOnly.length,
                nonPartialCount: nonPartialOnly.length
              },
              timestamp: Date.now()
            });
          }
        }
      } catch {}
      // #endregion
      let newSelector = applyExtendsToSelector(selector, visibleExtends);
      if (debugParity) {
        const selectorStr = selector.valueOf();
        if (isParitySelector(selectorStr)) {
          // #region agent log
          sendParityLog(
            'H3-apply-extends-result',
            'extend-roots.ts:processExtends:post-apply',
            'parity-ruleset-apply-result',
            {
              rulesetId: ensureRulesetTraceId(ruleset),
              before: selectorStr,
              after: newSelector?.valueOf?.() ?? null,
              changedByValue: (newSelector?.valueOf?.() ?? '') !== selectorStr,
              changedByRef: newSelector !== selector
            }
          );
          // #endregion
        }
      }
      // #region agent log
      try {
        if (
          selector.valueOf() === '.replace.replace,.c.replace+.replace'
          && visibleExtends.some(instruction => instruction.extendWith?.valueOf?.() === '.rep_ace')
        ) {
          syncLog({
            runId: process.env.DEBUG_RUN_ID || 'run',
            hypothesisId: 'H-SERIALIZED-TARGET-ROOT',
            location: 'extend-roots.ts:processExtends',
            message: 'root-ruleset-extend-check',
            data: {
              rulesetId: ensureRulesetTraceId(ruleset),
              before: selector.valueOf(),
              after: newSelector.valueOf(),
              changedByRef: newSelector !== selector,
              changedByValue: newSelector.valueOf() !== selector.valueOf(),
              visibleExtends: visibleExtends.map(x => ({
                target: x.target.valueOf(),
                extendWith: x.extendWith.valueOf(),
                partial: x.partial
              }))
            },
            timestamp: Date.now()
          });
        }
      } catch {}
      // #endregion
      if (newSelector !== selector) {
        const beforeValue = selector.valueOf();
        const ownRelevantExtends = (ownSelector && hasResolvedNestedSelector)
          ? visibleExtends.filter(instruction => instruction.partial)
          : visibleExtends;
        const ownAfterRelevant = (ownSelector && hasResolvedNestedSelector)
          ? applyExtendsToSelector(ownSelector, ownRelevantExtends)
          : null;
        const ownChangedByRelevant = Boolean(
          ownSelector
          && ownAfterRelevant
          && ownAfterRelevant.valueOf() !== ownSelector.valueOf()
        );
        const parentRuleset = (
          ruleset.parent?.parent && isNode(ruleset.parent.parent, 'Ruleset')
            ? (ruleset.parent.parent as Ruleset)
            : null
        );
        const parentSelectorForBoundary = parentRuleset?.value.selector;
        const parentHasCombinatorContext = Boolean(
          parentSelectorForBoundary
          && !(parentSelectorForBoundary instanceof Nil)
          && (() => {
            try {
              for (const n of (parentSelectorForBoundary as Selector).nodes()) {
                if (isNode(n, 'Combinator')) {
                  return true;
                }
              }
            } catch {}
            return false;
          })()
        );
        const parentHoistedBoundaryCompose = Boolean(
          ownSelector
          && hasResolvedNestedSelector
          && !hasOnlyPartialExtends
          && !ownChangedByRelevant
          && parentRuleset?.hoistToRoot
          && !newSelector.hoistToRoot
        );
        if (parentHoistedBoundaryCompose) {
          const parentSelector = parentRuleset?.value.selector;
          if (parentSelector && !(parentSelector instanceof Nil) && isNode(parentSelector, 'SelectorList')) {
            const parentItems = (parentSelector as SelectorList).value;
            const complexItems = parentItems.filter(item => isNode(item, 'ComplexSelector')) as ComplexSelector[];
            if (complexItems.length === parentItems.length && complexItems.length >= 2) {
              const first = complexItems[0]!;
              const allTri = complexItems.every(c => c.value.length === 3 && isNode(c.value[1], 'Combinator'));
              if (allTri) {
                const leftKey = first.value[0]!.valueOf();
                const combKey = first.value[1]!.valueOf();
                const samePrefix = complexItems.every(c =>
                  c.value[0]!.valueOf() === leftKey
                  && c.value[1]!.valueOf() === combKey
                );
                if (samePrefix) {
                  const ownSelectorNode = ownSelector as Selector;
                  const middleIs = PseudoSelector.create({
                    name: ':is',
                    arg: SelectorList.create(
                      complexItems.map(c => c.value[2]!.copy(true) as Selector)
                    )
                  });
                  const parentFactored = ComplexSelector.create([
                    first.value[0]!.copy(true) as Selector,
                    (first.value[1] as Combinator).copy(true),
                    middleIs
                  ]);
                  const ownArg = isNode(ownSelectorNode, 'SelectorList')
                    ? SelectorList.create((ownSelectorNode as SelectorList).value.map(s => s.copy(true) as Selector))
                    : SelectorList.create([ownSelectorNode.copy(true) as Selector]);
                  const ownIs = PseudoSelector.create({ name: ':is', arg: ownArg });
                  newSelector = ComplexSelector.create([
                    ...parentFactored.value.map(c => c.copy(true)),
                    Combinator.create(' '),
                    ownIs
                  ]).inherit(newSelector) as Selector;
                  newSelector.hoistToRoot = true;
                  // #region agent log
                  syncLog({
                    runId: process.env.DEBUG_RUN_ID || 'run',
                    hypothesisId: 'H-HOIST-DECISION',
                    location: 'extend-roots.ts:processExtends',
                    message: 'parent-hoisted-boundary-composed',
                    data: {
                      rulesetId: ensureRulesetTraceId(ruleset),
                      parentSelector: parentSelector.valueOf(),
                      ownSelector: ownSelectorNode.valueOf(),
                      afterPreview: newSelector.valueOf()
                    },
                    timestamp: Date.now()
                  });
                  // #endregion
                }
              }
            }
          }
        }
        const boundaryOnlyNestedExactChange = Boolean(
          ownSelector
          && hasResolvedNestedSelector
          && !hasOnlyPartialExtends
          && !ownChangedByRelevant
          && parentHasCombinatorContext
          && !(
            ruleset.parent?.parent
            && isNode(ruleset.parent.parent, 'Ruleset')
            && Boolean((ruleset.parent.parent as Ruleset).hoistToRoot)
          )
          && !newSelector.hoistToRoot
        );
        if (boundaryOnlyNestedExactChange) {
          newSelector.hoistToRoot = true;
          // #region agent log
          try {
            syncLog({
              runId: process.env.DEBUG_RUN_ID || 'run',
              hypothesisId: 'H-HOIST-DECISION',
              location: 'extend-roots.ts:processExtends',
              message: 'boundary-hoist-applied',
              data: {
                rulesetId: ensureRulesetTraceId(ruleset),
                before: beforeValue,
                afterPreview: newSelector.valueOf(),
                ownBefore: ownSelector?.valueOf?.() ?? null,
                ownAfter: ownAfterRelevant?.valueOf?.() ?? null,
                parentHasCombinatorContext,
                hasResolvedNestedSelector,
                hasOnlyPartialExtends
              },
              timestamp: Date.now()
            });
          } catch {}
          // #endregion
        }
        const afterValue = newSelector.valueOf();
        // #region agent log
        try {
          if (beforeValue.includes('.replace') || afterValue.includes('.replace') || afterValue.includes('rep_ace')) {
            syncLog({
              runId: process.env.DEBUG_RUN_ID || 'run',
              hypothesisId: 'H-HOIST-DECISION',
              location: 'extend-roots.ts:processExtends',
              message: 'pre-assignment-hoist-state',
              data: {
                rulesetId: ensureRulesetTraceId(ruleset),
                before: beforeValue,
                after: afterValue,
                hasResolvedNestedSelector,
                hasOnlyPartialExtends,
                selectorHoistToRoot: Boolean(selector.hoistToRoot),
                newSelectorHoistToRoot: Boolean(newSelector.hoistToRoot),
                rulesetHoistToRoot: Boolean(ruleset.hoistToRoot)
              },
              timestamp: Date.now()
            });
          }
        } catch {}
        // #endregion
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
        if (debugParity) {
          const afterValue = newSelector.valueOf();
          if (isParitySelector(beforeValue) || isParitySelector(afterValue)) {
            // #region agent log
            sendParityLog(
              'H4-assignment-path',
              'extend-roots.ts:processExtends:assigned',
              'parity-ruleset-assigned',
              {
                rulesetId: ensureRulesetTraceId(ruleset),
                before: beforeValue,
                after: afterValue,
                hoist: Boolean(newSelector.hoistToRoot)
              }
            );
            // #endregion
          }
        }
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
