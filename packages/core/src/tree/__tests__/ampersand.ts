import { root, amp, rule, sel, el, spaced, any, list, ruleset, decl, type Element, type Combinator, type Ampersand } from '..'
import { Context } from '../../context'
// import { OutputCollector } from '../../output'

let context: Context
// let out: OutputCollector
describe('Ampersand', () => {
  beforeEach(() => {
    context = new Context()
    // out = new OutputCollector()
  })

  const wrapAmp = (selectors: Array<Element | Combinator | Ampersand>) => root([
    rule({
      selector: list([sel([el('.one')]), sel([el('.two')])]),
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

  it('should output valid CSS Nesting as-is', async () => {
  /** We need a root node to bubble rules */
    const node = wrapAmp([amp()])
    const evald = await node.eval(context)
    expect(`${evald}`).toBe('.one, .two {\n  chungus: foo bar;\n  & {\n    inner: one two;\n  }\n}\n')
  })

  it('should collapse selectors when in collapsing mode', async () => {
    /** We need a root node to bubble rules */
    const node = wrapAmp([amp()])
    context = new Context({ collapseNesting: true })
    const evald = await node.eval(context)
    expect(`${evald}`).toBe('.one, .two {\n  chungus: foo bar;\n}\n.one, .two {\n  inner: one two;\n}\n')
  })

  it('should combine selectors when collapsing', async () => {
    /** We need a root node to bubble rules */
    const node = wrapAmp([amp(), any('-1')])
    context = new Context({ collapseNesting: true })
    const evald = await node.eval(context)
    expect(`${evald}`).toBe('.one, .two {\n  chungus: foo bar;\n}\n.one-1, .two-1 {\n  inner: one two;\n}\n')
  })

  it('should collapse selectors when ampersand is set to hoist', async () => {
    /** We need a root node to bubble rules */
    const node = wrapAmp([amp(undefined, 0, { hoistToRoot: true })])
    const evald = await node.eval(context)
    expect(`${evald}`).toBe('.one, .two {\n  chungus: foo bar;\n}\n.one, .two {\n  inner: one two;\n}\n')
  })

  it.only('should collapse selectors when ampersand has an inner value', async () => {
    /** We need a root node to bubble rules */
    const node = wrapAmp([amp(any('-1'))])
    const evald = await node.eval(context)
    expect(`${evald}`).toBe('.one, .two {\n  chungus: foo bar;\n}\n.one, .two {\n  inner: one two;\n}\n')
  })

  // it.skip('should serialize to a module', () => {
  //   const node = expr([amp()])
  //   node.toModule(context, out)
  //   expect(out.toString()).toBe('$J.expr([$J.amp()])')
  // })
})