/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import type { Context } from '../context'
import type { Visitor } from '../visitor'
import type { OutputCollector } from '../output'

export type Primitive = string | number | Node
export type NodeOptions = Record<string, boolean | string>

export interface NodeMap {
  value?: NodeValue
  [k: string]: NodeValue | undefined
}

/**
 * Function is used by the Call node
 * @todo Remove for 2.0?
 */
export type NodeValue = ((...args: any[]) => any) | Primitive | Primitive[] | NodeMap

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

export const isNodeMap = (val: any): val is NodeMap => {
  return !!val &&
    typeof val === 'object' &&
    val.constructor === Object &&
    Object.prototype.hasOwnProperty.call(val, 'value')
}

export abstract class Node<T extends NodeValue = NodeValue, O extends NodeOptions = NodeOptions> {
  location: LocationInfo
  fileInfo: FileInfo | undefined
  options: O | undefined

  type: string
  shortType: string

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
  pre: Node[] | false | undefined
  post: Node[] | false | undefined

  evaluated: boolean
  allowRoot: boolean
  allowRuleRoot: boolean

  private readonly _nodeKeys: string[]

  /** Used by Ruleset */
  rootRules: Node[]

  /** Individual nodes define stricter types */
  value: T
  /** We'll put arbitrary props on the node */
  [k: string]: unknown

  constructor(
    value: any,
    location?: LocationInfo | 0,
    options?: O,
    fileInfo?: FileInfo
  ) {
    if (value === undefined) {
      throw new Error('Node requires a value.')
    }
    let nodes: NodeMap
    let nodeKeys: string[]
    if (isNodeMap(value)) {
      nodes = value
      nodeKeys = Object.keys(nodes)
    } else {
      nodes = { value }
      nodeKeys = ['value']
    }
    this._nodeKeys = nodeKeys

    /**
     * Place all sub-node keys on `this`
     *
     * When we pass an object as the first value,
     * the keys are assigned to `this` directly,
     * which keeps implementation of Node subclasses
     * simple.
     */
    nodeKeys.forEach(key => {
      const value = nodes[key]
      this[key] = value
    })

    this.location = location || []
    this.fileInfo = fileInfo
    this.options = options
  }

  /**
   * Mutates node children in place. Used by eval()
   * which first makes a shallow clone before mutating.
   */
  processNodes(func: (n: Node) => Node) {
    const keys = this._nodeKeys
    keys.forEach(key => {
      const nodeVal = this[key]
      if (nodeVal) {
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
          this[key] = out
        } else if (nodeVal instanceof Node) {
          this[key] = func(nodeVal)
        }
      }
    })
  }

  /**
   * Fire a function for each Node in the tree, recursively
   */
  walkNodes(func: (n: Node) => void) {
    const keys = this._nodeKeys
    keys.forEach(key => {
      const nodeVal = this[key]
      if (nodeVal) {
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
    const Clazz = Object.getPrototypeOf(this).constructor
    const nodeKeys = this._nodeKeys
    const nodes: Record<string, any> = {}
    nodeKeys.forEach(key => {
      nodes[key] = this[key]
    })
    const newNode = new Clazz(
      nodes,
      this.location,
      this.fileInfo
    )

    /**
     * Copy added properties on `this`
     */
    for (const prop in this) {
      if (Object.prototype.hasOwnProperty.call(this, prop) && !nodeKeys.includes(prop)) {
        newNode[prop] = this[prop]
      }
    }

    /** Copy inheritance props */
    newNode.inherit(this)

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

  inherit(node: Node) {
    this.location = node.location
    this.fileInfo = node.fileInfo
    this.evaluated = node.evaluated
    return this
  }

  fround(value: number) {
    // add "epsilon" to ensure numbers like 1.000000005 (represented as 1.000000004999...) are properly rounded:
    return Number((value + 2e-16).toFixed(8))
  }

  valueOf() {
    return this.value
  }

  /**
   * Generates a .js module
   * @todo - Generate a .ts module & .js.map
   */
  abstract toModule(context: Context, out: OutputCollector): void

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