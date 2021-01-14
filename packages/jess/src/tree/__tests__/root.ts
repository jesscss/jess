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
    out = new OutputCollector
  })
  it('should serialize to a module', () => {
    const node = root([])
    node.toModule(context, out)
    expect(out.toString()).to.eq('import * as _JESS from \'jess\'\nconst _J = _JESS.tree\nconst __CONTEXT = new _JESS.Context\nexport default (__VARS = {}, __RETURN_NODE) => {\n  const { module, ...rest } = __VARS\n  const __TREE = _J.root((() => {\n    const __OUT = []\n    return __OUT\n  })()\n  if (__RETURN_NODE) {\n    return __TREE\n  }\n  return _JESS.render(__TREE, __CONTEXT)\n}')
  })
})