import { compound, el, pseudo } from '..'

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
        pseudo({ name: ':is', value: el('.a') }),
        pseudo({ name: ':is', value: el('.b') })
      ]).valueOf()
      /** :is(.b):is(.a) */
      let sel2 = compound([
        pseudo({ name: ':is', value: el('.b') }),
        pseudo({ name: ':is', value: el('.a') })
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
        pseudo({ name: ':is', value: el('a') }),
        el('#id'),
        pseudo({ name: ':is', value: compound([el('.two'), el('.one')]) })
      ]).valueOf()
      expect(sel1).toEqual(sel2)
    })
  })
})