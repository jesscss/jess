import { describe, expect, test } from 'vitest';
import {
  ScannerCursor,
  SourceText,
  collectScannerStats,
  recoverToNextBoundary,
  renderParserDiagnostic,
  scanBalancedDelimited,
  scanBlockComment,
  scanInterpolationShell,
  scanLineComment,
  scanString,
  scanTriviaInto,
  type ParserDiagnostic,
  type TriviaRun
} from '../index.js';

describe('ScannerCursor', () => {
  test('moves by offsets and reads char codes without allocating tokens', () => {
    const cursor = new ScannerCursor('a{}');

    expect(cursor.offset).toBe(0);
    expect(cursor.peekCode()).toBe('a'.charCodeAt(0));
    expect(cursor.peekCode(1)).toBe('{'.charCodeAt(0));
    expect(cursor.advance()).toBe(1);
    expect(cursor.consume('{}')).toBe(true);
    expect(cursor.eof()).toBe(true);
  });
});

describe('scanner performance guard stats', () => {
  test('reports scanner event counts without forcing source line maps', () => {
    const source = new SourceText('/* hi */\n// lead\n{ content: "{x}"; } "loose" bad(;');
    const stats = collectScannerStats(source, { lineComments: true });

    expect(source.hasLineMap).toBe(false);
    expect(stats).toMatchObject({
      inputBytes: new TextEncoder().encode(source.text).byteLength,
      inputLength: source.length,
      triviaRanges: 6,
      delimiterScans: 1,
      stringScans: 1,
      commentScans: 2,
      recoveryScans: 1,
      diagnostics: 0
    });
  });
});

describe('scanner diagnostics', () => {
  test('renders diagnostic line and column from source offsets lazily', () => {
    const source = new SourceText('a\n  @', 'style.less');
    const diagnostic: ParserDiagnostic = {
      code: 'expected-ident',
      severity: 'error',
      message: 'Expected identifier.',
      start: 4,
      end: 5,
      expected: 'identifier',
      actual: '@',
      context: 'declaration'
    };

    expect(source.hasLineMap).toBe(false);
    expect(renderParserDiagnostic(source, diagnostic)).toMatchObject({
      filePath: 'style.less',
      line: 2,
      column: 3,
      endLine: 2,
      endColumn: 4,
      expected: 'identifier',
      actual: '@'
    });
    expect(source.hasLineMap).toBe(true);
  });
});

describe('string scanning', () => {
  test('scans quoted strings with escaped quotes', () => {
    const diagnostics: ParserDiagnostic[] = [];
    const cursor = new ScannerCursor(String.raw`"a\"b" tail`);
    const result = scanString(cursor, diagnostics);

    expect(result).toEqual({
      kind: 'string',
      quote: '"',
      start: 0,
      end: 6,
      contentStart: 1,
      contentEnd: 5,
      closed: true
    });
    expect(cursor.offset).toBe(6);
    expect(diagnostics).toEqual([]);
  });

  test('reports unterminated strings without throwing', () => {
    const diagnostics: ParserDiagnostic[] = [];
    const cursor = new ScannerCursor('\'abc');
    const result = scanString(cursor, diagnostics);

    expect(result).toMatchObject({
      start: 0,
      end: 4,
      contentStart: 1,
      contentEnd: 4,
      closed: false
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'unterminated-string',
        expected: '\'',
        actual: 'end of file',
        context: 'string'
      })
    ]);
  });
});

describe('comment and trivia scanning', () => {
  test('scans line comments without consuming the newline', () => {
    const cursor = new ScannerCursor('// hi\n.next');

    expect(scanLineComment(cursor)).toEqual({
      start: 0,
      end: 5,
      kind: 'line-comment',
      closed: true
    });
    expect(cursor.peekCode()).toBe('\n'.charCodeAt(0));
  });

  test('reports unterminated block comments without throwing', () => {
    const diagnostics: ParserDiagnostic[] = [];
    const cursor = new ScannerCursor('/* open');

    expect(scanBlockComment(cursor, diagnostics)).toEqual({
      start: 0,
      end: 7,
      kind: 'block-comment',
      closed: false
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'unterminated-block-comment',
        expected: '*/',
        actual: 'end of file'
      })
    ]);
  });

  test('scans whitespace, newlines, and comments into trivia ranges', () => {
    const diagnostics: ParserDiagnostic[] = [];
    const cursor = new ScannerCursor(' \t\r\n// hi\n/* ok */x');
    const trivia: TriviaRun[] = [];

    scanTriviaInto(cursor, trivia, diagnostics, { lineComments: true });

    expect(trivia).toEqual([
      { start: 0, end: 2, kind: 'whitespace' },
      { start: 2, end: 4, kind: 'newline' },
      { start: 4, end: 9, kind: 'line-comment', closed: true },
      { start: 9, end: 10, kind: 'newline' },
      { start: 10, end: 18, kind: 'block-comment', closed: true }
    ]);
    expect(cursor.offset).toBe(18);
    expect(cursor.peekCode()).toBe('x'.charCodeAt(0));
    expect(diagnostics).toEqual([]);
  });
});

describe('delimiter scanning and recovery', () => {
  test('scans balanced delimiters across nested blocks, strings, and comments', () => {
    const diagnostics: ParserDiagnostic[] = [];
    const text = '{ color: "{;}" /* } */ nested: (a[0]); } tail';
    const cursor = new ScannerCursor(text);
    const closeStart = text.indexOf(' } tail') + 1;
    const closeEnd = closeStart + 1;

    expect(scanBalancedDelimited(cursor, diagnostics)).toEqual({
      start: 0,
      end: closeEnd,
      contentStart: 1,
      contentEnd: closeStart,
      openStart: 0,
      openEnd: 1,
      closeStart,
      closeEnd,
      closed: true
    });
    expect(cursor.offset).toBe(closeEnd);
    expect(cursor.source.slice(cursor.offset)).toBe(' tail');
    expect(diagnostics).toEqual([]);
  });

  test('does not close on braces inside strings, comments, url(), or custom property blocks', () => {
    const diagnostics: ParserDiagnostic[] = [];
    const text = '{ content: "}"; /* } */ background: url(/a}/b); --raw: { token: "}"; }; } tail';
    const cursor = new ScannerCursor(text);
    const closeStart = text.indexOf(' } tail') + 1;
    const closeEnd = closeStart + 1;

    expect(scanBalancedDelimited(cursor, diagnostics)).toEqual({
      start: 0,
      end: closeEnd,
      contentStart: 1,
      contentEnd: closeStart,
      openStart: 0,
      openEnd: 1,
      closeStart,
      closeEnd,
      closed: true
    });
    expect(cursor.offset).toBe(closeEnd);
    expect(diagnostics).toEqual([]);
  });

  test('keeps unquoted url payload delimiters raw while scanning outer blocks', () => {
    const diagnostics: ParserDiagnostic[] = [];
    const text = String.raw`{ background: url(data:image/svg+xml,<svg>{x}</svg>); font: url(http://x.test?family=\(400\),700); } tail`;
    const cursor = new ScannerCursor(text);
    const closeStart = text.indexOf(' } tail') + 1;
    const closeEnd = closeStart + 1;

    expect(scanBalancedDelimited(cursor, diagnostics)).toEqual({
      start: 0,
      end: closeEnd,
      contentStart: 1,
      contentEnd: closeStart,
      openStart: 0,
      openEnd: 1,
      closeStart,
      closeEnd,
      closed: true
    });
    expect(cursor.offset).toBe(closeEnd);
    expect(diagnostics).toEqual([]);
  });

  test('reports unclosed delimiters without throwing', () => {
    const diagnostics: ParserDiagnostic[] = [];
    const cursor = new ScannerCursor('(a[0]');

    expect(scanBalancedDelimited(cursor, diagnostics)).toEqual({
      start: 0,
      end: 5,
      contentStart: 1,
      contentEnd: 5,
      openStart: 0,
      openEnd: 1,
      closeStart: 5,
      closeEnd: 5,
      closed: false
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'unterminated-delimited-block',
        expected: ')',
        actual: 'end of file'
      })
    ]);
  });

  test('recovers to semicolon after malformed statement content', () => {
    const cursor = new ScannerCursor('bad("still; string"); next');

    expect(recoverToNextBoundary(cursor)).toEqual({
      start: 0,
      end: 21,
      boundary: 'statement'
    });
    expect(cursor.slice(cursor.offset, cursor.length)).toBe(' next');
  });

  test('recovers to block close without consuming it', () => {
    const cursor = new ScannerCursor('bad(value) } .next');

    expect(recoverToNextBoundary(cursor)).toEqual({
      start: 0,
      end: 11,
      boundary: 'block-close'
    });
    expect(cursor.peekCode()).toBe('}'.charCodeAt(0));
  });
});

describe('interpolation shell scanning', () => {
  test('scans configured interpolation shells and chooses the longest start', () => {
    const diagnostics: ParserDiagnostic[] = [];
    const cursor = new ScannerCursor('${name + "#{nested}"} tail');

    expect(scanInterpolationShell(cursor, diagnostics, ['$', '${', '#{'])).toEqual({
      start: 0,
      end: 21,
      contentStart: 2,
      contentEnd: 20,
      openStart: 1,
      openEnd: 2,
      closeStart: 20,
      closeEnd: 21,
      startSequence: '${',
      closed: true
    });
    expect(cursor.offset).toBe(21);
    expect(diagnostics).toEqual([]);
  });

  test('reports unterminated interpolation shells without throwing', () => {
    const diagnostics: ParserDiagnostic[] = [];
    const cursor = new ScannerCursor('#{color');

    expect(scanInterpolationShell(cursor, diagnostics, ['#{'])).toEqual({
      start: 0,
      end: 7,
      contentStart: 2,
      contentEnd: 7,
      openStart: 1,
      openEnd: 2,
      closeStart: 7,
      closeEnd: 7,
      startSequence: '#{',
      closed: false
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'unterminated-interpolation',
        expected: '}',
        actual: 'end of file',
        context: 'interpolation'
      })
    ]);
  });
});
