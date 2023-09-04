/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import type { Context } from '../context'
import type { Visitor } from '../visitor'
import type { OutputCollector } from '../output'
import type { Constructor, Writable } from 'type-fest'

export type Primitive = string | number | Node
export type NodeOptions = Record<string, boolean | string>

/**
 * Function is used by the Call node
 * @todo Remove for 2.0?
 */
export type NodeValue = ((...args: any[]) => any) | Primitive | Primitive[]
export type NodeMapArray = Array<[string, NodeValue]>
export type NodeMap = Map<string, NodeValue>
export type NodeInValue = NodeValue | NodeMapArray | NodeMap

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

export abstract class Node<T extends NodeValue = NodeValue, O extends NodeOptions = NodeOptions> {
  readonly location: LocationInfo
  readonly fileInfo: FileInfo | undefined

  readonly options: O | undefined

  readonly type: string
  readonly shortType: string

  /**
   * Whitespace or comments. If this is `false`,
   * it represents a single space character.
   *
   * If it's `undefined`, it means there were
   * no tokens whatsoever.
   *
   * We use `false` and `undefined` so we can
   * do falsey checks when evaluating.
   */
  readonly pre: Node[] | false | undefined
  readonly post: Node[] | false | undefined

  evaluated: boolean
  allowRoot: boolean
  allowRuleRoot: boolean

  /** Used by Ruleset */
  rootRules: Node[]

  /**
   * This should always represent the `data` of the Node
   */
  protected readonly valueMap: Map<string, NodeValue>

  constructor(
    value: NodeInValue,
    location?: LocationInfo | 0,
    options?: O,
    fileInfo?: FileInfo
  ) {
    if (value === undefined) {
      throw new Error('Node requires a value.')
    }

    this.valueMap = new Map(isNodeMap(value) ? value : [['value', value]])
    this.location = location || []
    this.fileInfo = fileInfo
    this.options = options
  }

  get value(): T {
    return this.valueMap.get('value') as T
  }

  /**
   * Mutates node children in place. Used by eval()
   * which first makes a shallow clone before mutating.
   */
  processNodes(func: (n: Node) => Node) {
    this.valueMap.forEach((nodeVal, key, map) => {
      /** Process Node arrays only */
      if (Array.isArray(nodeVal)) {
        const out = []
        for (let i = 0; i < nodeVal.length; i++) {
          const node = nodeVal[i]
          const result = node instanceof Node ? func(node) : node
          if (result) {
            out.push(result)
          }
        }
        map.set(key, out)
      } else if (nodeVal instanceof Node) {
        map.set(key, func(nodeVal))
      }
    })
  }

  /**
   * Fire a function for each Node in the tree, recursively
   */
  walkNodes(func: (n: Node) => void) {
    this.valueMap.forEach((nodeVal, key, map) => {
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
   */
  clone(): this {
    const Class: Constructor<this> = Object.getPrototypeOf(this).constructor

    const newNode = new Class(
      this.valueMap,
      this.location,
      this.options,
      this.fileInfo
    )

    newNode.evaluated = this.evaluated

    return newNode
  }

  eval(context: Context): Node {
    if (!this.evaluated) {
      const node = this.clone()
      node.processNodes(n => n.eval(context))
      node.evaluated = true
      return node
    }
    return this
  }

  /** Override normally readonly props to make them inheritable */
  inherit(node: Node) {
    (this as Writable<this>).location = node.location
    ;(this as Writable<this>).fileInfo = node.fileInfo
    this.evaluated = node.evaluated
    return this
  }

  fround(value: number) {
    // add "epsilon" to ensure numbers like 1.000000005 (represented as 1.000000004999...) are properly rounded:
    return Number((value + 2e-16).toFixed(8))
  }

  valueOf() {
    const values = [...this.valueMap.values()]
    if (values.length === 1) {
      return values[0]
    }
    return values
  }

  /**
   * Generates a .js module
   * @todo - Generate a .ts module & .js.map
   */
  toModule?(context: Context, out: OutputCollector): void

  /** Generate a .css file and .css.map */
  toCSS(context: Context, out: OutputCollector): void {
    const value = this.value
    const loc = this.location
    if (Array.isArray(value)) {
      value.forEach(n => {
        if (n instanceof Node) {
          n.toCSS(context, out)
        } else {
          out.add(n.toString(), loc)
        }
      })
    } else {
      if (value instanceof Node) {
        value.toCSS(context, out)
      } else {
        out.add(value.toString(), loc)
      }
    }
  }
}