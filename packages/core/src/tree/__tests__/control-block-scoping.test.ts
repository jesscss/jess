/**
 * Block-scoping semantics for Jess control-flow blocks (`$if` / `$else` /
 * `$for` / `$while`).
 *
 * Decided spec (2026): every `$…{ }` block opens a CHILD variable frame.
 *  - `:`  (default)      → declare in the block's own frame; may shadow an outer
 *                          binding, but must NOT leak to the enclosing scope.
 *  - `:=` (nearestOuter) → reassign the nearest EXISTING binding up the chain;
 *                          an unbound name is a hard compile error.
 *
 * These assert the property THROUGH the control-flow nodes specifically —
 * `nearest-outer.test.ts` covers `:=` through plain nested `rules([])` scopes,
 * but not the `:` block-locality of `$if`/`$for`/`$while` bodies.
 */
import {
  rules, vardecl, decl, any, ref, bool, num, list,
  If, For, While, Rules, Node
} from '../index.js';
import { Context } from '../../context.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';
import { JessError } from '../../jess-error.js';

let context: Context;
beforeEach(() => {
  context = new Context();
  context.id = 'testing';
});

function frameValue(scope: Node, name: string): string | undefined {
  if (!isNode(scope, N.Rules)) {
    throw new Error('expected Rules scope');
  }
  const cell = scope.getScopeFrame().currentBindingsByName.get(name);
  if (!cell) {
    return undefined;
  }
  return (cell.value as { toString(): string } | undefined)?.toString();
}

function singleBinding(name: string) {
  return { kind: 'single' as const, value: vardecl({ name, value: any('') }, { paramVar: true }) };
}

describe('control-flow block scoping', () => {
  it('$if `:` declaration is block-local (does not leak to the enclosing scope)', async () => {
    let node = rules([
      vardecl({ name: 'x', value: any('outer') }),
      new If({
        condition: bool(true),
        rules: [vardecl({ name: 'x', value: any('inner') })]
      })
    ]);
    node = await node.eval(context);

    /*
     * The `:` decl declared in the $if's own frame and shadowed there; the
     * enclosing binding is untouched.
     */
    expect(frameValue(node, 'x')).toBe('outer');
  });

  it('$if / $else branch-local temps do not leak', async () => {
    let node = rules([
      vardecl({ name: 'x', value: any('outer') }),
      new If({
        condition: bool(false),
        rules: [vardecl({ name: 'x', value: any('then') })],
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test-only Rules else branch
        else: rules([vardecl({ name: 'x', value: any('elsebody') })]) as unknown as Rules
      })
    ]);
    node = await node.eval(context);
    expect(frameValue(node, 'x')).toBe('outer');
  });

  it('$for `:` declaration is block-local (outer var unchanged after the loop)', async () => {
    let node = rules([
      vardecl({ name: 'x', value: any('outer') }),
      new For({
        pattern: singleBinding('i'),
        iterable: { kind: 'node', value: list([any('a'), any('b'), any('c')]) },
        rules: [vardecl({ name: 'x', value: ref('i', { type: 'variable' }) })]
      })
    ]);
    node = await node.eval(context);
    expect(frameValue(node, 'x')).toBe('outer');
  });

  it('$while `:` declaration is block-local (outer var unchanged)', async () => {
    let node = rules([
      vardecl({ name: 'x', value: any('outer') }),
      new While({
        condition: bool(false),
        rules: [vardecl({ name: 'x', value: any('whilebody') })]
      })
    ]);
    node = await node.eval(context);
    expect(frameValue(node, 'x')).toBe('outer');
  });

  it('$for `:=` reassigns the enclosing binding across iterations', async () => {
    /*
     * `:=` targets the nearest existing binding (the root `total`); each
     * iteration writes it, so after the loop the root reads the last value.
     */
    let node = rules([
      vardecl({ name: 'total', value: num(0) }),
      new For({
        pattern: singleBinding('i'),
        iterable: { kind: 'node', value: list([num(1), num(2), num(3)]) },
        rules: [vardecl({ name: 'total', value: ref('i', { type: 'variable' }) }, { nearestOuter: true })]
      })
    ]);
    node = await node.eval(context);
    expect(frameValue(node, 'total')).toBe('3');
  });

  it('$for `:=` with no existing binding is a hard compile error', async () => {
    const node = rules([
      new For({
        pattern: singleBinding('i'),
        iterable: { kind: 'node', value: list([num(1)]) },
        rules: [vardecl({ name: 'nope', value: num(1) }, { nearestOuter: true })]
      })
    ]);
    let thrown: unknown;
    try {
      await node.eval(context);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(JessError);
    expect(thrown).toMatchObject({ code: 'resolve/name-not-found', phase: 'resolve' });
  });
});
