import { root, amp, rule, sel, el, spaced, any, list, ruleset, decl, type Element, type Combinator, type Ampersand, type Selector } from '..'
import { Context } from '../../context'
// import { OutputCollector } from '../../output'

let context: Context
// let out: OutputCollector
describe('Ampersand', () => {
  beforeEach(() => {
    context = new Context()
    // out = new OutputCollector()
  })

  /** We need a root node to bubble rules */
  let wrapAmp = (selectors: Array<Element | Combinator | Ampersand>) => root([
    rule({
      selector: sel([el('.one'), el('.two')]),
      value: ruleset([
        decl({ name: 'chungus', value: spaced([any('foo'), any('bar')]) }),
        rule({
          selector: sel(selectors),
          value: ruleset([
            decl({ name: 'inner', value: spaced([any('one'), any('two')]) })
          ])
        })
      ])
    })
  ])

  let wrapAmpList = (selectors: Selector[]) => root([
    rule({
      selector: list([sel([el('.one')]), sel([el('.two')])]),
      value: ruleset([
        decl({ name: 'chungus', value: spaced([any('foo'), any('bar')]) }),
        rule({
          selector: list(selectors),
          value: ruleset([
            decl({ name: 'inner', value: spaced([any('one'), any('two')]) })
          ])
        })
      ])
    })
  ])

  it('should output valid CSS Nesting as-is', async () => {
  /** We need a root node to bubble rules */
    let node = wrapAmp([amp()])
    let evald = await node.eval(context)
    expect(`${evald}`).toBe('.one.two {\n  chungus: foo bar;\n  & {\n    inner: one two;\n  }\n}\n')
    node = wrapAmpList([sel([amp()])])
    evald = await node.eval(context)
    expect(`${evald}`).toBe('.one, .two {\n  chungus: foo bar;\n  & {\n    inner: one two;\n  }\n}\n')
  })

  it('should collapse selectors when in collapsing mode', async () => {
    /** We need a root node to bubble rules */
    let node = wrapAmp([amp()])
    context = new Context({ collapseNesting: true })
    let evald = await node.eval(context)
    expect(`${evald}`).toBe('.one.two {\n  chungus: foo bar;\n}\n.one.two {\n  inner: one two;\n}\n')
    node = wrapAmpList([sel([amp()])])
    evald = await node.eval(context)
    expect(`${evald}`).toBe('.one, .two {\n  chungus: foo bar;\n}\n.one, .two {\n  inner: one two;\n}\n')
  })

  it('should combine selectors when collapsing', async () => {
    let node = wrapAmp([amp(), any('-1')])
    context = new Context({ collapseNesting: true })
    let evald = await node.eval(context)
    expect(`${evald}`).toBe('.one.two {\n  chungus: foo bar;\n}\n.one.two-1 {\n  inner: one two;\n}\n')
    node = wrapAmpList([sel([amp(), any('-1')])])
    evald = await node.eval(context)
    expect(`${evald}`).toBe('.one, .two {\n  chungus: foo bar;\n}\n.one-1, .two-1 {\n  inner: one two;\n}\n')
  })

  it('should collapse selectors when ampersand is set to hoist', async () => {
    let node = wrapAmp([amp(undefined, 0, { hoistToRoot: true })])
    let evald = await node.eval(context)
    expect(`${evald}`).toBe('.one.two {\n  chungus: foo bar;\n}\n.one.two {\n  inner: one two;\n}\n')
    node = wrapAmpList([sel([amp(undefined, 0, { hoistToRoot: true })])])
    evald = await node.eval(context)
    expect(`${evald}`).toBe('.one, .two {\n  chungus: foo bar;\n}\n.one, .two {\n  inner: one two;\n}\n')
  })

  it('should collapse selectors when ampersand has an inner value', async () => {
    let node = wrapAmp([amp('-1')])
    let evald = await node.eval(context)
    expect(`${evald}`).toBe('.one.two {\n  chungus: foo bar;\n}\n.one.two-1 {\n  inner: one two;\n}\n')
    node = wrapAmpList([sel([amp('-1')])])
    evald = await node.eval(context)
    expect(`${evald}`).toBe('.one, .two {\n  chungus: foo bar;\n}\n.one-1, .two-1 {\n  inner: one two;\n}\n')
  })

  it('should wrap inner lists in :is()', async () => {
    let node = wrapAmpList([sel([amp()]), sel([el('.three')])])
    context = new Context({ collapseNesting: true })
    let evald = await node.eval(context)
    expect(`${evald}`).toBe('.one, .two {\n  chungus: foo bar;\n}\n:is(.one, .two) .three {\n  inner: one two;\n}\n')
  })

  // it.skip('should serialize to a module', () => {
  //   const node = expr([amp()])
  //   node.toModule(context, out)
  //   expect(out.toString()).toBe('$J.expr([$J.amp()])')
  // })
})