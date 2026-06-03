// import { Selector } from '../selector-sequence'
import type { IToken } from 'chevrotain';
import { sel, el, co, pseudo, attr, any, quoted, sellist, compound } from '../index.js';
import { Context } from '../../context.js';
import { isNode } from '../util/is-node.js';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';
// import type { Class } from 'type-fest'
// import type { Node } from '../node.js'

let context: Context;

const token = (image: string, tokenTypeName = 'WS'): IToken => ({
  image,
  tokenType: { name: tokenTypeName } as IToken['tokenType'],
  startOffset: 0,
  endOffset: image.length - 1,
  startLine: 1,
  endLine: 1,
  startColumn: 1,
  endColumn: image.length
});

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

/** @todo - move to https://github.com/SamVerschueren/tsd */
// test('Test types', () => {
//   expectTypeOf(Selector).toMatchTypeOf<Class<Node>>()
// })

describe('Selector', () => {
  beforeEach(() => {
    context = new Context();
  });

  describe('serialization', () => {
    it('should serialize to a selector', () => {
      let rule = sel([
        el('.foo'),
        co('>'),
        el('#bar')
      ]);
      expect(rule.toTrimmedString()).toBe('.foo > #bar');
      rule = sel([
        el('.foo'),
        el('#bar')
      ]);
      expect(rule.toTrimmedString()).toBe('.foo#bar');
      rule = sel([
        el('.foo'),
        co(' '),
        el('#bar')
      ]);
      expect(rule.toTrimmedString()).toBe('.foo #bar');
    });

    it('renders selector sequences through render(context)', () => {
      const rule = sel([
        el('.foo'),
        co('>'),
        el('#bar')
      ]);

      expect(rule.render(context)).toBe('.foo > #bar');
    });

    it('serializes comment trivia between selector list members after separators', () => {
      const first = el('#a');
      first._location = [0, 1, 1, 1, 1, 2];
      const second = el('.b');
      second._location = [17, 3, 1, 18, 3, 2];
      const third = el('.c');
      third._location = [25, 3, 9, 26, 3, 10];
      const firstRun = [token('\n'), token('/*x*/', 'BlockComment'), token('/*y*/', 'BlockComment'), token('\n')];
      const secondRun = [token('/*z*/', 'BlockComment')];
      const trivia = createTriviaMap({
        before: new Map([
          [second.location[0], firstRun],
          [third.location[0], secondRun]
        ]),
        after: new Map<number, IToken[]>()
      }) satisfies TriviaMap;

      expect(sellist([first, second, third]).toString({ trivia })).toBe('#a,\n/*x*//*y*/\n.b,\n/*z*/.c');
    });

    it('streams selector list items without capture scaffolding', () => {
      const writer = new CountingWriter();
      const first = el('#a');
      first._location = [0, 1, 1, 1, 1, 2];
      const second = el('.b');
      second._location = [17, 3, 1, 18, 3, 2];
      const trivia = createTriviaMap({
        before: new Map([[second.location[0], [token('\n'), token('/*x*/', 'BlockComment'), token('\n')]]]),
        after: new Map<number, IToken[]>()
      }) satisfies TriviaMap;

      expect(sellist([first, second]).toString({ trivia, writer })).toBe('#a,\n/*x*/\n.b');
      expect(writer.captures).toBe(0);
    });

    it('serializes comment trivia between selector list members before separators', () => {
      const first = el('#comments');
      first._location = [0, 1, 1, 8, 1, 9];
      const second = el('.comments');
      second._location = [35, 1, 36, 43, 1, 44];
      const tokens = [token(' '), token('/* boo */', 'BlockComment'), token('/* boo again*/', 'BlockComment')];
      const trivia = createTriviaMap({
        before: new Map([[33, tokens]]),
        after: new Map([[first.location[3], tokens]])
      }) satisfies TriviaMap;

      expect(sellist([first, second]).toString({ trivia })).toBe('#comments /* boo *//* boo again*/,\n.comments');
    });

    it('resolves selector sequences without touching render state', async () => {
      const rule = sel([
        el('.foo'),
        co('>'),
        el('#bar')
      ]);

      const resolved = await rule.resolve(context);

      expect(resolved.toTrimmedString()).toBe('.foo > #bar');
      expect(rule.evaluated).toBe(false);
      expect(rule.registrationPrepared).toBe(false);
      expect(context.printState.writer).toBeUndefined();
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
      const sel2 = sel([
        el('.foo'),
        co('>'),
        el('#bar')
      ]);
      expect(sel1.compare(sel2)).toBe(0);
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
      expect(sel1.compare(sel2)).toBe(0);
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

      expect(list1.compare(list2)).toBe(0);
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
      expect(sel1.compare(sel2)).toBe(0);
      expect(sel1.compare(sel3)).toBe(0);
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

      expect(sel1.compare(sel2)).toBe(0);
    });
  });
});
