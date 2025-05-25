/* eslint-disable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-plus-operands, @typescript-eslint/no-invalid-void-type */
import isPlainObject from 'lodash-es/isPlainObject'
import {
  type TreeContext,
  type Context
} from '../context'
import { type Visitor } from '../visitor'
import { type Operator } from './util/calculate'
import type { Class, Tagged, IfAny, IsUnknown } from 'type-fest'
import { type Nil } from './nil'
import { ArrayList, HashMap } from './util/collections'

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
export type NodeOptions = Record<string, any> & AllNodeOptions
export const DEFAULT_DATA = 'value'

type NodeInValue<T extends NodeValue> = T
type BasicNodeTypes = Primitive | Node
type NodeRecordValue = BasicNodeTypes | Array<BasicNodeTypes | Primitive[]> | Record<string, any>
export type NodeValueObject = Record<string, NodeRecordValue>
export type NodeValue = BasicNodeTypes | BasicNodeTypes[] | NodeValueObject

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

  let proto: any = Clazz
  let types = proto.types = new Set()
  while (proto?.type) {
    types.add(proto.type)
    proto = Object.getPrototypeOf(proto)
  }

  type Args = [value?: P[0] | V, location?: P[1], options?: P[2], treeContext?: P[3]]
  return (...args: Args) => {
    const node = new Clazz(...args) as T extends Class<infer C> ? InstanceType<Class<C, Args>> : never
    ;(node as any).type = type
    ;(node as any).shortType = shortType
    return node
  }
}

type NarrowTypes<T> =
  IsUnknown<T> extends true
    ? NodeValue
    : T extends NodeValue
      ? T
      : never

export type ConditionOperator = 'and' | 'or' | '=' | '>' | '<' | '>=' | '<='

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
  /** Assigned in index to avoid circularity */
  declare readonly treeContext: TreeContext

  private _options: Partial<O & AllNodeOptions> | undefined
  get options(): Partial<O & AllNodeOptions> {
    return this._options ??= {}
  }

  set options(options: Partial<O & AllNodeOptions>) {
    this._options = options
  }

  /**
   * Assigned on the prototype, make sure we don't initialize
   */
  abstract type: string
  abstract shortType: string
  get types(): Set<string> {
    return (this.constructor as any).types
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
  pre: ArrayList | 1 | 0 | undefined
  post: ArrayList | 1 | 0 | undefined

  visible = true
  evaluated = false
  preEvaluated = false
  allowRoot = false
  allowRuleRoot = false

  /**
   * Nodes are assigned an initial index of 0, but when evaluating,
   * they are assigned a new, sequential index.
   */
  index!: number

  /**
   * If the node must have a semi separator before
   * the next node when in a declaration list or main
   * rules list.
   *
   * Defined on the prototype
   */
  requiredSemi = false

  /** Used by Rules */
  rootRules: ArrayList | undefined

  /**
   * Track the original source when cloned / copied,
   * rather than keeping the entire tree
   */
  sourceNode: Node = this as any

  /**
   * This is the internal `data` of the node, which is how its represented
   * internally, and may be different from the `value` of the node.
   */
  data!: NodeData
  parentData: NodeData | undefined

  get parent(): Node | undefined {
    let parentData = this.parentData
    if (parentData) {
      return parentData.parentNode
    }
  }

  nil!: () => Nil

  constructor(
    value: NodeInValue<T>,
    options?: O,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    this.data = new NodeData(this as any, value) as any
    this._treeContext = treeContext
    this._location = location
    this._options = options
  }

  declare value: any

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
    list: ArrayList,
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
        list.set(key, this.nil())
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
      if (pre instanceof ArrayList) {
        this._processNodeList(pre, func, true, false, reverse)
      }
      if (post instanceof ArrayList) {
        this._processNodeList(post, func, true, false, reverse)
      }
    }

    for (const [key, nodeVal, nodeIndex] of data.entries(reverse)) {
      if (nodeVal instanceof Node) {
        let returnVal = func(nodeVal)
        if (returnVal === ABORT) {
          return ABORT
        } else if (returnVal === REMOVE) {
          data.set(key, this.nil().inherit(nodeVal), nodeIndex)
        } else if (returnVal instanceof Node && returnVal !== nodeVal) {
          data.set(key, returnVal, nodeIndex)
        }
        if (!shallow) {
          nodeVal.walkNodes(func, false, reverse, visitPrePost)
        }
      }
    }
  }

  collectRoots(): ArrayList<Node> {
    let list = new ArrayList<Node>()
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

  maybeClone(context: Context, deep?: boolean, cloneFn?: (n: Node) => Node): this {
    if (context.preserveOriginalNodes) {
      return this.clone(deep, cloneFn)
    }
    return this
  }

  /**
   * Creates a copy of the current node.
   *
   * @note - In the Less source, nodes were always cloned before
   * mutating, which is why I did it here. However... the only
   * utility for cloning is to preserve the original node,
   * or (maybe?) to create a copy which is output differently.
   *
   * But... considering the high cost of cloning in terms of
   * object creation, and the low utility of preserving the original
   * node, I think we should just only clone when we need to.
   */
  clone(deep?: boolean, cloneFn?: (n: Node) => Node): this {
    let Class = this.constructor as Class<this>

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
    if (prePost instanceof ArrayList) {
      for (let [key, node] of prePost.entries()) {
        if (node.type === 'Comment') {
          prePost.set(key, this.nil().inherit(node))
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
   * `preEval` is used for things like interpolated variables
   * in declaration names, mixin names, interpolated strings in imports etc.
   *
   * In other words, values that must be evaluated before other nodes
   * are evaluated.
   */
  async preEval(context: Context): Promise<this> {
    this.preEvaluated = true
    return this
  }

  /**
   * This is the method all nodes will override.
   * Individual nodes will specify / narrow return type
   */
  async evalNode(context: Context): Promise<Node> {
    return this
  }

  static async evalStatic(node: Node, context: Context): Promise<Node> {
    let returnNode: Node = node
    if (!node.preEvaluated) {
      returnNode = await node.preEval(context)
      // if (returnNode !== node) {
      //   returnNode.inherit(node)
      // }
      returnNode.preEvaluated = true
    }
    if (!returnNode.evaluated) {
      returnNode = await returnNode.evalNode(context)
      // if (evaldNode !== returnNode) {
      //   evaldNode.inherit(returnNode)
      //   returnNode = evaldNode
      // }
      returnNode.preEvaluated = true
      returnNode.evaluated = true
    }
    return returnNode
  }

  /**
   * @note - Make sure you don't call super.eval while evaluating a node. Call it indirectly
   * from another node.
   */
  async eval(context: Context): Promise<Node> {
    if (Object.getPrototypeOf(this).eval !== Node.prototype.eval) {
      throw new Error('Do not call super.eval() from a subclass.')
    }
    return await Node.evalStatic(this, context)
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
   * This is used when a Node will replace another node.
   */
  inherit(node: Node) {
    this._location = node.location
    this._treeContext = node.treeContext
    this.evaluated &&= node.evaluated
    this.preEvaluated &&= node.preEvaluated
    this.pre = node.pre
    this.post = node.post
    this.sourceNode = node.sourceNode
    this.index ??= node.index
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
  operate(b: Node, op: Operator, context: Context): Node {
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

/** Use an accessor, but _pretend_ that it's a plain property so we can override in other sub-classes */
Object.defineProperty(Node.prototype, 'value', {
  /** Get the values back in the same format they went in */
  get() {
    const data = this.data.data

    if (data instanceof HashMap) {
      return data.toRaw()
    }

    if (data instanceof ArrayList) {
      return data.items
    }

    return data
  },

  set(val: any) {
    this.data.setAllData(val)
  }
})

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

/**
 * It's important to note that any[] extends Record
 * and `(...args: any[]) => any` extends Record,
 * so we need to be careful about order.
 */
type NodeDataData<T extends NodeValue> =
  T extends any[]
    ? ArrayList<T[0]>
    : T extends (...args: any[]) => any
      ? T
      : T extends Node
        ? T
        : T extends Record<string, any>
          ? HashMap<T>
          : T

type NodeDataObject<T extends NodeValue> =
  T extends any[]
    ? { value: T }
    : T extends Node
      ? { value: T }
      : T extends NodeValueObject
        ? T
        : { value: T }

type ValueOfNodeData<T extends NodeValue, K extends string> =
  K extends keyof T
    ? T[K]
    : any

type NodeDataKeys<T extends NodeValue> =
  T extends any[]
    ? 'value'
    : T extends Node
      ? 'value'
      : T extends NodeValueObject
        ? keyof T
        : string

/**
 * An abstracted representation of node data with a unified API
 */
export class NodeData<Type = any, T extends IfAny<Type, any, NarrowTypes<Type>> = IfAny<Type, any, NarrowTypes<Type>>> {
  /** @todo - Figure out how to determine this type */
  data!: any

  /** Process nodes if they exist */
  private _getNodeValue(val: any) {
    if (val instanceof Node) {
      val.parentData = this as any
    } else if (isArray(val)) {
      for (let n of val) {
        if (n instanceof Node) {
          n.parentData = this as any
        }
      }
    }
    return val
  }

  /** Get / has / set only deal with map data */
  has(key: string) {
    const data = this.data
    if (data instanceof HashMap) {
      return data.has(key)
    }
    if (key === 'value') {
      return true
    }
    return false
  }

  get<K extends NodeDataKeys<T>>(key: K): ValueOfNodeData<NodeDataObject<T>, K> {
    const data = this.data
    if (data instanceof HashMap) {
      return data.get(key)
    }
    return data
  }

  private _setInList(list: any, index: number, val: any) {
    if (!(list instanceof ArrayList)) {
      throw new Error('Cannot set at index on non-ArrayList data')
    }
    list.set(index, this._getNodeValue(val))
  }

  /** For map-like operations */
  set<K extends NodeDataKeys<T>>(key: K, val: ValueOfNodeData<NodeDataObject<T>, K>, listIndex: number = -1) {
    const data = this.data
    if (data instanceof HashMap) {
      if (listIndex !== -1) {
        this._setInList(data.get(key), listIndex, val)
      } else {
        data.set(key, val as any)
      }
    } else if (key === 'value') {
      if (listIndex !== -1) {
        this._setInList(data, listIndex, val)
      }
    } else {
      throw new Error('Cannot set on non-HashMap data')
    }
  }

  /** For list-like operations */
  setAt(index: number, val: T extends Array<infer U> ? U : never) {
    const data = this.data
    if (data instanceof ArrayList) {
      data.set(index, val as any)
    } else {
      throw new Error('Cannot set at index on non-ArrayList data')
    }
  }

  constructor(
    /** The Node this is getting attached to */
    public parentNode: Node,
    value: NodeInValue<T>
  ) {
    this.setAllData(value)
  }

  setAllData(value: NodeInValue<T>) {
    const process = this._getNodeValue.bind(this)
    if (value && (value instanceof Map || isPlainObject(value))) {
      this.data = new HashMap(value as any, process) as NodeDataData<T>
    } else if (isArray(value)) {
      this.data = new ArrayList(value as any, process) as NodeDataData<T>
    } else {
      this.data = process(value) as NodeDataData<T>
    }
  }

  private _dataValues(asEntries?: false, reverse?: boolean): Generator<NodeRecordValue>
  private _dataValues(asEntries: true, reverse?: boolean): Generator<[NodeDataKeys<T>, NodeRecordValue, listIndex: number]>
  private * _dataValues(
    asEntries?: boolean,
    reverse?: boolean
  ): Generator<NodeRecordValue | [string, NodeRecordValue, listIndex: number]> {
    const data = this.data
    const listMethod = reverse ? 'reverseEntries' : 'entries'
    if (data instanceof HashMap) {
      for (let [key, val] of data.entries()) {
        if (val instanceof ArrayList) {
          for (let [nodeIndex, node] of val[listMethod]()) {
            yield asEntries ? [key, node, nodeIndex] : node
          }
        } else {
          yield asEntries ? [key, val, -1] : val
        }
      }
    } else if (data instanceof ArrayList) {
      for (let [nodeIndex, node] of data[listMethod]()) {
        yield asEntries ? [DEFAULT_DATA, node, nodeIndex] : node
      }
    } else {
      asEntries ? yield [DEFAULT_DATA, data as NodeRecordValue, -1] : yield data as NodeRecordValue
    }
  }

  * values(reverse?: boolean): Generator<Exclude<NodeRecordValue, undefined>> {
    for (let value of this._dataValues(false, reverse)) {
      /** Exclude `undefined` as a value */
      if (value !== undefined) {
        yield value
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