import { describe, it, expect } from 'vitest';
import { Context } from '../../context.js';
import { rules, decl, any, list, vardecl, call, fn, nil, ref } from '../index.js';
import { setParent } from '../util/field-helpers.js';

describe('Func', () => {
  it('evalCall returns the looked-up return declaration value', async () => {
    const ctx = new Context({ leakyRules: true });
    ctx.depth = 2;

    const node = fn({
      name: any('add'),
      params: list([
        vardecl({ name: 'a', value: nil() }),
        vardecl({ name: 'b', value: nil() })
      ]),
      body: rules([
        decl({ name: 'return', value: any('ok') })
      ])
    });
    const root = rules([node]);
    ctx.root = root;

    const result = await node.evalCall(ctx, list([any('x'), any('y')]));

    expect(result.toTrimmedString()).toBe('ok');
  });

  it('evaluates a stylesheet function and returns return: value', async () => {
    const ctx = new Context({ leakyRules: true });
    ctx.depth = 2;

    const tree = rules([
      fn({
        name: any('add'),
        params: list([
          vardecl({ name: 'a', value: nil() }),
          vardecl({ name: 'b', value: nil() })
        ]),
        body: rules([
          decl({ name: 'return', value: any('ok') })
        ])
      }),
      // Call using plain string name should resolve through function registry
      call({ name: 'add', args: list([any('x'), any('y')]) })
    ]);

    // Evaluate root rules; the call should reduce to the return value node
    const out = await tree.eval(ctx);
    expect(String(out)).toBeString(`
      add(x, y);
    `);
  });

  it('does not re-parent canonical body or params when evalCall builds a scoped invocation view', async () => {
    const ctx = new Context({ leakyRules: true });
    const params = list([
      vardecl({ name: 'a', value: nil() }),
      vardecl({ name: 'b', value: nil() })
    ]);
    const body = rules([
      decl({ name: 'return', value: any('ok') })
    ]);
    const node = fn({
      name: any('add'),
      params,
      body
    });
    const root = rules([node]);
    ctx.root = root;

    expect(params.parent).toBe(node);
    expect(body.parent).toBe(node);

    const result = await node.evalCall(ctx, list([any('x'), any('y')]));

    expect(result.toTrimmedString()).toBe('ok');
    expect(params.parent).toBe(node);
    expect(body.parent).toBe(node);
  });

  it('evalCall resolves bound params through the invocation scope without mutating the canonical body', async () => {
    const ctx = new Context({ leakyRules: true });
    const returnDecl = decl({ name: 'return', value: ref({ key: 'a' }, { type: 'variable' }) });
    const node = fn({
      name: any('add'),
      params: list([
        vardecl({ name: 'a', value: any('default') })
      ]),
      body: rules([
        returnDecl
      ])
    });
    const result = await node.evalCall(ctx, list([any('patched')]));

    expect(result.toTrimmedString()).toBe('patched');
    expect(returnDecl.get('value').toTrimmedString()).toBe('$a');
  });

  it('evalCall does not need a temporary mixin wrapper to preserve canonical parents', async () => {
    const ctx = new Context({ leakyRules: true });
    const params = list([
      vardecl({ name: 'a', value: any('default') })
    ]);
    const body = rules([
      decl({ name: 'return', value: ref({ key: 'a' }, { type: 'variable' }) })
    ]);
    const node = fn({
      name: any('add'),
      params,
      body
    });
    const root = rules([node]);
    ctx.root = root;

    const result = await node.evalCall(ctx, list([]));

    expect(result.toTrimmedString()).toBe('default');
    expect(params.parent).toBe(node);
    expect(body.parent).toBe(node);
  });

  it('Reference(type=function) honors a cloned function name on the lookup path', async () => {
    const ctx = new Context({ leakyRules: true });
    const tree = rules([
      fn({
        name: any('add'),
        body: rules([
          decl({ name: 'return', value: any('ok') })
        ])
      }),
      call({ name: ref('renamed', { type: 'function' }), args: list([]) })
    ]);
    const clonedTree = tree.clone(true);
    const functionNode = clonedTree.at(0, ctx) as ReturnType<typeof fn>;
    const callNode = clonedTree.at(1, ctx) as ReturnType<typeof call>;
    const patchedName = any('renamed');
    functionNode.adopt(patchedName, ctx);
    (functionNode as unknown as { name: ReturnType<typeof any> }).name = patchedName;
    ctx.root = clonedTree;

    const result = await callNode.eval(ctx);

    expect(result.toTrimmedString()).toBe('ok');
    expect(functionNode.toTrimmedString({ context: ctx })).toContain('$function renamed()');
    expect((tree.at(0, new Context()) as ReturnType<typeof fn>).toTrimmedString()).toContain('$function add()');
  });

  it('Reference(type=function) uses the state parent chain when the caller Rules is only state-parented', async () => {
    const ctx = new Context({ leakyRules: true });
    const outer = rules([
      fn({
        name: any('add'),
        body: rules([
          decl({ name: 'return', value: any('ok') })
        ])
      })
    ]);
    const inner = rules([
      call({ name: ref('add', { type: 'function' }), args: list([]) })
    ]);

    ctx.root = outer;
    ctx.rulesContext = inner;
    setParent(inner, outer, ctx);

    const result = await inner.at(0, ctx)!.eval(ctx);

    expect(result.toTrimmedString()).toBe('ok');
  });
});
