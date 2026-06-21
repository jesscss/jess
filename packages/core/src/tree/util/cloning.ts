import { F_HAS_NODE_CHILD, F_NON_STATIC, Node } from '../node-base.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';

/**
 * A source-free childless node can be shared as an inert value leaf.
 * Containers still need an owned surface so eval can safely re-parent or replace
 * their children for a particular placement.
 */
export function canReuseLeaf(node: Node): boolean {
  return (node._location?.length ?? 0) === 0
    && !node.hasFlag(F_NON_STATIC)
    && !node.hasFlag(F_HAS_NODE_CHILD);
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

/**
 * Clones a list of output children while preserving reusable scalar leaves.
 */
export function cloneChildrenWithReusableLeaves<T extends Node>(nodes: readonly T[]): T[] {
  const out = new Array<T>(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    out[i] = cloneWithReusableLeaves(nodes[i]!);
  }
  return out;
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
    if (Array.isArray(frames)) {
      const frameCopy = new Array<unknown>(frames.length);
      for (let i = 0; i < frames.length; i++) {
        frameCopy[i] = frames[i];
      }
      (target as FrameMetadataNode).frames = frameCopy;
    } else {
      (target as FrameMetadataNode).frames = undefined;
    }
  }
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
  return node.cloneForPlacement();
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
  return node.cloneForPlacement({ stripComments: false });
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
  return node.cloneForPlacement();
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
