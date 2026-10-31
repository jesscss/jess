/**
 * Deep-merges config objects into `target`, left to right, and returns it.
 *
 * It keeps the semantics of lodash `mergeWith` with the compiler's former
 * array-concat customizer, for the shapes a config holds:
 * - Two arrays concatenate. `output` is one options object or a list of
 *   entries: merged with a list, an object joins it as a file-less entry, in
 *   merge order, so a later one still wins (`readOutput`). An empty object adds
 *   nothing.
 * - A plain object (any realm, or a null prototype) merges key by key into the
 *   target's object at that key, or into a new object (null-prototype when the
 *   source is). An array onto a non-array merges by index into a new array, so
 *   plain objects inside it are copied.
 * - Anything else (a plugin instance, a function, a RegExp, `null`) is assigned
 *   by reference.
 * - An `undefined` source value never replaces a value; it only creates a
 *   missing key.
 * - Enumerable inherited keys are read too (`for…in`, lodash `keysIn`), and
 *   `__proto__` is skipped.
 *
 * ponytail: no cycle tracking and no typed-array/Buffer/`arguments` cases (lodash
 * has them); a config is acyclic JSON-like data plus plugin instances.
 */
export function mergeConfig<T extends object>(target: T, ...sources: ReadonlyArray<object | undefined>): T {
  for (const source of sources) {
    if (source != null) {
      mergeEntries(target, source);
    }
  }
  return target;
}

function mergeEntries(target: object, source: object): void {
  for (const key in source) {
    if (key === '__proto__') {
      continue;
    }
    const value = mergeValue(Reflect.get(target, key), Reflect.get(source, key), key);
    if (value !== undefined || !(key in target)) {
      Reflect.set(target, key, value);
    }
  }
}

function mergeValue(objValue: unknown, srcValue: unknown, key: string): unknown {
  if (Array.isArray(objValue) && Array.isArray(srcValue)) {
    return [...objValue, ...srcValue];
  }
  if (key === 'output' && (Array.isArray(objValue) || Array.isArray(srcValue))) {
    return [objValue, srcValue].flat().filter(entry => entry !== null && typeof entry === 'object' && !Array.isArray(entry) && Object.keys(entry).length > 0);
  }
  if (Array.isArray(srcValue)) {
    const into: unknown[] = [];
    mergeEntries(into, srcValue);
    return into;
  }
  if (isPlainObject(srcValue)) {
    const into = objValue !== null && typeof objValue === 'object' ? objValue : {};
    if (into !== objValue && Object.getPrototypeOf(srcValue) === null) {
      Object.setPrototypeOf(into, null);
    }
    mergeEntries(into, srcValue);
    return into;
  }
  return srcValue;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
}
