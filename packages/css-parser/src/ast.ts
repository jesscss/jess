import {
  decl,
  rules,
  ruleset,
  stylesheet,
  type Node,
  type Stylesheet
} from '@jesscss/core';
import {
  findBalancedBlockEnd,
  findStatementEnd,
  findTopLevelBlockStart,
  findTopLevelDelimiter,
  skipSourceTrivia
} from '@jesscss/parser';

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
    cursor = skipSourceTrivia(source, cursor, end);
    if (cursor >= end) {
      break;
    }
    const statementEnd = findStatementEnd(source, cursor, end);
    const colon = findTopLevelDelimiter(source, ':', cursor, statementEnd);
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

function canParseFlatQualifiedRule(source: string, selector: string, bodyStart: number, bodyEnd: number): boolean {
  return selector[0] !== '@' && findTopLevelBlockStart(source, bodyStart, bodyEnd) === -1;
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
    cursor = skipSourceTrivia(source, cursor);
    if (cursor >= source.length) {
      break;
    }
    const blockStart = findTopLevelBlockStart(source, cursor);
    if (blockStart === -1) {
      break;
    }
    const blockEnd = findBalancedBlockEnd(source, blockStart);
    if (blockEnd === -1) {
      break;
    }
    const selector = source.slice(cursor, blockStart).trim();
    if (selector && canParseFlatQualifiedRule(source, selector, blockStart + 1, blockEnd)) {
      children.push(ruleset({
        selector,
        rules: rules(parseDeclarationNodes(source, blockStart + 1, blockEnd))
      }));
    }
    cursor = blockEnd + 1;
  }
  return stylesheet(children);
}
