import { sel, sellist, compound, el, co, pseudo } from '..'
import { Tuple } from '@bloomberg/record-tuple-polyfill'

/**
 * @todo - add tests for list bubbling
 */
describe('Selector list', () => {
  describe('normalization', () => {
    test('combine lists', () => {
      /** a b, a c */
      let sel1 = sellist([
        sel([
          el('a'),
          co(' '),
          el('b')
        ]),
        sel([
          el('a'),
          co(' '),
          el('c')
        ])
      ]).toNormalPrimitive()
      let compare = Tuple.from([
        'a',
        ' ',
        Tuple.from(['b', 'c'])
      ])

      expect(sel1).toEqual(compare)
    })
  })
})