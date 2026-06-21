import {
  decl,
  rules,
  ruleset,
  stylesheet,
  type Node,
  type Stylesheet
} from '@jesscss/core';

function isWhitespace(code: number): boolean {
  return code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
}

function skipTrivia(source: string, offset: number): number {
  let cursor = offset;
  while (cursor < source.length) {
    const code = source.charCodeAt(cursor);
    if (isWhitespace(code)) {
      cursor++;
      continue;
    }
    if (source[cursor] === '/' && source[cursor + 1] === '*') {
      const end = source.indexOf('*/', cursor + 2);
      cursor = end === -1 ? source.length : end + 2;
      continue;
    }
    break;
  }
  return cursor;
}

function skipQuoted(source: string, offset: number): number {
  const quote = source[offset];
  let cursor = offset + 1;
  while (cursor < source.length) {
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

function findBlockStart(source: string, offset: number): number {
  let cursor = offset;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '"' || char === "'") {
      cursor = skipQuoted(source, cursor);
      continue;
    }
    if (char === '/' && source[cursor + 1] === '*') {
      const end = source.indexOf('*/', cursor + 2);
      cursor = end === -1 ? source.length : end + 2;
      continue;
    }
    if (char === '{') {
      return cursor;
    }
    cursor++;
  }
  return -1;
}

function findBlockEnd(source: string, offset: number): number {
  let cursor = offset + 1;
  let depth = 1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '"' || char === "'") {
      cursor = skipQuoted(source, cursor);
      continue;
    }
    if (char === '/' && source[cursor + 1] === '*') {
      const end = source.indexOf('*/', cursor + 2);
      cursor = end === -1 ? source.length : end + 2;
      continue;
    }
    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return cursor;
      }
    }
    cursor++;
  }
  return -1;
}

function findTopLevelColon(source: string, start: number, end: number): number {
  let cursor = start;
  let depth = 0;
  while (cursor < end) {
    const char = source[cursor];
    if (char === '"' || char === "'") {
      cursor = skipQuoted(source, cursor);
      continue;
    }
    if (char === '/' && source[cursor + 1] === '*') {
      const commentEnd = source.indexOf('*/', cursor + 2);
      cursor = commentEnd === -1 ? end : commentEnd + 2;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth++;
    } else if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
    } else if (char === ':' && depth === 0) {
      return cursor;
    }
    cursor++;
  }
  return -1;
}

function findStatementEnd(source: string, start: number, blockEnd: number): number {
  let cursor = start;
  let depth = 0;
  while (cursor < blockEnd) {
    const char = source[cursor];
    if (char === '"' || char === "'") {
      cursor = skipQuoted(source, cursor);
      continue;
    }
    if (char === '/' && source[cursor + 1] === '*') {
      const commentEnd = source.indexOf('*/', cursor + 2);
      cursor = commentEnd === -1 ? blockEnd : commentEnd + 2;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth++;
    } else if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
    } else if (char === ';' && depth === 0) {
      return cursor;
    }
    cursor++;
  }
  return blockEnd;
}

function findImportantStart(value: string): number {
  const trimmed = value.trimEnd();
  const marker = '!important';
  if (!trimmed.toLowerCase().endsWith(marker)) {
    return -1;
  }
  return trimmed.length - marker.length;
}

function parseDeclarationNodes(source: string, start: number, end: number): Node[] {
  const declarations: Node[] = [];
  let cursor = start;
  while (cursor < end) {
    cursor = skipTrivia(source, cursor);
    if (cursor >= end) {
      break;
    }
    const statementEnd = findStatementEnd(source, cursor, end);
    const colon = findTopLevelColon(source, cursor, statementEnd);
    if (colon !== -1) {
      const name = source.slice(cursor, colon).trim();
      const isCustomProperty = name.startsWith('--');
      const valueText = source.slice(colon + 1, statementEnd);
      if (isCustomProperty) {
        declarations.push(decl({ name, value: valueText }));
      } else {
        const trimmedValue = valueText.trim();
        const importantStart = findImportantStart(trimmedValue);
        declarations.push(decl({
          name,
          value: importantStart === -1 ? trimmedValue : trimmedValue.slice(0, importantStart).trimEnd(),
          ...(importantStart !== -1 && { important: trimmedValue.slice(importantStart) })
        }));
      }
    }
    cursor = statementEnd + 1;
  }
  return declarations;
}

/**
 * Parse a small CSS qualified-rule subset directly into the core AST shape.
 *
 * This is the existing-AST proof path for scanner-first work: it creates a
 * `Stylesheet` root with string-backed selectors and declaration fields, and it
 * intentionally avoids Chevrotain, structural documents, and deferred-island
 * objects. Unsupported syntax is left for later slices rather than hidden
 * behind a broad fallback parser.
 */
export function parseFlatCssDeclarationStylesheet(filePath: string, source: string): Stylesheet {
  void filePath;
  const children: Node[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    cursor = skipTrivia(source, cursor);
    if (cursor >= source.length) {
      break;
    }
    const blockStart = findBlockStart(source, cursor);
    if (blockStart === -1) {
      break;
    }
    const blockEnd = findBlockEnd(source, blockStart);
    if (blockEnd === -1) {
      break;
    }
    const selector = source.slice(cursor, blockStart).trim();
    if (selector) {
      children.push(ruleset({
        selector,
        rules: rules(parseDeclarationNodes(source, blockStart + 1, blockEnd))
      }));
    }
    cursor = blockEnd + 1;
  }
  return stylesheet(children);
}
