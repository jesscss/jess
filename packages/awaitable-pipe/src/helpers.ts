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
// Overload: function with no input (for first step in pipe)
export function tryStep<R>(
  fn: () => MaybePromise<R>,
  options: StepErrorOptions<undefined, R> & { rethrow: true }
): () => MaybePromise<R>;
// Overload: function with no input, may return undefined
export function tryStep<R>(
  fn: () => MaybePromise<R>,
  options?: StepErrorOptions<undefined, R | undefined>
): () => MaybePromise<R | undefined>;
// Default overload: may return undefined on error
export function tryStep<TIn, R>(
  fn: (input: TIn) => MaybePromise<R>,
  options?: StepErrorOptions<TIn, R | undefined>
): (input: TIn) => MaybePromise<R | undefined>;
export function tryStep<TIn, R>(
  fn: ((input: TIn) => MaybePromise<R>) | (() => MaybePromise<R>),
  options: StepErrorOptions<TIn | undefined, R | undefined> = {}
): ((input: TIn) => MaybePromise<R | undefined>) | (() => MaybePromise<R | undefined>) {
  // Check if fn takes no arguments (for first step)
  if (fn.length === 0) {
    const noInputFn = fn as () => MaybePromise<R>;
    return () => {
      try {
        const out = noInputFn();
        if (isThenable(out)) {
          return out.catch((e: unknown) => {
            try {
              options.onError?.(e, undefined);
            } catch (onErrorThrown) {
              return Promise.reject(onErrorThrown);
            }
            if (options.rethrow === true) {
              return Promise.reject(e);
            }
            const fb = options.fallback;
            return typeof fb === 'function' ? (fb as (e: unknown, i: undefined) => R)(e, undefined) : fb;
          });
        }
        return out;
      } catch (e) {
        try {
          options.onError?.(e, undefined);
        } catch (onErrorThrown) {
          throw onErrorThrown;
        }
        if (options.rethrow === true) {
          throw e;
        }
        const fb = options.fallback;
        return typeof fb === 'function' ? (fb as (e: unknown, i: undefined) => R)(e, undefined) : fb;
      }
    };
  }
  // Original implementation for functions that take input
  const inputFn = fn as (input: TIn) => MaybePromise<R>;
  return (input: TIn) => {
    try {
      const out = fn(input);
      if (isThenable(out)) {
        return out.catch((e: unknown) => {
          try {
            options.onError?.(e, input);
          } catch (onErrorThrown) {
            // If onError throws, rethrow the error that onError threw
            return Promise.reject(onErrorThrown);
          }
          if (options.rethrow === true) {
            return Promise.reject(e);
          }
          const fb = options.fallback;
          return typeof fb === 'function' ? (fb as (e: unknown, i: TIn) => R)(e, input) : fb;
        });
      }
      return out;
    } catch (e) {
      try {
        options.onError?.(e, input);
      } catch (onErrorThrown) {
        // If onError throws, rethrow the error that onError threw
        throw onErrorThrown;
      }
      if (options.rethrow === true) {
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


