import { expect } from 'chai'
import 'mocha'
import { root } from '..'
import { Context } from '../../context'
import { OutputCollector } from '../../output'

let context: Context
let out: OutputCollector

describe('Root', () => {
  beforeEach(() => {
    context = new Context
    context.id = 'testing'
    out = new OutputCollector
  })
  it('should serialize to a module', () => {
    const node = root([])
    node.toModule(context, out)
    expect(out.toString()).to.eq('import * as $JESS from \'jess\'\nconst $J = $JESS.tree\nconst $CONTEXT = new $JESS.Context\n$CONTEXT.id = \'testing\'\nfunction $DEFAULT ($VARS = {}, $RETURN_NODE) {\n  const $TREE = $J.root((() => {\n    const $OUT = []\n    return $OUT\n  })(),[])\n  if ($RETURN_NODE) {\n    return $TREE\n  }\n  return $JESS.render($TREE, $CONTEXT)\n}\nexport default $DEFAULT')
  })
})