import { look, ref } from '..'

describe('Lookup', () => {
  describe('serialization', () => {
    it('should serialize a property lookup', () => {
      let node = look({
        value: ref('foo', 0, { type: 'variable' }),
        key: 'bar'
      })
      expect(`${node}`).toBe('$foo.bar')
    })

    it('should serialize a variable lookup', () => {
      let node = look({
        value: ref('foo', 0, { type: 'variable' }),
        key: '$bar'
      })
      expect(`${node}`).toBe('$foo.$bar')
    })

    it('should serialize a mixin lookup', () => {
      let node = look({
        value: ref('foo', 0, { type: 'variable' }),
        key: 'bar'
      }, 0, { mixin: true })
      expect(`${node}`).toBe('$foo -> bar')
    })
  })

  describe('dynamic serialization', () => {
    /** This is looking up a property but the key is dynamic (a variable) */
    it('should serialize a dynamic lookup', () => {
      let node = look({
        value: ref('foo', 0, { type: 'variable' }),
        key: ref('bar', 0, { type: 'variable' })
      })
      expect(`${node}`).toBe('$foo[$bar]')
    })

    /**
     * This is looking up a property but the key is dynamic
     * based on a property name declaration.
     *
     * Not necessarily useful, but possible!
     */
    it('should serialize a dynamic prop lookup', () => {
      let node = look({
        value: ref('foo', 0, { type: 'variable' }),
        key: ref('bar', 0, { type: 'property' })
      })
      expect(`${node}`).toBe('$foo[$.bar]')
    })

    /** This is looking up a mixin but the key is dynamic (a variable) */
    it('should serialize a dynamic mixin lookup', () => {
      let node = look({
        value: ref('foo', 0, { type: 'variable' }),
        key: ref('bar', 0, { type: 'variable' })
      }, 0, { mixin: true })
      expect(`${node}`).toBe('$foo -> [$bar]')
    })
  })
})