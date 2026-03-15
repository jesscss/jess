import { Selector } from '../selector.js';
import { SelectorList } from '../selector-list.js';
import { F_AMPERSAND, type Node } from '../node.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { isSubsetOf } from './bitset.js';
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
 */
interface SelectorMatchLocation {
  startIndex?: number;
  endIndex?: number;
  matchedIndices?: number[];
  containingNode: Node;
  exact?: boolean;
  crossesAmpersand?: boolean;
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
}>();

/**
 * Returns true for pseudos whose selector arguments can be searched recursively
 * but cannot be consumed as part of a continuing outer match, unlike `:is()`.
 */
function isSearchablePseudoBoundary(node: Node): node is PseudoSelector {
  return (
    isNode(node, N.PseudoSelector)
    && node.data.name !== ':is'
    && isNode(node.data.arg, N.Selector)
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
  if (requirement.basicSelectorIndex.has(value)) {
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
  for (const value of right.basicSelectorIndex.keys()) {
    addRequirementValue(merged, value);
  }
  merged.hasComplexBranch ||= right.hasComplexBranch;
  merged.branchTailAmbiguous ||= right.branchTailAmbiguous;
  return merged;
}

function markComplexBranchRequirements(
  requirements: MatchGroupRequirement[],
  branch: Selector & { data?: readonly Node[] }
): MatchGroupRequirement[] {
  const earlierValues = new Set<string>();

  if (isNode(branch, N.ComplexSelector)) {
    for (let i = 0; i < branch.data.length - 1; i++) {
      const component = branch.data[i]!;
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

function buildGroupRequirements(node: Node): MatchGroupRequirement[] {
  if (isNode(node, N.BasicSelector)) {
    const requirement = createRequirement();
    addRequirementValue(requirement, node.valueOf());
    return [requirement];
  }

  if (isNode(node, N.ComplexSelector)) {
    for (let i = node.data.length - 1; i >= 0; i--) {
      const component = node.data[i]!;
      if (!isNode(component, N.Combinator)) {
        return markComplexBranchRequirements(buildGroupRequirements(component), node);
      }
    }

    return [createRequirement()];
  }

  if (isNode(node, N.PseudoSelector) && node.data.name !== ':is') {
    const requirement = createRequirement();
    addRequirementValue(requirement, node.valueOf());
    return [requirement];
  }

  if (isSearchablePseudoBoundary(node)) {
    return [createRequirement()];
  }

  if (isNode(node, N.SelectorList)) {
    const alternatives: MatchGroupRequirement[] = [];
    for (let i = 0; i < node.data.length; i++) {
      const nested = buildGroupRequirements(node.data[i]!);
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
    const childRequirements = buildGroupRequirements(child.value);
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

function buildMatchGroup(node: Node): MatchGroup {
  return {
    alternatives: buildGroupRequirements(node)
  };
}

function buildRouteMatchPlan(selector: Selector): RouteMatchPlan {
  if (isNode(selector, N.ComplexSelector)) {
    const units: MatchPlanUnit[] = [];

    for (let i = 0; i < selector.data.length; i++) {
      const component = selector.data[i]!;
      if (isNode(component, N.Combinator)) {
        units.push({
          kind: 'combinator',
          index: i,
          node: component,
          value: component.valueOf()
        });
        continue;
      }

      const group = buildMatchGroup(component);
      const hasAlternatives = group.alternatives.some(alternate => alternate.basicSelectorTotal > 0);
      if (hasAlternatives) {
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
      units
    };
  }

  if (isNode(selector, N.Combinator)) {
    return {
      kind: 'route',
      selector,
      units: [{
        kind: 'combinator',
        index: 0,
        node: selector,
        value: selector.valueOf()
      }]
    };
  }

  const group = buildMatchGroup(selector);
  return {
    kind: 'route',
    selector,
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

function buildMatchPlan(selector: Selector): MatchPlan {
  if (isNode(selector, N.SelectorList)) {
    return {
      kind: 'list',
      selector,
      alternates: selector.data.map(item => getSelectorMatchPlan(item))
    };
  }

  return buildRouteMatchPlan(selector);
}

function getSelectorMatchPlan(selector: Selector): MatchPlan {
  const value = selector.valueOf();
  const cached = selectorMatchPlanCache.get(selector);
  if (cached && cached.value === value) {
    return cached.plan;
  }

  const plan = buildMatchPlan(selector);
  selectorMatchPlanCache.set(selector, { value, plan });
  return plan;
}

function cloneGroupStates(states: MatchGroupState[]): MatchGroupState[] {
  const nextStates = new Array<MatchGroupState>(states.length);
  for (let i = 0; i < states.length; i++) {
    const state = states[i]!;
    nextStates[i] = {
      remainingCounts: [...state.remainingCounts],
      remainingTotal: state.remainingTotal,
      exact: state.exact
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
  states: MatchGroupState[]
): MatchGroupState[] {
  if (states.length === 0) {
    return states;
  }

  if (isNode(node, N.BasicSelector) || (isNode(node, N.PseudoSelector) && node.data.name !== ':is')) {
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
          cloneGroupStates(states)
        )
      );
    }

    return nextStates;
  }

  const children = node.children();
  let nextStates = states;
  let child = children.next();

  while (!child.done && nextStates.length > 0 && !allStatesAreTerminalPartial(nextStates)) {
    nextStates = consumeGroupBasics(child.value, group, nextStates);
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
    if (state.remainingTotal !== 0) {
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
  findGroup: MatchGroup
): MatchWindowResult {
  let matched = false;
  let exact = false;

  for (let i = 0; i < findGroup.alternatives.length; i++) {
    const requirement = findGroup.alternatives[i]!;
    const states = consumeGroupBasics(targetGroup, requirement, [{
      remainingCounts: [...requirement.basicSelectorCounts],
      remainingTotal: requirement.basicSelectorTotal,
      exact: true
    }]);
    const summary = summarizeStates(states);

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
  requirement: MatchGroupRequirement
): MatchWindowResult {
  let states = [{
    remainingCounts: [...requirement.basicSelectorCounts],
    remainingTotal: requirement.basicSelectorTotal,
    exact: true
  }];

  for (let i = start; i <= end && states.length > 0 && !allStatesAreTerminalPartial(states); i++) {
    states = consumeGroupBasics(targetCompound.data[i]!, requirement, states);
  }

  const summary = summarizeStates(states);
  if (requirement.hasComplexBranch) {
    summary.exact = false;
  }
  return summary;
}

function collectMatchedIndicesForWindow(
  targetCompound: Selector & { data: readonly Node[] },
  start: number,
  end: number,
  requirement: MatchGroupRequirement
): number[] | undefined {
  const remainingCounts = [...requirement.basicSelectorCounts];
  const matchedIndices: number[] = [];

  for (let i = start; i <= end; i++) {
    const node = targetCompound.data[i]!;
    if (!isNode(node, N.BasicSelector) && !(isNode(node, N.PseudoSelector) && node.data.name !== ':is')) {
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
 */
function collectGroupMatchLocations(
  targetGroup: Node,
  findGroup: MatchGroup
): SelectorMatchLocation[] {
  if (!isNode(targetGroup, N.CompoundSelector)) {
    const groupMatch = matchTargetGroup(targetGroup, findGroup);
    return groupMatch.matched
      ? [{
          startIndex: 0,
          endIndex: 0,
          containingNode: targetGroup,
          exact: groupMatch.exact
        }]
      : [];
  }

  const matches: SelectorMatchLocation[] = [];
  const seen = new Set<number>();
  const targetCompound = targetGroup as Selector & { data: readonly Node[] };
  const targetLength = targetGroup.data.length;

  for (let i = 0; i < findGroup.alternatives.length; i++) {
    const requirement = findGroup.alternatives[i]!;
    for (let start = 0; start < targetLength; start++) {
      for (let end = start; end < targetLength; end++) {
        const windowMatch = matchCompoundWindow(
          targetCompound,
          start,
          end,
          requirement
        );

        if (!windowMatch.matched) {
          continue;
        }

        const withoutStartMatches = start < end
          && matchCompoundWindow(targetCompound, start + 1, end, requirement).matched;
        if (withoutStartMatches) {
          continue;
        }

        const withoutEndMatches = start < end
          && matchCompoundWindow(targetCompound, start, end - 1, requirement).matched;
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
          exact: windowMatch.exact && start === 0 && end === targetLength - 1
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

function getCachedGroupMatch(
  cache: GroupMatchCache,
  targetGroup: Node,
  findGroup: MatchGroup
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

  const result = matchTargetGroup(targetGroup, findGroup);
  nodeCache.set(findGroup, result);
  return result;
}

function getBranchAlternatives(node: Node): readonly Selector[] | undefined {
  if (isNode(node, N.SelectorList)) {
    return node.data;
  }

  if (isNode(node, N.PseudoSelector) && node.data.name === ':is' && isNode(node.data.arg, N.Selector)) {
    if (isNode(node.data.arg, N.SelectorList)) {
      return node.data.arg.data;
    }

    return [node.data.arg as Selector];
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
  context: SelectorMatchContext
): MatchWindowResult {
  const targetBranches = getBranchAlternatives(targetNode);
  const findBranches = getBranchAlternatives(findNode);
  if (targetBranches && findBranches) {
    let matched = false;
    let exact = false;

    for (let i = 0; i < findBranches.length; i++) {
      for (let j = 0; j < targetBranches.length; j++) {
        const nested = selectorMatchInternal(findBranches[i]!, targetBranches[j]!, undefined, context);
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
      const nested = selectorMatchInternal(findNode as Selector, targetBranches[i]!, undefined, context);
      matched ||= nested.partialMatch;
      exact ||= nested.fullMatch;

      if (exact) {
        break;
      }
    }

    return { matched, exact };
  }

  return getCachedGroupMatch(groupMatchCache, targetNode, findGroup);
}

function pushNestedBranchMatches(
  findNode: Node,
  target: Selector,
  matches: SelectorMatchLocation[],
  context: SelectorMatchContext
): void {
  const branches = getBranchAlternatives(findNode);
  if (branches) {
    for (let i = 0; i < branches.length; i++) {
      const nested = selectorMatchInternal(target, branches[i]!, undefined, context);
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
          exact: false
        });
      }
    }
    return;
  }

  const children = findNode.children();
  let child = children.next();
  while (!child.done) {
    pushNestedBranchMatches(child.value, target, matches, context);
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
  context: SelectorMatchContext
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
      context
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
    && selector.data.length > 0
    && isNode(selector.data[0]!, N.Ampersand)
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
      if (containingNode.data[i]?.hasFlag(F_AMPERSAND)) {
        return true;
      }
    }
    return false;
  }

  if (isNode(containingNode, N.SelectorList)) {
    return !!containingNode.data[startIndex]?.hasFlag(F_AMPERSAND);
  }

  return true;
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
      if (find.data.name !== targetNode.data.name) {
        return;
      }

      const nested = selectorMatchInternal(find.data.arg as Selector, targetNode.arg as Selector, undefined, context);
      for (let i = 0; i < nested.matches.length; i++) {
        const match = nested.matches[i]!;
        matches.push({
          startIndex: match.startIndex,
          endIndex: match.endIndex,
          containingNode: match.containingNode,
          exact: match.exact
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
        exact: false
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
 */
function selectorMatchUncached(
  find: Selector,
  target: Selector,
  parent: Selector | undefined,
  context: SelectorMatchContext
): SelectorMatchState {
  if (
    isNode(find, N.PseudoSelector)
    && find.data.name !== ':is'
    && isNode(find.data.arg, N.Selector)
  ) {
    if (isSearchablePseudoBoundary(target)) {
      if (find.data.name !== target.data.name) {
        return emptySelectorMatchState();
      }

      return selectorMatchInternal(find.data.arg as Selector, target.arg as Selector, undefined, context);
    }

    const nested = selectorMatchInternal(find.data.arg as Selector, target, undefined, context);
    if (!nested.partialMatch) {
      return nested;
    }

    const matches = new Array<SelectorMatchLocation>(nested.matches.length);
    for (let i = 0; i < nested.matches.length; i++) {
      const match = nested.matches[i]!;
      matches[i] = {
        startIndex: match.startIndex,
        endIndex: match.endIndex,
        containingNode: find.data.arg as Node,
        exact: false
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
      if (sel.valueOf() === findValue) {
        return {
          fullMatch: true,
          partialMatch: true,
          crossesAmpersand: sel.hasFlag(F_AMPERSAND),
          matches: [{
            startIndex: i,
            endIndex: i,
            containingNode: sel,
            exact: true
          }]
        };
      }
    }
    return {
      fullMatch: false,
      partialMatch: true,
      crossesAmpersand: false,
      matches: []
    };
  } else {
    if (findValue === target.valueOf()) {
      return {
        fullMatch: true,
        partialMatch: true,
        crossesAmpersand: target.hasFlag(F_AMPERSAND),
        matches: [{
          containingNode: target,
          exact: true
        }]
      };
    }
  }

  if (
    !parent
    && !hasNestedBranchAlternatives(find)
    && find.canFastReject
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
        context
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
      context
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

      if (isNode(routePlan.selector, N.CompoundSelector) || isNode(routePlan.selector, N.ComplexSelector)) {
        result.matches.push({
          startIndex: 0,
          endIndex: routePlan.selector.data.length - 1,
          containingNode: routePlan.selector,
          exact,
          crossesAmpersand: true
        });
        return;
      }

      result.matches.push({
        containingNode: routePlan.selector,
        exact,
        crossesAmpersand: true
      });
    };

    matchParentPlan(parentPlan);
    return finalizeMatchState(result);
  };

  const matchTargetRoute = (
    routePlan: RouteMatchPlan,
    parentPlan?: MatchPlan
  ): SelectorMatchState => {
    const result = emptySelectorMatchState();
    const routeUnits = routePlan.units;
    const findUnits = findPlan.units;

    if (routeUnits.length >= findUnits.length) {
      const lastStart = routeUnits.length - findUnits.length;

      for (let start = 0; start <= lastStart; start++) {
        let exact = start === 0 && routeUnits.length === findUnits.length;
        let suppressLocation = false;
        const windowMatch = matchUnitWindow(
          findUnits,
          0,
          routeUnits,
          start,
          findUnits.length,
          groupMatchCache,
          context
        );
        let matched = windowMatch.matched;
        exact &&= windowMatch.exact;

        if (!windowMatch.exact) {
          for (let offset = 0; offset < findUnits.length; offset++) {
            const findUnit = findUnits[offset]!;
            if (
              findUnit.kind === 'group'
              && findUnit.group.alternatives.some(alternative => alternative.branchTailAmbiguous)
            ) {
              suppressLocation = true;
              break;
            }
          }
        }

        if (!matched) {
          continue;
        }

        if (findUnits.length === 1 && findUnits[0]!.kind === 'group') {
          const targetUnit = routeUnits[start]!;
          if (targetUnit.kind === 'group') {
            const groupLocations = collectGroupMatchLocations(targetUnit.node, findUnits[0]!.group);
            for (let i = 0; i < groupLocations.length; i++) {
              const location = groupLocations[i]!;
              result.matches.push({
                ...location,
                exact: exact && location.exact
              });
            }
            continue;
          }
        }

        if (suppressLocation) {
          result.partialMatch = true;
          continue;
        }

        result.matches.push({
          startIndex: routeUnits[start]!.index,
          endIndex: routeUnits[start + findUnits.length - 1]!.index,
          containingNode: routePlan.selector as Node,
          exact
        });
      }
    }

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
  const result = matchTargetPlan(getSelectorMatchPlan(target), parentPlan);
  pushNestedPseudoMatches(find, target, result.matches, context);
  if (!result.partialMatch && result.matches.length === 0) {
    pushNestedBranchMatches(find, target, result.matches, context);
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
