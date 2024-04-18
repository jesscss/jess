import {
  sel,
  compound,
  co,
  el,
  type Selector,
  sellist,
  pseudo
} from '../../tree'
import { Scope } from '../index'
import { logger } from '../../logger'

vi.spyOn(logger, 'warn')

let scope: Scope

type SimpleExtendMap = Map<string, string[] | Selector[]>

describe('Scope selectors', async () => {
  beforeEach(() => {
    scope = new Scope()
  })

  describe('extend registration', () => {
    /**
     * .two:extend(.three)
     */
    it('simple selectors', () => {
      scope.registerExtend(el('.three'), el('.two'))
      expect(scope._extendMap).toEqual(new Map<string, SimpleExtendMap>([
        [
          '.three', new Map([
            ['complete', [el('.two')]]
          ])
        ]
      ]))
    })
    /**
     * .four:extend(.one > .two.three)
     */
    it('complex selectors', () => {
      let sel1 = sel([
        el('.one'),
        co('>'),
        compound([
          el('.two'),
          el('.three')
        ])
      ])
      scope.registerExtend(sel1, el('.four'))
      expect(scope._extendMap).toEqual(new Map<string, SimpleExtendMap>([
        [
          '.one', new Map([
            ['continue', ['>']]
          ])
        ],
        [
          '.one>', new Map([
            ['continue', ['.two']]
          ])
        ],
        [
          '.one>.two', new Map([
            ['continue', ['.three']]
          ])
        ],
        [
          '.one>.two.three', new Map([
            ['complete', [el('.four')]]
          ])
        ]
      ]))
    })
    it.only('registers selector lists', () => {
      let sel1 = sel([
        pseudo([
          ['name', ':is'],
          ['value', sellist([
            el('.one'),
            el('.two')
          ])]
        ]),
        co('>'),
        compound([
          el('.three'),
          el('.four')
        ])
      ])
      const extendWith = el('.five')
      scope.registerExtend(sel1, extendWith)
      /** Exact (normalized) match */
      let complete = new Map([
        ['[.one,.two]>.four.three', [extendWith]]
      ])
      scope.registerExtend(sel1, extendWith, true)
      let partial = new Map([
        /** Start key - either matches a simple selector or one of the elements of a compound selector */
        ['.one', /* (string | Selector)[] */ [sel1, extendWith]],
        ['.two', /* reference to above */ [sel1, extendWith]]
      ])
      expect(scope._extendMap).toEqual(new Map<string, SimpleExtendMap>([
        [
          '.one', new Map([
            ['continue', ['>']]
          ])
        ],
        [
          '.one>', new Map([
            ['continue', ['.three']]
          ])
        ],
        [
          '.one>.three', new Map([
            ['continue', ['.four']]
          ])
        ],
        [
          '.one>.two.four', new Map([
            ['complete', [el('.five')]]
          ])
        ]
      ]))
    })
  })

  /**
   *   i -> .six:extend(.two)
  *    o -> .one>[[.two,.six][.three,.four],.five]
  *
  *    i -> .seven:extend(.one>.two)
  *    o -> [[.one>[.two,.six],.seven][.three,.four],.five]
  */
  it.skip('registers a compound extend', () => {
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
    scope.registerExtend(el('.three'), el('.four'))
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