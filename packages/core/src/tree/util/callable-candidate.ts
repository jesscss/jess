import type { Node } from '../node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
import { isNode } from './is-node.js';
import type { Rules } from '../rules.js';
import { type MixinEntry, getMixinEntryRules } from './callable-entry.js';
import { getRootSourceRules } from './callable-surface.js';

export type CallableEvalCandidatePreparation = {
  evalCandidates: MixinEntry[];
  hasDefault: boolean;
};

type CallableEvalCandidatePreparationOptions = {
  mixinCandidates: MixinEntry[];
  rulesEvalStack: readonly Node[];
  caller?: Node;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function hasFailedGuardAncestor(node: Node): boolean {
  let current = node.parent;
  while (current) {
    if (isNode(current, N.Ruleset)) {
      const guardNode = current.guard;
      if (guardNode instanceof Nil) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

function getCallableCandidateIdentity(candidate: MixinEntry): unknown {
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
    let key = '';
    for (let i = 0; i < value.length; i++) {
      key += stringifyCallableKey(value[i]);
    }
    return key;
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
  const name = node.name;
  if (typeof name === 'string') {
    return name;
  }
  if (isNode(name, N.Reference)) {
    return stringifyCallableKey(name.key);
  }
  return String(name.valueOf());
}

function valueContainsCallKey(value: unknown, key: string): boolean {
  if (isNode(value)) {
    return nodeContainsCallKey(value, key);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (valueContainsCallKey(value[i], key)) {
        return true;
      }
    }
    return false;
  }
  if (isRecord(value)) {
    for (const property in value) {
      if (valueContainsCallKey(value[property], key)) {
        return true;
      }
    }
  }
  return false;
}

function nodeContainsCallKey(node: Node, key: string): boolean {
  return getCallKey(node) === key
    || valueContainsCallKey((node as { value?: unknown }).value, key);
}

function rulesContainCallKey(rules: Rules, key: string): boolean {
  const value = rules.rules;
  for (let i = 0; i < value.length; i++) {
    if (nodeContainsCallKey(value[i]!, key)) {
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
  const seenCandidateIdentities = new Set<unknown>();
  const evalCandidates: MixinEntry[] = [];
  let hasDefault = false;

  for (let i = 0; i < mixinCandidates.length; i++) {
    const candidate = mixinCandidates[i]!;
    const candidateRules = getMixinEntryRules(candidate);
    const sourceRules = candidateRules.sourceNode;
    let inStack = false;
    for (let j = 0; j < rulesEvalStack.length; j++) {
      if (rulesEvalStack[j] === sourceRules) {
        inStack = true;
        break;
      }
    }
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

    if (candidate.options?.hasDefault === true) {
      hasDefault = true;
    }
    evalCandidates.push(candidate);
  }

  if (hasDefault) {
    evalCandidates.sort(compareCallableDefaultPriority);
  }

  return { evalCandidates, hasDefault };
}
