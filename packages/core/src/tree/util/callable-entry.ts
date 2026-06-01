import type { Node } from '../node.js';
import type { List } from '../list.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';
import type { CallableEntry, MixinEntry, Rules } from '../rules.js';

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
