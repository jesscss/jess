import {
  VarDeclaration,
  atrulestatement,
  co,
  compound,
  decl,
  el,
  rules,
  ruleset,
  sel,
  stylesheet,
  type Node,
  type Selector,
  type Stylesheet
} from '@jesscss/core';
import { scanCheapSelectorComponents, type CheapSelectorComponent } from '@jesscss/css-parser';
import {
  SourceText,
  appendParserDiagnostic,
  findBalancedBlockEnd,
  findStatementEnd,
  findTrailingImportantStart,
  findTopLevelBlockStart,
  findTopLevelDelimiter,
  skipSourceTrivia,
  type ParserDiagnostic,
  type ScannerParseResult,
  type SourceScannerOptions
} from '@jesscss/parser';

export type FlatLessDeclarationStylesheetResult = ScannerParseResult<Stylesheet>;

const EMPTY_DIAGNOSTICS: readonly ParserDiagnostic[] = [];
const LESS_SCANNER_OPTIONS: SourceScannerOptions = { lineComments: true };

type DiagnosticSink = (
  severity: ParserDiagnostic['severity'],
  code: string,
  message: string,
  start: number,
  end: number
) => void;

function isLessNameCode(code: number): boolean {
  return (
    (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || (code >= 48 && code <= 57)
    || code === 45
    || code === 95
  );
}

function materializeCheapCompound(component: readonly string[]): Selector {
  return component.length === 1
    ? el(component[0]!)
    : compound(component.map(atom => el(atom)));
}

function materializeCheapSelector(components: CheapSelectorComponent[]): Selector {
  if (components.length === 1) {
    const only = components[0]!;
    if (Array.isArray(only)) {
      return materializeCheapCompound(only);
    }
  }
  return sel(components.map((component) => {
    if (typeof component === 'string') {
      return co(component);
    }
    return materializeCheapCompound(component);
  }));
}

function parseCheapLessSelector(selector: string): string | Selector {
  const source = selector.trim();
  const components = scanCheapSelectorComponents(source);
  if (!components) {
    return selector;
  }
  if (components.length === 1) {
    const only = components[0]!;
    return Array.isArray(only) && only.length === 1 ? source : materializeCheapSelector(components);
  }
  return materializeCheapSelector(components);
}

function parseLessVariableDeclaration(
  source: string,
  start: number,
  colon: number,
  end: number
): VarDeclaration | undefined {
  if (source[start] !== '@') {
    return undefined;
  }
  let nameEnd = start + 1;
  while (nameEnd < colon && isLessNameCode(source.charCodeAt(nameEnd))) {
    nameEnd++;
  }
  const name = source.slice(start + 1, nameEnd);
  if (!name || source.slice(nameEnd, colon).trim()) {
    return undefined;
  }
  const trimmedValue = source.slice(colon + 1, end).trim();
  const importantStart = findTrailingImportantStart(trimmedValue);
  return new VarDeclaration({
    name,
    value: importantStart === -1 ? trimmedValue : trimmedValue.slice(0, importantStart).trimEnd(),
    ...(importantStart !== -1 && { important: trimmedValue.slice(importantStart) })
  });
}

function parseAtRuleStatement(source: string, start: number, end: number): Node | undefined {
  const textEnd = source[end - 1] === ';' ? end - 1 : end;
  const textStart = skipSourceTrivia(source, start, textEnd, LESS_SCANNER_OPTIONS);
  const text = source.slice(textStart, textEnd).trim();
  if (!text || text[0] !== '@') {
    return undefined;
  }
  let nameEnd = 1;
  while (nameEnd < text.length && isLessNameCode(text.charCodeAt(nameEnd))) {
    nameEnd++;
  }
  const name = text.slice(0, nameEnd);
  if (name.length === 1) {
    return undefined;
  }
  const prelude = text.slice(nameEnd).trim();
  return atrulestatement({
    name,
    ...(prelude && { prelude })
  });
}

function parseLessDeclarationNodes(
  source: string,
  start: number,
  end: number,
  addDiagnostic: DiagnosticSink
): Node[] {
  const declarations: Node[] = [];
  let cursor = start;
  while (cursor < end) {
    cursor = skipSourceTrivia(source, cursor, end, LESS_SCANNER_OPTIONS);
    if (cursor >= end) {
      break;
    }
    const statementEnd = findStatementEnd(source, cursor, end, LESS_SCANNER_OPTIONS);
    const colon = findTopLevelDelimiter(source, ':', cursor, statementEnd, LESS_SCANNER_OPTIONS);
    if (colon !== -1) {
      const variable = parseLessVariableDeclaration(source, cursor, colon, statementEnd);
      if (variable) {
        declarations.push(variable);
        cursor = statementEnd + 1;
        continue;
      }
      const name = source.slice(cursor, colon).trim();
      if (!name) {
        addDiagnostic(
          'warning',
          'less-flat-empty-declaration-name',
          'Flat Less declaration parser skipped a declaration with an empty name.',
          cursor,
          statementEnd
        );
        cursor = statementEnd + 1;
        continue;
      }
      const isCustomProperty = name.startsWith('--');
      const valueText = source.slice(colon + 1, statementEnd);
      if (isCustomProperty) {
        declarations.push(decl({ name, value: valueText }));
      } else {
        const trimmedValue = valueText.trim();
        const importantStart = findTrailingImportantStart(trimmedValue);
        declarations.push(decl({
          name,
          value: importantStart === -1 ? trimmedValue : trimmedValue.slice(0, importantStart).trimEnd(),
          ...(importantStart !== -1 && { important: trimmedValue.slice(importantStart) })
        }));
      }
    } else if (source.slice(cursor, statementEnd).trim()) {
      addDiagnostic(
        'warning',
        'less-flat-unsupported-statement',
        'Flat Less declaration parser skipped a statement without a top-level declaration colon.',
        cursor,
        statementEnd
      );
    }
    cursor = statementEnd + 1;
  }
  return declarations;
}

function canParseFlatQualifiedRule(source: string, selector: string, bodyStart: number, bodyEnd: number): boolean {
  return selector[0] !== '@'
    && findTopLevelBlockStart(source, bodyStart, bodyEnd, LESS_SCANNER_OPTIONS) === -1;
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
  const isMalformedAtRule = source[skipSourceTrivia(source, start, end, LESS_SCANNER_OPTIONS)] === '@';
  return appendParserDiagnostic(
    diagnostics,
    'warning',
    isMalformedAtRule ? 'less-flat-malformed-at-rule-statement' : 'less-flat-unsupported-statement',
    isMalformedAtRule
      ? 'Flat Less declaration parser skipped a malformed at-rule statement.'
      : 'Flat Less declaration parser skipped a statement without a top-level block.',
    start,
    end
  );
}

/**
 * Parse a small Less stylesheet subset directly into existing core AST nodes.
 *
 * This is a scanner-first parser proof, not a compatibility parser. It accepts
 * flat qualified rules, ordinary declarations, simple `@name:` variables, and
 * statement-form at-rules. Values stay as strings until a later decision proves
 * typed parsing is necessary.
 */
export function parseFlatLessDeclarationStylesheet(
  filePath: string,
  input: string | SourceText
): FlatLessDeclarationStylesheetResult {
  const sourceText = input instanceof SourceText ? input : new SourceText(input, filePath);
  const source = sourceText.text;
  let diagnostics: ParserDiagnostic[] | undefined;
  const addDiagnostic: DiagnosticSink = (severity, code, message, start, end): void => {
    diagnostics = appendParserDiagnostic(diagnostics, severity, code, message, start, end);
  };
  const children: Node[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    cursor = skipSourceTrivia(source, cursor, source.length, LESS_SCANNER_OPTIONS);
    if (cursor >= source.length) {
      break;
    }
    const blockStart = findTopLevelBlockStart(source, cursor, source.length, LESS_SCANNER_OPTIONS);
    const statementEnd = findStatementEnd(
      source,
      cursor,
      blockStart === -1 ? source.length : blockStart,
      LESS_SCANNER_OPTIONS
    );
    if (statementEnd < (blockStart === -1 ? source.length : blockStart)) {
      const colon = findTopLevelDelimiter(source, ':', cursor, statementEnd, LESS_SCANNER_OPTIONS);
      const statement = colon === -1
        ? parseAtRuleStatement(source, cursor, statementEnd + 1)
        : parseLessVariableDeclaration(source, cursor, colon, statementEnd);
      if (statement) {
        children.push(statement);
      } else {
        diagnostics = pushSkippedStatementDiagnostic(source, diagnostics, cursor, statementEnd + 1);
      }
      cursor = statementEnd + 1;
      continue;
    }
    if (blockStart === -1) {
      if (source.slice(cursor).trim()) {
        diagnostics = appendParserDiagnostic(
          diagnostics,
          'warning',
          'less-flat-unsupported-trailing-source',
          'Flat Less declaration parser skipped trailing source without a top-level block.',
          cursor,
          source.length
        );
      }
      break;
    }
    const blockEnd = findBalancedBlockEnd(source, blockStart, source.length, LESS_SCANNER_OPTIONS);
    if (blockEnd === -1) {
      diagnostics = appendParserDiagnostic(
        diagnostics,
        'error',
        'less-flat-unclosed-block',
        'Flat Less declaration parser reached the end of source before the block closed.',
        blockStart,
        source.length
      );
      break;
    }
    const selector = source.slice(cursor, blockStart).trim();
    if (selector && canParseFlatQualifiedRule(source, selector, blockStart + 1, blockEnd)) {
      children.push(ruleset({
        selector: parseCheapLessSelector(selector),
        rules: rules(parseLessDeclarationNodes(source, blockStart + 1, blockEnd, addDiagnostic))
      }));
    } else if (selector) {
      diagnostics = appendParserDiagnostic(
        diagnostics,
        'warning',
        selector[0] === '@' ? 'less-flat-unsupported-at-rule' : 'less-flat-unsupported-nested-block',
        selector[0] === '@'
          ? 'Flat Less declaration parser skipped an at-rule.'
          : 'Flat Less declaration parser skipped a qualified rule with nested blocks.',
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
