import {
  root, amp, rule, sel, el, spaced, any, sellist, ruleset, decl, attr,
  type SimpleSelector, type Combinator, type SelectorSequence
} from '..'
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
  let wrapAmp = (selectors: Array<SimpleSelector | Combinator>) => root([
    rule({
      selector: sellist([[el('.one'), el('.two')]]),
      value: ruleset([
        decl({ name: 'chungus', value: spaced([el('foo'), el('bar')]) }),
        rule({
          selector: sel(selectors),
          value: ruleset([
            decl({ name: 'inner', value: spaced([el('one'), el('two')]) })
          ])
        })
      ])
    })
  ])

  let wrapAmpList = (selectors: SelectorSequence[]) => root([
    rule({
      selector: sellist([sel([el('.one')]), sel([el('.two')])]),
      value: ruleset([
        decl({ name: 'chungus', value: spaced([any('foo'), any('bar')]) }),
        rule({
          selector: sellist(selectors),
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
    console.log(`${evald}`.charCodeAt(0))
    expect(`${evald}`).toBeString(`
      .one.two {
        chungus: foo bar;
        & {
          inner: one two;
        }
      }
    `)
    node = wrapAmpList([sel([amp()])])
    evald = await node.eval(context)
    expect(`${evald}`).toBeString(`
      .one, .two {
        chungus: foo bar;
        & {
          inner: one two;
        }
      }`
    )
  })

  it('should collapse selectors when in collapsing mode', async () => {
    /** We need a root node to bubble rules */
    let node = wrapAmp([amp()])
    context = new Context({ collapseNesting: true })
    let evald = await node.eval(context)
    expect(`${evald}`).toBeString(`
      .one.two {
        chungus: foo bar;
      }
      .one.two {
        inner: one two;
      }`
    )
    node = wrapAmpList([sel([amp()])])
    evald = await node.eval(context)
    expect(`${evald}`).toBeString(`
      .one, .two {
        chungus: foo bar;
      }
      .one, .two {
        inner: one two;
      }`
    )
  })

  it('should order selectors when collapsing', async () => {
    let node = wrapAmp([amp(), el('h2')])
    context = new Context({ collapseNesting: true })
    let evald = await node.eval(context)
    expect(`${evald}`).toBeString(`
      .one.two {
        chungus: foo bar;
      }
      h2.one.two {
        inner: one two;
      }`
    )
  })

  it('should collapse selectors when ampersand is set to hoist', async () => {
    let node = wrapAmp([amp(undefined, 0, { hoistToRoot: true })])
    let evald = await node.eval(context)
    expect(`${evald}`).toBeString(`
      .one.two {
        chungus: foo bar;
      }
      .one.two {
        inner: one two;
      }`
    )
    node = wrapAmpList([sel([amp(undefined, 0, { hoistToRoot: true })])])
    evald = await node.eval(context)
    expect(`${evald}`).toBeString(`
      .one, .two {
        chungus: foo bar;
      }
      .one, .two {
        inner: one two;
      }`
    )
  })

  it('should collapse selectors when ampersand has an appended value', async () => {
    let node = wrapAmp([amp('-1')])
    let evald = await node.eval(context)
    expect(`${evald}`).toBeString(`
      .one.two {
        chungus: foo bar;
      }
      .one.two-1 {
        inner: one two;
      }`
    )
    node = wrapAmpList([sel([amp('-1')])])
    evald = await node.eval(context)
    expect(`${evald}`).toBeString(`
      .one, .two {
        chungus: foo bar;
      }
      .one-1, .two-1 {
        inner: one two;
      }`
    )
  })

  it('should wrap inner lists in :is()', async () => {
    let node = wrapAmpList([sel([amp()]), sel([el('.three')])])
    context = new Context({ collapseNesting: true })
    let evald = await node.eval(context)
    expect(`${evald}`).toBeString(`
      .one, .two {
        chungus: foo bar;
      }
      .one, .two, :is(.one, .two) .three {
        inner: one two;
      }`
    )
    node = wrapAmpList([sel([amp(), el('.three')])])
    evald = await node.eval(context)
    expect(`${evald}`).toBeString(`
      .one, .two {
        chungus: foo bar;
      }
      :is(.one, .two).three {
        inner: one two;
      }`
    )
  })

  it('should throw if the parent selector is not basic', async () => {
    let node = root([
      rule({
        selector: sel([
          // @ts-expect-error - fix type
          attr({
            key: 'data-prop',
            op: '=',
            value: any('foo')
          })
        ]),
        value: ruleset([
          decl({ name: 'chungus', value: spaced([el('foo'), el('bar')]) }),
          rule({
            selector: sel([amp('-1')]),
            value: ruleset([
              decl({ name: 'inner', value: spaced([el('one'), el('two')]) })
            ])
          })
        ])
      })
    ])
    await expect(async () => await node.eval(context)).rejects.toThrow('Cannot append "-1" to this type of selector')
  })
})