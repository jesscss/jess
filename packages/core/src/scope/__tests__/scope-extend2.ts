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

  describe('extend registration', () => {
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
    test('simple selectors', () => {
      extend.register(el('.a'), el('.b'), true)
      let sel1 = el('.a')
      let bContainer = new Container(el('.b'))
      expect(extend.partialSimpleMap).toEqual(new Map([
        [
          '.a', new Container(sel1, [bContainer])
        ],
        [
          '.b', bContainer
        ]
      ]))
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