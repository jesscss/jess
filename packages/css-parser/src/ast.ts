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
  SourceText,
  type ParserDiagnostic,
  type ScannerParseResult,
  skipSourceTrivia
} from '@jesscss/parser';

export type FlatCssDeclarationStylesheetResult = ScannerParseResult<Stylesheet>;

const EMPTY_DIAGNOSTICS: readonly ParserDiagnostic[] = [];

function findImportantStart(value: string): number {
  const trimmed = value.trimEnd();
  const marker = '!important';
  if (!trimmed.toLowerCase().endsWith(marker)) {
    return -1;
  }
  return trimmed.length - marker.length;
}

function pushDiagnostic(
  diagnostics: ParserDiagnostic[] | undefined,
  severity: ParserDiagnostic['severity'],
  code: string,
  message: string,
  start: number,
  end: number
): ParserDiagnostic[] {
  const output = diagnostics ?? [];
  output.push({ severity, code, message, start, end });
  return output;
}

type DiagnosticSink = (
  severity: ParserDiagnostic['severity'],
  code: string,
  message: string,
  start: number,
  end: number
) => void;

function parseDeclarationNodes(
  source: string,
  start: number,
  end: number,
  addDiagnostic: DiagnosticSink
): Node[] {
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
    } else if (source.slice(cursor, statementEnd).trim()) {
      addDiagnostic(
        'warning',
        'css-flat-unsupported-statement',
        'Flat CSS declaration parser skipped a statement without a top-level declaration colon.',
        cursor,
        statementEnd
      );
    }
    cursor = statementEnd + 1;
  }
  return declarations;
}

function canParseFlatQualifiedRule(source: string, selector: string, bodyStart: number, bodyEnd: number): boolean {
  return selector[0] !== '@' && findTopLevelBlockStart(source, bodyStart, bodyEnd) === -1;
}

function pushSkippedStatementDiagnostic(
  source: string,
  diagnostics: ParserDiagnostic[] | undefined,
  start: number,
  end: number
): ParserDiagnostic[] | undefined {
  if (!source.slice(start, end).trim()) {
    return diagnostics;
  }
  const isAtRule = source[skipSourceTrivia(source, start, end)] === '@';
  return pushDiagnostic(
    diagnostics,
    'warning',
    isAtRule ? 'css-flat-unsupported-at-rule' : 'css-flat-unsupported-statement',
    isAtRule
      ? 'Flat CSS declaration parser skipped an at-rule statement.'
      : 'Flat CSS declaration parser skipped a statement without a top-level block.',
    start,
    end
  );
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
export function parseFlatCssDeclarationStylesheet(
  filePath: string,
  input: string | SourceText
): FlatCssDeclarationStylesheetResult {
  const sourceText = input instanceof SourceText ? input : new SourceText(input, filePath);
  const source = sourceText.text;
  let diagnostics: ParserDiagnostic[] | undefined;
  const addDiagnostic: DiagnosticSink = (severity, code, message, start, end): void => {
    diagnostics = pushDiagnostic(diagnostics, severity, code, message, start, end);
  };
  const children: Node[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    cursor = skipSourceTrivia(source, cursor);
    if (cursor >= source.length) {
      break;
    }
    const blockStart = findTopLevelBlockStart(source, cursor);
    const statementEnd = findStatementEnd(source, cursor, blockStart === -1 ? source.length : blockStart);
    if (statementEnd < (blockStart === -1 ? source.length : blockStart)) {
      diagnostics = pushSkippedStatementDiagnostic(source, diagnostics, cursor, statementEnd + 1);
      cursor = statementEnd + 1;
      continue;
    }
    if (blockStart === -1) {
      const trailing = source.slice(cursor).trim();
      if (trailing) {
        diagnostics = pushDiagnostic(
          diagnostics,
          'warning',
          'css-flat-unsupported-trailing-source',
          'Flat CSS declaration parser skipped trailing source without a top-level block.',
          cursor,
          source.length
        );
      }
      break;
    }
    const blockEnd = findBalancedBlockEnd(source, blockStart);
    if (blockEnd === -1) {
      diagnostics = pushDiagnostic(
        diagnostics,
        'error',
        'css-flat-unclosed-block',
        'Flat CSS declaration parser reached the end of source before the block closed.',
        blockStart,
        source.length
      );
      break;
    }
    const selector = source.slice(cursor, blockStart).trim();
    if (selector && canParseFlatQualifiedRule(source, selector, blockStart + 1, blockEnd)) {
      children.push(ruleset({
        selector,
        rules: rules(parseDeclarationNodes(source, blockStart + 1, blockEnd, addDiagnostic))
      }));
    } else if (selector) {
      diagnostics = pushDiagnostic(
        diagnostics,
        'warning',
        selector[0] === '@' ? 'css-flat-unsupported-at-rule' : 'css-flat-unsupported-nested-block',
        selector[0] === '@'
          ? 'Flat CSS declaration parser skipped an at-rule.'
          : 'Flat CSS declaration parser skipped a qualified rule with nested blocks.',
        cursor,
        blockEnd + 1
      );
    }
    cursor = blockEnd + 1;
  }
  return {
    tree: stylesheet(children),
    source: sourceText,
    diagnostics: diagnostics ?? EMPTY_DIAGNOSTICS
  };
}
