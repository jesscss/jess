/**
 *
 */

export class TreeNode<V = any, C = any> {
  constructor(
    public value: V,
    public children: Array<TreeNode<C>>
  ) {}

  toString() {
    return `${this.value}${this.children}`
  }

  private _collectPaths(): TreeNode[][] {
    let { children } = this
    let paths: TreeNode[][] = []
    if (!children.length) {
      paths.push([this])
    } else {
      children.forEach(child => {
        let childPaths = child._collectPaths()
        if (!childPaths.length) {
          paths.push([this, child])
        } else {
          for (let j = 0; j < childPaths.length; j++) {
            paths.push([this, ...childPaths[j]!])
          }
        }
      })
    }
    return paths
  }

  getPaths() {
    let paths = this._collectPaths()
    return paths.map(path => path.map(n => n.value))
  }
}