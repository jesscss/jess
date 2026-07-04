import { setSourceSpan, sourceSpanOf } from '../util/provenance.js';
// import { Selector } from '../selector-sequence'
import { sel, el, co, pseudo, attr, any, quoted, sellist, compound } from '../index.js';
import { Context } from '../../context.js';
import { visibleKeySetOf, requiredKeySetOf } from '../util/selector-analysis.js';
import { isNode } from '../util/is-node.js';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap, makeTrivia } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';
// import type { Class } from 'type-fest'
// import type { Node } from '../node.js'

let context: Context;

// A trivia run is now a source range; build one whose text is exactly `text`.
const run = (text: string) => makeTrivia(text, 0, text.length);

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
      setSourceSpan(first, { start: 0, end: 1 });
      const second = el('.b');
      setSourceSpan(second, { start: 17, end: 18 });
      const third = el('.c');
      setSourceSpan(third, { start: 25, end: 26 });
      const firstRun = run('\n/*x*//*y*/\n');
      const secondRun = run('/*z*/');
      const trivia = createTriviaMap({
        before: new Map([
          [sourceSpanOf(second)?.start, firstRun],
          [sourceSpanOf(third)?.start, secondRun]
        ]),
        after: new Map()
      }) satisfies TriviaMap;

      expect(sellist([first, second, third]).toString({ trivia })).toBe('#a,\n/*x*//*y*/\n.b,\n/*z*/.c');
    });

    it('streams selector list items without capture scaffolding', () => {
      const writer = new CountingWriter();
      const first = el('#a');
      setSourceSpan(first, { start: 0, end: 1 });
      const second = el('.b');
      setSourceSpan(second, { start: 17, end: 18 });
      const trivia = createTriviaMap({
        before: new Map([[sourceSpanOf(second)?.start, run('\n/*x*/\n')]]),
        after: new Map()
      }) satisfies TriviaMap;

      expect(sellist([first, second]).toString({ trivia, writer })).toBe('#a,\n/*x*/\n.b');
      expect(writer.captures).toBe(0);
    });

    it('serializes string-backed selector list members without selector leaves', async () => {
      const selector = sellist(['h1', sel(['h2', '>', 'a', '>', 'p']), 'h3']);
      selector.keySetLibrary = context.selectorBits;

      expect(selector.toTrimmedString()).toBe('h1,\nh2 > a > p,\nh3');
      expect(selector.valueOf()).toBe('h1,h2>a>p,h3');
      expect(visibleKeySetOf(selector).equals(context.selectorBits.getBitset(['h1', 'h2', 'a', 'p', 'h3']))).toBe(true);
      expect(requiredKeySetOf(selector).equals(context.selectorBits.getBitset())).toBe(true);
      expect(await selector.resolve(context)).toBe(selector);
    });

    it('filters reference targets without treating string selector list members as nodes', () => {
      const selector = sellist(['h1']);

      expect(selector.toTrimmedString({
        referenceMode: true,
        referenceRenderEnabled: true,
        referenceFilterTargets: true
      })).toBe('h1');
    });

    it('serializes comment trivia between selector list members before separators', () => {
      const first = el('#comments');
      setSourceSpan(first, { start: 0, end: 8 });
      const second = el('.comments');
      setSourceSpan(second, { start: 35, end: 43 });
      // The SAME run object indexed from both sides — emitted once by identity.
      const shared = run(' /* boo *//* boo again*/');
      const trivia = createTriviaMap({
        before: new Map([[33, shared]]),
        after: new Map([[sourceSpanOf(first)?.end, shared]])
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
