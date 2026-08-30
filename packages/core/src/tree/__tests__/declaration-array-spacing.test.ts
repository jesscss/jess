import { decl, any, color, quoted } from '../index.js';
import { Context, TreeContext } from '../../context.js';
import { createTriviaMap, makeTrivia } from '../util/trivia.js';
import { setSourceSpan } from '../util/provenance.js';
import { describe, it, expect } from 'vitest';

/**
 * A declaration value can arrive as a flat array. Two shapes reach the
 * serializer: string-normalized value terms from the parser (whose inter-term
 * whitespace lives in the trivia map or must be re-derived) and verbatim string
 * fragments (whitespace baked into the strings). The separator must keep the
 * former's terms distinct without corrupting the latter's fragments.
 */
describe('declaration flat-array value spacing', () => {
  it('inserts a separator between string-normalized terms so they do not fuse', () => {
    // "border: 2px solid white" — `solid` is a bare string term (no span).
    const src = 'border: 2px solid white';
    const r1 = makeTrivia(src, 11, 12);
    const r2 = makeTrivia(src, 17, 18);
    const trivia = createTriviaMap({
      before: new Map([[12, r1], [18, r2]]),
      after: new Map([[11, r1], [17, r2]])
    });
    const tc = new TreeContext({ trivia });
    const dim = any('2px', undefined, { start: 8, end: 11 });
    const white = color('white');
    setSourceSpan(white, { start: 18, end: 23 });
    const d = decl({ name: 'border', value: [dim, 'solid', white] }, undefined, { start: 0, end: 23 }, tc);
    const ctx = new Context();
    ctx.opts.trivia = trivia;
    expect(d.toString({ trivia })).toBe('border: 2px solid white');
  });

  it('emits authored trivia (newline + indent) before a source-backed term', () => {
    /*
     * "border: 2px\n          solid\n          black": the newline before `black`
     * is a trivia run keyed at its span start; it must survive, not collapse.
     */
    const src = 'border: 2px\n          solid\n          black';
    const beforeBlack = makeTrivia(src, 27, 38);
    const trivia = createTriviaMap({
      before: new Map([[38, beforeBlack]]),
      after: new Map([[27, beforeBlack]])
    });
    const tc = new TreeContext({ trivia });
    const dim = any('2px', undefined, { start: 8, end: 11 });
    const black = color('black');
    setSourceSpan(black, { start: 38, end: 43 });
    const d = decl({ name: 'border', value: [dim, '\n          solid', black] }, undefined, { start: 0, end: 43 }, tc);
    const ctx = new Context();
    ctx.opts.trivia = trivia;
    expect(d.toString({ trivia })).toBe('border: 2px\n          solid\n          black');
  });

  it('keeps the space before a quoted term following a string fragment', () => {
    /*
     * `content: is "theme1"` — `is` is a bare string term, `"theme1"` a Quoted
     * Node. The merge guard must not drop the authored space before the quote.
     */
    const q = quoted('theme1', { quote: '"' });
    const d = decl({ name: 'content', value: ['is', q] });
    expect(d.toTrimmedString()).toBe('content: is "theme1"');
  });

  it('keeps the space before a single-quoted term following a string fragment', () => {
    const q = quoted('theme1', { quote: '\'' });
    const d = decl({ name: 'content', value: ['is not', q] });
    expect(d.toTrimmedString()).toBe('content: is not \'theme1\'');
  });

  it('does not insert separators between verbatim string fragments', () => {
    // calc fragments carry their own whitespace; concatenate exactly.
    const d = decl({ name: 'width', value: ['calc(', '100%', ' - ', '1px', ')'] });
    expect(d.toTrimmedString()).toBe('width: calc(100% - 1px)');
  });
});
