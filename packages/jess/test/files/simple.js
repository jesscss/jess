
import * as Jess from 'jess'
const J = Jess.tree

export default (__VARS) => {
  const __CONTEXT = new Jess.Context
  /** @todo - Assign __VARS to let vars */

  const __TREE = J.root([
    J.rule({
      sel: [
        J.list([
          J.sel([J.el(".box")])
        ])
      ],
      rules: (() => {
        const __OUT = []
        __OUT.push(J.decl({
          name: "foo",
          value: J.str("bar")
        }))
        return __OUT
      })()
    })
  ])
  return Jess.render(__TREE, __CONTEXT)
}