
import * as Jess from '../../src'
const J = Jess.tree
const __CONTEXT = new Jess.Context

/** My nodes */
import { area } from './imports/compute'
export let something = 1

export default (__VARS = {}) => {
  const { module, ...rest } = __VARS

  something = rest.something !== undefined ? rest.something : something

  const __TREE = J.root((() => {
    const __OUT = []
    __OUT.push(J.rule({
      sels: 
        J.list([
          J.sel([J.el(".box")])
        ]),
      value: (() => {
        const __OUT = []
        __OUT.push(J.decl({
          name: "foo",
          value: J.cast(area(5))
        }))
        return __OUT
      })()
    }))
    return __OUT
  })())
  return Jess.render(__TREE, __CONTEXT)
}