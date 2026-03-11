import { describe, test, expect } from 'vitest';
import {
  RecursiveDescentParser,
  tokenMatches,
  MismatchedTokenError,
  NoViableAltError,
  type IToken,
  type TokenType
} from '../index.js';

// ── Test token types ─────────────────────────────────────────────────

const Number_: TokenType = { name: 'Number' };
const Plus: TokenType = { name: 'Plus' };
const Minus: TokenType = { name: 'Minus' };
const Star: TokenType = { name: 'Star' };
const LParen: TokenType = { name: 'LParen' };
const RParen: TokenType = { name: 'RParen' };
const Semi: TokenType = { name: 'Semi' };
const Comma: TokenType = { name: 'Comma' };
const Ident: TokenType = { name: 'Ident' };
const Colon: TokenType = { name: 'Colon' };
const LCurly: TokenType = { name: 'LCurly' };
const RCurly: TokenType = { name: 'RCurly' };
const WS: TokenType = { name: 'WS', LABEL: 'Skipped' };
const Comment: TokenType = { name: 'Comment', LABEL: 'Skipped' };

// Category token type
const Operator: TokenType = { name: 'Operator' };
const PlusOp: TokenType = { name: 'PlusOp', CATEGORIES: [Operator] };
const MinusOp: TokenType = { name: 'MinusOp', CATEGORIES: [Operator] };

function tok(type: TokenType, image: string, offset: number): IToken {
  return {
    image,
    startOffset: offset,
    startLine: 1,
    startColumn: offset,
    endOffset: offset + image.length - 1,
    endLine: 1,
    endColumn: offset + image.length - 1,
    tokenType: type
  };
}

// ── tokenMatches ─────────────────────────────────────────────────────

describe('tokenMatches', () => {
  test('matches exact token type', () => {
    const t = tok(Number_, '42', 0);
    expect(tokenMatches(t, Number_)).toBe(true);
    expect(tokenMatches(t, Plus)).toBe(false);
  });

  test('matches via category', () => {
    const t = tok(PlusOp, '+', 0);
    expect(tokenMatches(t, Operator)).toBe(true);
    expect(tokenMatches(t, PlusOp)).toBe(true);
    expect(tokenMatches(t, Number_)).toBe(false);
  });
});

// ── RecursiveDescentParser ───────────────────────────────────────────

describe('RecursiveDescentParser', () => {
  describe('consume', () => {
    test('consumes matching token and advances', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Number_, '42', 0), tok(Plus, '+', 3)];

      const t = p.consume(Number_);
      expect(t.image).toBe('42');
      expect(p.la(1).image).toBe('+');
    });

    test('throws on mismatch', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Number_, '42', 0)];

      expect(() => p.consume(Plus)).toThrow(MismatchedTokenError);
    });

    test('recovery: single-token deletion', () => {
      const p = new RecursiveDescentParser({ recoveryEnabled: true });
      // Stream: BAD GOOD — delete BAD, consume GOOD
      p.input = [tok(Plus, '+', 0), tok(Number_, '42', 2)];

      const t = p.consume(Number_);
      expect(t.image).toBe('42');
      expect(p.errors).toHaveLength(1);
    });
  });

  describe('or', () => {
    test('selects matching alternative via GATE', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Number_, '42', 0)];

      const result = p.or([
        { GATE: () => p.check(Plus), ALT: () => 'plus' },
        { GATE: () => p.check(Number_), ALT: () => 'number' },
      ]);
      expect(result).toBe('number');
    });

    test('falls through to default (last) alternative', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Number_, '42', 0)];

      const result = p.or([
        { GATE: () => p.check(Plus), ALT: () => 'plus' },
        { ALT: () => 'default' }, // no GATE = default
      ]);
      expect(result).toBe('default');
    });

    test('throws NoViableAltError when nothing matches', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Number_, '42', 0)];

      expect(() => p.or([
        { GATE: () => false, ALT: () => 'a' },
        { GATE: () => false, ALT: () => 'b' },
      ])).toThrow(NoViableAltError);
    });
  });

  describe('many', () => {
    test('zero repetitions', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Plus, '+', 0)];
      const items: string[] = [];

      p.many(() => {
        items.push(p.consume(Number_).image);
      });
      expect(items).toEqual([]);
    });

    test('multiple repetitions', () => {
      const p = new RecursiveDescentParser();
      p.input = [
        tok(Number_, '1', 0),
        tok(Number_, '2', 2),
        tok(Number_, '3', 4),
        tok(Plus, '+', 6)
      ];
      const items: string[] = [];

      p.many(() => {
        items.push(p.consume(Number_).image);
      });
      expect(items).toEqual(['1', '2', '3']);
      expect(p.la(1).image).toBe('+');
    });

    test('with GATE predicate', () => {
      const p = new RecursiveDescentParser();
      p.input = [
        tok(Number_, '1', 0),
        tok(Number_, '2', 2),
        tok(Number_, '3', 4),
      ];
      const items: string[] = [];
      let count = 0;

      p.many({
        GATE: () => count < 2,
        DEF: () => {
          items.push(p.consume(Number_).image);
          count++;
        }
      });
      expect(items).toEqual(['1', '2']);
    });
  });

  describe('atLeastOne', () => {
    test('requires at least one match', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Plus, '+', 0)];

      expect(() => {
        p.atLeastOne(() => {
          p.consume(Number_);
        });
      }).toThrow(MismatchedTokenError);
    });

    test('matches multiple', () => {
      const p = new RecursiveDescentParser();
      p.input = [
        tok(Number_, '1', 0),
        tok(Number_, '2', 2),
        tok(Plus, '+', 4)
      ];
      const items: string[] = [];

      p.atLeastOne(() => {
        items.push(p.consume(Number_).image);
      });
      expect(items).toEqual(['1', '2']);
    });
  });

  describe('option', () => {
    test('returns value when matched', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Number_, '42', 0)];

      const result = p.option(() => p.consume(Number_));
      expect(result?.image).toBe('42');
    });

    test('returns undefined when not matched', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Plus, '+', 0)];

      const result = p.option(() => p.consume(Number_));
      expect(result).toBeUndefined();
      // Position should be restored
      expect(p.la(1).image).toBe('+');
    });
  });

  describe('manySep', () => {
    test('zero elements', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Semi, ';', 0)];
      const items: string[] = [];

      p.manySep({
        SEP: Comma,
        DEF: () => { items.push(p.consume(Number_).image); }
      });
      expect(items).toEqual([]);
    });

    test('comma-separated list', () => {
      const p = new RecursiveDescentParser();
      p.input = [
        tok(Number_, '1', 0),
        tok(Comma, ',', 2),
        tok(Number_, '2', 4),
        tok(Comma, ',', 6),
        tok(Number_, '3', 8),
        tok(Semi, ';', 10)
      ];
      const items: string[] = [];

      p.manySep({
        SEP: Comma,
        DEF: () => { items.push(p.consume(Number_).image); }
      });
      expect(items).toEqual(['1', '2', '3']);
      expect(p.la(1).image).toBe(';');
    });
  });

  describe('atLeastOneSep', () => {
    test('requires at least one element', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Semi, ';', 0)];

      expect(() => {
        p.atLeastOneSep({
          SEP: Comma,
          DEF: () => { p.consume(Number_); }
        });
      }).toThrow(MismatchedTokenError);
    });

    test('single element, no separator', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Number_, '42', 0), tok(Semi, ';', 3)];
      const items: string[] = [];

      p.atLeastOneSep({
        SEP: Comma,
        DEF: () => { items.push(p.consume(Number_).image); }
      });
      expect(items).toEqual(['42']);
    });
  });

  describe('backtrack', () => {
    test('returns true on success, restores position', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Number_, '42', 0), tok(Plus, '+', 3)];

      const result = p.backtrack(function(this: RecursiveDescentParser) {
        this.consume(Number_);
        this.consume(Plus);
      });
      expect(result).toBe(true);
      // Position restored
      expect(p.la(1).image).toBe('42');
    });

    test('returns false on failure, restores position', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Number_, '42', 0), tok(Plus, '+', 3)];

      const result = p.backtrack(function(this: RecursiveDescentParser) {
        this.consume(Number_);
        this.consume(Star); // will fail
      });
      expect(result).toBe(false);
      expect(p.la(1).image).toBe('42');
    });
  });

  describe('location tracking', () => {
    test('startRule/endRule captures span', () => {
      const p = new RecursiveDescentParser();
      p.input = [
        tok(Ident, 'color', 0),
        tok(Colon, ':', 6),
        tok(Ident, 'red', 8)
      ];

      p.startRule();
      p.consume(Ident);
      p.consume(Colon);
      p.consume(Ident);
      const loc = p.endRule();

      expect(loc[0]).toBe(0);  // startOffset
      expect(loc[3]).toBe(10); // endOffset
    });
  });

  describe('skipped token filtering', () => {
    test('filters WS and comments from parse stream', () => {
      const p = new RecursiveDescentParser();
      p.input = [
        tok(Ident, 'a', 0),
        tok(WS, ' ', 1),
        tok(Colon, ':', 2),
        tok(WS, ' ', 3),
        tok(Comment, '/* hi */', 4),
        tok(Ident, 'b', 13)
      ];

      // Parser should only see: Ident Colon Ident
      expect(p.la(1).image).toBe('a');
      p.consume(Ident);
      expect(p.la(1).image).toBe(':');
      p.consume(Colon);
      expect(p.la(1).image).toBe('b');
    });

    test('hasWS detects whitespace before token', () => {
      const p = new RecursiveDescentParser();
      p.input = [
        tok(Ident, 'a', 0),
        tok(WS, ' ', 1),
        tok(Ident, 'b', 2)
      ];

      // First token has no WS before it
      expect(p.hasWS()).toBe(false);
      p.consume(Ident);
      // Second token has WS before it
      expect(p.hasWS()).toBe(true);
    });
  });

  describe('subrule', () => {
    test('calls rule and tracks rule stack', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Number_, '42', 0)];

      function myRule(this: RecursiveDescentParser): string {
        return this.consume(Number_).image;
      }

      const result = p.subrule(myRule);
      expect(result).toBe('42');
    });
  });

  describe('tryConsume', () => {
    test('returns token on match, advances position', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Number_, '42', 0), tok(Plus, '+', 3)];

      const t = p.tryConsume(Number_);
      expect(t?.image).toBe('42');
      expect(p.la(1).image).toBe('+');
    });

    test('returns undefined on mismatch, does NOT advance', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Number_, '42', 0)];

      const t = p.tryConsume(Plus);
      expect(t).toBeUndefined();
      // Position unchanged
      expect(p.la(1).image).toBe('42');
    });

    test('never throws — no Error allocation', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Number_, '42', 0)];

      // This should NOT throw, even though it doesn't match
      const t = p.tryConsume(Plus);
      expect(t).toBeUndefined();
    });
  });

  describe('location tracking (accuracy)', () => {
    /** Helper: create multiline tokens with proper line/column info */
    function mtok(type: TokenType, image: string, line: number, col: number, offset: number): IToken {
      const endCol = col + image.length - 1;
      return {
        image,
        startOffset: offset,
        startLine: line,
        startColumn: col,
        endOffset: offset + image.length - 1,
        endLine: line,
        endColumn: endCol,
        tokenType: type
      };
    }

    test('single-line location info is accurate', () => {
      const p = new RecursiveDescentParser();
      // "color: red"
      //  ^0         ^9
      p.input = [
        mtok(Ident, 'color', 1, 0, 0),
        mtok(Colon, ':', 1, 5, 5),
        mtok(Ident, 'red', 1, 7, 7)
      ];

      p.startRule();
      p.consume(Ident);
      p.consume(Colon);
      p.consume(Ident);
      const loc = p.endRule();

      expect(loc).toEqual([0, 1, 0, 9, 1, 9]);
    });

    test('multi-line location info spans lines correctly', () => {
      const p = new RecursiveDescentParser();
      // Line 1: "div {"
      // Line 2: "  color: red"
      // Line 3: "}"
      p.input = [
        mtok(Ident, 'div', 1, 0, 0),
        mtok(LCurly, '{', 1, 4, 4),
        mtok(Ident, 'color', 2, 2, 6),
        mtok(Colon, ':', 2, 7, 11),
        mtok(Ident, 'red', 2, 9, 13),
        mtok(RCurly, '}', 3, 0, 16)
      ];

      p.startRule();
      p.consume(Ident);   // div
      p.consume(LCurly);  // {
      p.consume(Ident);   // color
      p.consume(Colon);   // :
      p.consume(Ident);   // red
      p.consume(RCurly);  // }
      const loc = p.endRule();

      // Start: line 1, col 0, offset 0
      // End: line 3, col 0, offset 16
      expect(loc[0]).toBe(0);   // startOffset
      expect(loc[1]).toBe(1);   // startLine
      expect(loc[2]).toBe(0);   // startColumn
      expect(loc[3]).toBe(16);  // endOffset
      expect(loc[4]).toBe(3);   // endLine
      expect(loc[5]).toBe(0);   // endColumn
    });

    test('nested startRule/endRule tracks inner and outer spans', () => {
      const p = new RecursiveDescentParser();
      // "a : b c"
      p.input = [
        mtok(Ident, 'a', 1, 0, 0),
        mtok(Colon, ':', 1, 2, 2),
        mtok(Ident, 'b', 1, 4, 4),
        mtok(Ident, 'c', 1, 6, 6)
      ];

      p.startRule();       // outer
      p.consume(Ident);    // a
      p.consume(Colon);    // :

      p.startRule();       // inner (value)
      p.consume(Ident);    // b
      p.consume(Ident);    // c
      const inner = p.endRule();
      const outer = p.endRule();

      // Inner: "b c" → offset 4-6
      expect(inner[0]).toBe(4);
      expect(inner[3]).toBe(6);

      // Outer: "a : b c" → offset 0-6
      expect(outer[0]).toBe(0);
      expect(outer[3]).toBe(6);
    });

    test('getLocationInfo returns accurate token location', () => {
      const p = new RecursiveDescentParser();
      const token = mtok(Ident, 'hello', 5, 10, 42);

      const loc = p.getLocationInfo(token);
      expect(loc).toEqual([42, 5, 10, 46, 5, 14]);
    });

    test('getLocationFromNodes spans mixed tokens and nodes', () => {
      const p = new RecursiveDescentParser();
      const token1 = mtok(Ident, 'a', 1, 0, 0);
      const node = { location: [10, 2, 3, 20, 2, 13] as [number, number, number, number, number, number] };
      const token2 = mtok(Ident, 'z', 5, 0, 50);

      const loc = p.getLocationFromNodes([token1, node, token2]);
      expect(loc).toEqual([0, 1, 0, 50, 5, 0]);
    });
  });

  describe('integration: simple expression parser', () => {
    /**
     * Grammar:
     *   expr     → term (('+' | '-') term)*
     *   term     → NUMBER
     */
    class ExprParser extends RecursiveDescentParser {
      expr(): number {
        let left = this.term();
        this.many(() => {
          const op = this.or([
            { GATE: () => this.check(Plus), ALT: () => this.consume(Plus).image },
            { GATE: () => this.check(Minus), ALT: () => this.consume(Minus).image },
          ]);
          const right = this.term();
          left = op === '+' ? left + right : left - right;
        });
        return left;
      }

      term(): number {
        return parseInt(this.consume(Number_).image, 10);
      }
    }

    test('parses simple addition', () => {
      const p = new ExprParser();
      p.input = [
        tok(Number_, '1', 0),
        tok(Plus, '+', 2),
        tok(Number_, '2', 4),
        tok(Plus, '+', 6),
        tok(Number_, '3', 8)
      ];
      expect(p.expr()).toBe(6);
    });

    test('parses mixed operators', () => {
      const p = new ExprParser();
      p.input = [
        tok(Number_, '10', 0),
        tok(Minus, '-', 3),
        tok(Number_, '3', 5),
        tok(Plus, '+', 7),
        tok(Number_, '1', 9)
      ];
      expect(p.expr()).toBe(8);
    });
  });
});
