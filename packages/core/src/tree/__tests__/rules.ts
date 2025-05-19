import {
  root,
  ruleset,
  sel,
  el,
  list,
  rules,
  decl,
  vardecl,
  spaced,
  any,
  call,
  ref,
  type GetterOptions,
  type Node,
  type Rules,
  AssignmentType
} from '..'
import { Context } from '../../context'

let context: Context

async function getPropWithContext(context: Context, n: Rules, key: string, opts: GetterOptions = {}, start?: number) {
  context.rulesContext = n
  return n.getDeclaration('Declaration', key, opts, start)
}

async function getVarWithContext(context: Context, n: Rules, key: string, opts: GetterOptions = {}, start?: number) {
  context.rulesContext = n
  let decl = n.getDeclaration('VarDeclaration', key, opts, start)
  if (decl) {
    let evald = await decl.value.value.eval(context)
    decl.data.set('value', evald)
  }
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

        expect(`${await getProp(node, 'foo')}`).toBe('foo: bar')
      })

      it('can do a normal get / set of variables', async () => {
        let node = rules([
          vardecl({ name: 'foo', value: any('bar') })
        ])
        node = await node.eval(context) as Rules
        expect(`${await getVar(node, 'foo')}`).toBe('$foo: bar')
      })

      it('replaces variable values', async () => {
        let node = rules([
          vardecl({ name: 'foo', value: any('one') }),
          vardecl({ name: 'foo', value: any('two') })
        ])
        node = await node.eval(context) as Rules
        expect(`${await getVar(node, 'foo')}`).toBe('$foo: two')
      })

      it('will not set if defined', async () => {
        let decl1 = vardecl({ name: 'first', value: any('one') }, { assign: AssignmentType.CondAssign })
        let decl2 = vardecl({ name: 'first', value: any('two') }, { assign: AssignmentType.CondAssign })
        let node = rules([
          decl1,
          decl2
        ])
        node = await node.eval(context) as Rules
        expect(`${await getVar(node, 'first')}`).toBe('$first: one')
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
        expect(`${await getVar(inherited, 'foo')}`).toBe('$foo: bar')
      })

      it('inherits values when set after', async () => {
        let inherited = rules([])
        let node = rules([
          inherited
        ])
        node.push(vardecl({ name: 'foo', value: any('bar') }))

        node = await node.eval(context) as Rules
        expect(`${await getVar(inherited, 'foo')}`).toBe('$foo: bar')
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
        expect(`${await getVar(inherited, 'one')}`).toBe('$one: three')
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
        expect(`${await getVar(inherited, 'one')}`).toBe('$one: three')
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
        expect(`${await getVar(node, 'one')}`).toBe('$one: three')
        expect(`${await getVar(inherited, 'one')}`).toBe('$one: three')
      })

      it('fails to set if existing variable is readonly', async () => {
        let node = rules([
          vardecl({ name: 'one', value: any('one') }, { readonly: true }),
          rules([
            vardecl({ name: 'one', value: any('three') }, { setDefined: true })
          ])
        ])

        await expect(node.eval(context)).rejects.toThrowError()
      })

      it('looks upwards from position', async () => {
        let node = rules([
          vardecl({ name: 'one', value: any('one') }),
          vardecl({ name: 'one', value: any('two') }),
          vardecl({ name: 'one', value: any('three') })
        ])
        node = await node.eval(context) as Rules

        expect(`${await getVar(node, 'one', {}, 1)}`).toBe('$one: one')
        expect(`${await getVar(node, 'one', {}, 2)}`).toBe('$one: two')
        expect(`${await getVar(node, 'one', {}, 3)}`).toBe('$one: three')
      })

      it('sets upwards from position', async () => {
        let node = rules([
          vardecl({ name: 'one', value: any('one') }),
          vardecl({ name: 'one', value: any('two') }, { setDefined: true }),
          vardecl({ name: 'one', value: any('three') })
        ])
        node = await node.eval(context) as Rules

        expect(`${await getVar(node, 'one', {}, 1)}`).toBe('$one: two')
        expect(`${await getVar(node, 'one', {}, 2)}`).toBe('$$one: two')
        expect(`${await getVar(node, 'one', {}, 3)}`).toBe('$one: three')
      })
    })
  })

  // it('should merge rulesets into rules', async () => {
  //   /** We need a root node to bubble rules */
  //   let node = root([
  //     ruleset({
  //       selector: list([sel([el('.collapse')])]),
  //       rules: rules([
  //         decl({ name: 'chungus', value: spaced([any('foo'), any('bar')]) }),
  //         rules([
  //           decl({ name: 'bird', value: spaced([any('in'), any('hand')]) })
  //         ])
  //       ])
  //     })
  //   ])
  //   let evald = await node.eval(context)
  //   expect(`${evald}`).toBe('.collapse {\n  chungus: foo bar;\n  bird: in hand;\n}\n')
  // })

  // it('should output var() values', () => {
  //   context.opts.dynamic = true
  //   let node = rules([
  //     decl({ name: 'a', value: spaced([js('obj.value'), call({ name: 'func', value: js('foo.bar') })]) })
  //   ])
  //   node.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.rules(\n  (() => {\n    const $OUT = []\n    $OUT.push($J.decl({\n      name: $J.any("a"),\n      value: $J.spaced([$J.call({\n        name: "var",\n        value: $J.list([\n          "--vtesting-0",\n          obj.value\n        ]),\n      }), $J.call({\n        name: "var",\n        value: $J.list([\n          "--vtesting-1",\n          $J.call({\n            name: "func",\n            value: foo.bar,\n            ref: () => func,\n          })\n        ]),\n      })])\n    }))\n    return $OUT\n  })()\n)'
  //   )
  // })

  // it('should output --var declarations', () => {
  //   context.opts.dynamic = true
  //   let node = rules([
  //     decl({ name: 'a', value: spaced([js('obj.value'), call({ name: 'func', value: js('foo.bar') })]) })
  //   ])
  //   context.isRuntime = true
  //   node.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.rules(\n  (() => {\n    const $OUT = []\n    $OUT.push($J.decl({\n      name: $J.any("--vtesting-0"),\n      value: obj.value\n    }))\n$OUT.push($J.decl({\n      name: $J.any("--vtesting-1"),\n      value: $J.call({\n        name: "func",\n        value: foo.bar,\n        ref: () => func,\n      })\n    }))\n    return $OUT\n  })()\n)'
  //   )
  // })
})