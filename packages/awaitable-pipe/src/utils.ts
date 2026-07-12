export type MaybePromise<T> = T | Promise<T>;

export function isThenable<T = unknown>(x: T | Promise<T>): x is Promise<T>;
export function isThenable<T = unknown>(x: unknown): x is Promise<T>;
export function isThenable<T = unknown>(x: unknown): x is Promise<T> {
  return !!x && (typeof x === 'object' || typeof x === 'function') && 'then' in x && typeof x.then === 'function';
}

export function isPromise<T = unknown>(x: unknown): x is Promise<T> {
  return !!x && typeof x === 'object' && 'then' in x && typeof x.then === 'function' && 'catch' in x && typeof x.catch === 'function';
}

/**
 * Serial forEach over an array where the step may return a Promise.
 * Runs synchronously until an async step is encountered, then switches to async for the remainder.
 */
export function serialForEach<T>(items: readonly T[], step: (item: T, index: number) => MaybePromise<void | undefined>): MaybePromise<void | undefined> {
  for (let i = 0; i < items.length; i++) {
    const out = step(items[i]!, i);
    if (isThenable(out)) {
      return (async () => {
        await out;
        for (let j = i + 1; j < items.length; j++) {
          await step(items[j]!, j);
        }
        return undefined;
      })();
    }
  }
  return undefined;
}

/**
 * Serial reduce over an array where the step may return a Promise.
 * Runs synchronously until an async step is encountered, then switches to async for the remainder.
 */
export function serialReduce<T, A>(items: readonly T[], seed: A, step: (acc: A, item: T, index: number) => MaybePromise<A>): MaybePromise<A> {
  let acc = seed;
  for (let i = 0; i < items.length; i++) {
    const out = step(acc, items[i]!, i);
    if (isThenable(out)) {
      return (async () => {
        acc = await out;
        for (let j = i + 1; j < items.length; j++) {
          acc = await step(acc, items[j]!, j);
        }
        return acc;
      })();
    }
    acc = out;
  }
  return acc;
}
