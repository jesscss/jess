import { type Node } from '../node'

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