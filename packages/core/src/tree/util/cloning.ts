import { F_NON_STATIC, Node } from '../node-base.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';

export function hasNodeChild(value: unknown): boolean {
  if (value instanceof Node) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(item => hasNodeChild(item));
  }
  if (isRecord(value)) {
    for (const key in value) {
      if (hasNodeChild(value[key])) {
        return true;
      }
    }
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
  const clone = node.clone(true, cloneChild);
  copyRenderMetadata(node, clone);
  return clone;
}

export function cloneChildrenWithReusableLeaves<T extends Node>(nodes: readonly T[]): T[] {
  return nodes.map(node => cloneWithReusableLeaves(node));
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
      out[key] = copyChild(value[key]);
    }
    return out;
  }
  return value;
}

function copyChildPreservingComments(value: unknown): unknown {
  if (value instanceof Node) {
    return copyWithReusableLeavesPreservingComments(value);
  }
  if (Array.isArray(value)) {
    return value.map(item => copyChildPreservingComments(item));
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key in value) {
      out[key] = copyChildPreservingComments(value[key]);
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

type FrameMetadataNode = Node & {
  frames?: unknown;
};

function hasFrameMetadata(node: Node): node is FrameMetadataNode {
  return 'frames' in node;
}

function copyRenderMetadata(source: Node, target: Node): void {
  target.hoistToRoot = source.hoistToRoot;
  if (hasFrameMetadata(source)) {
    const frames = source.frames;
    (target as FrameMetadataNode).frames = Array.isArray(frames) ? [...frames] : undefined;
  }
}

function constructCopy(node: Node, value: unknown): Node {
  const options = nodeOptions(node);
  const copy = Reflect.construct(
    node.constructor,
    [
      value,
      options && isRecord(options) ? { ...options } : undefined,
      node.location,
      node._treeContext
    ]
  );
  if (!(copy instanceof Node)) {
    throw new TypeError('Copied value must construct a Node');
  }
  copy.inherit(node);
  copyRenderMetadata(node, copy);
  return copy;
}

function deriveAmpersand(node: Node): Node | undefined {
  if (!isNode(node, N.Ampersand)) {
    return undefined;
  }
  const derived = node.derive();
  if (derived instanceof Node) {
    return derived;
  }
  return undefined;
}

export function copyWithReusableLeaves(node: Node): Node {
  if (node.type === 'Comment') {
    const nilNode = node.nil?.();
    if (nilNode) {
      return nilNode.inherit(node);
    }
  }
  const derivedAmpersand = deriveAmpersand(node);
  if (derivedAmpersand) {
    derivedAmpersand.frozen = true;
    return derivedAmpersand;
  }
  if (canReuseLeaf(node)) {
    return reuseLeaf(node);
  }
  const copy = constructCopy(node, copyChild(node.value));
  copy.frozen = true;
  return copy;
}

export function copyWithReusableLeavesPreservingComments(node: Node): Node {
  const derivedAmpersand = deriveAmpersand(node);
  if (derivedAmpersand) {
    derivedAmpersand.frozen = true;
    return derivedAmpersand;
  }
  if (canReuseLeaf(node)) {
    return reuseLeaf(node);
  }
  const copy = constructCopy(node, copyChildPreservingComments(node.value));
  copy.frozen = true;
  return copy;
}

export function copyOwnedWithReusableLeaves(node: Node): Node {
  if (node.type === 'Comment') {
    const nilNode = node.nil?.();
    if (nilNode) {
      return nilNode.inherit(node);
    }
  }
  const derivedAmpersand = deriveAmpersand(node);
  if (derivedAmpersand) {
    derivedAmpersand.frozen = true;
    return derivedAmpersand;
  }
  const copy = constructCopy(node, copyChild(node.value));
  copy.frozen = true;
  return copy;
}

/**
 * Collapsing a selector/container to a single surviving source child must not
 * inherit container metadata onto the canonical child. Own that child first;
 * evaluated replacement children may inherit directly because they are already
 * placement-local output.
 */
export function ownCollapsedSourceChild(
  node: Node,
  sourceValue: readonly unknown[],
  owner: Node
): Node {
  const owned = sourceValue.includes(node)
    ? copyOwnedWithReusableLeaves(node)
    : node;
  return owned.inherit(owner);
}
