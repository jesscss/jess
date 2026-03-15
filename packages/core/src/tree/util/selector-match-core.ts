import { Selector } from '../selector.js';
import { SelectorList } from '../selector-list.js';
import { F_AMPERSAND, type Node } from '../node.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { isSubsetOf } from './bitset.js';
import { type PseudoSelector } from '../selector-pseudo.js';

const { isArray } = Array;

interface SelectorMatchState {
  /**
   * Note that a "full" match just means an "end to end" match,
   * which does not mean all alternatives are matched.
   */
  fullMatch: boolean;
  partialMatch: boolean;
  crossesAmpersand: boolean;
  matches: Array<{
    startIndex?: number;
    endIndex?: number;
    containingNode: Node;
    exact?: boolean;
    crossesAmpersand?: boolean;
  }>;
}

type SelectorMatchLocation = SelectorMatchState['matches'][number];

type MatchGroupRequirement = {
  basicSelectorIndex: Map<string, number>;
  basicSelectorCounts: number[];
  basicSelectorTotal: number;
};

type MatchGroup = {
  alternatives: MatchGroupRequirement[];
};

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

const selectorMatchPlanCache = new WeakMap<Selector, {
  value: string;
  plan: MatchPlan;
}>();

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
    basicSelectorTotal: 0
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
    basicSelectorTotal: requirement.basicSelectorTotal
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
  return merged;
}

function buildGroupRequirements(node: Node): MatchGroupRequirement[] {
  if (isNode(node, N.BasicSelector)) {
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

  if (isNode(node, N.BasicSelector)) {
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

    matched ||= states.some(state => state.remainingTotal === 0);
    exact ||= states.some(state => state.remainingTotal === 0 && state.exact);

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

  return {
    matched: states.some(state => state.remainingTotal === 0),
    exact: states.some(state => state.remainingTotal === 0 && state.exact)
  };
}

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

  for (let i = 0; i < findGroup.alternatives.length; i++) {
    const requirement = findGroup.alternatives[i]!;
    const findSpanLength = requirement.basicSelectorTotal;
    const lastStart = targetGroup.data.length - findSpanLength;

    if (lastStart < 0) {
      continue;
    }

    for (let start = 0; start <= lastStart; start++) {
      const end = start + findSpanLength - 1;
      const windowMatch = matchCompoundWindow(
        targetGroup as Selector & { data: readonly Node[] },
        start,
        end,
        requirement
      );

      if (!windowMatch.matched) {
        continue;
      }

      matches.push({
        startIndex: start,
        endIndex: end,
        containingNode: targetGroup,
        exact: windowMatch.exact && start === 0 && end === targetGroup.data.length - 1
      });
    }
  }

  return matches;
}

function emptySelectorMatchState(): SelectorMatchState {
  return {
    fullMatch: false,
    partialMatch: false,
    crossesAmpersand: false,
    matches: []
  };
}

function pushMatches(
  target: SelectorMatchLocation[],
  source: SelectorMatchLocation[]
): void {
  for (let i = 0; i < source.length; i++) {
    target.push(source[i]!);
  }
}

function matchUnitWindow(
  findUnits: MatchPlanUnit[],
  findStart: number,
  targetUnits: MatchPlanUnit[],
  targetStart: number,
  length: number
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

    const groupMatch = matchTargetGroup(targetUnit.node, findUnit.group);
    if (!groupMatch.matched) {
      return { matched: false, exact: false };
    }

    exact &&= groupMatch.exact;
  }

  return { matched: true, exact };
}

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

function finalizeMatchState(result: SelectorMatchState): SelectorMatchState {
  result.fullMatch = result.matches.some(match => match.exact);
  result.partialMatch = result.matches.length > 0;
  result.crossesAmpersand = result.matches.some(locationCrossesAmpersand);
  return result;
}

function pushNestedPseudoMatches(
  find: Selector,
  targetNode: Node,
  matches: SelectorMatchLocation[]
): void {
  if (isSearchablePseudoBoundary(targetNode)) {
    if (isSearchablePseudoBoundary(find)) {
      if (find.data.name !== targetNode.data.name) {
        return;
      }

      const nested = selectorMatch(find.data.arg as Selector, targetNode.arg as Selector);
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

    const nested = selectorMatch(find, targetNode.arg as Selector);
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
    pushNestedPseudoMatches(find, child.value, matches);
    child = children.next();
  }
}

export function selectorMatch(
  find: Selector,
  target: Selector,
  parent?: Selector
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

      return selectorMatch(find.data.arg as Selector, target.arg as Selector);
    }

    const nested = selectorMatch(find.data.arg as Selector, target);
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

  if (!parent && find.canFastReject && !isSubsetOf(find.keySet, target.keySet)) {
    return emptySelectorMatchState();
  }

  const findPlan = getSelectorMatchPlan(find);
  if (findPlan.kind !== 'route' || findPlan.units.length === 0) {
    return emptySelectorMatchState();
  }

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
        findLength
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
      boundaryTailLength
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
        remainingFindLength
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
        const windowMatch = matchUnitWindow(findUnits, 0, routeUnits, start, findUnits.length);
        let matched = windowMatch.matched;
        exact &&= windowMatch.exact;

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
  pushNestedPseudoMatches(find, target, result.matches);
  return finalizeMatchState(result);
}
