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
  scanCheapSelectorListComponents,
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

function parseDeclarationStatementNode(
  source: string,
  start: number,
  end: number
): Node | undefined {
  const textEnd = source[end - 1] === ';' ? end - 1 : end;
  const textStart = skipSourceTrivia(source, start, textEnd);
  const colon = findTopLevelDelimiter(source, ':', textStart, textEnd);
  if (colon === -1) {
    return undefined;
  }
  const name = source.slice(textStart, colon).trim();
  if (!name) {
    return undefined;
  }
  const isCustomProperty = name.startsWith('--');
  const valueText = source.slice(colon + 1, textEnd);
  const nameStart = trimStartOffset(source, textStart, colon);
  const nameEnd = trimEndOffset(source, nameStart, colon);
  const valueStart = isCustomProperty
    ? colon + 1
    : trimStartOffset(source, colon + 1, textEnd);
  const valueEnd = textEnd;
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
  return node;
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

function isMediaRangeValueCode(code: number): boolean {
  return (
    (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || (code >= 48 && code <= 57)
    || code === 45
    || code === 46
    || code === 95
    || code === 37
  );
}

function readMediaRangeAtom(source: string, start: number): [value: string, next: number] | undefined {
  let cursor = start;
  while (cursor < source.length && isMediaRangeValueCode(source.charCodeAt(cursor))) {
    cursor++;
  }
  return cursor === start ? undefined : [source.slice(start, cursor), cursor];
}

function readMediaRangeOperator(source: string, start: number): [value: string, next: number] | undefined {
  const char = source[start];
  if (char !== '<' && char !== '>' && char !== '=') {
    return undefined;
  }
  if (char === '=') {
    return source[start + 1] === '=' ? undefined : ['=', start + 1];
  }
  const next = source[start + 1] === '=' ? start + 2 : start + 1;
  return [source.slice(start, next), next];
}

function isMediaRangeIdentifierAtom(value: string): boolean {
  const code = value.charCodeAt(0);
  return (
    (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || code === 95
    || (
      code === 45
      && value.length > 1
      && (
        (value.charCodeAt(1) >= 65 && value.charCodeAt(1) <= 90)
        || (value.charCodeAt(1) >= 97 && value.charCodeAt(1) <= 122)
        || value.charCodeAt(1) === 45
        || value.charCodeAt(1) === 95
      )
    )
  );
}

function mediaRangeAtomNode(value: string): Node {
  return isMediaRangeIdentifierAtom(value) ? any(value, { role: 'ident' }) : any(value);
}

function isSupportedMediaRangeParts(parts: readonly Node[]): boolean {
  if (parts.length === 3) {
    return (
      isMediaRangeIdentifierAtom(parts[0]!.valueOf())
      !== isMediaRangeIdentifierAtom(parts[2]!.valueOf())
    );
  }
  if (parts.length !== 5) {
    return false;
  }
  const firstOperator = parts[1]!.valueOf();
  const secondOperator = parts[3]!.valueOf();
  return (
    firstOperator[0] === secondOperator[0]
    && firstOperator !== '='
    && secondOperator !== '='
    && isMediaRangeIdentifierAtom(parts[2]!.valueOf())
  );
}

function parseCheapMediaRangePrelude(text: string): AtRulePrelude | undefined {
  const source = text.trim();
  if (source.length < 3 || source[0] !== '(' || source[source.length - 1] !== ')') {
    return undefined;
  }
  const inner = source.slice(1, -1);
  const parts: Node[] = [];
  let cursor = skipSourceTrivia(inner, 0);
  let expectAtom = true;
  while (cursor < inner.length) {
    if (expectAtom) {
      const atom = readMediaRangeAtom(inner, cursor);
      if (!atom) {
        return undefined;
      }
      parts.push(mediaRangeAtomNode(atom[0]));
      cursor = atom[1];
    } else {
      const operator = readMediaRangeOperator(inner, cursor);
      if (!operator) {
        return undefined;
      }
      parts.push(any(operator[0], { role: 'operator' }));
      cursor = operator[1];
    }
    cursor = skipSourceTrivia(inner, cursor);
    expectAtom = !expectAtom;
  }
  if (expectAtom || !isSupportedMediaRangeParts(parts)) {
    return undefined;
  }
  return paren(query(parts));
}

function isPageSelectorNameCode(code: number): boolean {
  return (
    (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || (code >= 48 && code <= 57)
    || code === 45
    || code === 95
  );
}

function isPagePseudoName(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized === 'first' || normalized === 'left' || normalized === 'right' || normalized === 'blank';
}

function isCheapPageSelector(text: string): boolean {
  let cursor = 0;
  while (cursor < text.length && isPageSelectorNameCode(text.charCodeAt(cursor))) {
    cursor++;
  }
  while (cursor < text.length) {
    if (text[cursor] !== ':') {
      return false;
    }
    cursor++;
    const pseudoStart = cursor;
    while (cursor < text.length && isPageSelectorNameCode(text.charCodeAt(cursor))) {
      cursor++;
    }
    if (cursor === pseudoStart || !isPagePseudoName(text.slice(pseudoStart, cursor))) {
      return false;
    }
  }
  return cursor > 0;
}

function parseCheapPagePrelude(text: string): AtRulePrelude | undefined {
  const source = text.trim();
  if (!source) {
    return undefined;
  }
  const items: Node[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const comma = findTopLevelDelimiter(source, ',', cursor, source.length);
    const end = comma === -1 ? source.length : comma;
    const item = source.slice(cursor, end).trim();
    if (!isCheapPageSelector(item)) {
      return undefined;
    }
    items.push(any(item, { role: 'ident' }));
    if (comma === -1) {
      break;
    }
    cursor = comma + 1;
    if (skipSourceTrivia(source, cursor) >= source.length) {
      return undefined;
    }
  }
  return items.length === 0 ? undefined : list(items);
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
  const value = components.map((component) => {
    if (typeof component === 'string') {
      return component;
    }
    return materializeCheapCompound(component);
  });
  return sel(value);
}

function parseCheapSelector(selector: string): string | Selector | undefined {
  const selectorList = scanCheapSelectorListComponents(selector);
  if (!selectorList) {
    return undefined;
  }
  const items = selectorList.map(materializeCheapSelectorBranch);
  return items.length === 1 ? items[0]! : sellist(items);
}

function parseStatementNode(
  source: string,
  start: number,
  end: number
): Node | undefined {
  const textEnd = source[end - 1] === ';' ? end - 1 : end;
  const textStart = skipSourceTrivia(source, start, textEnd);
  if (source[textStart] === ';') {
    return any(';', { role: 'semi' });
  }
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
  const lowerName = name.toLowerCase();
  let prelude: AtRulePrelude | undefined;
  if (lowerName === '@page') {
    prelude = parseCheapPagePrelude(preludeText);
  } else {
    prelude = lowerName === '@media' ? parseCheapMediaRangePrelude(preludeText) : undefined;
    prelude ??= parseCheapAtRulePrelude(preludeText) ?? parseCheapAtRulePreludeList(preludeText);
  }
  if (preludeText && !prelude) {
    return undefined;
  }
  return atrule({
    name,
    ...(prelude !== undefined && { prelude }),
    rules: parseCssNodes(source, blockStart + 1, blockEnd, true, addDiagnostic)
  });
}

function parseCssNodes(
  source: string,
  start: number,
  end: number,
  allowDeclarations: boolean,
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
    const blockBoundary = blockStart === -1 ? end : blockStart;
    const declarationColon = allowDeclarations
      ? findTopLevelDelimiter(source, ':', cursor, blockBoundary)
      : -1;
    const declarationStatementEnd = declarationColon !== -1
      && blockStart !== -1
      && isCustomPropertyBlockDeclaration(source, cursor, declarationColon)
      ? findStatementEnd(source, cursor, end)
      : -1;
    if (declarationStatementEnd !== -1 || statementEnd < blockBoundary || blockStart === -1) {
      const statementBoundary = declarationStatementEnd !== -1 ? declarationStatementEnd : statementEnd;
      const statementLimit = statementBoundary < end ? statementBoundary + 1 : end;
      const statement = parseStatementNode(source, cursor, statementLimit)
        ?? (allowDeclarations ? parseDeclarationStatementNode(source, cursor, statementLimit) : undefined);
      if (statement) {
        children.push(statement);
      } else {
        const statementStart = skipSourceTrivia(source, cursor, statementLimit);
        const isMalformedAtRule = source[statementStart] === '@';
        addDiagnostic(
          'warning',
          isMalformedAtRule ? 'css-flat-malformed-at-rule-statement' : 'css-flat-unsupported-statement',
          isMalformedAtRule
            ? 'Flat CSS declaration parser skipped a malformed at-rule statement.'
            : allowDeclarations
              ? 'Flat CSS declaration parser skipped a statement without a top-level declaration colon.'
              : 'Flat CSS declaration parser skipped a statement without a top-level block.',
          cursor,
          statementLimit
        );
      }
      cursor = statementLimit;
      continue;
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
        const rules = parseCssNodes(
          source,
          blockStart + 1,
          blockEnd,
          true,
          (...args) => {
            (queuedDiagnostics ??= []).push(args);
          }
        );
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

function isCustomPropertyBlockDeclaration(source: string, start: number, colon: number): boolean {
  const nameStart = skipSourceTrivia(source, start, colon);
  const nameEnd = trimEndOffset(source, nameStart, colon);
  return source.startsWith('--', nameStart) && nameEnd > nameStart + 2;
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
 * intentionally avoids Chevrotain, structural documents, and deferred-field
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
    tree: stylesheet(parseCssNodes(source, 0, source.length, false, addDiagnostic)),
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
