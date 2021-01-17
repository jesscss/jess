
import * as _JESS from '../../src'
const _J = _JESS.tree
const __CONTEXT = new _JESS.Context

/** My nodes */
import { area } from './imports/compute'
export let something = 1
let __BK_something = something

export default (__VARS = {}, __RETURN_NODE) => {
  const { module, ...rest } = __VARS

  let something = _JESS.merge(__BK_something, rest.something)

  const __TREE = _J.root((() => {
    const __OUT = []
    __OUT.push(_J.rule({
      sels: 
        _J.list([
          _J.sel([_J.el(".box")])
        ]),
      value: (() => {
        const __OUT = []
        __OUT.push(_J.decl({
          name: "foo",
          value: _J.cast(area(5))
        }))
        return __OUT
      })()
    }))
    return __OUT
  })())
  if (__RETURN_NODE) {
    return __TREE
  }
  return _JESS.renderCss(__TREE, __CONTEXT)
}