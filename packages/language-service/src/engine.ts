import { CssParser } from '@jesscss/css-parser';
import { Parser as LessParser } from '@jesscss/less-parser';
import { Parser as ScssParser } from '@jesscss/scss-parser';
import type { IParseResult, Rules, Node } from '@jesscss/core';
import { getErrorFromParser, toDiagnostic, getValues, isNode } from '@jesscss/core';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractImports, resolveImport } from '@jesscss/style-resolver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  CompletionItem,
  CompletionItemKind,
  CompletionList,
  Diagnostic,
  DiagnosticSeverity,
  DocumentSymbol,
  FoldingRange,
  FoldingRangeKind,
  Hover,
  Location,
  MarkupContent,
  MarkupKind,
  Position,
  Range,
  CodeAction,
  CodeActionContext,
  CodeActionKind,
  DocumentLink,
  WorkspaceEdit,
  SelectionRange,
  SemanticTokens,
  SymbolKind,
  TextEdit,
  ColorInformation,
  ColorPresentation
} from 'vscode-languageserver-types';

export type JessLang = 'css' | 'less' | 'scss' | 'jess';

type TrackedDoc = {
  document: TextDocument;
  lang: JessLang;
  parse: IParseResult<Rules> | null;
  index: JessIndex | null;
};

type JessIndexNode = {
  node: Node;
  start: number;
  end: number;
};

type JessIndex = {
  nodes: JessIndexNode[];
  findNodeAtOffset(offset: number): Node | null;
};

function getSpan(node: Node): { start: number; end: number } | null {
  const loc = (node as any).location as unknown;
  if (Array.isArray(loc) && loc.length === 6) {
    const start = Number(loc[0]);
    const end = Number(loc[3]);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      return { start, end };
    }
  }
  return null;
}

function buildJessIndex(root: Node): JessIndex {
  const out: JessIndexNode[] = [];
  const seen = new Set<Node>();
  const stack: Node[] = [root];

  while (stack.length) {
    const node = stack.pop()!;
    if (seen.has(node)) {
      continue;
    }
    seen.add(node);

    const span = getSpan(node);
    if (span) {
      out.push({ node, start: span.start, end: span.end });
    }

    const value = (node as any).data;
    for (const child of getValues(value)) {
      if (isNode(child)) {
        stack.push(child as Node);
      }
    }
  }

  out.sort((a, b) => (a.start - b.start) || (a.end - b.end));

  return {
    nodes: out,
    findNodeAtOffset(offset: number) {
      let best: JessIndexNode | null = null;
      for (const entry of out) {
        if (entry.start <= offset && offset <= entry.end) {
          if (!best) {
            best = entry;
          } else {
            const bestSpan = best.end - best.start;
            const entrySpan = entry.end - entry.start;
            if (entrySpan <= bestSpan) {
              best = entry;
            }
          }
        }
      }
      return best?.node ?? null;
    }
  };
}

// Parsers are expensive to construct: reuse instances.
const cssParser = new CssParser({ recoveryEnabled: true });
const lessParser = new LessParser({ recoveryEnabled: true });
const scssParser = new ScssParser({ recoveryEnabled: true });

function getJessLangFromLanguageId(languageId: string): JessLang {
  switch (languageId) {
    case 'less':
      return 'less';
    case 'scss':
      return 'scss';
    case 'jess':
      return 'jess';
    default:
      return 'css';
  }
}

function parseWithJess(text: string, lang: JessLang): IParseResult<Rules> {
  if (lang === 'less') {
    return lessParser.parse(text) as IParseResult<Rules>;
  }
  if (lang === 'scss') {
    return scssParser.parse(text) as IParseResult<Rules>;
  }
  // TODO: add dedicated .jess parser; for now treat as css-ish.
  return cssParser.parse(text) as IParseResult<Rules>;
}

function suggestWithJess(text: string, lang: JessLang, offset: number): Array<{ nextTokenType: string }> {
  try {
    if (lang === 'less') {
      return lessParser.suggest(text, { offset });
    }
    if (lang === 'scss') {
      return scssParser.suggest(text, { offset });
    }
    return cssParser.suggest(text, { offset });
  } catch {
    return [];
  }
}

function getCurrentWord(text: string, offset: number): string {
  const WORD_BREAKS = ' \t\n\r":{[()]},*>+;}';

  // Find word start (backwards from offset).
  let start = offset - 1;
  while (start >= 0 && WORD_BREAKS.indexOf(text.charAt(start)) === -1) {
    start--;
  }
  start++;

  // Find word end (forwards from offset).
  let end = offset;
  while (end < text.length && WORD_BREAKS.indexOf(text.charAt(end)) === -1) {
    end++;
  }

  return text.substring(start, end);
}

function findPropertyNameBeforeColon(text: string, offset: number): string | null {
  // Look backwards from offset to find the most recent `:` that's inside a block.
  // Then extract the property name before that colon.
  let depth = 0;
  let colonPos = -1;
  for (let i = Math.min(offset - 1, text.length - 1); i >= 0; i--) {
    const ch = text.charCodeAt(i);
    if (ch === 125) {
      depth++;
    } else if (ch === 123) {
      depth--;
      if (depth < 0) {
        break; // exited block
      }
    } else if (ch === 58 && depth === 0) {
      // Found `:` at block depth 0 (inside a ruleset block).
      colonPos = i;
      break;
    }
  }
  if (colonPos === -1) {
    return null;
  }

  // Extract property name: word characters before the colon.
  let start = colonPos - 1;
  while (start >= 0 && /[a-zA-Z0-9_-]/.test(text.charAt(start))) {
    start--;
  }
  const propName = text.substring(start + 1, colonPos).trim();
  return propName || null;
}

function toRange(document: TextDocument, startOffset: number, endOffset: number): Range {
  return {
    start: document.positionAt(Math.max(0, startOffset)),
    end: document.positionAt(Math.max(Math.max(0, startOffset), endOffset))
  };
}

function containsRange(range: Range, otherRange: Range): boolean {
  const otherStartLine = otherRange.start.line;
  const otherEndLine = otherRange.end.line;
  const rangeStartLine = range.start.line;
  const rangeEndLine = range.end.line;

  if (otherStartLine < rangeStartLine || otherEndLine < rangeStartLine) {
    return false;
  }
  if (otherStartLine > rangeEndLine || otherEndLine > rangeEndLine) {
    return false;
  }
  if (otherStartLine === rangeStartLine && otherRange.start.character < range.start.character) {
    return false;
  }
  if (otherEndLine === rangeEndLine && otherRange.end.character > range.end.character) {
    return false;
  }
  return true;
}

function pos(line1: number | undefined, col1: number | undefined): Position {
  return Position.create(Math.max(0, (line1 ?? 1) - 1), Math.max(0, (col1 ?? 1) - 1));
}

function rangeFrom(
  document: TextDocument,
  line: number,
  column: number,
  endLine?: number,
  endColumn?: number
): Range {
  const start = pos(line, column);
  const end = endLine ? pos(endLine, endColumn ?? column) : Position.create(start.line, start.character + 1);

  // Clamp via offset conversions to stay within bounds.
  const startOffset = document.offsetAt(start);
  const endOffset = Math.max(startOffset, document.offsetAt(end));
  return { start: document.positionAt(startOffset), end: document.positionAt(endOffset) } as Range;
}

// Data sources:
// - At-rules: from VS Code's published web custom data (npm package).
// - Properties: use the same package Less parser uses (`known-css-properties`).
// - Property values: from web custom data (properties have `values` arrays).
const require = createRequire(import.meta.url);
const webCssData = require('@vscode/web-custom-data/data/browsers.css-data.json') as {
  atDirectives?: Array<{ name: string; description?: string | { value: string; kind?: string } }>;
  properties?: Array<{ name: string; description?: string | { value: string; kind?: string }; values?: Array<{ name: string; description?: string | { value: string; kind?: string } }> }>;
};

type AtDirectiveEntry = { name: string; description?: string | { value: string; kind?: string } };
type PropertyEntry = { name: string; description?: string | { value: string; kind?: string }; values?: Array<{ name: string; description?: string | { value: string; kind?: string } }> };

const AT_RULES: string[] = (webCssData.atDirectives ?? []).map(d => d.name).filter(Boolean);
const AT_RULES_MAP = new Map<string, AtDirectiveEntry>();
for (const d of webCssData.atDirectives ?? []) {
  if (d.name) {
    AT_RULES_MAP.set(d.name.toLowerCase(), d);
  }
}

const knownCssProperties = require('known-css-properties') as { all?: unknown };
const CSS_PROPERTIES: string[] = Array.isArray(knownCssProperties.all) ? (knownCssProperties.all as string[]) : [];

// Build property name -> property data map for hover/completions.
const PROPERTIES_MAP = new Map<string, PropertyEntry>();
const PROPERTY_VALUES = new Map<string, string[]>();
for (const prop of webCssData.properties ?? []) {
  if (prop.name) {
    PROPERTIES_MAP.set(prop.name.toLowerCase(), prop);
    if (prop.values) {
      PROPERTY_VALUES.set(prop.name.toLowerCase(), prop.values.map(v => v.name).filter(Boolean) as string[]);
    }
  }
}

export type JessLanguageServiceEngine = {
  configure(config: unknown): void;
  open(uri: string, languageId: string, version: number, text: string): void;
  change(uri: string, version: number, text: string): void;
  close(uri: string): void;

  getCompletions(uri: string, position: Position): CompletionList;
  getHover(uri: string, position: Position): Hover | null;
  findDefinition(uri: string, position: Position): Location | null;
  findReferences(uri: string, position: Position): Location[];
  getDocumentSymbols(uri: string): DocumentSymbol[];
  getDiagnostics(uri: string): Diagnostic[];
  getFoldingRanges(uri: string): FoldingRange[];
  getSelectionRanges(uri: string, positions: Position[]): SelectionRange[];
  getCodeActions(uri: string, range: Range, context: CodeActionContext): CodeAction[];
  formatDocument(uri: string): TextEdit[];
  getDocumentLinks(uri: string): DocumentLink[];
  getSemanticTokens(uri: string): SemanticTokens;
  getDocumentColors(uri: string): Promise<ColorInformation[]> | ColorInformation[];
  getColorPresentations(uri: string, color: import('vscode-languageserver-types').Color, range: Range): ColorPresentation[];
};

// Keep in sync with server semantic token legend.
const SEMANTIC_TOKEN_TYPES = [
  'comment',
  'string',
  'keyword',
  'enumMember',
  'number',
  'operator',
  'function',
  'variable',
  'property',
  'type',
  'class',
  'namespace'
] as const;

type SemanticTokenType = (typeof SEMANTIC_TOKEN_TYPES)[number];

type ChevTok = {
  image: string;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  tokenType?: { name?: string; CATEGORIES?: Array<{ name?: string }> };
};

function tokenTypeFromChevrotain(tok: ChevTok, lang: JessLang): SemanticTokenType | null {
  const name = String(tok?.tokenType?.name ?? '');
  const cats: string[] = Array.isArray(tok?.tokenType?.CATEGORIES)
    ? tok.tokenType.CATEGORIES.map((c: any) => String(c?.name ?? '')).filter(Boolean)
    : [];

  const hasCat = (c: string) => cats.includes(c);

  if (name === 'WS' || name === 'Newline') {
    return null;
  }

  if (name.includes('Comment') || hasCat('Comment')) {
    return 'comment';
  }
  if (name.includes('String') || name.includes('Quoted')) {
    return 'string';
  }
  if (name === 'NonQuotedUrl' || name === 'UrlStart' || name === 'UrlEnd') {
    return 'string';
  }

  // Less: treat `@ident` as variable references by default (including inside at-rule preludes),
  // but keep *known* CSS at-rules (like `@media`) as at-rule names.
  if (lang === 'less' && /^@[_a-zA-Z]/.test(tok.image)) {
    if (AT_RULES_MAP.has(tok.image.toLowerCase())) {
      return 'namespace';
    }
    return 'variable';
  }

  // Less: `@var` is a variable, not an at-rule.
  // Less variables are commonly tokenized as AtKeyword (AtName category).
  if (lang === 'less' && (name === 'AtKeyword' || name === 'AtKeywordLessExtension')) {
    // Treat `@ident` as variable; keep `@-` / `@<digit>...` as at-rule-ish.
    if (/^@[_a-zA-Z]/.test(tok.image)) {
      return 'variable';
    }
  }

  // At-rules and keywords.
  // @charset is a special token that includes the entire declaration (e.g., '@charset "UTF-8";')
  // Treat it as namespace (at-rule) like other at-rules
  if (name === 'Charset') {
    return 'namespace';
  }
  if (hasCat('AtName') || /^At[A-Z]/.test(name)) {
    return 'namespace';
  }
  if (name === 'When' || name === 'DefaultGuardIdent' || name === 'DefaultGuardFunc') {
    return 'keyword';
  }

  // Variables.
  if (hasCat('VarOrProp') || name.includes('Variable') || name.includes('Var')) {
    return 'variable';
  }
  if (lang === 'scss' && name === 'Dollar') {
    return 'variable';
  }

  // Numbers (dimension tokens are split later into number+unit where possible).
  if (name.includes('Num') || name.includes('Int') || name.includes('Dimension') || name === 'Percent') {
    return 'number';
  }

  // Operators / punctuation that often gets styled.
  if (hasCat('CompareOperator') || name.includes('Operator') || name === 'Colon' || name === 'Semi') {
    return 'operator';
  }

  // Function calls.
  if (hasCat('FunctionStart') || name.includes('FunctionStart')) {
    return 'function';
  }

  // Selectors.
  if (name.includes('Pseudo')) {
    return 'class';
  }
  if (hasCat('Selector') || name.includes('HashName') || name.includes('DotName') || name.includes('Ampersand')) {
    return 'class';
  }

  // Plain identifiers: split later into property vs value where possible.
  if (hasCat('Ident') || name === 'PlainIdent') {
    return 'property';
  }

  return null;
}

function asStringName(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof (value as any).valueOf === 'function') {
    return String((value as any).valueOf());
  }
  if (value && typeof (value as any).data === 'string') {
    return String((value as any).data);
  }
  return String(value ?? '');
}

function formatVarName(lang: JessLang, rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) {
    return trimmed;
  }
  // Already has a sigil / prefix.
  if (trimmed.startsWith('@') || trimmed.startsWith('$') || trimmed.startsWith('--')) {
    return trimmed;
  }
  if (lang === 'less') {
    return `@${trimmed}`;
  }
  if (lang === 'scss') {
    return `$${trimmed}`;
  }
  return `--${trimmed}`;
}

export function createEngine(): JessLanguageServiceEngine {
  const docs = new Map<string, TrackedDoc>();
  // Import graph: maps URI -> Set of imported URIs
  const importGraph = new Map<string, Set<string>>();
  // Cached imported documents (loaded from disk)
  const importedDocs = new Map<string, TrackedDoc>();
  let semanticDiagnosticSeverities: Record<string, DiagnosticSeverity> = {
    /* eslint-disable @typescript-eslint/naming-convention */
    'var/undefined': DiagnosticSeverity.Warning,
    'mixin/undefined': DiagnosticSeverity.Warning
    /* eslint-enable @typescript-eslint/naming-convention */
  };

  function parseSeverity(value: unknown): DiagnosticSeverity | null {
    switch (value) {
      case 'error':
        return DiagnosticSeverity.Error;
      case 'warning':
        return DiagnosticSeverity.Warning;
      case 'information':
        return DiagnosticSeverity.Information;
      case 'hint':
        return DiagnosticSeverity.Hint;
      case 'off':
        return null;
      default:
        return null;
    }
  }

  function ensure(uri: string): TrackedDoc {
    const doc = docs.get(uri);
    if (!doc) {
      throw new Error(`Unknown document: ${uri}`);
    }
    return doc;
  }

  function reparse(t: TrackedDoc) {
    const text = t.document.getText();
    try {
      t.parse = parseWithJess(text, t.lang);
      // Build index even if there are parse errors (recovery mode may still produce partial tree)
      if (t.parse?.tree) {
        t.index = buildJessIndex(t.parse.tree as Node);
      } else {
        t.index = null;
      }
    } catch (e) {
      // On exception, still try to use partial parse result if available
      t.parse = null;
      t.index = null;
    }
  }

  // Load and parse an imported file from disk
  function loadImportedFile(importedUri: string, lang: JessLang, visited: Set<string>): TrackedDoc | null {
    // Check cache first
    const cached = importedDocs.get(importedUri);
    if (cached) {
      return cached;
    }

    // Try to read from disk
    let filePath: string;
    try {
      if (!importedUri.startsWith('file:')) {
        return null;
      }
      filePath = fileURLToPath(importedUri);
    } catch {
      return null;
    }

    if (!fs.existsSync(filePath)) {
      return null;
    }

    let text: string;
    try {
      text = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }

    // Infer language from file extension if not provided
    let inferredLang = lang;
    if (lang === 'css' || lang === 'jess') {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.less') {
        inferredLang = 'less';
      } else if (ext === '.scss') {
        inferredLang = 'scss';
      }
    }

    const document = TextDocument.create(importedUri, inferredLang, 0, text);
    const tracked: TrackedDoc = { document, lang: inferredLang, parse: null, index: null };
    reparse(tracked);
    importedDocs.set(importedUri, tracked);
    return tracked;
  }

  // Build import graph for a document (with cycle detection)
  function updateImportGraph(uri: string, tracked: TrackedDoc, visited: Set<string> = new Set()) {
    if (visited.has(uri)) {
      return; // Cycle detected
    }
    visited.add(uri);

    const imports = new Set<string>();
    const text = tracked.document.getText();
    const fromFilePath = (() => {
      try {
        return uri.startsWith('file:') ? fileURLToPath(uri) : null;
      } catch {
        return null;
      }
    })();

    if (fromFilePath) {
      for (const imp of extractImports(text, tracked.lang === 'jess' ? 'css' : tracked.lang)) {
        const resolved = resolveImport(
          { exists: (p: string) => fs.existsSync(p) },
          { lang: tracked.lang === 'jess' ? 'css' : tracked.lang, fromFilePath, specifier: imp.specifier }
        );
        if (resolved) {
          const importedUri = String(pathToFileURL(resolved.filePath));
          imports.add(importedUri);
          // Recursively load imported file (with cycle detection)
          // If file is already in docs, we still want to track it in the import graph
          // but we don't need to load it again
          if (!importedDocs.has(importedUri) && !visited.has(importedUri)) {
            // Check if file is already in docs - if so, use that instead of loading from disk
            const existingDoc = docs.get(importedUri);
            if (existingDoc) {
              importedDocs.set(importedUri, existingDoc);
              // Still build import graph for it
              updateImportGraph(importedUri, existingDoc, visited);
            } else {
              const loaded = loadImportedFile(importedUri, tracked.lang, visited);
              if (loaded) {
                // Recursively build import graph for imported file
                updateImportGraph(importedUri, loaded, visited);
              }
            }
          }
        }
      }
    }

    importGraph.set(uri, imports);
  }

  // Helper: find variable definition across documents
  function findVarDefinitionAcrossDocs(targetUri: string, normalizedName: string, visited: Set<string>): Location | null {
    if (visited.has(targetUri)) {
      return null; // Cycle detection
    }
    visited.add(targetUri);

    // Check current document
    const tracked = docs.get(targetUri) ?? importedDocs.get(targetUri);
    if (!tracked?.index) {
      return null;
    }

    for (const entry of tracked.index.nodes) {
      const n: any = entry.node;
      if (n.type === 'VarDeclaration') {
        const nameNode = n.data?.name;
        const declNameStr = asStringName(nameNode);
        const declName = declNameStr.replace(/^[$@]/, '');
        if (declName === normalizedName) {
          const span = getSpan(n);
          if (span) {
            return {
              uri: targetUri,
              range: toRange(tracked.document, span.start, span.end)
            };
          }
        }
      }
    }

    // Search imported files
    const imports = importGraph.get(targetUri);
    if (imports) {
      for (const importedUri of imports) {
        const result = findVarDefinitionAcrossDocs(importedUri, normalizedName, visited);
        if (result) {
          return result;
        }
      }
    }

    return null;
  }

  // Helper: find mixin definition across documents
  function findMixinDefinitionAcrossDocs(targetUri: string, mixinName: string, visited: Set<string>): Location | null {
    if (visited.has(targetUri)) {
      return null; // Cycle detection
    }
    visited.add(targetUri);

    // Check current document
    const tracked = docs.get(targetUri) ?? importedDocs.get(targetUri);
    if (!tracked?.index) {
      return null;
    }

    for (const entry of tracked.index.nodes) {
      const n: any = entry.node;
      if (n.type === 'Mixin') {
        const nameNode = n.data?.name;
        const declNameStr = asStringName(nameNode);
        let declName = declNameStr.trim();
        // Normalize mixin name: remove parentheses if present
        if (declName.endsWith('()')) {
          declName = declName.slice(0, -2);
        }
        if (declName === mixinName) {
          const span = getSpan(n);
          if (span) {
            return {
              uri: targetUri,
              range: toRange(tracked.document, span.start, span.end)
            };
          }
        }
      }
    }

    // Search imported files
    const imports = importGraph.get(targetUri);
    if (imports) {
      for (const importedUri of imports) {
        const result = findMixinDefinitionAcrossDocs(importedUri, mixinName, visited);
        if (result) {
          return result;
        }
      }
    }

    return null;
  }

  // Helper: find all variable references in a single document
  function findVarReferencesAcrossDocs(targetUri: string, normalizedName: string, visited: Set<string>, results: Location[]): void {
    if (visited.has(targetUri)) {
      return; // Already processed
    }
    visited.add(targetUri);

    // Check current document
    const tracked = docs.get(targetUri) ?? importedDocs.get(targetUri);
    if (!tracked?.index) {
      return;
    }

    for (const entry of tracked.index.nodes) {
      const n: any = entry.node;
      const span = getSpan(n);
      if (!span) {
        continue;
      }

      // Collect references
      if (n.type === 'Reference' && n.options?.type === 'variable') {
        const k = n.data?.key;
        const refName = typeof k === 'string' ? k : Array.isArray(k) ? k.join('') : null;
        if (refName && refName.replace(/^[$@]/, '') === normalizedName) {
          results.push({
            uri: targetUri,
            range: toRange(tracked.document, span.start, span.end)
          });
        }
      }

      // Collect the declaration itself
      if (n.type === 'VarDeclaration') {
        const nameNode = n.data?.name;
        const declNameStr = asStringName(nameNode);
        const declName = declNameStr.replace(/^[$@]/, '');
        if (declName === normalizedName) {
          results.push({
            uri: targetUri,
            range: toRange(tracked.document, span.start, span.end)
          });
        }
      }
    }
  }

  // Helper: find all mixin references in a single document
  function findMixinReferencesAcrossDocs(targetUri: string, mixinName: string, visited: Set<string>, results: Location[]): void {
    if (visited.has(targetUri)) {
      return; // Already processed
    }
    visited.add(targetUri);

    // Check current document
    const tracked = docs.get(targetUri) ?? importedDocs.get(targetUri);
    if (!tracked?.index) {
      return;
    }

    for (const entry of tracked.index.nodes) {
      const n: any = entry.node;
      const span = getSpan(n);
      if (!span) {
        continue;
      }

      // Collect references
      if (n.type === 'Reference' && (n.options?.type === 'mixin' || n.options?.type === 'mixin-ruleset')) {
        const k = n.data?.key;
        const refName = typeof k === 'string' ? k : Array.isArray(k) ? k.join('') : null;
        let refNameStr = refName ? refName.trim() : '';
        // Normalize mixin name: remove parentheses if present
        if (refNameStr.endsWith('()')) {
          refNameStr = refNameStr.slice(0, -2);
        }
        if (refNameStr === mixinName) {
          results.push({
            uri: targetUri,
            range: toRange(tracked.document, span.start, span.end)
          });
        }
      }

      // Collect the declaration itself
      if (n.type === 'Mixin') {
        const nameNode = n.data?.name;
        const declNameStr = asStringName(nameNode);
        const declName = declNameStr.trim();
        if (declName === mixinName) {
          results.push({
            uri: targetUri,
            range: toRange(tracked.document, span.start, span.end)
          });
        }
      }
    }
  }

  return {
    configure(config) {
      // Expected shape (from client settings): { diagnostics?: { severity?: Record<string, string> } }
      // Example: { diagnostics: { severity: { "var/undefined": "error" } } }
      const severity = (config as any)?.diagnostics?.severity;
      if (severity && typeof severity === 'object') {
        const next: Record<string, DiagnosticSeverity> = { ...semanticDiagnosticSeverities };
        for (const [k, v] of Object.entries(severity as Record<string, unknown>)) {
          const parsed = parseSeverity(v);
          if (parsed === null) {
            // off or invalid: delete to fall back to default behavior (or skip if off explicitly)
            if (v === 'off') {
              // Mark as off by deleting and remembering absence; handled at lookup-time by parseSeverity.
              delete next[k];
            }
            continue;
          }
          next[k] = parsed;
        }
        semanticDiagnosticSeverities = next;
      }
    },

    open(uri, languageId, version, text) {
      const lang = getJessLangFromLanguageId(languageId);
      const document = TextDocument.create(uri, languageId, version, text);
      const tracked: TrackedDoc = { document, lang, parse: null, index: null };
      docs.set(uri, tracked);
      reparse(tracked);
      updateImportGraph(uri, tracked);
    },
    change(uri, version, text) {
      const tracked = ensure(uri);
      tracked.document = TextDocument.update(tracked.document, [{ text }], version);
      reparse(tracked);
      updateImportGraph(uri, tracked);
    },
    close(uri) {
      docs.delete(uri);
      importGraph.delete(uri);
      // Note: We keep importedDocs in cache even after close, as they may be referenced by other files
    },

    getCompletions(uri, position) {
      const tracked = ensure(uri);
      const document = tracked.document;
      const text = document.getText();
      const offset = document.offsetAt(position);
      const currentWord = getCurrentWord(text, offset);
      const replaceRange = toRange(document, offset - currentWord.length, offset);

      const suggestions = suggestWithJess(text, tracked.lang, offset).map(s => String(s.nextTokenType).toLowerCase());
      const wantsAt = currentWord.startsWith('@') || suggestions.some(t => t.includes('at'));
      const wantsIdent = suggestions.some(t => t.includes('ident')) || suggestions.length === 0;

      const items: CompletionItem[] = [];

      // Variable completions: Less @var, SCSS $var, CSS custom properties --x
      const wantVar =
        tracked.lang === 'less'
          ? currentWord.startsWith('@')
          : tracked.lang === 'scss'
            ? currentWord.startsWith('$')
            : currentWord.startsWith('--');

      if (wantVar && tracked.index) {
        const prefix = currentWord.toLowerCase();
        for (const { node } of tracked.index.nodes) {
          if ((node as any).type !== 'VarDeclaration') {
            continue;
          }
          const nameNode = (node as any).data?.name;
          if (!nameNode) {
            continue;
          }
          // Extract string value from node (might be Any node with valueOf(), or already a string)
          let nameStr: string;
          if (typeof nameNode === 'string') {
            nameStr = nameNode;
          } else if (nameNode && typeof nameNode.valueOf === 'function') {
            nameStr = String(nameNode.valueOf());
          } else if (nameNode && typeof nameNode.data === 'string') {
            nameStr = nameNode.data;
          } else {
            nameStr = String(nameNode);
          }
          // Remove prefix if present for normalization (SCSS already strips $, Less might keep @)
          const nameWithoutPrefix = nameStr.replace(/^[$@]/, '');
          const label =
            tracked.lang === 'less'
              ? `@${nameWithoutPrefix}`
              : tracked.lang === 'scss'
                ? `$${nameWithoutPrefix}`
                : `--${nameWithoutPrefix}`;

          if (prefix && !label.toLowerCase().startsWith(prefix.toLowerCase())) {
            continue;
          }

          items.push({
            label,
            kind: CompletionItemKind.Variable,
            textEdit: TextEdit.replace(replaceRange, label)
          });
        }
        if (items.length > 0) {
          return { isIncomplete: false, items };
        }
      }

      if (wantsAt) {
        const prefix = currentWord.toLowerCase();
        for (const name of AT_RULES) {
          if (prefix && !name.toLowerCase().startsWith(prefix)) {
            continue;
          }
          items.push({
            label: name,
            kind: CompletionItemKind.Keyword,
            textEdit: TextEdit.replace(replaceRange, name)
          });
        }
        return { isIncomplete: false, items };
      }

      if (wantsIdent) {
        // Check if we're in a property value context (after `:`).
        const propName = findPropertyNameBeforeColon(text, offset);
        if (propName) {
          const values = PROPERTY_VALUES.get(propName.toLowerCase());
          if (values && values.length > 0) {
            const prefix = currentWord.toLowerCase();
            for (const value of values) {
              if (prefix && !value.toLowerCase().startsWith(prefix)) {
                continue;
              }
              items.push({
                label: value,
                kind: CompletionItemKind.Value,
                textEdit: TextEdit.replace(replaceRange, value)
              });
            }
            if (items.length > 0) {
              return { isIncomplete: false, items };
            }
          }
        }

        // Otherwise, suggest property names (inside a block).
        let depth = 0;
        for (let i = 0; i < Math.min(offset, text.length); i++) {
          const ch = text.charCodeAt(i);
          if (ch === 123) {
            depth++;
          } else if (ch === 125) {
            depth = Math.max(0, depth - 1);
          }
        }
        if (depth > 0) {
          const prefix = currentWord.toLowerCase();
          for (const name of CSS_PROPERTIES) {
            if (prefix && !name.toLowerCase().startsWith(prefix)) {
              continue;
            }
            items.push({
              label: name,
              kind: CompletionItemKind.Property,
              textEdit: TextEdit.replace(replaceRange, name)
            });
          }
          return { isIncomplete: false, items };
        }
      }

      return { isIncomplete: false, items: [] };
    },

    getHover(uri, position) {
      const tracked = ensure(uri);
      const document = tracked.document;
      const text = document.getText();
      const offset = document.offsetAt(position);
      const word = getCurrentWord(text, offset);

      if (!word) {
        return null;
      }

      // Check for at-rule hover.
      if (word.startsWith('@')) {
        const entry = AT_RULES_MAP.get(word.toLowerCase());
        if (entry?.description) {
          const desc = typeof entry.description === 'string' ? entry.description : entry.description.value;
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: `**${entry.name}**\n\n${desc}`
            }
          };
        }
      }

      // Check for property name hover.
      const propEntry = PROPERTIES_MAP.get(word.toLowerCase());
      if (propEntry?.description) {
        const desc = typeof propEntry.description === 'string' ? propEntry.description : propEntry.description.value;
        return {
          contents: {
            kind: MarkupKind.Markdown,
            value: `**${propEntry.name}**\n\n${desc}`
          }
        };
      }

      // Check for property value hover (need to find the property name first).
      const propName = findPropertyNameBeforeColon(text, offset);
      if (propName) {
        const prop = PROPERTIES_MAP.get(propName.toLowerCase());
        if (prop?.values) {
          for (const val of prop.values) {
            if (val.name.toLowerCase() === word.toLowerCase()) {
              const desc = val.description
                ? (typeof val.description === 'string' ? val.description : val.description.value)
                : `Value for \`${propName}\``;
              return {
                contents: {
                  kind: MarkupKind.Markdown,
                  value: `**${val.name}**\n\n${desc}`
                }
              };
            }
          }
        }
      }

      return null;
    },

    findDefinition(uri, position) {
      const tracked = ensure(uri);
      const document = tracked.document;
      const index = tracked.index;
      if (!index) {
        return null;
      }

      const offset = document.offsetAt(position);
      let node = index.findNodeAtOffset(offset);
      if (!node) {
        return null;
      }

      // Walk up the tree to find Reference or Mixin if the node at position isn't one
      let targetNode: any = node;
      const maxDepth = 10; // Prevent infinite loops
      let depth = 0;
      while (depth < maxDepth && targetNode) {
        const n: any = targetNode;
        if (n.type === 'Reference' || n.type === 'Mixin') {
          break;
        }
        targetNode = (targetNode as any).parent;
        depth++;
      }
      if (!targetNode) {
        return null;
      }
      node = targetNode;

      // Variable definition lookup: find VarDeclaration for a Reference(type=variable).
      if ((node as any).type === 'Reference' && (node as any).options?.type === 'variable') {
        const key = (node as any).data?.key;
        const name = typeof key === 'string' ? key : Array.isArray(key) ? key.join('') : null;
        if (!name) {
          return null;
        }

        // Normalize name (strip prefix for comparison).
        const normalizedName = name.replace(/^[$@]/, '');

        // First search current document
        for (const entry of index.nodes) {
          const n: any = entry.node;
          if (n.type === 'VarDeclaration') {
            const nameNode = n.data?.name;
            const declNameStr = asStringName(nameNode);
            const declName = declNameStr.replace(/^[$@]/, '');
            if (declName === normalizedName) {
              const span = getSpan(n);
              if (span) {
                return {
                  uri,
                  range: toRange(document, span.start, span.end)
                };
              }
            }
          }
        }

        // Then search imported files
        return findVarDefinitionAcrossDocs(uri, normalizedName, new Set());
      }

      // Mixin definition lookup: find Mixin for a Reference(type=mixin or mixin-ruleset).
      if ((node as any).type === 'Reference' && ((node as any).options?.type === 'mixin' || (node as any).options?.type === 'mixin-ruleset')) {
        const key = (node as any).data?.key;
        const name = typeof key === 'string' ? key : Array.isArray(key) ? key.join('') : null;
        if (!name) {
          return null;
        }

        // Normalize mixin name: remove parentheses if present (e.g., ".button()" -> ".button")
        let mixinName = name.trim();
        if (mixinName.endsWith('()')) {
          mixinName = mixinName.slice(0, -2);
        }

        // First search current document
        for (const entry of index.nodes) {
          const n: any = entry.node;
          if (n.type === 'Mixin') {
            const nameNode = n.data?.name;
            const declNameStr = asStringName(nameNode);
            let declName = declNameStr.trim();
            // Normalize mixin name: remove parentheses if present
            if (declName.endsWith('()')) {
              declName = declName.slice(0, -2);
            }
            if (declName === mixinName) {
              const span = getSpan(n);
              if (span) {
                return {
                  uri,
                  range: toRange(document, span.start, span.end)
                };
              }
            }
          }
        }

        // Then search imported files
        return findMixinDefinitionAcrossDocs(uri, mixinName, new Set());
      }

      return null;
    },

    findReferences(uri, position) {
      const tracked = ensure(uri);
      const document = tracked.document;
      const index = tracked.index;
      if (!index) {
        return [];
      }

      const offset = document.offsetAt(position);
      let node = index.findNodeAtOffset(offset);
      if (!node) {
        return [];
      }

      // Walk up the tree to find VarDeclaration, Reference, or Mixin if the node at position isn't one
      let targetNode: any = node;
      const maxDepth = 10; // Prevent infinite loops
      let depth = 0;
      while (depth < maxDepth && targetNode) {
        const n: any = targetNode;
        if (n.type === 'VarDeclaration' || n.type === 'Mixin'
          || (n.type === 'Reference' && (n.options?.type === 'variable' || n.options?.type === 'mixin' || n.options?.type === 'mixin-ruleset'))) {
          break;
        }
        targetNode = (targetNode as any).parent;
        depth++;
      }
      if (!targetNode) {
        return [];
      }
      node = targetNode;

      // Find variable name from either a Reference or VarDeclaration.
      let targetName: string | null = null;
      let isVariable = false;
      let isMixin = false;

      if ((node as any).type === 'Reference' && (node as any).options?.type === 'variable') {
        const key = (node as any).data?.key;
        targetName = typeof key === 'string' ? key : Array.isArray(key) ? key.join('') : null;
        isVariable = true;
      } else if ((node as any).type === 'VarDeclaration') {
        const nameNode = (node as any).data?.name;
        targetName = asStringName(nameNode);
        isVariable = true;
      } else if ((node as any).type === 'Reference' && ((node as any).options?.type === 'mixin' || (node as any).options?.type === 'mixin-ruleset')) {
        const key = (node as any).data?.key;
        targetName = typeof key === 'string' ? key : Array.isArray(key) ? key.join('') : null;
        isMixin = true;
      } else if ((node as any).type === 'Mixin') {
        const nameNode = (node as any).data?.name;
        targetName = asStringName(nameNode);
        isMixin = true;
      }

      if (!targetName) {
        return [];
      }

      const out: Location[] = [];

      if (isVariable) {
        const normalizedTarget = targetName.replace(/^[$@]/, '');
        // Search all documents (current + imported + all open docs) with a shared visited set
        const visited = new Set<string>();
        const allDocs = new Set([...docs.keys(), ...importedDocs.keys()]);
        for (const docUri of allDocs) {
          findVarReferencesAcrossDocs(docUri, normalizedTarget, visited, out);
        }
      } else if (isMixin) {
        const mixinName = targetName.trim();
        // Search all documents (current + imported + all open docs) with a shared visited set
        const visited = new Set<string>();
        const allDocs = new Set([...docs.keys(), ...importedDocs.keys()]);
        for (const docUri of allDocs) {
          findMixinReferencesAcrossDocs(docUri, mixinName, visited, out);
        }
      }

      return out;
    },

    getDocumentSymbols(uri) {
      const tracked = ensure(uri);
      const document = tracked.document;
      const index = tracked.index;
      if (!index) {
        return [];
      }

      const result: DocumentSymbol[] = [];
      const seen = new Set<Node>();
      const parents: [DocumentSymbol, Range][] = [];

      // Helper to add a document symbol with hierarchy
      const addDocumentSymbol = (
        name: string,
        kind: SymbolKind,
        symbolNode: Node,
        nameNode: Node | null,
        bodyNode: Node | null
      ) => {
        const symbolSpan = getSpan(symbolNode);
        if (!symbolSpan) {
          return;
        }

        const range = toRange(document, symbolSpan.start, symbolSpan.end);
        let selectionRange: Range;
        if (nameNode) {
          const nameSpan = getSpan(nameNode);
          if (nameSpan) {
            const nameRange = toRange(document, nameSpan.start, nameSpan.end);
            if (containsRange(range, nameRange)) {
              selectionRange = nameRange;
            } else {
              selectionRange = Range.create(range.start, range.start);
            }
          } else {
            selectionRange = Range.create(range.start, range.start);
          }
        } else {
          selectionRange = Range.create(range.start, range.start);
        }

        const entry: DocumentSymbol = {
          name: name || '<undefined>',
          kind,
          range,
          selectionRange
        };

        // Find parent: pop from stack until we find one that contains this symbol
        let top = parents.length > 0 ? parents[parents.length - 1] : null;
        while (top && !containsRange(top[1], range)) {
          parents.pop();
          top = parents.length > 0 ? parents[parents.length - 1] : null;
        }

        if (top) {
          const topSymbol = top[0];
          if (!topSymbol.children) {
            topSymbol.children = [];
          }
          topSymbol.children.push(entry);
        } else {
          result.push(entry);
        }

        // If this symbol has a body, push it onto the parent stack
        if (bodyNode) {
          const bodySpan = getSpan(bodyNode);
          if (bodySpan) {
            const bodyRange = toRange(document, bodySpan.start, bodySpan.end);
            parents.push([entry, bodyRange]);
          }
        }
      };

      // Collect symbols in document order (index is already sorted)
      for (const entry of index.nodes) {
        const n = entry.node as any;
        if (!n || seen.has(n as Node)) {
          continue;
        }

        seen.add(n as Node);

        if (n.type === 'Ruleset') {
          const selector = n.data?.selector;
          const name = asStringName((n as any).valueOf?.() ?? (selector ? asStringName(selector) : 'ruleset'));
          const bodyNode = n.data?.rules;
          addDocumentSymbol(name, SymbolKind.Class, n as Node, selector as Node | null, bodyNode as Node | null);
        } else if (n.type === 'AtRule') {
          const nameNode = n.data?.name;
          const atRuleName = asStringName(nameNode);
          const bodyNode = n.data?.rules;
          addDocumentSymbol(atRuleName, SymbolKind.Namespace, n as Node, nameNode as Node | null, bodyNode as Node | null);
        } else if (n.type === 'VarDeclaration') {
          const nameNode = n.data?.name;
          const varName = formatVarName(tracked.lang, asStringName(nameNode));
          addDocumentSymbol(varName, SymbolKind.Variable, n as Node, nameNode as Node | null, null);
        } else if (n.type === 'Mixin') {
          const nameNode = n.data?.name;
          const mixinName = asStringName(n.data?.name ?? 'mixin');
          const bodyNode = n.data?.rules;
          addDocumentSymbol(mixinName, SymbolKind.Function, n as Node, nameNode as Node | null, bodyNode as Node | null);
        } else if (n.type === 'Func') {
          const nameNode = n.data?.name;
          const funcName = asStringName(n.nameKey ?? n.data?.name ?? 'function');
          const bodyNode = n.data?.body;
          addDocumentSymbol(funcName, SymbolKind.Function, n as Node, nameNode as Node | null, bodyNode as Node | null);
        }
      }

      return result;
    },

    getDiagnostics(uri) {
      const tracked = ensure(uri);
      const doc = tracked.document;
      const parse = tracked.parse;
      if (!parse) {
        return [];
      }

      const parseErrors = Array.isArray(parse.errors) ? parse.errors : [];
      const lexErrors = Array.isArray(parse.lexerResult?.errors) ? (parse.lexerResult?.errors ?? []) : [];

      const diagnostics: Diagnostic[] = [];

      const clampRange = (range: Range): Range => {
        const startOffset = doc.offsetAt(range.start);
        const endOffset = Math.max(startOffset, doc.offsetAt(range.end));
        return { start: doc.positionAt(startOffset), end: doc.positionAt(endOffset) } as Range;
      };

      const rangeFromTokenLike = (tok: any): Range | null => {
        if (!tok) {
          return null;
        }
        const startLine = tok.startLine ?? tok.line;
        const startCol = tok.startColumn ?? tok.column;
        const endLine = tok.endLine;
        const endCol = tok.endColumn;
        if (typeof startLine === 'number' && typeof startCol === 'number') {
          const start = pos(startLine, startCol);
          const end = typeof endLine === 'number'
            ? pos(endLine, typeof endCol === 'number' ? endCol : startCol)
            : Position.create(start.line, start.character + 1);
          return clampRange({ start, end } as Range);
        }
        return null;
      };

      const rangeFromOffsetLike = (err: any): Range | null => {
        const offset = err?.offset;
        const length = err?.length;
        if (typeof offset === 'number') {
          const start = doc.positionAt(Math.max(0, Math.min(doc.getText().length, offset)));
          const end = doc.positionAt(
            Math.max(0, Math.min(doc.getText().length, offset + (typeof length === 'number' ? Math.max(1, length) : 1)))
          );
          return clampRange({ start, end } as Range);
        }
        return null;
      };

      const rangeFromError = (err: any): Range => {
        return (
          rangeFromTokenLike(err?.token)
          ?? rangeFromTokenLike(err?.previousToken)
          ?? rangeFromTokenLike(err)
          ?? rangeFromOffsetLike(err)
          ?? clampRange({ start: Position.create(0, 0), end: Position.create(0, 1) } as Range)
        );
      };

      // Lexer errors.
      for (const err of lexErrors as any[]) {
        diagnostics.push({
          code: 'parse/lexer',
          source: 'jess',
          message: String(err?.message ?? 'Lexing error'),
          severity: DiagnosticSeverity.Error,
          range: rangeFromError(err)
        });
      }

      // Parser errors.
      for (const err of parseErrors as any[]) {
        diagnostics.push({
          code: 'parse/parser',
          source: 'jess',
          message: String(err?.message ?? 'Parsing error'),
          severity: DiagnosticSeverity.Error,
          range: rangeFromError(err)
        });
      }

      // Semantic diagnostics (only when syntax is clean to avoid noisy false-positives).
      if (parseErrors.length === 0 && lexErrors.length === 0 && parse.tree) {
        const declVars = new Set<string>();
        const declMixins = new Set<string>();
        const refsVar: Array<{ name: string; node: Node }> = [];
        const refsMixin: Array<{ name: string; node: Node }> = [];

        // Detect modern features by checking source text (more reliable than AST for at-rules)
        const text = doc.getText();
        let hasModernFeatures = false;
        if (tracked.lang === 'scss') {
          // Check for @use in SCSS
          hasModernFeatures = /@use\s+/.test(text);
        } else if (tracked.lang === 'less') {
          // Check for @from or @compose in Less
          hasModernFeatures = /@(from|compose)\s+/.test(text);
        }

        const normalizeVar = (raw: string) => raw.trim().replace(/^[$@]/, '').toLowerCase();

        // Traverse full tree (do not rely on `tracked.index.nodes`, since some nodes (e.g. Reference)
        // may not have a location span, but their children do).
        const stack: Node[] = [parse.tree as unknown as Node];
        const seen = new Set<Node>();
        while (stack.length) {
          const node = stack.pop()!;
          if (!node || seen.has(node)) {
            continue;
          }
          seen.add(node);

          const n: any = node;
          if (n.type === 'VarDeclaration') {
            const nameNode = n.data?.name;
            const nameStr = typeof nameNode === 'string' ? nameNode : String(nameNode?.valueOf?.() ?? nameNode?.data ?? '');
            const norm = normalizeVar(nameStr);
            if (norm) {
              declVars.add(norm);
            }
          } else if (n.type === 'Mixin') {
            const nameNode = n.data?.name;
            const nameStr = asStringName(nameNode);
            // Normalize mixin name: remove parentheses and arguments if present (e.g., ".light()" -> ".light", ".light(arg)" -> ".light")
            let norm = nameStr.trim();
            const parenIdx = norm.indexOf('(');
            if (parenIdx >= 0) {
              norm = norm.slice(0, parenIdx);
            }
            if (norm) {
              declMixins.add(norm);
            }
          } else if (n.type === 'Reference' && n.options?.type === 'variable') {
            const key = n.data?.key;
            const raw = typeof key === 'string' ? key : Array.isArray(key) ? key.join('') : String(key?.valueOf?.() ?? '');
            const norm = normalizeVar(raw);
            if (norm) {
              refsVar.push({ name: norm, node });
            }
          } else if (n.type === 'Call') {
            // Mixin calls can be Call nodes (e.g., .light() or .light(arg))
            // In Less, only .foo() and #foo() are mixins - everything else is a function call
            const nameNode = n.data?.name;
            if (nameNode) {
              // Check if the call name is a Reference to a mixin
              const nameType = typeof nameNode === 'string' ? null : (nameNode as any)?.type;
              const nameOptions = typeof nameNode === 'string' ? null : (nameNode as any)?.options;
              if (nameType === 'Reference' && (nameOptions?.type === 'mixin' || nameOptions?.type === 'mixin-ruleset')) {
                const key = (nameNode as any).data?.key;
                const raw = typeof key === 'string' ? key : Array.isArray(key) ? key.join('') : String(key?.valueOf?.() ?? '');
                // Normalize mixin name: remove parentheses and arguments if present
                let nameStr = raw.trim();
                const parenIdx = nameStr.indexOf('(');
                if (parenIdx >= 0) {
                  nameStr = nameStr.slice(0, parenIdx);
                }
                // In Less, mixins must start with . or # - everything else is a function call
                if (tracked.lang === 'less' && nameStr && !nameStr.startsWith('.') && !nameStr.startsWith('#')) {
                  // Not a mixin in Less - it's a function call
                } else if (nameStr) {
                  refsMixin.push({ name: nameStr, node: n }); // Use Call node for span
                }
              } else if (typeof nameNode === 'string') {
                // Direct string name (e.g., "light" or ".light")
                let nameStr = nameNode.trim();
                const parenIdx = nameStr.indexOf('(');
                if (parenIdx >= 0) {
                  nameStr = nameStr.slice(0, parenIdx);
                }
                // In Less, mixins must start with . or # - everything else is a function call
                if (tracked.lang === 'less' && nameStr && !nameStr.startsWith('.') && !nameStr.startsWith('#')) {
                  // Not a mixin in Less - it's a function call
                } else if (nameStr) {
                  refsMixin.push({ name: nameStr, node: n });
                }
              }
            }
          } else if (n.type === 'Reference' && (n.options?.type === 'mixin' || n.options?.type === 'mixin-ruleset')) {
            const key = n.data?.key;
            const raw = typeof key === 'string' ? key : Array.isArray(key) ? key.join('') : String(key?.valueOf?.() ?? '');
            // Normalize mixin name: remove parentheses and arguments if present
            let nameStr = raw.trim();
            const parenIdx = nameStr.indexOf('(');
            if (parenIdx >= 0) {
              nameStr = nameStr.slice(0, parenIdx);
            }
            if (nameStr) {
              refsMixin.push({ name: nameStr, node });
            }
          } else if (n.type === 'Interpolated') {
            // Interpolated nodes contain replacement nodes in value.replacements
            // These replacement nodes should be collected as separate variable references
            // so each interpolation gets its own diagnostic span
            // IMPORTANT: We need to process replacements BEFORE getValues(value) to ensure
            // they're collected separately and not lost in the generic traversal
            const replacements = n.data?.replacements;
            if (Array.isArray(replacements)) {
              for (const replacementNode of replacements) {
                if (isNode(replacementNode)) {
                  // Push replacement node to stack so it gets processed
                  // This will allow Reference nodes inside replacements to be collected
                  stack.push(replacementNode as Node);
                }
              }
            }
            // Don't traverse Interpolated node's value with getValues - we've already handled replacements
            // The source string is not a node, so we skip it
            continue;
          }

          const value = (node as any).data;
          for (const child of getValues(value)) {
            if (isNode(child)) {
              stack.push(child as Node);
            }
          }
        }

        const severityFor = (code: string): DiagnosticSeverity | null => {
          const s = semanticDiagnosticSeverities[code];
          return typeof s === 'number' ? s : null;
        };

        const spanFor = (n: any): { start: number; end: number } | null => {
          // For Reference nodes inside interpolations, we need to find the @{...} boundaries FIRST
          // before falling back to other methods, because the Reference node span might only cover
          // the variable name, not the @{ and }
          // Check if this is a Reference node first, before any other checks
          if (n && n.type === 'Reference' && n.options?.type === 'variable') {
            // Check if this Reference is inside an Interpolated node by walking up the parent chain
            let isInInterpolation = false;
            let current: any = n;
            while (current && (current as any).parent) {
              current = (current as any).parent;
              if (current && current.type === 'Interpolated') {
                isInInterpolation = true;
                break;
              }
            }

            if (isInInterpolation) {
              // Get the Reference node's span (this is the variable name inside @{...})
              // The Reference node span should be just the variable name (e.g., "in" or "terpolation")
              // Try multiple ways to get the span:
              // 1. Direct span from the Reference node
              // 2. Span from the key node
              // 3. Span from the value.key if it's a node
              let actualRefSpan = getSpan(n as Node);
              if (!actualRefSpan) {
                const key = n?.data?.key;
                if (isNode(key)) {
                  actualRefSpan = getSpan(key as Node);
                }
              }

              if (actualRefSpan) {
                const refStartPos = doc.positionAt(actualRefSpan.start);
                const refEndPos = doc.positionAt(actualRefSpan.end);

                // Look backwards from reference start to find @{
                // The @{ should be immediately before the reference node
                let atBraceStart = actualRefSpan.start;
                if (refStartPos.character >= 2) {
                  // Check the 2 characters immediately before the reference
                  const lookBackStart = Math.max(0, refStartPos.character - 2);
                  const textBefore = doc.getText(Range.create(
                    Position.create(refStartPos.line, lookBackStart),
                    refStartPos
                  ));
                  if (textBefore === '@{') {
                    atBraceStart = doc.offsetAt(Position.create(refStartPos.line, lookBackStart));
                  } else {
                    // If not found immediately before, search backwards more carefully
                    // Look for the nearest @{ before this reference
                    for (let lookBack = 2; lookBack <= Math.min(20, refStartPos.character); lookBack++) {
                      const checkStart = Math.max(0, refStartPos.character - lookBack);
                      const checkText = doc.getText(Range.create(
                        Position.create(refStartPos.line, checkStart),
                        refStartPos
                      ));
                      if (checkText.endsWith('@{')) {
                        atBraceStart = doc.offsetAt(Position.create(refStartPos.line, checkStart));
                        break;
                      }
                    }
                  }
                }

                // Look forwards from reference end to find }
                // The } should be immediately after the reference node
                let braceEnd = actualRefSpan.end;
                const textAfter = doc.getText(Range.create(
                  refEndPos,
                  Position.create(refEndPos.line, Math.min(doc.getText().length, refEndPos.character + 1))
                ));
                if (textAfter.startsWith('}')) {
                  braceEnd = doc.offsetAt(Position.create(refEndPos.line, refEndPos.character + 1));
                } else {
                  // If not found immediately after, the reference span might be wrong
                  // Try to find } after the reference
                  const searchEnd = Math.min(doc.getText().length, refEndPos.character + 10);
                  const searchText = doc.getText(Range.create(
                    refEndPos,
                    Position.create(refEndPos.line, searchEnd)
                  ));
                  const braceIdx = searchText.indexOf('}');
                  if (braceIdx >= 0) {
                    braceEnd = doc.offsetAt(Position.create(refEndPos.line, refEndPos.character + braceIdx + 1));
                  }
                }

                // Return the full interpolation span including @{ and }
                // Only return if we found valid boundaries (atBraceStart should be before braceEnd)
                if (atBraceStart < braceEnd && atBraceStart >= 0 && braceEnd > atBraceStart) {
                  return { start: atBraceStart, end: braceEnd };
                }
                // If boundaries weren't found correctly, fall through to try other methods
              } else {
                // Reference node doesn't have a span - this shouldn't happen for interpolations
                // but if it does, try to get span from the key
                const key = n?.data?.key;
                if (isNode(key)) {
                  const keySpan = getSpan(key as Node);
                  if (keySpan) {
                    // Try to find @{ and } around the key span
                    const keyStartPos = doc.positionAt(keySpan.start);
                    const keyEndPos = doc.positionAt(keySpan.end);

                    let atBraceStart = keySpan.start;
                    if (keyStartPos.character >= 2) {
                      const lookBackStart = Math.max(0, keyStartPos.character - 2);
                      const textBefore = doc.getText(Range.create(
                        Position.create(keyStartPos.line, lookBackStart),
                        keyStartPos
                      ));
                      if (textBefore === '@{') {
                        atBraceStart = doc.offsetAt(Position.create(keyStartPos.line, lookBackStart));
                      }
                    }

                    let braceEnd = keySpan.end;
                    const textAfter = doc.getText(Range.create(
                      keyEndPos,
                      Position.create(keyEndPos.line, Math.min(doc.getText().length, keyEndPos.character + 1))
                    ));
                    if (textAfter.startsWith('}')) {
                      braceEnd = doc.offsetAt(Position.create(keyEndPos.line, keyEndPos.character + 1));
                    }

                    if (atBraceStart < braceEnd && atBraceStart >= 0 && braceEnd > atBraceStart) {
                      return { start: atBraceStart, end: braceEnd };
                    }
                  }
                }
              }
            }
          }

          // For Call nodes (mixin calls), the Call node itself should have location info
          // that includes the full call including parentheses
          const span = getSpan(n as Node);
          if (span) {
            return span;
          }

          // Fallback: use span of reference key (common for Less mixin-ruleset refs).
          const key = n?.data?.key;
          if (isNode(key)) {
            return getSpan(key as Node);
          }

          // For Call nodes, try to get span from the name node as fallback
          if (n.type === 'Call' && n.data?.name) {
            const nameNode = n.data.name;
            if (isNode(nameNode)) {
              return getSpan(nameNode as Node);
            }
          }

          return null;
        };

        for (const r of refsVar) {
          if (!declVars.has(r.name)) {
            // Determine severity: error if modern features are present, otherwise use configured severity
            let sev = severityFor('var/undefined');
            if (sev !== null) {
              // Override to error if modern features are detected
              if (hasModernFeatures) {
                sev = DiagnosticSeverity.Error;
              }
              const span = spanFor(r.node);
              if (span) {
                // For Reference nodes inside interpolations, ensure we use the node's actual span
                // and find @{...} boundaries around it
                const range = toRange(doc, span.start, span.end);
                diagnostics.push({
                  code: 'var/undefined',
                  source: 'jess',
                  message: `Undefined variable ${formatVarName(tracked.lang, r.name)}`,
                  severity: sev,
                  range
                });
              }
            }
          }
        }

        for (const r of refsMixin) {
          if (!declMixins.has(r.name)) {
            const sev = severityFor('mixin/undefined');
            if (sev !== null) {
              const span = spanFor(r.node);
              if (span) {
                diagnostics.push({
                  code: 'mixin/undefined',
                  source: 'jess',
                  message: `Undefined mixin ${r.name}`,
                  severity: sev,
                  range: toRange(doc, span.start, span.end)
                });
              }
            }
          }
        }
      }

      // Sort, dedupe, cap.
      diagnostics.sort((a, b) => {
        if (a.range.start.line !== b.range.start.line) {
          return a.range.start.line - b.range.start.line;
        }
        return a.range.start.character - b.range.start.character;
      });
      const seen = new Set<string>();
      const out: Diagnostic[] = [];
      for (const d of diagnostics) {
        const key = `${d.code ?? ''}:${d.range.start.line}:${d.range.start.character}:${d.range.end.line}:${d.range.end.character}:${d.message}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        out.push(d);
        if (out.length >= 200) {
          break;
        }
      }

      return out;
    },

    getFoldingRanges(uri) {
      const tracked = ensure(uri);
      const doc = tracked.document;
      const index = tracked.index;
      if (!index) {
        return [];
      }

      const out: FoldingRange[] = [];
      const seen = new Set<string>();

      for (const entry of index.nodes) {
        const n: any = entry.node;
        // Only fold structural blocks.
        const foldable =
          n?.type === 'Ruleset'
          || n?.type === 'AtRule'
          || n?.type === 'Mixin'
          || n?.type === 'Func';
        if (!foldable) {
          continue;
        }

        const span = getSpan(entry.node);
        if (!span) {
          continue;
        }

        const start = doc.positionAt(span.start);
        const end = doc.positionAt(span.end);
        if (end.line <= start.line) {
          continue;
        }

        const key = `${start.line}:${end.line}:${n.type}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        out.push({
          startLine: start.line,
          endLine: end.line,
          kind: FoldingRangeKind.Region
        });

        if (out.length >= 2000) {
          break;
        }
      }

      out.sort((a, b) => (a.startLine - b.startLine) || (a.endLine - b.endLine));
      return out;
    },

    getSelectionRanges(uri, positions) {
      const tracked = ensure(uri);
      const doc = tracked.document;
      const index = tracked.index;
      if (!index) {
        return positions.map(p => ({ range: { start: p, end: p } as Range }));
      }

      const rangesForOffset = (offset: number): Range[] => {
        const containing: Array<{ start: number; end: number }> = [];
        for (const entry of index.nodes) {
          if (entry.start <= offset && offset <= entry.end) {
            containing.push({ start: entry.start, end: entry.end });
          }
        }
        containing.sort((a, b) => (a.end - a.start) - (b.end - b.start));
        const out: Range[] = [];
        const seen = new Set<string>();
        for (const c of containing) {
          const r = { start: doc.positionAt(c.start), end: doc.positionAt(c.end) } as Range;
          const key = `${r.start.line}:${r.start.character}:${r.end.line}:${r.end.character}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          out.push(r);
          if (out.length >= 50) {
            break;
          }
        }
        return out;
      };

      const toSelectionChain = (ranges: Range[]): SelectionRange => {
        if (ranges.length === 0) {
          const zero = Position.create(0, 0);
          return { range: { start: zero, end: zero } as Range };
        }
        const last = ranges[ranges.length - 1]!;
        let current: SelectionRange = { range: last };
        for (let i = ranges.length - 2; i >= 0; i--) {
          current = { range: ranges[i]!, parent: current };
        }
        return current;
      };

      return positions.map((pos) => {
        const offset = doc.offsetAt(pos);
        const ranges = rangesForOffset(offset);
        return toSelectionChain(ranges);
      });
    },

    getCodeActions(uri, range, context) {
      const tracked = ensure(uri);
      const doc = tracked.document;
      const actions: CodeAction[] = [];

      const diagnostics = Array.isArray(context?.diagnostics) ? context.diagnostics : [];
      const findNodeAt = (pos: Position) => tracked.index?.findNodeAtOffset(doc.offsetAt(pos)) ?? null;

      for (const diag of diagnostics as any[]) {
        const code = String(diag?.code ?? '');
        if (code === 'var/undefined') {
          // Try to recover variable name from AST at diagnostic range.
          const node: any = findNodeAt(diag.range?.start ?? range.start);
          let raw = '';
          if (node?.type === 'Reference' && node.options?.type === 'variable') {
            const key = node.data?.key;
            raw = typeof key === 'string' ? key : Array.isArray(key) ? key.join('') : String(key?.valueOf?.() ?? '');
          } else {
            raw = String(diag?.message ?? '').match(/Undefined variable\s+(.+)$/)?.[1] ?? '';
          }
          const name = raw.trim() || 'var';

          const insertText = tracked.lang === 'scss'
            ? `$${name.replace(/^[$@]/, '')}: ;\n`
            : tracked.lang === 'less'
              ? `@${name.replace(/^[$@]/, '')}: ;\n`
              : `--${name.replace(/^[$@]/, '')}: ;\n`;

          const edit: WorkspaceEdit = {
            changes: {
              [uri]: [
                TextEdit.insert(Position.create(0, 0), insertText)
              ]
            }
          };

          actions.push({
            title: `Create variable ${name}`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diag],
            edit
          });
        }

        if (code === 'mixin/undefined') {
          const node: any = findNodeAt(diag.range?.start ?? range.start);
          let name = '';
          if (node?.type === 'Reference' && (node.options?.type === 'mixin' || node.options?.type === 'mixin-ruleset')) {
            const key = node.data?.key;
            name = typeof key === 'string' ? key : Array.isArray(key) ? key.join('') : String(key?.valueOf?.() ?? '');
          } else {
            name = String(diag?.message ?? '').match(/Undefined mixin\s+(.+)$/)?.[1] ?? '';
          }
          name = name.trim() || '.mixin';

          const insertText = `${name}() {\n  \n}\n\n`;
          const endPos = doc.positionAt(doc.getText().length);
          const edit: WorkspaceEdit = {
            changes: {
              [uri]: [
                TextEdit.insert(endPos, (endPos.character === 0 ? '' : '\n') + insertText)
              ]
            }
          };

          actions.push({
            title: `Create mixin ${name}()`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diag],
            edit
          });
        }
      }

      return actions;
    },

    formatDocument(uri) {
      const tracked = ensure(uri);
      const doc = tracked.document;
      const parse = tracked.parse;
      const tree: any = parse?.tree as any;
      if (!tree || typeof tree.toTrimmedString !== 'function') {
        return [];
      }

      // Basic formatting: rely on core printer. This is intentionally conservative.
      const options = {
        compress: false,
        collapseNesting: false
      };
      let formatted = String(tree.toTrimmedString(options) ?? '');
      if (!formatted.endsWith('\n')) {
        formatted += '\n';
      }

      const fullRange: Range = {
        start: Position.create(0, 0),
        end: doc.positionAt(doc.getText().length)
      };

      // Avoid no-op edits.
      if (formatted === doc.getText() || formatted === doc.getText() + '\n') {
        return [];
      }

      return [TextEdit.replace(fullRange, formatted)];
    },

    getDocumentLinks(uri) {
      const tracked = ensure(uri);
      const doc = tracked.document;
      const text = doc.getText();

      const links: DocumentLink[] = [];
      const tryResolveFileTarget = (rawTarget: string): string => {
        const t = rawTarget.trim();
        if (!t) {
          return t;
        }
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t) || t.startsWith('file:')) {
          return t;
        }

        // Resolve relative paths for file:// documents.
        let basePath: string | null = null;
        try {
          if (doc.uri.startsWith('file:')) {
            basePath = path.dirname(fileURLToPath(doc.uri));
          }
        } catch {
          basePath = null;
        }

        // If we can't resolve, still return raw.
        if (!basePath) {
          return t;
        }

        // Strip query/hash for filesystem checks, but preserve for final URL.
        const m = t.match(/^([^?#]+)([?#].*)?$/);
        const filePart = m?.[1] ?? t;
        const suffix = m?.[2] ?? '';

        const resolvedBase = path.resolve(basePath, filePart);
        const ext = path.extname(filePart);
        const candidates: string[] = [resolvedBase];

        if (!ext) {
          if (tracked.lang === 'less') {
            candidates.push(`${resolvedBase}.less`, `${resolvedBase}.css`);
          } else if (tracked.lang === 'scss') {
            candidates.push(`${resolvedBase}.scss`, `${resolvedBase}.sass`, `${resolvedBase}.css`);
          } else {
            candidates.push(`${resolvedBase}.css`);
          }
        }

        const found = candidates.find(p => fs.existsSync(p));
        const finalPath = (found ?? candidates[0]!) + suffix;
        return String(pathToFileURL(finalPath));
      };

      const pushLink = (startOffset: number, endOffset: number, target: string) => {
        if (!target) {
          return;
        }
        const start = doc.positionAt(startOffset);
        const end = doc.positionAt(endOffset);
        if (start.line > end.line || (start.line === end.line && start.character >= end.character)) {
          return;
        }
        links.push({
          range: { start, end } as Range,
          target: tryResolveFileTarget(target)
        });
      };

      // 1) url(...) links (quoted or unquoted)
      // We keep this regex conservative to avoid false positives.
      const urlRe = /url\(\s*(?:'([^']+)'|"([^"]+)"|([^) \t\r\n]+))\s*\)/g;
      for (let m: RegExpExecArray | null; (m = urlRe.exec(text));) {
        const raw = m[1] ?? m[2] ?? m[3] ?? '';
        if (!raw) {
          continue;
        }
        const rawStartInMatch =
          m[1] != null ? m[0].indexOf(m[1]) : m[2] != null ? m[0].indexOf(m[2]) : m[0].indexOf(m[3] ?? '');
        const start = m.index + rawStartInMatch;
        const end = start + raw.length;
        pushLink(start, end, raw);
      }

      // 2) @import/@use links (tolerant extraction + real resolution).
      // Skip links for imports with interpolations (they're not static file links)
      const fromFilePath = (() => {
        try {
          return doc.uri.startsWith('file:') ? fileURLToPath(doc.uri) : null;
        } catch {
          return null;
        }
      })();
      for (const imp of extractImports(text, tracked.lang === 'jess' ? 'css' : tracked.lang)) {
        const raw = imp.specifier;
        const start = imp.specifierRange.startOffset;
        const end = imp.specifierRange.endOffset;

        // Check if this import specifier contains interpolations
        // Look for @{...} pattern in the specifier text
        const specifierText = text.substring(start, end);
        const hasInterpolation = /@\{[^}]+\}/.test(specifierText);

        // Skip creating links for interpolated imports
        if (hasInterpolation) {
          continue;
        }

        if (fromFilePath) {
          const resolved = resolveImport(
            { exists: (p: string) => fs.existsSync(p) },
            { lang: tracked.lang === 'jess' ? 'css' : tracked.lang, fromFilePath, specifier: raw }
          );
          if (resolved) {
            const targetUrl = String(pathToFileURL(resolved.filePath));
            pushLink(start, end, targetUrl);
            continue;
          }
        }
        pushLink(start, end, raw);
      }

      // 3) bare http(s):// links inside strings (common in docs/comments)
      const httpRe = /(https?:\/\/[^\s"'<>]+)\b/g;
      for (let m: RegExpExecArray | null; (m = httpRe.exec(text));) {
        const raw = m[1] ?? '';
        if (!raw) {
          continue;
        }
        pushLink(m.index, m.index + raw.length, raw);
      }

      // Dedupe by range+target.
      const seen = new Set<string>();
      const out: DocumentLink[] = [];
      for (const l of links) {
        const k = `${l.range.start.line}:${l.range.start.character}:${l.range.end.line}:${l.range.end.character}:${l.target ?? ''}`;
        if (seen.has(k)) {
          continue;
        }
        seen.add(k);
        out.push(l);
        if (out.length >= 1000) {
          break;
        }
      }
      return out;
    },

    getSemanticTokens(uri) {
      const tracked = ensure(uri);
      const doc = tracked.document;
      const parse = tracked.parse;
      const data: number[] = [];

      if (!parse?.lexerResult?.tokens) {
        return { data };
      }

      type Pending = { line: number; char: number; length: number; typeIdx: number; modifiers: number };
      const pending: Pending[] = [];

      // Chevrotain uses 1-based line/column.
      const tokens = parse.lexerResult.tokens as ChevTok[];
      const index = tracked.index;

      const nonWs = (t: ChevTok | undefined) => t && t.tokenType?.name !== 'WS' && t.tokenType?.name !== 'Newline';
      const prevNonWsIdx = (i: number) => {
        for (let j = i - 1; j >= 0; j--) {
          if (nonWs(tokens[j])) {
            return j;
          }
        }
        return -1;
      };
      const nextNonWsIdx = (i: number) => {
        for (let j = i + 1; j < tokens.length; j++) {
          if (nonWs(tokens[j])) {
            return j;
          }
        }
        return -1;
      };

      // tokenModifiers: ['declaration'] in server.ts
      const MOD_DECLARATION = 1 << 0;

      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]!;
        let type = tokenTypeFromChevrotain(tok, tracked.lang);

        // CRITICAL: Never override string tokens - strings should always remain strings
        // Even if they contain interpolations like @{variable}, the string parts should stay as strings
        // String tokens are identified by tokenTypeFromChevrotain and should never be overridden
        const isStringToken = type === 'string';

        // Check if this is a string token that will be split for interpolations
        // If so, we'll handle it specially and skip variable detection
        let willBeSplitForInterpolation = false;
        if (isStringToken && index) {
          const tokenOffset = doc.offsetAt(Position.create((tok.startLine ?? 1) - 1, (tok.startColumn ?? 1) - 1));
          const node = index.findNodeAtOffset(tokenOffset);
          let current: any = node;
          while (current) {
            if (current.type === 'Quoted' && current.data && current.data.type === 'Interpolated') {
              willBeSplitForInterpolation = true;
              break;
            }
            current = (current as any).parent;
          }
        }

        // Override classification using AST for:
        // 1. Function calls (Call nodes) - ensure they're classified as 'function'
        // 2. Variable references (Reference nodes) - ensure they're classified as 'variable'
        // This ensures accurate semantic token coloring based on actual AST structure
        // BUT: Never override string tokens - they should always remain strings
        // Interpolations within strings (like @{variable}) should be separate tokens, not override the string
        // Also skip if this string will be split for interpolation (handled separately)
        if (index && !isStringToken && !willBeSplitForInterpolation) {
          const tokStartLine = (tok.startLine ?? 1) - 1;
          const tokStartChar = (tok.startColumn ?? 1) - 1;
          const tokEndChar = (tok.endColumn ?? tokStartChar);

          // Check multiple points within the token to find the AST node
          const checkOffsets = [
            doc.offsetAt(Position.create(tokStartLine, tokStartChar)), // Start
            doc.offsetAt(Position.create(tokStartLine, Math.floor((tokStartChar + tokEndChar) / 2))), // Middle
            doc.offsetAt(Position.create(tokStartLine, tokEndChar)), // End
            // Also check just after the @ symbol for Less variables
            doc.offsetAt(Position.create(tokStartLine, tokStartChar + 1))
          ];

          let varRefNode: any = null;
          let callNode: any = null;
          const tokenImage = String(tok.image ?? '');

          // First check: if this looks like an at-rule, don't treat it as a variable
          // At-rules can be known (in AT_RULES_MAP) or unknown, but neither should be variables
          const isAtRuleToken = tracked.lang === 'less' && tokenImage.startsWith('@') && tokenImage.length > 1;
          const isKnownAtRule = isAtRuleToken && AT_RULES_MAP.has(tokenImage.toLowerCase());

          // If it's a known at-rule, ensure it's treated as namespace and skip variable detection
          if (isKnownAtRule) {
            // Don't override if it's already correctly classified
            if (type !== 'namespace') {
              type = 'namespace';
            }
          } else if (isAtRuleToken) {
            // Unknown at-rule: check if it looks like an at-rule by context
            // At-rules typically have { or ( after them (after optional whitespace)
            // We need to check the next non-whitespace token
            let nextTokenIdx = i + 1;
            while (nextTokenIdx < tokens.length && (tokens[nextTokenIdx]?.tokenType?.name === 'WS' || tokens[nextTokenIdx]?.tokenType?.name === 'Newline')) {
              nextTokenIdx++;
            }
            const nextToken = nextTokenIdx < tokens.length ? tokens[nextTokenIdx] : undefined;
            const nextType = String(nextToken?.tokenType?.name ?? '');
            const looksLikeAtRule = nextType === 'LCurly' || nextType === 'LParen';

            if (looksLikeAtRule) {
              // It's an unknown at-rule, treat as namespace
              if (type !== 'namespace') {
                type = 'namespace';
              }
            } else {
              // Not an at-rule, proceed with variable detection
              for (const offset of checkOffsets) {
                const node = index.findNodeAtOffset(offset);
                if (!node) {
                  continue;
                }

                // Check for Call node first (function calls take precedence)
                if ((node as any).type === 'Call') {
                  callNode = node;
                  break;
                }

                // Check the node itself for variable reference
                if ((node as any).type === 'Reference' && (node as any).options?.type === 'variable') {
                  varRefNode = node;
                  break;
                }

                // Walk up the parent chain to find a Call or Reference node
                // This handles cases where the token is inside a node (e.g., just the identifier part)
                let current: any = node;
                while (current && (current as any).parent) {
                  current = (current as any).parent;

                  // Check for Call node first (function calls take precedence)
                  if (current && current.type === 'Call') {
                    callNode = current;
                    break;
                  }

                  // Check for variable reference
                  if (current && current.type === 'Reference' && current.options?.type === 'variable') {
                    varRefNode = current;
                    break;
                  }
                }

                if (callNode || varRefNode) {
                  break;
                }
              }

              // Function calls take precedence - don't override if already 'function'
              if (callNode && type !== 'function') {
                type = 'function';
              } else if (varRefNode) {
                // This token is part of a variable reference, force it to be 'variable'
                type = 'variable';
                // Store that this is a variable reference so we can apply declaration modifier later
                // This makes variable references color the same as their declarations
                (tok as any)._isVarRef = true;
              }
            }
          } else {
            // Not an @ token (or not Less), check for function calls and variable references
            for (const offset of checkOffsets) {
              const node = index.findNodeAtOffset(offset);
              if (!node) {
                continue;
              }

              // Check for Call node first (function calls take precedence)
              if ((node as any).type === 'Call') {
                callNode = node;
                break;
              }

              // Check the node itself for variable reference
              if ((node as any).type === 'Reference' && (node as any).options?.type === 'variable') {
                varRefNode = node;
                break;
              }

              // Walk up the parent chain to find a Call or Reference node
              let current: any = node;
              while (current && (current as any).parent) {
                current = (current as any).parent;

                // Check for Call node first (function calls take precedence)
                if (current && current.type === 'Call') {
                  callNode = current;
                  break;
                }

                // Check for variable reference
                if (current && current.type === 'Reference' && current.options?.type === 'variable') {
                  varRefNode = current;
                  break;
                }
              }

              if (callNode || varRefNode) {
                break;
              }
            }

            // Function calls take precedence - ensure they're classified as 'function'
            if (callNode && type !== 'function') {
              type = 'function';
            } else if (varRefNode) {
              // This token is part of a variable reference, force it to be 'variable'
              type = 'variable';
              (tok as any)._isVarRef = true;
            }
          }
        }

        if (!type) {
          continue;
        }

        const prevIdx = prevNonWsIdx(i);
        const nextIdx = nextNonWsIdx(i);
        const prev = prevIdx >= 0 ? tokens[prevIdx] : undefined;
        const next = nextIdx >= 0 ? tokens[nextIdx] : undefined;
        const prev2Idx = prevIdx >= 0 ? prevNonWsIdx(prevIdx) : -1;
        const prev2 = prev2Idx >= 0 ? tokens[prev2Idx] : undefined;

        const line = (tok.startLine ?? 1) - 1;
        const startChar = (tok.startColumn ?? 1) - 1;
        const endChar = (tok.endColumn ?? (tok.startColumn ?? 1)) - 1;
        const length = Math.max(1, endChar - startChar + 1);

        // Clamp to document bounds via offset conversions.
        const startPos = Position.create(Math.max(0, line), Math.max(0, startChar));
        const endPos = Position.create(Math.max(0, line), Math.max(0, startChar + length));
        const startOffset = doc.offsetAt(startPos);
        const endOffset = Math.max(startOffset, Math.min(doc.getText().length, doc.offsetAt(endPos)));
        const start = doc.positionAt(startOffset);
        const end = doc.positionAt(endOffset);

        if (start.line !== end.line) {
          // If a token ever spans lines, just drop it (rare for these grammars).
          continue;
        }

        const fullLen = Math.max(1, end.character - start.character);
        const typeName = String(tok.tokenType?.name ?? '');

        // Special handling for Charset tokens: split into @charset (namespace) and quoted string (string)
        // The Charset token includes the entire '@charset "UTF-8";' as one token
        if (typeName === 'Charset' && typeof tok.image === 'string') {
          const image = tok.image;
          // Match: @charset followed by optional whitespace, then quoted string, then semicolon
          const match = image.match(/^(@charset\s*)(["'])([^"']*)\2(;?)$/);
          if (match && match[1] && match[3] !== undefined) {
            const atCharset = match[1];
            const quotedValue = match[3];
            const semicolon = match[4] || '';
            const atCharsetLen = atCharset.length;
            const quotedLen = quotedValue.length + 2; // +2 for the quotes
            const semicolonLen = semicolon.length;

            // Emit @charset as namespace
            if (atCharsetLen > 0) {
              pending.push({
                line,
                char: startChar,
                length: atCharsetLen,
                typeIdx: SEMANTIC_TOKEN_TYPES.indexOf('namespace'),
                modifiers: 0
              });
            }

            // Emit quoted string as string
            if (quotedLen > 0) {
              pending.push({
                line,
                char: startChar + atCharsetLen,
                length: quotedLen,
                typeIdx: SEMANTIC_TOKEN_TYPES.indexOf('string'),
                modifiers: 0
              });
            }

            // Emit semicolon as operator (if present)
            if (semicolonLen > 0) {
              pending.push({
                line,
                char: startChar + atCharsetLen + quotedLen,
                length: semicolonLen,
                typeIdx: SEMANTIC_TOKEN_TYPES.indexOf('operator'),
                modifiers: 0
              });
            }

            // Skip normal processing for this token since we've split it
            continue;
          }
        }

        // Special handling for string tokens with interpolations: split into string parts and interpolated parts
        // Example: "import/import-@{my_theme}-e.less" should be split so that:
        // - "import/import-" is colored as string (including opening quote)
        // - "@{my_theme}" is colored based on the inner node (variable, function, etc.)
        // - "-e.less" is colored as string (including closing quote)
        // This ensures quotes always look like quotes and don't "leak" variable token coloring
        // Uses AST node information (Interpolated nodes with %% placeholders) instead of regex
        // to handle complex expressions within interpolations correctly
        if (type === 'string' && index) {
          // Check multiple offsets within the token to find the Quoted node
          const tokenStartOffset = doc.offsetAt(Position.create(line, startChar));
          const tokenMidOffset = doc.offsetAt(Position.create(line, startChar + Math.floor(length / 2)));
          const tokenEndOffset = doc.offsetAt(Position.create(line, startChar + length - 1));

          const checkOffsets = [tokenStartOffset, tokenMidOffset, tokenEndOffset];

          // Check if this token corresponds to a Quoted node with an Interpolated value
          let quotedNode: any = null;
          let interpolatedNode: any = null;

          // Try multiple offsets to find the Quoted node
          for (const offset of checkOffsets) {
            const node = index.findNodeAtOffset(offset);
            if (!node) {
              continue;
            }

            // Walk up the parent chain to find a Quoted node
            let current: any = node;
            while (current) {
              if (current.type === 'Quoted') {
                quotedNode = current;
                // Check if the value is an Interpolated node
                if (current.data && current.data.type === 'Interpolated') {
                  interpolatedNode = current.data;
                }
                break;
              }
              current = (current as any).parent;
            }

            if (quotedNode && interpolatedNode) {
              break;
            }
          }

          // If we found an Interpolated node, split the token using AST information
          // The source string contains %% placeholders that mark where interpolations occur
          if (interpolatedNode && interpolatedNode.data && interpolatedNode.data.source && Array.isArray(interpolatedNode.data.replacements)) {
            const source = interpolatedNode.data.source; // String with %% placeholders
            const replacements = interpolatedNode.data.replacements; // Array of Node[]
            const quotedSpan = getSpan(quotedNode);

            if (quotedSpan && source.includes('%%')) {
              const quotedContentStart = quotedSpan.start + 1; // +1 for opening quote
              const quotedContentEnd = quotedSpan.end - 1; // -1 for closing quote

              // Get spans for all replacement nodes (interpolations) - these are in order
              const replacementSpans: Array<{ start: number; end: number; node: any }> = [];
              for (const replacementNode of replacements) {
                const span = getSpan(replacementNode);
                if (span) {
                  replacementSpans.push({ start: span.start, end: span.end, node: replacementNode });
                }
              }

              // Sort by start position to ensure correct order
              replacementSpans.sort((a, b) => a.start - b.start);

              // Emit the opening quote as a string token
              const quotedStartPos = doc.positionAt(quotedSpan.start);
              if (quotedStartPos.line === line) {
                pending.push({
                  line,
                  char: quotedStartPos.character,
                  length: 1,
                  typeIdx: SEMANTIC_TOKEN_TYPES.indexOf('string'),
                  modifiers: 0
                });
              }

              // Process string parts and interpolations
              // String parts are the gaps between interpolations (and before first, after last)
              let currentPos = quotedContentStart;

              for (let i = 0; i < replacementSpans.length; i++) {
                const replacementSpan = replacementSpans[i]!;

                // Find @{ before and } after the replacement node to get full interpolation boundaries
                const interpStartPos = doc.positionAt(replacementSpan.start);
                const interpEndPos = doc.positionAt(replacementSpan.end);

                // Look backwards from replacement start to find @{
                let atBraceStart = replacementSpan.start;
                if (interpStartPos.character >= 2) {
                  const lookBackStart = Math.max(0, interpStartPos.character - 2);
                  const textBefore = doc.getText(Range.create(
                    Position.create(interpStartPos.line, lookBackStart),
                    interpStartPos
                  ));
                  if (textBefore.endsWith('@{')) {
                    atBraceStart = doc.offsetAt(Position.create(interpStartPos.line, lookBackStart));
                  }
                }

                // Look forwards from replacement end to find }
                let braceEnd = replacementSpan.end;
                const textAfter = doc.getText(Range.create(
                  interpEndPos,
                  Position.create(interpEndPos.line, interpEndPos.character + 1)
                ));
                if (textAfter.startsWith('}')) {
                  braceEnd = doc.offsetAt(Position.create(interpEndPos.line, interpEndPos.character + 1));
                }

                // Emit string part before this interpolation
                if (atBraceStart > currentPos) {
                  const stringPartStartPos = doc.positionAt(currentPos);
                  const stringPartEndPos = doc.positionAt(atBraceStart);

                  if (stringPartStartPos.line === line && stringPartEndPos.line === line) {
                    pending.push({
                      line,
                      char: stringPartStartPos.character,
                      length: stringPartEndPos.character - stringPartStartPos.character,
                      typeIdx: SEMANTIC_TOKEN_TYPES.indexOf('string'),
                      modifiers: 0
                    });
                  }
                }

                // Emit interpolation
                const fullInterpStartPos = doc.positionAt(atBraceStart);
                const fullInterpEndPos = doc.positionAt(braceEnd);

                if (fullInterpStartPos.line === line && fullInterpEndPos.line === line) {
                  // Determine semantic token type based on the replacement node
                  let replacementType: SemanticTokenType = 'variable';
                  const replacementNode = replacementSpan.node;

                  if (replacementNode.type === 'Reference' && replacementNode.options?.type === 'variable') {
                    replacementType = 'variable';
                  } else if (replacementNode.type === 'Call') {
                    replacementType = 'function';
                  } else if (replacementNode.type === 'Operation') {
                    replacementType = 'number';
                  } else if (replacementNode.type === 'Any') {
                    replacementType = 'property';
                  } else if (replacementNode.type === 'Dimension' || replacementNode.type === 'Num') {
                    replacementType = 'number';
                  }

                  pending.push({
                    line,
                    char: fullInterpStartPos.character,
                    length: fullInterpEndPos.character - fullInterpStartPos.character,
                    typeIdx: SEMANTIC_TOKEN_TYPES.indexOf(replacementType),
                    modifiers: 0
                  });
                }

                // Advance past the interpolation
                currentPos = braceEnd;
              }

              // Emit remaining string part after last interpolation (includes closing quote position)
              if (currentPos <= quotedContentEnd) {
                const stringPartStartPos = doc.positionAt(currentPos);
                const stringPartEndPos = doc.positionAt(quotedContentEnd + 1); // Up to but not including closing quote

                if (stringPartStartPos.line === line && stringPartEndPos.line === line) {
                  pending.push({
                    line,
                    char: stringPartStartPos.character,
                    length: stringPartEndPos.character - stringPartStartPos.character,
                    typeIdx: SEMANTIC_TOKEN_TYPES.indexOf('string'),
                    modifiers: 0
                  });
                }
              }

              // Emit the closing quote as a string token
              const quotedEndPos = doc.positionAt(quotedSpan.end);
              if (quotedEndPos.line === line) {
                pending.push({
                  line,
                  char: quotedEndPos.character - 1,
                  length: 1,
                  typeIdx: SEMANTIC_TOKEN_TYPES.indexOf('string'),
                  modifiers: 0
                });
              }

              // Skip normal processing for this token since we've split it
              continue;
            }
          }
        }

        // 1) Property name vs value idents: if an ident is immediately before `:`, it's a property name.
        // Otherwise treat plain idents as value-ish.
        let effType: SemanticTokenType = type;
        if (type === 'property') {
          // Pseudo classes/elements: treat the pseudo identifier as part of the selector.
          // This covers cases like `:not(...)`, `:host`, `::after`, `:nth-child(...)` where
          // the lexer may tokenize the name as a plain ident.
          if (String(prev?.tokenType?.name ?? '') === 'Colon') {
            effType = 'class';
          } else if (next?.tokenType?.name === 'Colon') {
            effType = 'property';
          } else {
            // Heuristic: if an ident is followed by selector-ish tokens, treat it as a selector.
            // This covers `html {}` and `html .class {}` where `html` is a type selector.
            const nextType = String(next?.tokenType?.name ?? '');
            const selectorishNext = new Set([
              'LCurly',
              'Comma',
              'DotName',
              'HashName',
              'LSquare',
              'Ampersand',
              'Gt',
              'Plus',
              'Tilde',
              'Pipe',
              'Column',
              'SelectorPseudoClass',
              'NthPseudoClass'
            ]);
            if (selectorishNext.has(nextType)) {
              effType = 'class';
            } else {
              // Value-ish identifiers (e.g. `display: block`) should not look like at-rules.
              effType = 'enumMember';
            }
          }
        }

        // 1b) Selector pseudo-classes/elements: color the `:` / `::` as part of the selector,
        // not like declaration punctuation. The lexer isn't consistent across all pseudos
        // (e.g. :host / ::content), so we use structure-based heuristics.
        if (effType === 'operator' && tok.tokenType?.name === 'Colon') {
          const nextType = String(next?.tokenType?.name ?? '');
          const prevType = String(prev?.tokenType?.name ?? '');
          const prev2Type = String(prev2?.tokenType?.name ?? '');

          // Declaration colon pattern is usually: (LCurly|Semi|Newline) <ident> :
          const looksLikeDeclColon =
            prevType === 'PlainIdent'
            && (prev2Type === 'LCurly' || prev2Type === 'Semi' || prev2Type === 'Newline');

          const looksLikePseudoStart =
            nextType === 'SelectorPseudoClass'
            || nextType === 'NthPseudoClass'
            || nextType === 'PlainIdent'
            || nextType === 'Ident';

          const selectorishPrev = new Set([
            'PlainIdent',
            'DotName',
            'HashName',
            'RSquare',
            'RParen',
            'Ampersand',
            'Star',
            'Pipe',
            'Column'
          ]);

          // Also treat `::` as selector punctuation; first `:` sees next `Colon`.
          const isDoubleColon = nextType === 'Colon';

          if (!looksLikeDeclColon && (looksLikePseudoStart || isDoubleColon) && selectorishPrev.has(prevType)) {
            effType = 'class';
          }
        }

        // 2) Variable declarations: mark declaration modifier where we can.
        let modifiers = 0;
        if (effType === 'variable' && tracked.lang === 'less' && next?.tokenType?.name === 'Colon') {
          modifiers |= MOD_DECLARATION;
        }
        if (effType === 'variable' && tracked.lang === 'scss' && next?.tokenType?.name === 'Colon') {
          const prevLine1 = prev?.endLine ?? (prev?.startLine ?? 0);
          const thisLine1 = tok.startLine ?? 0;
          const prevType = String(prev?.tokenType?.name ?? '');
          const likelyStatementStart =
            !prev
            || prevLine1 < thisLine1
            || prevType === 'LCurly'
            || prevType === 'Semi';
          if (likelyStatementStart) {
            modifiers |= MOD_DECLARATION;
          }
        }

        // Also apply declaration modifier to variable references detected via AST
        // This makes them color the same as their declarations
        // We do this for all variable references found via AST lookup, since they're at least syntactically valid
        if (effType === 'variable' && (tok as any)._isVarRef) {
          modifiers |= MOD_DECLARATION;
        }

        // 3) Split dimensions like `1cm` into `number` + `unit` (we model unit as `type`).
        // This is purely for nicer theming (number colored differently from unit).
        if (effType === 'number' && typeName.includes('Dimension') && typeof tok.image === 'string') {
          const m = tok.image.match(/^([+-]?(?:\d*\.\d+|\d+))(.*)$/);
          if (m && m[1] && m[2]) {
            const numPart = m[1];
            const unitPart = m[2];
            const numLen = Math.max(1, numPart.length);
            const unitLen = Math.max(1, unitPart.length);
            const numIdx = SEMANTIC_TOKEN_TYPES.indexOf('number');
            const unitIdx = SEMANTIC_TOKEN_TYPES.indexOf('type');
            if (numIdx !== -1) {
              pending.push({ line: start.line, char: start.character, length: numLen, typeIdx: numIdx, modifiers });
            }
            if (unitIdx !== -1) {
              pending.push({ line: start.line, char: start.character + numLen, length: unitLen, typeIdx: unitIdx, modifiers: 0 });
            }
            continue;
          }
        }

        const typeIdx = SEMANTIC_TOKEN_TYPES.indexOf(effType);
        if (typeIdx === -1) {
          continue;
        }
        pending.push({ line: start.line, char: start.character, length: fullLen, typeIdx, modifiers });
      }

      // LSP semantic tokens are delta-encoded in document order.
      pending.sort((a, b) => (a.line - b.line) || (a.char - b.char));
      let prevLine = 0;
      let prevChar = 0;
      for (const t of pending) {
        const deltaLine = t.line - prevLine;
        const deltaStart = deltaLine === 0 ? (t.char - prevChar) : t.char;
        data.push(deltaLine, deltaStart, t.length, t.typeIdx, t.modifiers);
        prevLine = t.line;
        prevChar = t.char;
      }

      return { data };
    },

    async getDocumentColors(uri) {
      const tracked = ensure(uri);
      const doc = tracked.document;
      const parse = tracked.parse;
      if (!parse || !parse.tree) {
        return [];
      }

      const { findColorsInAST, colorToLSP, getNodeSpan } = require('./color-utils.js');
      const colors = await findColorsInAST(parse.tree as Node);
      const result: ColorInformation[] = [];

      for (const { node, color: colorNode } of colors) {
        const span = getNodeSpan(node);
        if (!span) {
          continue;
        }

        try {
          const lspColor = colorToLSP(colorNode);
          const range: Range = {
            start: doc.positionAt(span.start),
            end: doc.positionAt(span.end)
          };
          result.push({ color: lspColor, range });
        } catch {
          // Skip invalid colors
        }
      }

      return result;
    },

    getColorPresentations(uri, color, range) {
      const { getColorPresentations: getPresentations } = require('./color-utils.js');
      const presentations = getPresentations(color);

      // Set textEdit for each presentation
      return presentations.map((p: ColorPresentation) => ({
        ...p,
        textEdit: TextEdit.replace(range, p.label)
      }));
    }
  };
}
