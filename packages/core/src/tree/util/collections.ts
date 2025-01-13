// import type { Primitive, Node } from '../node'
// import isObject from 'lodash-es/isObject'

// type ListNodeValue = Primitive | Node | LinkedListNode | NodeWithLists

// /**
//  * Object wrapper for primitives
//  */
// class LinkedListNode<T extends Primitive = Primitive> implements NodeWithLists {
//   private _lists: LinkedList<LinkedList> | undefined
//   get lists(): LinkedList<LinkedList> {
//     return (this._lists ??= new LinkedList())
//   }

//   constructor(public value: T) {}
// }

// interface NodeWithLists {
//   get lists(): LinkedList<LinkedList>
// }

// /** We have to account for a type of undefined */
// type ListKey<T> =
//   undefined extends T
//     ? string
//     : T extends Primitive ? string : number

// type PrimitiveSet<T extends ListNodeValue> = Exclude<T, Node | NodeWithLists>

// export class LinkedList<
//   T extends ListNodeValue = ListNodeValue,
//   Key extends string | number = ListKey<T>
// > implements NodeWithLists {
//   /**
//    * These maps are designed for fast lookups,
//    * map cloning, and replacing items.
//    */

//   /** A map of numbers to nodes */
//   private readonly _items = new BiMap<number, T | LinkedListNode<PrimitiveSet<T>>>()
//   /** A map of a numbered node to the before / after as a joined number */
//   private readonly _pos = new Map<number, number>()
//   first: number | undefined
//   last: number | undefined
//   private _current: number | undefined
//   private _index = 0

//   private _lists: LinkedList<LinkedList> | undefined
//   get lists(): LinkedList<LinkedList> {
//     return (this._lists ??= new LinkedList())
//   }

//   constructor(items?: T[]) {
//     if (items?.length) {
//       this.push(...items)
//     }
//   }

//   clear() {
//     this._items.clear()
//     this._pos.clear()
//     this.first = undefined
//     this.last = undefined
//     this._current = undefined
//   }

//   set(key: Key, value: T) {
//     this._items.set(key as number, value)
//   }

//   push(...items: T[]) {
//     let index = ++this._index
//     let lastIndex: number | undefined
//     if (items.length) {
//       this.first = 1
//     }
//     const { _items, _pos } = this
//     _items.clear()
//     _pos.clear()
//     let length = items.length
//     for (; index <= length; index++) {
//       if (lastIndex) {
//         this._writeNextPos(lastIndex, index)
//       }
//       let item: T | LinkedListNode = items[index - 1]!
//       if (!isObject(item)) {
//         item = new LinkedListNode(item)
//       }
//       lastIndex = index
//       _items.set(index, item as T)
//       this._writePos(index, index - 1, 0)
//       item.lists.push(this)
//     }
//     /** The last thing a for loop does is increment, so subtract the last iteration */
//     this._index = index - 1
//     this.last = lastIndex
//   }

//   private _writePos(nodeRef: number, previous: number | undefined, next: number | undefined) {
//     if (nodeRef === previous || nodeRef === next) {
//       throw new Error('Linking a node to itself would cause an infinite loop.')
//     }
//     this._pos.set(nodeRef, (previous ?? 0) << 16 | (next ?? 0))
//   }

//   private _writeNextPos(nodeRef: number, next: number | undefined) {
//     let pos = this._pos.get(nodeRef)
//     if (pos !== undefined) {
//       /** Read previous, and write next */
//       this._writePos(nodeRef, this._getPrevFromBits(pos), next)
//     }
//   }

//   private _writePrevPos(nodeRef: number, previous: number | undefined) {
//     let pos = this._pos.get(nodeRef)
//     if (pos !== undefined) {
//       /** Read next, and write previous */
//       this._writePos(nodeRef, previous, this._getNextFromBits(pos))
//     }
//   }

//   private _getPrevFromBits(pos: number | undefined): number | undefined {
//     if (pos === undefined) {
//       return undefined
//     }
//     let previous = (pos >>> 16) & 0xFFFF // Extract the upper 16 bits
//     return previous === 0 ? undefined : previous
//   }

//   private _getNextFromBits(pos: number | undefined): number | undefined {
//     if (pos === undefined) {
//       return undefined
//     }
//     let next = pos & 0xffff // Extract the lower 16 bits
//     return next === 0 ? undefined : next
//   }
// }

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