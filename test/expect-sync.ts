import { expect } from 'vitest';
import type { Assertion } from 'vitest';

/**
 * `Node.eval()` and `Node.render()` are not `async`: they return
 * `MaybePromise<T>` and stay on a *synchronous fast path* for every input that
 * does not actually need to await something. Hundreds of assertions across the
 * tree suites depend on that, by asserting on the returned value directly:
 *
 * ```ts
 * expect(node.render(context)).toBeString('.a{color:red}');
 * ```
 *
 * Such an assertion passes *only* if a real value came back. If evaluation
 * leaves the sync fast path, a `Promise` arrives instead, and the failure
 * surfaces as an unrelated-looking matcher error (`received.trim is not a
 * function`) — or, for `.valueOf()`-style pins, does not surface at all.
 *
 * So each of those sites is an *implicit synchronous-fast-path guarantee*, and
 * nothing in the source says so. That invisibility is exactly what let a
 * mechanical `await` sweep delete the coverage while looking like a lint fix.
 *
 * `expectSync` makes the guarantee executable:
 *
 * ```ts
 * expectSync(node.render(context)).toBeString('.a{color:red}');
 * ```
 *
 * It throws with a message that names the real failure when handed a thenable,
 * and otherwise delegates to `expect`, so every matcher — including `.not`, the
 * repo's custom matchers (`toBeString`, `toMatchCss`, `toContainString`) and
 * `.toThrow` — chains unchanged.
 *
 * NEVER "fix" a failure from this helper by adding `await`. A Promise here is
 * the regression the assertion exists to catch.
 */

/**
 * Structural thenable detection.
 *
 * This is deliberately kept byte-for-byte equivalent to `isThenable` in
 * `@jesscss/awaitable-pipe/src/utils.ts` — the predicate `node-base.ts` itself
 * uses to decide sync-vs-async — rather than imported from it. Importing it
 * resolves under vitest (workspace alias to `src`) but NOT under `tsc`: root
 * `tsconfig.json` has no path mapping for the package, so the helper would
 * typecheck only when `packages/awaitable-pipe/lib` happens to be built. Root
 * `test/` currently depends on nothing but `vitest`, and keeping it that way
 * means this guard works in any worktree with no build step. If the upstream
 * predicate changes, change this one.
 *
 * `instanceof Promise` is NOT used: a `MaybePromise` may carry a subclass, a
 * cross-realm promise, or a hand-rolled `{ then() {} }`, and missing those is
 * exactly the failure mode this helper exists to catch.
 */
function isThenableValue(value: unknown): value is PromiseLike<unknown> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }
  return 'then' in value && typeof value.then === 'function';
}

/** Best-effort label for the thenable, used only in the failure message. */
function describeThenable(value: PromiseLike<unknown>): string {
  if (value instanceof Promise) {
    return 'a Promise';
  }
  const name = value.constructor?.name;
  return name && name !== 'Object' ? `a thenable (${name})` : 'a thenable';
}

/**
 * Asserts that `value` is not a thenable, then delegates to `expect`.
 *
 * Use in place of `expect` wherever the assertion is pinning the synchronous
 * fast path of `eval()` / `render()` — i.e. wherever the argument's static type
 * is `MaybePromise<...>` and the assertion is not awaited.
 *
 * @param value - the (supposedly synchronous) result of a `MaybePromise` call
 * @param message - optional message, forwarded to `expect`
 * @returns the `expect` assertion for `value`, with the promise branch removed
 * @throws if `value` is a thenable — meaning the sync fast path regressed
 */
export function expectSync<T>(value: T | PromiseLike<T>, message?: string): Assertion<T> {
  if (isThenableValue(value)) {
    throw new Error(
      `expectSync: expected a synchronous value, got ${describeThenable(value)} — `
      + 'evaluation left the synchronous fast path. This assertion pins the sync '
      + 'fast path of eval()/render(); a Promise here is a real regression. '
      + 'Do NOT silence it by adding `await` — that deletes the coverage.'
    );
  }
  return expect(value, message);
}
