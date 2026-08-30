import { describe, expect, it } from 'vitest';
import {
  bodySpanOf,
  createTriviaMapFromParseman,
  createTriviaMapFromRanges,
  rule,
  selist,
  sel,
  sourceSpanOf,
  stylesheet,
  triviaMapOf,
  variableReference,
  withBodySpan,
  withSourceSpan,
  withTriviaMap,
  valueBoundaryTriviaOf,
  valueLayoutOf,
  withValueBoundaryTrivia,
  withValueLayout
} from '../../ast.js';

describe('canonical AST source provenance', () => {
  it('does not retain implied single-space value layout', () => {
    const value = [{ type: 'Keyword' as const, src: 'red' }, { type: 'Keyword' as const, src: 'blue' }];

    expect(withValueLayout(value, [' '])).toBe(value);
    expect(valueLayoutOf(value)).toBeUndefined();
  });

  it('keeps a spaced top-level slash layout as a Less semantic boundary', () => {
    const value = [
      { type: 'Dimension' as const, value: '10', unit: 'px' },
      { type: 'Keyword' as const, src: '/' },
      { type: 'Dimension' as const, value: '2', unit: '' }
    ];

    expect(withValueLayout(value, [' ', ' '])).toBe(value);
    expect(valueLayoutOf(value)).toEqual([' ', ' ']);
  });

  it('keeps an explicit empty layout as a parser-owned function-boundary fact', () => {
    const value: object[] = [];

    expect(withValueLayout(value, [])).toBe(value);
    expect(valueLayoutOf(value)).toEqual([]);
  });

  it('keeps rare boundary trivia in the existing value-layout store', () => {
    const value: object[] = [];
    const boundary = {
      before: { start: 0, end: 13 },
      between: { start: 13, end: 19 },
      after: { start: 19, end: 31 }
    } as const;
    const separators = Object.freeze([' /* between */ ']);

    expect(withValueBoundaryTrivia(value, separators, boundary)).toBe(value);
    expect(valueLayoutOf(value)).toEqual([' /* between */ ']);
    expect(valueBoundaryTriviaOf(value)).toBe(boundary);
  });

  it('retains a Parseman reduction span without changing the AST node shape', () => {
    const ref = variableReference('tone', 'scoped');
    const keys = Object.keys(ref);

    expect(withSourceSpan(ref, { start: 8, end: 13 })).toBe(ref);
    expect(sourceSpanOf(ref)).toEqual({ start: 8, end: 13 });
    expect(Object.keys(ref)).toEqual(keys);
  });

  it('retains document trivia without changing the AST root shape', () => {
    /* Built through the factory: the shape guarantee is about the shape every
     * root actually has, not about an ad-hoc literal that skips the slots. */
    const doc = stylesheet([]);
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

  it('enumerates labeled comment gaps without forcing Parseman\'s full root-gap walk', () => {
    const src = '  /* keep */\n  .a{}';
    const commentGap = {
      start: 0,
      end: 15,
      hasKind: (kind: string) => kind === 'blockComment'
    };
    let gapsCalls = 0;
    const trivia = createTriviaMapFromParseman(src, {
      labels: ['whitespace', 'blockComment'],
      entries: {
        length: 1,
        start: () => commentGap.start,
        end: () => commentGap.end
      },
      gapBefore: () => undefined,
      gapAfter: () => undefined,
      gaps() {
        gapsCalls++;
        return [commentGap];
      },
      gapsWithKind(kinds) {
        return kinds.includes('blockComment') ? [commentGap] : [];
      }
    });

    expect(trivia.commentRuns()).toEqual([{ start: 0, end: 15, src, hasComment: true }]);
    expect(gapsCalls).toBe(0);
  });

  it('gets every labeled comment gap from Parseman rather than assuming packed entries are complete', () => {
    const src = '/* first */\n.a{}\n/* second */\n.b{}';
    const first = { start: 0, end: 12, hasKind: (kind: string) => kind === 'blockComment' };
    const second = { start: 17, end: 30, hasKind: (kind: string) => kind === 'blockComment' };
    const trivia = createTriviaMapFromParseman(src, {
      labels: ['whitespace', 'blockComment'],
      entries: {
        /* A root index may expose a compact entry view that omits later
         * comment-bearing gaps. `gapsWithKind()` is the completeness contract. */
        length: 1,
        start() {
          return first.start;
        },
        end() {
          return first.end;
        }
      },
      gapBefore: () => undefined,
      gapAfter: () => undefined,
      gaps() {
        throw new Error('commentRuns must select labeled gaps');
      },
      gapsWithKind(kinds) {
        expect(kinds).toEqual(['comment', 'blockComment', 'lineComment']);
        return [first, second];
      }
    });

    expect(trivia.commentRuns()).toEqual([
      { start: 0, end: 12, src, hasComment: true },
      { start: 17, end: 30, src, hasComment: true }
    ]);
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

  it('falls back to source when legacy trivia entries omit their advertised comment kind', () => {
    const src = 'a/* keep */b';
    const gap = {
      start: 1,
      end: 11,
      hasKind: () => false
    };
    const trivia = createTriviaMapFromParseman(src, {
      labels: ['whitespace', 'blockComment'],
      entries: {
        length: 1,
        start: () => gap.start,
        end: () => gap.end,
        kind: () => 'whitespace'
      },
      gapBefore: () => undefined,
      gapAfter: () => undefined,
      gaps: () => [gap]
    });

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
