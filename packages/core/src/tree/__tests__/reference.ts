import { ref, ruleset, decl, vardecl, spaced, any } from '..'
import { Context } from '../../context'

let context: Context

describe('reference', () => {
  beforeEach(() => {
    context = new Context()
  })
  describe('serialization', () => {
    it('should serialize a variable reference', () => {
      let node = ref('foo', { type: 'variable' })
      expect(`${node}`).toBe('$foo')
    })

    it('should serialize a property reference', () => {
      let node = ref('foo', { type: 'property' })
      expect(`${node}`).toBe('$.foo')
    })

    it('should serialize a mixin reference', () => {
      let node = ref('foo', { type: 'mixin' })
      expect(`${node}`).toBe('foo')
    })
  })

  describe('get from scope', () => {
    it('should get a variable from scope', async () => {
      let node = ruleset([
        vardecl([
          ['name', 'foo'],
          ['value', any('red')]
        ]),
        decl([
          ['name', 'bar'],
          ['value', ref('foo', { type: 'variable' })]
        ])
      ])
      let evald = await node.eval(context)
      /** The var declaration will be removed when going to CSS */
      expect(`${evald}`).toBeString(`
        @let foo: red;
        bar: red;
      `)
    })

    it('should get a property from scope', async () => {
      let node = ruleset([
        decl([
          ['name', 'foo'],
          ['value', any('red')]
        ]),
        decl([
          ['name', 'bar'],
          ['value', ref('foo', { type: 'property' })]
        ])
      ])
      let evald = await node.eval(context)
      expect(`${evald}`).toBeString(`
        foo: red;
        bar: red;
      `)
    })

    it('should get a hoisted var from scope', async () => {
      context.opts.hoistDeclarations = true
      let node = ruleset([
        decl([
          ['name', 'bar'],
          ['value', ref('foo', { type: 'variable' })]
        ]),
        vardecl([
          ['name', 'foo'],
          ['value', any('red')]
        ])
      ])
      let evald = await node.eval(context)
      /** The var declaration will be removed when going to CSS */
      expect(`${evald}`).toBeString(`
        bar: red;
        @let foo: red;
      `)
    })

    it('should get a hoisted prop from scope', async () => {
      context.opts.hoistDeclarations = true
      let node = ruleset([
        decl([
          ['name', 'bar'],
          ['value', ref('foo', { type: 'property' })]
        ]),
        decl([
          ['name', 'foo'],
          ['value', any('red')]
        ])
      ])
      let evald = await node.eval(context)
      expect(`${evald}`).toBeString(`
        bar: red;
        foo: red;
      `)
    })

    it('should allow recursive referencing', async () => {
      let node = ruleset([
        vardecl([
          ['name', 'foo'],
          ['value', any('red')]
        ]),
        vardecl([
          ['name', 'foo'],
          ['value', spaced([ref('foo', { type: 'variable' }), any('red')])]
        ]),
        decl([
          ['name', 'bar'],
          ['value', ref('foo', { type: 'variable' })]
        ])
      ])
      let evald = await node.eval(context)
      expect(`${evald}`).toBeString(`
        @let foo: red;
        @let foo: $foo red;
        bar: red red;
      `)
    })
  })

  describe('errors', () => {
    it('should throw if the variable is not defined', async () => {
      let node = ruleset([
        decl([
          ['name', 'bar'],
          ['value', ref('foo', { type: 'variable' })]
        ]),
        vardecl([
          ['name', 'foo'],
          ['value', any('red')]
        ])
      ])
      await expect(async () => await node.eval(context)).rejects.toThrow()
    })
  })
})