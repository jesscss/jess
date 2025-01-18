/* eslint-disable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-plus-operands, @typescript-eslint/no-invalid-void-type */
import isPlainObject from 'lodash-es/isPlainObject'
import {
  type Context,
  type TreeContext
} from '../context'
import type { Visitor } from '../visitor'
import type { Comment } from './comment'
import type { Token } from './token'
import { type Operator } from './util/calculate'
import type { Constructor, Writable, Class, ValueOf, Opaque, IsUnknown, UnionToTuple } from 'type-fest'
import { BiMap } from './util/collections'
import { type Nil } from './nil'

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

export type Primitive = boolean | string | number | ((...args: any[]) => any)

export const ABORT: unique symbol = Symbol('ABORT')
export const REMOVE: unique symbol = Symbol('REMOVE')
export const CREATE_LIST: unique symbol = Symbol('CREATE_LIST')
export type NodeVisitReturn = void | Node | symbol
type NodeVisitFunction = (n: Node) => NodeVisitReturn
export type NodeOptions = Record<string, boolean | string | number> & AllNodeOptions
export type NodeValue = Primitive | Node | Node[]
export type NodeMap = Map<string, NodeValue>
export type NodeValueObject = Record<string, NodeValue>

export type NodeMapArray<
  T extends NodeValueObject = NodeValueObject,
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
    return new Clazz(...args) as T extends Class<infer C> ? InstanceType<Class<C, Args>> : never
  }
}

/**
 * Couldn't find this elsewhere in the wild.
 * This strongly binds Map keys to values based
 * on a passed-in interface.
 */
type TypedMap<
  T extends NodeValueObject = NodeValueObject,
  K extends keyof T = keyof T,
  V = ValueOf<T>
> = Omit<Map<any, any>, 'get' | 'set'> & {
  [P in K as 'get']: <U extends P>(key: U) => T[U]
} & {
  [P in K as 'set']: <U extends P>(key: U, value: T[U]) => TypedMap<T>
} & {
  /**
   * TypeScript sometimes gets confused
   * about whether or not get / set will exist,
   * so this fixes it.
   */
  get(key: any): any
  set(key: any, value: any): any
  entries(): IterableIterator<[K, V]>
  values(): IterableIterator<V>
}

/**
 * @todo - this allows excess properties on T,
 * but using `Exact` from type-fest caused other issues
 */
export type NodeMapType<T> = T extends NodeValueObject ? T : { _value: T }

type CollectionPair<T> =
  T extends Map<infer K, infer V>
    ? [K, V]
    : T extends NodeList<infer N> ? [number, N] : never

type Values<T, K extends keyof T = keyof T> = T[K]

export type NodeValueArray<T extends NodeValueObject> = UnionToTuple<Values<{
  [K in keyof T]: [K, T[K]]
}>>

export type NodeValueItem<T extends NodeValueObject> = Values<{
  [K in keyof T]: [K, T[K]]
}>

export type NodeValueArg<M extends NodeValueObject> =
  IsUnknown<M['value']> extends true
    ? TypedMap<M> | NodeValueArray<M>
    : TypedMap<M> | NodeValueArray<M> | M['value']

export type NodeData<T> =
  T extends Node[]
    ? NodeList<T[0]>
    : T extends NodeValueObject
      ? TypedMap<T>
      : T extends NodeValue
        ? TypedMap<NodeMapType<T>>
        : never

type NodeInValue<T> =
  T extends Node[]
    ? NodeList<T[0]>
    : T extends NodeValueObject
      ? TypedMap<T> | T
      : T

type NodeTypes = Primitive | Node[] | NodeValueObject

type NarrowTypes<T> =
  IsUnknown<T> extends true
    ? NodeTypes
    : T extends NodeTypes
      ? T
      : never

/**
 * The underlying type for all Jess nodes
 */
export abstract class Node<
  Type = unknown,
  O extends NodeOptions = NodeOptions,
  T extends NarrowTypes<Type> = NarrowTypes<Type>,
> {
  location!: LocationInfo | []
  _treeContext: TreeContext | undefined
  readonly treeContext!: TreeContext

  _options: Partial<O & AllNodeOptions> | undefined

  /**
   * Assigned on the prototype, make sure we don't initialize
   */
  declare type: string
  declare shortType: string

  /** Indicates if this can be used wherever a selector is used */
  isSelector = false

  /**
   * Whitespace or comments before or after a Node.
   *
   * If this is `1`, it represents a single space character (' ').
   * If it's 0, it means there were no pre/post tokens when parsed.
   * If undefined, it means this was created using the API, and default
   * formatting can be used.
   * In a NodeList, any whitespace tokens outside of comments are individually represented,
   * because they are preserved while the comment may not be.
   */
  pre: NodeList<Comment | Token> | 1 | 0 | undefined
  post: NodeList<Comment | Token> | 1 | 0 | undefined

  visible = true

  evaluated = false

  /** Assigned on the prototype */
  declare allowRoot: boolean
  /** Assigned on the prototype */
  declare allowRuleRoot: boolean

  /**
   * If the node must have a semi separator before
   * the next node when in a declaration list or main
   * rules list.
   *
   * Defined on the prototype
   */
  declare requiredSemi: boolean

  /** Used by Rules */
  rootRules: NodeList | undefined

  /**
   * This should always represent the `data` of the Node
   */
  protected data!: NodeData<T>

  nil!: () => Nil

  constructor(
    value: NodeInValue<T>,
    options?: O,
    location?: LocationInfo | 0,
    treeContext?: TreeContext
  ) {
    if ((value as any) !== CREATE_LIST) {
      this._setUpNode(value, options, location, treeContext)
    }
  }

  protected _setUpNode(
    value: unknown,
    options?: O,
    location?: LocationInfo | 0,
    treeContext?: TreeContext
  ) {
    this.data = (value instanceof NodeList
      ? value
      : new Map(
        isPlainObject(value)
          ? Object.entries(value as Record<string, NodeValue>)
          : isNodeMap(value)
            ? value as Map<any, any>
            : [['_value', value]]
      )
    ) as NodeData<T>

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

  get value(): Type {
    const data = this.data
    if (data instanceof NodeList) {
      return [...data] as Type
    }
    if (data.has('_value')) {
      return data.get('_value') as Type
    }
    return Object.fromEntries(data)
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
   * Processed nodes must always return a Node.
   */
  processNodes(func: (n: Node) => Node) {
    for (let [key, nodeVal] of this.data.entries()) {
      if (nodeVal instanceof Node) {
        /** Assume that the type will still be valid */
        (this.data as MapLike<any, any>).set(key, func(nodeVal))
      }
    }
  }

  /**
   * Like a forEach, but calls each function
   * for the iterable, resolves it in parallel,
   * and finally awaits the Promise.all of results.
   */
  async forEachPromise<
    T extends MapLike<any, any>,
    P extends CollectionPair<T> = CollectionPair<T>
  >(iterable: T, func: (value: P[1], key: P[0], container: T) => Promise<void>) {
    let promises: Array<Promise<void>> = []
    for (let [key, value] of iterable.entries()) {
      promises.push(func(value, key, iterable))
    }
    await Promise.all(promises)
  }

  /**
   * Mutates node children in place. Used by eval()
   * which first makes a shallow clone before mutating.
   *
   * @todo - There should be no node arrays
   */
  async processNodesAsync(func: (n: Node) => Node | Promise<Node>) {
    let map = this.data
    await this.forEachPromise(map, async (nodeVal, key) => {
      /**
       * For each member of the map, we create an async function
       * that we call, which returns a promise.
       *
       * This allows calls like eval() to resolve in parallel,
       * which means some nodes can be evaluated after things
       * like async file operations and dynamic imports.
       */
      /** Process Nodes only */
      if ((nodeVal as any) instanceof Node) {
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
  private _processNodeList(
    list: NodeList,
    fn: NodeVisitFunction,
    shallow?: boolean,
    visitPrePost?: boolean,
    reverse?: boolean
  ) {
    let method: 'entries' | 'reverseEntries' = reverse ? 'reverseEntries' : 'entries'
    for (let [key, node] of list[method]()) {
      let returnVal = fn(node)
      if (returnVal === ABORT) {
        return ABORT
      } else if (returnVal === REMOVE) {
        node.remove()
      } else if (returnVal instanceof Node && returnVal !== node) {
        list.set(key, returnVal)
      }
      if (!shallow) {
        node.walkNodes(fn, false, reverse, visitPrePost)
      }
    }
  }

  /**
   * Return an iterator for all nodes / children nodes, including this one
   */
  * nodes(): Generator<Node, void, unknown> {
    yield this
    yield * this.children(true)
  }

  /** An iterator for all node children */
  * children(deep?: boolean, reverse?: boolean): Generator<Node, void, unknown> {
    const data = this.data
    /**
     * Currently, we only reverse for Nodelists
     */
    let iterator = data instanceof NodeList
      ? reverse ? data.reverse() : data
      : data.values()

    for (let nodeVal of iterator) {
      if (nodeVal instanceof Node) {
        yield nodeVal
        if (deep) {
          yield * nodeVal.children(deep, reverse)
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
   * A return value of ABORT means to abort the walk.
   * A return value of REMOVE means to remove the current node.
   */
  walkNodes(
    func: NodeVisitFunction,
    shallow?: boolean,
    reverse?: boolean,
    visitPrePost?: boolean
  ) {
    const data = this.data
    if (visitPrePost) {
      let { pre, post } = this
      if (pre instanceof NodeList) {
        this._processNodeList(pre, func, true, false, reverse)
      }
      if (post instanceof NodeList) {
        this._processNodeList(post, func, true, false, reverse)
      }
    }
    let entriesMethod = data instanceof NodeList
      ? reverse ? data.reverseEntries : data.entries
      : data.entries

    for (const [key, nodeVal] of entriesMethod()) {
      if (nodeVal instanceof Node) {
        let returnVal = func(nodeVal)
        if (returnVal === ABORT) {
          return ABORT
        } else if (returnVal === REMOVE) {
          if (data instanceof NodeList) {
            data.removeItem(nodeVal)
          } else {
            data.set(key, this.nil().inherit(nodeVal))
          }
        } else if (returnVal instanceof Node && returnVal !== nodeVal) {
          this.data.set(key, returnVal)
        }
        if (!shallow) {
          nodeVal.walkNodes(func, false, reverse, visitPrePost)
        }
      }
    }
  }

  collectRoots(): NodeList<Node> {
    let list = new NodeList<Node>()
    this.walkNodes(n => {
      if (n.type === 'Rules') {
        const rules = n.rootRules
        if (rules) {
          for (let n of rules) {
            list.add(n)
          }
          rules.clear()
        }
      }
    })
    return list
  }

  accept(visitor: Visitor) {
    this.processNodes(n => visitor.visit(n))
  }

  /**
   * Creates a copy of the current node.
   */
  clone(deep?: boolean, cloneFn?: (n: Node) => Node): this {
    let Class: Constructor<this> = Object.getPrototypeOf(this).constructor

    let newNode = new Class(
      /**
       * Creates a new Map object instance.
       * Otherwise, replacing nodes would replace them
       * in the old map.
       */
      this.data,
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
    if (prePost instanceof NodeList) {
      for (let n of prePost) {
        if (n.type === 'Comment') {
          n.remove()
        }
      }
    }
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
        return this.nil().inherit(this)
      }
    )
    this.stripPrePost(this.pre)
    this.stripPrePost(this.post)

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
    if (!value) {
      return ''
    } else if (value === 1) {
      return ' '
    } else {
      return value.toString()
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
    for (let value of this.data.values()) {
      output += value.toString(depth)
    }
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

interface MapLike<K, V> {
  get(key: K): V
  set(key: K, value: V): any
  entries(): IterableIterator<[K, V]>
}

/**
 * A dynamic linked list useful for managing items in multiple lists.
 * In other words, rather than linking items together, their positions
 * in a list are managed by the list, much like an array.
 */
export class NodeList<
  T extends Node = Node,
  O extends NodeOptions = NodeOptions
> extends Node<T[], O> implements MapLike<number, T | undefined> {
  first: number | undefined
  last: number | undefined
  private _current: number | undefined
  /**
   * These maps are designed for fast lookups,
   * map cloning, and replacing Nodes.
   */

  /** A map of numbers to nodes */
  private readonly _items = new BiMap<number, T>()
  /** A map of a numbered node to the before / after as a joined number */
  private readonly _pos = new Map<number, number>()
  private _index = 0

  constructor(
    values: T[] = [],
    options?: O,
    location?: LocationInfo | 0,
    treeContext?: TreeContext
  ) {
    /** @ts-expect-error This is specially over-ridden for this class type */
    super(CREATE_LIST)
    /**
     * Passing a Map should really only be done when
     * cloning, which we will override.
     */
    if (isArray(values)) {
      this.setMany(values)
    }
    this._setUpNode(this, options, location, treeContext)
  }

  /** This is just so debugging isn't confusing */
  toString(depth?: number | undefined) {
    let output = ''
    for (let item of this) {
      output += item.toString(depth)
    }
    return output as Opaque<string>
  }

  private _writePos(nodeRef: number, previous: number | undefined, next: number | undefined) {
    if (nodeRef === previous || nodeRef === next) {
      throw new Error('Linking a node to itself would cause an infinite loop.')
    }
    this._pos.set(nodeRef, (previous ?? 0) << 16 | (next ?? 0))
  }

  private _writeNextPos(nodeRef: number, next: number | undefined) {
    let pos = this._pos.get(nodeRef)
    if (pos !== undefined) {
      /** Read previous, and write next */
      this._writePos(nodeRef, this._getPrevFromBits(pos), next)
    }
  }

  private _writePrevPos(nodeRef: number, previous: number | undefined) {
    let pos = this._pos.get(nodeRef)
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

  /** Return an array */
  get value() {
    return [...this]
  }

  get(key: number): T | undefined {
    return this._items.get(key)
  }

  set(key: number, value: T) {
    this._items.set(key, value)
  }

  setMany(values: T[]) {
    let index = 1
    let lastIndex: number | undefined
    if (values.length) {
      this.first = 1
    }
    const { _items, _pos } = this
    _items.clear()
    _pos.clear()
    let length = values.length
    for (; index <= length; index++) {
      if (lastIndex) {
        this._writeNextPos(lastIndex, index)
      }
      let item = values[index - 1]!
      lastIndex = index
      _items.set(index, item)
      this._writePos(index, index - 1, 0)
      item.lists.add(this)
    }
    /** The last thing a for loop does is increment, so subtract the last iteration */
    this._index = index - 1
    this.last = lastIndex
  }

  /** Clones of node lists need to be a bit different */
  clone(deep?: boolean, cloneFn?: (n: Node) => Node): this {
    let Class: Constructor<this> = Object.getPrototypeOf(this).constructor

    let newNode = new Class(
      [...this],
      this._options,
      this.location,
      this.treeContext
    )

    cloneFn ??= n => n.clone(deep)

    if (deep) {
      for (let [index, node] of newNode.entries()) {
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
    let index = ++this._index
    if (!this.first) {
      this.first = index
    }
    let last = this.last
    if (last) {
      this._writeNextPos(last, index)
    }
    this._items.set(index, item)
    this._writePos(index, last, 0)
    this.last = index
  }

  insertBefore(before: T, item: T) {
    let index = this._items.getValue(before)
    if (index === undefined) {
      return
    }
    if (this._items.getValue(item) !== undefined) {
      /**
       * Item already exists, no duplicates
       * Should we test this, since this is an error?
       */
      return
    }
    let pos = this._pos.get(index)!
    let previous = this._getPrevFromBits(pos)
    let insertionIndex = ++this._index
    this._writePos(insertionIndex, previous, index)
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
    if (this._items.getValue(item) !== undefined) {
      /**
       * Item already exists, no duplicates
       * Should we test this, since this is an error?
       */
      return
    }
    let pos = this._pos.get(index)!
    let next = this._getNextFromBits(pos)
    let insertionIndex = ++this._index
    this._writeNextPos(index, insertionIndex)
    this._writePos(insertionIndex, index, next)
    this._items.set(insertionIndex, item)
    if (index === this.last) {
      this.last = insertionIndex
    }
  }

  * [Symbol.iterator]() {
    yield * this._values()
  }

  * values() {
    yield * this._values()
  }

  private _values(): Generator<T, void, any>
  private _values(asEntries: true): Generator<[number, T], void, any>
  private * _values(asEntries = false) {
    let currentIndex = this._current = this.first
    if (currentIndex === undefined) {
      return
    }
    let currentItem = this._items.get(currentIndex)

    while (currentItem !== undefined) {
      yield asEntries ? [currentIndex, currentItem] : currentItem
      /**
       * this._current pointer may change because of deletions,
       * but if it's still the same pointer, then increment it
       * to the next position.
       */
      const nextIndex: number | undefined = currentIndex === this._current
        ? this._getNextFromBits(this._pos.get(currentIndex!))
        : this._current

      currentItem = nextIndex ? this._items.get(nextIndex) : undefined
      currentIndex = this._current = nextIndex
    }
  }

  * entries() {
    yield * this._values(true)
  }

  * reverseEntries() {
    yield * this.reverse(true)
  }

  reverse(): Generator<T, void, any>
  reverse(asEntries: true): Generator<[number, T], void, any>
  * reverse(asEntries = false) {
    let currentIndex = this._current = this.last
    if (currentIndex === undefined) {
      return
    }
    let currentItem = this._items.get(currentIndex)

    while (currentItem !== undefined) {
      yield asEntries ? [currentIndex, currentItem] : currentItem
      /**
       * this._current pointer may change because of deletions,
       * but if it's still the same pointer, then decrement it
       * to the previous position.
       */
      let prevIndex: number | undefined = currentIndex === this._current
        ? this._getPrevFromBits(this._pos.get(currentIndex!))
        : this._current

      currentItem = prevIndex ? this._items.get(prevIndex) : undefined
      currentIndex = this._current = prevIndex
    }
  }

  removeItem(item: T) {
    let index = this._items.getValue(item)
    if (index === undefined) {
      return
    }
    let pos = this._pos.get(index)!
    let previous = this._getPrevFromBits(pos)
    let next = this._getNextFromBits(pos)
    if (previous) {
      this._writeNextPos(previous, next)
    }
    if (next) {
      this._writePrevPos(next, previous)
    }
    this._items.delete(index)
    this._pos.delete(index)
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

  clear() {
    this._items.clear()
    this._pos.clear()
    this.first = undefined
    this.last = undefined
    this._current = undefined
  }
}