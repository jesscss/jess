/* eslint-disable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-plus-operands, @typescript-eslint/no-invalid-void-type */
import isPlainObject from 'lodash-es/isPlainObject'
import {
  TreeContext,
  type Context
} from '../context'
import { SKIP, type Visitor } from '../visitor'
import { type Operator } from './util/calculate'
import type { Constructor, Writable, Class, ValueOf, Tagged, IsUnknown, UnionToTuple, ConditionalPick } from 'type-fest'
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

export type Primitive = undefined | boolean | string | number | ((...args: any[]) => any)

export const ABORT: unique symbol = Symbol('ABORT')
export const REMOVE: unique symbol = Symbol('REMOVE')
export type NodeVisitReturn = void | Node | symbol
type NodeVisitFunction = (n: Node) => NodeVisitReturn
export type NodeOptions = Record<string, boolean | string | number | undefined> & AllNodeOptions
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
  ;(Clazz as any).type = type
  ;(Clazz as any).shortType = shortType

  type Args = [value?: P[0] | V, location?: P[1], options?: P[2], treeContext?: P[3]]
  return (...args: Args) => {
    const node = new Clazz(...args) as T extends Class<infer C> ? InstanceType<Class<C, Args>> : never
    ;(node as any).type = type
    ;(node as any).shortType = shortType
    return node
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
 * Removes NodeValue from the type if it has a defined object type
 */
type TypedNodeData<
  T extends NodeValueObject = NodeValueObject,
  K extends (string | keyof T) = (string | keyof T)
> = {
    // [P in (K | string) as 'get']: (key: P) =>T[P]
    // get<U extends string>(key: U): T[U]
  } & {
    get<U extends K>(key: U): NodeValue extends T[U] ? never : T[U]
    set<U extends K>(key: U, value: NodeValue, nodeIndex?: number): void
  }
  // & {
  //   [P in K as 'set']: <U extends P>(key: U, value: T[U], nodeIndex?: number) => void
  // }

type GetTypedNodeData<T extends NodeTypes> =
  Omit<NodeData, 'get' | 'set'> & ( // TypedNodeData<NodeMapType<T>>
    T extends NodeValueObject
      ? TypedNodeData<T>
      : {
        get(key: string): never
        set(key: string, value: any, nodeIndex?: number): void
      }
  )

export const ROOT_DATA = '__root'

/**
 * @todo - this allows excess properties on T,
 * but using `Exact` from type-fest caused other issues
 */
export type NodeMapType<T extends NodeTypes> = T extends NodeValueObject ? T : { __root: T }

type Values<T, K extends keyof T = keyof T> = T[K]

export type NodeValueArray<T extends NodeValueObject> = UnionToTuple<Values<{
  [K in keyof T]: [K, T[K]]
}>>

type NodeInValue<T extends NodeTypes> = T | NodeData<T>

type NodeTypes = Primitive | Node[] | NodeValueObject

type NarrowTypes<T> =
  IsUnknown<T> extends true
    ? NodeTypes
    : T extends NodeTypes
      ? T
      : never

export type NoOverride<T> = Tagged<T, 'NoOverride'>

/**
 * The underlying type for all Jess nodes
 */
export abstract class Node<
  Type = unknown,
  O extends NodeOptions = NodeOptions,
  T extends NarrowTypes<Type> = NarrowTypes<Type>,
> {
  private _location: LocationInfo | [] | undefined
  get location() {
    return (this._location ??= [])
  }
  private _treeContext: TreeContext | undefined
  get treeContext(): TreeContext {
    return this._treeContext ?? new TreeContext()
  }

  private _options: Partial<O & AllNodeOptions> | undefined
  get options(): Partial<O & AllNodeOptions> {
    return this._options ??= {}
  }

  /**
   * Assigned on the prototype, make sure we don't initialize
   */
  abstract type: string
  abstract shortType: string

  /**
   * Track the original source when cloned / copied,
   * rather than keeping the entire tree
   */
  sourceNode: Node = this

  /** All types of the prototype chain */
  _types: Set<string> | undefined
  get types() {
    let types = this._types
    if (!types) {
      let node = this
      this._types = types = new Set()
      while (node?.type) {
        types.add(node.type)
        node = Object.getPrototypeOf(node.constructor)
      }
    }
    return types
  }

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
  pre: NodeList | 1 | 0 | undefined
  post: NodeList | 1 | 0 | undefined

  visible = true
  evaluated = false
  allowRoot = false
  allowRuleRoot = false

  /**
   * If the node must have a semi separator before
   * the next node when in a declaration list or main
   * rules list.
   *
   * Defined on the prototype
   */
  requiredSemi = false

  /** Used by Rules */
  rootRules: NodeList | undefined

  /**
   * This should always represent the `data` of the Node
   */
  data!: GetTypedNodeData<T> // TypedNodeData<Type> // GetTypedNodeData<T>
  parentData: NodeData | undefined

  nil!: () => Nil

  constructor(
    value: NodeInValue<T>,
    options?: O,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    this.data = new NodeData(this, value) as unknown as GetTypedNodeData<T>
    this._treeContext = treeContext
    this._location = location
    this._options = options
  }

  /** Get the values back in the same format they went in */
  get value(): Type {
    const data = this.data
    if (data instanceof NodeList) {
      return [...data] as Type
    }
    if (data.has(ROOT_DATA)) {
      return data.get(ROOT_DATA) as Type
    }
    return Object.fromEntries(data.entries()) as Type
  }

  set value(val: NodeInValue<T>) {
    this.data.setAllData(val)
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
   * Mutates node children in place, asynchronously
   */
  async processNodesAsync(func: (n: Node) => Node | Promise<Node>) {
    let promises: Array<Promise<void>> = []
    const data = this.data
    for (let [key, nodeVal, nodeIndex] of this.data.entries()) {
      if (nodeVal instanceof Node) {
        /** Assume that the type will still be valid */
        promises.push(
          (async () => (data as any).set(key, await func(nodeVal), nodeIndex))()
        )
      }
    }
    await Promise.all(promises)
  }

  /**
   * Mutate nodes in place, used in... just pre and post now?
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
        list.removeItem(node)
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
  * nodes(reverse?: boolean): Generator<Node, void, unknown> {
    yield this
    yield * this.children(true, reverse)
  }

  /** An iterator for all node children */
  * children(deep?: boolean, reverse?: boolean): Generator<Node, void, unknown> {
    for (let nodeVal of this.data.values(reverse)) {
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

    for (const [key, nodeVal, nodeIndex] of data.entries(reverse)) {
      if (nodeVal instanceof Node) {
        let returnVal = func(nodeVal)
        if (returnVal === ABORT) {
          return ABORT
        } else if (returnVal === REMOVE) {
          if (data instanceof NodeList) {
            data.removeItem(nodeVal)
          } else {
            (data as any).set(key, this.nil().inherit(nodeVal), nodeIndex)
          }
        } else if (returnVal instanceof Node && returnVal !== nodeVal) {
          (data as any).set(key, returnVal, nodeIndex)
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
            list.push(n)
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
   * 
   * @todo - Node data has changed a lot. Write tests to
   * make sure nodes are cleanly cloned and that they don't have
   * any references to the original node / nested objects.
   */
  clone(deep?: boolean, cloneFn?: (n: Node) => Node): this {
    let Class: Constructor<this> = Object.getPrototypeOf(this).constructor

    let newNode = new Class(this.value, this.options, this.location, this.treeContext)
    newNode.inherit(this)

    cloneFn ??= n => n.clone(deep)

    if (deep) {
      newNode.processNodes(cloneFn)
    }

    return newNode
  }

  /** Remove comments from pre/post */
  stripPrePost(prePost: Node['pre']) {
    if (prePost instanceof NodeData) {
      prePost.removeNode(this)
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
   * This is the method all nodes will override.
   * Individual nodes will specify / narrow return type
   */
  async evalNode(context: Context): Promise<Node> {
    return this
  }

  /**
   * DO NOT OVERRIDE THIS METHOD
   */
  async eval(context: Context): Promise<Node> {
    if (!this.evaluated) {
      const returnNode = await this.evalNode(context)
      returnNode.inherit(this)
      returnNode.evaluated = true
    }
    return this
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

  /**
   * Override normally readonly props to make them inheritable
   * This is used when a Node will replace another node.
   */
  inherit(node: Node) {
    (this as Writable<this>).location = node.location
    ;(this as Writable<this>).treeContext = node.treeContext
    this.evaluated = node.evaluated
    this.pre = node.pre
    this.post = node.post
    this.sourceNode = node.sourceNode
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
   */
  toString(depth?: number): NoOverride<string> {
    if (!this.visible) {
      return '' as NoOverride<string>
    }
    let output = ''
    output += this.processPrePost('pre')
    output += this.toTrimmedString(depth)
    output += this.processPrePost('post')
    if (this.options?.semi === true) {
      output += ';'
    }
    return output as NoOverride<string>
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

export interface NodeListOptions extends NodeOptions {
  /** Don't add list to node lists */
  disableTracking?: boolean
}

// export class NodeTreeEdge<
//   S extends symbol = symbol
// > {
//   constructor(
//     public node: typeof NODE_INDEX,
//     public type?: S,
//     public value?: string
//   ) {}
// }

type NodeDataData<T extends NodeTypes> =
  T extends NodeValueObject
    ? TypedMap<NodeMapType<T>>
    : T extends Node[]
      ? NodeList<T[0]> | undefined
      : T | undefined

/**
 * A dynamically linked list tree, which is also indexed.
 * This is a kind of trie structure for fast, indexed string
 * lookups, as well as fast iteration, insertion, and deletion.
 *
 * It's easier to think of this as a "nested list" than a "tree",
 * because lists can be iterated linearly.
 */
export class NodeData<
  T extends NodeTypes = NodeTypes,
  M extends NodeMapType<T> = NodeMapType<T>
> {
  /** Nodes can be indexed into lists for fast iteration */
  private data!: NodeDataData<T>

  /** Get / has / set only deal with map data */
  has(key: string) {
    const data = this.data
    if (data instanceof Map) {
      if (key === ROOT_DATA) {
        return false
      }
      return data.has(key)
    }
    return key === ROOT_DATA
  }

  get(key: string): any {
    const data = this.data
    if (data instanceof Map) {
      if (key === ROOT_DATA) {
        throw new Error('Cannot get root data from a Map NodeData.')
      }
      return data.get(key) as never
    }
    return data as never
  }

  /** Process nodes if they exist */
  private _getNodeValue(val: any) {
    if (val instanceof Node) {
      val.parentData = this
      return val
    }
    if (isArray(val)) {
      let nodes = val.filter(n => n instanceof Node)
      if (nodes.length) {
        if (nodes.length !== val.length) {
          throw new Error('Cannot mix nodes and non-nodes in a list.')
        }
        nodes.forEach(n => {
          n.parentData = this
        })
        return new NodeList(nodes)
      } else {
        /** Treat empty arrays as undefined */
        return undefined
      }
    }
    return val
  }

  /** @todo - fix type to string type the setter */
  set(key: string, val: NodeValue | undefined, nodeListIndex?: number) {
    let data = this.data as Map<any, any> | NodeList
    let rootData = key === ROOT_DATA

    if (!rootData) {
      if (!data) {
        data = (this.data as any) = new Map() 
      } else {
        throw new Error('Cannot set map data without a map.')
      }
      if (nodeListIndex !== undefined) {
        let list = data.get(key)
        if (list instanceof NodeList) {
          /** Assume this is a Node */
          list.set(nodeListIndex, this._getNodeValue(val))
        } else {
          throw new Error('Cannot push to a non-NodeList.')
        }  
      }
      data.set(key, this._getNodeValue(val))
    } else {
      (this.data as any) = this._getNodeValue(val)
      return
    }
  }

  constructor(
    /** The Node this is getting attached to */
    public parentNode: Node,
    value?: NodeInValue<T>
  ) {
    this.setAllData(value)
  }

  setAllData(value?: NodeInValue<T>) {
    if (value && isPlainObject(value)) {
      for (let [key, val] of Object.entries(value)) {
        this.set(key, val)
      }
    }
    if (value !== undefined) {
      if (value instanceof NodeData) {
        this.data = value.data
      } else {
        this.set(ROOT_DATA, value as M[typeof ROOT_DATA])
      }
    }
  }


  private _dataValues(asEntries?: false, reverse?: boolean): Generator<NodeValue | undefined>
  private _dataValues(asEntries: true, reverse?: boolean): Generator<[string, NodeValue | undefined, nodeIndex?: number]>
  private * _dataValues(
    asEntries?: boolean,
    reverse?: boolean
  ): Generator<NodeValue | undefined | [string, NodeValue | undefined, nodeIndex?: number]> {
    const data = this.data
    const listMethod = reverse ? 'reverseEntries' : 'entries'
    if (data instanceof Map) {
      for (let [key, val] of data.entries()) {
        if (val instanceof NodeList) {
          for (let [nodeIndex, node] of val[listMethod]()) {
            yield asEntries ? [key, node, nodeIndex] : node
          }
        } else {
          yield asEntries ? [key, val] : val
        }
      }
    } else if (data instanceof NodeList) {
      for (let [nodeIndex, node] of data[listMethod]()) {
        yield asEntries ? [ROOT_DATA, node, nodeIndex] : node
      }
    } else {
      asEntries ? yield [ROOT_DATA, data as NodeValue] : yield data as NodeValue
    }
  }

  * values(reverse?: boolean) {
    for (let value of this._dataValues(false, reverse)) {
      /** Exclude `undefined` as a value */
      if (value !== undefined) {
        yield value
      }
    }
  }

  removeNode(n: Node) {
    for (let list of this._dataValues()) {
      if (list instanceof NodeList) {
        list.removeItem(n)
      }
    }
  }

  /**
   * Iterates through nodes and parent nodes.
   * This is used for value lookups
   * 
   * @note - When walking upward, if node.parentData has changed,
   * then we've stepped into the next parent node.
   */
  private * _reverseWalk(
    includeParents?: boolean,
    start?: Node | undefined
  ): Generator<Node> {
    let data = this.data

    if (!(data instanceof NodeList)) {
      throw new Error('Cannot walk a non-NodeList.')
    }

    let startIndex = start ? data.getNodeIndex(start) : undefined
    yield * data.reverse(startIndex)

    if (includeParents) {
      let node = this.parentNode
      let parentData = node.parentData
      /**
       * Yield back that we're going to start navigating the parent.
       * This can be used to make decisions about whether or not
       * current conditions are satisfied (and whether to continue).
       */
      if (parentData && parentData.data instanceof NodeList) {
        start = start ? node : undefined
        yield * parentData._reverseWalk(includeParents, start)
      }
    }
  }

  * entries(reverse?: boolean) {
    for (let value of this._dataValues(true, reverse)) {
      /** Exclude `undefined` as a value */
      if (value !== undefined) {
        yield value
      }
    }
  }
}

/**
 * A dynamic linked list useful for managing items in multiple lists.
 * In other words, rather than linking items together, their positions
 * in a list are managed by the list, much like an array.
 */
export class NodeList<
  T extends Node = Node
> {
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

  keySet = new Set<string>()

  constructor(
    values: T[] = []
  ) {
    /**
     * Passing a Map should really only be done when
     * cloning, which we will override.
     */
    this.setMany(values)
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

  getNodeIndex(n: T) {
    return this._items.getValue(n)
  }

  set(key: number, value: T) {
    this._items.set(key, value)
  }

  has(key: number) {
    return this._items.has(key)
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
      this.set(index, item)
      this._writePos(index, index - 1, 0)
    }
    /** The last thing a for loop does is increment, so subtract the last iteration */
    this._index = index - 1
    this.last = lastIndex
  }

  get size() {
    return this._items.size
  }

  push(item: T) {
    let index = ++this._index
    if (!this.first) {
      this.first = index
    }
    let last = this.last
    if (last) {
      this._writeNextPos(last, index)
    } else {
      this.last = index
    }
    this.set(index, item)
    this._writePos(index, last, 0)
  }

  unshift(item: T) {
    let index = ++this._index
    if (!this.last) {
      this.last = index
    }
    let first = this.first
    if (first) {
      this._writePrevPos(first, index)
    } else {
      this.first = index
    }
    this.set(index, item)
    this._writePos(index, first, 0)
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

  * reverseEntries(start?: number) {
    yield * this._reverse(true, start)
  }

  _reverse(asEntries: false, start?: number): Generator<T>
  _reverse(asEntries: true, start?: number): Generator<[number, T]>
  _reverse(asEntries?: boolean, start?: number): Generator<T>
  * _reverse(asEntries: boolean = false, start = this.last): Generator<T | [number, T]> {
    let currentIndex = this._current = start
    if (currentIndex === undefined) {
      return
    }
    let currentItem = this._items.get(currentIndex)

    while (currentItem !== undefined && currentIndex !== undefined) {
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

  * reverse(start?: number) {
    yield * this._reverse(false, start)
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
  }

  clear() {
    this._items.clear()
    this._pos.clear()
    this.first = undefined
    this.last = undefined
    this._current = undefined
  }
}