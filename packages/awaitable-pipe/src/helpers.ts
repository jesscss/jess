import type { MaybePromise } from './utils';
import { isThenable } from './utils';
export { serialForEach, serialReduce } from './utils';

export type StepErrorOptions<TIn, R> = {
  onError?: (error: unknown, input: TIn) => void;
  fallback?: R | ((error: unknown, input: TIn) => R);
  rethrow?: boolean;
};

// Overload: when rethrow is true, output excludes undefined
export function tryStep<TIn, R>(
  fn: (input: TIn) => MaybePromise<R>,
  options: StepErrorOptions<TIn, R> & { rethrow: true }
): (input: TIn) => MaybePromise<R>;
// Default overload: may return undefined on error
export function tryStep<TIn, R>(
  fn: (input: TIn) => MaybePromise<R>,
  options?: StepErrorOptions<TIn, R | undefined>
): (input: TIn) => MaybePromise<R | undefined>;
export function tryStep<TIn, R>(
  fn: (input: TIn) => MaybePromise<R>,
  options: StepErrorOptions<TIn, R | undefined> = {}
): (input: TIn) => MaybePromise<R | undefined> {
  return (input: TIn) => {
    try {
      const out = fn(input);
      if (isThenable(out)) {
        return out.catch((e: unknown) => {
          try { options.onError?.(e, input); } catch { /* swallow */ }
          if (options.rethrow) {
            return Promise.reject(e);
          }
          const fb = options.fallback;
          return typeof fb === 'function' ? (fb as (e: unknown, i: TIn) => R)(e, input) : fb;
        });
      }
      return out;
    } catch (e) {
      try { options.onError?.(e, input); } catch { /* swallow */ }
      if (options.rethrow) {
        throw e;
      }
      const fb = options.fallback;
      return typeof fb === 'function' ? (fb as (e: unknown, i: TIn) => R)(e, input) : fb;
    }
  };
}

export function guard<T>(
  predicate: (value: T) => MaybePromise<boolean>,
  errorFactory: (value: T) => unknown = (v) => new Error('ensure failed')
): (value: T) => MaybePromise<T> {
  return (value: T) => {
    const ok = predicate(value);
    if (isThenable(ok)) {
      return ok.then(passed => {
        if (!passed) {
          throw errorFactory(value);
        }
        return value;
      });
    }
    if (!ok) {
      throw errorFactory(value);
    }
    return value;
  };
}


