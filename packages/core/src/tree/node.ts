/* eslint-disable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-plus-operands, @typescript-eslint/no-invalid-void-type */
import isPlainObject from 'lodash-es/isPlainObject'
import {
  type Context,
  type TreeContext
} from '../context'
import { SKIP, type Visitor } from '../visitor'
import type { Comment } from './comment'
import type { Token } from './token'
import { type Operator } from './util/calculate'
import type { Constructor, Writable, Class, ValueOf, Opaque, IsUnknown, UnionToTuple } from 'type-fest'
import { BiMap, LinkedList } from './util/collections'
import { matchesNode } from './util/is-node'
import { type Nil } from './nil'
import type { Selector } from './selector'
import { Stack } from 'data-structure-typed'

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
export const SKIP_SETUP: unique symbol = Symbol('SKIP_SETUP')
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

export type NodeDataOld<T> =
  T extends Node[]
    ? NodeList<T[0]>
    : T extends NodeValueObject
      ? TypedMap<T>
      : T extends NodeValue
        ? TypedMap<NodeMapType<T>>
        : never

type NodeInValue<T> =
  T extends Node[]
    ? T | NodeData<T, true>
    : T | NodeData<T, false>

type NodeTypes = Primitive | Node[] | NodeValueObject

type NarrowTypes<T> =
  IsUnknown<T> extends true
    ? NodeTypes
    : T extends NodeTypes
      ? T
      : never

// eslint-disable-next-line @typescript-eslint/naming-convention
let NODE_INDEX = 0

interface FinalizationRegistryInterface {
  register(target: any, value: any): void
}

type FinalizationRegistryClass = new (callback: (value: any) => void) => FinalizationRegistryInterface

declare const FinalizationRegistry: FinalizationRegistryClass

/**
 * @note Do we need this? It's still fairly new
 * and maybe this will avoid a browser issue?
 */
if (!('FinalizationRegistry' in globalThis)) {
  (globalThis as any).FinalizationRegistry = class FinalizationRegistry {
    register() {}
  }
}

class NodeMeta {
  constructor(
    public index: number,
    public version: number,
    public parentIndex?: typeof NODE_INDEX | undefined
  ) {}
}
/**
 * The underlying type for all Jess nodes
 */
export abstract class Node<
  Type = unknown,
  O extends NodeOptions = NodeOptions,
  T extends NarrowTypes<Type> = NarrowTypes<Type>,
> {
  /** Tracks all created Nodes by their indices */
  static indexMap = new BiMap<typeof NODE_INDEX, Node>()
  static metaMap = new Map<typeof NODE_INDEX, NodeMeta>()
  /** For re-using indices so we don't exceed the maximum number */
  static availableIndices = new Stack<number>()
  static cleanupIndex = (index: number) => {
    Node.indexMap.delete(index)
    Node.metaMap.delete(index)
    Node.availableIndices.push(index)
  }

  /** Prevent memory leaks by cleaning up node registry */
  static _registry: FinalizationRegistryInterface | undefined
  static get registry() {
    return (
      this._registry ??= new FinalizationRegistry(([index, version]: [index: number, version: number]) => {
        let meta = Node.metaMap.get(index)
        if (meta?.version === version) {
          Node.cleanupIndex(index)
        }
      })
    )
  }

  static getIndex() {
    return Node.availableIndices.pop() ?? ++NODE_INDEX
  }

  private _location: LocationInfo | [] | undefined
  get location() {
    return (this._location ??= [])
  }
  private _treeContext: TreeContext | undefined
  get treeContext() {
    return this._treeContext ?? {}
  }

  private _options: Partial<O & AllNodeOptions> | undefined
  get options() {
    return this._options ??= {}
  }

  /**
   * Assigned on the prototype, make sure we don't initialize
   */
  type = 'Node'
  shortType = 'node'

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

  declare _isSelector: boolean
  /** Indicates if this can be used wherever a selector is used */
  isSelector(): this is Selector {
    return this._isSelector
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
  pre: NodeList<Comment | Token> | 1 | 0 | undefined
  post: NodeList<Comment | Token> | 1 | 0 | undefined

  visible = true
  private _index: number | undefined
  /**
   * The first time we get the index, we register it
   * in the indexMap. This is done lazily so we can
   * create nodes that have no side effects until
   * they are added to lists / trees, which requires
   * tracking.
   */
  get index() {
    if (this._index) {
      return this._index
    }
    let { index, version } = this._setIndex(Node.getIndex())
    Node.registry.register(this, [index, version])
    return index
  }

  set index(val: number) {
    if (this._index === val) {
      return
    }
    this._setIndex(val)
  }

  private _setIndex(val: number) {
    /** Remove previous registered index */
    let currentIndex = this._index
    if (currentIndex) {
      Node.cleanupIndex(currentIndex)
    }
    this.data.nodeIndex = val
    let meta = Node.metaMap.get(val)
    if (meta) {
      meta.version++
    } else {
      meta = new NodeMeta(val, 1)
      Node.metaMap.set(val, meta)
    }
    this._index = val
    Node.indexMap.set(val, this)
    return meta
  }

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
  parentData: NodeData | undefined

  nil!: () => Nil

  constructor(
    value: NodeInValue<T> | typeof SKIP_SETUP,
    options?: O,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    if (value !== SKIP_SETUP) {
      this._setUpNode(value, options, location, treeContext)
    }
  }

  protected _setUpNode(
    value: NodeInValue<T>,
    options?: O,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    this.data = new NodeData(this.index, value)
    this._location = location
    this._treeContext = treeContext
    this._options = options
  }

  /** Get the values back in the same format they went in */
  get value(): Type {
    const data = this.data
    if (data instanceof NodeList) {
      return [...data] as Type
    }
    if (data.has('_value')) {
      return data.get('_value') as Type
    }
    return Object.fromEntries(data.entries())
  }

  /** NodeList-related properties */
  private _lists: NodeList<NodeList> | undefined
  get lists(): NodeList<NodeList> {
    return (this._lists ??= new NodeList(undefined, { disableTracking: true }))
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
  * nodes(reverse?: boolean): Generator<Node, void, unknown> {
    yield this
    yield * this.children(true, reverse)
  }

  /** An iterator for all node children */
  * children(deep?: boolean, reverse?: boolean): Generator<Node, void, unknown> {
    for (let nodeVal of this.data.reverse()) {
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
   */
  clone(deep?: boolean, cloneFn?: (n: Node) => Node): this {
    let Class: Constructor<this> = Object.getPrototypeOf(this).constructor

    let newNode = new Class(SKIP_SETUP)
    newNode.inherit(this)

    cloneFn ??= n => n.clone(deep)

    if (deep) {
      newNode.processNodes(cloneFn)
    }
    newNode.pre = this.pre
    newNode.post = this.post
    newNode.evaluated = this.evaluated
    newNode.index = this.index
    newNode._lists = this._lists

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
    /** Copied nodes are assigned a new index */
    newNode.index = ++NODE_INDEX
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

  /**
   * Override normally readonly props to make them inheritable
   * This is used when a Node will replace another node.
   */
  inherit(node: Node) {
    (this as Writable<this>).location = node.location
    ;(this as Writable<this>)._treeContext = node._treeContext
    this.evaluated = node.evaluated
    this.pre = node.pre
    this.post = node.post
    this.index = node.index
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

export const PARENT_NODE: unique symbol = Symbol('PARENT_NODE')
/**
 * @note All Node references in the tree are indirect and are done by number.
 * This is so replacements
 */
export class NodeTreeNode {
  constructor(
    public node: typeof NODE_INDEX,
    public previous?: typeof NODE_INDEX,
    public next?: typeof NODE_INDEX
  ) {}
}

class NodeRef {
  constructor(
    public index: typeof NODE_INDEX
  ) {}
}

const lookupTypes = ['Ruleset', 'Mixin', 'VarDeclaration', 'Declaration'] as const
export type LookupTypes = typeof lookupTypes[number]

/**
 * The inner collection of a NodeData instance, which can also contain linked lists of nodes.
 */
export class NodeDataMap {
  parentData: NodeData | undefined
  private items = new Map<string, any>()

  addNode(key: string, val: Node) {
    let list = this.items.get(key)
    if (list instanceof LinkedList) {
      list.push(val.index)
    } else {
      this.items.set(key, new LinkedList([val.index]))
    }
  }

  /** For parity, this only returns node indices */
  * reverse() {
    for (let value of this.items.values()) {
      if (value instanceof LinkedList) {
        yield * value.reverse()
      }
    }
  }
}


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
  private readonly items = new Map<any, any>()

  has(key: string) {
    return this.items.has(key)
  }

  get<K extends keyof M = keyof M>(key: K): M[K] {
    return this.items.get(key)
  }

  set<K extends keyof M = keyof M>(key: K, val: M[K]) {
    if (val instanceof Node) {
      this.items.set(key, new LinkedList([val.index]))
      val.parentData = this
    } else if (isArray(val)) {
      let nodes = val.filter(n => n instanceof Node)
      if (nodes.length) {
        if (nodes.length !== val.length) {
          throw new Error('Cannot mix nodes and non-nodes in a list.')
        }
        nodes.forEach(n => {
          n.parentData = this
        })
        this.items.set(key, new LinkedList(nodes.map(n => n.index)))
      } else {
        this.items.set(key, val)
      }
    }
  }

  constructor(
    /** The Node index this is getting attached to */
    public nodeIndex: typeof NODE_INDEX,
    value?: NodeInValue<T>
  ) {
    if (value && isPlainObject(value)) {
      for (let [key, val] of Object.entries(value)) {
        this.set(key as keyof M, val)
      }
    }
    this.set('_value', value as M['_value'])
  }

  push(...nodes: Node[]) {
    const items = this.items
    if (!items.has('_value')) {
      throw new Error('The node data is not a list of nodes.')
    }
    let list = items.get('_value') ?? new LinkedList()
    for (let n of nodes) {
      let index = n.index
      n.parentData = this
      if (Node.indexMap.has(index)) {
        throw new Error('Node already exists in the tree.')
      }
      /** @todo - Add key? */
      // let key = n.valueOf()
      list.push(index)
      // this.keySet.add(key)
    }
    items.set('_value', list)
  }

  private _reverseList(asEntries: false, start?: typeof NODE_INDEX | undefined, includeParents?: boolean): Generator<Node | typeof PARENT_NODE>
  private _reverseList(asEntries: true, start?: typeof NODE_INDEX | undefined, includeParents?: boolean): Generator<[number, Node | typeof PARENT_NODE]>
  private _reverseList(asEntries: boolean, start?: typeof NODE_INDEX | undefined, includeParents?: boolean): Generator<Node | typeof PARENT_NODE | [number, Node | typeof PARENT_NODE]>
  private * _reverseList(
    asEntries: boolean,
    start?: typeof NODE_INDEX | undefined,
    includeParents?: boolean
  ) {
    let list = this.items

    for (let group of list.values()) {
      if (group instanceof LinkedList) {
        for (let index of group.reverse()) {
          let node = Node.indexMap.get(index)!
          yield asEntries ? [index, node] : node
        }
      }
    }

    if (includeParents) {
      let node = Node.indexMap.get(this.nodeIndex)!
      let parentData = node.parentData
      /**
       * Yield back that we're going to start navigating the parent.
       * This can be used to make decisions about whether or not
       * current conditions are satisfied (and whether to continue).
       */
      if (parentData) {
        let parentIndex = parentData.nodeIndex
        yield asEntries ? [parentIndex, PARENT_NODE] : PARENT_NODE
        yield * parentData._reverseList(asEntries, start ? parentIndex : undefined, includeParents)
      }
    }
  }

  * entries() {
    yield * this.items.entries()
  }

  * findNodes(currentNode: Node, key: string | number, type?: symbol | symbol[], resolution?: 'scope' | 'linear') {

  }
}

/**
 * A dynamic linked list useful for managing items in multiple lists.
 * In other words, rather than linking items together, their positions
 * in a list are managed by the list, much like an array.
 */
export class NodeList<
  T extends Node = Node,
  O extends NodeListOptions = NodeListOptions
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
    super(SKIP_SETUP)
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
    if (!this.options?.disableTracking) {
      value.lists.push(this)
    }
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

  /** Clones of node lists need to be a bit different */
  clone(deep?: boolean, cloneFn?: (n: Node) => Node): this {
    let Class: Constructor<this> = Object.getPrototypeOf(this).constructor

    let newNode = new Class(SKIP_SETUP)
    newNode.inherit(this)

    cloneFn ??= n => n.clone(deep)

    if (deep) {
      for (let [index, node] of newNode.entries()) {
        /** @todo - deal with deletions or NodeList returns */
        newNode.set(index, node.clone(deep, cloneFn))
      }
    }

    return newNode
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