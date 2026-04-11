import { describe, it, expect } from 'vitest';
import { Context } from '../../context.js';
import { rules, decl, any, list, vardecl, call, fn, nil, ref } from '../index.js';

describe('Func', () => {
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
      call({ name: ref('add', { type: 'function' }), args: list([any('x'), any('y')]) })
    ]);

    const out = await tree.eval(ctx);
    expect(String(out)).toBeString(`
      ok
    `);
  });
});
