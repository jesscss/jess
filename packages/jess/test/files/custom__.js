import { Context, tree, merge, renderCss } from 'jess';

const $J = tree;
const $CONTEXT = new Context;
$CONTEXT.id = '-50c0ae18';
let config = {
  "colors": {
    "primary": $J.anon("red")
  }
};

const $J$1 = tree;
const $CONTEXT$1 = new Context;
$CONTEXT$1.id = '1e33447a';
let config$1 = $J$1.cast(config);
let $BK_config = config$1;
let colors = $J$1.cast(config$1.colors);
let $BK_colors = colors;
function $DEFAULT ($VARS = {}, $RETURN_NODE) {
  
  let config = merge($BK_config, $VARS.config);
  let colors = merge($BK_colors, $VARS.colors);
  const $TREE = $J$1.root((() => {
    const $OUT = [];
    $OUT.push($J$1.rule({
      sels: $J$1.list([
        $J$1.sel([$J$1.el($J$1.anon(".rule"))])
      ]),
      value: $J$1.ruleset(
        (() => {
          const $OUT = [];
          $OUT.push($J$1.decl({
            name: $J$1.expr([$J$1.anon("color")]),
            value: $J$1.cast(colors.primary)
          }));
          return $OUT
        })()
      )},[6,1,112,8,1,146]));
    return $OUT
  })(),[1,1,0,8,1,146]);
  if ($RETURN_NODE) {
    return $TREE
  }
  return renderCss($TREE, $CONTEXT$1)
}
$DEFAULT["rule"] = "rule";

const $J$2 = tree;
const $CONTEXT$2 = new Context;
$CONTEXT$2.id = '3dc9c6d';
let config$2 = $J$2.cast(config);
let $BK_config$1 = config$2;
function $DEFAULT$1 ($VARS = {}, $RETURN_NODE) {
  
  
  let config = merge($BK_config$1, $VARS.config);
  const $TREE = $J$2.root((() => {
    const $OUT = [];
    $OUT.push($J$2.call({
      name: "colors",
      value: $J$2.cast(config),
      ref: () => $DEFAULT,
    })
);
    $OUT.push($J$2.call({
      name: "nav",
      value: $J$2.cast(config),
      ref: () => nav,
    })
);
    return $OUT
  })(),[1,1,0,7,23,168]);
  if ($RETURN_NODE) {
    return $TREE
  }
  return renderCss($TREE, $CONTEXT$2)
}

const $J$3 = tree;
const $CONTEXT$3 = new Context;
$CONTEXT$3.id = '5cbed36d';
function $DEFAULT$2 ($VARS = {}, $RETURN_NODE) {
  
  const $TREE = $J$3.root((() => {
    const $OUT = [];
    $OUT.push($J$3.call({
      name: "styles",
      value: $J$3.expr([]),
      ref: () => $DEFAULT$1,
    })
);
    return $OUT
  })(),[1,1,0,3,18,64]);
  if ($RETURN_NODE) {
    return $TREE
  }
  return renderCss($TREE, $CONTEXT$3)
}

export default $DEFAULT$2;
