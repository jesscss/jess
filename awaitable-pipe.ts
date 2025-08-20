/**
 * awaitable-pipe
 *
 * A tiny, strongly-typed pipe utility that:
 * - Returns a plain value for all-sync pipelines
 * - Returns a Promise for pipelines that include any async step or async input
 * - Propagates errors either:
 *   - naturally (pipe): sync throws / async rejects
 *   - via a single handler with fallback (safePipe): never throws
 *
 * It also supports:
 * - starting with a value, a Promise, or an initial thunk (() => T | Promise<T>)
 * - starting without an initial value (the first step receives undefined)
 * - feeding the output (value or Promise) of one pipe into another pipe
 *
 * Examples
 * --------
 * Sync stays sync:
 *   const upper = (s: string) => s.toUpperCase();
 *   const exclaim = (s: string) => s + '!';
 *   const out = pipe('ok', upper, exclaim); // string -> 'OK!'
 *
 * Mixed promotes to Promise:
 *   const load = async (s: string) => s + '!';
 *   const outP = pipe('ok', upper, load); // Promise<string>
 *   const result = await outP; // 'OK!'
 *
 * Safe single-point error handling (never throws):
 *   const boom = () => { throw new Error('nope') };
 *   const safe = safePipe('ok', { onError: console.error, fallback: 'X' }, boom, upper);
 *   // safe is string -> 'X'
 *
 * Piping a pipe's output into another pipe:
 *   const p1 = pipe('ok', upper);            // string
 *   const p2 = pipe(p1, exclaim);            // string -> 'OK!'
 *
 *   const p3 = pipe('ok', load);             // Promise<string>
 *   const p4 = pipe(p3, exclaim);            // Promise<string>
 *   const final = await p4;                  // 'ok!'
 */

type AnyFn = (a: any) => any;

/** Unwrap Promise type */
type Unwrap<T> = T extends Promise<infer U> ? U : T;

/** Apply a step F to an accumulated type In, preserving sync/async shape */
type Apply<In, F> = F extends (a: Unwrap<In>) => infer R
  ? In extends Promise<any>
    ? Promise<R>
    : R
  : never;

/** Final pipe result type after applying all steps */
type PipeResult<In, Fns extends any[], Acc = In> =
  Fns extends [infer F, ...infer Rest]
    ? PipeResult<Apply<Acc, F>, Rest>
    : Acc;

/** Narrowly checks thenable/Promise without importing a library */
function isThenable(x: any): x is Promise<any> {
  return !!x && (typeof x === 'object' || typeof x === 'function') && typeof x.then === 'function';
}

/**
 * Run remaining steps in async mode, chaining via Promise
 */
function runAsync(v: any, fns: AnyFn[]): Promise<any> {
  return fns.reduce<Promise<any>>((p, fn) => {
    return p.then(val => {
      const out = fn(val);
      return isThenable(out) ? out : Promise.resolve(out);
    });
  }, Promise.resolve(v));
}

/**
 * pipe: sync stays sync; async becomes Promise.
 *
 * - input can be a value, Promise, initial thunk (() => value|Promise), or omitted
 * - if omitted, the first step receives `undefined`
 * - errors: sync throws; async rejects
 */
export function pipe<T, Fns extends AnyFn[]>
(
  ...args:
    | [input: T | Promise<T> | (() => T) | (() => Promise<T>), ...fns: Fns]
    | [/* no input */, ...fns: Fns]
): PipeResult<T | undefined, Fns> {
  let input: any;
  let fns: AnyFn[];

  if (args.length === 0) {
    // No input, no steps
    return undefined as any;
  }

  const first = args[0];
  if (typeof first === 'function' || isThenable(first) || args.length === 1) {
    // Either: thunk, promise, or single item (treated as input with 0 steps)
    input = typeof first === 'function' ? (first as any)() : first;
    fns = (args.slice(1) as unknown[]) as AnyFn[];
  } else {
    // No explicit input — start with undefined; all args are steps
    input = undefined;
    fns = (args as unknown[]) as AnyFn[];
  }

  // Walk steps; if we hit async, switch to async tail
  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i]!;
    if (isThenable(input)) {
      return runAsync(input, fns.slice(i)) as any;
    }
    input = fn(input);
  }
  return input as any;
}

/** Options for safePipe single-point error handling */
export type SafePipeOptions<R = unknown> = {
  /** Called exactly once upon first error (sync throw or async rejection) */
  onError?: (error: unknown) => void;
  /** Value or thunk returned when an error occurs. If omitted, returns undefined. */
  fallback?: R | (() => R);
};

function resolveFallback<R>(fb: SafePipeOptions<R>['fallback']): R | undefined {
  return typeof fb === 'function' ? (fb as () => R)() : fb;
}

/** Async tail that captures errors and returns fallback instead of throwing */
function runAsyncSafe<R>(
  v: any,
  fns: AnyFn[],
  opts: SafePipeOptions<R>
): Promise<R | undefined> {
  const { onError, fallback } = opts;
  return fns.reduce<Promise<any>>((p, fn) => {
    return p.then(val => {
      try {
        const out = fn(val);
        return isThenable(out) ? out : Promise.resolve(out);
      } catch (e) {
        onError?.(e);
        return Promise.resolve(resolveFallback(fallback));
      }
    }).catch(e => {
      onError?.(e);
      return Promise.resolve(resolveFallback(fallback));
    });
  }, Promise.resolve(v)).catch(e => {
    onError?.(e);
    return resolveFallback(fallback);
  });
}

/**
 * safePipe: single-point error handling. Never throws.
 *
 * - If the whole pipeline is sync, returns a plain value (or fallback/undefined on error)
 * - If any part is async, returns a Promise resolving to value (or fallback/undefined on error)
 * - Errors are captured once and passed to onError (if provided)
 * - You can start with value, Promise, thunk, or no initial value
 *
 * Examples:
 *   // Sync (no throw):
 *   const s = safePipe('ok', {}, (x: string) => x.toUpperCase()); // string
 *
 *   // Sync (throw at step 2):
 *   const s2 = safePipe('ok', { onError: console.error, fallback: 'X' },
 *     (x: string) => x.toUpperCase(),
 *     () => { throw new Error('boom'); }
 *   ); // 'X'
 *
 *   // Async path:
 *   const out = await safePipe('ok', { onError: console.error, fallback: 'X' },
 *     async s => s + '!',
 *     v => v + '?'
 *   ); // 'ok!?'
 */
export function safePipe<T, Fns extends AnyFn[], R = PipeResult<T | undefined, Fns>>
(
  ...args:
    | [input: T | Promise<T> | (() => T) | (() => Promise<T>), options: SafePipeOptions<R>, ...fns: Fns]
    | [options: SafePipeOptions<R>, ...fns: Fns]
): PipeResult<T | undefined, Fns> extends Promise<any> ? Promise<R | undefined> : R | undefined {
  let input: any;
  let options: SafePipeOptions<R>;
  let fns: AnyFn[];

  if (args.length === 0) return undefined as any;

  if (typeof args[0] === 'object' && args[0] && 'onError' in (args[0] as any) || 'fallback' in (args[0] as any)) {
    // No explicit input; options first
    input = undefined;
    options = args[0] as SafePipeOptions<R>;
    fns = (args.slice(1) as unknown[]) as AnyFn[];
  } else {
    // Input, then options, then steps
    input = args[0];
    options = args[1] as SafePipeOptions<R>;
    fns = (args.slice(2) as unknown[]) as AnyFn[];
  }

  // Eagerly evaluate initial thunk; capture sync error
  try {
    input = typeof input === 'function' ? (input as any)() : input;
  } catch (e) {
    options?.onError?.(e);
    return resolveFallback(options?.fallback) as any;
  }

  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i]!;
    if (isThenable(input)) {
      return runAsyncSafe(input, fns.slice(i), options) as any;
    }
    try {
      input = fn(input);
    } catch (e) {
      options?.onError?.(e);
      return resolveFallback(options?.fallback) as any;
    }
  }
  return input as any;
}

/**
 * Composing pipes (cross-sync/async)
 * ----------------------------------
 * You can feed the output of one pipe/safePipe into another pipe. Types preserve sync/async shape.
 *
 *   const p1 = pipe('hi', (s: string) => s.toUpperCase());   // string
 *   const p2 = pipe(p1, (s) => s + '!');                     // string -> 'HI!'
 *
 *   const p3 = pipe('hi', async s => s + '!');               // Promise<string>
 *   const p4 = pipe(p3, (s) => s + '?');                     // Promise<string>
 *   const fin = await p4;                                    // 'hi!?'
 */


