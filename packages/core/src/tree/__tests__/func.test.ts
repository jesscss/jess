import { describe, it, expect } from 'vitest';
import { Context } from '../../context.js';
import { OutputWriter } from '../util/print.js';
import { rules, decl, any, list, vardecl, call, fn, nil, ref } from '../index.js';

class WholeBufferCountingWriter extends OutputWriter {
  wholeBufferReads = 0;

  override getSince(mark: number): string {
    if (mark === 0) {
      this.wholeBufferReads++;
    }
    return super.getSince(mark);
  }
}

describe('Func', () => {
  it('serializes function definitions through toTrimmedString()', () => {
    const node = fn({
      name: 'answer',
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

  it('captures function source syntax without outer whole-buffer readback', () => {
    const writer = new WholeBufferCountingWriter();
    const node = fn({
      name: 'answer',
      params: list([
        vardecl({ name: 'value', value: nil() }, { paramVar: true })
      ]),
      body: rules([
        decl({ name: 'return', value: ref('value') })
      ])
    });

    expect(node.toTrimmedString({ writer })).toBeString(`
      $function answer($value) {
        return: $value;
      }
    `);
    expect(writer.wholeBufferReads).toBe(1);
  });

  it('resolves function definitions without touching render state', async () => {
    const ctx = new Context();
    const node = fn({
      name: 'answer',
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
    expect(node.registrationPrepared).toBe(false);
    expect(ctx.printState.writer).toBeUndefined();
  });

  it('evaluates a stylesheet function and returns return: value', async () => {
    const ctx = new Context({ leakyRules: true });
    ctx.depth = 2;

    const tree = rules([
      fn({
        name: 'add',
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

  it('evaluates a zero-arg stylesheet function without a synthetic mixin wrapper', async () => {
    const ctx = new Context({ leakyRules: true });
    ctx.depth = 2;

    const answer = fn({
      name: 'answer',
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
