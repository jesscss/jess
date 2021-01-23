import { Context, renderCss, tree } from 'jess';

const area = (radius) => {
  return (radius * radius) * Math.PI
};

const $J = tree;
const $CONTEXT = new Context;
$CONTEXT.id = '1fef6088';


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
            name: $J.expr([$J.anon("area")]),
            value: $J.cast(area(5))
          }));
          return $OUT
        })()
      )},[3,1,46,5,1,71]));
    return $OUT
  })(),[1,1,0,5,1,71]);
  if ($RETURN_NODE) {
    return $TREE
  }
  return renderCss($TREE, $CONTEXT)
}
$DEFAULT["box"] = "box";

export default $DEFAULT;
