import { describe, it, expect } from 'vitest';
import { expectSync } from './expect-sync.js';

type MaybePromise<T> = T | Promise<T>;

/** A thenable that is not a `Promise` and is not `instanceof Promise`. */
class HandRolled<T> {
  constructor(private readonly value: T) {}
  then(onFulfilled: (value: T) => void): void {
    onFulfilled(this.value);
  }
}

/**
 * A thenable with an OWN `then` property. `HandRolled` above covers the
 * inherited case (class methods live on the prototype), so between them both
 * lookup paths are exercised.
 *
 * Note both are deliberately NOT assignable to `PromiseLike` — their `then`
 * signatures do not match it. That is the point: TypeScript does not consider
 * them promises, so only a structural runtime check catches them.
 */
interface LooseThenable {
  then: (onFulfilled: (value: string) => void) => void;
}

const ownThenable: LooseThenable = {
  then(onFulfilled) {
    onFulfilled('blue');
  }
};

/** Runs `run` and returns the message it threw, or `''` if it did not throw. */
function messageFrom(run: () => unknown): string {
  try {
    run();
    return '';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

describe('expectSync', () => {
  it('passes a synchronous value through to expect', () => {
    expectSync('blue').toBe('blue');
    expectSync(42).toBeGreaterThan(41);
    expectSync(null).toBeNull();
    expectSync(undefined).toBeUndefined();
  });

  it('chains the repo custom matchers', () => {
    expectSync('.test {\n  color: red;\n}').toBeString(`
      .test {
        color: red;
      }`);
    expectSync('.a { color: red }').toMatchCss('.a { color:red; }');
    expectSync('a\nb\nc').toContainString('b');
  });

  it('chains .not', () => {
    expectSync('blue').not.toBe('red');
    expectSync('.a{color:red}').not.toMatchCss('.a { color: blue; }');
  });

  it('chains .toThrow', () => {
    expectSync(() => {
      throw new Error('boom');
    }).toThrow('boom');
    expectSync(() => 'fine').not.toThrow();
  });

  it('returns the assertion object, so arbitrary chains keep working', () => {
    const assertion = expectSync('blue');

    expect(typeof assertion.toBe).toBe('function');
    expect(typeof assertion.toBeString).toBe('function');
    expect(typeof assertion.not.toBe).toBe('function');
    expect(typeof assertion.toMatchCss).toBe('function');
    expect(typeof assertion.toContainString).toBe('function');
  });

  it('accepts a MaybePromise-typed value that is synchronous', () => {
    const sync: MaybePromise<string> = 'blue';

    /*
     * Type-level pin: the promise branch is stripped, so `.toBe` sees `string`
     * and the assertion surface is unchanged. If this ever widens back to
     * `string | Promise<string>` the custom string matchers stop typechecking.
     */
    const assertion: ReturnType<typeof expectSync<string>> = expectSync(sync);
    assertion.toBe('blue');
  });

  describe('fires on a thenable', () => {
    const expectedMessage =
      /expectSync: expected a synchronous value, got .* — evaluation left the synchronous fast path/;

    it('throws on a native Promise, naming it a Promise', () => {
      expect(() => expectSync(Promise.resolve('blue'))).toThrow(expectedMessage);
      expect(() => expectSync(Promise.resolve('blue'))).toThrow(
        /got a Promise —/
      );
    });

    it('throws on a hand-rolled thenable that is not instanceof Promise', () => {
      const thenable = new HandRolled('blue');

      expect(thenable).not.toBeInstanceOf(Promise);
      expect(() => expectSync<HandRolled<string>>(thenable)).toThrow(expectedMessage);
      expect(() => expectSync<HandRolled<string>>(thenable)).toThrow(
        /got a thenable \(HandRolled\) —/
      );
    });

    it('throws on a plain object with an own `then`', () => {
      expect(ownThenable).not.toBeInstanceOf(Promise);
      expect(() => expectSync<LooseThenable>(ownThenable)).toThrow(expectedMessage);
    });

    it('tells the reader not to add `await`', () => {
      expect(() => expectSync(Promise.resolve('blue'))).toThrow(
        /Do NOT silence it by adding `await`/
      );
    });
  });

  describe('does not fire on non-thenables that merely look close', () => {
    it('ignores a `then` that is not callable', () => {
      expectSync({ then: 'later' }).toEqual({ then: 'later' });
    });

    it('ignores a plain function', () => {
      const fn = (): string => 'blue';
      expectSync(fn).toBeTypeOf('function');
    });

    it('ignores null and primitives', () => {
      expectSync(null).toBeNull();
      expectSync('then').toBe('then');
      expectSync(0).toBe(0);
    });
  });

  /*
   * The guard has to be watched firing, not assumed to fire. These two pin the
   * exact difference that motivated the helper: a value pin written with plain
   * `expect` either reports a confusing downstream matcher error or silently
   * passes, where `expectSync` reports the real cause.
   */
  describe('bites where plain expect does not', () => {
    it('plain expect SILENTLY PASSES a .not pin that a Promise makes vacuous', () => {
      const regressed: MaybePromise<string> = Promise.resolve('red');

      // This is green today. It asserts nothing: a Promise is never 'red'.
      expect(regressed).not.toBe('red');

      // expectSync reports the actual failure.
      expect(() => expectSync(regressed).not.toBe('red')).toThrow(
        /expected a synchronous value, got a Promise/
      );
    });

    it('plain expect reports a confusing matcher error where expectSync names the cause', () => {
      const regressed: MaybePromise<string> = Promise.resolve('.a{color:red}');

      const plain = messageFrom(() => expect(regressed).toBeString('.a{color:red}'));
      const guarded = messageFrom(() => expectSync(regressed).toBeString('.a{color:red}'));

      // Plain expect blames `.trim` — nothing about async.
      expect(plain).toMatch(/trim is not a function/);
      expect(plain).not.toMatch(/synchronous/);

      // expectSync blames the sync fast path.
      expect(guarded).toMatch(/expected a synchronous value, got a Promise/);
    });
  });
});
