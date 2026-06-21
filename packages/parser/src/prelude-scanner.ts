import {
  isSourceWhitespace,
  skipQuotedSourceString,
  skipSourceTrivia,
  type SourceScannerOptions
} from './source-scanner.js';

/**
 * A cheap at-rule prelude token that can be materialized by a language parser.
 *
 * Bare words stay strings. Parenthesized atoms keep only their inner text in a
 * tuple so the shared parser package does not import core node constructors.
 */
export type CheapAtRulePreludeToken = string | readonly ['paren', string];

function isCheapPreludeNameCode(code: number): boolean {
  return (
    (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || (code >= 48 && code <= 57)
    || code === 45
    || code === 95
  );
}

function isCheapPreludeAtomText(text: string): boolean {
  if (!text) {
    return false;
  }
  for (let i = 0; i < text.length; i++) {
    if (!isCheapPreludeNameCode(text.charCodeAt(i))) {
      return false;
    }
  }
  return true;
}

function isCheapParenPreludeText(text: string): boolean {
  if (!text) {
    return false;
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const code = text.charCodeAt(i);
    if (
      isCheapPreludeNameCode(code)
      || code === 32
      || code === 9
      || code === 10
      || code === 13
      || code === 12
      || char === ':'
      || char === '.'
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function scanParenthesizedPreludeToken(text: string): CheapAtRulePreludeToken | undefined {
  if (text.length < 2 || text[0] !== '(' || text[text.length - 1] !== ')') {
    return undefined;
  }
  const inner = text.slice(1, -1).trim();
  return isCheapParenPreludeText(inner) ? ['paren', inner] : undefined;
}

function readPreludeToken(
  source: string,
  start: number,
  options?: SourceScannerOptions
): [token: string, next: number] | undefined {
  let cursor = skipSourceTrivia(source, start, source.length, options);
  if (cursor >= source.length) {
    return undefined;
  }
  if (source[cursor] !== '(') {
    const tokenStart = cursor;
    while (cursor < source.length) {
      const code = source.charCodeAt(cursor);
      if (isSourceWhitespace(code)) {
        break;
      }
      if (source[cursor] === '(' || source[cursor] === ')' || source[cursor] === ',') {
        return undefined;
      }
      cursor++;
    }
    const token = source.slice(tokenStart, cursor);
    return token ? [token, cursor] : undefined;
  }

  const tokenStart = cursor;
  let depth = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '"' || char === '\'') {
      cursor = skipQuotedSourceString(source, cursor, source.length);
      continue;
    }
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth === 0) {
        cursor++;
        return [source.slice(tokenStart, cursor), cursor];
      }
    }
    cursor++;
  }
  return undefined;
}

/**
 * Tokenize the deliberately small at-rule prelude subset shared by CSS/Less
 * scanner-first proofs.
 *
 * This is not a CSS media-query parser. It accepts bare atoms and simple
 * balanced parenthesized atoms so language packages can decide whether to
 * build real core nodes or leave the prelude unsupported for later stages.
 */
export function scanCheapAtRulePrelude(
  text: string,
  options?: SourceScannerOptions
): CheapAtRulePreludeToken[] | undefined {
  const source = text.trim();
  if (!source) {
    return undefined;
  }
  if (isCheapPreludeAtomText(source)) {
    return [source];
  }
  const parenToken = scanParenthesizedPreludeToken(source);
  if (parenToken) {
    return [parenToken];
  }

  const tokens: CheapAtRulePreludeToken[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const read = readPreludeToken(source, cursor, options);
    if (!read) {
      return undefined;
    }
    const [token, next] = read;
    const scanned = scanParenthesizedPreludeToken(token) ?? (isCheapPreludeAtomText(token) ? token : undefined);
    if (!scanned) {
      return undefined;
    }
    tokens.push(scanned);
    cursor = skipSourceTrivia(source, next, source.length, options);
  }
  return tokens.length === 0 ? undefined : tokens;
}
