import { List } from '../list.js';
import { Sequence } from '../sequence.js';
import { Paren } from '../paren.js';
import { Node } from '../node.js';
import { Rules } from '../rules.js';
import { Ruleset } from '../ruleset.js';
import { Mixin } from '../mixin.js';
import { Comment } from '../comment.js';
import { Declaration } from '../declaration.js';

export type ListItems = readonly Node[];
export type EntryKey = number | string | Node;

function unwrapDirectListContainer(node: Node): List | Sequence | undefined {
  if (node instanceof List || node instanceof Sequence) {
    return node;
  }
  if (node instanceof Paren && node.value instanceof Node) {
    const inner = node.value;
    if (inner instanceof List || inner instanceof Sequence) {
      return inner;
    }
  }
  return undefined;
}

export function isListContainer(node: Node): boolean {
  return unwrapDirectListContainer(node) !== undefined;
}

export function getListItems(node: Node): ListItems | undefined {
  const container = unwrapDirectListContainer(node);
  return container?.value;
}

export function isBracketedList(node: Node): boolean {
  if (node instanceof Paren) {
    return (node.options?.delimiter ?? 'paren') === 'square' && unwrapDirectListContainer(node) !== undefined;
  }
  const parent = node.parent;
  return parent instanceof Paren
    && parent.value === node
    && (parent.options?.delimiter ?? 'paren') === 'square'
    && unwrapDirectListContainer(parent) !== undefined;
}

export function getListSeparator(node: Node): ',' | ';' | '/' | ' ' {
  const container = unwrapDirectListContainer(node);
  if (container instanceof List) {
    return container.options?.sep ?? ' ';
  }
  return ' ';
}

export function coerceListItems(node: Node): ListItems {
  if (node instanceof List && node.length === 1 && node.get('value')[0] instanceof Sequence) {
    return node.get('value')[0].value;
  }
  return getListItems(node) ?? [node];
}

export function* iterateItems(input: Node): Generator<[Node, EntryKey]> {
  const items = getListItems(input);
  if (items) {
    for (let key = 0; key < items.length; key++) {
      const value = items[key];
      if (value) {
        yield [value, key];
      }
    }
    return;
  }

  if (input instanceof Rules || input instanceof Ruleset || input instanceof Mixin) {
    const rules = input instanceof Rules
      ? input.value
      : input instanceof Ruleset
        ? input.rules?.value ?? []
        : input.rules?.value ?? [];
    for (const rule of rules) {
      if (!rule || rule instanceof Comment) {
        continue;
      }
      if (!(rule instanceof Declaration)) {
        continue;
      }
      yield [rule.value, rule.name];
    }
    return;
  }

  yield [input, 0];
}
