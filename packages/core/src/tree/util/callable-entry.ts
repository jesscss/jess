import type { Node } from '../node.js';
import type { List } from '../list.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';
import type { Mixin } from '../mixin.js';
import type { Ruleset } from '../ruleset.js';
import type { Rules } from '../rules.js';

type CallableEntryValue = {
  name?: unknown;
  params?: List<Node>;
  rules: Rules;
  guard?: Node;
};

export type CallableRulesEntry = {
  kind: 'callable-rules';
  value: CallableEntryValue;
  parent?: Node;
  options?: { hasDefault?: boolean };
  index?: number;
};

export type CallableEntry = Mixin | CallableRulesEntry;
export type MixinEntry = CallableEntry | Ruleset;
export type CallableLookupEntry = {
  value: MixinEntry;
  match: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function callableGuardContainsDefault(node: Node | undefined, seen?: Set<Node>): boolean {
  if (!node) {
    return false;
  }
  if (seen?.has(node)) {
    return false;
  }
  (seen ??= new Set()).add(node);
  if (node.type === 'DefaultGuard') {
    return true;
  }
  if (isNode(node, N.Call)) {
    const name = node.name;
    const callName = String(typeof name === 'string' ? name : name.valueOf());
    if (callName === 'default') {
      return true;
    }
  }
  const value = node.value;
  if (isNode(value)) {
    return callableGuardContainsDefault(value, seen);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (isNode(item) && callableGuardContainsDefault(item, seen)) {
        return true;
      }
    }
    return false;
  }
  if (isRecord(value)) {
    for (const key in value) {
      const item = value[key];
      if (isNode(item) && callableGuardContainsDefault(item, seen)) {
        return true;
      }
      if (Array.isArray(item)) {
        for (let i = 0; i < item.length; i++) {
          const child = item[i];
          if (isNode(child) && callableGuardContainsDefault(child, seen)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

export function callableRulesEntry(
  value: CallableEntryValue,
  parent?: Node,
  index?: number
): CallableRulesEntry {
  const hasDefault = callableGuardContainsDefault(value.guard);
  return {
    kind: 'callable-rules',
    value,
    parent,
    index,
    ...(hasDefault && { options: { hasDefault: true } })
  };
}

export function isCallableEntry(entry: MixinEntry): entry is CallableEntry {
  return !isNode(entry, N.Ruleset);
}

export function getMixinEntryRules(entry: MixinEntry): Rules {
  if (isNode(entry, N.Mixin)) {
    return entry;
  }
  if (isNode(entry, N.Ruleset)) {
    return entry;
  }
  return entry.value.rules;
}

export function getCallableEntryName(entry: CallableEntry): unknown {
  return isNode(entry, N.Mixin)
    ? entry.name
    : entry.value.name;
}

export function getCallableEntryParams(entry: CallableEntry): List<Node> | undefined {
  return isNode(entry, N.Mixin)
    ? entry.params
    : entry.value.params;
}

export function getCallableEntryGuard(entry: CallableEntry): Node | undefined {
  return isNode(entry, N.Mixin)
    ? entry.guard
    : entry.value.guard;
}
