import { describe, it, expectTypeOf } from 'vitest';
import { pipe } from '../src';

describe('pipe type inference', () => {
  it('infers step-to-step types (sync)', () => {
    const out = pipe('ok', (s: string) => s.length, (n: number) => n > 0);
    expectTypeOf(out).toBeBoolean();
  });

  it('infers with steps-only form (no explicit input)', () => {
    const out = pipe((x?: number) => (x ?? 1) + 1, (n: number) => n.toFixed(2));
    expectTypeOf(out).toBeString();
  });

  it('promotes to Promise in async tail and preserves type', () => {
    const out = pipe('a', async (s: string) => s.length, (n: number) => n * 2);
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
    pipe('a', (s: string) => 123, (b: boolean) => !b);

    // When we relax the next step arg type, it should pass
    const ok = pipe('a', (s: string) => 123, (_: unknown) => 'ok');
    expectTypeOf(ok).toBeString();
  });

  it('contextually types steps-only form correctly', () => {
    const out = pipe(() => 'x', (s) => s + '!');
    expectTypeOf(out).toBeString();
  });
});


