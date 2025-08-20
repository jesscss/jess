import { describe, it, expectTypeOf } from 'vitest';
import { pipe, tryStep, type MaybePromise } from '../src';

describe('pipe type inference', () => {
  it('infers step-to-step types (sync)', () => {
    const out = pipe(() => 'ok', (s: string) => s.length, (n: number) => n > 0);
    expectTypeOf(out).toBeBoolean();
  });

  it('infers with steps-only form (no explicit input)', () => {
    const out = pipe((x?: number) => (x ?? 1) + 1, (n: number) => n.toFixed(2));
    expectTypeOf(out).toBeString();
  });

  it('promotes to Promise in async tail and preserves type', () => {
    const out = pipe(() => 'a', async (s: string) => s.length, (n: number) => n * 2);
    expectTypeOf(out).toEqualTypeOf<Promise<number>>();
  });

  it('infers a type appropriately for the next step', async () => {
    await pipe(
      'a',
      (s: string) => 'ok',
      (n) => {
        expectTypeOf(n).toEqualTypeOf<string>();
      }
    );
  });

  it('treats incompatible step arg types as type errors (or forces unknown)', () => {
    // This should be a type error because step 2 returns number but step 3 expects boolean
    // @ts-expect-error incompatible next step
    pipe(() => 'a', (s: string) => 123, (b: boolean) => !b);

    // When we relax the next step arg type, it should pass
    const ok = pipe(() => 'a', (s: string) => 123, (_: unknown) => 'ok');
    expectTypeOf(ok).toBeString();
  });

  it('contextually types steps-only form correctly', () => {
    const out = pipe(() => 'x', (s) => s + '!');
    expectTypeOf(out).toBeString();
  });

  it('contextually types input-first form without explicit generics', () => {
    const out = pipe(() => Promise.resolve(1), (n) => n + 1, (n) => `${n}`);
    expectTypeOf(out).toEqualTypeOf<Promise<string>>();
  });

  it('does not wrap MaybePromise when using tryStep (async first)', () => {
    type Node = { type: string; operate?: (...args: any[]) => any };
    const step = tryStep((v: Node) => v as MaybePromise<Node>, { rethrow: true });
    const out = pipe(() => Promise.resolve({ type: 'X' } as Node), step);
    // Was previously Promise<MaybePromise<Node>>; should be Promise<Node>
    expectTypeOf(out).toEqualTypeOf<Promise<Node>>();
  });

  it('does not wrap MaybePromise when using tryStep (sync first)', () => {
    type Node = { type: string; operate?: (...args: any[]) => any };
    const step = tryStep((v: Node) => v as MaybePromise<Node>, { rethrow: true });
    const out = pipe(() => ({ type: 'Y' } as Node), step);
    // Overall type should be MaybePromise<Node>
    expectTypeOf(out).toEqualTypeOf<MaybePromise<Node>>();
  });

  it('mirrors Node.evalStatic pattern and preserves MaybePromise-like union', () => {
    type MaybePromise<T> = T | Promise<T>;
    type Node = { preEvaluated?: boolean; evaluated?: boolean };
    const context = {} as any;
    function preEval(n: Node, _c: any): MaybePromise<Node> { return n; }
    function evalNode(n: Node, _c: any): MaybePromise<Node> { return n; }

    const node: Node = {};
    const out = pipe(
      () => {
        if (!node.preEvaluated) {
          return preEval(node, context);
        }
        return node;
      },
      (returnNode) => {
        returnNode.preEvaluated = true;
        if (!returnNode.evaluated) {
          return evalNode(returnNode, context);
        }
        return returnNode;
      },
      (returnNode) => {
        returnNode.evaluated = true;
        return returnNode;
      }
    );
    expectTypeOf(out).toEqualTypeOf<MaybePromise<Node>>();
  });
});


