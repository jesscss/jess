import { describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, compound, decl, el, extend, ExtendFlag, is, rules, ruleset, sel, sellist, Node } from '../index.js';
import { copySelectorForPlacement } from '../util/selector-utils.js';

/**
 * B2 proof: after a placement copy that SHARES child selectors (frozen),
 * the SOURCE selector tree is unmutated — same objects, canonical parents,
 * no [Circular] reference.
 */
/** Read a node's raw `value` without a narrowing assertion (lint-safe). */
function nodeValue(node: Node): unknown {
  const record: { value: unknown } = node;
  return record.value;
}

/** Walk the node's value graph; throw if a cycle ([Circular]) is present. */
function assertAcyclic(node: unknown, seen = new Set<unknown>()): void {
  if (!(node instanceof Node)) {
    return;
  }
  if (seen.has(node)) {
    throw new Error('[Circular] node reference detected in source tree');
  }
  seen.add(node);
  const visit = (v: unknown): void => {
    if (v instanceof Node) {
      assertAcyclic(v, seen);
    } else if (Array.isArray(v)) {
      for (const item of v) {
        visit(item);
      }
    }
  };
  visit(nodeValue(node));
  seen.delete(node);
}

/** Read a selector node's direct child array as Nodes (test-local view). */
function childNodes(node: Node): Node[] {
  const value = nodeValue(node);
  if (!Array.isArray(value)) {
    throw new Error('expected selector value array');
  }
  return value.filter((v): v is Node => v instanceof Node);
}

describe('B2 share-without-reparent proof', () => {
  it('copySelectorForPlacement shares source children without reparenting them', () => {
    const compoundA = sel([el('.a')]);
    const compoundB = sel([el('.b')]);
    const source = sellist([compoundA, compoundB]);

    const sourceChildren = childNodes(source);
    // Sanity: canonical children are parented to the source list.
    expect(sourceChildren.map(c => c.parent)).toEqual(sourceChildren.map(() => source));

    const placed = copySelectorForPlacement(source);

    // The placement is a NEW surface node (not the source).
    expect(placed).not.toBe(source);

    const placedChildren = childNodes(placed);
    // The shared source children are the SAME objects, still canonically parented.
    for (let i = 0; i < sourceChildren.length; i++) {
      const sourceChild = sourceChildren[i]!;
      expect(sourceChild.parent).toBe(source); // NOT reparented into `placed`
      // Shared (same object) into the placement, not deep-copied.
      expect(placedChildren[i]).toBe(sourceChild);
    }

    // No [Circular]: a full structural walk must terminate (no cycle).
    expect(() => assertAcyclic(source)).not.toThrow();
  });

  it('full extend eval leaves the source child selector parent canonical (no [Circular])', async () => {
    const context = new Context();
    const child = el('.child');
    const childSelector = sel([child]);
    const childParts = childNodes(childSelector);

    const root = rules([
      ruleset({
        selector: el('.target'),
        rules: [decl({ name: 'color', value: any('red') })]
      }),
      ruleset({
        selector: sellist([sel([el('.parent')])]),
        rules: [
          ruleset({
            selector: childSelector,
            rules: [extend({ target: el('.target'), flag: ExtendFlag.All })]
          })
        ]
      })
    ]);

    await root.eval(context);

    // Source child parts unmutated: same objects, still parented to childSelector.
    for (const part of childParts) {
      expect(part.parent).toBe(childSelector);
    }
    // No circular structure in the registered extend selector.
    const registered = context.extends[0]?.[1];
    expect(registered).toBeDefined();
    expect(() => assertAcyclic(registered)).not.toThrow();
  });

  it('B3: full extend eval over a compound with a CONTAINER sibling leaves the source AST unmutated', async () => {
    // Extend a compound `:is(.x, .y).target` whose sibling part is a CONTAINER
    // (`:is(.x, .y)`, has node children) — the non-trivial placement case (a leaf
    // would `reuseAsLeaf` regardless). This guards the general extend-eval
    // source-integrity invariant that the B3 share-frozen placement helpers
    // (`copySimpleSelectorsForPlacement`/`copyComplexComponentForPlacement`) must
    // preserve: the AUTHORED source nodes below stay byte-for-byte unmutated —
    // same objects, canonical parents, no cycle — after a full extend eval.
    // (The changed helpers' exact-output correctness is pinned separately by the
    // `extend-selector-algorithm` suite, which drives them directly.)
    const context = new Context();

    const argX = el('.x');
    const argY = el('.y');
    const containerSibling = is(sellist([sel([argX]), sel([argY])]));
    const targetPart = el('.target');
    const sourceCompound = compound([containerSibling, targetPart]);
    const argList = containerSibling.arg;
    if (!(argList instanceof Node)) {
      throw new Error('expected :is() arg selector');
    }
    const argItems = childNodes(argList);

    const root = rules([
      ruleset({
        selector: sourceCompound,
        rules: [decl({ name: 'color', value: any('red') })]
      }),
      ruleset({
        selector: el('.other'),
        rules: [extend({ target: el('.target'), flag: ExtendFlag.All })]
      })
    ]);

    await root.eval(context);

    // Authored source AST unmutated: same objects, canonical parents preserved.
    expect(containerSibling.parent).toBe(sourceCompound);
    expect(targetPart.parent).toBe(sourceCompound);
    expect(argList.parent).toBe(containerSibling);
    for (const argItem of argItems) {
      expect(argItem.parent).toBe(argList);
    }
    // No cycle introduced into the authored source tree.
    expect(() => assertAcyclic(sourceCompound)).not.toThrow();
  });
});
