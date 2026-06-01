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

export function callableRulesEntry(
  value: CallableEntryValue,
  parent?: Node,
  index?: number
): CallableRulesEntry {
  return {
    kind: 'callable-rules',
    value,
    parent,
    index
  };
}

export function isCallableEntry(entry: MixinEntry): entry is CallableEntry {
  return !isNode(entry, N.Ruleset);
}

export function getMixinEntryRules(entry: MixinEntry): Rules {
  return entry.value.rules;
}

export function getCallableEntryName(entry: CallableEntry): unknown {
  return entry.value.name;
}

export function getCallableEntryParams(entry: CallableEntry): List<Node> | undefined {
  return entry.value.params;
}

export function getCallableEntryGuard(entry: CallableEntry): Node | undefined {
  return entry.value.guard;
}
