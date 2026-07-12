import {
  sel,
  compound,
  co,
  el,
  type Selector,
  sellist,
  pseudo
} from '../../tree'
import { ExtendScope, Container } from '../extend'
import { logger } from '../../logger'

vi.spyOn(logger, 'warn')

let extend: ExtendScope

describe('Scope selectors', async () => {
  beforeEach(() => {
    extend = new ExtendScope()
  })

  describe.skip('extend registration', () => {
    /**
     * .two:extend(.three)
     */
    // test('simple selectors', () => {
    //   extend.register(el('.three'), el('.two'))
    //   expect(extend.completeMap).toEqual(new Map([
    //     ['.three', [el('.two')]]
    //   ]))
    //   extend.register(el('.three'), el('.two'), true)
    //   expect(extend.partialMap).toEqual(new Map([
    //     ['.three', [[el('.three'), el('.two')]]]
    //   ]))
    //   expect(extend.selectorSet).toEqual(new Set(['.three']))
    // })
  })

  describe('extend evaluation', () => {
    test('simple selectors #1', () => {
      /** .b:extend(.a); */
      extend.register(el('.a'), el('.b'), true)
      /** .a {} */
      let sel1 = el('.a')
      let bContainer = new Container(el('.b'))
      expect(extend.partialSimpleMap).toEqual(new Map([
        [
          '.a', new Container(el('.a'), [bContainer])
        ],
        [
          '.b', bContainer
        ]
      ]))
      /**
       * .a {}
       * .b:extend(.a all);
       *
       * expect: .a, .b {}
       */
      expect(`${extend.getExtendedSelector(sel1)}`).toBe('.a,\n.b')
    })

    test('simple selectors #2', () => {
      /** .b:extend(.a); */
      extend.register(el('.a'), el('.b'), true)
      /** :is(.a) {} */
      let sel1 = pseudo([
        ['value', ':is'],
        ['arg', el('.a')]
      ])
      let bContainer = new Container(el('.b'))
      expect(extend.partialSimpleMap).toEqual(new Map([
        [
          '.a', new Container(el('.a'), [bContainer])
        ],
        [
          '.b', bContainer
        ]
      ]))
      /** 2024-09-08 */
      /**
       * @note If a selector only contains simple or compound selectors,
       * then, when extended, they are flattened. What happens is the
       * inner selector is visited, and extended, and once transformed,
       * the outer selector is checked for completeness, and if it is,
       * then only the inner selector is returned.
       *
       * :is(.a) {}
       * .b:extend(.a all);
       *
       * expect: .a, .b {}
       */
      expect(`${extend.getExtendedSelector(sel1)}`).toBe('.a,\n.b')
    })
  })

  /**
   * 3. .one[.two.three, .four]
   *    Given: a partial overlap of an :is()
   *    i -> .five:extend(.one.two)
   *    Then: wrap the last complete match
   *    o -> .one[[.two,.five].three, .four]
   */
})