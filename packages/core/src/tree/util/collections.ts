/**
 * Originally I had custom Hashmaps and ArrayLists, in order to normalize
 * generators and iterators for each. But using non-native collections
 * adds complexity but, more importantly, performance overhead, especially
 * if you don't use those iterators.
 *
 * Even using a Map over an object for a dictionary, in theory, has faster
 * lookups, but in total evaluation time, when the file is parsed, it would
 * be passing in either a Map or an object, and converting the object
 * to a map has object creation overhead, and so does creating the map itself,
 * if you pass in an array of arrays.
 *
 * Maps are good for dynamic property additions and repeated lookups. Nodes
 * look up / evaluate properties, at most, once per node, so an object-as-map
 * will either be faster or the differences will be negligible.
 *
 * So now, data is exceedingly simple. It's all passed in as is when parsing or
 * using the API, and we just have some utility functions in this file to iterate over
 * arrays / objects / simple values and return the values or entries, in any order.
 */
import type { ConditionalExcept } from 'type-fest';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import type { Mixin } from '../mixin.js';
import type { Rules } from '../rules.js';
import type { Ruleset } from '../ruleset.js';
import type { Node } from '../node.js';

const { isArray } = Array;

/** Fast replacement for lodash isPlainObject — checks constructor === Object */
export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && value.constructor === Object;

export function atIndex<T>(array: readonly T[], index: number = -1): T | undefined {
  if (index >= 0) {
    return array[index];
  }
  /** Use a negative index to access from the last element */
  return array[array.length + index];
}

/**
 * Entry generators, and this type will yield
 *   - [0] the value
 *   - [1] the key, if applicable, or the key '__value' for non-objects
 *   - [2] the containing object.
 *
 * The purpose of this structure is to iterate and allow replacement
 * of the value in its containing object.
 *
 * The function logic should mirror this type logic.
 */
type GetEntriesOf<T> = T extends readonly any[]
  ? [T[number], number, T]
  : T extends Node
    ? [Node, Node, Rules]
    : T extends Record<string, infer RecordValue>
      ? RecordValue extends readonly any[]
        ? [RecordValue[number], number, RecordValue]
        : [RecordValue, keyof ConditionalExcept<T, readonly any[]>, T]
      : [T, 'value', T];

// type Test = GetEntriesOf<Node<string>>
// type Test2 = GetEntriesOf<Node<string[]>>
// type Test3 = GetEntriesOf<Node<{ selector: Node[], foo: 'string' }>>

export function* getValues<T>(collection: T, reverse = false): Generator<GetEntriesOf<{ value: T }>[0]> {
  if (isArray(collection)) {
    if (reverse) {
      for (let i = collection.length - 1; i >= 0; i--) {
        yield collection[i]!;
      }
    } else {
      let length = collection.length;
      for (let i = 0; i < length; i++) {
        yield collection[i]!;
      }
    }
  } else if (isPlainObject(collection)) {
    const values = Object.values(collection as Record<string, unknown>);
    for (let value of values) {
      if (isArray(value)) {
        yield* getValues(value, reverse);
      } else {
        yield value;
      }
    }
  } else {
    yield collection;
  }
}

export function* getEntries<T>(collection: T, reverse = false): Generator<GetEntriesOf<T>> {
  if (isArray(collection)) {
    if (reverse) {
      for (let i = collection.length - 1; i >= 0; i--) {
        yield [collection[i]!, i, collection] as GetEntriesOf<T>;
      }
    } else {
      let length = collection.length;
      for (let i = 0; i < length; i++) {
        yield [collection[i]!, i, collection] as GetEntriesOf<T>;
      }
    }
  } else if (isPlainObject(collection)) {
    const entries = Object.entries(collection as Record<string, unknown>);
    for (let [key, value] of entries) {
      if (isArray(value)) {
        yield* getEntries(value, reverse) as Generator<GetEntriesOf<T>>;
      } else {
        yield [value, key, collection] as GetEntriesOf<T>;
      }
    }
  } else if (isNode(collection, N.Mixin | N.Ruleset | N.Rules)) {
    let rules: Node[];
    if ((collection as Node).type === 'Mixin') {
      if ((collection as Mixin).value.params?.length) {
        throw new Error('We can\'t iterate over a mixin with parameters');
      }
      rules = (collection as Mixin).value.rules.value;
    } else if ((collection as Node).type === 'Ruleset') {
      rules = (collection as Ruleset).value.rules.value;
    } else if ((collection as Node).type === 'Rules') {
      rules = (collection as Rules).value;
    }
    for (let [, value] of rules!.entries()) {
      if (value.type === 'Comment') {
        continue;
      }
      if (!isNode(value, N.Declaration)) {
        throw new Error('We can\'t iterate over rules with non-declarations');
      }
      yield [value.value.value, value.value.name, rules!] as unknown as GetEntriesOf<T>;
    }
  } else if (isNode(collection) && isArray((collection as Node).value)) {
    yield* getEntries((collection as Node).value as unknown[], reverse) as Generator<GetEntriesOf<T>>;
  } else {
    yield [collection, 'value', collection] as unknown as GetEntriesOf<T>;
  }
}

/**
 * We use { value: unknown } as the type for the node so that
 * we can easily override the value type when calling.
 */
export function* getValuesFromNode<T extends { value: unknown }>(node: T, reverse = false): Generator<GetEntriesOf<T>[0]> {
  let value = node.value;
  if (isArray(value) || isPlainObject(value)) {
    yield* getValues(value, reverse) as Generator<GetEntriesOf<T>[0]>;
  } else {
    yield value;
  }
}

/**
 * This is especially useful, because we don't have to care about what the Node's `value` is,
 * we can just iterate over it and get the entries, and replace as necessary.
 */
export function* getEntriesFromNode<T extends { value: unknown }>(node: T, reverse = false): Generator<GetEntriesOf<T>> {
  let value = node.value;
  if (isArray(value) || isPlainObject(value)) {
    yield* getEntries(value, reverse) as Generator<GetEntriesOf<T>[0]>;
  } else {
    yield [value, 'value', node] as GetEntriesOf<T>;
  }
}

export function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
