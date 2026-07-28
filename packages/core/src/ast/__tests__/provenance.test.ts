import { describe, expect, it } from 'vitest';
import {
  bodySpanOf,
  createTriviaMapFromParseman,
  createTriviaMapFromRanges,
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
    const trivia = createTriviaMapFromParseman(src, {
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

  it('keeps direct boundary lookups on Parseman\'s sparse index', () => {
    const src = '/* keep */\n.a{}';
    const leading = { start: 0, end: 11 };
    let gapsCalls = 0;
    const trivia = createTriviaMapFromParseman(src, {
      entries: {
        length: 1,
        start() {
          return leading.start;
        },
        end() {
          return leading.end;
        }
      },
      gapBefore(offset) {
        return offset === leading.end ? leading : undefined;
      },
      gapAfter(offset) {
        return offset === leading.start ? leading : undefined;
      },
      gaps() {
        gapsCalls++;
        return [leading];
      }
    });

    expect(trivia.has(leading.end, 'before')).toBe(true);
    expect(trivia.lookup(leading.end, 'before')).toEqual({
      start: 0,
      end: 11,
      src,
      hasComment: true
    });
    expect(trivia.lookup(leading.start, 'after')).toBe(trivia.lookup(leading.end, 'before'));
    expect(gapsCalls).toBe(0);

    expect([...trivia.entries('before')]).toHaveLength(1);
    expect(gapsCalls).toBe(1);
  });

  it('dedupes equivalent Parseman gaps by source range', () => {
    const src = '/* keep */\n.a{}';
    const beforeGap = { start: 0, end: 11 };
    const afterGap = { start: 0, end: 11 };
    const trivia = createTriviaMapFromParseman(src, {
      entries: {
        length: 1,
        start() {
          return beforeGap.start;
        },
        end() {
          return beforeGap.end;
        }
      },
      gapBefore(offset) {
        return offset === beforeGap.end ? beforeGap : undefined;
      },
      gapAfter(offset) {
        return offset === afterGap.start ? afterGap : undefined;
      },
      gaps() {
        return [beforeGap];
      }
    });

    expect(trivia.lookup(11, 'before')).toBe(trivia.lookup(0, 'after'));
  });

  it('uses Parseman trivia labels while preserving source fallback', () => {
    const src = '  /* keep */\n  .a{}';
    const leadingWhitespace = {
      start: 0,
      end: 2,
      hasKind: () => false
    };
    const commentGap = {
      start: 2,
      end: 13,
      hasKind: (kind: string) => kind === 'comment'
    };
    let gapsWithKindCalls = 0;
    const trivia = createTriviaMapFromParseman(src, {
      labels: ['comment'],
      entries: {
        length: 2,
        start(index) {
          return index === 0 ? leadingWhitespace.start : commentGap.start;
        },
        end(index) {
          return index === 0 ? leadingWhitespace.end : commentGap.end;
        }
      },
      gapBefore(offset) {
        return [leadingWhitespace, commentGap].find(gap => gap.end === offset);
      },
      gapAfter(offset) {
        return [leadingWhitespace, commentGap].find(gap => gap.start === offset);
      },
      gaps() {
        return [leadingWhitespace, commentGap];
      },
      gapsWithKind(kind) {
        gapsWithKindCalls++;
        expect(kind).toEqual(['comment', 'blockComment', 'lineComment']);
        return [commentGap];
      }
    });

    expect(trivia.lookup(0, 'after')).toMatchObject({
      start: 0,
      end: 2,
      hasComment: false
    });
    expect(trivia.commentRuns()).toEqual([
      {
        start: 2,
        end: 13,
        src,
        hasComment: true
      }
    ]);
    expect(gapsWithKindCalls).toBe(1);
  });

  it('falls back to source detection when a labeled gap is not comment-labeled', () => {
    const src = 'a/* keep */b';
    const gap = {
      start: 1,
      end: 11,
      hasKind: (kind: string) => kind === 'whitespace'
    };
    const trivia = createTriviaMapFromParseman(src, {
      labels: ['whitespace', 'blockComment'],
      entries: {
        length: 1,
        start() {
          return gap.start;
        },
        end() {
          return gap.end;
        }
      },
      gapBefore(offset) {
        return offset === gap.end ? gap : undefined;
      },
      gapAfter(offset) {
        return offset === gap.start ? gap : undefined;
      },
      gaps() {
        return [gap];
      },
      gapsWithKind() {
        return [gap];
      }
    });

    expect(trivia.lookup(gap.end, 'before')?.hasComment).toBe(true);
    expect(trivia.commentRuns().map(run => src.slice(run.start, run.end))).toEqual(['/* keep */']);
  });

  it('recognizes Parseman block and line comment trivia labels as comment-bearing', () => {
    const src = '/* block */\n// line\n.a{}';
    const block = {
      start: 0,
      end: 12,
      hasKind: (kind: string) => kind === 'blockComment'
    };
    const line = {
      start: 12,
      end: 20,
      hasKind: (kind: string) => kind === 'lineComment'
    };
    const trivia = createTriviaMapFromParseman(src, {
      labels: ['whitespace', 'blockComment', 'lineComment'],
      entries: {
        length: 2,
        start(index) {
          return index === 0 ? block.start : line.start;
        },
        end(index) {
          return index === 0 ? block.end : line.end;
        }
      },
      gapBefore(offset) {
        return [block, line].find(gap => gap.end === offset);
      },
      gapAfter(offset) {
        return [block, line].find(gap => gap.start === offset);
      },
      gaps() {
        return [block, line];
      },
      gapsWithKind(kind) {
        expect(kind).toEqual(['comment', 'blockComment', 'lineComment']);
        return [block, line];
      }
    });

    expect(trivia.lookup(block.end, 'before')?.hasComment).toBe(true);
    expect(trivia.lookup(line.end, 'before')?.hasComment).toBe(true);
    expect(trivia.commentRuns().map(run => src.slice(run.start, run.end))).toEqual([
      '/* block */\n',
      '// line\n'
    ]);
  });

  it('retains a block body span without changing the rule shape', () => {
    const node = rule(selist(sel('.a')), []);
    const keys = Object.keys(node);

    expect(withBodySpan(node, { start: 5, end: 15 })).toBe(node);
    expect(bodySpanOf(node)).toEqual({ start: 5, end: 15 });
    expect(Object.keys(node)).toEqual(keys);
  });
});
