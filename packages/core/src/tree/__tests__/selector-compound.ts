import { compound, el, co, pseudo } from '..'
import { Tuple } from '@bloomberg/record-tuple-polyfill'

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
      ]).toNormalPrimitive()
      let sel2 = compound([
        el('a'),
        el('#id'),
        el('.class')
      ]).toNormalPrimitive()
      expect(sel1).toEqual(sel2)
    })

    test('same value (unsorted)', () => {
      let sel1 = compound([
        el('a'),
        el('#id'),
        el('.class')
      ]).toNormalPrimitive()
      let sel2 = compound([
        el('a'),
        el('.class'),
        el('#id')
      ]).toNormalPrimitive()
      expect(sel1).toEqual(sel2)
    })

    test('un-wrap is', () => {
      /** a#id.one.two */
      let sel1 = compound([
        el('a'),
        el('#id'),
        el('.one'),
        el('.two')
      ]).toNormalPrimitive()
      /** :is(a)#id:is(.one.two) */
      let sel2 = compound([
        pseudo({ name: ':is', value: el('a') }),
        el('#id'),
        pseudo({ name: ':is', value: compound([el('.two'), el('.one')]) })
      ]).toNormalPrimitive()
      expect(sel1).toEqual(sel2)
    })
  })
})