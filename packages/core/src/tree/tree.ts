// import { Queue } from 'data-structure-typed'
import type { Combinator } from './combinator'
import { type Selector } from './selector'
import { SinglyLinkedList } from 'data-structure-typed'

interface FindContext {
  tree: SelectorTree
  searchTrees: Set<SelectorTree>
  foundTrees: Set<SelectorTree>
  matchStart?: SelectorTree
  matchEnd?: SelectorTree
  done?: boolean
}
/**
 * @todo - Narrow children types for each tree type?
 */
export class SelectorTree {
  children: SinglyLinkedList<SelectorTree>
  constructor(
    public value: Selector | Combinator,
    childrenArr?: SelectorTree[] | SinglyLinkedList<SelectorTree>,
    public type: 'simple' | 'is' | 'compound' | 'complex' = 'simple'
  ) {
    this.children = new SinglyLinkedList(childrenArr)
  }

  clone(): this {
    return new SelectorTree(this.value, new SinglyLinkedList(this.children.map(child => child.clone()))) as typeof this
  }

  // getSearchTrees(query: SelectorTreeNode, trees = new Queue<SelectorTreeNode>()) {
  //   if (query instanceof CompoundTreeNode) {
  //     query.children.forEach(child => this.getSearchTrees(child, trees))
  //   }
  // }

  find(
    query: SelectorTree,
    ctx: FindContext = {
      searchTrees: new Set(),
      foundTrees: new Set(),
      tree: this
    },
    parent = this
  ) {
    const { value: findValue, children: findChildren } = query
    const { type, value, children } = this

    switch (query.type) {
      case 'complex':
      case 'compound':
      case 'is':
        for (let findChild of findChildren) {
          ctx.searchTrees.add(findChild)
        }
        if (type === 'simple') {
          ctx.done = true
        }
        for (let tree of ctx.searchTrees) {
          this.find(tree, ctx, parent)
        }
        /** All search trees should have been exhausted */
        if (ctx.searchTrees.size !== 0) {
          ctx.matchEnd = undefined
          ctx.done = true
        }
        break
      case 'simple':
        /**
         * Simple query can be found within
         * 1. This tree's value (if it's a 'simple')
         * 2. This tree's children (if it's a 'compound' | 'complex')
         * 3. Recursively in this tree's children (if it's an 'is')
         */
        switch (this.type) {
          case 'complex':
          case 'compound':
          case 'is':
            for (let child of children) {
              /** Children can only match once */
              if (!ctx.foundTrees.has(child)) {
                child.find(query, ctx, this)
                if (ctx.done) {
                  return ctx
                }
              }
            }
            break
          case 'simple':
            if (value.compare(findValue) === 0) {
              /** Found a match! */
              if (ctx.searchTrees.has(query)) {
                ctx.searchTrees.delete(query)
              }
              ctx.foundTrees.add(this)
              if (!ctx.matchStart) {
                ctx.matchStart = parent
              }
              ctx.matchEnd = parent
              ctx.done = true
              return ctx
            }
            break
        }
        break
      // case 'compound':
      //   if (value === findValue) {
      //     ctx.foundTrees.add(this)
      //   }
      //   break
      // case 'complex':
      //   if (value === findValue) {
      //     ctx.foundTrees.add(this)
      //   }
      //   break
      // case 'is':
      //   if (value === findValue) {
      //     ctx.foundTrees.add(this)
      //   }
      //   break
    }
    return ctx
  }

  // find(query: TreeNode, ctx: FindContext = { searchTrees: new Set(), foundTrees: new Set(), tree: this }) {
  //   const { nodesToFind } = ctx
  //   const { value: findValue, children: findChildren } = query
  //   const { value, children } = this
  //   if (query instanceof CompoundTreeNode) {
  //     for (let child of query.children) {
  //       ctx.searchTrees.add(child)
  //     }
  //   }
  //   // if (!findChildren.length) {
  //   //   nodesToFind.add(findValue)
  //   //   if (!children.length) {
  //   //     if (findValue.compare(value) === 0) {
  //   //       nodesToFind.delete(findValue)
  //   //       if (!ctx.foundSegment) {
  //   //         ctx.foundSegment = this.clone()
  //   //       }
  //   //       if (nodesToFind.size === 0) {
  //   //         ctx.done = true
  //   //         return ctx
  //   //       }
  //   //     }
  //   //   } else {
  //   //     let length = children.length
  //   //     for (let i = 0; i < length; i++) {
  //   //       children[i]!.find(query, ctx)
  //   //       if (ctx.done) {
  //   //         return ctx
  //   //       }
  //   //     }
  //   //   }
  //   // }
  // }

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
