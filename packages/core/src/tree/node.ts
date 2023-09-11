/* eslint-disable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-plus-operands */
import type { Context } from '../context'
import type { Visitor } from '../visitor'
// import type { OutputCollector } from '../output'
import type { Constructor, Writable, Class, ValueOf } from 'type-fest'

export type Concrete = string | number | boolean | Node
export type NodeOptions = Record<string, boolean | string>

/**
 * Function is used by the Call node
 * @todo Remove for 2.0?
 */
export type NodeValue = unknown // ((...args: any[]) => any) | Concrete | Concrete[] | Concrete[][]
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

export interface FileInfo {
  filename?: string
  rootpath?: string
}

/**
 * Assume the value is a NodeMap if it's an array of arrays
 *
 * This just checks that it can be safely passed to `new Map()`
 */
export const isNodeMap = (val: any): val is NodeMap | NodeMapArray => {
  return val instanceof Map || (Array.isArray(val) && Array.isArray(val[0]))
}

export const defineType = <
  T = unknown,
  M extends NodeTypeMap = NodeMapType<T>,
  U extends Node<M> = Node<M>,
  C extends Class<U> = Class<U>
>(Clazz: C, type: string, shortType?: string) => {
  shortType ??= type.toLowerCase()
  ;(Clazz.prototype as Writable<U>).type = type
  ;(Clazz.prototype as Writable<U>).shortType = shortType

  /** @todo - not yet returning the correct types for args */
  return (...args: ConstructorParameters<C>) => new Clazz(...args)
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
  [P in K as 'get']: <U extends P>(key: U) => T[U]
} & {
  [P in K as 'set']: <U extends P>(key: U, value: T[U]) => TypeMap<T>
}

type NodeMapType<T> = T extends NodeTypeMap ? T : { value: T }

export abstract class Node<
  T = any,
  O extends NodeOptions = NodeOptions,
  M extends NodeTypeMap = NodeMapType<T>
> {
  readonly location: LocationInfo
  readonly fileInfo: FileInfo | undefined

  readonly options: O | undefined

  readonly type: string
  readonly shortType: string

  /**
   * Whitespace or comments before or after a Node.
   * If this is `1`, it represents a single space character (' ').
   *
   * If it's 0, it means there were no tokens whatsoever.
   */
  pre: Array<string | Node> | 1 | 0
  post: Array<string | Node> | 1 | 0

  evaluated: boolean
  allowRoot: boolean
  allowRuleRoot: boolean

  /** Used by Ruleset */
  rootRules: Node[]

  /** Used in iterators */
  _next: Node

  /**
   * This should always represent the `data` of the Node
   */
  protected readonly data: TypeMap<M>

  constructor(
    value: NodeInValue,
    location?: LocationInfo | 0,
    options?: O,
    fileInfo?: FileInfo
  ) {
    if (value === undefined) {
      throw new Error('Node requires a value.')
    }

    this.data = new Map(isNodeMap(value) ? value : [['value', value]]) as TypeMap<M>
    this.location = location || []
    this.fileInfo = fileInfo
    this.options = options
  }

  get value() {
    return this.data.get('value')
  }

  set value(n: M['value']) {
    if (this.data.has('value')) {
      this.data.set('value', n)
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
        const out = []
        for (let i = 0; i < nodeVal.length; i++) {
          const node = nodeVal[i]
          const result = node instanceof Node ? func(node) : node
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
   * Fire a function for each Node in the tree, recursively
   */
  walkNodes(func: (n: Node) => void) {
    this.data.forEach(nodeVal => {
      /** Process Node arrays only */
      if (Array.isArray(nodeVal)) {
        for (let i = 0; i < nodeVal.length; i++) {
          const node = nodeVal[i]
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
    const nodes = new Set<Node>()
    this.walkNodes(n => {
      if (n.type === 'Ruleset') {
        n.rootRules.forEach(n => {
          nodes.add(n)
        })
        n.rootRules = []
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
    const Class: Constructor<this> = Object.getPrototypeOf(this).constructor

    const newNode = new Class(
      this.data,
      this.location,
      this.options,
      this.fileInfo
    )

    if (deep) {
      this.processNodes(n => n.clone())
    }
    newNode.evaluated = this.evaluated

    return newNode
  }

  /**
   * Individual nodes will specify type
   * when overriding eval()
   */
  eval(context: Context): Node {
    if (!this.evaluated) {
      const node = this.clone()
      node.processNodes(n => n.eval(context))
      return this.finishEval(node)
    }
    return this
  }

  finishEval<T extends Node = Node>(n: T | Node): T & { evaluated: true } {
    if (!n.evaluated) {
      n.evaluated = true
    }
    return n as T & { evaluated: true }
  }

  /** Override normally readonly props to make them inheritable */
  inherit(node: Node) {
    (this as Writable<this>).location = node.location
    ;(this as Writable<this>).fileInfo = node.fileInfo
    this.evaluated = node.evaluated
    return this
  }

  /**
   * @todo - should this just return `this.data.get('value')`?
   * The use cases aren't clear.
   */
  valueOf() {
    const values = [...this.data.values()]
    if (values.length === 1) {
      return values[0]
    }
    return values
  }

  toString() {
    const value = this.valueOf()
    if (Array.isArray(value)) {
      return value.join('')
    }
    return String(value)
  }

  /**
   * Individual node types will override this.
   *
   * This is just a default implementation.
   * 0 = equal (==)
   * 1 = greater than (>)
   * -1 = less than (<)
   */
  compare(b: Node, context?: Context) {
    const aVal = this.toString()
    const bVal = b.toString()
    if (aVal === bVal) {
      return 0
    } else if (aVal > bVal) {
      return 1
    } else {
      return -1
    }
  }

  /**
   * Individual node types will override this.
   */
  operate(b: Node, op: '+' | '-' | '*' | '/', context?: Context) {
    const aVal: any = this.valueOf()
    const bVal: any = b.valueOf()
    switch (op) {
      case '+':
        return aVal + bVal
      case '-':
        return aVal - bVal
      case '*':
        return aVal * bVal
      case '/':
        return aVal / bVal
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