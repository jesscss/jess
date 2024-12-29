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

describe('Extend evaluation', async () => {
  beforeEach(() => {
    extend = new ExtendScope()
  })

  describe('partial simple extends', () => {
    test('simple selectors', () => {
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

    test('multiple extends', () => {
      /** .b:extend(.a); */
      extend.register(el('.a'), el('.b'), true)
      extend.register(el('.a'), el('.c'), true)
      /** .a {} */
      let sel1 = el('.a')
      /**
         * .a {}
         * .b:extend(.a all);
         * .c:extend(.a all);
         */
      expect(`${extend.getExtendedSelector(sel1)}`).toBe('.a,\n.b,\n.c')
    })

    test('simple selectors with :is() match', () => {
      /** .b:extend(.a); */
      extend.register(el('.a'), el('.b'), true)
      /** :is(.a) {} */
      let sel1 = pseudo([
        ['value', ':is'],
        ['arg', el('.a')]
      ])
      expect(`${extend.getExtendedSelector(sel1)}`).toBe(':is(.a, .b)')
    })

    test('inner :is() match', () => {
      /** .b:extend(.a); */
      extend.register(el('.a'), el('.b'), true)
      /** :is(.a) {} */
      let sel1 = pseudo([
        ['value', ':is'],
        ['arg', sellist([el('.a'), el('.c')])]
      ])
      expect(`${extend.getExtendedSelector(sel1)}`).toBe(':is(.a, .c, .b)')
    })

    test(':not()', () => {
      /** .b:extend(.a); */
      extend.register(el('.a'), el('.b'), true)
      /** :is(.a) {} */
      let sel1 = pseudo([
        ['value', ':not'],
        ['arg', sellist([el('.a'), el('.c')])]
      ])
      expect(`${extend.getExtendedSelector(sel1)}`).toBe(':not(.a, .c, .b)')
    })

    test(':has()', () => {
      /** .b:extend(.a); */
      extend.register(el('.a'), el('.b'), true)
      /** :is(.a) {} */
      let sel1 = pseudo([
        ['value', ':has'],
        ['arg', sellist([el('.a'), el('.c')])]
      ])
      expect(`${extend.getExtendedSelector(sel1)}`).toBe(':has(.a, .c, .b)')
    })

    test('compound selector #1', () => {
      /** .b:extend(.a); */
      extend.register(el('.a'), el('.b'), true)
      /** :is(.a).c {} */
      let sel1 = compound([
        pseudo([
          ['value', ':is'],
          ['arg', el('.a')]
        ]),
        el('.c')
      ])
      expect(`${extend.getExtendedSelector(sel1)}`).toBe(':is(.a, .b).c')
    })

    test('compound selector #2', () => {
      /** .b:extend(.a); */
      extend.register(el('.a'), el('.b'), true)
      /** .a.c {} */
      let sel1 = compound([
        el('.a'),
        el('.c')
      ])
      expect(`${extend.getExtendedSelector(sel1)}`).toBe(':is(.a, .b).c')
    })

    test('multiple compound selectors', () => {
      /** .b:extend(.a); */
      extend.register(el('.a'), el('.b'), true)
      /** .d:extend(.c); */
      extend.register(el('.c'), el('.d'), true)
      /** .a.c.e {} */
      let sel1 = compound([
        el('.a'),
        el('.c'),
        el('.e')
      ])
      expect(`${extend.getExtendedSelector(sel1)}`).toBe(':is(.a, .b):is(.c, .d).e')
    })

    test('recursion prevention #1', () => {
      /** .b:extend(.a); */
      extend.register(el('.a'), el('.b'), true)
      /** .a:extend(.b); */
      extend.register(el('.b'), el('.a'), true)
      let sel1 = compound([
        el('.a'),
        el('.b')
      ])
      expect(`${extend.getExtendedSelector(sel1)}`).toBe(':is(.a, .b):is(.b, .a)')
    })

    test('recursion prevention #2', () => {
      /** Can't extend element with itself */
      expect(() => extend.register(el('.a'), el('.a'), true)).toThrowError()
    })

    test('recursion prevention #3', () => {
      /** .a:extend(.b); */
      extend.register(el('.b'), el('.a'), true)
      /** .b:extend(.c); */
      extend.register(el('.c'), el('.b'), true)
      /** .c:extend(.a); */
      extend.register(el('.a'), el('.c'), true)

      expect(`${extend.getExtendedSelector(el('.a'))}`).toBe('.a,\n.c,\n.b')
      expect(`${extend.getExtendedSelector(el('.b'))}`).toBe('.b,\n.a,\n.c')
      expect(`${extend.getExtendedSelector(el('.c'))}`).toBe('.c,\n.b,\n.a')
    })
  })

  describe('extend normalization', () => {
    test('attribute selector', () => {
      /** .a:extend(.b); */
      extend.register(el('.b'), el('.a'), true)
    })
  })
})
