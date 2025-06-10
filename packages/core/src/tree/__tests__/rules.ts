import {
  root,
  ruleset,
  sel,
  el,
  sellist,
  rules,
  decl,
  vardecl,
  spaced,
  any,
  call,
  ref,
  type FindContext,
  type Node,
  type Rules,
  AssignmentType,
  VarDeclaration
} from '..'
import { Context, TreeContext } from '../../context'

let context: Context

function getPropWithContext(context: Context, n: Rules, key: string, opts: FindContext = {}, start?: number) {
  context.rulesContext = n
  return n.findDeclaration(key, 'Declaration', opts, true, start)
}

function getVarWithContext(context: Context, n: Rules, key: string, opts: FindContext = {}, start?: number) {
  context.rulesContext = n
  let decl = n.findDeclaration(key, 'VarDeclaration', opts, true, start)
  return decl
}

describe('Rules', () => {
  let getProp = getPropWithContext.bind(context, context)
  let getVar = getVarWithContext.bind(context, context)
  beforeEach(() => {
    context = new Context()
    getProp = getPropWithContext.bind(context, context)
    getVar = getVarWithContext.bind(context, context)
    context.id = 'testing'
  })

  it('assigns position linearly for nested rules', async () => {
    let node = rules([
      vardecl({ name: 'one', value: any('one') }),
      vardecl({ name: 'root', value: any('value') }),
      rules([
        vardecl({ name: 'foo', value: any('bar') }),
        vardecl({ name: 'one', value: any('two') }),
        rules([
          vardecl({ name: 'one', value: any('three') })
        ])
      ])
    ])
    node = await node.eval(context) as Rules
    expect(node.index).toBe(0)
    expect(node.at(0)?.index).toBe(1)
    expect(node.at(1)?.index).toBe(2)
    expect(node.at(2)?.index).toBe(3)
    expect((node.at(2) as Rules).at(0)?.index).toBe(4)
    expect((node.at(2) as Rules).at(1)?.index).toBe(5)
    expect((node.at(2) as Rules).at(2)?.index).toBe(6)
    expect(((node.at(2) as Rules).at(2) as Rules).at(0)?.index).toBe(7)
  })

  describe('Scope / lookups', () => {
    describe('set / get', () => {
      it('can do a normal get / set of properties', async () => {
        let node = rules([
          decl({ name: 'foo', value: any('bar') })
        ])
        node = await node.eval(context) as Rules

        expect(`${getProp(node, 'foo')}`).toBe('foo: bar')
      })

      it('can do a normal get / set of variables', async () => {
        let node = rules([
          vardecl({ name: 'foo', value: any('bar') })
        ])
        node = await node.eval(context) as Rules
        expect(`${getVar(node, 'foo')}`).toBe('$foo: bar')
      })

      it('replaces variable values', async () => {
        let node = rules([
          vardecl({ name: 'foo', value: any('one') }),
          vardecl({ name: 'foo', value: any('two') })
        ])
        node = await node.eval(context) as Rules
        expect(`${getVar(node, 'foo')}`).toBe('$foo: two')
      })

      it('will not set if defined', async () => {
        let decl1 = vardecl({ name: 'first', value: any('one') }, { assign: AssignmentType.CondAssign })
        let decl2 = vardecl({ name: 'first', value: any('two') }, { assign: AssignmentType.CondAssign })
        let node = rules([
          decl1,
          decl2
        ])
        node = await node.eval(context) as Rules
        /** This won't have been resolved, so we need to evaluate it. */
        let result = await getVar(node, 'first')!.eval(context)

        expect(`${result}`).toBe('$first: one')
      })

      // it('will skip normalization', () => {
      //   scope.setVar('one', 'one', { isNormalized: true, protected: true })
      //   expect(scope.getVar('one')).toEqual('one')
      // })

      it('throws if undefined', async () => {
        let node = rules([
          decl({ name: 'foo', value: ref('first', { type: 'variable' }) })
        ])
        await expect(node.eval(context)).rejects.toThrowError()
      })

      it('doesn\'t throw error if there\'s a fallback', async () => {
        let node = rules([
          decl({ name: 'foo', value: ref('first', { type: 'variable', fallbackValue: true }) })
        ])
        await expect(node.eval(context)).resolves.not.toThrow()
      })
    })

    describe('scope inheritance', () => {
      it('looks up parent scope', async () => {
        let inherited = rules([])
        let node = rules([
          vardecl({ name: 'foo', value: any('bar') }),
          inherited
        ])

        node = await node.eval(context) as Rules
        expect(`${getVar(inherited, 'foo')}`).toBe('$foo: bar')
      })

      it('inherits values when set after', async () => {
        let inherited = rules([])
        let node = rules([
          inherited
        ])
        node.push(vardecl({ name: 'foo', value: any('bar') }))

        node = await node.eval(context) as Rules
        expect(`${getVar(inherited, 'foo')}`).toBe('$foo: bar')
      })

      it('peeks into optional child scope', async () => {
        let node = rules([
          rules([
            vardecl({ name: 'one', value: any('two') })
          ], {
            rulesVisibility: {
              VarDeclaration: 'optional'
            }
          })
        ])

        node = await node.eval(context) as Rules
        expect(`${getVar(node, 'one')}`).toBe('$one: two')
      })

      it('fails to get private child scope', async () => {
        let node = rules([
          rules([
            vardecl({ name: 'one', value: any('two') })
          ])
        ])

        node = await node.eval(context) as Rules
        expect(getVar(node, 'one')).toBeUndefined()
      })

      it('skips an optional value', async () => {
        let node = rules([
          vardecl({ name: 'one', value: any('one') }),
          rules([
            vardecl({ name: 'one', value: any('two') })
          ], {
            rulesVisibility: {
              VarDeclaration: 'optional'
            }
          })
        ])

        node = await node.eval(context) as Rules
        expect(`${getVar(node, 'one')}`).toBe('$one: one')
      })

      it('shadows variables #1', async () => {
        let node = rules([
          vardecl({ name: 'one', value: any('one') }),
          rules([
            vardecl({ name: 'one', value: any('three') })
          ])
        ])

        node = await node.eval(context) as Rules
        let inherited = node.at(1) as Rules
        expect(`${getVar(inherited, 'one')}`).toBe('$one: three')
      })

      it('shadows variables #2', async () => {
        let node = rules([
          vardecl({ name: 'one', value: any('one') }),
          rules([
            vardecl({ name: 'one', value: any('two') }),
            vardecl({ name: 'one', value: any('three') })
          ])
        ])

        node = await node.eval(context) as Rules
        let inherited = node.at(1) as Rules
        expect(`${getVar(inherited, 'one')}`).toBe('$one: three')
      })

      it('sets existing variables', async () => {
        let node = rules([
          vardecl({ name: 'one', value: any('one') }),
          rules([
            vardecl({ name: 'one', value: any('three') }, { setDefined: true })
          ])
        ])

        node = await node.eval(context) as Rules
        let inherited = node.at(1) as Rules
        expect(`${getVar(node, 'one')}`).toBe('$one: three')
        expect(`${getVar(inherited, 'one')}`).toBe('$$one: three')
      })

      it('fails to set if existing variable is readonly', async () => {
        let node = rules([
          vardecl({ name: 'one', value: any('one') }, { readonly: true }),
          rules([
            vardecl({ name: 'one', value: any('three') }, { setDefined: true })
          ])
        ])

        await expect(node.eval(context)).rejects.toThrowError('"one" is readonly')
      })

      it('fails to set if existing variable is in readonly rules', async () => {
        let node = rules([
          rules([
            vardecl({ name: 'one', value: any('one') })
          ], {
            readonly: true,
            rulesVisibility: { VarDeclaration: 'public' }
          }),
          rules([
            vardecl({ name: 'one', value: any('three') }, { setDefined: true })
          ])
        ])

        await expect(node.eval(context)).rejects.toThrowError('"one" is readonly')
      })

      it('fails to set if existing variable is in nested readonly rules #1', async () => {
        let node = rules([
          rules([
            rules([
              vardecl({ name: 'one', value: any('one') })
            ], {
              readonly: true,
              rulesVisibility: { VarDeclaration: 'public' }
            })
          ], {
            rulesVisibility: { VarDeclaration: 'public' }
          }),
          rules([
            vardecl({ name: 'one', value: any('three') }, { setDefined: true })
          ])
        ])

        await expect(node.eval(context)).rejects.toThrowError('"one" is readonly')
      })

      it('fails to set if existing variable is in nested readonly rules #2', async () => {
        let node = rules([
          rules([
            rules([
              vardecl({ name: 'one', value: any('one') })
            ], {
              rulesVisibility: { VarDeclaration: 'public' }
            })
          ], {
            readonly: true,
            rulesVisibility: { VarDeclaration: 'public' }
          }),
          rules([
            vardecl({ name: 'one', value: any('three') }, { setDefined: true })
          ])
        ])

        await expect(node.eval(context)).rejects.toThrowError('"one" is readonly')
      })

      it('doesn\'t preserve readonly later', async () => {
        let node = rules([
          rules([
            vardecl({ name: 'one', value: any('one') })
          ], {
            readonly: true,
            rulesVisibility: { VarDeclaration: 'public' }
          }),
          rules([
            vardecl({ name: 'one', value: any('two') })
          ], {
            rulesVisibility: { VarDeclaration: 'public' }
          }),
          rules([
            /** This will set the second rules value */
            vardecl({ name: 'one', value: any('three') }, { setDefined: true })
          ])
        ])

        await expect(node.eval(context)).resolves.not.toThrow()
      })

      it('looks upwards from position', async () => {
        let node = rules([
          vardecl({ name: 'one', value: any('one') }),
          vardecl({ name: 'one', value: any('two') }),
          vardecl({ name: 'one', value: any('three') })
        ])
        node = await node.eval(context) as Rules

        expect(`${getVar(node, 'one', {}, node.at(1)?.index)}`).toBe('$one: one')
        expect(`${getVar(node, 'one', {}, node.at(2)?.index)}`).toBe('$one: two')
        expect(`${getVar(node, 'one', {}, 10)}`).toBe('$one: three')
      })

      it('sets upwards from position', async () => {
        let node = rules([
          vardecl({ name: 'one', value: any('one') }),
          vardecl({ name: 'one', value: any('two') }, { setDefined: true }),
          vardecl({ name: 'one', value: any('three') })
        ])
        node = await node.eval(context) as Rules

        expect(`${getVar(node, 'one', {}, node.at(1)?.index)}`).toBe('$one: two')
        expect(`${getVar(node, 'one', {}, node.at(2)?.index)}`).toBe('$$one: two')
        expect(`${getVar(node, 'one', {}, 10)}`).toBe('$one: three')
      })

      it('won\'t find variables in sub-rules of local rules', async () => {
        let node = rules([ // root.jess
          rules([ // @use 'child1.jess'
            vardecl({ name: 'foo', value: any('bar') }),
            rules([ // @use 'child2.jess'
              vardecl({ name: 'one', value: any('two') })
            ], {
              local: true,
              rulesVisibility: { VarDeclaration: 'public' }
            })
          ], {
            local: true,
            rulesVisibility: { VarDeclaration: 'public' }
          })
        ])
        node = await node.eval(context) as Rules

        // child1.jess should see child2.jess's vars because it owns the `@use`
        expect(`${getVar(node.at(0) as Rules, 'one')}`).toBe('$one: two')
        // child1.jess can still see its own vars
        expect(`${getVar(node.at(0) as Rules, 'foo')}`).toBe('$foo: bar')
        // root.jess can see child1.jess's vars but not child2.jess's
        expect(`${getVar(node, 'foo')}`).toBe('$foo: bar')
        expect(getVar(node, 'one')).toBeUndefined()
      })
    })
  })

  it('should flatten rules when serializing', async () => {
    let node = rules([
      ruleset({
        selector: sellist([sel([el('.collapse')])]),
        rules: rules([
          decl({ name: 'chungus', value: spaced([any('foo'), any('bar')]) }),
          rules([
            decl({ name: 'bird', value: spaced([any('in'), any('hand')]) })
          ])
        ])
      })
    ])
    let evald = await node.eval(context)
    expect(`${evald}`).toBe('.collapse {\n  chungus: foo bar;\n  bird: in hand;\n}\n')
  })
})