import { beforeEach, describe, expect, it } from 'vitest';
import { rules, decl, spaced, el, ruleset, sel, any } from '../index.js';
import { Context } from '../../context.js';
import { Rules } from '../rules.js';
import { N } from '../node-type.js';
import { isNode } from '../util/is-node.js';

/**
 * Generic single-pass emit visitor hook (design §6). Locks the core-owned
 * mechanism: a registered `(node) => Node | void` fires at each resolved output
 * node's emit moment; void leaves the node unchanged, a returned Node replaces
 * it; the list is zero-cost when empty. Does not test the less-compat consumer
 * (that lives in the `less` package, registered only for real Less visitors).
 *
 * @see docs/architecture/core/UNIFIED-EVAL-EMIT-DESIGN.md §6.
 */
describe('generic emit visitor hook (P2, core internal surface)', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('is zero-cost when nothing is registered (list undefined, output unchanged)', () => {
    const root = rules([
      ruleset({ selector: sel([el('.a')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] })
    ]);
    expect(context.emitVisitors).toBeUndefined();
    const css = root.render(context) as string;
    expect(css).toContain('color: red');
    expect(context.emitVisitors).toBeUndefined(); // still no list allocated
  });

  it('fires enter on each resolved leaf; void return leaves output unchanged (inspect-only)', () => {
    const seen: string[] = [];
    context.registerEmitVisitor((node) => {
      if (isNode(node, N.Declaration)) {
        seen.push(String(node.name.valueOf()));
      }

      // void → no replacement
    });
    const root = rules([
      ruleset({ selector: sel([el('.a')]), rules: [
        decl({ name: 'color', value: spaced([el('red')]) }),
        decl({ name: 'margin', value: spaced([el('0')]) })
      ] })
    ]);
    const css = root.render(context) as string;
    expect(seen).toEqual(['color', 'margin']); // enter fired per resolved leaf
    expect(css).toContain('color: red'); // unchanged
    expect(css).toContain('margin: 0');
  });

  it('a returned Node REPLACES the emitted node (output-affecting change)', () => {
    context.registerEmitVisitor((node) => {
      if (isNode(node, N.Declaration) && String(node.name.valueOf()) === 'color') {
        // Replace the whole declaration with a fresh transient.
        return decl({ name: 'color', value: any('blue') });
      }
    });
    const root = rules([
      ruleset({ selector: sel([el('.a')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] })
    ]);
    const css = root.render(context) as string;
    expect(css).toContain('color: blue'); // replacement emitted
    expect(css).not.toContain('color: red');
  });

  it('threads multiple visitors in registration order (shape = enter(shape) ?? shape)', () => {
    const order: string[] = [];
    context.registerEmitVisitor((node) => {
      order.push('first');
      return node;
    });
    context.registerEmitVisitor(() => {
      order.push('second');
    });
    const root = rules([
      ruleset({ selector: sel([el('.a')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] })
    ]);
    root.render(context);
    expect(order).toEqual(['first', 'second']);
  });

  it('the hook does not re-introduce the eval two-walk (Rules.derive uncalled)', () => {
    context.registerEmitVisitor(() => {});
    const root = rules([
      ruleset({ selector: sel([el('.a')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] })
    ]);
    const original = Rules.prototype.derive;
    let deriveCalls = 0;
    Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
      deriveCalls++;
      return original.apply(this, args);
    } as Rules['derive'];
    try {
      const css = root.render(context) as string;
      expect(css).toContain('color: red');
      expect(deriveCalls).toBe(0);
    } finally {
      Rules.prototype.derive = original;
    }
  });
});
