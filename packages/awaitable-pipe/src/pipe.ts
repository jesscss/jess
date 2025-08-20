type AnyFn = (a: any) => any;

type Unwrap<T> = T extends Promise<infer U> ? U : T;
type Apply<In, F> = F extends (a: Unwrap<In>) => infer R
  ? In extends Promise<any> ? Promise<R> : R
  : never;
type PipeResult<In, Fns extends any[], Acc = In> =
  Fns extends [infer F, ...infer Rest]
    ? PipeResult<Apply<Acc, F>, Rest>
    : Acc;

function isThenable(x: any): x is Promise<any> {
  return !!x && (typeof x === 'object' || typeof x === 'function') && typeof x.then === 'function';
}

function runAsync(v: any, fns: AnyFn[]): Promise<any> {
  return fns.reduce<Promise<any>>((p, fn) => p.then(val => {
    const out = fn(val);
    return isThenable(out) ? out : Promise.resolve(out);
  }), Promise.resolve(v));
}

// Overloads preserve sync/async result shape
export function pipe<T, Fns extends AnyFn[]>(
  input: T | Promise<T> | (() => T) | (() => Promise<T>),
  ...fns: Fns
): PipeResult<T, Fns>;
export function pipe<Fns extends AnyFn[]>(
  ...fns: Fns
): PipeResult<undefined, Fns>;
export function pipe(...args: any[]): any {
  let input: any;
  let fns: AnyFn[];
  if (args.length === 0) return undefined as any;

  const first = args[0];
  const rest = args.slice(1) as AnyFn[];
  // Heuristic:
  // - If there is at least one arg and the second arg exists, treat first as input and rest as steps
  // - If only one arg and it's a function, treat it as first step (no input)
  if (args.length > 1) {
    input = typeof first === 'function' ? (first as any)() : first;
    fns = rest;
  } else {
    // Single argument: no explicit input; use it as the first step
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
export function safePipe<T, Fns extends AnyFn[], R = PipeResult<T, Fns>>(
  input: T | Promise<T> | (() => T) | (() => Promise<T>),
  options: SafePipeOptions<R>,
  ...fns: Fns
): PipeResult<T, Fns> extends Promise<any> ? Promise<R | undefined> : R | undefined;
export function safePipe<Fns extends AnyFn[], R = PipeResult<undefined, Fns>>(
  options: SafePipeOptions<R>,
  ...fns: Fns
): PipeResult<undefined, Fns> extends Promise<any> ? Promise<R | undefined> : R | undefined;
export function safePipe(...args: any[]): any {
  let input: any;
  let options: SafePipeOptions<any>;
  let fns: AnyFn[];

  if (args.length === 0) return undefined as any;

  const first = args[0];
  if ((first && typeof first === 'object') && (('onError' in first) || ('fallback' in first))) {
    // options only, no explicit input
    input = undefined;
    options = first as SafePipeOptions<any>;
    fns = (args.slice(1) as unknown[]) as AnyFn[];
  } else {
    input = first;
    options = args[1] as SafePipeOptions<any>;
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


