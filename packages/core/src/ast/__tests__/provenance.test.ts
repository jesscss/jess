import { describe, expect, it } from 'vitest';
import {
  bodySpanOf,
  createTriviaMapFromRanges,
  createTriviaMapFromRootIndex,
  rule,
  selist,
  sel,
  sourceSpanOf,
  triviaMapOf,
  variableReference,
  withBodySpan,
  withSourceSpan,
  withTriviaMap
} from '../../ast.js';

describe('canonical AST source provenance', () => {
  it('retains a Parseman reduction span without changing the AST node shape', () => {
    const ref = variableReference('tone', 'scoped');
    const keys = Object.keys(ref);

    expect(withSourceSpan(ref, { start: 8, end: 13 })).toBe(ref);
    expect(sourceSpanOf(ref)).toEqual({ start: 8, end: 13 });
    expect(Object.keys(ref)).toEqual(keys);
  });

  it('retains document trivia without changing the AST root shape', () => {
    const doc = { type: 'Stylesheet' as const, children: [] };
    const keys = Object.keys(doc);
    const src = '/* keep */\n.a{}';
    const trivia = createTriviaMapFromRanges(src, [{ start: 0, end: 11 }]);

    expect(withTriviaMap(doc, trivia)).toBe(doc);
    expect(triviaMapOf(doc)).toBe(trivia);
    expect(trivia.lookup(11, 'before')?.src).toBe(src);
    expect(trivia.lookup(11, 'before')?.hasComment).toBe(true);
    expect(Object.keys(doc)).toEqual(keys);
  });

  it('adapts Parseman root trivia indexes without parser-local raw log decoding', () => {
    const src = '/* keep */\n.a { color: red; }\n';
    const gaps = [
      { start: 0, end: 11 },
      { start: 27, end: 28 }
    ];
    const rawEntries = [
      { start: 0, end: 2 },
      { start: 2, end: 11 },
      { start: 27, end: 28 }
    ];
    const trivia = createTriviaMapFromRootIndex(src, {
      entries: {
        length: rawEntries.length,
        start(index) {
          return rawEntries[index]?.start ?? 0;
        },
        end(index) {
          return rawEntries[index]?.end ?? 0;
        }
      },
      gapBefore(offset) {
        return gaps.find(gap => gap.end === offset);
      },
      gapAfter(offset) {
        return gaps.find(gap => gap.start === offset);
      },
      gaps() {
        return gaps;
      }
    });

    const leading = trivia.lookup(11, 'before');
    expect(leading).toEqual({
      start: 0,
      end: 11,
      src,
      hasComment: true
    });
    expect(trivia.lookup(0, 'after')).toBe(leading);
    const commentRuns = trivia.commentRuns();
    expect(trivia.has(28, 'before')).toBe(true);
    expect([...trivia.entries('after')].map(([offset, run]) => [offset, run.start, run.end])).toEqual([
      [0, 0, 11],
      [27, 27, 28]
    ]);
    expect(commentRuns).toEqual([leading]);
    expect(trivia.lookup(0, 'after')).toBe(commentRuns[0]);
  });

  it('retains a block body span without changing the rule shape', () => {
    const node = rule(selist(sel('.a')), []);
    const keys = Object.keys(node);

    expect(withBodySpan(node, { start: 5, end: 15 })).toBe(node);
    expect(bodySpanOf(node)).toEqual({ start: 5, end: 15 });
    expect(Object.keys(node)).toEqual(keys);
  });
});
