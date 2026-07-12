import { describe, test, expect } from 'vitest';
import {
  RecursiveDescentParser,
  buildTokenMatchBitsets,
  tokenMatches,
  EOF_TOKEN_TYPE,
  ParseError,
  MismatchedTokenError,
  NoViableAltError,
  type IToken,
  type TokenType
} from '../index.js';

// ── Test token types ─────────────────────────────────────────────────

const NumberTok: TokenType = { name: 'Number' };
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

buildTokenMatchBitsets([
  NumberTok,
  Plus,
  Minus,
  Star,
  LParen,
  RParen,
  Semi,
  Comma,
  Ident,
  Colon,
  LCurly,
  RCurly,
  WS,
  Comment,
  Operator,
  PlusOp,
  MinusOp,
  EOF_TOKEN_TYPE
]);

// ── tokenMatches ─────────────────────────────────────────────────────

describe('tokenMatches', () => {
  test('matches exact token type', () => {
    const t = tok(NumberTok, '42', 0);
    expect(tokenMatches(t, NumberTok)).toBe(true);
    expect(tokenMatches(t, Plus)).toBe(false);
  });

  test('matches via category', () => {
    const t = tok(PlusOp, '+', 0);
    expect(tokenMatches(t, Operator)).toBe(true);
    expect(tokenMatches(t, PlusOp)).toBe(true);
    expect(tokenMatches(t, NumberTok)).toBe(false);
  });

  test('buildTokenMatchBitsets enables O(1) lookups and supports deep nesting', () => {
    const ArithmeticOp: TokenType = { name: 'ArithmeticOp' };
    const AddOp: TokenType = { name: 'AddOp', CATEGORIES: [ArithmeticOp] };
    const MulOp: TokenType = { name: 'MulOp', CATEGORIES: [ArithmeticOp] };
    const PlusOp2: TokenType = { name: 'PlusOp2', CATEGORIES: [AddOp] };
    const MinusOp2: TokenType = { name: 'MinusOp2', CATEGORIES: [AddOp] };
    buildTokenMatchBitsets([PlusOp2, MinusOp2, MulOp, AddOp, ArithmeticOp]);

    const t = tok(PlusOp2, '+', 0);
    expect(tokenMatches(t, PlusOp2)).toBe(true);
    expect(tokenMatches(t, AddOp)).toBe(true);
    expect(tokenMatches(t, ArithmeticOp)).toBe(true);
    expect(tokenMatches(t, MulOp)).toBe(false);
  });
});

// ── RecursiveDescentParser ───────────────────────────────────────────

describe('RecursiveDescentParser', () => {
  describe('consume', () => {
    test('consumes matching token and advances', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(NumberTok, '42', 0), tok(Plus, '+', 3)];

      const t = p.CONSUME(NumberTok);
      expect(t.image).toBe('42');
      expect(p.LA(1).image).toBe('+');
    });

    test('throws on mismatch', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(NumberTok, '42', 0)];

      expect(() => p.CONSUME(Plus)).toThrow(MismatchedTokenError);
    });

    test('recovery: single-token deletion', () => {
      const p = new RecursiveDescentParser({ recoveryEnabled: true });
      // Stream: BAD GOOD — delete BAD, consume GOOD
      p.input = [tok(Plus, '+', 0), tok(NumberTok, '42', 2)];

      const t = p.CONSUME(NumberTok);
      expect(t.image).toBe('42');
      expect(p.errors).toHaveLength(1);
    });
  });

  describe('or', () => {
    test('selects matching alternative via GATE', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(NumberTok, '42', 0)];

      const result = p.OR([
        { GATE: () => p.check(Plus), ALT: () => 'plus' },
        { GATE: () => p.check(NumberTok), ALT: () => 'number' }
      ]);
      expect(result).toBe('number');
    });

    test('falls through to default (last) alternative', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(NumberTok, '42', 0)];

      const result = p.OR([
        { GATE: () => p.check(Plus), ALT: () => 'plus' },
        { ALT: () => 'default' } // no GATE = default
      ]);
      expect(result).toBe('default');
    });

    test('throws NoViableAltError when nothing matches', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(NumberTok, '42', 0)];

      expect(() => p.OR([
        { GATE: () => false, ALT: () => 'a' },
        { GATE: () => false, ALT: () => 'b' }
      ])).toThrow(NoViableAltError);
    });
  });

  describe('many', () => {
    test('zero repetitions', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Plus, '+', 0)];
      const items: string[] = [];

      p.MANY(() => {
        items.push(p.CONSUME(NumberTok).image);
      });
      expect(items).toEqual([]);
    });

    test('multiple repetitions', () => {
      const p = new RecursiveDescentParser();
      p.input = [
        tok(NumberTok, '1', 0),
        tok(NumberTok, '2', 2),
        tok(NumberTok, '3', 4),
        tok(Plus, '+', 6)
      ];
      const items: string[] = [];

      p.MANY(() => {
        items.push(p.CONSUME(NumberTok).image);
      });
      expect(items).toEqual(['1', '2', '3']);
      expect(p.LA(1).image).toBe('+');
    });

    test('with GATE predicate', () => {
      const p = new RecursiveDescentParser();
      p.input = [
        tok(NumberTok, '1', 0),
        tok(NumberTok, '2', 2),
        tok(NumberTok, '3', 4)
      ];
      const items: string[] = [];
      let count = 0;

      p.MANY({
        GATE: () => count < 2,
        DEF: () => {
          items.push(p.CONSUME(NumberTok).image);
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
        p.AT_LEAST_ONE(() => {
          p.CONSUME(NumberTok);
        });
      }).toThrow(MismatchedTokenError);
    });

    test('matches multiple', () => {
      const p = new RecursiveDescentParser();
      p.input = [
        tok(NumberTok, '1', 0),
        tok(NumberTok, '2', 2),
        tok(Plus, '+', 4)
      ];
      const items: string[] = [];

      p.AT_LEAST_ONE(() => {
        items.push(p.CONSUME(NumberTok).image);
      });
      expect(items).toEqual(['1', '2']);
    });
  });

  describe('option', () => {
    test('returns value when matched', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(NumberTok, '42', 0)];

      const result = p.OPTION(() => p.CONSUME(NumberTok));
      expect(result?.image).toBe('42');
    });

    test('returns undefined when not matched', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Plus, '+', 0)];

      const result = p.OPTION(() => p.CONSUME(NumberTok));
      expect(result).toBeUndefined();
      // Position should be restored
      expect(p.LA(1).image).toBe('+');
    });
  });

  describe('manySep', () => {
    test('zero elements', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Semi, ';', 0)];
      const items: string[] = [];

      p.MANY_SEP({
        SEP: Comma,
        DEF: () => {
          items.push(p.CONSUME(NumberTok).image);
        }
      });
      expect(items).toEqual([]);
    });

    test('comma-separated list', () => {
      const p = new RecursiveDescentParser();
      p.input = [
        tok(NumberTok, '1', 0),
        tok(Comma, ',', 2),
        tok(NumberTok, '2', 4),
        tok(Comma, ',', 6),
        tok(NumberTok, '3', 8),
        tok(Semi, ';', 10)
      ];
      const items: string[] = [];

      p.MANY_SEP({
        SEP: Comma,
        DEF: () => {
          items.push(p.CONSUME(NumberTok).image);
        }
      });
      expect(items).toEqual(['1', '2', '3']);
      expect(p.LA(1).image).toBe(';');
    });
  });

  describe('atLeastOneSep', () => {
    test('requires at least one element', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(Semi, ';', 0)];

      expect(() => {
        p.AT_LEAST_ONE_SEP({
          SEP: Comma,
          DEF: () => {
            p.CONSUME(NumberTok);
          }
        });
      }).toThrow(MismatchedTokenError);
    });

    test('single element, no separator', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(NumberTok, '42', 0), tok(Semi, ';', 3)];
      const items: string[] = [];

      p.AT_LEAST_ONE_SEP({
        SEP: Comma,
        DEF: () => {
          items.push(p.CONSUME(NumberTok).image);
        }
      });
      expect(items).toEqual(['42']);
    });
  });

  describe('backtrack', () => {
    test('returns true on success, restores position', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(NumberTok, '42', 0), tok(Plus, '+', 3)];

      const result = p.backtrack(function(this: RecursiveDescentParser) {
        this.CONSUME(NumberTok);
        this.CONSUME(Plus);
      });
      expect(result).toBe(true);
      // Position restored
      expect(p.LA(1).image).toBe('42');
    });

    test('returns false on failure, restores position', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(NumberTok, '42', 0), tok(Plus, '+', 3)];

      const result = p.backtrack(function(this: RecursiveDescentParser) {
        this.CONSUME(NumberTok);
        this.CONSUME(Star); // will fail
      });
      expect(result).toBe(false);
      expect(p.LA(1).image).toBe('42');
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
      p.CONSUME(Ident);
      p.CONSUME(Colon);
      p.CONSUME(Ident);
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
      expect(p.LA(1).image).toBe('a');
      p.CONSUME(Ident);
      expect(p.LA(1).image).toBe(':');
      p.CONSUME(Colon);
      expect(p.LA(1).image).toBe('b');
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
      p.CONSUME(Ident);
      // Second token has WS before it
      expect(p.hasWS()).toBe(true);
    });

    test('indexes one trivia run for before and after lookups', () => {
      const p = new RecursiveDescentParser();
      p.input = [
        tok(Ident, 'a', 0),
        tok(WS, ' ', 1),
        tok(Comment, '/* hi */', 2),
        tok(Ident, 'b', 10)
      ];

      const before = p.triviaMap.lookup(10, 'before');
      const after = p.triviaMap.lookup(0, 'after');
      expect(before).toBe(after);
      expect(before?.map(token => token.image)).toEqual([' ', '/* hi */']);
      expect(p.noSep()).toBe(true);
      p.CONSUME(Ident);
      expect(p.noSep()).toBe(false);
      expect(p.hasWS()).toBe(true);
    });
  });

  describe('SUBRULE', () => {
    test('calls rule and tracks rule stack', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(NumberTok, '42', 0)];

      function myRule(this: RecursiveDescentParser): string {
        return this.CONSUME(NumberTok).image;
      }

      const result = p.SUBRULE(myRule);
      expect(result).toBe('42');
    });
  });

  describe('tryConsume', () => {
    test('returns token on match, advances position', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(NumberTok, '42', 0), tok(Plus, '+', 3)];

      const t = p.tryConsume(NumberTok);
      expect(t?.image).toBe('42');
      expect(p.LA(1).image).toBe('+');
    });

    test('returns undefined on mismatch, does NOT advance', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(NumberTok, '42', 0)];

      const t = p.tryConsume(Plus);
      expect(t).toBeUndefined();
      // Position unchanged
      expect(p.LA(1).image).toBe('42');
    });

    test('never throws — no Error allocation', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(NumberTok, '42', 0)];

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
      p.CONSUME(Ident);
      p.CONSUME(Colon);
      p.CONSUME(Ident);
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
      p.CONSUME(Ident);   // div
      p.CONSUME(LCurly);  // {
      p.CONSUME(Ident);   // color
      p.CONSUME(Colon);   // :
      p.CONSUME(Ident);   // red
      p.CONSUME(RCurly);  // }
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
      p.CONSUME(Ident);    // a
      p.CONSUME(Colon);    // :

      p.startRule();       // inner (value)
      p.CONSUME(Ident);    // b
      p.CONSUME(Ident);    // c
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

  describe('or: backtracking', () => {
    test('backtracks to next alt when first alt fails', () => {
      const p = new RecursiveDescentParser();
      // Stream: Number Plus
      p.input = [tok(NumberTok, '42', 0), tok(Plus, '+', 3)];

      const result = p.OR([
        { ALT: () => {
          // This alt tries to consume Ident — will fail
          p.CONSUME(Ident);
          return 'ident';
        } },
        { ALT: () => {
          // This alt consumes Number — will succeed
          p.CONSUME(NumberTok);
          return 'number';
        } }
      ]);
      expect(result).toBe('number');
      expect(p.LA(1).image).toBe('+');
    });

    test('backtracks restore position on failed alt', () => {
      const p = new RecursiveDescentParser();
      // Stream: Number Plus Number
      p.input = [tok(NumberTok, '1', 0), tok(Plus, '+', 2), tok(NumberTok, '2', 4)];

      const result = p.OR([
        { ALT: () => {
          // Consume Number, then try Star — fails after consuming 1 token
          p.CONSUME(NumberTok);
          p.CONSUME(Star);
          return 'mul';
        } },
        { ALT: () => {
          // Consume Number, then Plus — succeeds
          const a = p.CONSUME(NumberTok);
          p.CONSUME(Plus);
          const b = p.CONSUME(NumberTok);
          return `${a.image}+${b.image}`;
        } }
      ]);
      expect(result).toBe('1+2');
    });

    test('backtracking works with recoveryEnabled', () => {
      const p = new RecursiveDescentParser({ recoveryEnabled: true });
      p.input = [tok(NumberTok, '42', 0), tok(Plus, '+', 3)];

      // With recovery, or() disables recovery during backtracking
      // so the first alt properly fails and backtracks
      const result = p.OR([
        { ALT: () => {
          p.CONSUME(Ident);  // fails — should NOT recover, should backtrack
          return 'ident';
        } },
        { ALT: () => {
          p.CONSUME(NumberTok);
          return 'number';
        } }
      ]);
      expect(result).toBe('number');
      expect(p.errors).toHaveLength(0);
    });
  });

  describe('error recovery', () => {
    test('recovers from mismatched token and records error', () => {
      const p = new RecursiveDescentParser({ recoveryEnabled: true });
      // Stream: Plus Number — expect Number first
      p.input = [tok(Plus, '+', 0), tok(NumberTok, '42', 2)];

      const t = p.CONSUME(NumberTok);
      // Recovery: single-token deletion skips Plus, returns Number
      expect(t.image).toBe('42');
      expect(p.errors).toHaveLength(1);
      expect(p.errors[0]).toBeInstanceOf(MismatchedTokenError);
    });

    test('error includes expected token type', () => {
      const p = new RecursiveDescentParser({ recoveryEnabled: true });
      p.input = [tok(Plus, '+', 0), tok(NumberTok, '42', 2)];

      p.CONSUME(NumberTok);
      const err = p.errors[0]!;
      expect(err.expected).toBe(NumberTok);
      expect(err.token.image).toBe('+');
    });

    test('error includes rule stack context', () => {
      const p = new RecursiveDescentParser({ recoveryEnabled: true });
      p.input = [tok(Plus, '+', 0), tok(Ident, 'x', 2)];

      function outerRule(this: RecursiveDescentParser) {
        return this.SUBRULE(innerRule);
      }
      function innerRule(this: RecursiveDescentParser) {
        return this.CONSUME(NumberTok);
      }

      p.SUBRULE(outerRule);
      const err = p.errors[0]!;
      expect(err.ruleStack).toContain('outerRule');
      expect(err.ruleStack).toContain('innerRule');
    });

    test('NoViableAltError on or() with all gates failing and recovery', () => {
      const p = new RecursiveDescentParser({ recoveryEnabled: true });
      p.input = [tok(Star, '*', 0)];

      const result = p.OR([
        { GATE: () => false, ALT: () => 'a' },
        { GATE: () => false, ALT: () => 'b' }
      ]);
      expect(result).toBeUndefined();
      expect(p.errors).toHaveLength(1);
      expect(p.errors[0]).toBeInstanceOf(NoViableAltError);
    });

    test('or() with recovery records error from failed last alt', () => {
      const p = new RecursiveDescentParser({ recoveryEnabled: true });
      // Stream: Star — neither Ident nor Number
      p.input = [tok(Star, '*', 0)];

      const result = p.OR([
        { ALT: () => {
          p.CONSUME(Ident);
          return 'ident';
        } },
        { ALT: () => {
          p.CONSUME(NumberTok);
          return 'number';
        } }
      ]);
      // Last alt commits with recovery — consume inserts virtual token
      // and records an error, allowing the alt to complete
      expect(result).toBe('number');
      expect(p.errors.length).toBeGreaterThanOrEqual(1);
      expect(p.errors[0]).toBeInstanceOf(MismatchedTokenError);
    });

    test('recovery does not cause infinite loops in many()', () => {
      const p = new RecursiveDescentParser({ recoveryEnabled: true });
      // Stream: Star — can't be consumed as Number
      p.input = [tok(Star, '*', 0), tok(Plus, '+', 2)];

      const items: string[] = [];
      // many() should exit when no progress is made, even with recovery.
      // First iteration: consume(NumberTok) recovers with virtual token (no pos advance).
      // many() detects pos didn't advance → exits after 1 iteration.
      p.MANY(() => {
        items.push(p.CONSUME(NumberTok).image);
      });
      // At most 1 iteration (recovery inserts virtual), then many() exits
      expect(items.length).toBeLessThanOrEqual(1);
      // Position unchanged — virtual token didn't advance
      expect(p.LA(1).image).toBe('*');
    });
  });

  describe('ParseError is lightweight (no stack traces)', () => {
    test('ParseError does not extend Error', () => {
      const err = new ParseError('test', tok(NumberTok, '42', 0));
      expect(err).toBeInstanceOf(ParseError);
      expect(err).not.toBeInstanceOf(Error);
    });

    test('MismatchedTokenError is a ParseError', () => {
      const err = new MismatchedTokenError(tok(Plus, '+', 0), NumberTok, ['rule1']);
      expect(err).toBeInstanceOf(MismatchedTokenError);
      expect(err).toBeInstanceOf(ParseError);
      expect(err).not.toBeInstanceOf(Error);
    });

    test('NoViableAltError is a ParseError', () => {
      const err = new NoViableAltError(tok(Plus, '+', 0), ['rule1']);
      expect(err).toBeInstanceOf(NoViableAltError);
      expect(err).toBeInstanceOf(ParseError);
      expect(err).not.toBeInstanceOf(Error);
    });

    test('ParseError has no stack property', () => {
      const err = new ParseError('test', tok(NumberTok, '42', 0));
      expect('stack' in err).toBe(false);
    });

    test('errors from backtracking are caught correctly', () => {
      const p = new RecursiveDescentParser();
      p.input = [tok(NumberTok, '42', 0)];

      // or() backtracking catches ParseError (not Error) via instanceof
      const result = p.OR([
        { ALT: () => {
          p.CONSUME(Ident);
          return 'ident';
        } },
        { ALT: () => {
          p.CONSUME(NumberTok);
          return 'number';
        } }
      ]);
      expect(result).toBe('number');
    });
  });

  describe('error messages', () => {
    test('MismatchedTokenError describes expected vs actual', () => {
      const err = new MismatchedTokenError(tok(Plus, '+', 0), NumberTok, []);
      expect(err.message).toContain('Number');
      expect(err.message).toContain('+');
    });

    test('MismatchedTokenError uses LABEL when available', () => {
      const LabeledToken: TokenType = { name: 'Semicolon', LABEL: ';' };
      const err = new MismatchedTokenError(tok(Plus, '+', 0), LabeledToken, []);
      expect(err.message).toContain(';');
    });

    test('NoViableAltError includes token image', () => {
      const err = new NoViableAltError(tok(Star, '*', 5), ['stylesheet', 'declaration']);
      expect(err.message).toContain('*');
      expect(err.ruleStack).toEqual(['stylesheet', 'declaration']);
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
        this.MANY(() => {
          const op = this.OR([
            { GATE: () => this.check(Plus), ALT: () => this.CONSUME(Plus).image },
            { GATE: () => this.check(Minus), ALT: () => this.CONSUME(Minus).image }
          ]);
          const right = this.term();
          left = op === '+' ? left + right : left - right;
        });
        return left;
      }

      term(): number {
        return parseInt(this.CONSUME(NumberTok).image, 10);
      }
    }

    test('parses simple addition', () => {
      const p = new ExprParser();
      p.input = [
        tok(NumberTok, '1', 0),
        tok(Plus, '+', 2),
        tok(NumberTok, '2', 4),
        tok(Plus, '+', 6),
        tok(NumberTok, '3', 8)
      ];
      expect(p.expr()).toBe(6);
    });

    test('parses mixed operators', () => {
      const p = new ExprParser();
      p.input = [
        tok(NumberTok, '10', 0),
        tok(Minus, '-', 3),
        tok(NumberTok, '3', 5),
        tok(Plus, '+', 7),
        tok(NumberTok, '1', 9)
      ];
      expect(p.expr()).toBe(8);
    });
  });
});
