import {
  sel,
  compound,
  co,
  el
} from '../../tree'
import { Scope } from '../index'
import { logger } from '../../logger'

vi.spyOn(logger, 'warn')

let scope: Scope

describe('Scope selectors', async () => {
  beforeEach(() => {
    scope = new Scope()
  })

  /**
   * 1. .one>.two.three
   *    i -> .two:extend(.three)
   *    o -> .one>.two[.three, .two]
   */
  it('registers an extend', () => {
    scope.extendSelector('.three', '.two')
    expect(scope._extendMap).toEqual(new Map([
      [
        '.three', {
          continue: [],
          partial: ['.two'],
          all: []
        }
      ]
    ]))
  })

  /**
   *   i -> .six:extend(.two)
  *    o -> .one>[[.two,.six][.three,.four],.five]
  *
  *    i -> .seven:extend(.one>.two)
  *    o -> [[.one>[.two,.six],.seven][.three,.four],.five]
  */
  it('registers a compound extend', () => {
    /** 2. .one>.two.three
      *    Given: we extend one element
      *    i -> .four:extend(.three)
      *    Then: we need to wrap that in an :is()
      *    o -> .one>.two[.three, .four]
      *
      *    Given: we extend two elements that overlaps an :is()
      *    i -> .five:extend(.two.three)
      *    Then: we need to extend the :is() and distribute
      *    o -> .one>[.two[.three,.four],.five]
      */
    let sel1 = sel([
      el('.one'),
      co('>'),
      compound([
        el('.two'),
        el('.three')
      ])
    ])
    scope.extendSelector('.three', '.four')
    expect(`${scope.getExtendedSelector(sel1)}`).toBe('.one > .two:is(.three, .four)')
    // scope.extendSelector(['.two', '.three'], '.five')
    // expect(scope._extendMap).toEqual(new Map([
    //   [
    //     '.three', {
    //       continue: [],
    //       partial: ['.four'],
    //       all: []
    //     }
    //   ],
    //   [
    //     '.two', {
    //       continue: ['.three'],
    //       partial: [],
    //       all: []
    //     }
    //   ],
    //   [
    //     '.two.three', {
    //       continue: [],
    //       partial: ['.five'],
    //       all: []
    //     }
    //   ]
    // ]))
  })

  /**
   * 3. .one[.two.three, .four]
   *    Given: a partial overlap of an :is()
   *    i -> .five:extend(.one.two)
   *    Then: wrap the last complete match
   *    o -> .one[[.two,.five].three, .four]
   */
})