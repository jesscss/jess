import { describe, it, expect, beforeEach } from 'vitest';
import { setSourceSpan, setValueSpans, setFieldSpans } from '../util/provenance.js';
import { decl, rules, SelectorList } from '../index.js';
import { Context } from '../../context.js';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap, makeTrivia } from '../util/trivia.js';

describe('per-slot spans render wiring', () => {
  beforeEach(() => {
    // Context is constructed per-test below.
  });

  it('emits a trailing comment after a BARE-STRING declaration value', () => {
    /*
     * `a: yes /* comment *\/` — value is the plain string 'yes' (no node
     * identity). The parser stamps a fieldSpan on the `value` field so render
     * can find where the value ends and place the adjacent comment.
     */
    const src = 'a: yes /* comment */;';
    const node = decl({ name: 'a', value: 'yes' });
    setSourceSpan(node, { start: 0, end: 20 });

    // value 'yes' spans [3, 6). childKeys = ['name','value','important'] → value idx 1.
    setFieldSpans(node, [undefined, { start: 3, end: 6 }, undefined]);
    const shared = makeTrivia(src, 6, 20); // " /* comment */"
    const trivia = createTriviaMap({
      after: new Map([[6, shared]])
    }) satisfies TriviaMap;

    const out = rules([node]).toString({ trivia });
    expect(out).toContain('a: yes /* comment */;');
  });

  it('emits a comment between BARE-STRING selector-list members', () => {
    /*
     * `#comments /* boo *\/, .comments` — the list surface is an array whose
     * members carry no node identity. Per-slot value spans give each member's
     * [start,end) so a comment in the gap after a member round-trips.
     */
    const src = '#comments /* boo */, .comments { color: red; }';
    const listArr: string[] = ['#comments', '.comments'];
    const list = SelectorList.create(listArr);

    // member 0 '#comments' spans [0,9); member 1 '.comments' spans [21,30).
    setValueSpans(list, [{ start: 0, end: 9 }, { start: 21, end: 30 }]);
    const shared = makeTrivia(src, 9, 20); // " /* boo */,"; comment run
    const trivia = createTriviaMap({
      after: new Map([[9, shared]])
    }) satisfies TriviaMap;

    const context = new Context({ trivia });
    void context;
    const out = list.toString({ trivia });

    // The comment must appear after the first member, before the comma.
    expect(out).toContain('/* boo */');
    expect(out.indexOf('/* boo */')).toBeLessThan(out.indexOf(','));
  });
});
