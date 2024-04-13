import { sel, compound, el, co, pseudo } from '..'

/**
 * @todo - add tests for list bubbling
 */
describe('Complex selector', () => {
  describe('normalization', () => {
    test('only compound selectors are sorted', () => {
      let sel1 = sel([
        compound([
          el('.one'),
          el('.two')
        ]),
        co('>'),
        el('.three')
      ]).valueOf()

      let sel2 = sel([
        compound([
          el('.two'),
          el('.one')
        ]),
        co('>'),
        el('.three')
      ]).valueOf()

      let sel3 = sel([
        el('.one'),
        co('>'),
        compound([
          el('.two'),
          el('.three')
        ])
      ]).valueOf()
      expect(sel1).toEqual(sel2)
      expect(sel1).not.toEqual(sel3)
    })

    test('un-wrap is', () => {
      /** a#id.one.two */
      let sel1 = sel([
        compound([
          el('a'),
          el('#id'),
          el('.one'),
          el('.two')
        ])
      ]).valueOf()
      /** :is(a)#id:is(.two.one) */
      let sel2 = sel([
        compound([
          pseudo({ name: ':is', value: el('a') }),
          el('#id'),
          pseudo({ name: ':is', value: compound([el('.two'), el('.one')]) })
        ])
      ]).valueOf()
      expect(sel1).toEqual(sel2)
    })

    test('un-wrap is with combinator', () => {
      /** a#id > .one.two */
      let sel1 = sel([
        compound([
          el('a'),
          el('#id')
        ]),
        co('>'),
        compound([
          el('.one'),
          el('.two')
        ])
      ]).valueOf()
      /** :is(a)#id > :is(.one.two) */
      let sel2 = sel([
        compound([
          pseudo({ name: ':is', value: el('a') }),
          el('#id')
        ]),
        co('>'),
        pseudo({
          name: ':is',
          value: compound([
            el('.two'), el('.one')
          ])
        })
      ]).valueOf()
      expect(sel1).toEqual(sel2)
    })

    test('don\'t un-wrap with complex in :is()', () => {
      /** a#id > .one.two */
      let sel1 = sel([
        compound([
          el('a'),
          el('#id')
        ]),
        co('>'),
        compound([
          el('.one'),
          el('.two')
        ])
      ]).valueOf()
      /** :is(a)#id:is(> .one.two) */
      let sel2 = sel([
        compound([
          pseudo({ name: ':is', value: el('a') }),
          el('#id'),
          pseudo({ name: ':is', value: sel([co('>'), compound([el('.two'), el('.one')])]) })
        ])
      ]).valueOf()
      expect(sel1).not.toEqual(sel2)
    })
  })

  describe('keys', () => {
    test('simple complex', () => {
      let sel1 = sel([
        compound([
          el('.one'),
          el('.two')
        ]),
        co('>'),
        el('.three')
      ])
      expect(sel1.keys).toEqual(new Set(['.one', '.two', '.three']))
    })
    test('nested complex', () => {
      let sel2 = sel([
        compound([
          pseudo({ name: ':is', value: el('a') }),
          el('#id'),
          pseudo({ name: ':is', value: sel([co('>'), compound([el('.two'), el('.one')])]) })
        ])
      ])
      expect(sel2.keys).toEqual(new Set(['a', '#id', '.one', '.two']))
    })
  })
})