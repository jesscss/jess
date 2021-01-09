
import * as Jess from 'jess'
const J = Jess.tree
import { area } from './imports/compute'

export default (__VARS) => {
  const __CONTEXT = new Jess.Context
  /** @todo - Assign __VARS to let vars */

  const __TREE = J.root((() => {
    const __OUT = []
    __OUT.push(J.rule({
      sel: [
        J.list([
          J.sel([J.el(".box")])
        ])
      ],
      rules: (() => {
        const __OUT = []
        __OUT.push(J.decl({
          name: "foo",
          value: J.js(`${area(5)}`)
        }))
        return __OUT
      })()
    }))
    return __OUT
  })())
  return Jess.render(__TREE, __CONTEXT)
}