/* eslint-disable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-plus-operands, @typescript-eslint/no-invalid-void-type */
import isPlainObject from 'lodash-es/isPlainObject'
import {
  type Context,
  type TreeContext
} from '../context'
import type { Visitor } from '../visitor'
import type { Comment } from './comment'
import { type Operator } from './util/calculate'
// import type { OutputCollector } from '../output'
import type { Constructor, Writable, Class, ValueOf, Opaque, IsUnknown } from 'type-fest'

export type { TreeContext }

const { isArray } = Array

type AllNodeOptions = {
  hoistToRoot?: boolean
  hoistToParent?: boolean

  /**
   * For statements with optional semis,
   * we flag this for accurate re-serialization.
   */
  semi?: boolean
}

export const ABORT: unique symbol = Symbol('ABORT')
export const REMOVE: unique symbol = Symbol('REMOVE')
export type NodeVisitReturn = void | Node | symbol
export type NodeVisitFunction = (n: Node) => NodeVisitReturn
export type NodeOptions = Record<string, boolean | string | number> & AllNodeOptions
export type NodeValue = unknown
export type NodeMap = Map<string, NodeValue>
export type NodeInValue = NodeValue | NodeMapArray | NodeMap
export type NodeTypeMap = {
  value: unknown
  [k: string]: unknown
}

export type NodeMapArray<
  T extends NodeTypeMap = NodeTypeMap,
  K = keyof T,
  V = T[string]
> = Array<[K, V]>

export type LocationInfo = [
  startOffset: number,
  startLine: number,
  startColumn: number,
  endOffset: number,
  endLine: number,
  endColumn: number,
]

/**
 * Assume the value is a NodeMap if it's an array of arrays
 *
 * This just checks that it can be safely passed to `new Map()`
 */
export const isNodeMap = (val: any): val is NodeMap | NodeMapArray => {
  return val instanceof Map || (isArray(val) && isArray(val[0]))
}

export const defineType = <
  V = never,
  T extends Class<Node> = Class<Node>,
  P extends ConstructorParameters<T> = ConstructorParameters<T>
>(
    Clazz: T,
    type: string,
    shortType?: string
  ) => {
  shortType ??= type.toLowerCase()
  ;(Clazz.prototype as Writable<typeof Clazz.prototype>).type = type
  ;(Clazz.prototype as Writable<typeof Clazz.prototype>).shortType = shortType

  type Args = [value?: P[0] | V, location?: P[1], options?: P[2], treeContext?: P[3]]
  return (...args: Args) => {
    /** Allow objects to be passed into the public form */
    let value = args[0]
    if (isPlainObject(value)) {
      args[0] = new Map(Object.entries(value as Record<string, any>))
    }
    return new Clazz(...args) as T extends Class<infer C> ? InstanceType<Class<C, Args>> : never
  }
}

/**
 * Couldn't find this elsewhere in the wild.
 * This strongly binds Map keys to values based
 * on a passed-in interface.
 */
export type TypedMap<
  T extends NodeTypeMap = NodeTypeMap,
  K extends keyof T = keyof T,
  V = ValueOf<T>
> = Omit<Map<any, any>, 'get' | 'set'> & {
  /**
   * TypeScript sometimes gets confused
   * about whether or not get / set will exist,
   * so this fixes it.
   */
  get(key: K): any
  set(key: K, value: V): any
} & {
  [P in K as 'get']: <U extends P>(key: U) => T[U]
} & {
  [P in K as 'set']: <U extends P>(key: U, value: T[U]) => TypedMap<T>
}

/**
 * @todo - this allows excess properties on T,
 * but using `Exact` from type-fest caused other issues
 */
type NodeMapType<T> = T extends NodeTypeMap ? T : { value: T }

type CollectionType<T> =
  T extends Array<infer U>
    ? U[]
    : T extends Map<infer K, infer V>
      ? Map<K, V>
      : T extends Set<infer U> ? Set<U> : never

type CollectionPair<T> =
  T extends Array<infer U>
    ? [number, U]
    : T extends Map<infer K, infer V>
      ? [K, V]
      : T extends Set<infer U> ? [U, U] : never

type Values<T, K extends keyof T = keyof T> = T[K]

export type NodeValueArray<T extends NodeTypeMap> = Array<Values<{
  [K in keyof T]: [K, T[K]]
}>>

export type NodeValueArg<M extends NodeTypeMap> =
  IsUnknown<M['value']> extends true
    ? TypedMap<M> | NodeValueArray<M>
    : TypedMap<M> | NodeValueArray<M> | M['value']

/**
 * The underlying type for all Jess nodes
 */
export abstract class Node<
  T = unknown,
  O extends NodeOptions = NodeOptions,
  M extends NodeTypeMap = NodeMapType<T>
> {
  location: LocationInfo | []
  _treeContext: TreeContext | undefined
  readonly treeContext!: TreeContext

  _options: Partial<O & AllNodeOptions> | undefined

  /** Assigned on the prototype */
  type!: string
  shortType!: string

  /** Indicates if this can be used wherever a selector is used */
  isSelector = false

  /**
   * Whitespace or comments before or after a Node.
   *
   * If this is `1`, it represents a single space character (' ').
   * If it's 0, it means there were no tokens whatsoever.
   * In array, if it's whitespace, it's representing literal whitespace.
   */
  pre: Array<string | Comment> | 1 | 0 = 0
  post: Array<string | Comment> | 1 | 0 = 0

  visible = true

  evaluated = false

  /** Assigned on the prototype */
  allowRoot!: boolean
  /** Assigned on the prototype */
  allowRuleRoot!: boolean

  /**
   * If the node must have a semi separator before
   * the next node when in a declaration list or main
   * rules list.
   *
   * Defined on the prototype
   */
  requiredSemi!: boolean

  /** Used by Rules */
  rootRules: Node[] | undefined

  /**
   * This should always represent the `data` of the Node
   */
  protected readonly data: TypedMap<M>

  constructor(
    value: NodeValueArg<M>,
    options?: O,
    location?: LocationInfo | 0,
    treeContext?: TreeContext
  ) {
    this.data = new Map(isNodeMap(value) ? value : [['value', value]]) as TypedMap<M>
    this.location = location || []
    this._treeContext = treeContext
    if (treeContext) {
      this.walkNodes(n => {
        n._treeContext = treeContext
      }, true)
    }
    this._options = options
  }

  get options(): Partial<O & AllNodeOptions> {
    let opts = this._options
    if (!opts) {
      opts = this._options = {} as Partial<O & AllNodeOptions>
    }
    return opts
  }

  get value() {
    return this.data.get('value')
  }

  set value(n: M['value']) {
    if (this.data.has('value')) {
      this.data.set('value', n)
      return
    }
    throw new Error('Cannot set the "value" property of this node.')
  }

  get values(): M {
    return Object.fromEntries(this.data)
  }

  /** NodeList-related properties */
  private _lists: NodeList<NodeList> | undefined
  get lists(): NodeList<NodeList> {
    return (this._lists ??= new NodeList())
  }

  remove() {
    if (this._lists) {
      for (let list of this.lists) {
        list.removeItem(this)
      }
    }
  }

  /**
   * Mutates node children in place. Used by eval()
   * which first makes a shallow clone before mutating.
   *
   * @todo - Rewrite to use NodeList
   */
  processNodes(func: (n: Node) => NodeValue) {
    this.data.forEach((nodeVal, key, map) => {
      /** Process Node arrays only */
      if (isArray(nodeVal)) {
        let out = []
        for (let i = 0; i < nodeVal.length; i++) {
          let node = nodeVal[i]
          let result = node instanceof Node ? func(node) : node
          if (result ?? false) {
            out.push(result)
          }
        }
        /** Assume that the type will still be valid */
        map.set(key, out as M[typeof key])
      } else if (nodeVal instanceof Node) {
        /** Assume that the type will still be valid */
        map.set(key, func(nodeVal) as typeof nodeVal)
      }
    })
  }

  /**
   * Like a forEach, but calls each function
   * for the iterable, resolves it in parallel,
   * and finally awaits the Promise.all of results.
   */
  async forEachPromise<
    T extends any[] | Map<any, any> | Set<any>,
    P extends CollectionPair<T> = CollectionPair<T>,
    I extends CollectionType<T> = CollectionType<T>
  >(iterable: T, func: (value: P[1], key: P[0], container: I) => Promise<void>) {
    let promises: Array<Promise<void>> = []
    iterable.forEach((value, key, container) => {
      promises.push(func(value, key, container as I))
    })
    await Promise.all(promises)
  }

  /**
   * Mutates node children in place. Used by eval()
   * which first makes a shallow clone before mutating.
   */
  async processNodesAsync(func: (n: Node) => NodeValue | Promise<NodeValue>) {
    let map = this.data as Map<string, any>
    await this.forEachPromise(map, async (nodeVal, key) => {
      /**
       * For each member of the map, we create an async function
       * that we call, which returns a promise.
       *
       * This allows calls like eval() to resolve in parallel,
       * which means some nodes can be evaluated after things
       * like async file operations and dynamic imports.
       */
      /** Process Node arrays only */
      if (isArray(nodeVal)) {
        let out = []
        for (let i = 0; i < nodeVal.length; i++) {
          let node = nodeVal[i]
          let result = node instanceof Node ? await func(node) : node
          if (result ?? false) {
            out.push(result)
          }
        }
        /** Assume that the type will still be valid */
        map.set(key, out)
      } else if (nodeVal instanceof Node) {
        /** Assume that the type will still be valid */
        map.set(key, await func(nodeVal))
      }
    })
  }

  /**
   * Mutate nodes in place, used in walkNodes
   *
   * @todo - rewrite to use NodeList
   */
  private _processValueArray(
    arr: any[],
    fn: NodeVisitFunction,
    shallow?: boolean,
    visitPrePost?: boolean
  ) {
    let length = arr.length
    for (let i = 0; i < length; i++) {
      let node = arr[i]
      if (node instanceof Node) {
        let returnVal = fn(node)
        if (returnVal === ABORT) {
          return ABORT
        } else if (returnVal === REMOVE) {
          arr.splice(i, 1)
          i--
          length--
        } else if (returnVal instanceof Node && returnVal !== node) {
          arr[i] = returnVal
        }
        if (!shallow) {
          node.walkNodes(fn, false, 'ltr', visitPrePost)
        }
      }
    }
  }

  /** @todo - rewrite to use NodeList */
  private _processValueArrayReverse(
    arr: any[],
    fn: NodeVisitFunction,
    shallow?: boolean,
    visitPrePost?: boolean
  ) {
    let length = arr.length
    for (let i = length - 1; i >= 0; i--) {
      let node = arr[i]
      if (node instanceof Node) {
        let returnVal = fn(node)
        if (returnVal === ABORT) {
          return ABORT
        } else if (returnVal === REMOVE) {
          arr.splice(i, 1)
          i++
          length--
        } else if (returnVal instanceof Node && returnVal !== node) {
          arr[i] = returnVal
        }
        if (!shallow) {
          node.walkNodes(fn, false, 'rtl', visitPrePost)
        }
      }
    }
  }

  /**
   * Fire a function for each Node in the tree, recursively.
   * This method can optionally mutate the tree in place,
   * if the callback function returns a Node.
   *
   * @note
   * A Node return value is intended to be a mutation.
   * A return value of `false` (ABORT) means to abort the walk.
   * A return value of `null` (REMOVE) means to remove the current node.
   */
  walkNodes(
    func: NodeVisitFunction,
    shallow?: boolean,
    direction?: 'ltr' | 'rtl',
    visitPrePost?: boolean
  ) {
    if (visitPrePost) {
      let { pre, post } = this
      if (isArray(pre)) {
        if (direction === 'rtl') {
          this._processValueArrayReverse(pre, func, true)
        } else {
          this._processValueArray(pre, func, true)
        }
      }
      if (isArray(post)) {
        if (direction === 'rtl') {
          this._processValueArrayReverse(post, func, true)
        } else {
          this._processValueArray(post, func, true)
        }
      }
    }
    for (const [key, nodeVal] of this.data.entries()) {
      /** Process Node arrays only */
      if (isArray(nodeVal)) {
        if (direction === 'rtl') {
          return this._processValueArrayReverse(nodeVal, func, shallow, visitPrePost)
        }
        return this._processValueArray(nodeVal, func, shallow, visitPrePost)
      } else if (nodeVal instanceof Node) {
        let returnVal = func(nodeVal)
        if (returnVal === ABORT) {
          return ABORT
        } else if (returnVal === REMOVE) {
          /** @note It's up to the author to make sure this key can be set to undefined! */
          this.data.set(key, undefined as M[typeof key])
        } else if (returnVal instanceof Node && returnVal !== nodeVal) {
          this.data.set(key, returnVal as M[typeof key])
        }
        if (!shallow) {
          nodeVal.walkNodes(func, false, direction, visitPrePost)
        }
      }
    }
  }

  collectRoots(): Node[] {
    let nodes = new Set<Node>()
    this.walkNodes(n => {
      if (n.type === 'Rules') {
        if (n.rootRules) {
          n.rootRules.forEach(n => nodes.add(n))
          n.rootRules = []
        }
      }
    })
    return Array.from(nodes)
  }

  accept(visitor: Visitor) {
    this.processNodes(n => visitor.visit(n))
  }

  /**
   * Creates a copy of the current node.
   */
  clone(deep?: boolean, cloneFn?: (n: Node) => NodeValue): this {
    let Class: Constructor<this> = Object.getPrototypeOf(this).constructor

    let newNode = new Class(
      /**
       * Creates a new Map object instance.
       * Otherwise, replacing nodes would replace them
       * in the old map.
       */
      new Map(this.data),
      this._options,
      this.location,
      this.treeContext
    )

    cloneFn ??= n => n.clone(deep)

    if (deep) {
      newNode.processNodes(cloneFn)
    }
    newNode.pre = this.pre
    newNode.post = this.post
    newNode.evaluated = this.evaluated

    return newNode
  }

  /** Remove comments from pre/post */
  stripPrePost(prePost: Node['pre']) {
    if (isArray(prePost)) {
      return prePost.filter(p => !(p instanceof Node && p.type === 'Comment'))
    }
    return prePost
  }

  /**
   * Same as clone except comments are stripped.
   * This is used for variable referencing and
   * selector extending.
   */
  copy(deep?: boolean): this {
    const newNode = this.clone(
      deep,
      n => {
        if (n.type !== 'Comment') {
          const copy = n.copy(deep)
          return copy
        }
      }
    )
    newNode.pre = this.stripPrePost(this.pre)
    newNode.post = this.stripPrePost(this.post)

    return newNode
  }

  /**
   * Individual nodes will specify type
   * when overriding eval()
   */
  async eval(context: Context): Promise<Node> {
    return await this.evalIfNot(context, async () => {
      let node = this.clone()
      await node.processNodesAsync(async (n) => await n.eval(context))
      return node
    })
  }

  /**
   * @note - this should be used if we're conditionally evaluating
   * and then inheriting. It allows you to call eval() without
   * penalty, if you're not sure if a node has been evaluated.
   */
  protected async evalIfNot<T extends Node = Node>(context: Context, func: () => T | Promise<T>): Promise<T> {
    if (!this.evaluated) {
      let node = await func()
      if (!node.evaluated) {
        node.inherit(this)
        node.evaluated = true
      }
      return node
    }
    return this as unknown as T
  }

  /** Override normally readonly props to make them inheritable */
  inherit(node: Node) {
    (this as Writable<this>).location = node.location
    ;(this as Writable<this>)._treeContext = node._treeContext
    this.evaluated = node.evaluated
    this.pre = node.pre
    this.post = node.post
    return this
  }

  /**
   * Represents the normalized string value of the node,
   * for the purposes of comparison with other nodes,
   * regardless of type.
   *
   * Derived nodes will override this with different
   * normalization algorithms.
   */
  valueOf(): string | number {
    let values = [...this.data.values()]
    if (values.length === 1) {
      return `${values[0]}`
    }
    return `${values}`
  }

  processPrePost(key: 'pre' | 'post') {
    let value = this[key]
    if (value === 0) {
      return ''
    } else if (value === 1) {
      return ' '
    } else {
      let output = ''
      output += value
        .map(v => `${v}`)
        .join('')
      return output
    }
  }

  /**
   * This re-serializes the node, if needed. Will
   * likely be over-ridden in some cases.
   *
   * Note that this is the "as-is" representation of the
   * node, not the "evaluated" version.
   *
   * Note that the ToCssVisitor will be a little
   * more sophisticated, as it will re-format
   * to some extent by replacing newlines + spacing
   * with the appropriate amount of whitespace.
   *
   * @note toString() will, by default, include pre/post
   * white-space and comments, to make serialization
   * easy.
   *
   * @note The Opaque type is just a sanity check to
   * make sure we don't override
   */
  toString(depth?: number): Opaque<string> { // eslint-disable-line @typescript-eslint/naming-convention
    if (!this.visible) {
      return '' as Opaque<string>
    }
    let output = ''
    output += this.processPrePost('pre')
    output += this.toTrimmedString(depth)
    output += this.processPrePost('post')
    if (this.options?.semi === true) {
      output += ';'
    }
    return output as Opaque<string>
  }

  /**
   * The form of the node without pre/post comments and white-space
   *
   * @note - Internally, this still calls `toString()` on each value,
   * so that the internal spacing of the node serialization is
   * correct. This method just serializes a node without the outer
   * pre/post nodes.
   */
  toTrimmedString(depth?: number) {
    let output = ''
    this.data.forEach(value => {
      if (isArray(value)) {
        output += value.join('')
      } else {
        output += `${value}`
      }
    })
    return output
  }

  /**
   * Individual node types will override this.
   *
   * This is just a default implementation.
   * 0 = equal (==)
   * 1 = greater than (>)
   * -1 = less than (<)
   * undefined = not comparable
   */
  compare(b: Node, context?: Context): 0 | 1 | -1 | undefined {
    let aVal = this.valueOf()
    let bVal = b.valueOf()
    if (aVal === bVal) {
      return 0
    }
    return aVal > bVal ? 1 : -1
  }

  /** Overridden in index.ts to avoid circularity */
  operate(b: Node, op: Operator, context?: Context): Node {
    return this
  }

  static numericCompare(a: number, b: number) {
    if (a === b) {
      return 0
    } else if (a > b) {
      return 1
    } else {
      return -1
    }
  }

  /**
   * Generates a .js module
   * @todo - Generate a .ts module & .js.map
   */
  /** Move to ToModuleVisitor */
  // toModule?(context: Context, out: OutputCollector): void
}

/** Simple bi-directional map */
class BiMap<K, V> {
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

/**
 * A dynamic linked list useful for managing items in multiple lists.
 * In other words, rather than linking items together, their positions
 * in a list are managed by the list, much like an array.
 */
export class NodeList<
  T extends Node = Node,
  O extends NodeOptions = NodeOptions
> extends Node<{ value: T[] }, O> {
  first: number | undefined
  last: number | undefined
  private _current: number | undefined
  /**
   * These maps are designed for fast lookups,
   * map cloning, and replacing Nodes.
   */

  /** A map of numbers to nodes */
  private _items = new BiMap<number, T>()
  /** A map of a numbered node to the before / after as a joined number */
  private _pos = new Map<number, number>()
  private _index = 0

  constructor(
    values: T[] = [],
    options?: O,
    location?: LocationInfo | 0,
    treeContext?: TreeContext
  ) {
    /** There's a custom getter for `value` */
    super(undefined as unknown as T[], options, location, treeContext)
    /**
     * Passing a Map should really only be done when
     * cloning, which we will override.
     */
    if (isArray(values)) {
      this.setMany(values)
    }
  }

  writePos(nodeRef: number, previous: number | undefined, next: number | undefined) {
    this._pos.set(nodeRef, (previous ?? 0) << 16 | (next ?? 0))
  }

  writeNextPos(nodeRef: number, next: number | undefined) {
    let pos = this._pos.get(nodeRef)
    if (pos !== undefined) {
      this._pos.set(nodeRef, pos & 0xffff | (next ?? 0) << 16)
    }
  }

  writePrevPos(nodeRef: number, previous: number | undefined) {
    let pos = this._pos.get(nodeRef)
    if (pos !== undefined) {
      this._pos.set(nodeRef, (previous ?? 0) << 16 | pos & 0xffff)
    }
  }

  readPos(nodeRef: number): [previous: number | undefined, next: number | undefined] {
    let pos = this._pos.get(nodeRef)
    if (!pos) {
      return [undefined, undefined]
    }
    let previous: number | undefined = pos >>> 16
    previous = previous === 0 ? undefined : previous
    let next: number | undefined = pos & 0xffff
    next = next === 0 ? undefined : next
    return [previous, next]
  }

  /** Return an array */
  get value() {
    return [...this]
  }

  setMany(values: T[]) {
    let index = 1
    let lastIndex: number | undefined
    if (values.length) {
      this.first = 0
    }
    const { _items, _pos } = this
    _items.clear()
    _pos.clear()
    let length = values.length
    for (; index < length; index++) {
      if (lastIndex) {
        this.writeNextPos(lastIndex, index)
      }
      let item = values[index - 1]!
      lastIndex = index
      _items.set(index, item)
      this.writePos(index, index - 1, 0)
      item.lists.add(this)
    }
    this._index = index
    this.last = index
  }

  /** Clones of node lists need to be a bit different */
  clone(deep?: boolean, cloneFn?: (n: Node) => NodeValue): this {
    let Class: Constructor<this> = Object.getPrototypeOf(this).constructor

    let newNode = new Class(
      /**
       * Creates a new Map object instance.
       * Otherwise, replacing nodes would replace them
       * in the old map.
       */
      undefined,
      this._options,
      this.location,
      this.treeContext
    )

    cloneFn ??= n => n.clone(deep)
    newNode._items = new BiMap(this._items)
    newNode._pos = new Map(this._pos)

    if (deep) {
      for (let [index, node] of newNode._items) {
        /** @todo - deal with deletions or NodeList returns */
        newNode._items.set(index, node.clone(deep, cloneFn))
      }
    }
    newNode.pre = this.pre
    newNode.post = this.post
    newNode.evaluated = this.evaluated

    return newNode
  }

  get size() {
    return this._items.size
  }

  add(item: T) {
    let index = this._index++
    if (!this.first) {
      this.first = index
    }
    let last = this.last
    if (last) {
      this.writeNextPos(last, index)
    }
    this._items.set(index, item)
    this.writePos(index, last, 0)
    this.last = index
  }

  insertBefore(before: T, item: T) {
    let index = this._items.getValue(before)
    if (index === undefined) {
      return
    }
    let [previous] = this.readPos(index)
    let insertionIndex = this._index++
    this.writePos(insertionIndex, previous, index)
    this._items.set(insertionIndex, item)
    if (index === this.first) {
      this.first = insertionIndex
    }
  }

  insertAfter(after: T, item: T) {
    let index = this._items.getValue(after)
    if (index === undefined) {
      return
    }
    let [,next] = this.readPos(index)
    let insertionIndex = this._index++
    this.writeNextPos(index, insertionIndex)
    this.writePos(insertionIndex, index, next)
    this._items.set(insertionIndex, item)
    if (index === this.last) {
      this.last = insertionIndex
    }
  }

  * [Symbol.iterator]() {
    let currentIndex = this._current = this.first
    if (currentIndex === undefined) {
      return
    }
    let current = this._items.get(currentIndex)
    while (current !== undefined) {
      yield current
      /**
       * this._current pointer may change because of deletions,
       * but if it's still the same pointer, then increment it
       * to the next position.
       */
      currentIndex = this._current
      if (currentIndex !== undefined) {
        const nextPos = this.readPos(currentIndex)[1]
        console.log(nextPos)
        current = nextPos ? this._items.get(nextPos) : undefined
      } else {
        current = undefined
      }
    }
  }

  * reverse() {
    let currentIndex = this._current = this.first
    if (currentIndex === undefined) {
      return
    }
    let current = this._items.get(currentIndex)
    while (current !== undefined) {
      yield current
      /**
     * this._current pointer may change because of deletions,
     * but if it's still the same pointer, then increment it
     * to the next position.
     */
      currentIndex = this._current
      if (currentIndex !== undefined) {
        const prevPos = this.readPos(currentIndex)[0]
        current = prevPos ? this._items.get(prevPos) : undefined
      } else {
        current = undefined
      }
    }
  }

  removeItem(item: T) {
    let index = this._items.getValue(item)
    if (index === undefined) {
      return
    }
    let [previous, next] = this.readPos(index)
    if (previous) {
      this.writeNextPos(previous, next)
    }
    if (next) {
      this.writePrevPos(next, previous)
    }
    this._items.delete(index)
    if (index === this.first) {
      this.first = next
    }
    if (index === this.last) {
      this.last = previous
    }
    if (index === this._current) {
      this._current = next
    }
    item.lists.removeItem(this)
    if (this._items.size === 0) {
      this.remove()
    }
  }
}