// import { Selector } from '../selector-sequence'
import { sel, el, co, pseudo, attr, any, quoted, sellist } from '..'
import { Tuple, type tuple } from '@bloomberg/record-tuple-polyfill'
import { isNode } from '../util'
// import type { Class } from 'type-fest'
// import type { Node } from '../node'

/** @todo - move to https://github.com/SamVerschueren/tsd */
// test('Test types', () => {
//   expectTypeOf(Selector).toMatchTypeOf<Class<Node>>()
// })

describe('Selector', () => {
  describe('serialization', () => {
    it('should serialize to a selector', () => {
      let rule = sel([
        el('.foo'),
        co('>'),
        el('#bar')
      ])
      expect(`${rule}`).toBe('.foo>#bar')
      rule = sel([
        el('.foo'),
        el('#bar')
      ])
      expect(`${rule}`).toBe('.foo#bar')
      rule = sel([
        el('.foo'),
        co(' '),
        el('#bar')
      ])
      expect(`${rule}`).toBe('.foo #bar')
    })
  })

  describe.only('normalization', () => {
    test('normalizes sequences / lists / single selectors as tuple lists', () => {
      const sel1 = el('.foo')
      const sel2 = sel([el('.foo')])
      const sel3 = sellist([sel([el('.foo')])])

      const match = Tuple(Tuple(Tuple('.foo')))

      expect(sel1.toNormalizedSelector()).toBe(match)
      expect(sel2.toNormalizedSelector()).toBe(match)
      expect(sel3.toNormalizedSelector()).toBe(match)
    })

    test('converts :is()', () => {
      const sel1 = pseudo({
        name: ':is',
        value: el('.foo')
      })
      const sel2 = pseudo({
        name: ':is',
        value: sel([el('.foo')])
      })
      const match = Tuple(Tuple(Tuple('.foo')))

      expect(sel1.toNormalizedSelector()).toBe(match)
      expect(sel2.toNormalizedSelector()).toBe(match)
    })
  })

  describe('equality', () => {
    test('normalized attribute selectors should be equal', () => {
      const attr1 = attr({
        key: 'foo',
        op: '=',
        value: any('bar')
      })
      const attr2 = attr({
        key: 'foo',
        op: '=',
        value: quoted(any('bar'))
      })
      expect(attr1.compare(attr2)).toBe(0)
    })

    test('equivalent node strings should be equal', () => {
      const attr1 = attr({
        key: 'foo',
        op: '=',
        value: any('bar')
      })
      const attr2 = any('[foo="bar"]')
      expect(attr1.compare(attr2)).toBe(0)
    })

    test('sequences should be equal', () => {
      const sel1 = sel([
        el('.foo'),
        co('>'),
        el('#bar')
      ])
      let co2 = co('>')
      co2.pre = 1
      co2.post = 1
      const sel2 = sel([
        el('.foo'),
        co2,
        el('#bar')
      ])
      expect(sel1.compare(sel2)).toBe(0)
    })

    test('inverted selector sequences are equal', () => {
      const sel1 = sel([
        el('.foo'),
        el('#bar')
      ])
      const sel2 = sel([
        el('#bar'),
        el('.foo')
      ])
      expect(sel1.compare(sel2)).toBe(0)
    })

    test('out of order lists are equal', () => {
      const list1 = sellist([
        sel([el('.foo')]),
        sel([el('#bar')])
      ])

      const list2 = sellist([
        sel([el('#bar')]),
        sel([el('.foo')])
      ])

      expect(list1.compare(list2)).toBe(0)
    })

    test(':is() should match w/o :is()', () => {
      // .foo, .bar {}
      // :is(.foo), .bar {}
      const sel1 = el('.foo')
      const sel2 = pseudo({
        name: ':is',
        value: el('.foo')
      })
      expect(sel1.compare(sel2)).toBe(0)
    })

    // :is(a, b) :is(.c, .d) {}
    // a .c {}
    // a .d {}  --> a :is(.c, .d) {}
    // b .c {}  --> b .c, a :is(.c, .d) {}
    // b .d {}  --> :is(a, b) :is(.c, .d) {}
  })
})
