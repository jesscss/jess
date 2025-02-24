/* eslint-disable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-plus-operands, @typescript-eslint/no-invalid-void-type */
import isPlainObject from 'lodash-es/isPlainObject'
import {
  TreeContext,
  type Context
} from '../context'
import { SKIP, type Visitor } from '../visitor'
import { type Operator } from './util/calculate'
import type { Constructor, Writable, Class, ValueOf, Tagged, IsUnknown, UnionToTuple, ConditionalPick, IfUnknown, IsAny } from 'type-fest'
import { type Nil } from './nil'
import { NodeList } from './util/collections'


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
    values(): IterableIterator<Values<T>>
  }
  // & {
  //   [P in K as 'set']: <U extends P>(key: U, value: T[U], nodeIndex?: number) => void
  // }

type GetTypedNodeData<T extends NodeTypes> =
  Omit<NodeData, 'get' | 'set'> & ( // TypedNodeData<NodeMapType<T>>
    T extends NodeValueObject
      ? TypedNodeData<T>
      : T extends Node[] 
        ? {
          get(key: string): never
          set(key: string, value: any, nodeIndex?: number): void
          values(): IterableIterator<T>
        }
        : {
          get(key: string): any
          set(key: string, value: any): void
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

type NodeTypes = Primitive | Array<Primitive | Node> | NodeValueObject

type NarrowTypes<T> =
  IsAny<T> extends true
    ? NodeTypes
    : T extends NodeTypes
      ? T
      : never

export type ConditionOperator = 'and' | 'or' | '=' | '>' | '<' | '>=' | '<='

export type NoOverride<T> = Tagged<T, 'NoOverride'>

/**
 * The underlying type for all Jess nodes
 */
export abstract class Node<
  Type extends any = any,
  O extends NodeOptions = NodeOptions,
  T extends NarrowTypes<Type> = NarrowTypes<Type>,
> {
  private _location: LocationInfo | [] | undefined
  get location() {
    return (this._location ??= [])
  }
  private _treeContext: TreeContext | undefined
  /** Assigned in index to avoid circularity */
  declare readonly treeContext: TreeContext

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
  // declare _types: Set<string> | undefined
  get types(): Set<string> {
    /** Set on prototype object so we don't do this per instance */
    let proto = Object.getPrototypeOf(this)
    let types = proto._types
    if (!types) {
      let node = this
      proto._types = types = new Set()
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
    if (data.data instanceof NodeList) {
      return [...data.data] as Type
    }
    if (data.has(ROOT_DATA)) {
      return data.get(ROOT_DATA) as Type
    }
    return Object.fromEntries(data.entries()) as Type
  }

  set value(val: any) {
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
   * 
   * @note - Make sure you don't call super.eval while evaluating a node. Call it indirectly
   * from another node.
   */
  async eval(context: Context): Promise<Node> {
    if (!this.evaluated) {
      this.evaluated = true
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
    this._location = node.location
    this._treeContext = node.treeContext
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
  valueOf(): Type extends string ? string : string | number {
    let value = this.data
    if (typeof value === 'string') {
      return value
    }
    if (typeof value === 'number') {
      return value
    }
    let values = [...this.data.values()]
    if (values.length === 1) {
      return `${values[0]}`
    }
    return `${values}`
  }

  processPrePost(key: 'pre' | 'post', defaultVal: string = '') {
    let value = this[key]
    if (value === undefined) {
      return defaultVal
    } else if (value === 0) {
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
  toString(depth?: number, defaultPre?: string, defaultPost?: string): NoOverride<string> {
    if (!this.visible) {
      return '' as NoOverride<string>
    }
    let output = ''
    output += this.processPrePost('pre', defaultPre)
    output += this.toTrimmedString(depth)
    output += this.processPrePost('post', defaultPost)
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
 * An abstracted representation of node data with a unified API
 */
export class NodeData<
  T extends NodeTypes = NodeTypes
> {
  /** Nodes can be indexed into lists for fast iteration */
  data!: NodeDataData<T>

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

  get list() {
    type NodeListType = T extends Node[] ? NodeList<T[0]> : NodeList<Node>
    const data = this.data
    if (data instanceof Map) {
      throw new Error('Cannot get list data from a Map NodeData.')
    }
    if (data instanceof NodeList) {
      return data as unknown as NodeListType
    }
    if (isArray(data)) {
      /** Presume this can be a NodeList */
      return ((this.data as any) = new NodeList(data)) as NodeListType
    }
    throw new Error('Cannot get list data from a non-NodeList NodeData.')
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
      }
      if (!(data instanceof Map)) {
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
      } else {
        data.set(key, this._getNodeValue(val))
      }
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
    } else if (value !== undefined) {
      if (value instanceof NodeData) {
        this.data = value.data
      } else {
        this.set(ROOT_DATA, value as any)
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

    yield * data.reverseValues(start)

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
