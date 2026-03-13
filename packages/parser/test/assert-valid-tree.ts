import { isNode } from '@jesscss/core';

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function* deepValues(value: unknown): Generator<unknown> {
  if (Array.isArray(value)) {
    for (const v of value) {
      yield* deepValues(v);
    }
    return;
  }
  if (isRecord(value)) {
    for (const v of Object.values(value)) {
      yield* deepValues(v);
    }
    return;
  }
  yield value;
}

function assertNoParentCycles(node: unknown) {
  if (!isNode(node)) {
    return;
  }
  // Walk parent chain, ensure no repeats and no self-parent.
  const seen = new Set<unknown>();
  let cur: unknown = node;
  while (isNode(cur)) {
    if (seen.has(cur)) {
      throw new Error(`AST parent cycle detected at node type "${cur.type}"`);
    }
    seen.add(cur);
    if (cur.parent === cur) {
      throw new Error(`AST node self-parenting detected at type "${cur.type}"`);
    }
    cur = cur.parent;
  }
}

/**
 * Assert AST structure invariants:
 * - no self-parenting
 * - no circular parent chains
 * - all child nodes have correct `.parent`
 *
 * This is intentionally generic: it traverses `node.data` plus other own
 * enumerable fields, looking for nested Nodes within arrays/objects.
 */
export function assertValidTree(root: unknown) {
  if (!isNode(root)) {
    throw new Error('Expected a Jess Node root');
  }

  const visited = new Set<unknown>();

  const visit = (value: unknown, expectedParent: unknown | undefined) => {
    if (!isNode(value)) {
      return;
    }
    if (visited.has(value)) {
      return;
    }
    visited.add(value);

    // Basic invariants
    if (value.parent === value) {
      throw new Error(`AST node self-parenting detected at type "${value.type}"`);
    }
    assertNoParentCycles(value);

    // Parent should match the container we found it in.
    if (expectedParent && value.parent !== expectedParent) {
      const expectedType = isNode(expectedParent) ? expectedParent.type : typeof expectedParent;
      throw new Error(
        `AST parent mismatch for "${value.type}": expected parent "${expectedType}", got "${value.parent?.type ?? 'undefined'}"`
      );
    }

    // Traverse children:
    // - always include `.data` (the canonical child container for most nodes)
    // - also include other own enumerable fields (for nodes with direct child fields)
    const childRoots: unknown[] = [];
    childRoots.push(Reflect.get(value, 'data'));

    for (const key of Object.keys(value)) {
      // Avoid infinite recursion / unrelated references.
      if (
        key === 'parent'
        || key === 'sourceParent'
        || key === 'treeContext'
        || key === 'sourceNode'
      ) {
        continue;
      }
      childRoots.push((value as AnyRecord)[key]);
    }

    for (const childRoot of childRoots) {
      for (const maybeChild of deepValues(childRoot)) {
        if (isNode(maybeChild)) {
          visit(maybeChild, value);
        }
      }
    }
  };

  // Root must not have cycles either.
  assertNoParentCycles(root);
  visit(root, undefined);
}
