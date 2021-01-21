import * as $JESS from 'jess'
const $J = $JESS.tree
const $CONTEXT = new $JESS.Context
$CONTEXT.id = '721fedcc'
function $DEFAULT ($VARS = {}, $RETURN_NODE) {
  const $TREE = $J.root((() => {
    const $OUT = []
    $OUT.push($J.rule({
      sels: $J.list([
        $J.sel([$J.el(".box")])
      ]),
      value: $J.ruleset(
        (() => {
          const $OUT = []
          $OUT.push($J.decl({
            name: $J.expr(["foo"]),
            value: "bar"
          }))
          return $OUT
        })()
      )},[1,1,0,3,1,19]))
    return $OUT
  })(),[1,1,0,3,1,19])
  if ($RETURN_NODE) {
    return $TREE
  }
  return $JESS.render($TREE, $CONTEXT)
}
$DEFAULT["box"] = "box_721fedcc"
export default $DEFAULT