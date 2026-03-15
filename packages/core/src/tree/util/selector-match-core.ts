import { Selector } from '../selector.js';
import { SelectorList } from '../selector-list.js';
import type { Node } from '../node.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { isSubsetOf } from './bitset.js';

interface SelectorMatchState {
  /**
   * Note that a "full" match just means an "end to end" match,
   * which does not mean all alternatives are matched.
   */
  fullMatch: boolean;
  partialMatch: boolean;
  matches: Array<{
    startIndex: number;
    endIndex: number;
    containingNode: Node;
    exact: boolean;
  }>;
}

type SelectorMatchLocation = SelectorMatchState['matches'][number];

type MatchGroup = {
  basicSelectorIndex: Map<string, number>;
  basicSelectorCounts: number[];
  basicSelectorTotal: number;
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

const selectorMatchPlanCache = new WeakMap<Selector, {
  value: string;
  plan: MatchPlan;
}>();

function buildMatchGroup(node: Node): MatchGroup {
  const basicSelectorIndex = new Map<string, number>();
  const basicSelectorCounts: number[] = [];
  let basicSelectorTotal = 0;

  const collectGroupBasics = (current: Node): void => {
    if (isNode(current, N.BasicSelector)) {
      const value = current.valueOf();
      const idx = basicSelectorIndex.get(value);
      if (idx === undefined) {
        basicSelectorIndex.set(value, basicSelectorCounts.length);
        basicSelectorCounts.push(1);
      } else {
        basicSelectorCounts[idx]!++;
      }
      basicSelectorTotal++;
      return;
    }

    const children = current.children();
    let child = children.next();

    while (!child.done) {
      collectGroupBasics(child.value);
      child = children.next();
    }
  };

  collectGroupBasics(node);

  return {
    basicSelectorIndex,
    basicSelectorCounts,
    basicSelectorTotal
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
      if (group.basicSelectorTotal > 0) {
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
    units: group.basicSelectorTotal > 0
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
  group: MatchGroup,
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
): { matched: boolean; exact: boolean } {
  const states = consumeGroupBasics(targetGroup, findGroup, [{
    remainingCounts: [...findGroup.basicSelectorCounts],
    remainingTotal: findGroup.basicSelectorTotal,
    exact: true
  }]);

  return {
    matched: states.some(state => state.remainingTotal === 0),
    exact: states.some(state => state.remainingTotal === 0 && state.exact)
  };
}

function matchCompoundWindow(
  targetCompound: Selector & { data: readonly Node[] },
  start: number,
  end: number,
  findGroup: MatchGroup
): { matched: boolean; exact: boolean } {
  let states = [{
    remainingCounts: [...findGroup.basicSelectorCounts],
    remainingTotal: findGroup.basicSelectorTotal,
    exact: true
  }];

  for (let i = start; i <= end && states.length > 0 && !allStatesAreTerminalPartial(states); i++) {
    states = consumeGroupBasics(targetCompound.data[i]!, findGroup, states);
  }

  return {
    matched: states.some(state => state.remainingTotal === 0),
    exact: states.some(state => state.remainingTotal === 0 && state.exact)
  };
}

function collectGroupMatchLocations(
  targetGroup: Node,
  find: Selector,
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

  const findSpanLength = isNode(find, N.CompoundSelector) ? find.data.length : 1;
  const lastStart = targetGroup.data.length - findSpanLength;
  const matches: SelectorMatchLocation[] = [];

  if (lastStart < 0) {
    return matches;
  }

  for (let start = 0; start <= lastStart; start++) {
    const end = start + findSpanLength - 1;
    const windowMatch = matchCompoundWindow(targetGroup as Selector & { data: readonly Node[] }, start, end, findGroup);

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

  return matches;
}

function emptySelectorMatchState(): SelectorMatchState {
  return {
    fullMatch: false,
    partialMatch: false,
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

export function selectorMatch(
  find: Selector,
  target: Selector
): SelectorMatchState {
  if (find.canFastReject && !isSubsetOf(find.keySet, target.keySet)) {
    return emptySelectorMatchState();
  }

  const findPlan = getSelectorMatchPlan(find);
  if (findPlan.kind !== 'route' || findPlan.units.length === 0) {
    return emptySelectorMatchState();
  }

  const matchTargetRoute = (routePlan: RouteMatchPlan): SelectorMatchState => {
    const result = emptySelectorMatchState();
    const routeUnits = routePlan.units;
    const findUnits = findPlan.units;

    if (routeUnits.length < findUnits.length) {
      return result;
    }

    const lastStart = routeUnits.length - findUnits.length;

    for (let start = 0; start <= lastStart; start++) {
      let exact = start === 0 && routeUnits.length === findUnits.length;
      let matched = true;

      for (let offset = 0; offset < findUnits.length; offset++) {
        const findUnit = findUnits[offset]!;
        const targetUnit = routeUnits[start + offset]!;

        if (findUnit.kind !== targetUnit.kind) {
          matched = false;
          break;
        }

        if (findUnit.kind === 'combinator') {
          if (targetUnit.kind !== 'combinator' || findUnit.value !== targetUnit.value) {
            matched = false;
            break;
          }
          continue;
        }

        const groupMatch = matchTargetGroup(targetUnit.node, findUnit.group);
        if (!groupMatch.matched) {
          matched = false;
          break;
        }
        exact &&= groupMatch.exact;
      }

      if (!matched) {
        continue;
      }

      if (findUnits.length === 1 && findUnits[0]!.kind === 'group') {
        const targetUnit = routeUnits[start]!;
        if (targetUnit.kind === 'group') {
          const groupLocations = collectGroupMatchLocations(targetUnit.node, find, findUnits[0]!.group);
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

    result.fullMatch = result.matches.some(match => match.exact);
    result.partialMatch = result.matches.length > 0;
    return result;
  };

  const matchTargetPlan = (plan: MatchPlan): SelectorMatchState => {
    if (plan.kind === 'route') {
      return matchTargetRoute(plan);
    }

    const result = emptySelectorMatchState();
    for (let i = 0; i < plan.alternates.length; i++) {
      const match = matchTargetPlan(plan.alternates[i]!);
      pushMatches(result.matches, match.matches);
    }

    result.fullMatch = result.matches.some(match => match.exact);
    result.partialMatch = result.matches.length > 0;
    return result;
  };

  return matchTargetPlan(getSelectorMatchPlan(target));
}
