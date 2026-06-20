import type { LanguageProfile } from '../profiles/index.js';
import {
  ScannerCursor,
  createParserDiagnostic,
  recoverToNextBoundary,
  scanBalancedDelimited,
  scanBlockComment,
  scanLineComment,
  scanString,
  scanTriviaInto,
  type ParserDiagnostic
} from '../scanner/index.js';
import { SourceText, sourceSpan, type SourceSpan, type TriviaRun } from '../source/index.js';
import { StructuralDocument } from './document.js';
import { FieldRangeTable } from './field-ranges.js';
import type {
  ErrorNode,
  ParseStructureInput,
  ParseStructureOptions,
  RawIslandNode,
  StructuralContainerNode,
  StructuralNode,
  StructuralStatementNode
} from './types.js';

/**
 * Builds a lightweight structural document from source text.
 *
 * The pass records ownership, trivia, diagnostics, and raw island ranges while
 * deferring language-specific AST parsing to service-layer providers.
 */
export function parseStructure(
  input: ParseStructureInput,
  profile: LanguageProfile,
  options: ParseStructureOptions = {}
): StructuralDocument {
  const source = typeof input === 'string' ? new SourceText(input) : input;
  const cursor = new ScannerCursor(source);
  const diagnostics: ParserDiagnostic[] = [];
  const trivia: TriviaRun[] = [];
  const islands: RawIslandNode[] = [];
  const fieldRanges = new FieldRangeTable<StructuralNode>();
  const root: StructuralContainerNode = {
    kind: 'document',
    start: 0,
    end: source.length,
    headerStart: 0,
    headerEnd: 0,
    bodyStart: 0,
    children: []
  };
  const stack: StructuralContainerNode[] = [root];

  while (!cursor.eof()) {
    scanTriviaInto(cursor, trivia, diagnostics, {
      lineComments: options.lineComments ?? profile.name !== 'css'
    });

    if (cursor.eof()) {
      break;
    }

    if (cursor.peekCode() === Char.CloseBrace) {
      closeCurrentBlock(cursor, stack, diagnostics, fieldRanges);
      continue;
    }

    const statementStart = cursor.offset;
    const parent = stack[stack.length - 1]!;
    const boundary = scanToStructuralBoundary(cursor, diagnostics, parent, statementStart);

    if (boundary.kind === 'block-open') {
      const block = createContainerNode(source, profile, statementStart, boundary.offset, parent);
      parent.children.push(block);
      appendContainerHeaderFieldRanges(source, block, fieldRanges);
      appendContainerIslands(source, profile, block, islands);
      stack.push(block);
      cursor.advance();
      continue;
    }

    if (boundary.kind === 'statement') {
      const statement = createStatementNode(source, profile, statementStart, boundary.offset, parent);
      if (statement) {
        parent.children.push(statement);
        appendStatementFieldRanges(statement, fieldRanges);
        appendIslands(source, profile, statement, islands);
      }
      cursor.advance();
      continue;
    }

    if (boundary.kind === 'eof') {
      const statement = createStatementNode(source, profile, statementStart, boundary.offset, parent);
      if (statement) {
        parent.children.push(statement);
        appendStatementFieldRanges(statement, fieldRanges);
        appendIslands(source, profile, statement, islands);
      }
    }
  }

  while (stack.length > 1) {
    const unclosed = stack.pop()!;
    const diagnostic = createParserDiagnostic({
      code: 'unclosed-block',
      message: 'Unclosed block.',
      start: unclosed.start,
      end: source.length,
      expected: '}',
      actual: 'end of file',
      context: unclosed.kind
    });
    diagnostics.push(diagnostic);
    unclosed.end = source.length;
    appendContainerBodyFieldRange(source, unclosed, fieldRanges);
    unclosed.children.push({
      kind: 'error',
      start: source.length,
      end: source.length,
      parent: unclosed,
      diagnostic
    });
  }

  return new StructuralDocument({
    source,
    profile,
    root,
    diagnostics,
    trivia,
    islands,
    fieldRanges
  });
}

type StructuralBoundary =
  | { kind: 'block-open'; offset: number }
  | { kind: 'statement'; offset: number }
  | { kind: 'eof'; offset: number };

/**
 * Scans forward to the next structural boundary.
 *
 * Balanced component-value blocks are consumed as opaque text so declarations
 * like CSS custom properties do not become nested structural containers.
 */
function scanToStructuralBoundary(
  cursor: ScannerCursor,
  diagnostics: ParserDiagnostic[],
  parent: StructuralContainerNode,
  statementStart: number
): StructuralBoundary {
  while (!cursor.eof()) {
    if (scanString(cursor, diagnostics)) {
      continue;
    }
    if (scanBlockComment(cursor, diagnostics)) {
      continue;
    }
    if (scanLineComment(cursor)) {
      continue;
    }

    const code = cursor.peekCode();

    if (code === Char.OpenParen || code === Char.OpenBracket) {
      scanBalancedDelimited(cursor, diagnostics);
      continue;
    }

    if (code === Char.OpenBrace && isComponentValueBlock(cursor, parent, statementStart)) {
      scanBalancedDelimited(cursor, diagnostics);
      continue;
    }

    if (code === Char.OpenBrace) {
      return { kind: 'block-open', offset: cursor.offset };
    }

    if (code === Char.Semicolon) {
      return { kind: 'statement', offset: cursor.offset };
    }

    if (code === Char.CloseBrace) {
      return { kind: 'eof', offset: cursor.offset };
    }

    cursor.advance();
  }

  return { kind: 'eof', offset: cursor.offset };
}

function isComponentValueBlock(
  cursor: ScannerCursor,
  parent: StructuralContainerNode,
  statementStart: number
): boolean {
  if (parent.kind === 'document') {
    return false;
  }

  const source = cursor.source.text;
  let colonOffset = -1;
  for (let offset = statementStart; offset < cursor.offset; offset++) {
    if (source.charCodeAt(offset) === Char.Colon) {
      colonOffset = offset;
      break;
    }
  }

  if (colonOffset === -1) {
    return false;
  }

  const nameStart = trimStart(cursor.source, statementStart, colonOffset);
  const nameEnd = trimEnd(cursor.source, nameStart, colonOffset);
  const name = cursor.source.slice(nameStart, nameEnd);
  return (
    name.startsWith('--')
    || DECLARATION_NAME_PATTERN.test(name)
    || name.startsWith('$')
    || name.startsWith('@{')
    || name.startsWith('${')
  );
}

/** Creates a container node and classifies its header without parsing children. */
function createContainerNode(
  source: SourceText,
  profile: LanguageProfile,
  start: number,
  openOffset: number,
  parent: StructuralContainerNode
): StructuralContainerNode {
  const headerStart = trimStart(source, start, openOffset);
  const headerEnd = trimEnd(source, headerStart, openOffset);
  const headerText = source.slice(headerStart, headerEnd);
  const ruleKind = profile.classifyRuleHeader(source, sourceSpan(headerStart, headerEnd));
  const kind =
    AT_RULE_HEADER_PATTERN.test(headerText) ? 'at-rule' : ruleKind === 'mixin-definition' ? 'mixin-definition' : 'rule';

  return {
    kind,
    start: headerStart,
    end: source.length,
    headerStart,
    headerEnd,
    bodyStart: openOffset + 1,
    parent,
    children: []
  };
}

function createStatementNode(
  source: SourceText,
  profile: LanguageProfile,
  start: number,
  end: number,
  parent: StructuralContainerNode
): StructuralStatementNode | undefined {
  const trimmedStart = trimStart(source, start, end);
  const trimmedEnd = trimEnd(source, trimmedStart, end);
  if (trimmedStart >= trimmedEnd) {
    return undefined;
  }

  const text = source.slice(trimmedStart, trimmedEnd);
  const colon = findTopLevelColon(text);
  const atImport = IMPORT_STATEMENT_PATTERN.test(text);
  const atRuleStatement = AT_RULE_HEADER_PATTERN.exec(text)?.[0];
  const atInclude = INCLUDE_STATEMENT_PATTERN.test(text);

  if (atImport) {
    const nameEnd = trimmedStart + 7;
    return statement('import', trimmedStart, trimmedEnd, trimmedStart, nameEnd, trimStart(source, nameEnd, trimmedEnd), trimmedEnd, parent);
  }

  if (colon === -1 && atRuleStatement) {
    const nameEnd = trimmedStart + atRuleStatement.length;
    return statement(
      'at-rule-statement',
      trimmedStart,
      trimmedEnd,
      trimmedStart,
      nameEnd,
      trimStart(source, nameEnd, trimmedEnd),
      trimmedEnd,
      parent
    );
  }

  if (atInclude) {
    const nameEnd = trimmedStart + 8;
    return statement('mixin-call', trimmedStart, trimmedEnd, trimmedStart, nameEnd, trimStart(source, nameEnd, trimmedEnd), trimmedEnd, parent);
  }

  if (colon !== -1) {
    const nameStart = trimmedStart;
    const nameEnd = trimEnd(source, nameStart, trimmedStart + colon);
    const valueStart = trimStart(source, trimmedStart + colon + 1, trimmedEnd);
    const declarationKind = profile.classifyDeclarationName(source, sourceSpan(nameStart, nameEnd));
    return statement(
      declarationKind === 'variable' ? 'variable-declaration' : 'declaration',
      trimmedStart,
      trimmedEnd,
      nameStart,
      nameEnd,
      valueStart,
      trimmedEnd,
      parent
    );
  }

  return statement('mixin-call', trimmedStart, trimmedEnd, trimmedStart, trimmedEnd, trimmedEnd, trimmedEnd, parent);
}

function statement(
  kind: StructuralStatementNode['kind'],
  start: number,
  end: number,
  nameStart: number,
  nameEnd: number,
  valueStart: number,
  valueEnd: number,
  parent: StructuralContainerNode
): StructuralStatementNode {
  return { kind, start, end, nameStart, nameEnd, valueStart, valueEnd, parent };
}

function appendContainerHeaderFieldRanges(
  source: SourceText,
  node: StructuralContainerNode,
  fieldRanges: FieldRangeTable<StructuralNode>
): void {
  if (node.kind === 'at-rule') {
    const name = AT_RULE_HEADER_PATTERN.exec(source.slice(node.headerStart, node.headerEnd))?.[0];
    if (name) {
      fieldRanges.add(node, 'name', 0, node.headerStart, node.headerStart + name.length, 'at-rule-name');
    }
    const prelude = atRulePreludeSpan(source, node.headerStart, node.headerEnd);
    if (prelude.start < prelude.end) {
      fieldRanges.add(node, 'prelude', 0, prelude.start, prelude.end, 'prelude');
    }
  } else if (node.kind === 'rule' || node.kind === 'mixin-definition') {
    fieldRanges.add(node, 'selector', 0, node.headerStart, node.headerEnd, 'selector');
  }
}

function appendContainerBodyFieldRange(
  source: SourceText,
  node: StructuralContainerNode,
  fieldRanges: FieldRangeTable<StructuralNode>
): void {
  const bodyStart = trimStart(source, node.bodyStart, node.end);
  const bodyEnd = trimEnd(source, bodyStart, Math.max(bodyStart, node.end - 1));
  if (bodyStart < bodyEnd) {
    fieldRanges.add(node, 'body', 0, bodyStart, bodyEnd, 'body-text');
  }
}

function appendStatementFieldRanges(
  node: StructuralStatementNode,
  fieldRanges: FieldRangeTable<StructuralNode>
): void {
  const nameKind = node.kind === 'mixin-call'
    ? 'mixin-name'
    : node.kind === 'import'
      ? 'import-name'
      : node.kind === 'at-rule-statement'
        ? 'at-rule-name'
        : 'declaration-name';
  fieldRanges.add(node, 'name', 0, node.nameStart, node.nameEnd, nameKind);
  if (node.valueStart < node.valueEnd) {
    const valueField = node.kind === 'import' || node.kind === 'at-rule-statement' ? 'prelude' : 'value';
    const valueKind = node.kind === 'import' || node.kind === 'at-rule-statement' ? 'prelude' : 'value';
    fieldRanges.add(node, valueField, 0, node.valueStart, node.valueEnd, valueKind);
  }
}

function closeCurrentBlock(
  cursor: ScannerCursor,
  stack: StructuralContainerNode[],
  diagnostics: ParserDiagnostic[],
  fieldRanges: FieldRangeTable<StructuralNode>
): void {
  if (stack.length === 1) {
    const start = cursor.offset;
    const recovery = recoverToNextBoundary(cursor);
    if (cursor.offset === start) {
      cursor.advance();
    }
    const diagnostic = createParserDiagnostic({
      code: 'unexpected-block-close',
      message: 'Unexpected block close.',
      start,
      end: cursor.offset,
      expected: 'statement or block',
      actual: '}',
      context: 'block',
      recoveryBoundary: recovery.end
    });
    diagnostics.push(diagnostic);
    stack[0]!.children.push({
      kind: 'error',
      start,
      end: cursor.offset,
      parent: stack[0],
      diagnostic
    } satisfies ErrorNode);
    return;
  }

  const block = stack.pop()!;
  cursor.advance();
  block.end = cursor.offset;
  appendContainerBodyFieldRange(cursor.source, block, fieldRanges);
}

/**
 * Adds island records owned by a statement node.
 *
 * These records are side-indexed rather than inserted as children, keeping the
 * structural tree stable for callers that never materialize language ASTs.
 */
function appendIslands(
  source: SourceText,
  profile: LanguageProfile,
  owner: StructuralStatementNode,
  islands: RawIslandNode[]
): void {
  if (owner.kind === 'mixin-call') {
    const islandKinds = profile.classifyIsland(
      source,
      sourceSpan(owner.nameStart, owner.nameEnd),
      { parentKind: 'rule', statementKind: 'mixin-call' }
    );
    for (const islandKind of islandKinds) {
      islands.push({
        kind: 'raw-island',
        islandKind,
        start: owner.nameStart,
        end: owner.nameEnd,
        parent: owner.parent,
        owner
      });
    }
    return;
  }

  const islandKinds = profile.classifyIsland(
    source,
    sourceSpan(owner.valueStart, owner.valueEnd),
    {
      parentKind: owner.kind === 'declaration' || owner.kind === 'variable-declaration'
        ? 'declaration'
        : owner.kind === 'at-rule-statement'
          ? 'at-rule'
          : undefined,
      statementKind: owner.kind === 'variable-declaration'
        ? 'variable'
        : owner.kind === 'at-rule-statement'
          ? 'at-rule'
          : undefined
    }
  );

  for (const islandKind of islandKinds) {
    islands.push({
      kind: 'raw-island',
      islandKind,
      start: owner.valueStart,
      end: owner.valueEnd,
      parent: owner.parent,
      owner
    });
  }
}

/** Adds lazy island records for rule and at-rule headers. */
function appendContainerIslands(
  source: SourceText,
  profile: LanguageProfile,
  owner: StructuralContainerNode,
  islands: RawIslandNode[]
): void {
  const atRuleName = owner.kind === 'at-rule'
    ? AT_RULE_HEADER_PATTERN.exec(source.slice(owner.headerStart, owner.headerEnd))?.[0]
    : undefined;
  const span = owner.kind === 'at-rule'
    ? atRulePreludeSpan(source, owner.headerStart, owner.headerEnd)
    : sourceSpan(owner.headerStart, owner.headerEnd);
  if (span.start >= span.end) {
    return;
  }
  const islandKinds = profile.classifyIsland(
    source,
    span,
    {
      parentKind: owner.kind === 'at-rule' ? 'at-rule' : 'document',
      statementKind: 'rule',
      atRuleName
    }
  );

  for (const islandKind of islandKinds) {
    islands.push({
      kind: 'raw-island',
      islandKind,
      start: span.start,
      end: span.end,
      parent: owner.parent,
      owner
    });
  }
}

function atRulePreludeSpan(source: SourceText, start: number, end: number): SourceSpan {
  const header = source.slice(start, end);
  const name = AT_RULE_HEADER_PATTERN.exec(header)?.[0];
  const offset = name ? start + name.length : start;
  return sourceSpan(trimStart(source, offset, end), end);
}

/**
 * Finds a declaration colon that is not nested inside brackets or parens.
 *
 * This preserves common selector and function syntax while staying scanner-only.
 */
function findTopLevelColon(text: string): number {
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === Char.OpenParen) {
      parenDepth++;
    } else if (code === Char.CloseParen && parenDepth > 0) {
      parenDepth--;
    } else if (code === Char.OpenBracket) {
      bracketDepth++;
    } else if (code === Char.CloseBracket && bracketDepth > 0) {
      bracketDepth--;
    } else if (code === Char.Colon && parenDepth === 0 && bracketDepth === 0) {
      return i;
    }
  }

  return -1;
}

function trimStart(source: SourceText, start: number, end: number): number {
  let offset = start;
  while (offset < end && isWhitespaceCode(source.text.charCodeAt(offset))) {
    offset++;
  }
  return offset;
}

function trimEnd(source: SourceText, start: number, end: number): number {
  let offset = end;
  while (offset > start && isWhitespaceCode(source.text.charCodeAt(offset - 1))) {
    offset--;
  }
  return offset;
}

const DECLARATION_NAME_PATTERN = /^[*@]?[a-zA-Z_-][\w-]*$/;
const AT_RULE_HEADER_PATTERN = /^@[-\w]+/;
const IMPORT_STATEMENT_PATTERN = /^@import\b/;
const INCLUDE_STATEMENT_PATTERN = /^@include\b/;

function isWhitespaceCode(code: number): boolean {
  return code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
}

const enum Char {
  CloseBrace = 125,
  CloseBracket = 93,
  CloseParen = 41,
  Colon = 58,
  OpenBrace = 123,
  OpenBracket = 91,
  OpenParen = 40,
  Semicolon = 59
}
