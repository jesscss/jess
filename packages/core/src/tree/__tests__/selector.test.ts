// import { Selector } from '../selector-sequence'
import { sel, el, co, pseudo, attr, any, quoted, sellist, compound } from '../index.js';
import { isNode } from '../util/is-node.js';
// import type { Class } from 'type-fest'
// import type { Node } from '../node.js'

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
      ]);
      expect(`${rule}`).toBe('.foo > #bar');
      rule = sel([
        el('.foo'),
        el('#bar')
      ]);
      expect(`${rule}`).toBe('.foo#bar');
      rule = sel([
        el('.foo'),
        co(' '),
        el('#bar')
      ]);
      expect(`${rule}`).toBe('.foo #bar');
    });
  });

  describe('equality', () => {
    test('normalized attribute selectors should be equal', () => {
      const attr1 = attr({
        name: 'foo',
        op: '=',
        value: any('bar')
      });
      const attr2 = attr({
        name: 'foo',
        op: '=',
        value: quoted(any('bar'))
      });
      expect(attr1.compare(attr2)).toBe(0);
    });

    test('equivalent node strings should be equal', () => {
      const attr1 = attr({
        name: 'foo',
        op: '=',
        value: any('bar')
      });
      const attr2 = any('[foo="bar"]');
      expect(attr1.compare(attr2)).toBe(0);
    });

    test('sequences should be equal', () => {
      const sel1 = sel([
        el('.foo'),
        co('>'),
        el('#bar')
      ]);
      let co2 = co('>');
      co2.pre = 1;
      co2.post = 1;
      const sel2 = sel([
        el('.foo'),
        co2,
        el('#bar')
      ]);
      expect(sel1.compare(sel2 as any)).toBe(0);
    });

    test('inverted selector sequences are equal', () => {
      const sel1 = compound([
        el('.foo'),
        el('#bar')
      ]);
      const sel2 = compound([
        el('#bar'),
        el('.foo')
      ]);
      expect((sel1 as any).compare(sel2)).toBe(0);
    });

    test('out of order lists are equal', () => {
      const list1 = sellist([
        el('.foo'),
        el('#bar')
      ]);

      const list2 = sellist([
        el('#bar'),
        el('.foo')
      ]);

      expect((list1 as any).compare(list2)).toBe(0);
    });

    test(':is() should match w/o :is()', () => {
      // .foo {}
      // :is(.foo) {}
      const sel1 = el('.foo');
      const sel2 = pseudo({
        name: ':is',
        arg: el('.foo')
      });
      expect(sel1.compare(sel2)).toBe(0);
    });

    test(':is() should match w/o :is()', () => {
      // .foo, .bar {}
      const sel1 = sellist([el('.foo'), el('.bar')]);
      // :is(.foo, .bar) {}
      const sel2 = pseudo({
        name: ':is',
        arg: sellist([el('.foo'), el('.bar')])
      });
      // :is(.foo), .bar {}
      const sel3 = sellist([
        pseudo({
          name: ':is',
          arg: el('.foo')
        }),
        el('.bar')
      ]);

      // .foo, .bar {}
      // :is(.foo, .bar) {}
      // match .foo w/ .foo
      // .bar {}
      // :is(.bar) {}
      // match .bar w/ .bar
      // {}
      // :is() {} is reduced to {}
      // matches are exhausted, so the selectors are equal
      expect((sel1 as any).compare(sel2)).toBe(0);
      expect((sel1 as any).compare(sel3)).toBe(0);
      expect(sel2.compare(sel3)).toBe(0);
    });

    test(':is() should match w/o :is()', () => {
      // a b, a c {}
      const sel1 = sellist([
        sel([el('a'), co(' '), el('b')]),
        sel([el('a'), co(' '), el('c')])
      ]);
      // a :is(b, c) {}
      const sel2 = sel([
        el('a'),
        co(' '),
        pseudo({
          name: ':is',
          arg: sellist([el('b'), el('c')])
        })
      ]);

      /**
       * Given:
       * A. a b, a c {}
       * B. a :is(b, c) {}
       *
       * Test for exhaustiveness of combinations. i.e.
       *   1. First, we test if element 'a' from A is within B. If not, exit.
       *      (During eval, should we build a map of all simple selectors?)
       *   2. We collect all complex selectors from each selector list,
       *      including within :is() (but not :where(), which is matched on its own)
       *      Note, we don't want to create a new list of cloned selectors,
       *      but instead a "linked list" (or tuple?) of all complex selector combinations.
       *   3. Starting with A, test each complex selector (linked list) against each
       *      complex selector (linked list) in B. If a match is found, remove it from
       *      the list of linked lists.
       *   4. If all linked lists are exhausted, the selectors are equal.
       */

      expect((sel1 as any).compare(sel2)).toBe(0);
    });
  });
});
