/**
 * This file has a lot of collection experiments and will likely not be used.
 */

import type { ValueOf, IfNever } from 'type-fest'
import type { Node } from '../node'
import { Deque } from 'data-structure-typed'
import isObject from 'lodash-es/isObject'
import { isArray } from 'lodash-es'

/** This is just to make the following class more readable */
// eslint-disable-next-line @typescript-eslint/naming-convention
type NODE_INDEX = number

/** A linked list of Node indices */
export class LinkedList {
  /**
   * A map of a numbered node index to the before / after as a joined number
   * The mapped number is a bit field storing 2 indices.
   */
  private readonly _items = new Map<NODE_INDEX, number>()
  first: NODE_INDEX | undefined
  last: NODE_INDEX | undefined
  private _current: NODE_INDEX | undefined

  constructor(items?: NODE_INDEX[]) {
    if (items?.length) {
      this.push(...items)
    }
  }

  clear() {
    this._items.clear()
    this.first = undefined
    this.last = undefined
    this._current = undefined
  }

  * [Symbol.iterator]() {
    yield * this._values()
  }

  * values(start?: NODE_INDEX) {
    yield * this._values(false, start)
  }

  private _values(asEntries?: false, start?: NODE_INDEX): Generator<NODE_INDEX, void, any>
  private _values(asEntries: true, start?: NODE_INDEX): Generator<[NODE_INDEX, NODE_INDEX], void, any>
  private * _values(asEntries = false, start = this.first) {
    if (!this._items.has(start!)) {
      throw new Error('Invalid start index')
    }
    let currentIndex = this._current = start
    if (currentIndex === undefined) {
      return
    }

    while (currentIndex !== undefined) {
      yield asEntries ? [currentIndex, currentIndex] : currentIndex
      /**
     * this._current pointer may change because of deletions,
     * but if it's still the same pointer, then increment it
     * to the next position.
     */
      const nextIndex: number | undefined = currentIndex === this._current
        ? this._getNextFromBits(this._items.get(currentIndex))
        : this._current

      currentIndex = this._current = nextIndex
    }
  }

  * entries() {
    yield * this._values(true)
  }

  * reverseEntries(start?: NODE_INDEX) {
    yield * this._reverse(true, start)
  }

  * reverse(start?: NODE_INDEX) {
    yield * this._reverse(false, start)
  }

  private _reverse(asEntries?: false, start?: NODE_INDEX): Generator<NODE_INDEX, void, any>
  private _reverse(asEntries: true, start?: NODE_INDEX): Generator<[NODE_INDEX, NODE_INDEX], void, any>
  private * _reverse(asEntries = false, start = this.last) {
    if (!this._items.has(start!)) {
      throw new Error('Invalid start index')
    }
    let currentIndex = this._current = start
    if (currentIndex === undefined) {
      return
    }

    while (currentIndex !== undefined) {
      yield asEntries ? [currentIndex, currentIndex] : currentIndex
      /**
     * this._current pointer may change because of deletions,
     * but if it's still the same pointer, then decrement it
     * to the previous position.
     */
      let prevIndex: number | undefined = currentIndex === this._current
        ? this._getPrevFromBits(this._items.get(currentIndex))
        : this._current

      currentIndex = this._current = prevIndex
    }
  }

  private _push(before: NODE_INDEX | undefined, after: NODE_INDEX | undefined, ...items: NODE_INDEX[]) {
    let thisIsFirst = before === this.first
    let thisIsLast = after === this.last
    let lastIndex: number | undefined
    let firstIndex = items[0]
    if (thisIsFirst) {
      this.first = firstIndex
    }
    const { _items } = this
    for (let index of items) {
      if (lastIndex) {
        this._writePos(index, lastIndex, 0)
        this._writeNextPos(lastIndex, index)
      } else {
        this._writePos(index, 0, 0)
      }
      lastIndex = index
    }
    if (thisIsLast) {
      this.last = lastIndex
    }
    /** Update the next / previous of before / after nodes */
    if (before) {
      let pos = _items.get(before)!
      if (!thisIsFirst) {
        let previous = this._getPrevFromBits(pos)!
        this._writeNextPos(previous, firstIndex)
      }
      this._writePrevPos(before, lastIndex)
    }
    if (after) {
      let pos = _items.get(after)!
      if (!thisIsLast) {
        let next = this._getNextFromBits(pos)!
        this._writePrevPos(next, lastIndex)
      }
      this._writeNextPos(after, firstIndex)
    }
  }

  push(...items: NODE_INDEX[]) {
    this._push(0, this.last, ...items)
  }

  unshift(...items: NODE_INDEX[]) {
    this._push(this.first, 0, ...items)
  }

  insertBefore(before: NODE_INDEX, ...items: NODE_INDEX[]) {
    this._push(before, 0, ...items)
  }

  insertAfter(after: NODE_INDEX, ...items: NODE_INDEX[]) {
    this._push(0, after, ...items)
  }

  removeItem(item: NODE_INDEX) {
    let pos = this._items.get(item)
    if (pos === undefined) {
      return
    }
    let previous = this._getPrevFromBits(pos)
    let next = this._getNextFromBits(pos)
    if (previous) {
      this._writeNextPos(previous, next)
    }
    if (next) {
      this._writePrevPos(next, previous)
    }
    this._items.delete(pos)
    if (item === this.first) {
      this.first = next
    }
    if (item === this.last) {
      this.last = previous
    }
    if (item === this._current) {
      this._current = next
    }
  }

  private _writePos(nodeRef: NODE_INDEX, previous: NODE_INDEX | undefined, next: NODE_INDEX | undefined) {
    if (nodeRef === previous || nodeRef === next) {
      throw new Error('Linking a node to itself would cause an infinite loop.')
    }
    this._items.set(nodeRef, (previous ?? 0) << 16 | (next ?? 0))
  }

  private _writeNextPos(nodeRef: NODE_INDEX, next: NODE_INDEX | undefined) {
    let pos = this._items.get(nodeRef)
    if (pos !== undefined) {
      /** Read previous, and write next */
      this._writePos(nodeRef, this._getPrevFromBits(pos), next)
    }
  }

  private _writePrevPos(nodeRef: NODE_INDEX, previous: NODE_INDEX | undefined) {
    let pos = this._items.get(nodeRef)
    if (pos !== undefined) {
      /** Read next, and write previous */
      this._writePos(nodeRef, previous, this._getNextFromBits(pos))
    }
  }

  private _getPrevFromBits(pos: number | undefined): number | undefined {
    if (pos === undefined) {
      return undefined
    }
    let previous = (pos >>> 16) & 0xFFFF // Extract the upper 16 bits
    return previous === 0 ? undefined : previous
  }

  private _getNextFromBits(pos: number | undefined): number | undefined {
    if (pos === undefined) {
      return undefined
    }
    let next = pos & 0xffff // Extract the lower 16 bits
    return next === 0 ? undefined : next
  }
}

/**
 * An abstraction around an array with some useful helper methods,
 * some of which are set-like.
 */
export class ArrayListOld<T = any> {
  /** Assumes unique objects in this array */
  private _positionMap: WeakMap<object, number> | undefined
  private get positionMap(): WeakMap<object, number> {
    return (this._positionMap ??= new WeakMap())
  }

  items!: T[]
  processValue?: (value: T) => T

  setPosition(item: T, index: number) {
    if (isObject(item)) {
      this.positionMap.set(item, index)
    }
  }

  reIndex(startIndex = 0) {
    const length = this.items.length
    for (let i = startIndex; i < length; i++) {
      let item = this.items[i]!
      this.setPosition(item, i)
    }
  }

  indexOf(item: T) {
    let index: number | undefined
    if (isObject(item)) {
      index = this.positionMap.get(item)
    }
    if (index !== undefined) {
      return index
    }
    return this.items.lastIndexOf(item)
  }

  constructor(
    items: T[] = [],
    processValue?: (value: T) => T
  ) {
    /** We do it this way to process items */
    this.processValue = processValue
    this.push(...items)
  }

  get size() {
    return this.items.length
  }

  has(item: T) {
    return this.items.includes(item)
  }

  set(index: number, value: T) {
    let processValue = this.processValue
    this.items[index] = processValue ? processValue(value) : value
    this.setPosition(value, index)
    if (index > this.items.length - 1) {
      this.reIndex(index)
    }
  }

  clear() {
    this.items.length = 0
    if (this._positionMap) {
      this._positionMap = new WeakMap()
    }
  }

  push(...items: T[]) {
    let lastIndex = this.items?.length ?? 0
    let processValue = this.processValue
    if (processValue) {
      for (let i = 0; i < items.length; i++) {
        items[i] = processValue(items[i]!)
      }
    }
    let currentItems = this.items
    if (currentItems) {
      currentItems.push(...items)
    } else {
      this.items = items
    }
    this.reIndex(lastIndex)
  }

  pop() {
    return this.items.pop()
  }

  * [Symbol.iterator](): Generator<T> {
    yield * this.items
  }

  * entries(): Generator<[number, T]> {
    let length = this.items.length
    for (let i = 0; i < length; i++) {
      yield [i, this.items[i]!]
    }
  }

  * values(): Generator<T> {
    yield * this.items
  }

  * reverse(start = this.items.length - 1): Generator<T> {
    for (let i = start; i > -1; i--) {
      yield this.items[i]!
    }
  }

  * reverseEntries(start = this.items.length - 1): Generator<[number, T]> {
    for (let i = start; i > -1; i--) {
      yield [i, this.items[i]!]
    }
  }
}

interface DataCollection<
  T,
  Items,
  K,
  V,
  P extends (value: V) => unknown = (value: V) => V
> {
  items: Items
  toRaw(): T
  clone(): this
  clear(): void
  [Symbol.iterator](): Generator<ReturnType<P>>
  entries(): Generator<[K, ReturnType<P>]>
  reverseEntries(start?: number): Generator<[K, ReturnType<P>]>
}

/**
 * Not sure if this is still needed.
 */
export class ArrayList<
  T = any,
  P extends (value: T) => unknown = (value: T) => T
> implements DataCollection<T[], T[], number, T, P> {
  private _items: T[] | undefined
  get items(): T[] {
    return (this._items ??= [])
  }

  get length() {
    return this._items?.length ?? 0
  }

  get size() {
    return this._items?.length ?? 0
  }

  private readonly _processValue: P

  constructor(items?: T[], processValue?: P) {
    this._processValue = processValue ?? ((value: T) => value) as P
    if (items) {
      this.push(...items)
    }
  }

  toRaw(): T[] {
    return this.items
  }

  clone(): this {
    let clone: this = this.constructor(
      isArray(this._items) ? [...this._items] : this._items,
      this._processValue
    )

    return clone
  }

  [Symbol.iterator](): Generator<ReturnType<P>, any, any> {
    throw new Error('Method not implemented.')
  }

  clear() {
    this.items.length = 0
  }

  at(index: number) {
    return this._items?.[index]
  }

  set(index: number, value: T) {
    this.items[index] = this._processValue(value) as T
  }

  push(...items: T[]) {
    for (let item of items) {
      this.items.push(this._processValue(item) as T)
    }
  }

  pop() {
    return this.items.pop()
  }

  * entries(): Generator<[number, ReturnType<P>]> {
    let { items } = this
    let length = items.length
    for (let i = 0; i < length; i++) {
      yield [i, items[i]! as ReturnType<P>]
    }
  }

  * reverseEntries(start = this.items.length - 1): Generator<[number, ReturnType<P>]> {
    let { items } = this
    for (let i = start; i > -1; i--) {
      yield [i, items[i]! as ReturnType<P>]
    }
  }
}
export const last = <T>(list: T[] | ArrayList<T>): T | undefined => {
  if (isArray(list)) {
    return list[list.length - 1]
  }
  if (list instanceof ArrayList) {
    return list.at(list.size - 1)
  }
  return undefined
}

/** A more efficient map (for our needs), with a simple object backing */
export class HashMapOld<
  T extends Record<string, unknown>
> {
  keys: ArrayList<keyof T>
  size: number
  items: T
  processValue?: (value: ValueOf<T>) => ValueOf<T>

  constructor(
    items: T,
    processValue?: (value: ValueOf<T>) => ValueOf<T>
  ) {
    this.items = items
    this.processValue = processValue
    let keys: Array<keyof T> = Object.keys(items)
    this.keys = new ArrayList(keys)
    this.size = this.keys.size
    if (processValue) {
      for (let key of keys) {
        this.items[key] = processValue(this.items[key])
      }
    }
  }

  * [Symbol.iterator](): Generator<ValueOf<T>> {
    for (let key of this.keys) {
      yield this.items[key]
    }
  }

  * entries(): Generator<[keyof T, ValueOf<T>]> {
    for (let key of this.keys) {
      yield [key, this.items[key]]
    }
  }

  * reverse(start = this.size): Generator<ValueOf<T>> {
    for (let key of this.keys.reverse(start)) {
      yield this.items[key]
    }
  }

  has(key: string) {
    return this.keys.has(key)
  }

  get(key: IfNever<keyof T, string, keyof T>): T[keyof T] {
    return this.items[key]
  }

  set<K extends keyof T>(key: K, value: T[K]) {
    const keys = this.keys
    const processValue = this.processValue
    this.items[key] = (processValue ? processValue(value) : value) as T[K]
    if (!keys.has(key)) {
      keys.push(key)
      this.size++
    }
  }
}

/**
 * A dynamic linked list useful for managing items in multiple lists.
 * In other words, rather than linking items together, their positions
 * in a list are managed by the list, much like an array.
 *
 * The items before/after current items are linked multiple times by type.
 * That is, you can think about it like each node setting a map like:
 *   1. What is the next mixin? What is the previous mixin?
 *   2. What is the next property? What is the previous property?
 */
export class NodeList<
  T extends Node = Node
> extends Deque<T> {
  /** A map of nodes to their position in the list */
  private readonly _nodeToPosition = new WeakMap<T, number>()

  constructor(
    values: T[] = []
  ) {
    super(undefined, { bucketSize: 1 << 10 })
    for (let value of values) {
      this.push(value)
    }
  }

  private _setNode(n: T, position: number) {
    this._nodeToPosition.set(n, position)
  }

  reIndex(startIndex = 0) {
    for (let i = startIndex; i < this._length; i++) {
      this._setNode(this.at(i), i)
    }
  }

  set(key: number, value: T) {
    super.setAt(key, value)
    this._setNode(value, key)
  }

  override push(element: T) {
    super.push(element)
    this._setNode(element, this._length - 1)
    return true
  }

  override splice(start: number, deleteCount: number, ...items: T[]) {
    let result = super.splice(start, deleteCount, ...items)
    this.reIndex(start)
    return result
  }

  * entries(): Generator<[number, T]> {
    for (let i = 0; i < this._length; ++i) {
      yield [i, this.at(i)]
    }
  }

  removeItem(n: T) {
    let index = this._nodeToPosition.get(n)
    if (index !== undefined) {
      this.splice(index, 1)
    }
  }

  private _reverse(asEntries: false, start?: T): Generator<T>
  private _reverse(asEntries: true, start?: T): Generator<[number, T]>
  private _reverse(asEntries?: boolean, start?: T): Generator<T>
  private * _reverse(asEntries: boolean = false, start = this.last): Generator<T | [number, T]> {
    let startIndex = (!start || start === this.last)
      ? this._length - 1
      : this._nodeToPosition.get(start) ?? this.length - 1
    for (let i = startIndex; i > -1; i--) {
      yield asEntries ? [i, this.at(i)] : this.at(i)
    }
  }

  * reverseValues(start?: T) {
    yield * this._reverse(false, start)
  }

  * reverseEntries(start?: T) {
    yield * this._reverse(true, start)
  }
}

type IndexedTrieNodeValue = string | Node

function getTrieKey(value: IndexedTrieNodeValue) {
  return typeof value === 'string' ? value : value.valueOf()
}

export const ROOT = Symbol('ROOT')
/**
 * I tried to find something like this that could sufficiently represent
 * a trie that was indexable by key, to make lookups faster for selectors,
 * for the case of mixin calls and extends.
 */
export class IndexedTrie<
  T extends Node = Node,
  S extends symbol = symbol
> {
  static readonly ROOT = ROOT

  private _keySet: Set<string | number> | undefined
  get keySet() {
    return (this._keySet ??= new Set())
  }

  /** This is useful for limiting searches to certain keys */
  _keyMap: BiMap<string | number, Set<T>> | undefined
  get keyMap() {
    return (this._keyMap ??= new BiMap())
  }

  _edgeMaps: Map<T | typeof ROOT, Set<IndexedTrieEdge<T, S>>> | undefined
  get edgeMaps(): Map<T | typeof ROOT, Set<IndexedTrieEdge<T, S>>> {
    return (this._edgeMaps ??= new Map())
  }

  push(value: T) {
    let k = getTrieKey(value)
    this.keySet.add(k)
    let set = this.keyMap.get(k) ?? new Set()
    set.add(value)
    this.keyMap.set(k, set)
  }

  get(key: T | string) {
    let k = getTrieKey(key)
    return this.keyMap.get(k)
  }

  private _addEdge(src: T | typeof ROOT, target: T | IndexedTrie<T, S>, type?: S, value?: IndexedTrieNodeValue) {
    let edge = new IndexedTrieEdge(src, target, type, value)
    let edgeSet = this.edgeMaps.get(src) ?? new Set()
    edgeSet.add(edge)
    this.edgeMaps.set(src, edgeSet)
    return edge
  }

  edgesOf(src: T | typeof ROOT) {
    return this.edgeMaps.get(src)
  }

  addEdge(src: T | typeof ROOT, target: T | IndexedTrie<T, S> | string, type?: S, value?: IndexedTrieNodeValue) {
    if (src !== ROOT && !(src instanceof IndexedTrie)) {
      this.push(src)
    }
    if (target instanceof IndexedTrie) {
      this._keySet = this.keySet.intersection(target.keySet)
      return this._addEdge(src, target, type, value)
    }
    if (typeof target === 'string') {
      let set = this.keyMap.get(target)
      if (set) {
        for (let t of set) {
          this._addEdge(src, t, type, value)
        }
        return this.edgesOf(src)
      }
      return
    }

    return this._addEdge(src, target, type, value)
  }
}

export class IndexedTrieEdge<
  T extends Node = Node,
  S extends symbol = symbol
> {
  constructor(
    public src: T | typeof ROOT | IndexedTrie<T, S>,
    public target: T | IndexedTrie<T, S>,
    public type?: S,
    public value?: IndexedTrieNodeValue
  ) {}
}

/** Simple bi-directional map */
export class BiMap<K, V> {
  private readonly _map!: Map<K, V>
  private readonly _reverse!: Map<V, K>

  constructor(map?: BiMap<K, V>) {
    if (map) {
      this._map = new Map(map._map)
      this._reverse = new Map(map._reverse)
    } else {
      this._map = new Map()
      this._reverse = new Map()
    }
  }

  get [Symbol.iterator]() {
    return this._map[Symbol.iterator]
  }

  values() {
    return this._map.values()
  }

  get(key: K) {
    return this._map.get(key)
  }

  has(key: K) {
    return this._map.has(key)
  }

  getValue(value: V) {
    return this._reverse.get(value)
  }

  set(key: K, value: V) {
    this._map.set(key, value)
    this._reverse.set(value, key)
  }

  clear() {
    this._map.clear()
    this._reverse.clear()
  }

  delete(key: K) {
    let value = this._map.get(key)
    if (value) {
      this._map.delete(key)
      this._reverse.delete(value)
    }
  }

  get size() {
    return this._map.size
  }
}