import { Node } from '../node.js';
import { Ruleset } from '../ruleset.js';

export type ExtendWorkCounters = {
  processExtendsCalls: number;
  processExtendsPasses: number;
  extendRootsVisited: number;
  rulesetsVisited: number;
  instructionsConsidered: number;
  visibleInstructionListsBuilt: number;
  targetInfoBuilds: number;
  effectiveSelectorReads: number;
  selectorCompositionCalls: number;
  routePlansBuilt: number;
  groupRequirementsBuilt: number;
  fastRejectChecks: number;
  fastRejectPasses: number;
  fastRejectRejects: number;
  positiveMatches: number;
  rewritesApplied: number;
  rulesetsChanged: number;
  chainedFollowupEnqueues: number;
  nodeCreates: number;
  nodeClones: number;
  nodeCopies: number;
  nodeInherits: number;
  nodeValueOfCalls: number;
};

const ZERO_COUNTERS = (): ExtendWorkCounters => ({
  processExtendsCalls: 0,
  processExtendsPasses: 0,
  extendRootsVisited: 0,
  rulesetsVisited: 0,
  instructionsConsidered: 0,
  visibleInstructionListsBuilt: 0,
  targetInfoBuilds: 0,
  effectiveSelectorReads: 0,
  selectorCompositionCalls: 0,
  routePlansBuilt: 0,
  groupRequirementsBuilt: 0,
  fastRejectChecks: 0,
  fastRejectPasses: 0,
  fastRejectRejects: 0,
  positiveMatches: 0,
  rewritesApplied: 0,
  rulesetsChanged: 0,
  chainedFollowupEnqueues: 0,
  nodeCreates: 0,
  nodeClones: 0,
  nodeCopies: 0,
  nodeInherits: 0,
  nodeValueOfCalls: 0
});

const EXTEND_WORK_COUNTER_KEYS: Array<keyof ExtendWorkCounters> = [
  'processExtendsCalls',
  'processExtendsPasses',
  'extendRootsVisited',
  'rulesetsVisited',
  'instructionsConsidered',
  'visibleInstructionListsBuilt',
  'targetInfoBuilds',
  'effectiveSelectorReads',
  'selectorCompositionCalls',
  'routePlansBuilt',
  'groupRequirementsBuilt',
  'fastRejectChecks',
  'fastRejectPasses',
  'fastRejectRejects',
  'positiveMatches',
  'rewritesApplied',
  'rulesetsChanged',
  'chainedFollowupEnqueues',
  'nodeCreates',
  'nodeClones',
  'nodeCopies',
  'nodeInherits',
  'nodeValueOfCalls'
];

export let activeExtendWorkCounters: ExtendWorkCounters | null = null;

export function resetExtendWorkCounters(): void {
  if (!activeExtendWorkCounters) {
    return;
  }
  const next = ZERO_COUNTERS();
  for (const key of EXTEND_WORK_COUNTER_KEYS) {
    activeExtendWorkCounters[key] = next[key];
  }
}

export function getExtendWorkCounters(): ExtendWorkCounters | null {
  return activeExtendWorkCounters;
}

export function bumpExtendCounter(
  name: keyof ExtendWorkCounters,
  amount = 1
): void {
  if (!activeExtendWorkCounters) {
    return;
  }
  activeExtendWorkCounters[name] += amount;
}

function patchNodeAndRulesetCounters(
  counters: ExtendWorkCounters
): () => void {
  const originalCreate = Node.create;
  const originalClone = Node.prototype.clone;
  const originalCopy = Node.prototype.copy;
  const originalInherit = Node.prototype.inherit;
  const originalValueOf = Node.prototype.valueOf;
  const originalGetEffectiveSelector = Ruleset.prototype.getEffectiveSelector;

  (Node as typeof Node & { create: typeof Node.create }).create = function patchedCreate(
    this: typeof Node,
    ...args: Parameters<typeof Node.create>
  ) {
    counters.nodeCreates++;
    return originalCreate.apply(this, args);
  };

  Node.prototype.clone = function patchedClone(
    this: Node,
    ...args: Parameters<Node['clone']>
  ) {
    counters.nodeClones++;
    return originalClone.apply(this, args);
  };

  Node.prototype.copy = function patchedCopy(
    this: Node,
    ...args: Parameters<Node['copy']>
  ) {
    counters.nodeCopies++;
    return originalCopy.apply(this, args);
  };

  Node.prototype.inherit = function patchedInherit(
    this: Node,
    ...args: Parameters<Node['inherit']>
  ) {
    counters.nodeInherits++;
    return originalInherit.apply(this, args);
  };

  Node.prototype.valueOf = function patchedValueOf(
    this: Node,
    ...args: Parameters<Node['valueOf']>
  ) {
    counters.nodeValueOfCalls++;
    return originalValueOf.apply(this, args);
  };

  Ruleset.prototype.getEffectiveSelector = function patchedGetEffectiveSelector(
    this: Ruleset,
    ...args: Parameters<Ruleset['getEffectiveSelector']>
  ) {
    counters.effectiveSelectorReads++;
    return originalGetEffectiveSelector.apply(this, args);
  };

  return () => {
    (Node as typeof Node & { create: typeof Node.create }).create = originalCreate;
    Node.prototype.clone = originalClone;
    Node.prototype.copy = originalCopy;
    Node.prototype.inherit = originalInherit;
    Node.prototype.valueOf = originalValueOf;
    Ruleset.prototype.getEffectiveSelector = originalGetEffectiveSelector;
  };
}

export async function withExtendWorkCounters<T>(
  fn: () => T | Promise<T>
): Promise<{ result: T; counters: ExtendWorkCounters }> {
  const previous = activeExtendWorkCounters;
  const counters = ZERO_COUNTERS();
  activeExtendWorkCounters = counters;
  const restorePatchedCounters = patchNodeAndRulesetCounters(counters);
  try {
    const result = await fn();
    return { result, counters };
  } finally {
    restorePatchedCounters();
    activeExtendWorkCounters = previous;
  }
}
