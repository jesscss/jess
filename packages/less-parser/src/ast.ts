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

export type LessAstStylesheetResult = ScannerParseResult<Stylesheet>;

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

function parseCheapLessSelector(selector: string): string | Selector | undefined {
  const source = selector.trim();
  const components = scanCheapSelectorComponents(source);
  if (!components) {
    return undefined;
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

function parseLessStatementNode(
  source: string,
  start: number,
  end: number,
  addDiagnostic: DiagnosticSink
): Node | undefined {
  const colon = findTopLevelDelimiter(source, ':', start, end, LESS_SCANNER_OPTIONS);
  if (colon === -1) {
    const statement = parseAtRuleStatement(source, start, end + 1);
    if (statement) {
      return statement;
    }
    if (source.slice(start, end).trim()) {
      const isMalformedAtRule = source[skipSourceTrivia(source, start, end, LESS_SCANNER_OPTIONS)] === '@';
      addDiagnostic(
        'warning',
        isMalformedAtRule ? 'less-ast-malformed-at-rule-statement' : 'less-ast-unsupported-statement',
        isMalformedAtRule
          ? 'Less AST parser skipped a malformed at-rule statement.'
          : 'Less AST parser skipped a statement without a top-level declaration colon.',
        start,
        end
      );
    }
    return undefined;
  }
  const variable = parseLessVariableDeclaration(source, start, colon, end);
  if (variable) {
    return variable;
  }
  const name = source.slice(start, colon).trim();
  if (!name) {
    addDiagnostic(
      'warning',
      'less-ast-empty-declaration-name',
      'Less AST parser skipped a declaration with an empty name.',
      start,
      end
    );
    return undefined;
  }
  const isCustomProperty = name.startsWith('--');
  const valueText = source.slice(colon + 1, end);
  if (isCustomProperty) {
    return decl({ name, value: valueText });
  }
  const trimmedValue = valueText.trim();
  const importantStart = findTrailingImportantStart(trimmedValue);
  return decl({
    name,
    value: importantStart === -1 ? trimmedValue : trimmedValue.slice(0, importantStart).trimEnd(),
    ...(importantStart !== -1 && { important: trimmedValue.slice(importantStart) })
  });
}

function parseLessNodes(
  source: string,
  start: number,
  end: number,
  addDiagnostic: DiagnosticSink
): Node[] {
  const children: Node[] = [];
  let cursor = start;
  while (cursor < end) {
    cursor = skipSourceTrivia(source, cursor, end, LESS_SCANNER_OPTIONS);
    if (cursor >= end) {
      break;
    }
    const blockStart = findTopLevelBlockStart(source, cursor, end, LESS_SCANNER_OPTIONS);
    const statementLimit = blockStart === -1 ? end : blockStart;
    const statementEnd = findStatementEnd(source, cursor, statementLimit, LESS_SCANNER_OPTIONS);
    if (statementEnd < statementLimit) {
      const statement = parseLessStatementNode(source, cursor, statementEnd, addDiagnostic);
      if (statement) {
        children.push(statement);
      }
      cursor = statementEnd + 1;
      continue;
    }
    if (blockStart === -1) {
      const statement = parseLessStatementNode(source, cursor, end, addDiagnostic);
      if (statement) {
        children.push(statement);
      }
      break;
    }
    const blockEnd = findBalancedBlockEnd(source, blockStart, end, LESS_SCANNER_OPTIONS);
    if (blockEnd === -1) {
      addDiagnostic(
        'error',
        'less-ast-unclosed-block',
        'Less AST parser reached the end of source before the block closed.',
        blockStart,
        end
      );
      break;
    }
    const selector = source.slice(cursor, blockStart).trim();
    if (selector) {
      if (selector[0] === '@') {
        addDiagnostic(
          'warning',
          'less-ast-unsupported-at-rule',
          'Less AST parser skipped an at-rule block.',
          cursor,
          blockEnd + 1
        );
      } else {
        const parsedSelector = parseCheapLessSelector(selector);
        if (parsedSelector === undefined) {
          addDiagnostic(
            'warning',
            'less-ast-unsupported-block-header',
            'Less AST parser skipped a block with an unsupported header.',
            cursor,
            blockEnd + 1
          );
          cursor = blockEnd + 1;
          continue;
        }
        children.push(ruleset({
          selector: parsedSelector,
          rules: rules(parseLessNodes(source, blockStart + 1, blockEnd, addDiagnostic))
        }));
      }
    }
    cursor = blockEnd + 1;
  }
  return children;
}

/**
 * Parse a small Less stylesheet subset directly into existing core AST nodes.
 *
 * This is a scanner-first parser proof, not a compatibility parser. It accepts
 * cheap qualified rules, nested cheap qualified rules, ordinary declarations,
 * simple `@name:` variables, and statement-form at-rules. Values stay as strings
 * until a later decision proves typed parsing is necessary.
 */
export function parseLessAstStylesheet(
  filePath: string,
  input: string | SourceText
): LessAstStylesheetResult {
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
      const statement = parseLessStatementNode(source, cursor, statementEnd, addDiagnostic);
      if (statement) {
        children.push(statement);
      }
      cursor = statementEnd + 1;
      continue;
    }
    if (blockStart === -1) {
      if (source.slice(cursor).trim()) {
        diagnostics = appendParserDiagnostic(
          diagnostics,
          'warning',
          'less-ast-unsupported-trailing-source',
          'Less AST parser skipped trailing source without a top-level block.',
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
        'less-ast-unclosed-block',
        'Less AST parser reached the end of source before the block closed.',
        blockStart,
        source.length
      );
      break;
    }
    const selector = source.slice(cursor, blockStart).trim();
    if (selector && selector[0] !== '@') {
      const parsedSelector = parseCheapLessSelector(selector);
      if (parsedSelector === undefined) {
        diagnostics = appendParserDiagnostic(
          diagnostics,
          'warning',
          'less-ast-unsupported-block-header',
          'Less AST parser skipped a block with an unsupported header.',
          cursor,
          blockEnd + 1
        );
        cursor = blockEnd + 1;
        continue;
      }
      children.push(ruleset({
        selector: parsedSelector,
        rules: rules(parseLessNodes(source, blockStart + 1, blockEnd, addDiagnostic))
      }));
    } else if (selector) {
      diagnostics = appendParserDiagnostic(
        diagnostics,
        'warning',
        'less-ast-unsupported-at-rule',
        'Less AST parser skipped an at-rule block.',
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
