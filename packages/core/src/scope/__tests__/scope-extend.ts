import {
  sel,
  compound,
  co,
  el,
  type Selector,
  sellist,
  pseudo
} from '../../tree';
import { ExtendScope } from '../extend';
import { logger } from '../../logger';

vi.spyOn(logger, 'warn');

let extend: ExtendScope;

describe('Scope selectors', async () => {
  beforeEach(() => {
    extend = new ExtendScope();
  });

  describe('extend registration', () => {
    /**
     * .two:extend(.three)
     */
    test('simple selectors', () => {
      extend.register(el('.three'), el('.two'));
      expect(extend.completeMap).toEqual(new Map([
        ['.three', [el('.two')]]
      ]));
      extend.register(el('.three'), el('.two'), true);
      expect(extend.partialMap).toEqual(new Map([
        ['.three', [[el('.three'), el('.two')]]]
      ]));
      expect(extend.selectorSet).toEqual(new Set(['.three']));
    });
    /**
     * .four:extend(.one > .two.three)
     */
    test('complex selectors', () => {
      let sel1 = sel([
        el('.one'),
        co('>'),
        compound([
          el('.two'),
          el('.three')
        ])
      ]);
      extend.register(sel1, el('.four'), true);
      expect(extend.partialMap).toEqual(new Map([
        [
          '.one', [[sel1, el('.four')]]
        ]
      ]));
    });
    test('registers selector lists', () => {
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
      ]);
      const extendWith = el('.five');
      extend.register(sel1, extendWith);
      /** Exact (normalized) match */
      let complete = new Map([
        [':is(.one,.two)>.four.three', [extendWith]]
      ]);
      extend.register(sel1, extendWith, true);
      let partial = new Map([
        /** Start key - either matches a simple selector or one of the elements of a compound selector */
        ['.one', /* (string | Selector)[] */ [[sel1, extendWith]]],
        ['.two', /* reference to above */ [[sel1, extendWith]]]
      ]);
      expect(extend.completeMap).toEqual(complete);
      expect(extend.partialMap).toEqual(partial);
    });
  });

  describe.only('extend evaluation', () => {
    /**
     *   i -> .six:extend(.two)
     *    o -> .one>[[.two,.six][.three,.four],.five]
     *
     *    i -> .seven:extend(.one>.two)
     *    o -> [[.one>[.two,.six],.seven][.three,.four],.five]
     */
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
    test('no matches', () => {
      let sel1 = el('.one');
      expect(`${extend.getExtendedSelector(sel1)}`).toBe('.one');
      extend.register(el('.three'), el('.two'));
      expect(`${extend.getExtendedSelector(sel1)}`).toBe('.one');
    });

    test('complete - simple', () => {
      let sel1 = el('.one');
      extend.register(el('.one'), el('.two'));
      expect(`${extend.getExtendedSelector(sel1)}`).toBe('.one,\n.two');
    });

    test('complete - equivalent', () => {
      /** :is(.one) */
      let sel1 = pseudo([['name', ':is'], ['value', el('.one')]]);
      let sel2 = pseudo([['name', ':is'], ['value', sel1]]);
      /** Make sure compound wrapping makes no difference */
      let sel3 = pseudo([['name', ':is'], ['value', sel([sel1])]]);
      extend.register(el('.one'), el('.two'));
      expect(`${extend.getExtendedSelector(sel1)}`).toBe(':is(.one),\n.two');
      expect(`${extend.getExtendedSelector(sel2)}`).toBe(':is(:is(.one)),\n.two');
      expect(`${extend.getExtendedSelector(sel3)}`).toBe(':is(:is(.one)),\n.two');
    });

    test('partial - simple', () => {
      let sel1 = el('.one');
      extend.register(el('.one'), el('.two'), true);
      expect(`${extend.getExtendedSelector(sel1)}`).toBe('.one,\n.two');
    });
  });

  /**
   * 3. .one[.two.three, .four]
   *    Given: a partial overlap of an :is()
   *    i -> .five:extend(.one.two)
   *    Then: wrap the last complete match
   *    o -> .one[[.two,.five].three, .four]
   */
});