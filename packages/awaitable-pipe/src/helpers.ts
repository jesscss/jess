import type { MaybePromise } from './utils.js';
import { isThenable } from './utils.js';
export { serialForEach, serialReduce } from './utils.js';

export type StepErrorOptions<TIn, R> = {
  onError?: (error: unknown, input: TIn) => void;
  fallback?: R | ((error: unknown, input: TIn) => R);
  rethrow?: boolean;
};

// Type guard to help TypeScript narrow no-arg functions
function isNoArgFunction<TIn, R>(
  fn: ((input: TIn) => MaybePromise<R>) | (() => MaybePromise<R>)
): fn is () => MaybePromise<R> {
  return fn.length === 0;
}

// Overload: when rethrow is true, output excludes undefined
export function tryStep<TIn, R>(
  fn: (input: TIn) => MaybePromise<R>,
  options: StepErrorOptions<TIn, R> & { rethrow: true }
): (input: TIn) => MaybePromise<R>;
// Overload: function with no input (for first step in pipe) with rethrow: true
// Return type is () => MaybePromise<R> to match pipe's first overload
export function tryStep<R>(
  fn: () => MaybePromise<R>,
  options: StepErrorOptions<undefined, R> & { rethrow: true }
): () => MaybePromise<R>;
// Overload: function with no input (for first step in pipe), may return undefined
// Return type is () => MaybePromise<R | undefined> to match pipe's first overload
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
): ((input: TIn) => MaybePromise<R | undefined>) | ((input?: unknown) => MaybePromise<R | undefined>) {
  // Check if fn takes no arguments (for first step)
  if (isNoArgFunction(fn)) {
    const noInputFn = fn; // Type guard narrows this to () => MaybePromise<R>
    // Even though the function takes no args, the wrapper should accept input for pipe chaining
    // and pass it to fallback/onError
    const resultFn = (input?: TIn) => {
      try {
        const out = noInputFn();
        if (isThenable(out)) {
          return out.catch((e: unknown) => {
            try {
              options.onError?.(e, input);
            } catch (onErrorThrown) {
              // Swallow onError errors and continue to fallback
            }
            if (options.rethrow === true) {
              return Promise.reject(e);
            }
            const fb = options.fallback;

            return typeof fb === 'function' ? (fb as (e: unknown, i: TIn | undefined) => R)(e, input) : fb;
          });
        }
        return out;
      } catch (e) {
        try {
          options.onError?.(e, input);
        } catch (onErrorThrown) {
          // Swallow onError errors and continue to fallback
        }
        if (options.rethrow === true) {
          throw e;
        }
        const fb = options.fallback;
        return typeof fb === 'function' ? (fb as (e: unknown, i: TIn | undefined) => R)(e, input) : fb;
      }
    };
    return resultFn as (input: TIn) => MaybePromise<R | undefined>;
  }
  // Original implementation for functions that take input
  return (input: TIn) => {
    try {
      const out = fn(input);
      if (isThenable(out)) {
        return out.catch((e: unknown) => {
          try {
            options.onError?.(e, input);
          } catch (onErrorThrown) {
            // Swallow onError errors and continue to fallback
          }
          if (options.rethrow === true) {
            return Promise.reject(e);
          }
          const fb = options.fallback;
          return typeof fb === 'function' ? (fb as (e: unknown, i: TIn | undefined) => R)(e, input) : fb;
        });
      }
      return out;
    } catch (e) {
      try {
        options.onError?.(e, input);
      } catch (onErrorThrown) {
        // Swallow onError errors and continue to fallback
      }
      if (options.rethrow === true) {
        throw e;
      }
      const fb = options.fallback;
      return typeof fb === 'function' ? (fb as (e: unknown, i: TIn | undefined) => R)(e, input) : fb;
    }
  };
}

export function guard<T>(
  predicate: (value: T) => MaybePromise<boolean>,
  errorFactory: (value: T) => unknown = v => new Error('ensure failed')
): (value: T) => MaybePromise<T> {
  return (value: T) => {
    const ok = predicate(value);
    if (isThenable(ok)) {
      return ok.then((passed) => {
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
