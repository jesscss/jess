/**
 * Tiny source-scanning helpers for scanner-first parser proofs.
 *
 * These functions deliberately return offsets only. Language packages decide
 * what AST nodes to create from the spans; this package only owns reusable
 * string/comment/delimiter walking.
 */

/** Return whether `code` is stylesheet source whitespace handled by cheap scanners. */
export function isSourceWhitespace(code: number): boolean {
  return code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
}

/** Skip whitespace and block comments from `offset` up to `end`. */
export function skipSourceTrivia(source: string, offset: number, end = source.length): number {
  let cursor = offset;
  while (cursor < end) {
    const code = source.charCodeAt(cursor);
    if (isSourceWhitespace(code)) {
      cursor++;
      continue;
    }
    if (source[cursor] === '/' && source[cursor + 1] === '*') {
      const commentEnd = source.indexOf('*/', cursor + 2);
      cursor = commentEnd === -1 || commentEnd >= end ? end : commentEnd + 2;
      continue;
    }
    break;
  }
  return cursor;
}

/**
 * Skip a single- or double-quoted source string from `offset`.
 *
 * Escaped characters are skipped as string contents. Unterminated strings stop
 * at `end`, so callers can keep scanning a bounded source slice without
 * allocating diagnostics in this helper.
 */
export function skipQuotedSourceString(source: string, offset: number, end = source.length): number {
  const quote = source[offset];
  let cursor = offset + 1;
  while (cursor < end) {
    const char = source[cursor];
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    cursor++;
    if (char === quote) {
      break;
    }
  }
  return cursor;
}

function skipBlockComment(source: string, offset: number, end: number): number {
  const commentEnd = source.indexOf('*/', offset + 2);
  return commentEnd === -1 || commentEnd >= end ? offset : commentEnd + 2;
}

function skipBlockCommentOutsideDelimiter(source: string, offset: number, end: number): number {
  const commentEnd = source.indexOf('*/', offset + 2);
  if (commentEnd === -1 || commentEnd >= end) {
    return end;
  }
  return commentEnd + 2;
}

function skipEscapedCharacter(offset: number): number {
  return offset + 2;
}

function isOpeningDelimiter(char: string): boolean {
  return char === '(' || char === '[';
}

function isClosingDelimiter(char: string): boolean {
  return char === ')' || char === ']';
}

function opensUrlFunction(source: string, openParenOffset: number): boolean {
  let cursor = openParenOffset - 1;
  if (cursor < 0 || isSourceWhitespace(source.charCodeAt(cursor))) {
    return false;
  }
  const end = cursor + 1;
  while (cursor >= 0) {
    const code = source.charCodeAt(cursor);
    const isNameCode = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 45;
    if (!isNameCode) {
      break;
    }
    cursor--;
  }
  return source.slice(cursor + 1, end).toLowerCase() === 'url';
}

/**
 * Find the next top-level `{`, ignoring strings, comments, escapes, and
 * brackets/parens before it.
 */
export function findTopLevelBlockStart(source: string, offset: number, end = source.length): number {
  let cursor = offset;
  let depth = 0;
  let urlDepth = 0;
  while (cursor < end) {
    const char = source[cursor];
    if (char === '\"' || char === '\'') {
      cursor = skipQuotedSourceString(source, cursor, end);
      continue;
    }
    if (char === '\\') {
      cursor = skipEscapedCharacter(cursor);
      continue;
    }
    if (char === '/' && source[cursor + 1] === '*') {
      const commentEnd = urlDepth > 0
        ? cursor
        : depth === 0
          ? skipBlockCommentOutsideDelimiter(source, cursor, end)
          : skipBlockComment(source, cursor, end);
      if (commentEnd !== cursor) {
        cursor = commentEnd;
        continue;
      }
    }
    if (isOpeningDelimiter(char)) {
      depth++;
      if (char === '(' && urlDepth === 0 && opensUrlFunction(source, cursor)) {
        urlDepth = depth;
      }
    } else if (isClosingDelimiter(char)) {
      if (char === ')' && depth === urlDepth) {
        urlDepth = 0;
      }
      depth = Math.max(0, depth - 1);
    } else if (char === '{' && depth === 0) {
      return cursor;
    }
    cursor++;
  }
  return -1;
}

/**
 * Find the matching `}` for a `{` at `blockStart`.
 *
 * `blockStart` must already point at an opening brace. This helper intentionally
 * trusts the caller so hot scanner paths do not repeat a check they just made.
 */
export function findBalancedBlockEnd(source: string, blockStart: number, end = source.length): number {
  let cursor = blockStart + 1;
  let depth = 1;
  let delimiterDepth = 0;
  let urlDepth = 0;
  while (cursor < end) {
    const char = source[cursor];
    if (char === '\"' || char === '\'') {
      cursor = skipQuotedSourceString(source, cursor, end);
      continue;
    }
    if (char === '\\') {
      cursor = skipEscapedCharacter(cursor);
      continue;
    }
    if (char === '/' && source[cursor + 1] === '*') {
      const commentEnd = urlDepth > 0
        ? cursor
        : delimiterDepth === 0
          ? skipBlockCommentOutsideDelimiter(source, cursor, end)
          : skipBlockComment(source, cursor, end);
      if (commentEnd !== cursor) {
        cursor = commentEnd;
        continue;
      }
    }
    if (char === '(' || char === '[') {
      delimiterDepth++;
      if (char === '(' && urlDepth === 0 && opensUrlFunction(source, cursor)) {
        urlDepth = delimiterDepth;
      }
    } else if (char === ')' || char === ']') {
      if (char === ')' && delimiterDepth === urlDepth) {
        urlDepth = 0;
      }
      delimiterDepth = Math.max(0, delimiterDepth - 1);
    } else if (char === '{' && delimiterDepth === 0) {
      depth++;
    } else if (char === '}' && delimiterDepth === 0) {
      depth--;
      if (depth === 0) {
        return cursor;
      }
    }
    cursor++;
  }
  return -1;
}

/**
 * Find one source character at delimiter-depth zero inside a span.
 *
 * `delimiterChar` is a single UTF-16 code unit such as `:`, `;`, or `,`.
 * Strings, comments, escaped characters, and balanced `()[]{}` contents are
 * skipped. Unmatched closing delimiters clamp depth at zero so recovery scans
 * can continue inside malformed slices.
 */
export function findTopLevelDelimiter(
  source: string,
  delimiterChar: string,
  start: number,
  end: number
): number {
  if (delimiterChar.length !== 1) {
    throw new TypeError('findTopLevelDelimiter expects a single-character delimiter.');
  }
  let cursor = start;
  let depth = 0;
  let urlDepth = 0;
  while (cursor < end) {
    const char = source[cursor];
    if (char === '\"' || char === '\'') {
      cursor = skipQuotedSourceString(source, cursor, end);
      continue;
    }
    if (char === '\\') {
      cursor = skipEscapedCharacter(cursor);
      continue;
    }
    if (char === '/' && source[cursor + 1] === '*') {
      const commentEnd = urlDepth > 0
        ? cursor
        : depth === 0
          ? skipBlockCommentOutsideDelimiter(source, cursor, end)
          : skipBlockComment(source, cursor, end);
      if (commentEnd !== cursor) {
        cursor = commentEnd;
        continue;
      }
    }
    if (char === '(' || char === '[' || char === '{') {
      depth++;
      if (char === '(' && urlDepth === 0 && opensUrlFunction(source, cursor)) {
        urlDepth = depth;
      }
    } else if (char === ')' || char === ']' || char === '}') {
      if (char === ')' && depth === urlDepth) {
        urlDepth = 0;
      }
      depth = Math.max(0, depth - 1);
    } else if (char === delimiterChar && depth === 0) {
      return cursor;
    }
    cursor++;
  }
  return -1;
}

/** Find the first top-level semicolon in a statement span, or return `end`. */
export function findStatementEnd(source: string, start: number, end: number): number {
  const semi = findTopLevelDelimiter(source, ';', start, end);
  return semi === -1 ? end : semi;
}
