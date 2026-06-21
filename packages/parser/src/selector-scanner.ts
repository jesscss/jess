import {
  findTopLevelDelimiter,
  isSourceWhitespace,
  skipSourceTrivia,
  type SourceScannerOptions
} from './source-scanner.js';

export type CheapSelectorComponent =
  | string[]
  | ' '
  | '>'
  | '+'
  | '~';

function isSelectorNameCode(code: number): boolean {
  return (
    (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || (code >= 48 && code <= 57)
    || code === 45
    || code === 95
    || code > 0x7f
  );
}

function isSelectorNameStartCode(code: number, allowUppercase: boolean): boolean {
  return (
    (code >= 97 && code <= 122)
    || (allowUppercase && code >= 65 && code <= 90)
    || code === 95
    || code === 45
    || code > 0x7f
  );
}

function isTypeSelectorStartCode(code: number): boolean {
  return (code >= 97 && code <= 122) || code === 95 || code > 0x7f;
}

function skipSelectorSpace(source: string, start: number, end: number): number {
  let cursor = start;
  while (cursor < end && isSourceWhitespace(source.charCodeAt(cursor))) {
    cursor++;
  }
  return cursor;
}

function scanQuotedSelectorText(source: string, start: number): number {
  const quote = source[start];
  let cursor = start + 1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    cursor++;
    if (char === quote) {
      return cursor;
    }
  }
  return -1;
}

function isAttributeOperatorStart(char: string): boolean {
  return char === '~' || char === '|' || char === '^' || char === '$' || char === '*';
}

function scanAttributeTrailingFlag(source: string, start: number, end: number): number {
  let cursor = skipSelectorSpace(source, start, end);
  const code = source.charCodeAt(cursor);
  if (code === 73 || code === 83 || code === 105 || code === 115) {
    cursor = skipSelectorSpace(source, cursor + 1, end);
  }
  return cursor;
}

function scanAttributeIdentifier(source: string, start: number, end: number): number {
  if (start >= end || !isSelectorNameStartCode(source.charCodeAt(start), true)) {
    return -1;
  }
  if (source[start] === '-' && (start + 1 >= end || !isSelectorNameCode(source.charCodeAt(start + 1)))) {
    return -1;
  }
  let cursor = start + 1;
  while (cursor < end && isSelectorNameCode(source.charCodeAt(cursor))) {
    cursor++;
  }
  return cursor;
}

function scanAttributeName(source: string, start: number, end: number): number {
  if (source[start] === '*') {
    return source[start + 1] === '|'
      ? scanAttributeIdentifier(source, start + 2, end)
      : -1;
  }
  if (source[start] === '|') {
    return scanAttributeIdentifier(source, start + 1, end);
  }
  const prefixOrNameEnd = scanAttributeIdentifier(source, start, end);
  if (prefixOrNameEnd === -1) {
    return -1;
  }
  if (source[prefixOrNameEnd] === '|') {
    return scanAttributeIdentifier(source, prefixOrNameEnd + 1, end);
  }
  return prefixOrNameEnd;
}

function validateAttributeSelectorAtom(source: string, start: number, end: number): boolean {
  let cursor = skipSelectorSpace(source, start + 1, end);
  cursor = scanAttributeName(source, cursor, end - 1);
  if (cursor === -1) {
    return false;
  }
  cursor = skipSelectorSpace(source, cursor, end);
  if (cursor === end - 1) {
    return true;
  }
  const char = source[cursor];
  if (char === '=') {
    cursor++;
  } else if (isAttributeOperatorStart(char) && source[cursor + 1] === '=') {
    cursor += 2;
  } else {
    return false;
  }
  cursor = skipSelectorSpace(source, cursor, end);
  if (cursor >= end - 1) {
    return false;
  }
  if (source[cursor] === '\"' || source[cursor] === '\'') {
    cursor = scanQuotedSelectorText(source, cursor);
    return cursor !== -1 && scanAttributeTrailingFlag(source, cursor, end) === end - 1;
  }
  cursor = scanAttributeIdentifier(source, cursor, end - 1);
  return cursor !== -1 && scanAttributeTrailingFlag(source, cursor, end) === end - 1;
}

function scanAttributeSelectorAtom(source: string, start: number): number {
  let cursor = start + 1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '\"' || char === '\'') {
      cursor = scanQuotedSelectorText(source, cursor);
      if (cursor === -1) {
        return -1;
      }
      continue;
    }
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    cursor++;
    if (char === ']') {
      return validateAttributeSelectorAtom(source, start, cursor) ? cursor : -1;
    }
  }
  return -1;
}

function scanPseudoSelectorAtom(source: string, start: number): number {
  let cursor = start + 1;
  if (source[cursor] === ':') {
    cursor++;
  }
  if (cursor >= source.length || !isSelectorNameStartCode(source.charCodeAt(cursor), true)) {
    return -1;
  }
  while (cursor < source.length && isSelectorNameCode(source.charCodeAt(cursor))) {
    cursor++;
  }
  return cursor < source.length && source[cursor] === '(' ? -1 : cursor;
}

function scanBasicSelectorAtom(source: string, start: number): number {
  const first = source[start];
  if (first === '*') {
    return start + 1;
  }
  if (first === '[') {
    return scanAttributeSelectorAtom(source, start);
  }
  if (first === ':') {
    return scanPseudoSelectorAtom(source, start);
  }
  let cursor = start;
  if (first === '.' || first === '#') {
    cursor++;
    if (cursor >= source.length || !isSelectorNameStartCode(source.charCodeAt(cursor), true)) {
      return -1;
    }
    if (source[cursor] === '-' && (cursor + 1 >= source.length || !isSelectorNameCode(source.charCodeAt(cursor + 1)))) {
      return -1;
    }
  } else if (!isTypeSelectorStartCode(source.charCodeAt(cursor))) {
    return -1;
  }
  while (cursor < source.length && isSelectorNameCode(source.charCodeAt(cursor))) {
    const code = source.charCodeAt(cursor);
    if (first !== '.' && first !== '#' && code >= 65 && code <= 90) {
      return -1;
    }
    cursor++;
  }
  return cursor;
}

function scanCompoundSelector(source: string, start: number): { component: string[]; end: number } | undefined {
  const atoms: string[] = [];
  let cursor = start;
  while (cursor < source.length) {
    const end = scanBasicSelectorAtom(source, cursor);
    if (end === -1) {
      break;
    }
    atoms.push(source.slice(cursor, end));
    cursor = end;
  }
  if (atoms.length === 0) {
    return undefined;
  }
  return {
    component: atoms,
    end: cursor
  };
}

/**
 * Tokenize only cheap selector structures that are safe to share across
 * CSS-family parser proofs.
 *
 * This helper returns strings and combinator markers only. Language packages
 * decide whether to materialize those components into core selector nodes.
 */
export function scanCheapSelectorComponents(selector: string): CheapSelectorComponent[] | undefined {
  const source = selector.trim();
  if (!source) {
    return undefined;
  }
  const components: CheapSelectorComponent[] = [];
  let cursor = 0;
  let sawWhitespace = false;
  let lastWasCombinator = false;
  while (cursor < source.length) {
    const code = source.charCodeAt(cursor);
    if (isSourceWhitespace(code)) {
      sawWhitespace = components.length > 0 && !lastWasCombinator;
      cursor++;
      continue;
    }
    const char = source[cursor];
    if (char === '>' || char === '+' || char === '~') {
      if (components.length === 0 || lastWasCombinator) {
        return undefined;
      }
      components.push(char);
      cursor++;
      sawWhitespace = false;
      lastWasCombinator = true;
      continue;
    }
    if (sawWhitespace) {
      components.push(' ');
      sawWhitespace = false;
    }
    const compoundResult = scanCompoundSelector(source, cursor);
    if (!compoundResult) {
      return undefined;
    }
    components.push(compoundResult.component);
    cursor = compoundResult.end;
    lastWasCombinator = false;
  }
  if (components.length === 0 || lastWasCombinator) {
    return undefined;
  }
  return components;
}

function trimSelectorBranchEnd(
  source: string,
  start: number,
  end: number,
  options?: SourceScannerOptions
): number {
  let cursor = end;
  while (cursor > start) {
    const code = source.charCodeAt(cursor - 1);
    if (isSourceWhitespace(code)) {
      cursor--;
      continue;
    }
    if (options?.lineComments) {
      const lineStart = Math.max(
        source.lastIndexOf('\n', cursor - 1),
        source.lastIndexOf('\r', cursor - 1),
        start - 1
      ) + 1;
      let commentStart = -1;
      let scan = lineStart;
      let quoteCode = 0;
      while (scan < cursor) {
        const char = source[scan]!;
        if (quoteCode !== 0) {
          if (char === '\\') {
            scan += 2;
            continue;
          }
          if (char.charCodeAt(0) === quoteCode) {
            quoteCode = 0;
          }
          scan++;
          continue;
        }
        const charCode = char.charCodeAt(0);
        if (charCode === 34 || charCode === 39) {
          quoteCode = charCode;
          scan++;
          continue;
        }
        if (char === '/' && source[scan + 1] === '/') {
          commentStart = scan;
          break;
        }
        scan++;
      }
      if (commentStart >= start) {
        cursor = commentStart;
        continue;
      }
    }
    if (source[cursor - 1] === '/' && source[cursor - 2] === '*') {
      const commentStart = source.lastIndexOf('/*', cursor - 2);
      if (commentStart >= start) {
        cursor = commentStart;
        continue;
      }
    }
    break;
  }
  return cursor;
}

/**
 * Split and tokenize a cheap selector list without materializing selector nodes.
 *
 * Empty selector-list branches are invalid. The scanner rejects them here so
 * language packages do not silently collapse `.a, {}` into `.a {}`.
 */
export function scanCheapSelectorListComponents(
  selector: string,
  options?: SourceScannerOptions
): CheapSelectorComponent[][] | undefined {
  const source = selector.trim();
  if (!source) {
    return undefined;
  }
  const items: CheapSelectorComponent[][] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const comma = findTopLevelDelimiter(source, ',', cursor, source.length, options);
    const rawItemEnd = comma === -1 ? source.length : comma;
    const itemStart = skipSourceTrivia(source, cursor, rawItemEnd, options);
    const itemEnd = trimSelectorBranchEnd(source, itemStart, rawItemEnd, options);
    const item = itemStart < itemEnd
      ? scanCheapSelectorComponents(source.slice(itemStart, itemEnd))
      : undefined;
    if (!item) {
      return undefined;
    }
    items.push(item);
    if (comma === -1) {
      break;
    }
    cursor = comma + 1;
    if (skipSourceTrivia(source, cursor, source.length, options) >= source.length) {
      return undefined;
    }
  }
  return items;
}
