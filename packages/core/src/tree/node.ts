/* eslint-disable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-plus-operands */
import isPlainObject from 'lodash-es/isPlainObject'
import { type Context, TreeContext } from '../context'
import type { Visitor } from '../visitor'
import type { Comment } from './comment'
import { type Operator } from './util/calculate'
// import type { OutputCollector } from '../output'
import type { Constructor, Writable, Class, ValueOf, Opaque } from 'type-fest'

export { TreeContext }

type AllNodeOptions = {
  hoistToRoot?: boolean
}

export type NodeOptions = Record<string, boolean | string> & AllNodeOptions
export type NodeValue = unknown
export type NodeMap = Map<string, NodeValue>
export type NodeInValue = NodeValue | NodeMapArray | NodeMap
export type NodeTypeMap = Record<string, NodeValue>
export type NodeMapArray<
  T extends NodeTypeMap = NodeTypeMap,
  K = keyof T,
  V = T[string]
> = Array<[K, V]>

export type LocationInfo = [
  startOffset?: number,
  startLine?: number,
  startColumn?: number,
  endOffset?: number,
  endLine?: number,
  endColumn?: number,
]

/**
 * Assume the value is a NodeMap if it's an array of arrays
 *
 * This just checks that it can be safely passed to `new Map()`
 */
export const isNodeMap = (val: any): val is NodeMap | NodeMapArray => {
  return val instanceof Map || (Array.isArray(val) && Array.isArray(val[0]))
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
  ;(Clazz.prototype as Writable<InstanceType<T>>).type = type
  ;(Clazz.prototype as Writable<InstanceType<T>>).shortType = shortType

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
export type TypeMap<
  T extends NodeTypeMap = NodeTypeMap,
  K extends keyof T = keyof T,
  V = ValueOf<T>
> = Omit<Map<K, V>, 'get' | 'set'> & {
  /**
   * TypeScript sometimes gets confused
   * about whether or not get / set will exist,
   * so this fixes it.
   */
  get(key: any): any
  set(key: any, value: any): any
} & {
  [P in K as 'get']: <U extends P>(key: U) => T[U]
} & {
  [P in K as 'set']: <U extends P>(key: U, value: T[U]) => TypeMap<T>
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

/**
 * The underlying type for all Jess nodes
 */
export abstract class Node<
  T = any,
  O extends NodeOptions = NodeOptions,
  M extends NodeTypeMap = NodeMapType<T>
> {
  readonly location: LocationInfo
  readonly treeContext: TreeContext

  options: O & AllNodeOptions | undefined

  readonly type: string
  readonly shortType: string

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

  evaluated: boolean
  allowRoot: boolean
  allowRuleRoot: boolean

  /** Used by Ruleset */
  rootRules: Node[] | undefined

  /** Used in iterators */
  _next: Node

  /**
   * This should always represent the `data` of the Node
   */
  protected readonly data: TypeMap<M>

  constructor(
    value: M['value'] | TypeMap<M> | Array<[string, any]>,
    options?: O,
    location?: LocationInfo | 0,
    treeContext?: TreeContext
  ) {
    if (value === undefined) {
      throw new Error('Node requires a value.')
    }

    this.data = new Map(isNodeMap(value) ? value : [['value', value]]) as TypeMap<M>
    this.location = location || []
    this.treeContext = treeContext ?? new TreeContext()
    this.options = options
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

  /**
   * Mutates node children in place. Used by eval()
   * which first makes a shallow clone before mutating.
   */
  processNodes(func: (n: Node) => NodeValue) {
    this.data.forEach((nodeVal, key, map) => {
      /** Process Node arrays only */
      if (Array.isArray(nodeVal)) {
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
      if (Array.isArray(nodeVal)) {
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
   * Fire a function for each Node in the tree, recursively
   */
  walkNodes(func: (n: Node) => void) {
    this.data.forEach(nodeVal => {
      /** Process Node arrays only */
      if (Array.isArray(nodeVal)) {
        for (let i = 0; i < nodeVal.length; i++) {
          let node = nodeVal[i]
          if (node instanceof Node) {
            func(node)
            node.walkNodes(func)
          }
        }
      } else if (nodeVal instanceof Node) {
        func(nodeVal)
        nodeVal.walkNodes(func)
      }
    })
  }

  collectRoots(): Node[] {
    let nodes = new Set<Node>()
    this.walkNodes(n => {
      if (n.type === 'Ruleset') {
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
   *
   * @todo - Cloning should strip comments, except in the
   * case of custom declaration values.
   */
  clone(deep?: boolean): this {
    let Class: Constructor<this> = Object.getPrototypeOf(this).constructor

    let newNode = new Class(
      /**
       * Creates a new Map object instance.
       * Otherwise, replacing nodes would replace them
       * in the old map.
       */
      new Map(this.data),
      this.options,
      this.location,
      this.treeContext
    )

    if (deep) {
      newNode.processNodes(n => n.clone(deep))
    }
    newNode.pre = this.pre
    newNode.post = this.post
    newNode.evaluated = this.evaluated

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
      node.inherit(this)
      node.evaluated = true
      return node
    }
    return this as unknown as T
  }

  /** Override normally readonly props to make them inheritable */
  inherit(node: Node) {
    (this as Writable<this>).location = node.location
    ;(this as Writable<this>).treeContext = node.treeContext
    this.evaluated = node.evaluated
    this.pre = node.pre
    this.post = node.post
    return this
  }

  /**
   * @todo - it's not clear this needs to be in the
   * root Node class, except it can be then generally
   * called on any node.
   */
  valueOf(): any {
    let values = [...this.data.values()]
    if (values.length === 1) {
      return values[0]
    }
    return values
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
    let output = ''
    output += this.processPrePost('pre')
    output += this.toTrimmedString(depth)
    output += this.processPrePost('post')
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
      if (Array.isArray(value)) {
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
    let aVal = this.toString()
    let bVal = b.toString()
    if (aVal === bVal) {
      return 0
    } else if (aVal > bVal) {
      return 1
    } else if (aVal < bVal) {
      return -1
    }
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

  fround(value: number) {
    // add "epsilon" to ensure numbers like 1.000000005 (represented as 1.000000004999...) are properly rounded:
    return Number((value + 2e-16).toFixed(8))
  }

  /**
   * Generates a .js module
   * @todo - Generate a .ts module & .js.map
   */
  /** Move to ToModuleVisitor */
  // toModule?(context: Context, out: OutputCollector): void

  /** Generate a .css file and .css.map */
  /** Move to ToCssVisitor */
  // toCSS(context: Context, out: OutputCollector): void {
  //   const value = this.value
  //   const loc = this.location
  //   if (Array.isArray(value)) {
  //     value.forEach(n => {
  //       if (n instanceof Node) {
  //         n.toCSS(context, out)
  //       } else {
  //         out.add(n.toString(), loc)
  //       }
  //     })
  //   } else {
  //     if (value instanceof Node) {
  //       value.toCSS(context, out)
  //     } else {
  //       out.add(value.toString(), loc)
  //     }
  //   }
  // }
}