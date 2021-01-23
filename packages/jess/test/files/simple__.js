import { Context, renderCss, tree } from 'jess';

const $J = tree;
const $CONTEXT = new Context;
$CONTEXT.id = '721fedcc';
function $DEFAULT ($VARS = {}, $RETURN_NODE) {
  const $TREE = $J.root((() => {
    const $OUT = [];
    $OUT.push($J.rule({
      sels: $J.list([
        $J.sel([$J.el($J.anon(".box"))])
      ]),
      value: $J.ruleset(
        (() => {
          const $OUT = [];
          $OUT.push($J.decl({
            name: $J.expr([$J.anon("foo")]),
            value: $J.anon("bar")
          }));
          return $OUT
        })()
      )},[1,1,0,3,1,19]));
    return $OUT
  })(),[1,1,0,3,1,19]);
  if ($RETURN_NODE) {
    return $TREE
  }
  return renderCss($TREE, $CONTEXT)
}
$DEFAULT["box"] = "box";

export default $DEFAULT;
