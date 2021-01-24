import * as $JESS from 'jess'
const $J = $JESS.tree
const $CONTEXT = new $JESS.Context
$CONTEXT.id = '5cbed36d'
import styles from './imports/rule.jess'
function $DEFAULT ($VARS = {}, $RETURN_NODE) {
  
  const $TREE = $J.root((() => {
    const $OUT = []
    $OUT.push($J.include($J.call({
      name: "styles",
      value: $J.expr([]),
      ref: () => styles,
    })
))
    return $OUT
  })(),[1,1,0,3,18,61])
  if ($RETURN_NODE) {
    return $TREE
  }
  return $JESS.renderCss($TREE, $CONTEXT)
}
$DEFAULT.$IS_NODE = true
export default $DEFAULT