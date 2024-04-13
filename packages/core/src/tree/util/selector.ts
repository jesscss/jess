export function combineKeys(
  a: Set<string> | string,
  b: Set<string> | string
): Set<string> {
  if (a instanceof Set) {
    if (b instanceof Set) {
      return a.union(b)
    } else {
      return (new Set(a)).add(b)
    }
  } else {
    if (b instanceof Set) {
      return (new Set(b)).add(a)
    } else {
      /** Both are strings */
      return new Set([a, b])
    }
  }
}

export class SelectorArray<T> extends Array<T> {}
export class IsArray<T> extends Array<T> {}
