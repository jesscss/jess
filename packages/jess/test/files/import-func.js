import * as $JESS from 'jess'
const $J = $JESS.tree
const $CONTEXT = new $JESS.Context
$CONTEXT.id = '1fef6088'
import { area } from './imports/compute.ts'


function $DEFAULT ($VARS = {}, $RETURN_NODE) {
  
  const $TREE = $J.root((() => {
    const $OUT = []
    $OUT.push($J.rule({
      sels: $J.list([
        $J.sel([$J.el($J.anon(".box"))])
      ]),
      value: $J.ruleset(
        (() => {
          const $OUT = []
          $OUT.push($J.decl({
            name: $J.expr([$J.anon("area")]),
            value: $J.cast(area(5))
          }))
          return $OUT
        })()
      )},[3,1,46,5,1,71]))
    return $OUT
  })(),[1,1,0,5,1,71])
  if ($RETURN_NODE) {
    return $TREE
  }
  return $JESS.renderCss($TREE, $CONTEXT)
}
$DEFAULT.$IS_NODE = true
$DEFAULT["box"] = "box"
export default $DEFAULT