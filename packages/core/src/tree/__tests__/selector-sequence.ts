import { sel, el, co, pseudo } from '..'
import { Tuple } from '@bloomberg/record-tuple-polyfill'

/**
 * @todo - add tests for list bubbling
 */
describe('Selector Sequence', () => {
  describe('normalization', () => {
    test('same value (sorted)', () => {
      let sel1 = sel([
        el('a'),
        el('#id'),
        el('.class')
      ]).toNormalPrimitive()
      let sel2 = sel([
        el('a'),
        el('#id'),
        el('.class')
      ]).toNormalPrimitive()
      expect(sel1).toEqual(sel2)
    })

    test('same value (unsorted)', () => {
      let sel1 = sel([
        el('a'),
        el('#id'),
        el('.class')
      ]).toNormalPrimitive()
      let sel2 = sel([
        el('a'),
        el('.class'),
        el('#id')
      ]).toNormalPrimitive()
      expect(sel1).toEqual(sel2)
    })

    test('only compound selectors are sorted', () => {
      let sel1 = sel([
        el('.one'),
        el('.two'),
        co('>'),
        el('.three')
      ]).toNormalPrimitive()

      let sel2 = sel([
        el('.two'),
        el('.one'),
        co('>'),
        el('.three')
      ]).toNormalPrimitive()

      let sel3 = sel([
        el('.one'),
        co('>'),
        el('.two'),
        el('.three')
      ]).toNormalPrimitive()
      expect(sel1).toEqual(sel2)
      expect(sel1).not.toEqual(sel3)
    })

    test('un-wrap is', () => {
      /** a#id.one.two */
      let sel1 = sel([
        el('a'),
        el('#id'),
        el('.one'),
        el('.two')
      ]).toNormalPrimitive()
      /** :is(a)#id:is(.one.two) */
      let sel2 = sel([
        pseudo({ name: ':is', value: el('a') }),
        el('#id'),
        pseudo({ name: ':is', value: sel([el('.two'), el('.one')]) })
      ]).toNormalPrimitive()
      expect(sel1).toEqual(sel2)
    })

    test('un-wrap is with combinator', () => {
      /** a#id > .one.two */
      let sel1 = sel([
        el('a'),
        el('#id'),
        co('>'),
        el('.one'),
        el('.two')
      ]).toNormalPrimitive()
      /** :is(a)#id > :is(.one.two) */
      let sel2 = sel([
        pseudo({ name: ':is', value: el('a') }),
        el('#id'),
        co('>'),
        pseudo({ name: ':is', value: sel([el('.two'), el('.one')]) })
      ]).toNormalPrimitive()
      expect(sel1).toEqual(sel2)
    })

    test('don\'t un-wrap with relative :is()', () => {
      /** a#id > .one.two */
      let sel1 = sel([
        el('a'),
        el('#id'),
        co('>'),
        el('.one'),
        el('.two')
      ]).toNormalPrimitive()
      /** :is(a)#id > :is(.one.two) */
      let sel2 = sel([
        pseudo({ name: ':is', value: el('a') }),
        el('#id'),
        pseudo({ name: ':is', value: sel([co('>'), el('.two'), el('.one')]) })
      ]).toNormalPrimitive()
      expect(sel1).not.toEqual(sel2)
    })
  })
})