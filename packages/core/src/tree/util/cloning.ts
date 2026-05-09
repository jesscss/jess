import { F_NON_STATIC, Node } from '../node-base.js';

export function hasNodeChild(value: unknown): boolean {
  if (value instanceof Node) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(item => hasNodeChild(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some(item => hasNodeChild(item));
  }
  return false;
}

/**
 * A source-free childless node can be shared as an inert value leaf.
 * Containers still need an owned surface so eval can safely re-parent or replace
 * their children for a particular placement.
 */
export function canReuseLeaf(node: Node): boolean {
  return node.location.length === 0
    && !node.hasFlag(F_NON_STATIC)
    && !hasNodeChild(node.value);
}

export function reuseLeaf<T extends Node>(node: T): T {
  node.frozen = true;
  return node;
}

/**
 * Clone an output/eval surface while sharing inert source-free scalar leaves.
 * Unlike `copyWithReusableLeaves`, this preserves comments because mixin/import
 * output needs direct comment children at each generated placement.
 */
export function cloneWithReusableLeaves<T extends Node>(node: T): T {
  if (canReuseLeaf(node)) {
    return reuseLeaf(node);
  }
  const cloneChild = (child: Node): Node => cloneWithReusableLeaves(child);
  return node.clone(true, cloneChild);
}

function copyChild(value: unknown): unknown {
  if (value instanceof Node) {
    return copyWithReusableLeaves(value);
  }
  if (Array.isArray(value)) {
    return value.map(item => copyChild(item));
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key in value) {
      if (Object.hasOwn(value, key)) {
        out[key] = copyChild(value[key]);
      }
    }
    return out;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function nodeOptions(node: Node): unknown {
  return Object.getOwnPropertyDescriptor(node, '_options')?.value;
}

function constructCopy(node: Node, value: unknown): Node {
  const options = nodeOptions(node);
  const copy = Reflect.construct(
    node.constructor,
    [
      value,
      options && isRecord(options) ? { ...options } : undefined,
      node.location,
      node.treeContext
    ]
  );
  if (!(copy instanceof Node)) {
    throw new TypeError('Copied value must construct a Node');
  }
  return copy.inherit(node);
}

export function copyWithReusableLeaves(node: Node): Node {
  if (node.type === 'Comment') {
    const nilNode = node.nil?.();
    if (nilNode) {
      return nilNode.inherit(node);
    }
  }
  if (canReuseLeaf(node)) {
    return reuseLeaf(node);
  }
  const copy = constructCopy(node, copyChild(node.value));
  copy.frozen = true;
  return copy;
}
