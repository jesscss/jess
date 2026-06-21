import {
  any,
  atrule,
  atrulestatement,
  co,
  compound,
  decl,
  el,
  paren,
  query,
  rules,
  ruleset,
  sel,
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
  SourceText,
  type ScannerParseResult,
  type ParserDiagnostic,
  type SourceScannerOptions,
  skipQuotedSourceString,
  skipSourceTrivia
} from '@jesscss/parser';

export type FlatCssDeclarationStylesheetResult = ScannerParseResult<Stylesheet>;

const EMPTY_DIAGNOSTICS: readonly ParserDiagnostic[] = [];

export type CheapSelectorComponent =
  | string[]
  | ' '
  | '>'
  | '+'
  | '~';

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

function isSelectorNameCode(code: number): boolean {
  return (
    (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || (code >= 48 && code <= 57)
    || code === 45
    || code === 95
  );
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

function isPreludeAtomText(text: string): boolean {
  if (!text) {
    return false;
  }
  for (let i = 0; i < text.length; i++) {
    if (!isCssNameCode(text.charCodeAt(i))) {
      return false;
    }
  }
  return true;
}

function isSimpleParenPreludeText(text: string): boolean {
  if (!text) {
    return false;
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const code = text.charCodeAt(i);
    if (
      isCssNameCode(code)
      || (code >= 48 && code <= 57)
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

function parseParenthesizedPreludeAtom(text: string): Node | undefined {
  if (text.length < 2 || text[0] !== '(' || text[text.length - 1] !== ')') {
    return undefined;
  }
  const inner = text.slice(1, -1).trim();
  if (!isSimpleParenPreludeText(inner)) {
    return undefined;
  }
  return paren(any(inner));
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
      if (isSourceSelectorWhitespace(code)) {
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
 * Tokenize a deliberately tiny at-rule prelude subset into existing core nodes.
 *
 * Bare atoms stay strings. Simple balanced parenthesized atoms become
 * `Paren(Any(...))`; whitespace-separated top-level sequences become
 * `QueryCondition`. Commas, interpolation, nested conditions, and
 * general-enclosed syntax return `undefined` so callers can warn instead of
 * hiding unsupported structure as raw text.
 */
export function parseCheapAtRulePrelude(
  text: string,
  options?: SourceScannerOptions
): AtRulePrelude | undefined {
  const source = text.trim();
  if (!source) {
    return undefined;
  }
  if (isPreludeAtomText(source)) {
    return source;
  }
  const parenAtom = parseParenthesizedPreludeAtom(source);
  if (parenAtom) {
    return parenAtom;
  }
  const parts: Node[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const read = readPreludeToken(source, cursor, options);
    if (!read) {
      return undefined;
    }
    const [token, next] = read;
    const node = parseParenthesizedPreludeAtom(token) ?? (isPreludeAtomText(token) ? any(token) : undefined);
    if (!node) {
      return undefined;
    }
    parts.push(node);
    cursor = skipSourceTrivia(source, next, source.length, options);
  }
  return parts.length > 1 ? query(parts) : parts[0];
}

function isSelectorNameStartCode(code: number, allowUppercase: boolean): boolean {
  return (
    (code >= 97 && code <= 122)
    || (allowUppercase && code >= 65 && code <= 90)
    || code === 95
    || code === 45
  );
}

function isTypeSelectorStartCode(code: number): boolean {
  return (code >= 97 && code <= 122) || code === 95;
}

function scanBasicSelectorAtom(source: string, start: number): number {
  const first = source[start];
  if (first === '*') {
    return start + 1;
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

function materializeCheapCompound(component: string[]): Selector {
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
    if (isSourceSelectorWhitespace(code)) {
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

function parseCheapSelector(selector: string): string | Selector {
  const source = selector.trim();
  if (!source) {
    return selector;
  }
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

function isSourceSelectorWhitespace(code: number): boolean {
  return code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
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
  const prelude = parseCheapAtRulePrelude(preludeText);
  if (preludeText && !prelude) {
    return undefined;
  }
  return atrule({
    name,
    ...(prelude !== undefined && { prelude }),
    rules: rules(parseCssNodes(source, blockStart + 1, blockEnd, addDiagnostic))
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
    const header = source.slice(cursor, blockStart).trim();
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
    } else if (header && canParseFlatQualifiedRule(source, header, blockStart + 1, blockEnd)) {
      children.push(ruleset({
        selector: parseCheapSelector(header),
        rules: rules(parseDeclarationNodes(source, blockStart + 1, blockEnd, addDiagnostic))
      }));
    } else if (header) {
      addDiagnostic(
        'warning',
        'css-flat-unsupported-nested-block',
        'Flat CSS declaration parser skipped a qualified rule with nested blocks.',
        cursor,
        blockEnd + 1
      );
    }
    cursor = blockEnd + 1;
  }
  return children;
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
