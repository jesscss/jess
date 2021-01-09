import type { Context } from '../context'
import type { Visitor } from '../visitor'

export type Primitive = string | Node | Node[]
export type NodeCollection = {
  value: Primitive
  [k: string]: Primitive
}

export type ILocationInfo = {
  startOffset?: number
  startLine?: number
  startColumn?: number
  endOffset?: number
  endLine?: number
  endColumn?: number
}

export type IFileInfo = {
  filename?: string
  rootpath?: string
}

export abstract class Node {
  nodes: NodeCollection
  location: ILocationInfo
  fileInfo: IFileInfo

  evaluated: boolean

  constructor(
    value: Primitive | NodeCollection,
    location?: ILocationInfo,
    fileInfo?: IFileInfo
  ) {
    if (typeof value === 'object' && value.constructor === Object) {
      this.nodes = <NodeCollection>value
    } else {
      this.nodes = { value: <Primitive>value }
    }
    this.location = location || {}
    this.fileInfo = fileInfo || {}
  }

  processNodes(func: (n: Node) => Node) {
    const nodes = this.nodes
    const values = Object.entries(nodes)
    values.forEach(([key, nodeVal]) => {
      if (nodeVal) {
        /** Process Node arrays only */
        if (Array.isArray(nodeVal) && nodeVal[0] instanceof Node) {
          const out = []
          for (let i = 0; i < nodeVal.length; i++) {
            const node = <Node>nodeVal[i]
            const result = func(node)
            if (result) {
              out.push(result)
              continue
            }
          }
          nodes[key] = out
        } else if (nodeVal instanceof Node) {
          nodes[key] = func(nodeVal)
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
    const newNode = new Clazz(
      this.nodes,
      this.location,
      this.fileInfo
    )

    /** Copy inheritance props */
    newNode.inherit(this)

    return newNode
  }

  eval(context: Context) {
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
}