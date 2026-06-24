import { List } from '../list.js';
import { Sequence } from '../sequence.js';
import { Block } from '../block.js';
import { Node } from '../node.js';

export type ListItems = readonly Node[];

function isParenLike(node: Node): boolean {
  return node.type === 'Paren';
}

function unwrapListContainer(node: Node): List | Sequence | undefined {
  if (node instanceof List || node instanceof Sequence) {
    return node;
  }
  if (isParenLike(node) && node.value instanceof Node) {
    const inner = node.value;
    if (inner instanceof List || inner instanceof Sequence) {
      return inner;
    }
  }
  if (node instanceof Block && node.value instanceof Node) {
    const inner = node.value;
    if (inner instanceof List || inner instanceof Sequence) {
      return inner;
    }
  }
  return undefined;
}

export function getListItems(node: Node): ListItems | undefined {
  const container = unwrapListContainer(node);
  if (!container) {
    return undefined;
  }
  return container.value;
}

export function isBracketedList(node: Node): boolean {
  if (isParenLike(node)) {
    return node.options?.delimiter === 'square' && unwrapListContainer(node) !== undefined;
  }
  if (node instanceof Block) {
    return node.options?.type === 'square' && unwrapListContainer(node) !== undefined;
  }
  const { parent } = node;
  if ((parent instanceof Block ? parent.value : parent?.value) !== node) {
    return false;
  }
  if (isParenLike(parent)) {
    return parent.options?.delimiter === 'square' && unwrapListContainer(parent) !== undefined;
  }
  return parent instanceof Block
    && parent.options?.type === 'square'
    && unwrapListContainer(parent) !== undefined;
}

export function getListSeparator(node: Node): ',' | ';' | '/' | ' ' {
  const container = unwrapListContainer(node);
  if (container instanceof List) {
    return container.options?.sep ?? ' ';
  }
  return ' ';
}

export function coerceListItems(node: Node): ListItems {
  if (node instanceof List && node.length === 1 && node.value[0] instanceof Sequence) {
    return node.value[0].value;
  }
  return getListItems(node) ?? [node];
}
