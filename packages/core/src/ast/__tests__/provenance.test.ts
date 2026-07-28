import { describe, expect, it } from 'vitest';
import {
  bodySpanOf,
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

  it('retains a block body span without changing the rule shape', () => {
    const node = rule(selist(sel('.a')), []);
    const keys = Object.keys(node);

    expect(withBodySpan(node, { start: 5, end: 15 })).toBe(node);
    expect(bodySpanOf(node)).toEqual({ start: 5, end: 15 });
    expect(Object.keys(node)).toEqual(keys);
  });
});
