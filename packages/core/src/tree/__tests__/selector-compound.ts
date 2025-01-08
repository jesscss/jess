import { compound, el, pseudo, type SimpleSelector } from '..'

/**
 * @todo - add tests for list bubbling
 */
describe('Compound Selector', () => {
  describe('normalization', () => {
    test('same value (sorted)', () => {
      let sel1 = compound([
        el('a'),
        el('#id'),
        el('.class')
      ]).valueOf()
      let sel2 = compound([
        el('a'),
        el('#id'),
        el('.class')
      ]).valueOf()
      expect(sel1).toEqual(sel2)
    })

    test('same value (unsorted)', () => {
      let sel1 = compound([
        el('a'),
        el('#id'),
        el('.class')
      ]).valueOf()
      let sel2 = compound([
        el('a'),
        el('.class'),
        el('#id')
      ]).valueOf()
      expect(sel1).toEqual(sel2)
    })

    test('pseudo sorting', () => {
      /** :is(.a):is(.b) */
      let sel1 = compound([
        pseudo({ value: ':is', arg: el('.a') }),
        pseudo({ value: ':is', arg: el('.b') })
      ]).valueOf()
      /** :is(.b):is(.a) */
      let sel2 = compound([
        pseudo({ value: ':is', arg: el('.b') }),
        pseudo({ value: ':is', arg: el('.a') })
      ]).valueOf()
      expect(sel1).toEqual(sel2)
    })

    test('un-wrap is', () => {
      /** a#id.one.two */
      let sel1 = compound([
        el('a'),
        el('#id'),
        el('.one'),
        el('.two')
      ]).valueOf()
      /** :is(a)#id:is(.one.two) */
      let sel2 = compound([
        pseudo({ value: ':is', arg: el('a') }),
        el('#id'),
        pseudo({ value: ':is', arg: compound([el('.two'), el('.one')]) })
      ]).valueOf()
      expect(sel1).toEqual(sel2)
    })
  })
  describe('keys', () => {
    test('simple compound', () => {
      let sel1 = compound([
        el('a'),
        el('#id'),
        el('.class')
      ])
      expect(sel1.keys).toEqual(['a', '#id', '.class'])
    })

    test('nested compound', () => {
      /** :is(a)#id:is(.one.two) */
      const sel1 = pseudo({ value: ':is', arg: el('a') })
      let sel2 = compound([
        sel1,
        el('#id'),
        pseudo({ value: ':is', arg: compound([el('.two'), el('.one')]) })
      ])

      expect(sel1.keys).toEqual('a')
      expect(sel2.keys).toEqual(['a', '#id', '.two', '.one'])
    })
  })
})