declare interface Set<T> {
  union<U>(b: Set<U>): Set<T | U>;
  intersection<U>(b: Set<U>): Set<T | U>;
  difference<U>(b: Set<U>): Set<T | U>;
  symmetricDifference<U>(b: Set<U>): Set<T | U>;
  isSubsetOf<U>(b: Set<U>): boolean;
  isSupersetOf<U>(b: Set<U>): boolean;
  isDisjointFrom<U>(b: Set<U>): boolean;
}
