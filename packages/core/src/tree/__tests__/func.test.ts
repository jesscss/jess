import { describe, it, expect, vi, afterEach } from 'vitest';
import { Context } from '../../context.js';
import { rules, decl, any, list, vardecl, call, fn, nil } from '../index.js';
import { sessionPatchField } from '../util/session-helpers.js';
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
    ctx.createSession();

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

  it('evalCall reads a session-patched return declaration value', async () => {
    const ctx = new Context({ leakyRules: true });
    ctx.createSession();

    const node = fn({
      name: any('add'),
      body: rules([
        decl({ name: 'return', value: any('ok') })
      ])
    });
    const returnDecl = decl({ name: 'return', value: any('ok') });
    const evaluatedRules = rules([returnDecl]);

    vi.spyOn(rulesModule, 'getFunctionFromMixins').mockReturnValue(async () => evaluatedRules as any);
    sessionPatchField(returnDecl, 'value', any('patched'), ctx);

    const result = await node.evalCall(ctx, list([]));

    expect(result.toTrimmedString()).toBe('patched');
    expect(returnDecl.value.toTrimmedString()).toBe('ok');
  });

  it('evalCall no longer calls parent.adopt() for the temporary mixin wrapper in a session', async () => {
    const ctx = new Context({ leakyRules: true });
    ctx.createSession();

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
});
