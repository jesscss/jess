export type MaybePromise<T> = T | Promise<T>;

export function isThenable(x: unknown): x is Promise<unknown> {
  return !!x && (typeof x === 'object' || typeof x === 'function') && typeof (x as any).then === 'function';
}

export function isPromise<T = unknown>(x: unknown): x is Promise<T> {
  return !!x && typeof x === 'object' && typeof (x as any).then === 'function' && typeof (x as any).catch === 'function';
}


