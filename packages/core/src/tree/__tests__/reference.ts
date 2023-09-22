import { ref, ruleset, decl, vardecl, rule, any } from '..'
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
      /** The var declaration will be removed when going to CSS */
      expect(`${evald}`).toBeString(`
        @let foo: red;
        bar: red;
      `)
    })

    it('should get a hoisted var from scope', async () => {
      context.opts.hoistVariables = true
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

    it('should allow recursive referencing', async () => {

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