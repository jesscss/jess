type AnyFn = (a: any) => any;

type Unwrap<T> = T extends Promise<infer U> ? U : T;
type RetOf<F> = F extends (a: any) => infer R ? R : never;
type ParamOf<F> = F extends (...args: infer P) => any ? (P extends [infer A, ...any[]] ? A : never) : never;
type Apply<In, F> =
  // Zero-arg step: result depends only on return type of F
  [ParamOf<F>] extends [never]
    ? RetOf<F>
    : In extends Promise<any>
      ? Promise<Awaited<RetOf<F>>>
      : RetOf<F>;

type ValidChain<In, Fns extends readonly AnyFn[]> =
  Fns extends []
    ? Fns
    : Fns extends [infer F, ...infer Rest]
      ? F extends AnyFn
        ? (any extends ParamOf<F>
            ? [F, ...ValidChain<Apply<In, F>, Extract<Rest, readonly AnyFn[]>>]
            : never)
        : never
      : never;
// Note: we intentionally do not hard-enforce chain validity at the type level to avoid
// over-constraining overload resolution across diverse call-forms. We still propagate
// types step-to-step via Apply.
type PipeResult<In, Fns extends any[], Acc = In> =
  Fns extends [infer F, ...infer Rest]
    ? PipeResult<Apply<Acc, F>, Rest>
    : Acc;

import { isThenable } from './utils';

function runAsync(v: any, fns: AnyFn[], startIndex: number): Promise<any> {
  let p = Promise.resolve(v);
  for (let i = startIndex; i < fns.length; i++) {
    const fn = fns[i]!;
    p = p.then(val => fn(val));
  }
  return p;
}

// Overloads preserve sync/async result shape
// Steps-only convenience overloads to provide strong contextual typing
export function pipe<A, R1>(
  fn1: () => A,
  fn2: (a: Unwrap<A>) => R1
): PipeResult<undefined, [() => A, (a: Unwrap<A>) => R1]>;
export function pipe<A, R1>(
  fn1: (a?: A) => R1
): PipeResult<undefined, [(a?: A) => R1]>;
export function pipe<A, R1, R2>(
  fn1: () => A,
  fn2: (a: Unwrap<A>) => R1,
  fn3: (b: Unwrap<R1>) => R2
): PipeResult<undefined, [() => A, (a: Unwrap<A>) => R1, (b: Unwrap<R1>) => R2]>;
export function pipe<A, R1, R2, R3>(
  fn1: () => A,
  fn2: (a: Unwrap<A>) => R1,
  fn3: (b: Unwrap<R1>) => R2,
  fn4: (c: Unwrap<R2>) => R3
): PipeResult<undefined, [() => A, (a: Unwrap<A>) => R1, (b: Unwrap<R1>) => R2, (c: Unwrap<R2>) => R3]>;
export function pipe<A, R1, R2, R3, R4>(
  fn1: () => A,
  fn2: (a: Unwrap<A>) => R1,
  fn3: (b: Unwrap<R1>) => R2,
  fn4: (c: Unwrap<R2>) => R3,
  fn5: (d: Unwrap<R3>) => R4
): PipeResult<undefined, [() => A, (a: Unwrap<A>) => R1, (b: Unwrap<R1>) => R2, (c: Unwrap<R2>) => R3, (d: Unwrap<R3>) => R4]>;
export function pipe<A, R1, R2, R3, R4, R5>(
  fn1: () => A,
  fn2: (a: Unwrap<A>) => R1,
  fn3: (b: Unwrap<R1>) => R2,
  fn4: (c: Unwrap<R2>) => R3,
  fn5: (d: Unwrap<R3>) => R4,
  fn6: (e: Unwrap<R4>) => R5
): PipeResult<undefined, [() => A, (a: Unwrap<A>) => R1, (b: Unwrap<R1>) => R2, (c: Unwrap<R2>) => R3, (d: Unwrap<R3>) => R4, (e: Unwrap<R4>) => R5]>;
// Input + 1..6 step overloads for contextual typing
export function pipe<T, R1>(
  input: T | Promise<T> | (() => T) | (() => Promise<T>),
  fn1: (a: Unwrap<T>) => R1
): PipeResult<T, [(a: Unwrap<T>) => R1]>;
export function pipe<T, R1, R2>(
  input: T | Promise<T> | (() => T) | (() => Promise<T>),
  fn1: (a: Unwrap<T>) => R1,
  fn2: (b: Unwrap<R1>) => R2
): PipeResult<T, [(a: Unwrap<T>) => R1, (b: Unwrap<R1>) => R2]>;
export function pipe<T, R1, R2, R3>(
  input: T | Promise<T> | (() => T) | (() => Promise<T>),
  fn1: (a: Unwrap<T>) => R1,
  fn2: (b: Unwrap<R1>) => R2,
  fn3: (c: Unwrap<R2>) => R3
): PipeResult<T, [(a: Unwrap<T>) => R1, (b: Unwrap<R1>) => R2, (c: Unwrap<R2>) => R3]>;
export function pipe<T, R1, R2, R3, R4>(
  input: T | Promise<T> | (() => T) | (() => Promise<T>),
  fn1: (a: Unwrap<T>) => R1,
  fn2: (b: Unwrap<R1>) => R2,
  fn3: (c: Unwrap<R2>) => R3,
  fn4: (d: Unwrap<R3>) => R4
): PipeResult<T, [(a: Unwrap<T>) => R1, (b: Unwrap<R1>) => R2, (c: Unwrap<R2>) => R3, (d: Unwrap<R3>) => R4]>;
export function pipe<T, R1, R2, R3, R4, R5>(
  input: T | Promise<T> | (() => T) | (() => Promise<T>),
  fn1: (a: Unwrap<T>) => R1,
  fn2: (b: Unwrap<R1>) => R2,
  fn3: (c: Unwrap<R2>) => R3,
  fn4: (d: Unwrap<R3>) => R4,
  fn5: (e: Unwrap<R4>) => R5
): PipeResult<T, [(a: Unwrap<T>) => R1, (b: Unwrap<R1>) => R2, (c: Unwrap<R2>) => R3, (d: Unwrap<R3>) => R4, (e: Unwrap<R4>) => R5]>;
// Generic accumulator overload: supports arbitrary-length pipelines when the accumulator type is stable
export function pipe<A>(
  input: A | Promise<A> | (() => A) | (() => Promise<A>),
  ...fns: Array<(a: A) => A | Promise<A>>
): A | Promise<A>;
// Note: Intentionally omitting generic varargs overloads to improve contextual typing
export function pipe(...args: any[]): any {
  let input: any;
  let fns: AnyFn[];
  if (args.length === 0) return undefined as any;

  const first = args[0];
  const second = args[1];
  const rest = args.slice(1) as AnyFn[];
  // Disambiguation:
  // - If first and second are both functions → treat as steps-only (no explicit input)
  // - Else if more than one arg → treat first as input (value | Promise | thunk)
  // - Else single function → steps-only
  const stepsOnly = typeof first === 'function' && typeof second === 'function';
  if (stepsOnly) {
    input = undefined;
    fns = (args as unknown[]) as AnyFn[];
  } else if (args.length > 1) {
    input = typeof first === 'function' ? (first as any)() : first;
    fns = rest;
  } else {
    input = undefined;
    fns = [first as AnyFn];
  }

  if (isThenable(input)) {
    return runAsync(input, fns, 0) as any;
  }
  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i]!;
    const out = fn(input);
    if (isThenable(out)) {
      return runAsync(out, fns, i + 1) as any;
    }
    input = out;
  }
  return input as any;
}

export type SafePipeOptions<R = unknown> = {
  onError?: (error: unknown) => void;
  fallback?: R | (() => R);
};

type RequireAtLeastOne<T, Keys extends keyof T = keyof T> =
  Pick<T, Exclude<keyof T, Keys>> & {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>
  }[Keys];
type NonEmptyOptions<R> = RequireAtLeastOne<SafePipeOptions<R>, 'onError' | 'fallback'>;

function resolveFallback<R>(fb: SafePipeOptions<R>['fallback']): R | undefined {
  return typeof fb === 'function' ? (fb as () => R)() : fb;
}

function runAsyncSafe<R>(v: any, fns: AnyFn[], startIndex: number, opts: SafePipeOptions<R>): Promise<R | undefined> {
  const { onError, fallback } = opts;
  const callOnError = (e: unknown) => {
    try {
      onError?.(e);
    } catch {
      // Swallow errors from onError to keep guarantees: never throw
    }
  };
  let p: Promise<any> = Promise.resolve(v);
  for (let i = startIndex; i < fns.length; i++) {
    const fn = fns[i]!;
    p = p.then(
      val => {
        try {
          return fn(val);
        } catch (e) {
          callOnError(e);
          return resolveFallback(fallback);
        }
      },
      e => {
        callOnError(e);
        return resolveFallback(fallback);
      }
    );
  }
  return p.catch(e => {
    callOnError(e);
    return resolveFallback(fallback);
  });
}

// Overloads for safePipe
// Note: input-first forms are not supported. Use options-first and steps-only.
// Place options-first overloads before steps-only to improve resolution when first arg is an object
export function safePipe<A, R1>(
  options: SafePipeOptions<any>,
  fn1: (a?: A) => R1
): PipeResult<undefined, [(a?: A) => R1]> extends Promise<any> ? Promise<R1 | undefined> : R1 | undefined;
export function safePipe<A, R1, R2>(
  options: SafePipeOptions<any>,
  fn1: (a?: A) => R1,
  fn2: (b: Unwrap<R1>) => R2
): PipeResult<undefined, [(a?: A) => R1, (b: Unwrap<R1>) => R2]> extends Promise<any> ? Promise<R2 | undefined> : R2 | undefined;
export function safePipe<A, R1, R2, R3>(
  options: SafePipeOptions<any>,
  fn1: (a?: A) => R1,
  fn2: (b: Unwrap<R1>) => R2,
  fn3: (c: Unwrap<R2>) => R3
): PipeResult<undefined, [(a?: A) => R1, (b: Unwrap<R1>) => R2, (c: Unwrap<R2>) => R3]> extends Promise<any> ? Promise<R3 | undefined> : R3 | undefined;
// SafePipe steps-only (no input, no options)
export function safePipe<A, R1>(
  fn1: () => A,
  fn2: (a: A) => R1
): PipeResult<undefined, [() => A, (a: A) => R1]> extends Promise<any> ? Promise<R1 | undefined> : R1 | undefined;
export function safePipe<A, R1, R2>(
  fn1: () => A,
  fn2: (a: A) => R1,
  fn3: (b: Unwrap<R1>) => R2
): PipeResult<undefined, [() => A, (a: A) => R1, (b: Unwrap<R1>) => R2]> extends Promise<any> ? Promise<R2 | undefined> : R2 | undefined;
export function safePipe<A, R1, R2, R3>(
  fn1: () => A,
  fn2: (a: A) => R1,
  fn3: (b: Unwrap<R1>) => R2,
  fn4: (c: Unwrap<R2>) => R3
): PipeResult<undefined, [() => A, (a: A) => R1, (b: Unwrap<R1>) => R2, (c: Unwrap<R2>) => R3]> extends Promise<any> ? Promise<R3 | undefined> : R3 | undefined;
export function safePipe<A, R1, R2, R3, R4>(
  fn1: () => A,
  fn2: (a: A) => R1,
  fn3: (b: Unwrap<R1>) => R2,
  fn4: (c: Unwrap<R2>) => R3,
  fn5: (d: Unwrap<R3>) => R4
): PipeResult<undefined, [() => A, (a: A) => R1, (b: Unwrap<R1>) => R2, (c: Unwrap<R2>) => R3, (d: Unwrap<R3>) => R4]> extends Promise<any> ? Promise<R4 | undefined> : R4 | undefined;
export function safePipe<A, R1, R2, R3, R4, R5>(
  fn1: () => A,
  fn2: (a: A) => R1,
  fn3: (b: Unwrap<R1>) => R2,
  fn4: (c: Unwrap<R2>) => R3,
  fn5: (d: Unwrap<R3>) => R4,
  fn6: (e: Unwrap<R4>) => R5
): PipeResult<undefined, [() => A, (a: A) => R1, (b: Unwrap<R1>) => R2, (c: Unwrap<R2>) => R3, (d: Unwrap<R3>) => R4, (e: Unwrap<R4>) => R5]> extends Promise<any> ? Promise<R5 | undefined> : R5 | undefined;
export function safePipe(...args: any[]): any {
  let input: any;
  let options: SafePipeOptions<any>;
  let fns: AnyFn[];

  if (args.length === 0) return undefined as any;

  const first = args[0];
  const second = args[1];
  const looksLikeOptions = (x: unknown): x is SafePipeOptions<any> => !!x && typeof x === 'object' && !Array.isArray(x);
  // Special-case: options-first with no steps should return undefined
  if (args.length === 1 && !!first && typeof first === 'object') {
    return undefined as any;
  }
  const bothFns = typeof first === 'function' && typeof second === 'function';
  if (looksLikeOptions(first) || bothFns) {
    // options-first or steps-only (no explicit input)
    input = undefined;
    options = looksLikeOptions(first) ? (first as SafePipeOptions<any>) : {};
    fns = (looksLikeOptions(first) ? args.slice(1) : args) as AnyFn[];
  } else {
    throw new TypeError('safePipe requires steps-only or options-first with steps');
  }

  input = undefined;

  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i]!;
    try {
      const out = fn(input);
      if (isThenable(out)) {
        return runAsyncSafe(out, fns, i + 1, options) as any;
      }
      input = out;
    } catch (e) {
      try { options?.onError?.(e); } catch {}
      return resolveFallback(options?.fallback) as any;
    }
  }
  return input as any;
}


