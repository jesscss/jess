type AnyFn = (a: any) => any;

type Unwrap<T> = T extends Promise<infer U> ? U : T;
type ArgOf<F> = F extends (a: infer A) => any ? A : never;
type RetOf<F> = F extends (a: any) => infer R ? R : never;
type Apply<In, F> = Unwrap<In> extends ArgOf<F>
  ? (In extends Promise<any>
      ? (RetOf<F> extends Promise<any> ? Promise<Awaited<RetOf<F>>> : Promise<RetOf<F>>)
      : RetOf<F>)
  : unknown;

type ValidChain<In, Fns extends readonly AnyFn[]> =
  Fns extends []
    ? Fns
    : Fns extends [infer F, ...infer Rest]
      ? F extends AnyFn
        ? (Unwrap<In> extends ArgOf<F>
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

function runAsync(v: any, fns: AnyFn[]): Promise<any> {
  return fns.reduce<Promise<any>>((p, fn) => p.then(val => {
    const out = fn(val);
    return isThenable(out) ? out : Promise.resolve(out);
  }), Promise.resolve(v));
}

// Overloads preserve sync/async result shape
// Steps-only convenience overloads to provide strong contextual typing
export function pipe<A, R1>(
  fn1: () => A,
  fn2: (a: A) => R1
): R1;
export function pipe<A, R1>(
  fn1: (a?: A) => R1
): R1;
export function pipe<A, R1, R2>(
  fn1: () => A,
  fn2: (a: A) => R1,
  fn3: (b: Unwrap<R1>) => R2
): R2;
export function pipe<A, R1, R2, R3>(
  fn1: () => A,
  fn2: (a: A) => R1,
  fn3: (b: Unwrap<R1>) => R2,
  fn4: (c: Unwrap<R2>) => R3
): R3;
export function pipe<A, R1, R2, R3, R4>(
  fn1: () => A,
  fn2: (a: A) => R1,
  fn3: (b: Unwrap<R1>) => R2,
  fn4: (c: Unwrap<R2>) => R3,
  fn5: (d: Unwrap<R3>) => R4
): R4;
export function pipe<A, R1, R2, R3, R4, R5>(
  fn1: () => A,
  fn2: (a: A) => R1,
  fn3: (b: Unwrap<R1>) => R2,
  fn4: (c: Unwrap<R2>) => R3,
  fn5: (d: Unwrap<R3>) => R4,
  fn6: (e: Unwrap<R4>) => R5
): R5;
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

  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i]!;
    if (isThenable(input)) {
      return runAsync(input, fns.slice(i)) as any;
    }
    input = fn(input);
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

function runAsyncSafe<R>(v: any, fns: AnyFn[], opts: SafePipeOptions<R>): Promise<R | undefined> {
  const { onError, fallback } = opts;
  const callOnError = (e: unknown) => {
    try {
      onError?.(e);
    } catch {
      // Swallow errors from onError to keep guarantees: never throw
    }
  };
  return fns.reduce<Promise<any>>((p, fn) => p.then(val => {
    try {
      const out = fn(val);
      return isThenable(out) ? out : Promise.resolve(out);
    } catch (e) {
      callOnError(e);
      return Promise.resolve(resolveFallback(fallback));
    }
  }).catch(e => {
    callOnError(e);
    return Promise.resolve(resolveFallback(fallback));
  }), Promise.resolve(v)).catch(e => {
    callOnError(e);
    return resolveFallback(fallback);
  });
}

// Overloads for safePipe
// Input + vararg fixed-arity overloads defined below
// SafePipe input + 1..6 step overloads for contextual typing
export function safePipe<T, R1, R = R1>(
  input: T | Promise<T> | (() => T) | (() => Promise<T>),
  options: SafePipeOptions<R>,
  fn1: (a: Unwrap<T>) => R1
): PipeResult<T, [(a: Unwrap<T>) => R1]> extends Promise<any> ? Promise<R | undefined> : R | undefined;
export function safePipe<T, R1, R2, R = R2>(
  input: T | Promise<T> | (() => T) | (() => Promise<T>),
  options: SafePipeOptions<R>,
  fn1: (a: Unwrap<T>) => R1,
  fn2: (b: Unwrap<R1>) => R2
): PipeResult<T, [(a: Unwrap<T>) => R1, (b: Unwrap<R1>) => R2]> extends Promise<any> ? Promise<R | undefined> : R | undefined;
export function safePipe<T, R1, R2, R3, R = R3>(
  input: T | Promise<T> | (() => T) | (() => Promise<T>),
  options: SafePipeOptions<R>,
  fn1: (a: Unwrap<T>) => R1,
  fn2: (b: Unwrap<R1>) => R2,
  fn3: (c: Unwrap<R2>) => R3
): PipeResult<T, [(a: Unwrap<T>) => R1, (b: Unwrap<R1>) => R2, (c: Unwrap<R2>) => R3]> extends Promise<any> ? Promise<R | undefined> : R | undefined;
// SafePipe steps-only (no input, no options) with strong contextual typing
export function safePipe<A, R1>(
  fn1: () => A,
  fn2: (a: A) => R1
): R1 | undefined;
export function safePipe<A, R1, R2>(
  fn1: () => A,
  fn2: (a: A) => R1,
  fn3: (b: Unwrap<R1>) => R2
): R2 | undefined;
export function safePipe<A, R1, R2, R3>(
  fn1: () => A,
  fn2: (a: A) => R1,
  fn3: (b: Unwrap<R1>) => R2,
  fn4: (c: Unwrap<R2>) => R3
): R3 | undefined;
export function safePipe<A, R1, R2, R3, R4>(
  fn1: () => A,
  fn2: (a: A) => R1,
  fn3: (b: Unwrap<R1>) => R2,
  fn4: (c: Unwrap<R2>) => R3,
  fn5: (d: Unwrap<R3>) => R4
): R4 | undefined;
export function safePipe<A, R1, R2, R3, R4, R5>(
  fn1: () => A,
  fn2: (a: A) => R1,
  fn3: (b: Unwrap<R1>) => R2,
  fn4: (c: Unwrap<R2>) => R3,
  fn5: (d: Unwrap<R3>) => R4,
  fn6: (e: Unwrap<R4>) => R5
): R5 | undefined;
// SafePipe options-first with strong contextual typing
export function safePipe<A, R1>(
  options: NonEmptyOptions<R1>,
  fn1: (a?: A) => R1
): R1 | undefined;
export function safePipe<A, R1, R2>(
  options: NonEmptyOptions<R2>,
  fn1: (a?: A) => R1,
  fn2: (b: Unwrap<R1>) => R2
): R2 | undefined;
export function safePipe<A, R1, R2, R3>(
  options: NonEmptyOptions<R3>,
  fn1: (a?: A) => R1,
  fn2: (b: Unwrap<R1>) => R2,
  fn3: (c: Unwrap<R2>) => R3
): R3 | undefined;
export function safePipe(...args: any[]): any {
  let input: any;
  let options: SafePipeOptions<any>;
  let fns: AnyFn[];

  if (args.length === 0) return undefined as any;

  const first = args[0];
  const second = args[1];
  const looksLikeOptions = (x: unknown): x is SafePipeOptions<any> => !!x && typeof x === 'object' && (('onError' in (x as any)) || ('fallback' in (x as any)));
  const bothFns = typeof first === 'function' && typeof second === 'function';
  if (looksLikeOptions(first) || bothFns) {
    // options-first or steps-only (no explicit input)
    input = undefined;
    options = looksLikeOptions(first) ? (first as SafePipeOptions<any>) : {};
    fns = (looksLikeOptions(first) ? args.slice(1) : args) as AnyFn[];
  } else {
    input = first;
    options = (second as SafePipeOptions<any>) ?? {};
    fns = (args.slice(2) as unknown[]) as AnyFn[];
  }

  try {
    input = typeof input === 'function' ? (input as any)() : input;
  } catch (e) {
    try { options?.onError?.(e); } catch {}
    return resolveFallback(options?.fallback) as any;
  }

  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i]!;
    if (isThenable(input)) {
      return runAsyncSafe(input, fns.slice(i), options) as any;
    }
    try {
      const out = fn(input);
      if (isThenable(out)) {
        return runAsyncSafe(out, fns.slice(i + 1), options) as any;
      }
      input = out;
    } catch (e) {
      try { options?.onError?.(e); } catch {}
      return resolveFallback(options?.fallback) as any;
    }
  }
  return input as any;
}


