import type { Node } from '../node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
import { isNode } from './is-node.js';
import type { MixinEntry, Rules } from '../rules.js';

export type CallableEvalCandidatePreparation = {
  evalCandidates: MixinEntry[];
  hasDefault: boolean;
};

type CallableEvalCandidatePreparationOptions = {
  mixinCandidates: MixinEntry[];
  rulesEvalStack: readonly Node[];
  caller?: Node;
};

function getMixinEntryRules(entry: MixinEntry): Rules {
  return entry.value.rules;
}

function getMixinEntryGuard(entry: MixinEntry): Node | Nil | undefined {
  return entry.value.guard;
}

function guardContainsDefault(node: Node | undefined): boolean {
  if (!node) {
    return false;
  }
  if (node.type === 'DefaultGuard') {
    return true;
  }
  if (isNode(node, N.Call)) {
    const name = node.value.name;
    const callName = String(typeof name === 'string' ? name : name.valueOf());
    if (callName === 'default') {
      return true;
    }
  }
  const value = (node as { value?: unknown }).value;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isNode(item) && guardContainsDefault(item)) {
        return true;
      }
    }
    return false;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      if (isNode(item) && guardContainsDefault(item)) {
        return true;
      }
      if (Array.isArray(item)) {
        for (const child of item) {
          if (isNode(child) && guardContainsDefault(child)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function hasFailedGuardAncestor(node: Node): boolean {
  let current = node.parent;
  while (current) {
    if (isNode(current, N.Ruleset)) {
      const guardNode = current.value.guard;
      if (guardNode instanceof Nil) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

function getRootSourceRules(rules: Rules): Rules {
  let current = rules;
  const seen = new Set<Rules>();
  while (current.sourceNode && isNode(current.sourceNode, N.Rules)) {
    const next = current.sourceNode;
    if (next === current || seen.has(next)) {
      break;
    }
    seen.add(current);
    current = next;
  }
  return current;
}

function getCallableCandidateIdentity(candidate: MixinEntry): object {
  if (isNode(candidate, N.Ruleset)) {
    return getRootSourceRules(getMixinEntryRules(candidate));
  }
  if (!isNode(candidate) && candidate.kind === 'callable-rules') {
    return getRootSourceRules(getMixinEntryRules(candidate));
  }
  return candidate;
}

function stringifyCallableKey(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(item => stringifyCallableKey(item)).join('');
  }
  if (value instanceof Object && 'valueOf' in value && typeof value.valueOf === 'function') {
    return String(value.valueOf());
  }
  return String(value ?? '');
}

function getCallKey(node: Node | undefined): string | undefined {
  if (!isNode(node, N.Call)) {
    return undefined;
  }
  const name = node.value.name;
  if (typeof name === 'string') {
    return name;
  }
  if (isNode(name, N.Reference)) {
    return stringifyCallableKey(name.value.key);
  }
  return String(name.valueOf());
}

function rulesContainCallKey(rules: Rules, key: string): boolean {
  for (const child of rules.children(true)) {
    if (getCallKey(child) === key) {
      return true;
    }
  }
  return false;
}

function compareCallableDefaultPriority(a: MixinEntry, b: MixinEntry): number {
  const aDefault = a.options?.hasDefault;
  const bDefault = b.options?.hasDefault;
  if (!aDefault && !bDefault) {
    return 0;
  }
  if (!aDefault) {
    return -1;
  }
  if (!bDefault) {
    return 1;
  }
  return 0;
}

export function prepareCallableEvalCandidates({
  mixinCandidates,
  rulesEvalStack,
  caller
}: CallableEvalCandidatePreparationOptions): CallableEvalCandidatePreparation {
  const callerKey = getCallKey(caller);
  const seenCandidateIdentities = new WeakSet<object>();
  const evalCandidates: MixinEntry[] = [];
  let hasDefault = false;

  for (const candidate of mixinCandidates) {
    const candidateRules = getMixinEntryRules(candidate);
    const sourceRules = candidateRules.sourceNode;
    const inStack = rulesEvalStack.some(entry => entry === sourceRules);
    const blockedByFailedGuardAncestor = isNode(candidate)
      ? hasFailedGuardAncestor(candidate)
      : false;
    const rulesetRecursesToCaller = callerKey !== undefined
      && isNode(candidate, N.Ruleset)
      && rulesContainCallKey(candidateRules, callerKey);

    if (inStack || blockedByFailedGuardAncestor || rulesetRecursesToCaller) {
      continue;
    }

    const identity = getCallableCandidateIdentity(candidate);
    if (seenCandidateIdentities.has(identity)) {
      continue;
    }
    seenCandidateIdentities.add(identity);

    const hasDefaultGuard = Boolean(candidate.options?.hasDefault) || guardContainsDefault(getMixinEntryGuard(candidate));
    if (hasDefaultGuard) {
      candidate.options ??= {};
      candidate.options.hasDefault = true;
      hasDefault = true;
    }
    evalCandidates.push(candidate);
  }

  if (hasDefault) {
    evalCandidates.sort(compareCallableDefaultPriority);
  }

  return { evalCandidates, hasDefault };
}
