import { Context } from '../context'
import type { Visitor } from '../visitor'
import { OutputCollector } from '../output'

export type Primitive = string | number | Node
/** Function is used by the Call node */
export type NodeValue = Function | Primitive | Primitive[]
export type NodeMap = {
  value?: NodeValue
  [k: string]: NodeValue
}

export type LocationInfo = [
  startOffset?: number,
  startLine?: number,
  startColumn?: number,
  endOffset?: number,
  endLine?: number,
  endColumn?: number,
]

export type FileInfo = {
  filename?: string
  rootpath?: string
}

export const isNodeMap = (val: NodeValue | NodeMap): val is NodeMap => {
  return val && typeof val === 'object' && val.constructor === Object
}

export abstract class Node {
  location: LocationInfo
  fileInfo: FileInfo

  evaluated: boolean

  _nodeKeys: string[]

  value: NodeValue
  /** We'll put arbitrary props on the node */
  [k: string]: unknown

  constructor(
    value: NodeValue | NodeMap,
    location?: LocationInfo,
    fileInfo?: FileInfo
  ) {
    if (value === undefined) {
      throw { message: 'Node requires a value.' }
    }
    let nodes: NodeMap
    let nodeKeys: string[]
    if (isNodeMap(value)) {
      nodes = value
      nodeKeys = Object.keys(nodes);
    } else {
      nodes = { value }
      nodeKeys = ['value'];
    }
    this._nodeKeys = nodeKeys;

    /** Place all sub-node keys on `this` */
    nodeKeys.forEach(key => {
      const value = nodes[key]
      this[key] = value
    })

    this.location = location || []
    this.fileInfo = fileInfo || {}
  }

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
              continue
            }
          }
          this[key] = out
        } else if (nodeVal instanceof Node) {
          this[key] = func(nodeVal)
        }
      }
    })
  }
  
  accept(visitor: Visitor) {
    this.processNodes(n => visitor.visit(n));
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

  toString(): string {
    const out = new OutputCollector
    this.toCSS(new Context({ global: true }), out)
    return out.toString()
  }

  valueOf() {
    return this.value
  }

  /** 
   * Generate a .ts module and .ts.map
   * @todo - Should we generate an ESTree AST to avoid re-parsing in Rollup?
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