import { type CompoundSelectorValue } from './selector-compound'
import { type ComplexSelectorValue } from './selector-complex'
import { type Node } from './node'

interface FindContext {
  tree: TreeNode
  nodesToFind: Set<Node>
  done?: boolean
}
/**
 *
 */
export class TreeNode<V extends Node = Node, C extends Node = Node> {
  constructor(
    public value: V,
    public children: Array<TreeNode<C>> = []
  ) {}

  find(query: TreeNode, ctx: FindContext = { nodesToFind: new Set(), tree: this }) {
    const { nodesToFind } = ctx
    const { value: findValue, children: findChildren } = query
    const { value, children } = this
    if (!findChildren.length) {
      nodesToFind.add(findValue)
      if (!children.length) {
        if (findValue.compare(value) === 0) {
          nodesToFind.delete(findValue)
          if (nodesToFind.size === 0) {
            ctx.done = true
            return ctx
          }
        }
      } else {
        let length = children.length
        for (let i = 0; i < length; i++) {
          children[i]!.find(query, ctx)
          if (ctx.done) {
            return ctx
          }
        }
      }
    }
  }

  // toString() {
  //   return `${this.value}${this.children}`
  // }

  // private _collectPaths(): TreeNode[][] {
  //   let { children } = this
  //   let paths: TreeNode[][] = []
  //   if (!children.length) {
  //     paths.push([this])
  //   } else {
  //     children.forEach(child => {
  //       let childPaths = child._collectPaths()
  //       if (!childPaths.length) {
  //         paths.push([this, child])
  //       } else {
  //         for (let j = 0; j < childPaths.length; j++) {
  //           paths.push([this, ...childPaths[j]!])
  //         }
  //       }
  //     })
  //   }
  //   return paths
  // }

  // getPaths() {
  //   let paths = this._collectPaths()
  //   return paths.map(path => path.map(n => n.value))
  // }
}

export class CompoundTreeNode extends TreeNode {}
export class ComplexTreeNode extends TreeNode {}