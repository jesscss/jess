import { Selector } from '../selector.js';
import { SelectorList } from '../selector-list.js';
import { F_AMPERSAND, type Node } from '../node.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { isDisjoint, isSubsetOf } from './bitset.js';
import { type PseudoSelector } from '../selector-pseudo.js';

/**
 * A single located selector match.
 *
 * `startIndex` / `endIndex` are measured in the `containingNode`'s local
 * ordered data when the containing node is ordered.
 *
 * `exact` means the matched route consumed its span end-to-end without extra
 * unmatched basic selectors on that route.
 *
 * `crossesAmpersand` is set on synthetic cross-boundary matches completed
 * through a parent selector context.
 *
 * `consumedTarget` means this location matched everything it could possibly
 * match in its target container. This is distinct from route-level
 * `fullMatch`, which only means one exact match route succeeded.
 */
interface SelectorMatchLocation {
  startIndex?: number;
  endIndex?: number;
  matchedIndices?: number[];
  containingNode: Node;
  exact?: boolean;
  crossesAmpersand?: boolean;
  consumedTarget?: boolean;
  ampersandCrossings?: SelectorMatchAmpersandCrossing[];
}

interface SelectorMatchSegment {
  containingNode: Node;
  startIndex?: number;
  endIndex?: number;
  matchedIndices?: number[];
}

interface SelectorMatchAmpersandCrossing {
  ampersandNode?: Node;
  targetSegment: SelectorMatchSegment;
  parentSegment?: SelectorMatchSegment;
}

/**
 * Aggregate selector-match result.
 *
 * `fullMatch` means at least one exact end-to-end route matched.
 * `partialMatch` means at least one match of any kind was found.
 * `crossesAmpersand` means at least one recorded match crossed an ampersand
 * boundary instead of matching entirely on one side of it.
 */
interface SelectorMatchState {
  fullMatch: boolean;
  partialMatch: boolean;
  crossesAmpersand: boolean;
  matches: SelectorMatchLocation[];
}

/** The set of basic selectors that one unordered position can satisfy. */
type MatchGroupRequirement = {
  basicSelectorIndex: Map<string, number>;
  basicSelectorCounts: number[];
  basicSelectorTotal: number;
  hasComplexBranch: boolean;
  branchTailAmbiguous: boolean;
};

/** One position can satisfy any one of its alternatives, such as `:is(...)`. */
type MatchGroup = {
  alternatives: MatchGroupRequirement[];
};

/** One ordered unit in a route-level match plan. */
type MatchPlanUnit =
  | {
    kind: 'group';
    index: number;
    node: Node;
    group: MatchGroup;
  }
  | {
    kind: 'combinator';
    index: number;
    node: Node;
    value: string;
  };

type RouteMatchPlan = {
  kind: 'route';
  selector: Selector;
  units: MatchPlanUnit[];
  hasAmbiguousBranchTail: boolean;
};

type SelectorListMatchPlan = {
  kind: 'list';
  selector: SelectorList;
  alternates: MatchPlan[];
};

type MatchPlan = RouteMatchPlan | SelectorListMatchPlan;

type MatchGroupState = {
  remainingCounts: number[];
  remainingTotal: number;
  exact: boolean;
  matchedOutsideAmpersand: boolean;
};

type MatchWindowResult = {
  matched: boolean;
  exact: boolean;
};

type GroupMatchCache = WeakMap<Node, WeakMap<MatchGroup, MatchWindowResult>>;
type SelectorMatchPairCache = WeakMap<Selector, WeakMap<Selector, SelectorMatchState>>;
type SelectorMatchContext = {
  pairCache: SelectorMatchPairCache;
};

const selectorMatchPlanCache = new WeakMap<Selector, {
  value: string;
  plan: MatchPlan;
  hasNestedBranchAlternatives: boolean;
}>();

/**
 * Returns true for pseudos whose selector arguments can be searched recursively
 * but cannot be consumed as part of a continuing outer match, unlike `:is()`.
 */
function isSearchablePseudoBoundary(node: Node): node is PseudoSelector {
  return (
    isNode(node, N.PseudoSelector)
    && node.name !== ':is'
    && isNode(node.arg, N.Selector)
  );
}

function createRequirement(): MatchGroupRequirement {
  const basicSelectorIndex = new Map<string, number>();
  const basicSelectorCounts: number[] = [];

  return {
    basicSelectorIndex,
    basicSelectorCounts,
    basicSelectorTotal: 0,
    hasComplexBranch: false,
    branchTailAmbiguous: false
  };
}

function addRequirementValue(requirement: MatchGroupRequirement, value: string): MatchGroupRequirement {
  const existingIndex = requirement.basicSelectorIndex.get(value);
  if (existingIndex !== undefined) {
    requirement.basicSelectorCounts[existingIndex]!++;
    requirement.basicSelectorTotal++;
    return requirement;
  }

  requirement.basicSelectorIndex.set(value, requirement.basicSelectorCounts.length);
  requirement.basicSelectorCounts.push(1);
  requirement.basicSelectorTotal++;
  return requirement;
}

function cloneRequirement(requirement: MatchGroupRequirement): MatchGroupRequirement {
  return {
    basicSelectorIndex: new Map(requirement.basicSelectorIndex),
    basicSelectorCounts: [...requirement.basicSelectorCounts],
    basicSelectorTotal: requirement.basicSelectorTotal,
    hasComplexBranch: requirement.hasComplexBranch,
    branchTailAmbiguous: requirement.branchTailAmbiguous
  };
}

function mergeRequirements(
  left: MatchGroupRequirement,
  right: MatchGroupRequirement
): MatchGroupRequirement {
  const merged = cloneRequirement(left);
  for (const [value, index] of right.basicSelectorIndex.entries()) {
    const count = right.basicSelectorCounts[index] ?? 0;
    for (let i = 0; i < count; i++) {
      addRequirementValue(merged, value);
    }
  }
  merged.hasComplexBranch ||= right.hasComplexBranch;
  merged.branchTailAmbiguous ||= right.branchTailAmbiguous;
  return merged;
}

function markComplexBranchRequirements(
  requirements: MatchGroupRequirement[],
  branch: Selector & { value?: readonly Node[] }
): MatchGroupRequirement[] {
  const earlierValues = new Set<string>();

  if (isNode(branch, N.ComplexSelector)) {
    for (let i = 0; i < branch.value.length - 1; i++) {
      const component = branch.value[i]!;
      const nested = buildGroupRequirements(component);
      for (let j = 0; j < nested.length; j++) {
        for (const value of nested[j]!.basicSelectorIndex.keys()) {
          earlierValues.add(value);
        }
      }
    }
  }

  for (let i = 0; i < requirements.length; i++) {
    const requirement = requirements[i]!;
    requirement.hasComplexBranch = true;
    for (const value of requirement.basicSelectorIndex.keys()) {
      if (earlierValues.has(value)) {
        requirement.branchTailAmbiguous = true;
        break;
      }
    }
  }

  return requirements;
}

function buildGroupRequirements(node: Node, parent?: Selector): MatchGroupRequirement[] {
  if (isNode(node, N.BasicSelector)) {
    const requirement = createRequirement();
    addRequirementValue(requirement, node.valueOf());
    return [requirement];
  }

  if (isNode(node, N.Ampersand)) {
    const resolved = node.getResolvedSelector() ?? parent;
    if (resolved && !isNode(resolved, N.Nil)) {
      return buildGroupRequirements(resolved, parent);
    }

    return [createRequirement()];
  }

  if (isNode(node, N.ComplexSelector)) {
    for (let i = node.value.length - 1; i >= 0; i--) {
      const component = node.value[i]!;
      if (!isNode(component, N.Combinator)) {
        return markComplexBranchRequirements(buildGroupRequirements(component, parent), node);
      }
    }

    return [createRequirement()];
  }

  if (isNode(node, N.PseudoSelector) && node.name !== ':is') {
    const requirement = createRequirement();
    addRequirementValue(requirement, node.valueOf());
    return [requirement];
  }

  if (isSearchablePseudoBoundary(node)) {
    return [createRequirement()];
  }

  if (isNode(node, N.SelectorList)) {
    const alternatives: MatchGroupRequirement[] = [];
    for (let i = 0; i < node.value.length; i++) {
      const nested = buildGroupRequirements(node.value[i]!, parent);
      for (let j = 0; j < nested.length; j++) {
        alternatives.push(nested[j]!);
      }
    }
    return alternatives;
  }

  let requirements: MatchGroupRequirement[] = [createRequirement()];
  const children = node.children();
  let child = children.next();

  while (!child.done) {
    const childRequirements = buildGroupRequirements(child.value, parent);
    const nextRequirements: MatchGroupRequirement[] = [];
    for (let i = 0; i < requirements.length; i++) {
      for (let j = 0; j < childRequirements.length; j++) {
        nextRequirements.push(
          mergeRequirements(requirements[i]!, childRequirements[j]!)
        );
      }
    }
    requirements = nextRequirements;
    child = children.next();
  }

  return requirements;
}

function buildMatchGroup(node: Node, parent?: Selector): MatchGroup {
  return {
    alternatives: buildGroupRequirements(node, parent)
  };
}

function buildRouteMatchPlan(selector: Selector, parent?: Selector): RouteMatchPlan {
  if (isNode(selector, N.ComplexSelector)) {
    const units: MatchPlanUnit[] = [];
    let hasAmbiguousBranchTail = false;

    for (let i = 0; i < selector.value.length; i++) {
      const component = selector.value[i]!;
      if (isNode(component, N.Combinator)) {
        units.push({
          kind: 'combinator',
          index: i,
          node: component,
          value: component.valueOf()
        });
        continue;
      }

      const group = buildMatchGroup(
        component,
        isNode(component, N.Ampersand) && i === 0 ? undefined : parent
      );
      const hasAlternatives = group.alternatives.some(alternate => alternate.basicSelectorTotal > 0);
      if (hasAlternatives) {
        hasAmbiguousBranchTail ||= group.alternatives.some(alternate => alternate.branchTailAmbiguous);
        units.push({
          kind: 'group',
          index: i,
          node: component,
          group
        });
      }
    }

    return {
      kind: 'route',
      selector,
      units,
      hasAmbiguousBranchTail
    };
  }

  if (isNode(selector, N.Combinator)) {
    return {
      kind: 'route',
      selector,
      hasAmbiguousBranchTail: false,
      units: [{
        kind: 'combinator',
        index: 0,
        node: selector,
        value: selector.valueOf()
      }]
    };
  }

  const group = buildMatchGroup(selector, parent);
  return {
    kind: 'route',
    selector,
    hasAmbiguousBranchTail: group.alternatives.some(alternate => alternate.branchTailAmbiguous),
    units: group.alternatives.some(alternate => alternate.basicSelectorTotal > 0)
      ? [{
          kind: 'group',
          index: 0,
          node: selector,
          group
        }]
      : []
  };
}

function buildMatchPlan(selector: Selector, parent?: Selector): MatchPlan {
  if (isNode(selector, N.SelectorList)) {
    return {
      kind: 'list',
      selector,
      alternates: selector.value.map(item => getSelectorMatchPlan(item, parent))
    };
  }

  return buildRouteMatchPlan(selector, parent);
}

function getSelectorMatchPlan(selector: Selector, parent?: Selector): MatchPlan {
  if (parent) {
    return buildMatchPlan(selector, parent);
  }

  const value = selector.valueOf();
  const cached = selectorMatchPlanCache.get(selector);
  if (cached && cached.value === value) {
    return cached.plan;
  }

  const plan = buildMatchPlan(selector);
  selectorMatchPlanCache.set(selector, {
    value,
    plan,
    hasNestedBranchAlternatives: hasNestedBranchAlternatives(selector)
  });
  return plan;
}

function selectorHasNestedBranchAlternatives(selector: Selector): boolean {
  const value = selector.valueOf();
  const cached = selectorMatchPlanCache.get(selector);
  if (cached && cached.value === value) {
    return cached.hasNestedBranchAlternatives;
  }

  getSelectorMatchPlan(selector);
  return selectorMatchPlanCache.get(selector)?.hasNestedBranchAlternatives ?? false;
}

function cloneGroupStates(states: MatchGroupState[]): MatchGroupState[] {
  const nextStates = new Array<MatchGroupState>(states.length);
  for (let i = 0; i < states.length; i++) {
    const state = states[i]!;
    nextStates[i] = {
      remainingCounts: [...state.remainingCounts],
      remainingTotal: state.remainingTotal,
      exact: state.exact,
      matchedOutsideAmpersand: state.matchedOutsideAmpersand
    };
  }
  return nextStates;
}

function allStatesAreTerminalPartial(states: MatchGroupState[]): boolean {
  for (let i = 0; i < states.length; i++) {
    const state = states[i]!;
    if (state.remainingTotal > 0 || state.exact) {
      return false;
    }
  }
  return true;
}

function consumeGroupBasics(
  node: Node,
  group: MatchGroupRequirement,
  states: MatchGroupState[],
  insideAmpersand = false,
  parent?: Selector
): MatchGroupState[] {
  if (states.length === 0) {
    return states;
  }

  if (isNode(node, N.BasicSelector) || (isNode(node, N.PseudoSelector) && node.name !== ':is')) {
    const idx = group.basicSelectorIndex.get(node.valueOf());

    for (let i = 0; i < states.length; i++) {
      const state = states[i]!;

      if (state.remainingTotal === 0 && !state.exact) {
        continue;
      }

      if (idx === undefined || state.remainingCounts[idx] === 0) {
        state.exact = false;
        continue;
      }

      state.remainingCounts[idx]!--;
      state.remainingTotal--;
      if (!insideAmpersand) {
        state.matchedOutsideAmpersand = true;
      }
    }

    return states;
  }

  if (isNode(node, N.Ampersand)) {
    const resolved = node.getResolvedSelector() ?? parent;
    if (resolved && !isNode(resolved, N.Nil)) {
      return consumeGroupBasics(resolved, group, states, true, parent);
    }

    return states;
  }

  if (isSearchablePseudoBoundary(node)) {
    return states;
  }

  if (isNode(node, N.SelectorList)) {
    const alternates = node.children();
    const routes = [alternates.mark()];
    const nextStates: MatchGroupState[] = [];

    while (routes.length > 0) {
      alternates.restore(routes.pop()!);
      const alternate = alternates.next();

      if (alternate.done) {
        continue;
      }

      routes.push(alternates.mark());

      nextStates.push(
        ...consumeGroupBasics(
          alternate.value,
          group,
          cloneGroupStates(states),
          insideAmpersand,
          parent
        )
      );
    }

    return nextStates;
  }

  const children = node.children();
  let nextStates = states;
  let child = children.next();

  while (!child.done && nextStates.length > 0 && !allStatesAreTerminalPartial(nextStates)) {
    nextStates = consumeGroupBasics(child.value, group, nextStates, insideAmpersand, parent);
    child = children.next();
  }

  return nextStates;
}

/** Summarizes a set of consume-states with a single pass. */
function summarizeStates(states: MatchGroupState[]): MatchWindowResult {
  let matched = false;
  let exact = false;

  for (let i = 0; i < states.length; i++) {
    const state = states[i]!;
    if (state.remainingTotal !== 0 || !state.matchedOutsideAmpersand) {
      continue;
    }

    matched = true;
    if (state.exact) {
      exact = true;
      break;
    }
  }

  return { matched, exact };
}

/**
 * Matches a single unordered target position against one match group.
 *
 * This is the core "consume basics within a position" operation used by
 * route-level matching.
 */
function matchTargetGroup(
  targetGroup: Node,
  findGroup: MatchGroup,
  parent?: Selector,
  allowAmpersandOnlyMatch = false
): MatchWindowResult {
  let matched = false;
  let exact = false;

  for (let i = 0; i < findGroup.alternatives.length; i++) {
    const requirement = findGroup.alternatives[i]!;
    const states = consumeGroupBasics(targetGroup, requirement, [{
      remainingCounts: [...requirement.basicSelectorCounts],
      remainingTotal: requirement.basicSelectorTotal,
      exact: true,
      matchedOutsideAmpersand: false
    }], false, parent);
    const summary = summarizeStates(states);
    if (!summary.matched && allowAmpersandOnlyMatch) {
      for (let j = 0; j < states.length; j++) {
        const state = states[j]!;
        if (state.remainingTotal !== 0) {
          continue;
        }

        summary.matched = true;
        if (state.exact) {
          summary.exact = true;
          break;
        }
      }
    }

    matched ||= summary.matched;
    exact ||= summary.exact && !requirement.hasComplexBranch;

    if (exact) {
      break;
    }
  }

  return { matched, exact };
}

function matchCompoundWindow(
  targetCompound: Selector & { data: readonly Node[] },
  start: number,
  end: number,
  requirement: MatchGroupRequirement,
  parent?: Selector
): MatchWindowResult {
  let states = [{
    remainingCounts: [...requirement.basicSelectorCounts],
    remainingTotal: requirement.basicSelectorTotal,
    exact: true,
    matchedOutsideAmpersand: false
  }];

  for (let i = start; i <= end && states.length > 0 && !allStatesAreTerminalPartial(states); i++) {
    states = consumeGroupBasics(targetCompound.value[i]!, requirement, states, false, parent);
  }

  const summary = summarizeStates(states);
  if (!summary.matched && parent) {
    let allAmpersands = true;
    for (let i = start; i <= end; i++) {
      if (!isNode(targetCompound.value[i]!, N.Ampersand)) {
        allAmpersands = false;
        break;
      }
    }

    if (allAmpersands) {
      for (let i = 0; i < states.length; i++) {
        const state = states[i]!;
        if (state.remainingTotal !== 0) {
          continue;
        }
        summary.matched = true;
        if (state.exact) {
          summary.exact = true;
          break;
        }
      }
    }
  }
  if (requirement.hasComplexBranch) {
    summary.exact = false;
  }
  return summary;
}

function collectMatchedIndicesForWindow(
  targetCompound: Selector & { value: readonly Node[] },
  start: number,
  end: number,
  requirement: MatchGroupRequirement
): number[] | undefined {
  const remainingCounts = [...requirement.basicSelectorCounts];
  const matchedIndices: number[] = [];

  for (let i = start; i <= end; i++) {
    const node = targetCompound.value[i]!;
    if (!isNode(node, N.BasicSelector) && !(isNode(node, N.PseudoSelector) && node.name !== ':is')) {
      continue;
    }

    const idx = requirement.basicSelectorIndex.get(node.valueOf());
    if (idx === undefined || remainingCounts[idx] === 0) {
      continue;
    }

    remainingCounts[idx]!--;
    matchedIndices.push(i);
  }

  if (matchedIndices.length === 0) {
    return undefined;
  }

  const spanLength = end - start + 1;
  if (matchedIndices.length === spanLength) {
    return undefined;
  }

  return matchedIndices;
}

/**
 * Collects every group-local span match for a target node.
 *
 * For compounds this scans contiguous windows so repeated matches in the same
 * compound are reported independently.
 *
 * @todo This is still the hottest path in selector matching. It currently
 * scans O(n^2) spans and may re-run `matchCompoundWindow()` for the same
 * requirement to prove minimality (`withoutStartMatches` / `withoutEndMatches`).
 * If this becomes a measurable bottleneck, replace the brute-force span scan
 * with a requirement-aware sliding window or prefix-count index that can:
 * 1. detect whether a span satisfies the requirement,
 * 2. prove minimality without rescanning adjacent subspans, and
 * 3. still preserve current semantics for extras-inside-span, matchedIndices,
 *    branch-tail ambiguity, and repeated independent matches in one compound.
 */
function collectGroupMatchLocations(
  targetGroup: Node,
  findGroup: MatchGroup,
  parent?: Selector
): SelectorMatchLocation[] {
  if (!isNode(targetGroup, N.CompoundSelector)) {
    const groupMatch = matchTargetGroup(
      targetGroup,
      findGroup,
      parent,
      !!parent && isNode(targetGroup, N.Ampersand)
    );
    return groupMatch.matched
      ? [{
          startIndex: 0,
          endIndex: 0,
          containingNode: targetGroup,
          exact: groupMatch.exact,
          consumedTarget: groupMatch.exact
        }]
      : [];
  }

  const matches: SelectorMatchLocation[] = [];
  const seen = new Set<number>();
  const targetCompound = targetGroup as Selector & { value: readonly Node[] };
  const targetLength = (targetGroup as CompoundSelector).value.length;

  for (let i = 0; i < findGroup.alternatives.length; i++) {
    const requirement = findGroup.alternatives[i]!;
    for (let start = 0; start < targetLength; start++) {
      for (let end = start; end < targetLength; end++) {
        const windowMatch = matchCompoundWindow(
          targetCompound,
          start,
          end,
          requirement,
          parent
        );

        if (!windowMatch.matched) {
          continue;
        }

        const withoutStartMatches = start < end
          && matchCompoundWindow(targetCompound, start + 1, end, requirement, parent).matched;
        if (withoutStartMatches) {
          continue;
        }

        const withoutEndMatches = start < end
          && matchCompoundWindow(targetCompound, start, end - 1, requirement, parent).matched;
        if (withoutEndMatches) {
          continue;
        }

        const key = start * targetLength + end;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);

        matches.push({
          startIndex: start,
          endIndex: end,
          matchedIndices: collectMatchedIndicesForWindow(targetCompound, start, end, requirement),
          containingNode: targetGroup,
          exact: windowMatch.exact && start === 0 && end === targetLength - 1,
          consumedTarget: windowMatch.exact && start === 0 && end === targetLength - 1
        });
      }
    }
  }

  matches.sort((left, right) => {
    const leftStart = left.startIndex ?? 0;
    const rightStart = right.startIndex ?? 0;
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }

    const leftEnd = left.endIndex ?? leftStart;
    const rightEnd = right.endIndex ?? rightStart;
    return leftEnd - rightEnd;
  });

  const filtered: SelectorMatchLocation[] = [];
  let lastEnd = -1;
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const start = match.startIndex ?? 0;
    const end = match.endIndex ?? start;

    if (start <= lastEnd) {
      continue;
    }

    filtered.push(match);
    lastEnd = end;
  }

  return filtered;
}

/** Fast constructor for the no-match result shape. */
function emptySelectorMatchState(): SelectorMatchState {
  return {
    fullMatch: false,
    partialMatch: false,
    crossesAmpersand: false,
    matches: []
  };
}

/** Appends one result list into another without allocating a combined array. */
function pushMatches(
  target: SelectorMatchLocation[],
  source: SelectorMatchLocation[]
): void {
  for (let i = 0; i < source.length; i++) {
    target.push(source[i]!);
  }
}

function cloneMatchSegment(
  segment: SelectorMatchSegment | undefined
): SelectorMatchSegment | undefined {
  if (!segment) {
    return undefined;
  }

  return {
    containingNode: segment.containingNode,
    startIndex: segment.startIndex,
    endIndex: segment.endIndex,
    matchedIndices: segment.matchedIndices ? [...segment.matchedIndices] : undefined
  };
}

function cloneAmpersandCrossings(
  crossings: SelectorMatchAmpersandCrossing[] | undefined
): SelectorMatchAmpersandCrossing[] | undefined {
  if (!crossings || crossings.length === 0) {
    return undefined;
  }

  const next = new Array<SelectorMatchAmpersandCrossing>(crossings.length);
  for (let i = 0; i < crossings.length; i++) {
    const crossing = crossings[i]!;
    next[i] = {
      ampersandNode: crossing.ampersandNode,
      targetSegment: cloneMatchSegment(crossing.targetSegment)!,
      parentSegment: cloneMatchSegment(crossing.parentSegment)
    };
  }

  return next;
}

function getCachedGroupMatch(
  cache: GroupMatchCache,
  targetGroup: Node,
  findGroup: MatchGroup,
  parent?: Selector
): MatchWindowResult {
  let nodeCache = cache.get(targetGroup);
  if (!nodeCache) {
    nodeCache = new WeakMap<MatchGroup, MatchWindowResult>();
    cache.set(targetGroup, nodeCache);
  }

  const cached = nodeCache.get(findGroup);
  if (cached) {
    return cached;
  }

  let result: MatchWindowResult;
  if (isNode(targetGroup, N.CompoundSelector)) {
    let matched = false;
    let exact = false;

    for (let i = 0; i < findGroup.alternatives.length; i++) {
      const windowMatch = matchCompoundWindow(
        targetGroup,
        0,
        (targetGroup as CompoundSelector).value.length - 1,
        findGroup.alternatives[i]!,
        parent
      );
      matched ||= windowMatch.matched;
      exact ||= windowMatch.exact;

      if (exact) {
        break;
      }
    }

    result = { matched, exact };
  } else {
    result = matchTargetGroup(
      targetGroup,
      findGroup,
      parent,
      !!parent && isNode(targetGroup, N.Ampersand)
    );
  }
  nodeCache.set(findGroup, result);
  return result;
}

function getBranchAlternatives(node: Node): readonly Selector[] | undefined {
  if (isNode(node, N.SelectorList)) {
    return node.value;
  }

  if (isNode(node, N.PseudoSelector) && node.name === ':is' && isNode(node.arg, N.Selector)) {
    if (isNode(node.arg, N.SelectorList)) {
      return node.arg.value;
    }

    return [node.arg as Selector];
  }

  return undefined;
}

function hasNestedBranchAlternatives(node: Node): boolean {
  if (getBranchAlternatives(node)) {
    return true;
  }

  const children = node.children();
  let child = children.next();
  while (!child.done) {
    if (hasNestedBranchAlternatives(child.value)) {
      return true;
    }
    child = children.next();
  }

  return false;
}

function matchGroupNodes(
  findNode: Node,
  targetNode: Node,
  findGroup: MatchGroup,
  groupMatchCache: GroupMatchCache,
  context: SelectorMatchContext,
  parent?: Selector
): MatchWindowResult {
  const targetBranches = getBranchAlternatives(targetNode);
  const findBranches = getBranchAlternatives(findNode);
  if (targetBranches && findBranches) {
    let matched = false;
    let exact = false;

    for (let i = 0; i < findBranches.length; i++) {
      for (let j = 0; j < targetBranches.length; j++) {
        const nested = selectorMatchInternal(findBranches[i]!, targetBranches[j]!, parent, context);
        matched ||= nested.partialMatch;
        exact ||= nested.fullMatch;

        if (exact) {
          break;
        }
      }

      if (exact) {
        break;
      }
    }

    return { matched, exact };
  }

  if (targetBranches) {
    let matched = false;
    let exact = false;

    for (let i = 0; i < targetBranches.length; i++) {
      const nested = selectorMatchInternal(findNode as Selector, targetBranches[i]!, parent, context);
      matched ||= nested.partialMatch;
      exact ||= nested.fullMatch;

      if (exact) {
        break;
      }
    }

    return { matched, exact };
  }

  return getCachedGroupMatch(groupMatchCache, targetNode, findGroup, parent);
}

function pushNestedBranchMatches(
  findNode: Node,
  target: Selector,
  matches: SelectorMatchLocation[],
  context: SelectorMatchContext,
  parent?: Selector
): void {
  const branches = getBranchAlternatives(findNode);
  if (branches) {
    for (let i = 0; i < branches.length; i++) {
      const nested = selectorMatchInternal(target, branches[i]!, parent, context);
      if (!nested.fullMatch) {
        continue;
      }
      for (let j = 0; j < nested.matches.length; j++) {
        const match = nested.matches[j]!;
        matches.push({
          startIndex: match.startIndex,
          endIndex: match.endIndex,
          matchedIndices: match.matchedIndices,
          containingNode: match.containingNode,
          exact: false,
          consumedTarget: match.consumedTarget,
          ampersandCrossings: cloneAmpersandCrossings(match.ampersandCrossings)
        });
      }
    }
    return;
  }

  const children = findNode.children();
  let child = children.next();
  while (!child.done) {
    pushNestedBranchMatches(child.value, target, matches, context, parent);
    child = children.next();
  }
}

/**
 * Compares a contiguous slice of ordered units.
 *
 * Groups compare via unordered basic-selector consumption, while combinators
 * must match exactly in place.
 */
function matchUnitWindow(
  findUnits: MatchPlanUnit[],
  findStart: number,
  targetUnits: MatchPlanUnit[],
  targetStart: number,
  length: number,
  groupMatchCache: GroupMatchCache,
  context: SelectorMatchContext,
  parent?: Selector
): MatchWindowResult {
  let exact = true;

  for (let offset = 0; offset < length; offset++) {
    const findUnit = findUnits[findStart + offset]!;
    const targetUnit = targetUnits[targetStart + offset]!;

    if (findUnit.kind !== targetUnit.kind) {
      return { matched: false, exact: false };
    }

    if (findUnit.kind === 'combinator') {
      if (targetUnit.kind !== 'combinator' || findUnit.value !== targetUnit.value) {
        return { matched: false, exact: false };
      }
      continue;
    }

    const groupMatch = matchGroupNodes(
      findUnit.node,
      targetUnit.node,
      findUnit.group,
      groupMatchCache,
      context,
      parent
    );
    if (!groupMatch.matched) {
      return { matched: false, exact: false };
    }

    exact &&= groupMatch.exact;
  }

  return { matched: true, exact };
}

/** True when a complex selector begins with a visible ampersand boundary. */
function hasLeadingAmpersandBoundary(selector: Selector): boolean {
  return (
    isNode(selector, N.ComplexSelector)
    && selector.value.length > 0
    && isNode(selector.value[0]!, N.Ampersand)
  );
}

function getBoundaryTailUnits(routePlan: RouteMatchPlan): MatchPlanUnit[] {
  if (hasLeadingAmpersandBoundary(routePlan.selector)) {
    return routePlan.units;
  }

  return [{
    kind: 'combinator',
    index: -1,
    node: routePlan.selector,
    value: ' '
  }, ...routePlan.units];
}

function locationCrossesAmpersand(location: SelectorMatchLocation): boolean {
  if (location.ampersandCrossings && location.ampersandCrossings.length > 0) {
    return true;
  }

  if (location.crossesAmpersand) {
    return true;
  }

  const { containingNode, startIndex, endIndex } = location;

  if (!containingNode.hasFlag(F_AMPERSAND)) {
    return false;
  }

  if (startIndex === undefined || endIndex === undefined) {
    return true;
  }

  if (isNode(containingNode, N.CompoundSelector) || isNode(containingNode, N.ComplexSelector)) {
    for (let i = startIndex; i <= endIndex; i++) {
      if (containingNode.value[i]?.hasFlag(F_AMPERSAND)) {
        return true;
      }
    }
    return false;
  }

  if (isNode(containingNode, N.SelectorList)) {
    return !!containingNode.value[startIndex]?.hasFlag(F_AMPERSAND);
  }

  return true;
}

function getLocationAmpersandCrossings(
  location: SelectorMatchLocation
): SelectorMatchAmpersandCrossing[] | undefined {
  if (location.ampersandCrossings && location.ampersandCrossings.length > 0) {
    return location.ampersandCrossings;
  }

  const { containingNode } = location;
  if (!containingNode.hasFlag(F_AMPERSAND)) {
    return undefined;
  }

  const indices = location.matchedIndices && location.matchedIndices.length > 0
    ? location.matchedIndices
    : undefined;
  const start = location.startIndex ?? indices?.[0] ?? 0;
  const end = location.endIndex ?? indices?.[indices.length - 1] ?? start;
  const targetSegment: SelectorMatchSegment = {
    containingNode,
    startIndex: location.startIndex,
    endIndex: location.endIndex,
    matchedIndices: location.matchedIndices ? [...location.matchedIndices] : undefined
  };

  const crossings: SelectorMatchAmpersandCrossing[] = [];
  const seenAmpersands = new Set<Node>();
  const pushCrossing = (ampersandNode: Node): void => {
    if (seenAmpersands.has(ampersandNode)) {
      return;
    }

    seenAmpersands.add(ampersandNode);

    let parentSegment: SelectorMatchSegment | undefined;
    if (isNode(ampersandNode, N.Ampersand)) {
      const resolved = ampersandNode.getResolvedSelector();
      if (resolved && !isNode(resolved, N.Nil)) {
        parentSegment = {
          containingNode: resolved
        };
      }
    }

    crossings.push({
      ampersandNode,
      targetSegment,
      parentSegment
    });
  };

  if (isNode(containingNode, N.Ampersand)) {
    pushCrossing(containingNode);
    return crossings;
  }

  if (isNode(containingNode, N.CompoundSelector) || isNode(containingNode, N.ComplexSelector)) {
    if (indices) {
      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i]!;
        const node = containingNode.value[idx];
        if (node && isNode(node, N.Ampersand)) {
          pushCrossing(node);
        }
      }
    }

    for (let i = start; i <= end; i++) {
      const node = containingNode.value[i];
      if (node && isNode(node, N.Ampersand)) {
        pushCrossing(node);
      }
    }
  }

  if (isNode(containingNode, N.SelectorList) && start === end) {
    const node = containingNode.value[start];
    if (node && isNode(node, N.Ampersand)) {
      pushCrossing(node);
    } else if (node && (isNode(node, N.CompoundSelector) || isNode(node, N.ComplexSelector))) {
      for (let i = 0; i < node.value.length; i++) {
        const child = node.value[i];
        if (child && isNode(child, N.Ampersand)) {
          crossings.push({
            ampersandNode: child,
            targetSegment,
            parentSegment: child.getResolvedSelector() && !isNode(child.getResolvedSelector(), N.Nil)
              ? { containingNode: child.getResolvedSelector() as Selector }
              : undefined
          });
        }
      }
    }
  }

  return crossings.length > 0 ? crossings : undefined;
}

/**
 * Finalizes aggregate booleans from the collected match list.
 *
 * This intentionally uses a single scan to avoid repeated array passes on a
 * hot path.
 */
function finalizeMatchState(result: SelectorMatchState): SelectorMatchState {
  let fullMatch = false;
  let crossesAmpersand = false;

  for (let i = 0; i < result.matches.length; i++) {
    const match = result.matches[i]!;
    if (!match.ampersandCrossings) {
      match.ampersandCrossings = getLocationAmpersandCrossings(match);
    }
    fullMatch ||= !!match.exact;
    crossesAmpersand ||= locationCrossesAmpersand(match);

    if (fullMatch && crossesAmpersand) {
      break;
    }
  }

  result.fullMatch ||= fullMatch;
  result.partialMatch ||= result.matches.length > 0;
  result.crossesAmpersand = crossesAmpersand;
  return result;
}

/**
 * Recursively searches inside searchable pseudo-selector arguments.
 *
 * These nested matches are root-like searches; they do not allow an outer
 * match route to continue through the pseudo boundary.
 */
function pushNestedPseudoMatches(
  find: Selector,
  targetNode: Node,
  matches: SelectorMatchLocation[],
  context: SelectorMatchContext
): void {
  if (isSearchablePseudoBoundary(targetNode)) {
    if (isSearchablePseudoBoundary(find)) {
      if (find.name !== targetNode.name) {
        return;
      }

      const nested = selectorMatchInternal(find.arg as Selector, targetNode.arg as Selector, undefined, context);
      for (let i = 0; i < nested.matches.length; i++) {
        const match = nested.matches[i]!;
        matches.push({
          startIndex: match.startIndex,
          endIndex: match.endIndex,
          containingNode: match.containingNode,
          exact: match.exact,
          consumedTarget: match.consumedTarget,
          ampersandCrossings: cloneAmpersandCrossings(match.ampersandCrossings)
        });
      }
      return;
    }

    const nested = selectorMatchInternal(find, targetNode.arg as Selector, undefined, context);
    for (let i = 0; i < nested.matches.length; i++) {
      const match = nested.matches[i]!;
      matches.push({
        startIndex: match.startIndex,
        endIndex: match.endIndex,
        containingNode: match.containingNode,
        exact: false,
        consumedTarget: match.consumedTarget,
        ampersandCrossings: cloneAmpersandCrossings(match.ampersandCrossings)
      });
    }
    return;
  }

  const children = targetNode.children();
  let child = children.next();
  while (!child.done) {
    pushNestedPseudoMatches(find, child.value, matches, context);
    child = children.next();
  }
}

/**
 * Finds all occurrences of `find` inside `target`.
 *
 * Matching is ordered at the route level, unordered only inside a single
 * compound-like position, and branches only at `SelectorList` alternatives.
 * A selector list on the find side is treated as alternate find routes: any
 * one alternate may match, and each matching alternate contributes its own
 * recorded locations.
 *
 * When `parent` is provided, it acts like an implicit prefix context joined to
 * `target` by a descendant combinator. Parent traversal is attempted only when
 * a match reaches a left-side ampersand boundary with partial-but-incomplete
 * progress; matches that exist only inside the parent do not get added on
 * their own.
 *
 * That same `parent` context is preserved when matching through nested
 * selector-list and `:is(...)` alternatives, because those are still the same
 * authored match route. It is not preserved for root-like searches inside
 * non-`:is()` pseudo-selector boundaries, because those searches must not
 * continue the outer route through that boundary.
 *
 * Complex selector branches inside `:is(...)` or selector lists are treated as
 * alternate branch routes. Matching may succeed inside one branch, but the
 * outer route cannot continue leftward through that branch unless that branch
 * itself was consumed end-to-end.
 */
function selectorMatchUncached(
  find: Selector,
  target: Selector,
  parent: Selector | undefined,
  context: SelectorMatchContext
): SelectorMatchState {
  if (isNode(find, N.SelectorList)) {
    const result = emptySelectorMatchState();

    for (let i = 0; i < find.value.length; i++) {
      const nested = selectorMatchInternal(find.value[i]!, target, parent, context);
      result.fullMatch ||= nested.fullMatch;
      result.partialMatch ||= nested.partialMatch;
      result.crossesAmpersand ||= nested.crossesAmpersand;
      pushMatches(result.matches, nested.matches);
    }

    return finalizeMatchState(result);
  }

  if (
    isNode(find, N.PseudoSelector)
    && find.name !== ':is'
    && isNode(find.arg, N.Selector)
  ) {
    if (isSearchablePseudoBoundary(target)) {
      if (find.name !== target.name) {
        return emptySelectorMatchState();
      }

      return selectorMatchInternal(find.arg as Selector, target.arg as Selector, parent, context);
    }

    const nested = selectorMatchInternal(find.arg as Selector, target, parent, context);
    if (!nested.partialMatch) {
      return nested;
    }

    const matches = new Array<SelectorMatchLocation>(nested.matches.length);
    for (let i = 0; i < nested.matches.length; i++) {
      const match = nested.matches[i]!;
      matches[i] = {
        startIndex: match.startIndex,
        endIndex: match.endIndex,
        containingNode: find.arg as Node,
        exact: false,
        consumedTarget: false,
        ampersandCrossings: cloneAmpersandCrossings(match.ampersandCrossings)
      };
    }

    return {
      fullMatch: false,
      partialMatch: true,
      crossesAmpersand: matches.some(locationCrossesAmpersand),
      matches
    };
  }

  let findValue = find.valueOf();
  if (isNode(target, N.SelectorList)) {
    for (let i = 0; i < target.value.length; i++) {
      const sel = target.value[i]!;
      if (findValue === sel.valueOf()) {
        return {
          fullMatch: true,
          partialMatch: true,
          crossesAmpersand: sel.hasFlag(F_AMPERSAND),
          matches: [{
            startIndex: i,
            endIndex: i,
            matchedIndices: [i],
            containingNode: target,
            exact: true,
            consumedTarget: target.value.length === 1,
            ampersandCrossings: getLocationAmpersandCrossings({
              startIndex: i,
              endIndex: i,
              matchedIndices: [i],
              containingNode: target,
              exact: true,
              consumedTarget: target.value.length === 1
            })
          }]
        };
      }

      const nested = selectorMatchInternal(find, sel, parent, context);
      if (nested.partialMatch) {
        return {
          fullMatch: nested.fullMatch,
          partialMatch: true,
          crossesAmpersand: nested.crossesAmpersand || sel.hasFlag(F_AMPERSAND),
          matches: [{
            startIndex: i,
            endIndex: i,
            matchedIndices: [i],
            containingNode: target,
            exact: nested.fullMatch,
            consumedTarget: nested.fullMatch && target.value.length === 1,
            ampersandCrossings: cloneAmpersandCrossings(nested.matches[0]?.ampersandCrossings)
          }]
        };
      }
    }
    return emptySelectorMatchState();
  } else {
    if (findValue === target.valueOf()) {
      return {
        fullMatch: true,
        partialMatch: true,
        crossesAmpersand: target.hasFlag(F_AMPERSAND),
        matches: [{
          containingNode: target,
          exact: true,
          consumedTarget: true,
          ampersandCrossings: getLocationAmpersandCrossings({
            containingNode: target,
            exact: true,
            consumedTarget: true
          })
        }]
      };
    }
  }

  /**
   * @todo Revisit fast-reject policy once the extend and selector suites are
   * fully green.
   *
   * Areas to explore:
   * - whether find-side selector lists or nested selector-list branches should
   *   be disallowed or normalized earlier instead of weakening fast reject
   * - whether target-side selector lists can still use cheap bitset rejection
   *   because they only add candidate keys
   * - whether those changes would let us simplify or remove `canFastReject`
   *   as a separate concept
   */
  if (
    !parent
    && !selectorHasNestedBranchAlternatives(find)
    && !find.hasFlag(F_AMPERSAND)
    && target.hasFlag(F_AMPERSAND)
    && find.keySetLibrary
    && target.keySetLibrary
    && find.canFastReject
    && target.canFastReject
    && isDisjoint(find.visibleKeySet, target.visibleKeySet)
  ) {
    return emptySelectorMatchState();
  }

  if (
    !parent
    && !selectorHasNestedBranchAlternatives(find)
    && find.keySetLibrary
    && target.keySetLibrary
    && find.canFastReject
    && target.canFastReject
    && !isSubsetOf(find.keySet, target.keySet)
  ) {
    return emptySelectorMatchState();
  }

  const findPlan = getSelectorMatchPlan(find);
  if (findPlan.kind !== 'route' || findPlan.units.length === 0) {
    return emptySelectorMatchState();
  }
  const groupMatchCache: GroupMatchCache = new WeakMap();

  const matchParentRoute = (
    routePlan: RouteMatchPlan,
    parentPlan: MatchPlan
  ): SelectorMatchState => {
    const result = emptySelectorMatchState();
    const routeUnits = routePlan.units;
    const findUnits = findPlan.units;

    if (routeUnits.length === 0) {
      return result;
    }

    const boundaryTailUnits = getBoundaryTailUnits(routePlan);
    const boundaryTailLength = boundaryTailUnits.length;
    const findLength = findUnits.length;
    const matchedAll = (
      findLength <= boundaryTailLength
      && matchUnitWindow(
        findUnits,
        0,
        boundaryTailUnits,
        boundaryTailLength - findLength,
        findLength,
        groupMatchCache,
        context,
        parent
      ).matched
    );

    if (matchedAll || boundaryTailLength > findLength) {
      return result;
    }

    const targetBoundaryMatch = matchUnitWindow(
      findUnits,
      findLength - boundaryTailLength,
      boundaryTailUnits,
      0,
      boundaryTailLength,
      groupMatchCache,
      context,
      parent
    );

    if (!targetBoundaryMatch.matched) {
      return result;
    }

    const remainingFindLength = findLength - boundaryTailLength;
    if (remainingFindLength === 0) {
      return result;
    }

    const matchParentPlan = (plan: MatchPlan): void => {
      if (plan.kind === 'list') {
        for (let i = 0; i < plan.alternates.length; i++) {
          matchParentPlan(plan.alternates[i]!);
        }
        return;
      }

      const parentUnits = plan.units;
      if (parentUnits.length < remainingFindLength) {
        return;
      }

      const parentMatch = matchUnitWindow(
        findUnits,
        0,
        parentUnits,
        parentUnits.length - remainingFindLength,
        remainingFindLength,
        groupMatchCache,
        context
      );

      if (!parentMatch.matched) {
        return;
      }

      const exact = (
        parentMatch.exact
        && targetBoundaryMatch.exact
        && remainingFindLength === parentUnits.length
      );
      const firstTargetUnit = boundaryTailUnits[0]!;
      const lastTargetUnit = boundaryTailUnits[boundaryTailLength - 1]!;
      const firstParentUnit = parentUnits[parentUnits.length - remainingFindLength]!;
      const lastParentUnit = parentUnits[parentUnits.length - 1]!;
      const leadingAmpersand = hasLeadingAmpersandBoundary(routePlan.selector)
        ? (routePlan.selector as { value: readonly Node[] }).value[0]
        : undefined;
      const ampersandCrossings: SelectorMatchAmpersandCrossing[] = [{
        ampersandNode: leadingAmpersand,
        targetSegment: {
          containingNode: routePlan.selector,
          startIndex: firstTargetUnit.index,
          endIndex: lastTargetUnit.index
        },
        parentSegment: {
          containingNode: plan.selector,
          startIndex: firstParentUnit.index,
          endIndex: lastParentUnit.index
        }
      }];

      if (isNode(routePlan.selector, N.CompoundSelector) || isNode(routePlan.selector, N.ComplexSelector)) {
        result.matches.push({
          startIndex: 0,
          endIndex: (routePlan.selector as CompoundSelector | ComplexSelector).value.length - 1,
          containingNode: routePlan.selector,
          exact,
          crossesAmpersand: true,
          consumedTarget: !!exact,
          ampersandCrossings
        });
        return;
      }

      result.matches.push({
        containingNode: routePlan.selector,
        exact,
        crossesAmpersand: true,
        consumedTarget: !!exact,
        ampersandCrossings
      });
    };

    matchParentPlan(parentPlan);
    return finalizeMatchState(result);
  };

  const pushMidRouteAmpersandMatches = (
    matches: SelectorMatchLocation[],
    routePlan: RouteMatchPlan
  ): void => {
    const routeUnits = routePlan.units;
    const findUnits = findPlan.units;

    const pushMatchesForResolvedPlan = (
      plan: MatchPlan,
      ampStart: number,
      ampUnit: MatchPlanUnit & { kind: 'group' },
      tailLength: number,
      tailMatch: MatchWindowResult
    ): void => {
      if (plan.kind === 'list') {
        for (let i = 0; i < plan.alternates.length; i++) {
          pushMatchesForResolvedPlan(plan.alternates[i]!, ampStart, ampUnit, tailLength, tailMatch);
        }
        return;
      }

      const remainingFindLength = findUnits.length - tailLength;
      if (remainingFindLength <= 0) {
        return;
      }

      const parentUnits = plan.units;
      if (parentUnits.length < remainingFindLength) {
        return;
      }

      const parentMatch = matchUnitWindow(
        findUnits,
        0,
        parentUnits,
        parentUnits.length - remainingFindLength,
        remainingFindLength,
        groupMatchCache,
        context
      );
      if (!parentMatch.matched) {
        return;
      }

      const tailEndUnit = routeUnits[ampStart + tailLength] ?? routeUnits[routeUnits.length - 1]!;
      const firstParentUnit = parentUnits[parentUnits.length - remainingFindLength]!;
      const lastParentUnit = parentUnits[parentUnits.length - 1]!;
      const exact = (
        ampStart === 0
        && ampStart + tailLength === routeUnits.length - 1
        && remainingFindLength === parentUnits.length
        && parentMatch.exact
        && tailMatch.exact
      );

      matches.push({
        startIndex: ampUnit.index,
        endIndex: tailEndUnit.index,
        containingNode: routePlan.selector,
        exact,
        crossesAmpersand: true,
        consumedTarget: !!exact,
        ampersandCrossings: [{
          ampersandNode: ampUnit.node,
          targetSegment: {
            containingNode: routePlan.selector,
            startIndex: ampUnit.index,
            endIndex: tailEndUnit.index
          },
          parentSegment: {
            containingNode: plan.selector,
            startIndex: firstParentUnit.index,
            endIndex: lastParentUnit.index
          }
        }]
      });
    };

    for (let ampStart = 0; ampStart < routeUnits.length - 1; ampStart++) {
      const ampUnit = routeUnits[ampStart]!;
      if (!(ampUnit.kind === 'group' && isNode(ampUnit.node, N.Ampersand))) {
        continue;
      }

      const resolved = ampUnit.node.getResolvedSelector() ?? parent;
      if (!resolved || isNode(resolved, N.Nil)) {
        continue;
      }

      const resolvedPlan = getSelectorMatchPlan(resolved as Selector);
      const maxTailLength = Math.min(
        routeUnits.length - (ampStart + 1),
        findUnits.length - 1
      );

      for (let tailLength = 1; tailLength <= maxTailLength; tailLength++) {
        const tailMatch = matchUnitWindow(
          findUnits,
          findUnits.length - tailLength,
          routeUnits,
          ampStart + 1,
          tailLength,
          groupMatchCache,
          context,
          parent
        );
        if (!tailMatch.matched) {
          continue;
        }

        pushMatchesForResolvedPlan(resolvedPlan, ampStart, {
          ...ampUnit,
          kind: 'group'
        }, tailLength, tailMatch);
      }
    }
  };

  const matchTargetRoute = (
    routePlan: RouteMatchPlan,
    parentPlan?: MatchPlan
  ): SelectorMatchState => {
    const result = emptySelectorMatchState();
    const routeUnits = routePlan.units;
    const findUnits = findPlan.units;
    const singleFindGroup = findUnits.length === 1 && findUnits[0]!.kind === 'group'
      ? findUnits[0]!
      : undefined;
    const suppressAmbiguousBranchLocations = findUnits.length > 0 && routePlan.selector !== find
      ? findPlan.hasAmbiguousBranchTail
      : findPlan.hasAmbiguousBranchTail;

    if (routeUnits.length >= findUnits.length) {
      const lastStart = routeUnits.length - findUnits.length;

      for (let start = 0; start <= lastStart; start++) {
        let exact = start === 0 && routeUnits.length === findUnits.length;
        const windowMatch = matchUnitWindow(
          findUnits,
          0,
          routeUnits,
          start,
          findUnits.length,
          groupMatchCache,
          context,
          parent
        );
        let matched = windowMatch.matched;
        exact &&= windowMatch.exact;

        if (!matched) {
          continue;
        }

        if (
          parent
          && findUnits.length === 1
          && routeUnits.length > 1
          && routeUnits[start]?.kind === 'group'
          && isNode(routeUnits[start]!.node, N.Ampersand)
        ) {
          continue;
        }

        if (singleFindGroup) {
          const targetUnit = routeUnits[start]!;
          if (targetUnit.kind === 'group') {
            const groupLocations = collectGroupMatchLocations(targetUnit.node, singleFindGroup.group, parent);
            for (let i = 0; i < groupLocations.length; i++) {
              const location = groupLocations[i]!;
              result.matches.push({
                ...location,
                exact: exact && location.exact,
                consumedTarget: !!location.consumedTarget,
                ampersandCrossings: cloneAmpersandCrossings(location.ampersandCrossings)
              });
            }
            continue;
          }
        }

        if (!windowMatch.exact && suppressAmbiguousBranchLocations) {
          result.partialMatch = true;
          continue;
        }

        result.matches.push({
          startIndex: routeUnits[start]!.index,
          endIndex: routeUnits[start + findUnits.length - 1]!.index,
          containingNode: routePlan.selector as Node,
          exact,
          consumedTarget: !!exact
        });
      }
    }

    pushMidRouteAmpersandMatches(result.matches, routePlan);

    if (parentPlan) {
      pushMatches(result.matches, matchParentRoute(routePlan, parentPlan).matches);
    }

    return finalizeMatchState(result);
  };

  const matchTargetPlan = (
    plan: MatchPlan,
    parentPlan?: MatchPlan
  ): SelectorMatchState => {
    if (plan.kind === 'route') {
      return matchTargetRoute(plan, parentPlan);
    }

    const result = emptySelectorMatchState();
    for (let i = 0; i < plan.alternates.length; i++) {
      const match = matchTargetPlan(plan.alternates[i]!, parentPlan);
      pushMatches(result.matches, match.matches);
    }

    return finalizeMatchState(result);
  };

  const parentPlan = parent ? getSelectorMatchPlan(parent) : undefined;
  const result = matchTargetPlan(getSelectorMatchPlan(target, parent), parentPlan);
  pushNestedPseudoMatches(find, target, result.matches, context);
  if (!result.partialMatch && result.matches.length === 0) {
    pushNestedBranchMatches(find, target, result.matches, context, parent);
  }
  return finalizeMatchState(result);
}

function selectorMatchInternal(
  find: Selector,
  target: Selector,
  parent: Selector | undefined,
  context: SelectorMatchContext
): SelectorMatchState {
  if (parent) {
    return selectorMatchUncached(find, target, parent, context);
  }

  let findCache = context.pairCache.get(find);
  if (!findCache) {
    findCache = new WeakMap<Selector, SelectorMatchState>();
    context.pairCache.set(find, findCache);
  }

  const cached = findCache.get(target);
  if (cached) {
    return cached;
  }

  const result = selectorMatchUncached(find, target, undefined, context);
  findCache.set(target, result);
  return result;
}

/**
 * Finds all occurrences of `find` inside `target`.
 *
 * Matching is ordered at the route level, unordered only inside a single
 * compound-like position, and branches only at `SelectorList` alternatives.
 *
 * When `parent` is provided, it acts like an implicit prefix context joined to
 * `target` by a descendant combinator. Parent traversal is attempted only when
 * a match reaches a left-side ampersand boundary with partial-but-incomplete
 * progress; matches that exist only inside the parent do not get added on
 * their own.
 *
 * Complex selector branches inside `:is(...)` or selector lists are treated as
 * alternate branch routes. Matching may succeed inside one branch, but the
 * outer route cannot continue leftward through that branch unless that branch
 * itself was consumed end-to-end.
 *
 * The matcher uses normalized `valueOf()` and selector key-set fast paths only
 * as cheap equality / rejection signals. They are not shape-preserving and
 * should not be used by callers to infer the structural rewrite shape of a
 * successful match.
 */
export function selectorMatch(
  find: Selector,
  target: Selector,
  parent?: Selector
): SelectorMatchState {
  return selectorMatchInternal(find, target, parent, {
    pairCache: new WeakMap()
  });
}
