import type { Node } from '../node'

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

  _reverse(asEntries?: false, start?: NODE_INDEX): Generator<NODE_INDEX, void, any>
  _reverse(asEntries: true, start?: NODE_INDEX): Generator<[NODE_INDEX, NODE_INDEX], void, any>
  * _reverse(asEntries = false, start = this.last) {
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

  _keySet: Set<string | number> | undefined
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