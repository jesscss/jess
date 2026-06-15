import { describe, it, expect } from 'vitest';
import { Context } from '../../context.js';
import { rules, decl, any, list, vardecl, call, fn, nil, ref, Rules as RulesClass } from '../index.js';

describe('Func', () => {
  it('serializes function definitions through toTrimmedString()', () => {
    const node = fn({
      name: any('answer'),
      body: rules([
        decl({ name: 'return', value: any('42') })
      ])
    });

    expect(node.toTrimmedString()).toBeString(`
      $function answer() {
        return: 42;
      }
    `);
  });

  it('resolves function definitions without touching render state', async () => {
    const ctx = new Context();
    const node = fn({
      name: any('answer'),
      body: rules([
        decl({ name: 'return', value: any('42') })
      ])
    });

    const resolved = await node.resolve(ctx);

    expect(resolved.toTrimmedString()).toBeString(`
      $function answer() {
        return: 42;
      }
    `);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(ctx.printState.writer).toBeUndefined();
  });

  it('evaluates a stylesheet function and returns return: value', async () => {
    const originalFindProperty = RulesClass.prototype.findProperty;
    let propertyLookups = 0;
    RulesClass.prototype.findProperty = function(...args: Parameters<typeof originalFindProperty>) {
      const [key] = args;
      if (key === 'return') {
        propertyLookups++;
      }
      return originalFindProperty.apply(this, args);
    };
    const ctx = new Context({ leakyRules: true });
    ctx.depth = 2;

    try {
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
      expect(propertyLookups).toBe(0);
    } finally {
      RulesClass.prototype.findProperty = originalFindProperty;
    }
  });

  it('evaluates a zero-arg stylesheet function without a synthetic mixin wrapper', async () => {
    const ctx = new Context({ leakyRules: true });
    ctx.depth = 2;

    const answer = fn({
      name: any('answer'),
      body: rules([
        decl({ name: 'return', value: any('42') })
      ])
    });

    const tree = rules([
      answer,
      call({ name: ref('answer', { type: 'function' }), args: list([]) })
    ]);

    const out = await tree.eval(ctx);
    expect(String(out)).toBeString(`
      42
    `);
    expect(Object.getOwnPropertyDescriptor(answer, '_options')?.value).toBeUndefined();
  });
});
