import { root } from '..'
import { Context } from '../../context'

let context: Context

describe('Root', () => {
  beforeEach(() => {
    context = new Context()
    context.id = 'testing'
  })
  // it('should serialize to a module', () => {
  //   let node = root([])
  //   node.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     'import * as $J from \'jess\'\nconst $CONTEXT = new $J.Context({})\n$CONTEXT.id = \'testing\'\nfunction $DEFAULT ($VARS = {}, $RETURN_NODE) {\n  const $TREE = $J.root((() => {\n    const $OUT = []\n    return $OUT\n  })(),[])\n  if ($RETURN_NODE) {\n    return $TREE\n  }\n  return {\n    ...$J.renderCss($TREE, $CONTEXT)\n  }\n}\nconst $DEFAULT_PROXY = $J.proxy($DEFAULT, $CONTEXT)\n$DEFAULT_PROXY(undefined, true)\nexport default $DEFAULT_PROXY'
  //   )
  // })
})