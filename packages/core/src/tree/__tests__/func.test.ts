import { describe, it, expect, vi, afterEach } from 'vitest';
import { Context } from '../../context.js';
import { rules, decl, any, list, vardecl, call, fn, nil, ref } from '../index.js';
import { setParent } from '../util/field-helpers.js';
import * as rulesModule from '../rules.js';

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it('does not re-parent canonical body or params when evalCall builds a temporary mixin wrapper', async () => {
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

  it('evalCall reads a cloned return declaration value', async () => {
    const ctx = new Context({ leakyRules: true });
    const node = fn({
      name: any('add'),
      body: rules([
        decl({ name: 'return', value: any('ok') })
      ])
    });
    const returnDecl = decl({ name: 'return', value: any('ok') });
    const clonedReturnDecl = returnDecl.clone();
    const patchedValue = any('patched');
    clonedReturnDecl.adopt(patchedValue, ctx);
    (clonedReturnDecl as unknown as { value: ReturnType<typeof any> }).value = patchedValue;
    const evaluatedRules = rules([clonedReturnDecl]);

    vi.spyOn(rulesModule, 'getFunctionFromMixins').mockReturnValue(async () => evaluatedRules as any);

    const result = await node.evalCall(ctx, list([]));

    expect(result.toTrimmedString()).toBe('patched');
    expect(returnDecl.get('value').toTrimmedString()).toBe('ok');
  });

  it('evalCall no longer calls parent.adopt() for the temporary mixin wrapper', async () => {
    const ctx = new Context({ leakyRules: true });
    const node = fn({
      name: any('add'),
      body: rules([
        decl({ name: 'return', value: any('ok') })
      ])
    });
    const root = rules([node]);
    ctx.root = root;

    const adoptSpy = vi.spyOn(root, 'adopt');

    const result = await node.evalCall(ctx, list([]));

    const mixinWrapperAdopts = adoptSpy.mock.calls.filter(([child]) =>
      !!child && typeof child === 'object' && 'type' in child && (child as { type?: string }).type === 'Mixin'
    );

    expect(result.toTrimmedString()).toBe('ok');
    expect(mixinWrapperAdopts).toHaveLength(0);
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
