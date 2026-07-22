import {
  ruleset,
  sel,
  el,
  sellist,
  rules,
  vardecl,
  decl,
  any,
  ref,
  Node
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

function box(name: string, ...body: Node[]) {
  return ruleset({ selector: sellist([sel([el(name)])]), rules: body });
}

describe('nearestOuter (Jess `:=`)', () => {
  function frameValue(scope: Node, name: string): string | undefined {
    if (!isNode(scope, N.Rules)) {
      throw new Error('expected Rules scope');
    }
    const cell = scope.getScopeFrame().currentBindingsByName.get(name);
    if (!cell) {
      return undefined;
    }
    return cell.value.toString();
  }

  it('reassigns the enclosing binding cell (nested `:=` writes the outer scope)', async () => {
    // @x: red; .set { @x := blue }  — the nested `:=` rewrites the root binding.
    let node = rules([
      vardecl({ name: 'x', value: any('red') }),
      box('.set', vardecl({ name: 'x', value: any('blue') }, { nearestOuter: true }))
    ]);

    node = await node.eval(context);

    // The root binding cell is now `blue`; the nested `:=` wrote OUTWARD.
    expect(frameValue(node, 'x')).toContain('blue');
  });

  it('targets the NEAREST enclosing binding, not a farther (global) one', async () => {
    // @x: outerA; .b { @x: innerB; .c { @x := reassigned; } }
    // The `:=` in `.c` must stop at `.b`'s binding (nearest), NOT reach the root.
    let node = rules([
      vardecl({ name: 'x', value: any('outerA') }),
      box('.b',
        vardecl({ name: 'x', value: any('innerB') }),
        box('.c', vardecl({ name: 'x', value: any('reassigned') }, { nearestOuter: true })))
    ]);

    node = await node.eval(context);

    // The root/global binding is left untouched — the discriminator vs Sass
    // `!global` (setDefined), which targets the outermost binding. If `:=` had
    // walked to global, the root cell would read `reassigned`.
    expect(frameValue(node, 'x')).toBe('outerA');
    expect(frameValue(node, 'x')).not.toContain('reassigned');
  });

  it('reaches the root binding when NO intermediate scope binds the name', async () => {
    // Control for the nearest-vs-global test: with no `.b`-level binding, the
    // nearest enclosing binding IS the root, so `:=` writes it.
    let node = rules([
      vardecl({ name: 'x', value: any('outerA') }),
      box('.b',
        box('.c', vardecl({ name: 'x', value: any('reassigned') }, { nearestOuter: true })))
    ]);

    node = await node.eval(context);
    expect(frameValue(node, 'x')).toContain('reassigned');
  });

  it('reassigns an existing SAME-SCOPE binding rather than creating a shadow', async () => {
    // @x: first; @x := second; .r { color: $x } — all in one scope.
    let node = rules([
      vardecl({ name: 'x', value: any('first') }),
      vardecl({ name: 'x', value: any('second') }, { nearestOuter: true }),
      box('.r', decl({ name: 'color', value: ref('x', { type: 'variable' }) }))
    ]);

    node = await node.eval(context);
    expect(node.at(2)!.render(context)).toContain('second');
  });

  it('does NOT create a new binding in the current scope (contrast with `@x: v`)', async () => {
    // Nested `:=` writes the OUTER binding; the inner scope gains no local `x`.
    let node = rules([
      vardecl({ name: 'x', value: any('outer') }),
      rules([
        vardecl({ name: 'x', value: any('written') }, { nearestOuter: true })
      ])
    ]);
    node = await node.eval(context);

    const inner = node.at(1);
    if (!isNode(inner, N.Rules)) {
      throw new Error('expected inner Rules');
    }
    // The inner scope registers no local binding cell for `x` — only the outer
    // scope binds it. A plain `@x: v` would create a shadow here; `:=` must not.
    const innerFrame = inner.getScopeFrame();
    const innerCell = innerFrame.currentBindingsByName.get('x');
    expect(innerCell).toBeUndefined();
  });

  it('throws a located compile error when no enclosing scope binds the name', async () => {
    // `:=` is strictly a reassignment: an unbound name is a hard error, one & stop.
    const node = rules([
      box('.only', vardecl({ name: 'nope', value: any('x') }, { nearestOuter: true }))
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

  it('rejects reassigning a readonly enclosing binding', async () => {
    const node = rules([
      vardecl({ name: 'ro', value: any('locked') }, { readonly: true }),
      box('.set', vardecl({ name: 'ro', value: any('nope') }, { nearestOuter: true }))
    ]);

    let thrown: unknown;
    try {
      await node.eval(context);
    } catch (e) {
      thrown = e;
    }
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    expect(message).toContain('"ro" is readonly');
  });
});
