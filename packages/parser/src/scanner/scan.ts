import { SourceText, delimitedSpan, type DelimitedSpan, type TriviaRun } from '../source/index.js';
import { ScannerCursor } from './cursor.js';
import {
  createParserDiagnostic,
  type ParserDiagnostic
} from './diagnostics.js';

/** Mutable diagnostic collection shared by scanner helpers during a pass. */
export type DiagnosticSink = ParserDiagnostic[];

/** Result of scanning a quoted string, including unterminated recovery state. */
export type StringScanResult = {
  kind: 'string';
  quote: '"' | '\'';
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  closed: boolean;
};

/** Result of scanning either line or block comments as trivia. */
export type CommentScanResult = TriviaRun & {
  closed: boolean;
};

/** Result of scanning balanced delimiter content with closure state. */
export type DelimitedScanResult = DelimitedSpan & {
  closed: boolean;
};

/** Result of scanning a configured interpolation shell. */
export type InterpolationShellScanResult = DelimitedSpan & {
  startSequence: string;
  closed: boolean;
};

/** Structural recovery boundary reached after malformed input. */
export type RecoveryBoundary = 'statement' | 'block-close' | 'eof';

/** Span skipped during recovery and the boundary that stopped scanning. */
export type RecoveryResult = {
  start: number;
  end: number;
  boundary: RecoveryBoundary;
};

/** Trivia scanning options supplied by the active language profile/parser. */
export type ScanTriviaOptions = {
  lineComments?: boolean;
};

/** Cold scanner report used by performance guard tests and diagnostics. */
export type ScannerStats = {
  readonly inputBytes: number;
  readonly inputLength: number;
  readonly triviaRanges: number;
  readonly delimiterScans: number;
  readonly stringScans: number;
  readonly commentScans: number;
  readonly recoveryScans: number;
  readonly diagnostics: number;
};

/**
 * Collects scanner event counts in a detached pass.
 *
 * This is intentionally not wired into the structural parser hot path. It
 * exists for performance guards that need stable counts for trivia, delimiter,
 * string/comment, and recovery behavior without allocating compiler AST nodes.
 */
export function collectScannerStats(
  source: ScannerCursor | SourceText | string,
  options: ScanTriviaOptions = {}
): ScannerStats {
  const cursor = source instanceof ScannerCursor
    ? new ScannerCursor(source.source)
    : new ScannerCursor(source);
  const diagnostics: ParserDiagnostic[] = [];
  const trivia: TriviaRun[] = [];
  let delimiterScans = 0;
  let stringScans = 0;
  let commentScans = 0;
  let recoveryScans = 0;

  while (!cursor.eof()) {
    const triviaStart = trivia.length;
    scanTriviaInto(cursor, trivia, diagnostics, options);
    for (let i = triviaStart; i < trivia.length; i++) {
      const run = trivia[i]!;
      if (run.kind === 'block-comment' || run.kind === 'line-comment') {
        commentScans++;
      }
    }
    if (cursor.eof()) {
      break;
    }
    if (scanString(cursor, diagnostics)) {
      stringScans++;
      continue;
    }
    if (scanBlockComment(cursor, diagnostics)) {
      commentScans++;
      continue;
    }
    if (options.lineComments && scanLineComment(cursor)) {
      commentScans++;
      continue;
    }
    const code = cursor.peekCode();
    if (code === Char.OpenBrace || code === Char.OpenParen || code === Char.OpenBracket) {
      if (scanBalancedDelimited(cursor, diagnostics)) {
        delimiterScans++;
        continue;
      }
    }
    if (code === Char.Semicolon || code === Char.CloseBrace) {
      cursor.advance();
      continue;
    }
    recoverToNextBoundary(cursor);
    recoveryScans++;
    if (!cursor.eof() && (cursor.peekCode() === Char.Semicolon || cursor.peekCode() === Char.CloseBrace)) {
      cursor.advance();
    }
  }

  return {
    inputBytes: new TextEncoder().encode(cursor.source.text).byteLength,
    inputLength: cursor.source.length,
    triviaRanges: trivia.length,
    delimiterScans,
    stringScans,
    commentScans,
    recoveryScans,
    diagnostics: diagnostics.length
  };
}

/**
 * Scans a quoted string and records unterminated strings without throwing.
 *
 * The cursor is always advanced through the recovery span so callers can keep
 * building a partial structural tree after malformed input.
 */
export function scanString(
  cursor: ScannerCursor,
  diagnostics: DiagnosticSink
): StringScanResult | undefined {
  const quoteCode = cursor.peekCode();
  if (quoteCode !== Char.DoubleQuote && quoteCode !== Char.SingleQuote) {
    return undefined;
  }

  const quote = quoteCode === Char.DoubleQuote ? '"' : '\'';
  const start = cursor.offset;
  cursor.advance();
  const contentStart = cursor.offset;
  let contentEnd = cursor.offset;

  while (!cursor.eof()) {
    const code = cursor.peekCode();

    if (code === quoteCode) {
      contentEnd = cursor.offset;
      cursor.advance();
      return {
        kind: 'string',
        quote,
        start,
        end: cursor.offset,
        contentStart,
        contentEnd,
        closed: true
      };
    }

    if (code === Char.Backslash) {
      cursor.advance();
      if (!cursor.eof()) {
        cursor.advance();
      }
      continue;
    }

    cursor.advance();
    contentEnd = cursor.offset;
  }

  diagnostics.push(
    createParserDiagnostic({
      code: 'unterminated-string',
      message: `Unterminated ${quote} string.`,
      start,
      end: cursor.offset,
      expected: quote,
      actual: 'end of file',
      context: 'string'
    })
  );

  return {
    kind: 'string',
    quote,
    start,
    end: cursor.offset,
    contentStart,
    contentEnd,
    closed: false
  };
}

/** Scans `//` comments when the active language profile enables them. */
export function scanLineComment(
  cursor: ScannerCursor
): CommentScanResult | undefined {
  if (!cursor.match('//')) {
    return undefined;
  }

  const start = cursor.offset;
  cursor.advance(2);

  while (!cursor.eof() && !isNewlineCode(cursor.peekCode())) {
    cursor.advance();
  }

  return {
    start,
    end: cursor.offset,
    kind: 'line-comment',
    closed: true
  };
}

/**
 * Scans block comments and reports EOF recovery as a diagnostic.
 *
 * Unclosed comments are still returned as trivia so ownership of the consumed
 * source range remains explicit.
 */
export function scanBlockComment(
  cursor: ScannerCursor,
  diagnostics: DiagnosticSink
): CommentScanResult | undefined {
  if (!cursor.match('/*')) {
    return undefined;
  }

  const start = cursor.offset;
  cursor.advance(2);

  while (!cursor.eof()) {
    if (cursor.match('*/')) {
      cursor.advance(2);
      return {
        start,
        end: cursor.offset,
        kind: 'block-comment',
        closed: true
      };
    }
    cursor.advance();
  }

  diagnostics.push(
    createParserDiagnostic({
      code: 'unterminated-block-comment',
      message: 'Unterminated block comment.',
      start,
      end: cursor.offset,
      expected: '*/',
      actual: 'end of file',
      context: 'comment'
    })
  );

  return {
    start,
    end: cursor.offset,
    kind: 'block-comment',
    closed: false
  };
}

/**
 * Scans a nested parenthesis/bracket/brace island as raw balanced text.
 *
 * Strings and comments are skipped as opaque ranges so delimiter recovery does
 * not mistake their contents for syntax.
 */
export function scanBalancedDelimited(
  cursor: ScannerCursor,
  diagnostics: DiagnosticSink,
  openCode: number = cursor.peekCode()
): DelimitedScanResult | undefined {
  const closeCode = matchingCloseCode(openCode);
  if (closeCode === -1 || cursor.peekCode() !== openCode) {
    return undefined;
  }
  if (openCode === Char.OpenParen && isUrlFunctionOpenParen(cursor)) {
    return scanUrlPayloadDelimited(cursor, diagnostics);
  }

  const start = cursor.offset;
  const openEnd = start + 1;
  const stack: number[] = [closeCode];
  cursor.advance();

  while (!cursor.eof()) {
    if (scanString(cursor, diagnostics)) {
      continue;
    }
    if (scanBlockComment(cursor, diagnostics)) {
      continue;
    }
    if (scanLineComment(cursor)) {
      continue;
    }

    const code = cursor.peekCode();
    if (code === Char.OpenParen && scanUrlPayloadDelimited(cursor, diagnostics)) {
      continue;
    }

    const nestedClose = matchingCloseCode(code);
    if (nestedClose !== -1) {
      stack.push(nestedClose);
      cursor.advance();
      continue;
    }

    const expectedClose = stack[stack.length - 1]!;
    if (code === expectedClose) {
      stack.pop();
      cursor.advance();
      if (stack.length === 0) {
        return {
          ...delimitedSpan(
            start,
            cursor.offset,
            openEnd,
            cursor.offset - 1,
            start,
            openEnd,
            cursor.offset - 1,
            cursor.offset
          ),
          closed: true
        };
      }
      continue;
    }

    cursor.advance();
  }

  diagnostics.push(
    createParserDiagnostic({
      code: 'unterminated-delimited-block',
      message: `Unterminated ${String.fromCharCode(openCode)} block.`,
      start,
      end: cursor.offset,
      expected: String.fromCharCode(stack[stack.length - 1]!),
      actual: 'end of file',
      context: 'delimiter'
    })
  );

  return {
    ...delimitedSpan(start, cursor.offset, openEnd, cursor.offset, start, openEnd, cursor.offset, cursor.offset),
    closed: false
  };
}

/**
 * Skips the parenthesized payload of a CSS `url(...)` function.
 *
 * Unquoted URL payloads are not generic component-value syntax: braces,
 * brackets, and escaped parens may be ordinary URL characters. Treating them
 * as nested delimiters creates false structural diagnostics for data URIs and
 * font URLs before any language-specific value parser has asked for details.
 */
function scanUrlPayloadDelimited(
  cursor: ScannerCursor,
  diagnostics: DiagnosticSink
): DelimitedScanResult | undefined {
  if (!isUrlFunctionOpenParen(cursor)) {
    return undefined;
  }

  const start = cursor.offset;
  const openEnd = start + 1;
  cursor.advance();

  while (!cursor.eof()) {
    if (scanString(cursor, diagnostics)) {
      continue;
    }

    const code = cursor.peekCode();
    if (code === Char.CloseParen) {
      cursor.advance();
      return {
        ...delimitedSpan(
          start,
          cursor.offset,
          openEnd,
          cursor.offset - 1,
          start,
          openEnd,
          cursor.offset - 1,
          cursor.offset
        ),
        closed: true
      };
    }

    if (code === Char.Backslash) {
      cursor.advance();
      if (!cursor.eof()) {
        cursor.advance();
      }
      continue;
    }

    cursor.advance();
  }

  diagnostics.push(
    createParserDiagnostic({
      code: 'unterminated-delimited-block',
      message: 'Unterminated url( block.',
      start,
      end: cursor.offset,
      expected: ')',
      actual: 'end of file',
      context: 'delimiter'
    })
  );

  return {
    ...delimitedSpan(start, cursor.offset, openEnd, cursor.offset, start, openEnd, cursor.offset, cursor.offset),
    closed: false
  };
}

function isUrlFunctionOpenParen(cursor: ScannerCursor): boolean {
  if (cursor.peekCode() !== Char.OpenParen || cursor.offset < 3) {
    return false;
  }

  const uOffset = cursor.offset - 3;
  return (
    isCodeUnit(cursor.codeAt(uOffset), Char.LowerU, Char.UpperU)
    && isCodeUnit(cursor.codeAt(uOffset + 1), Char.LowerR, Char.UpperR)
    && isCodeUnit(cursor.codeAt(uOffset + 2), Char.LowerL, Char.UpperL)
    && !isIdentifierCode(cursor.codeAt(uOffset - 1))
  );
}

/**
 * Scans interpolation shells such as `#{...}` or `@{...}`.
 *
 * The longest configured start sequence wins, which lets profiles add richer
 * interpolation forms without changing scanner control flow.
 */
export function scanInterpolationShell(
  cursor: ScannerCursor,
  diagnostics: DiagnosticSink,
  startSequences: readonly string[]
): InterpolationShellScanResult | undefined {
  const startSequence = findInterpolationStart(cursor, startSequences);
  if (!startSequence) {
    return undefined;
  }

  const openCode = startSequence.charCodeAt(startSequence.length - 1);
  const closeCode = matchingCloseCode(openCode);
  if (closeCode === -1) {
    throw new RangeError(
      `Interpolation start "${startSequence}" must end with (, [, or {.`
    );
  }

  const start = cursor.offset;
  const openStart = start + startSequence.length - 1;
  const openEnd = start + startSequence.length;
  const stack: number[] = [closeCode];
  cursor.advance(startSequence.length);

  while (!cursor.eof()) {
    if (scanString(cursor, diagnostics)) {
      continue;
    }
    if (scanBlockComment(cursor, diagnostics)) {
      continue;
    }
    if (scanLineComment(cursor)) {
      continue;
    }

    const code = cursor.peekCode();
    const nestedClose = matchingCloseCode(code);
    if (nestedClose !== -1) {
      stack.push(nestedClose);
      cursor.advance();
      continue;
    }

    const expectedClose = stack[stack.length - 1]!;
    if (code === expectedClose) {
      stack.pop();
      cursor.advance();
      if (stack.length === 0) {
        return {
          ...delimitedSpan(
            start,
            cursor.offset,
            openEnd,
            cursor.offset - 1,
            openStart,
            openEnd,
            cursor.offset - 1,
            cursor.offset
          ),
          startSequence,
          closed: true
        };
      }
      continue;
    }

    cursor.advance();
  }

  diagnostics.push(
    createParserDiagnostic({
      code: 'unterminated-interpolation',
      message: `Unterminated ${startSequence} interpolation.`,
      start,
      end: cursor.offset,
      expected: String.fromCharCode(stack[stack.length - 1]!),
      actual: 'end of file',
      context: 'interpolation'
    })
  );

  return {
    ...delimitedSpan(start, cursor.offset, openEnd, cursor.offset, openStart, openEnd, cursor.offset, cursor.offset),
    startSequence,
    closed: false
  };
}

/**
 * Appends contiguous trivia runs at the current cursor position.
 *
 * The structural parser keeps trivia out of the node tree; callers that need
 * formatting or comments retain them through this side list.
 */
export function scanTriviaInto(
  cursor: ScannerCursor,
  trivia: TriviaRun[],
  diagnostics: DiagnosticSink,
  options: ScanTriviaOptions = {}
): void {
  while (!cursor.eof()) {
    const start = cursor.offset;
    const code = cursor.peekCode();

    if (isHorizontalWhitespaceCode(code)) {
      cursor.advance();
      while (!cursor.eof() && isHorizontalWhitespaceCode(cursor.peekCode())) {
        cursor.advance();
      }
      trivia.push({ start, end: cursor.offset, kind: 'whitespace' });
      continue;
    }

    if (isNewlineCode(code)) {
      scanNewline(cursor);
      trivia.push({ start, end: cursor.offset, kind: 'newline' });
      continue;
    }

    const blockComment = scanBlockComment(cursor, diagnostics);
    if (blockComment) {
      trivia.push(blockComment);
      continue;
    }

    if (options.lineComments) {
      const lineComment = scanLineComment(cursor);
      if (lineComment) {
        trivia.push(lineComment);
        continue;
      }
    }

    return;
  }
}

/**
 * Advances past malformed input to the next statement, block close, or EOF.
 *
 * Delimited subranges are skipped so a stray semicolon inside `(...)` does not
 * prematurely end recovery.
 */
export function recoverToNextBoundary(cursor: ScannerCursor): RecoveryResult {
  const start = cursor.offset;
  const delimiterStack: number[] = [];

  while (!cursor.eof()) {
    const diagnostics: ParserDiagnostic[] = [];
    if (scanString(cursor, diagnostics)) {
      continue;
    }
    if (scanBlockComment(cursor, diagnostics)) {
      continue;
    }
    if (scanLineComment(cursor)) {
      continue;
    }

    const code = cursor.peekCode();
    const nestedClose = matchingCloseCode(code);
    if (nestedClose !== -1) {
      delimiterStack.push(nestedClose);
      cursor.advance();
      continue;
    }

    if (delimiterStack.length > 0 && code === delimiterStack[delimiterStack.length - 1]) {
      delimiterStack.pop();
      cursor.advance();
      continue;
    }

    if (delimiterStack.length === 0 && code === Char.Semicolon) {
      cursor.advance();
      return { start, end: cursor.offset, boundary: 'statement' };
    }

    if (delimiterStack.length === 0 && code === Char.CloseBrace) {
      return { start, end: cursor.offset, boundary: 'block-close' };
    }

    cursor.advance();
  }

  return { start, end: cursor.offset, boundary: 'eof' };
}

/** Consumes any CSS newline sequence supported by the scanner. */
export function scanNewline(cursor: ScannerCursor): boolean {
  const code = cursor.peekCode();
  if (code === Char.CarriageReturn) {
    cursor.advance();
    if (cursor.peekCode() === Char.LineFeed) {
      cursor.advance();
    }
    return true;
  }
  if (code === Char.LineFeed || code === Char.FormFeed) {
    cursor.advance();
    return true;
  }
  return false;
}

const enum Char {
  Backslash = 92,
  BlockCommentStart = 47,
  CarriageReturn = 13,
  CloseBrace = 125,
  CloseParen = 41,
  DoubleQuote = 34,
  FormFeed = 12,
  LineFeed = 10,
  LowerL = 108,
  LowerR = 114,
  LowerU = 117,
  OpenBrace = 123,
  OpenBracket = 91,
  OpenParen = 40,
  Semicolon = 59,
  SingleQuote = 39,
  Space = 32,
  Tab = 9,
  UpperL = 76,
  UpperR = 82,
  UpperU = 85
}

function isCodeUnit(code: number, lower: number, upper: number): boolean {
  return code === lower || code === upper;
}

function isIdentifierCode(code: number): boolean {
  return (
    (code >= 48 && code <= 57)
    || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || code === 45
    || code === 95
  );
}

function isHorizontalWhitespaceCode(code: number): boolean {
  return code === Char.Space || code === Char.Tab;
}

function isNewlineCode(code: number): boolean {
  return (
    code === Char.LineFeed
    || code === Char.CarriageReturn
    || code === Char.FormFeed
  );
}

function matchingCloseCode(openCode: number): number {
  switch (openCode) {
    case Char.OpenBrace:
      return 125;
    case Char.OpenParen:
      return 41;
    case Char.OpenBracket:
      return 93;
    default:
      return -1;
  }
}

function findInterpolationStart(
  cursor: ScannerCursor,
  startSequences: readonly string[]
): string | undefined {
  let best: string | undefined;

  for (const startSequence of startSequences) {
    if (
      cursor.match(startSequence)
      && (best === undefined || startSequence.length > best.length)
    ) {
      best = startSequence;
    }
  }

  return best;
}
