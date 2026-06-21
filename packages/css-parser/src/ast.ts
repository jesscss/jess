import {
  any,
  atrule,
  atrulestatement,
  compound,
  decl,
  list,
  paren,
  query,
  ruleset,
  sel,
  sellist,
  type AtRulePrelude,
  stylesheet,
  type Node,
  type Selector,
  type Stylesheet
} from '@jesscss/core';
import {
  appendParserDiagnostic,
  findBalancedBlockEnd,
  findStatementEnd,
  findTrailingImportantStart,
  findTopLevelBlockStart,
  findTopLevelDelimiter,
  createPackedFieldSpans,
  scanCheapAtRulePrelude,
  scanCheapAtRulePreludeList,
  scanCheapSelectorComponents,
  setPackedFieldSpan,
  SourceText,
  renderParserDiagnostic,
  type ScannerParseResult,
  type ParserDiagnostic,
  type SourceScannerOptions,
  type CheapSelectorComponent,
  type CheapAtRulePreludeToken,
  skipSourceTrivia
} from '@jesscss/parser';

export type FlatCssDeclarationStylesheetResult = ScannerParseResult<Stylesheet>;

const EMPTY_DIAGNOSTICS: readonly ParserDiagnostic[] = [];
const DECLARATION_FIELD_COUNT = 3;
const DECLARATION_NAME_FIELD = 0;
const DECLARATION_VALUE_FIELD = 1;
const RULESET_FIELD_COUNT = 4;
const RULESET_SELECTOR_FIELD = 0;

type DiagnosticSink = (
  severity: ParserDiagnostic['severity'],
  code: string,
  message: string,
  start: number,
  end: number
) => void;

type QueuedDiagnostic = Parameters<DiagnosticSink>;

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
      const nameStart = trimStartOffset(source, cursor, colon);
      const nameEnd = trimEndOffset(source, nameStart, colon);
      const valueStart = isCustomProperty
        ? colon + 1
        : trimStartOffset(source, colon + 1, statementEnd);
      const valueEnd = statementEnd;
      let node: Node;
      if (isCustomProperty) {
        node = decl({ name, value: valueText });
      } else {
        const trimmedValue = valueText.trim();
        const importantStart = findTrailingImportantStart(trimmedValue);
        node = decl({
          name,
          value: importantStart === -1 ? trimmedValue : trimmedValue.slice(0, importantStart).trimEnd(),
          ...(importantStart !== -1 && { important: trimmedValue.slice(importantStart) })
        });
      }
      setFieldSpan(node, DECLARATION_NAME_FIELD, DECLARATION_FIELD_COUNT, nameStart, nameEnd);
      setFieldSpan(node, DECLARATION_VALUE_FIELD, DECLARATION_FIELD_COUNT, valueStart, valueEnd);
      declarations.push(node);
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

function isCssNameCode(code: number): boolean {
  return (
    (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || (code >= 48 && code <= 57)
    || code === 45
    || code === 95
  );
}

function materializeCheapAtRulePreludeToken(token: CheapAtRulePreludeToken): string | Node {
  return typeof token === 'string' ? token : paren(any(token[1]));
}

function materializeCheapAtRulePreludeNode(token: CheapAtRulePreludeToken): Node {
  return typeof token === 'string' ? any(token) : paren(any(token[1]));
}

export function parseCheapAtRulePrelude(text: string, options?: SourceScannerOptions): AtRulePrelude | undefined {
  const tokens = scanCheapAtRulePrelude(text, options);
  if (!tokens) {
    return undefined;
  }
  if (tokens.length === 1) {
    return materializeCheapAtRulePreludeToken(tokens[0]!);
  }
  return query(tokens.map(materializeCheapAtRulePreludeNode));
}

function materializeCheapAtRulePreludeListItem(tokens: CheapAtRulePreludeToken[]): Node {
  return tokens.length === 1
    ? materializeCheapAtRulePreludeNode(tokens[0]!)
    : query(tokens.map(materializeCheapAtRulePreludeNode));
}

function parseCheapAtRulePreludeList(text: string, options?: SourceScannerOptions): AtRulePrelude | undefined {
  const items = scanCheapAtRulePreludeList(text, options);
  return items ? list(items.map(materializeCheapAtRulePreludeListItem)) : undefined;
}

function materializeCheapCompound(component: string[]): string | Selector {
  return component.length === 1
    ? component[0]!
    : compound(component);
}

function materializeCheapSelectorBranch(components: CheapSelectorComponent[]): string | Selector {
  if (components.length === 1) {
    const only = components[0]!;
    if (Array.isArray(only)) {
      return materializeCheapCompound(only);
    }
  }
  return sel(components.map((component) => {
    if (typeof component === 'string') {
      return component;
    }
    return materializeCheapCompound(component);
  }));
}

function parseCheapSelectorBranch(selector: string): string | Selector | undefined {
  const source = selector.trim();
  if (!source) {
    return undefined;
  }
  const components = scanCheapSelectorComponents(source);
  if (!components) {
    return undefined;
  }
  if (components.length === 1) {
    const only = components[0]!;
    return Array.isArray(only) && only.length === 1 ? source : materializeCheapSelectorBranch(components);
  }
  return materializeCheapSelectorBranch(components);
}

function parseCheapSelector(selector: string): string | Selector | undefined {
  const source = selector.trim();
  if (!source) {
    return undefined;
  }
  const items: Array<string | Selector> = [];
  let cursor = 0;
  while (cursor < source.length) {
    const comma = findTopLevelDelimiter(source, ',', cursor, source.length);
    const itemEnd = comma === -1 ? source.length : comma;
    const item = parseCheapSelectorBranch(source.slice(cursor, itemEnd));
    if (item === undefined) {
      return undefined;
    }
    items.push(item);
    if (comma === -1) {
      break;
    }
    cursor = comma + 1;
    if (skipSourceTrivia(source, cursor, source.length) >= source.length) {
      return undefined;
    }
  }
  return items.length === 1 ? items[0]! : sellist(items);
}

function parseStatementNode(
  source: string,
  start: number,
  end: number
): Node | undefined {
  const textEnd = source[end - 1] === ';' ? end - 1 : end;
  const textStart = skipSourceTrivia(source, start, textEnd);
  const text = source.slice(textStart, textEnd).trim();
  if (!text) {
    return undefined;
  }
  if (text[0] !== '@') {
    return undefined;
  }
  let nameEnd = 1;
  while (nameEnd < text.length) {
    const code = text.charCodeAt(nameEnd);
    const isNameCode =
      (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57)
      || code === 45
      || code === 95;
    if (!isNameCode) {
      break;
    }
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

function parseBlockAtRuleNode(
  source: string,
  start: number,
  blockStart: number,
  blockEnd: number,
  addDiagnostic: DiagnosticSink
): Node | undefined {
  if (source[start] !== '@') {
    return undefined;
  }
  let nameEnd = start + 1;
  while (nameEnd < blockStart && isCssNameCode(source.charCodeAt(nameEnd))) {
    nameEnd++;
  }
  const name = source.slice(start, nameEnd);
  if (name.length === 1) {
    return undefined;
  }
  const preludeText = source.slice(nameEnd, blockStart).trim();
  const prelude = parseCheapAtRulePrelude(preludeText) ?? parseCheapAtRulePreludeList(preludeText);
  if (preludeText && !prelude) {
    return undefined;
  }
  return atrule({
    name,
    ...(prelude !== undefined && { prelude }),
    rules: parseCssNodes(source, blockStart + 1, blockEnd, addDiagnostic)
  });
}

function parseCssNodes(
  source: string,
  start: number,
  end: number,
  addDiagnostic: DiagnosticSink
): Node[] {
  const children: Node[] = [];
  let cursor = start;
  while (cursor < end) {
    cursor = skipSourceTrivia(source, cursor, end);
    if (cursor >= end) {
      break;
    }
    const blockStart = findTopLevelBlockStart(source, cursor, end);
    const statementEnd = findStatementEnd(source, cursor, blockStart === -1 ? end : blockStart);
    if (statementEnd < (blockStart === -1 ? end : blockStart)) {
      const statement = parseStatementNode(source, cursor, statementEnd + 1);
      if (statement) {
        children.push(statement);
      } else {
        const statementStart = skipSourceTrivia(source, cursor, statementEnd + 1);
        const isMalformedAtRule = source[statementStart] === '@';
        addDiagnostic(
          'warning',
          isMalformedAtRule ? 'css-flat-malformed-at-rule-statement' : 'css-flat-unsupported-statement',
          isMalformedAtRule
            ? 'Flat CSS declaration parser skipped a malformed at-rule statement.'
            : 'Flat CSS declaration parser skipped a statement without a top-level block.',
          cursor,
          statementEnd + 1
        );
      }
      cursor = statementEnd + 1;
      continue;
    }
    if (blockStart === -1) {
      const trailing = source.slice(cursor, end).trim();
      if (trailing) {
        addDiagnostic(
          'warning',
          'css-flat-unsupported-trailing-source',
          'Flat CSS declaration parser skipped trailing source without a top-level block.',
          cursor,
          end
        );
      }
      break;
    }
    const blockEnd = findBalancedBlockEnd(source, blockStart, end);
    if (blockEnd === -1) {
      addDiagnostic(
        'error',
        'css-flat-unclosed-block',
        'Flat CSS declaration parser reached the end of source before the block closed.',
        blockStart,
        end
      );
      break;
    }
    const headerStart = trimStartOffset(source, cursor, blockStart);
    const headerEnd = trimEndOffset(source, headerStart, blockStart);
    const header = source.slice(headerStart, headerEnd);
    if (header[0] === '@') {
      const atRule = parseBlockAtRuleNode(source, cursor, blockStart, blockEnd, addDiagnostic);
      if (atRule) {
        children.push(atRule);
      } else {
        addDiagnostic(
          'warning',
          'css-flat-unsupported-at-rule',
          'Flat CSS declaration parser skipped an at-rule.',
          cursor,
          blockEnd + 1
        );
      }
    } else if (header) {
      const selector = parseCheapSelector(header);
      if (selector === undefined) {
        addDiagnostic(
          'warning',
          'css-flat-unsupported-selector',
          'Flat CSS declaration parser skipped a qualified rule with an unsupported selector.',
          cursor,
          blockEnd + 1
        );
      } else {
        let queuedDiagnostics: QueuedDiagnostic[] | undefined;
        const rules = parseDeclarationNodes(
          source,
          blockStart + 1,
          blockEnd,
          (...args) => {
            (queuedDiagnostics ??= []).push(args);
          }
        );
        if (rules.length === 0) {
          addDiagnostic(
            'warning',
            'css-flat-unsupported-nested-block',
            'Flat CSS declaration parser skipped a qualified rule with nested blocks.',
            cursor,
            blockEnd + 1
          );
          cursor = blockEnd + 1;
          continue;
        }
        if (queuedDiagnostics) {
          for (let i = 0; i < queuedDiagnostics.length; i++) {
            addDiagnostic(...queuedDiagnostics[i]!);
          }
        }
        const node = ruleset({
          selector,
          rules
        });
        setFieldSpan(node, RULESET_SELECTOR_FIELD, RULESET_FIELD_COUNT, headerStart, headerEnd);
        children.push(node);
      }
    }
    cursor = blockEnd + 1;
  }
  return children;
}

function setFieldSpan(node: Node, fieldIndex: number, fieldCount: number, start: number, end: number): void {
  setPackedFieldSpan(node.fieldSpans ??= createPackedFieldSpans(fieldCount), fieldIndex, start, end);
}

function trimStartOffset(source: string, start: number, end: number): number {
  let offset = start;
  while (offset < end && isWhitespaceCode(source.charCodeAt(offset))) {
    offset++;
  }
  return offset;
}

function trimEndOffset(source: string, start: number, end: number): number {
  let offset = end;
  while (offset > start && isWhitespaceCode(source.charCodeAt(offset - 1))) {
    offset--;
  }
  return offset;
}

function isWhitespaceCode(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
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
    diagnostics = appendParserDiagnostic(diagnostics, severity, code, message, start, end);
  };
  return {
    tree: stylesheet(parseCssNodes(source, 0, source.length, addDiagnostic)),
    source: sourceText,
    diagnostics: diagnostics ?? EMPTY_DIAGNOSTICS
  };
}

export function parseCssStylesheet(filePath: string, input: string | SourceText): Stylesheet {
  const result = parseFlatCssDeclarationStylesheet(filePath, input);
  const diagnostic = result.diagnostics[0];
  if (diagnostic) {
    const rendered = renderParserDiagnostic(result.source, diagnostic);
    throw new SyntaxError(`${rendered.filePath}:${rendered.line}:${rendered.column} ${rendered.message}`);
  }
  return result.tree;
}
