import { parseCssFn } from '@jesscss/css-parser/jess';
import { Parser as LessParser } from '@jesscss/less-parser/jess';
import { Parser as ScssParser } from '@jesscss/scss-parser/jess';
import { parseCssDoc, type CssCstNode, type ParseDoc } from '@jesscss/css-parser';
import { parseLessDoc } from '@jesscss/less-parser';
import { parseScssDoc } from '@jesscss/scss-parser';
import type { IParseResult, Rules, Node } from '@jesscss/core';
import { isNode, sourceSpanOf } from '@jesscss/core';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractImports, resolveImport } from '@jesscss/style-resolver';
import * as colorUtils from './color-utils.js';
import { cstDocumentSymbols, cstFoldingRanges, cstSelectionRanges } from './cst-analysis.js';
import { cstSymbolAtOffset, cstFindDefinitionInDoc, cstCollectReferencesInDoc, type CstSymbol } from './cst-symbols.js';
import { cstVariableNames, cstDeclaredSymbols } from './cst-syntactic.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  CompletionItem,
  CompletionItemKind,
  CompletionList,
  Diagnostic,
  DiagnosticSeverity,
  DocumentSymbol,
  FoldingRange,
  Hover,
  Location,
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
  // Incremental CST sync layer (Parseman `.edit()`-able document). The analysis
  // tree (`parse`/`index`) is the Jess AST — dual-tree: the AST powers every
  // feature; this CST doc only tracks the text incrementally so a keystroke edits
  // one subtree instead of re-lexing the whole file.
  cstDoc: ParseDoc<CssCstNode> | null;
  // Deferred re-derivation: an incremental edit marks the AST/index stale and
  // rebuilds them lazily on the next feature query, so a burst of edits with no
  // query in between costs ONE analysis pass, not one per keystroke.
  analysisDirty: boolean;
  // Diagnostic counters (test-visible via `_debugState`): how many content
  // changes took the incremental `.edit()` path vs a full CST rebuild.
  editApplied: number;
  fullRebuild: number;
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

function nodeField(node: object, key: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return (node as Record<string, unknown>)[key];
}

function getSpan(node: Node): { start: number; end: number } | null {
  // The functional parsers store source spans in the provenance side-table
  // (read via `sourceSpanOf`), not on a `.location` 6-tuple.
  const span = sourceSpanOf(node);
  if (span) {
    const start = Number(span.start);
    const end = Number(span.end);
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

    for (const child of node.walk()) {
      stack.push(child);
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

// Parsers are expensive to construct: reuse instances. CSS uses the functional
// `parseCssFn` entry (no stateful class), so only Less/SCSS keep instances.
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return lessParser.parse(text) as unknown as IParseResult<Rules>;
  }
  if (lang === 'scss') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return scssParser.parse(text) as unknown as IParseResult<Rules>;
  }
  // TODO: add dedicated .jess parser; for now treat as css-ish.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return parseCssFn(text) as unknown as IParseResult<Rules>;
}

// Build the incremental CST document for a dialect. `.jess` has no dedicated
// parser yet, so it (like `css`) uses the CSS doc parser — matching the AST-side
// `parseWithJess` fallback.
function parseDocFor(text: string, lang: JessLang): ParseDoc<CssCstNode> {
  if (lang === 'less') {
    return parseLessDoc(text);
  }
  if (lang === 'scss') {
    return parseScssDoc(text);
  }
  return parseCssDoc(text);
}

// Minimal single-range diff between old and new text: the shared prefix and
// (non-overlapping) shared suffix pin down one contiguous replaced span, which
// is exactly the `(from, to, replacement)` shape `ParseDoc.edit` wants. An LSP
// incremental change is already this shape; when the client hands us only merged
// full text (the `TextDocuments` manager does), this recovers the same edit so a
// one-character keystroke stays a one-character `.edit()`.
function diffRange(oldText: string, newText: string): { from: number; to: number; replacement: string } {
  const oldLen = oldText.length;
  const newLen = newText.length;
  let start = 0;
  const maxStart = Math.min(oldLen, newLen);
  while (start < maxStart && oldText.charCodeAt(start) === newText.charCodeAt(start)) {
    start++;
  }
  let oldEnd = oldLen;
  let newEnd = newLen;
  while (oldEnd > start && newEnd > start && oldText.charCodeAt(oldEnd - 1) === newText.charCodeAt(newEnd - 1)) {
    oldEnd--;
    newEnd--;
  }
  return { from: start, to: oldEnd, replacement: newText.slice(start, newEnd) };
}

// The functional parsers do not expose the legacy Chevrotain `.suggest()`
// content-assist entry, so completion routing is driven off the document text
// and the Jess AST (see `getCompletions`) rather than a token-lookahead stream.
// Kept as a stable no-op so the routing heuristics fall through to their
// text/AST-based defaults.
function suggestWithJess(_text: string, _lang: JessLang, _offset: number): Array<{ nextTokenType: string }> {
  return [];
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

// Net `{`/`}` nesting depth before an offset (>0 = inside a rule block).
function braceDepthBefore(text: string, offset: number): number {
  let depth = 0;
  for (let i = 0; i < Math.min(offset, text.length); i++) {
    const ch = text.charCodeAt(i);
    if (ch === 123) {
      depth++;
    } else if (ch === 125) {
      depth = Math.max(0, depth - 1);
    }
  }
  return depth;
}

function pos(line1: number | undefined, col1: number | undefined): Position {
  return Position.create(Math.max(0, (line1 ?? 1) - 1), Math.max(0, (col1 ?? 1) - 1));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Within `[start, end)` of `text`, find the first whole-identifier occurrence of
// `ident` and return its absolute offsets. "Whole identifier" = not flanked by a
// CSS identifier character (letter/digit/hyphen/underscore), so inside `@primary`
// the `primary` matches but inside `@primary-alt` / `@primaryX` it does not. This
// is how a node-level span (a reference `@primary`, or a whole declaration
// `@primary: red;`, or a mixin block `.button() { … }`) is narrowed to just the
// name token — rename edits and did-you-mean fixes only touch the identifier and
// leave the sigil / combinator / punctuation in place.
function findIdentInSpan(text: string, start: number, end: number, ident: string): { start: number; end: number } | null {
  if (!ident) {
    return null;
  }
  const slice = text.slice(start, Math.max(start, end));
  const re = new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(ident)}(?![A-Za-z0-9_-])`);
  const m = re.exec(slice);
  if (!m) {
    return null;
  }
  return { start: start + m.index, end: start + m.index + ident.length };
}

// Small Levenshtein edit distance, capped: powers the "did you mean" quick fix
// (suggest a declared symbol close to an undefined reference).
function editDistance(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) {
    return bl;
  }
  if (bl === 0) {
    return al;
  }
  let prev = new Array<number>(bl + 1);
  let curr = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) {
    prev[j] = j;
  }
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bl]!;
}

// Data sources:
// - At-rules: from VS Code's published web custom data (npm package).
// - Properties: use the same package Less parser uses (`known-css-properties`).
// - Property values: from web custom data (properties have `values` arrays).
const require = createRequire(import.meta.url);

type AtDirectiveEntry = { name: string; description?: string | { value: string; kind?: string } };
type PropertyEntry = { name: string; description?: string | { value: string; kind?: string }; values?: Array<{ name: string; description?: string | { value: string; kind?: string } }>; restrictions?: string[] };
type PseudoEntry = { name: string; description?: string | { value: string; kind?: string } };
type WebCssData = {
  atDirectives?: AtDirectiveEntry[];
  properties?: PropertyEntry[];
  pseudoClasses?: PseudoEntry[];
  pseudoElements?: PseudoEntry[];
};

const webCssData: WebCssData = require('@vscode/web-custom-data/data/browsers.css-data.json');

const AT_RULES: string[] = (webCssData.atDirectives ?? []).map(d => d.name).filter(Boolean);
const AT_RULES_MAP = new Map<string, AtDirectiveEntry>();
for (const d of webCssData.atDirectives ?? []) {
  if (d.name) {
    AT_RULES_MAP.set(d.name.toLowerCase(), d);
  }
}

const knownCssProperties: { all?: unknown } = require('known-css-properties');
const CSS_PROPERTIES: string[] = Array.isArray(knownCssProperties.all) ? knownCssProperties.all.filter((v): v is string => typeof v === 'string') : [];

// Build property name -> property data map for hover/completions.
const PROPERTIES_MAP = new Map<string, PropertyEntry>();
const PROPERTY_VALUES = new Map<string, string[]>();
// `restrictions` is the value-KIND hint (color/length/timing-function/…) that
// drives rich value completions — the data MS reads and Jess previously ignored.
const PROPERTY_RESTRICTIONS = new Map<string, string[]>();
for (const prop of webCssData.properties ?? []) {
  if (prop.name) {
    const key = prop.name.toLowerCase();
    PROPERTIES_MAP.set(key, prop);
    if (prop.values) {
      PROPERTY_VALUES.set(key, prop.values.map(v => v.name).filter(Boolean) as string[]);
    }
    if (prop.restrictions) {
      PROPERTY_RESTRICTIONS.set(key, prop.restrictions);
    }
  }
}

// Pseudo-class / -element names (leading `:` / `::` included by the data).
const PSEUDO_CLASSES: string[] = (webCssData.pseudoClasses ?? []).map(p => p.name).filter(Boolean);
const PSEUDO_ELEMENTS: string[] = (webCssData.pseudoElements ?? []).map(p => p.name).filter(Boolean);

// Value-completion vocab. CSS-wide keywords are valid for every property; the
// rest are gated on the property's `restrictions`.
const CSS_WIDE_KEYWORDS = ['inherit', 'initial', 'unset', 'revert', 'revert-layer'];
const COLOR_FUNCTIONS = ['rgb()', 'rgba()', 'hsl()', 'hsla()', 'hwb()', 'lab()', 'lch()', 'oklab()', 'oklch()', 'color()'];
const TIMING_FUNCTIONS = ['ease', 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end', 'cubic-bezier()', 'steps()'];
// Units to append to a numeric prefix, keyed by the property's restriction kind.
const UNITS_BY_RESTRICTION: Record<string, string[]> = {
  length: ['px', 'em', 'rem', 'vh', 'vw', 'vmin', 'vmax', 'pt', 'cm', 'mm', 'in', 'pc', 'ex', 'ch', 'q'],
  percentage: ['%'],
  time: ['s', 'ms'],
  angle: ['deg', 'rad', 'grad', 'turn'],
  frequency: ['Hz', 'kHz'],
  resolution: ['dpi', 'dpcm', 'dppx']
};

/**
 * Rich value completions for a declaration value: the property's enum values
 * (data) PLUS restriction-driven kinds (color functions, timing functions),
 * the CSS-wide keywords, and var()/calc() — valid for any property. This is the
 * depth MS gets from the `restrictions` field, which Jess previously ignored.
 */
function buildValueCompletions(propName: string, prefix: string, replaceRange: Range): CompletionItem[] {
  const items: CompletionItem[] = [];
  const seen = new Set<string>();
  const add = (label: string, kind: CompletionItemKind, documentation?: string) => {
    const lower = label.toLowerCase();
    if (seen.has(lower)) {
      return;
    }
    if (prefix && !lower.startsWith(prefix)) {
      return;
    }
    seen.add(lower);
    const item: CompletionItem = { label, kind, textEdit: TextEdit.replace(replaceRange, label) };
    if (documentation !== undefined) {
      item.documentation = documentation;
    }
    items.push(item);
  };
  const key = propName.toLowerCase();
  const restrictions = PROPERTY_RESTRICTIONS.get(key) ?? [];
  for (const v of PROPERTY_VALUES.get(key) ?? []) {
    add(v, CompletionItemKind.Value);
  }
  if (restrictions.includes('color')) {
    for (const f of COLOR_FUNCTIONS) {
      add(f, CompletionItemKind.Function);
    }
    // Named CSS colors rendered with a swatch (kind Color + hex documentation).
    for (const [name, hex] of Object.entries(colorUtils.colorKeywords)) {
      add(name, CompletionItemKind.Color, hex);
    }
  }
  if (restrictions.includes('timing-function')) {
    for (const t of TIMING_FUNCTIONS) {
      add(t, CompletionItemKind.Value);
    }
  }
  // Units appended to a numeric prefix (`10` → `10px`), per restriction kind.
  if (/^\d*\.?\d+$/.test(prefix)) {
    const units = new Set<string>();
    for (const r of restrictions) {
      for (const u of UNITS_BY_RESTRICTION[r] ?? []) {
        units.add(u);
      }
    }
    for (const u of units) {
      add(`${prefix}${u}`, CompletionItemKind.Unit);
    }
  }
  for (const k of CSS_WIDE_KEYWORDS) {
    add(k, CompletionItemKind.Keyword);
  }
  add('var()', CompletionItemKind.Function);
  add('calc()', CompletionItemKind.Function);
  return items;
}

export type JessLanguageServiceEngine = {
  configure(config: unknown): void;
  open(uri: string, languageId: string, version: number, text: string): void;
  change(uri: string, version: number, text: string): void;
  edit(uri: string, version: number, changes: ReadonlyArray<{ range?: Range; text: string }>): void;
  close(uri: string): void;
  /** Test/diagnostic hook (not LSP): incremental CST tree + edit-path counters. */
  _debugState(uri: string): { cstTree: CssCstNode | null; editApplied: number; fullRebuild: number };

  getCompletions(uri: string, position: Position): CompletionList;
  getHover(uri: string, position: Position): Hover | null;
  findDefinition(uri: string, position: Position): Location | null;
  findReferences(uri: string, position: Position): Location[];
  prepareRename(uri: string, position: Position): { range: Range; placeholder: string } | null;
  rename(uri: string, position: Position, newName: string): WorkspaceEdit | null;
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

function asStringName(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    if ('valueOf' in value && typeof value.valueOf === 'function') {
      return String(value.valueOf());
    }
    if ('value' in value && typeof value.value === 'string') {
      return String(value.value);
    }
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

const SEMANTIC_TOKEN_TYPE_INDEX = new Map<SemanticTokenType, number>(
  SEMANTIC_TOKEN_TYPES.map((t, i) => [t, i])
);

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

  // Raw fetch (no analysis) — for the sync path (`change`/`edit`) that only needs
  // to update text + the CST doc, deferring the Jess-AST re-derivation.
  function get(uri: string): TrackedDoc {
    const doc = docs.get(uri);
    if (!doc) {
      throw new Error(`Unknown document: ${uri}`);
    }
    return doc;
  }

  // Feature entry point: fetch AND lazily bring the analysis tree up to date.
  function ensure(uri: string): TrackedDoc {
    const doc = get(uri);
    ensureAnalysis(doc);
    return doc;
  }

  // Re-derive the Jess AST + index only if a content change invalidated them.
  // Coalesces a burst of edits into a single analysis pass at the first query.
  function ensureAnalysis(t: TrackedDoc) {
    if (!t.analysisDirty) {
      return;
    }
    t.analysisDirty = false;
    reparse(t);
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

  // Rebuild the incremental CST document from scratch (used on open and as the
  // fallback when an edit can't be expressed as one contiguous range).
  function rebuildCstDoc(t: TrackedDoc) {
    try {
      t.cstDoc = parseDocFor(t.document.getText(), t.lang);
    } catch {
      t.cstDoc = null;
    }
  }

  // Apply a single contiguous text edit to a tracked doc: advance the text
  // mirror, sync the CST doc incrementally via `.edit()` (falling back to a full
  // CST rebuild when no prior doc exists), and mark the analysis stale (lazy).
  function applyContiguousEdit(t: TrackedDoc, from: number, to: number, replacement: string, newText: string, version: number) {
    t.document = TextDocument.update(t.document, [{ text: newText }], version);
    if (t.cstDoc) {
      try {
        t.cstDoc = t.cstDoc.edit(from, to, replacement);
        t.editApplied++;
      } catch {
        rebuildCstDoc(t);
        t.fullRebuild++;
      }
    } else {
      rebuildCstDoc(t);
      t.fullRebuild++;
    }
    t.analysisDirty = true;
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
    // Imported files are loaded from disk and never edited in place. They still
    // need a CST doc so the CST-grounded symbol features (def/refs/rename) can
    // search across imports; build it once, eagerly, alongside the AST.
    const tracked: TrackedDoc = { document, lang: inferredLang, parse: null, index: null, cstDoc: null, analysisDirty: false, editApplied: 0, fullRebuild: 0 };
    rebuildCstDoc(tracked);
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

  // Resolve a URI to its CST tree + document, for cross-document symbol search.
  // Both open (`docs`) and imported (`importedDocs`) files carry an eagerly-built
  // CST doc; a doc whose CST failed to build (null tree) is skipped.
  function cstDocRef(targetUri: string): { doc: TextDocument; tree: CssCstNode } | null {
    const tracked = docs.get(targetUri) ?? importedDocs.get(targetUri);
    const tree = tracked?.cstDoc?.tree;
    if (!tracked || !tree) {
      return null;
    }
    return { doc: tracked.document, tree };
  }

  // Helper: find a symbol's definition across documents (current doc first, then
  // its imports, depth-first with cycle detection) off the tolerant CST.
  function findDefinitionAcrossDocs(targetUri: string, target: CstSymbol, visited: Set<string>): Location | null {
    if (visited.has(targetUri)) {
      return null; // Cycle detection
    }
    visited.add(targetUri);

    const ref = cstDocRef(targetUri);
    if (ref) {
      const def = cstFindDefinitionInDoc(ref.tree, ref.doc, targetUri, target);
      if (def) {
        return def;
      }
    }

    const imports = importGraph.get(targetUri);
    if (imports) {
      for (const importedUri of imports) {
        const result = findDefinitionAcrossDocs(importedUri, target, visited);
        if (result) {
          return result;
        }
      }
    }

    return null;
  }

  // Helper: collect a symbol's references + declaration in a single document's
  // CST (the caller loops all open + imported docs with a shared `visited` set,
  // so each doc is processed once regardless of import edges).
  function collectReferencesInDoc(targetUri: string, target: CstSymbol, visited: Set<string>, results: Location[]): void {
    if (visited.has(targetUri)) {
      return; // Already processed
    }
    visited.add(targetUri);

    const ref = cstDocRef(targetUri);
    if (!ref) {
      return;
    }
    cstCollectReferencesInDoc(ref.tree, ref.doc, targetUri, target, results);
  }

  // Shared resolver behind find-references AND rename: from a cursor position,
  // resolve the innermost variable/mixin declaration or reference off the CST,
  // then collect every reference to that symbol across the current + imported +
  // open docs. Returns the symbol kind, the bare identifier to target inside each
  // span, and the node-level locations. `findReferences` returns `.locations`
  // verbatim; rename narrows each location to its identifier via `findIdentInSpan`.
  function collectReferenceSet(uri: string, position: Position):
    { kind: 'variable' | 'mixin'; refineIdent: string; locations: Location[] } | null {
    const tracked = get(uri);
    const document = tracked.document;
    const tree = tracked.cstDoc?.tree;
    if (!tree) {
      return null;
    }

    const offset = document.offsetAt(position);
    const sym = cstSymbolAtOffset(tree, document, offset);
    if (!sym) {
      return null;
    }

    const out: Location[] = [];
    const visited = new Set<string>();
    const allDocs = new Set([...docs.keys(), ...importedDocs.keys()]);
    for (const docUri of allDocs) {
      collectReferencesInDoc(docUri, sym, visited, out);
    }
    return { kind: sym.kind, refineIdent: sym.refineIdent, locations: out };
  }

  return {
    configure(config) {
      // Expected shape (from client settings): { diagnostics?: { severity?: Record<string, string> } }
      // Example: { diagnostics: { severity: { "var/undefined": "error" } } }
      const diagnosticsObj = (config && typeof config === 'object' && 'diagnostics' in config)
        ? config.diagnostics
        : undefined;
      const severity = (diagnosticsObj && typeof diagnosticsObj === 'object' && 'severity' in diagnosticsObj)
        ? diagnosticsObj.severity
        : undefined;
      if (severity && typeof severity === 'object') {
        const next: Record<string, DiagnosticSeverity> = { ...semanticDiagnosticSeverities };
        for (const [k, v] of Object.entries(severity)) {
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
      const tracked: TrackedDoc = { document, lang, parse: null, index: null, cstDoc: null, analysisDirty: false, editApplied: 0, fullRebuild: 0 };
      docs.set(uri, tracked);
      rebuildCstDoc(tracked);
      reparse(tracked);
      updateImportGraph(uri, tracked);
    },
    change(uri, version, text) {
      // Full-text change notification (what the `TextDocuments` manager delivers):
      // recover the minimal contiguous edit vs the previous text and drive the CST
      // doc through `.edit()`, so a keystroke reparses one subtree, not the file.
      const tracked = get(uri);
      const oldText = tracked.document.getText();
      const { from, to, replacement } = diffRange(oldText, text);
      applyContiguousEdit(tracked, from, to, replacement, text, version);
      updateImportGraph(uri, tracked);
    },
    edit(uri, version, changes) {
      // LSP incremental-change form: each change is `{ range?, text }`. A single
      // ranged change maps directly to one `(from, to, replacement)` `.edit()`.
      // Anything else (a rangeless full replace, or a multi-range batch that a
      // single `.edit()` can't express) falls back to a full CST rebuild — still
      // correct, just not incremental.
      const tracked = get(uri);
      const single = changes.length === 1 ? changes[0] : undefined;
      if (single && single.range) {
        const from = tracked.document.offsetAt(single.range.start);
        const to = tracked.document.offsetAt(single.range.end);
        const oldText = tracked.document.getText();
        const newText = oldText.slice(0, from) + single.text + oldText.slice(to);
        applyContiguousEdit(tracked, from, to, single.text, newText, version);
      } else {
        tracked.document = TextDocument.update(tracked.document, [...changes], version);
        rebuildCstDoc(tracked);
        tracked.fullRebuild++;
        tracked.analysisDirty = true;
      }
      updateImportGraph(uri, tracked);
    },
    close(uri) {
      docs.delete(uri);
      importGraph.delete(uri);
      // Note: We keep importedDocs in cache even after close, as they may be referenced by other files
    },

    // Test/diagnostic hook: the incremental CST tree (Parseman relative spans) and
    // the edit-path counters. Not part of the LSP surface.
    _debugState(uri) {
      const tracked = get(uri);
      return {
        cstTree: tracked.cstDoc?.tree ?? null,
        editApplied: tracked.editApplied,
        fullRebuild: tracked.fullRebuild
      };
    },

    getCompletions(uri, position) {
      // CST-grounded for the syntactic paths (declared variables/mixins): reads
      // the tolerant CST (no AST reparse) so completion survives half-typed input.
      // Property / value / at-rule / pseudo completions are data + text driven.
      const tracked = get(uri);
      const document = tracked.document;
      const text = document.getText();
      const offset = document.offsetAt(position);
      const currentWord = getCurrentWord(text, offset);
      const wordStart = offset - currentWord.length;
      const before = text.slice(0, wordStart);
      const replaceRange = toRange(document, wordStart, offset);
      const prefix = currentWord.toLowerCase();
      const cstTree = tracked.cstDoc?.tree;

      const suggestions = suggestWithJess(text, tracked.lang, offset).map(s => String(s.nextTokenType).toLowerCase());
      const wantsAt = currentWord.startsWith('@') || suggestions.some(t => t.includes('at'));
      const wantsIdent = suggestions.some(t => t.includes('ident')) || suggestions.length === 0;

      const items: CompletionItem[] = [];
      const push = (label: string, kind: CompletionItemKind, insert?: string) => {
        items.push({ label, kind, textEdit: TextEdit.replace(replaceRange, insert ?? label) });
      };

      // 1) Variable completions: Less @var, SCSS $var, CSS custom properties --x.
      const wantVar =
        tracked.lang === 'less'
          ? currentWord.startsWith('@')
          : tracked.lang === 'scss'
            ? currentWord.startsWith('$')
            : currentWord.startsWith('--');
      if (wantVar && cstTree) {
        for (const nameWithoutPrefix of cstVariableNames(cstTree, document)) {
          const label = tracked.lang === 'less'
            ? `@${nameWithoutPrefix}`
            : tracked.lang === 'scss' ? `$${nameWithoutPrefix}` : `--${nameWithoutPrefix}`;
          if (prefix && !label.toLowerCase().startsWith(prefix)) {
            continue;
          }
          push(label, CompletionItemKind.Variable);
        }
        if (items.length > 0) {
          return { isIncomplete: false, items };
        }
      }

      // 2) SCSS mixin completions after `@include ` — reuses the CST declared-mixin
      //    inventory (same one the did-you-mean quick fix uses).
      if (tracked.lang === 'scss' && cstTree && /@include\s+$/.test(before)) {
        for (const name of cstDeclaredSymbols(cstTree, document).mixins) {
          if (prefix && !name.toLowerCase().startsWith(prefix)) {
            continue;
          }
          push(name, CompletionItemKind.Function);
        }
        return { isIncomplete: false, items };
      }

      // 2b) Less mixin-call completions: `.foo(` inside a rule block (a `.foo` at
      //     top level is a selector definition, so gate on nesting depth).
      if (tracked.lang === 'less' && cstTree && currentWord.startsWith('.') && braceDepthBefore(text, offset) > 0) {
        const bare = currentWord.slice(1).toLowerCase();
        for (const name of cstDeclaredSymbols(cstTree, document).mixins) {
          if (bare && !name.toLowerCase().startsWith(bare)) {
            continue;
          }
          push(`.${name}()`, CompletionItemKind.Function);
        }
        if (items.length > 0) {
          return { isIncomplete: false, items };
        }
      }

      // 3) Pseudo-class / -element completions: a `:`/`::` in SELECTOR position —
      //    i.e. the colon is NOT a declaration value colon after a known property.
      if (text.charAt(wordStart - 1) === ':') {
        const doubleColon = text.charAt(wordStart - 2) === ':';
        const propBeforeColon = findPropertyNameBeforeColon(text, offset);
        const isValueColon = propBeforeColon !== null && PROPERTIES_MAP.has(propBeforeColon.toLowerCase());
        if (!isValueColon) {
          const pool = doubleColon ? PSEUDO_ELEMENTS : [...PSEUDO_CLASSES, ...PSEUDO_ELEMENTS];
          for (const name of pool) {
            const bare = name.replace(/^:+/, '');
            if (prefix && !bare.toLowerCase().startsWith(prefix)) {
              continue;
            }
            // Insert the bare name — the `:`/`::` the user typed is before wordStart.
            push(name, doubleColon ? CompletionItemKind.Function : CompletionItemKind.Value, bare);
          }
          if (items.length > 0) {
            return { isIncomplete: false, items };
          }
        }
      }

      // 4) At-rule names.
      if (wantsAt) {
        for (const name of AT_RULES) {
          if (prefix && !name.toLowerCase().startsWith(prefix)) {
            continue;
          }
          push(name, CompletionItemKind.Keyword);
        }
        return { isIncomplete: false, items };
      }

      if (wantsIdent) {
        // 5) Declaration value context: rich, restriction-driven values + !important.
        const propName = findPropertyNameBeforeColon(text, offset);
        if (propName) {
          const valueItems = buildValueCompletions(propName, prefix, replaceRange);
          if (!prefix || '!important'.startsWith(prefix)) {
            valueItems.push({ label: '!important', kind: CompletionItemKind.Keyword, textEdit: TextEdit.replace(replaceRange, '!important') });
          }
          if (valueItems.length > 0) {
            return { isIncomplete: false, items: valueItems };
          }
        }

        // 6) Property names (inside a block).
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
          for (const name of CSS_PROPERTIES) {
            if (prefix && !name.toLowerCase().startsWith(prefix)) {
              continue;
            }
            push(name, CompletionItemKind.Property);
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
      // CST-grounded (Option B): resolve the symbol under the cursor off the
      // tolerant CST (no AST reparse), then search the current doc + its imports
      // for its declaration. Only a REFERENCE navigates (a cursor on a
      // declaration has nothing to go to), matching the AST behavior.
      const tracked = get(uri);
      const document = tracked.document;
      const tree = tracked.cstDoc?.tree;
      if (!tree) {
        return null;
      }

      const offset = document.offsetAt(position);
      const sym = cstSymbolAtOffset(tree, document, offset);
      if (!sym || sym.role !== 'reference') {
        return null;
      }

      return findDefinitionAcrossDocs(uri, sym, new Set());
    },

    findReferences(uri, position) {
      return collectReferenceSet(uri, position)?.locations ?? [];
    },

    prepareRename(uri, position) {
      const set = collectReferenceSet(uri, position);
      if (!set) {
        return null;
      }
      const tracked = get(uri);
      const doc = tracked.document;
      const offset = doc.offsetAt(position);
      const text = doc.getText();

      // The reference/declaration under the cursor (in the current file).
      const local = set.locations.find(l =>
        l.uri === uri
        && doc.offsetAt(l.range.start) <= offset
        && offset <= doc.offsetAt(l.range.end));
      if (!local) {
        return null;
      }
      const from = doc.offsetAt(local.range.start);
      const to = doc.offsetAt(local.range.end);
      const r = findIdentInSpan(text, from, to, set.refineIdent);
      if (!r) {
        return null;
      }
      // Only offer rename when the cursor is on the symbol itself (its sigil or
      // name), not elsewhere in a wider declaration span (e.g. on the value).
      if (offset < from || offset > r.end) {
        return null;
      }
      return { range: toRange(doc, r.start, r.end), placeholder: set.refineIdent };
    },

    rename(uri, position, newName) {
      const set = collectReferenceSet(uri, position);
      if (!set || set.locations.length === 0) {
        return null;
      }
      // Normalize the requested name to a bare identifier: only the name token is
      // rewritten at each site, so the sigil (`@`/`$`) or mixin combinator (`.`/`#`)
      // already present in the source is preserved. A user who types a sigil is
      // tolerated (it is stripped).
      const clean = newName.trim().replace(/^[@$.#]+/, '').replace(/\(\s*\)\s*$/, '').trim();
      if (!clean) {
        return null;
      }

      const changes: Record<string, TextEdit[]> = {};
      const seen = new Set<string>();
      for (const loc of set.locations) {
        const d = docs.get(loc.uri) ?? importedDocs.get(loc.uri);
        if (!d) {
          continue;
        }
        const text = d.document.getText();
        const from = d.document.offsetAt(loc.range.start);
        const to = d.document.offsetAt(loc.range.end);
        const r = findIdentInSpan(text, from, to, set.refineIdent);
        if (!r) {
          continue;
        }
        const key = `${loc.uri}:${r.start}:${r.end}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        (changes[loc.uri] ??= []).push(TextEdit.replace(toRange(d.document, r.start, r.end), clean));
      }

      if (Object.keys(changes).length === 0) {
        return null;
      }
      return { changes };
    },

    getDocumentSymbols(uri) {
      // CST-grounded (Option B): the tolerant, incremental CST powers the
      // outline, so it survives half-typed input where the eval AST yields
      // nothing. No AST reparse needed (uses the eagerly-synced cstDoc).
      const tracked = get(uri);
      const tree = tracked.cstDoc?.tree;
      if (!tree) {
        return [];
      }
      return cstDocumentSymbols(tree, tracked.document);
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

      const rangeFromLocationLike = (err: any): Range | null => {
        const loc = err?.location;
        if (Array.isArray(loc) && loc.length >= 6) {
          const startLine = loc[1];
          const startCol = loc[2];
          const endLine = loc[4];
          const endCol = loc[5];
          if (
            typeof startLine === 'number'
            && typeof startCol === 'number'
            && typeof endLine === 'number'
            && typeof endCol === 'number'
          ) {
            return clampRange({
              start: pos(startLine, startCol),
              end: pos(endLine, endCol)
            } as Range);
          }
        }

        const startLine = err?.startLine;
        const startCol = err?.startColumn;
        const endLine = err?.endLine;
        const endCol = err?.endColumn;
        if (
          typeof startLine === 'number'
          && typeof startCol === 'number'
          && typeof endLine === 'number'
          && typeof endCol === 'number'
        ) {
          return clampRange({
            start: pos(startLine, startCol),
            end: pos(endLine, endCol)
          } as Range);
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
          rangeFromLocationLike(err)
          ?? rangeFromTokenLike(err?.token)
          ?? rangeFromTokenLike(err?.previousToken)
          ?? rangeFromTokenLike(err)
          ?? rangeFromOffsetLike(err)
          ?? clampRange({ start: Position.create(0, 0), end: Position.create(0, 1) } as Range)
        );
      };

      // Lexer errors.
      for (const err of lexErrors) {
        diagnostics.push({
          code: 'parse/lexer',
          source: 'jess',
          message: String(err?.message ?? 'Lexing error'),
          severity: DiagnosticSeverity.Error,
          range: rangeFromError(err)
        });
      }

      // Parser errors.
      for (const err of parseErrors) {
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
        const refsVar: Array<{ name: string; node: Node; span?: { start: number; end: number } }> = [];
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
        const treeNode: Node = parse.tree;
        const stack: Node[] = [treeNode];
        const seen = new Set<Node>();
        while (stack.length) {
          const node = stack.pop()!;
          if (!node || seen.has(node)) {
            continue;
          }
          seen.add(node);

          if (node.type === 'VarDeclaration') {
            const nameNode = nodeField(node, 'name');
            const nameStr = asStringName(nameNode);
            const norm = normalizeVar(nameStr);
            if (norm) {
              declVars.add(norm);
            }
          } else if (node.type === 'Mixin') {
            const nameNode = nodeField(node, 'name');
            const nameStr = asStringName(nameNode);
            let norm = nameStr.trim();
            const parenIdx = norm.indexOf('(');
            if (parenIdx >= 0) {
              norm = norm.slice(0, parenIdx);
            }
            if (norm) {
              declMixins.add(norm);
            }
          } else if (node.type === 'Reference' && node.options?.type === 'variable') {
            const key = nodeField(node, 'key');
            const raw = typeof key === 'string' ? key : Array.isArray(key) ? key.join('') : asStringName(key);
            const norm = normalizeVar(raw);
            if (norm) {
              refsVar.push({ name: norm, node });
            }
          } else if (node.type === 'Call') {
            const nameNode = nodeField(node, 'name');
            if (nameNode) {
              const nameType = typeof nameNode === 'string' ? null : (isNode(nameNode) ? nameNode.type : null);
              const nameOptions = typeof nameNode === 'string' ? null : (isNode(nameNode) ? nameNode.options : null);
              if (nameType === 'Reference' && (nameOptions?.type === 'mixin' || nameOptions?.type === 'mixin-ruleset')) {
                const key = isNode(nameNode) ? nodeField(nameNode, 'key') : null;
                const raw = typeof key === 'string' ? key : Array.isArray(key) ? key.join('') : asStringName(key);
                let nameStr = raw.trim();
                const parenIdx = nameStr.indexOf('(');
                if (parenIdx >= 0) {
                  nameStr = nameStr.slice(0, parenIdx);
                }
                if (tracked.lang === 'less' && nameStr && !nameStr.startsWith('.') && !nameStr.startsWith('#')) {
                  // Not a mixin in Less - it's a function call
                } else if (nameStr) {
                  refsMixin.push({ name: nameStr, node });
                }
              } else if (typeof nameNode === 'string') {
                let nameStr = nameNode.trim();
                const parenIdx = nameStr.indexOf('(');
                if (parenIdx >= 0) {
                  nameStr = nameStr.slice(0, parenIdx);
                }
                if (tracked.lang === 'less' && nameStr && !nameStr.startsWith('.') && !nameStr.startsWith('#')) {
                  // Not a mixin in Less - it's a function call
                } else if (nameStr) {
                  refsMixin.push({ name: nameStr, node });
                }
              }
            }
          } else if (node.type === 'Reference' && (node.options?.type === 'mixin' || node.options?.type === 'mixin-ruleset')) {
            const key = nodeField(node, 'key');
            const raw = typeof key === 'string' ? key : Array.isArray(key) ? key.join('') : asStringName(key);
            let nameStr = raw.trim();
            const parenIdx = nameStr.indexOf('(');
            if (parenIdx >= 0) {
              nameStr = nameStr.slice(0, parenIdx);
            }
            if (nameStr) {
              refsMixin.push({ name: nameStr, node });
            }
          } else if (node.type === 'Interpolated') {
            // The functional AST collapses every interpolation in a string to a
            // coarse `Reference` sharing the whole string's span, so per-slot
            // offsets are unrecoverable from the tree. Recover them by rescanning
            // the source within the Interpolated span for `@{…}` / `#{…}`, which
            // gives each interpolation a precise, distinct range.
            const interpSpan = getSpan(node);
            if (interpSpan) {
              const region = doc.getText().slice(interpSpan.start, interpSpan.end);
              const sigil = tracked.lang === 'scss' ? '#' : '@';
              const re = new RegExp(`\\${sigil}\\{\\s*([\\w-]+)\\s*\\}`, 'g');
              let m: RegExpExecArray | null;
              while ((m = re.exec(region)) !== null) {
                const norm = normalizeVar(m[1] ?? '');
                if (norm) {
                  refsVar.push({
                    name: norm,
                    node,
                    span: { start: interpSpan.start + m.index, end: interpSpan.start + m.index + m[0].length }
                  });
                }
              }
            }
            continue;
          }

          for (const child of node.walk()) {
            stack.push(child);
          }
        }

        const severityFor = (code: string): DiagnosticSeverity | null => {
          const s = semanticDiagnosticSeverities[code];
          return typeof s === 'number' ? s : null;
        };

        const spanFor = (n: Node): { start: number; end: number } | null => {
          if (n.type === 'Reference' && n.options?.type === 'variable') {
            let isInInterpolation = false;
            let current: Node | undefined = n;
            while (current?.parent) {
              current = current.parent;
              if (current && current.type === 'Interpolated') {
                isInInterpolation = true;
                break;
              }
            }

            if (isInInterpolation) {
              let actualRefSpan = getSpan(n);
              if (!actualRefSpan) {
                const key = nodeField(n, 'key');
                if (isNode(key)) {
                  actualRefSpan = getSpan(key);
                }
              }

              if (actualRefSpan) {
                const refStartPos = doc.positionAt(actualRefSpan.start);
                const refEndPos = doc.positionAt(actualRefSpan.end);

                let atBraceStart = actualRefSpan.start;
                if (refStartPos.character >= 2) {
                  const lookBackStart = Math.max(0, refStartPos.character - 2);
                  const textBefore = doc.getText(Range.create(
                    Position.create(refStartPos.line, lookBackStart),
                    refStartPos
                  ));
                  if (textBefore === '@{') {
                    atBraceStart = doc.offsetAt(Position.create(refStartPos.line, lookBackStart));
                  } else {
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

                let braceEnd = actualRefSpan.end;
                const textAfter = doc.getText(Range.create(
                  refEndPos,
                  Position.create(refEndPos.line, Math.min(doc.getText().length, refEndPos.character + 1))
                ));
                if (textAfter.startsWith('}')) {
                  braceEnd = doc.offsetAt(Position.create(refEndPos.line, refEndPos.character + 1));
                } else {
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

                if (atBraceStart < braceEnd && atBraceStart >= 0 && braceEnd > atBraceStart) {
                  return { start: atBraceStart, end: braceEnd };
                }
              } else {
                const key = nodeField(n, 'key');
                if (isNode(key)) {
                  const keySpan = getSpan(key);
                  if (keySpan) {
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

          const span = getSpan(n);
          if (span) {
            return span;
          }

          const key = nodeField(n, 'key');
          if (isNode(key)) {
            return getSpan(key);
          }

          if (n.type === 'Call') {
            const nameNode = nodeField(n, 'name');
            if (isNode(nameNode)) {
              return getSpan(nameNode);
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
              // Interpolation refs carry a precise, source-scanned span; plain
              // variable references fall back to the node's AST span.
              const span = r.span ?? spanFor(r.node);
              if (span) {
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
      const tracked = get(uri);
      const tree = tracked.cstDoc?.tree;
      if (!tree) {
        return [];
      }
      return cstFoldingRanges(tree, tracked.document);
    },

    getSelectionRanges(uri, positions) {
      const tracked = get(uri);
      const tree = tracked.cstDoc?.tree;
      if (!tree) {
        return positions.map(p => ({ range: { start: p, end: p } as Range }));
      }
      return cstSelectionRanges(tree, tracked.document, positions);
    },

    getCodeActions(uri, _range, context) {
      // CST-grounded for the SYNTACTIC paths: the declared-symbol inventory
      // behind "did you mean" reads the tolerant CST (no AST reparse), and the
      // undefined identifier is recovered from the diagnostic message. The
      // create-variable / create-mixin fixes are pure text edits. All of this
      // survives an otherwise-invalid document.
      const tracked = get(uri);
      const doc = tracked.document;
      const actions: CodeAction[] = [];

      const diagnostics = Array.isArray(context?.diagnostics) ? context.diagnostics : [];
      const text = doc.getText();

      // Declared-symbol inventories (bare identifiers) for "did you mean" fixes.
      const cstTree = tracked.cstDoc?.tree;
      const declared = cstTree ? cstDeclaredSymbols(cstTree, doc) : { vars: new Set<string>(), mixins: new Set<string>() };
      const declaredVars = declared.vars;
      const declaredMixins = declared.mixins;

      // Closest declared identifiers to `name` (edit distance <= 2), nearest first.
      const suggestClosest = (name: string, pool: Set<string>): string[] => {
        const scored: Array<{ n: string; d: number }> = [];
        for (const candidate of pool) {
          if (candidate === name) {
            continue;
          }
          const d = editDistance(name.toLowerCase(), candidate.toLowerCase());
          if (d <= 2) {
            scored.push({ n: candidate, d });
          }
        }
        scored.sort((a, b) => (a.d - b.d) || a.n.localeCompare(b.n));
        return scored.slice(0, 3).map(s => s.n);
      };

      // Rewrite just the identifier inside a diagnostic range, keeping the sigil /
      // combinator, and yield a "Change to X" quick fix per close-by candidate.
      const pushDidYouMean = (diag: Diagnostic, undefinedIdent: string, pool: Set<string>) => {
        if (!diag.range) {
          return;
        }
        const from = doc.offsetAt(diag.range.start);
        const to = doc.offsetAt(diag.range.end);
        const identRange = findIdentInSpan(text, from, to, undefinedIdent);
        if (!identRange) {
          return;
        }
        const prefix = text.slice(from, identRange.start);
        const suffix = text.slice(identRange.end, to);
        for (const candidate of suggestClosest(undefinedIdent, pool)) {
          const edit: WorkspaceEdit = {
            changes: {
              [uri]: [TextEdit.replace(diag.range, `${prefix}${candidate}${suffix}`)]
            }
          };
          actions.push({
            title: `Change to ${prefix}${candidate}${suffix}`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diag],
            edit
          });
        }
      };

      for (const diag of diagnostics) {
        const code = String(diag?.code ?? '');
        if (code === 'var/undefined') {
          // The undefined name is carried by the diagnostic message (produced by
          // getDiagnostics), so no AST node lookup is needed.
          const raw = String(diag?.message ?? '').match(/Undefined variable\s+(.+)$/)?.[1] ?? '';
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

          pushDidYouMean(diag, name.replace(/^[$@]/, ''), declaredVars);
        }

        if (code === 'mixin/undefined') {
          // The undefined mixin name is carried by the diagnostic message.
          let name = String(diag?.message ?? '').match(/Undefined mixin\s+(.+)$/)?.[1] ?? '';
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

          pushDidYouMean(diag, name.trim().replace(/^[.#]/, '').replace(/\(\s*\)\s*$/, ''), declaredMixins);
        }
      }

      return actions;
    },

    formatDocument(uri) {
      const tracked = ensure(uri);
      const doc = tracked.document;
      const parse = tracked.parse;
      const tree = parse?.tree;
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
      const tracked = get(uri);
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
      const index = tracked.index;
      const data: number[] = [];

      // Rebuilt off the functional Jess AST + source text. The legacy Chevrotain
      // token stream (`parse.lexerResult.tokens`) no longer exists, so tokens are
      // derived by walking the indexed nodes and classifying by node type/span.
      // Interpolated strings are split into string/variable pieces by rescanning
      // the source within the string's span (the AST collapses each interpolation
      // to a single coarse `Reference`, so precise offsets come from the text).
      if (!parse?.tree || !index) {
        return { data };
      }

      const text = doc.getText();
      const typeIdxOf = (t: SemanticTokenType) => SEMANTIC_TOKEN_TYPE_INDEX.get(t) ?? 0;

      type Cand = { start: number; end: number; typeIdx: number };
      const cands: Cand[] = [];
      const push = (start: number, end: number, type: SemanticTokenType) => {
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
          cands.push({ start, end, typeIdx: typeIdxOf(type) });
        }
      };

      // Split an interpolated string region [s, e) into quote/string/variable
      // pieces. Quotes (if present) become their own `string` tokens so themes
      // color them, and each `@{…}` / `#{…}` interpolation becomes a `variable`.
      const interpSource = tracked.lang === 'scss' ? '#\\{[^}]*\\}' : '@\\{[^}]*\\}';
      const emitStringRegion = (s: number, e: number) => {
        let contentStart = s;
        let contentEnd = e;
        const openCh = text.charAt(s);
        if (openCh === '"' || openCh === '\'') {
          push(s, s + 1, 'string');
          contentStart = s + 1;
        }
        const closeCh = text.charAt(e - 1);
        const hasClose = (closeCh === '"' || closeCh === '\'') && e - 1 >= contentStart;
        if (hasClose) {
          contentEnd = e - 1;
        }
        const content = text.slice(contentStart, contentEnd);
        const re = new RegExp(interpSource, 'g');
        let last = contentStart;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) {
          const ms = contentStart + m.index;
          const me = ms + m[0].length;
          if (ms > last) {
            push(last, ms, 'string');
          }
          push(ms, me, 'variable');
          last = me;
          if (me === ms) {
            re.lastIndex++;
          }
        }
        if (contentEnd > last) {
          push(last, contentEnd, 'string');
        }
        if (hasClose) {
          push(e - 1, e, 'string');
        }
      };

      const looksQuoted = (s: number, e: number) => {
        const c = text.charAt(s);
        return (c === '"' || c === '\'') && e > s + 1;
      };

      for (const { node } of index.nodes) {
        const span = getSpan(node);
        if (!span) {
          continue;
        }
        switch (node.type) {
          case 'Comment': {
            push(span.start, span.end, 'comment');
            break;
          }
          case 'StyleImport':
          case 'AtRule':
          case 'AtRuleStatement': {
            // Classify the leading `@keyword` (the rest is covered by child nodes).
            const head = /^@[-\w]+/.exec(text.slice(span.start, span.end));
            if (head) {
              push(span.start, span.start + head[0].length, 'namespace');
            }
            break;
          }
          case 'Reference': {
            const kind = node.options?.type;
            if (kind === 'variable') {
              push(span.start, span.end, 'variable');
            } else if (kind === 'mixin' || kind === 'mixin-ruleset' || kind === 'function') {
              push(span.start, span.end, 'function');
            }
            break;
          }
          case 'Color':
          case 'Num':
          case 'Dimension': {
            push(span.start, span.end, 'number');
            break;
          }
          case 'Interpolated': {
            // The reliable string-region span (the wrapping `Quoted` node's own
            // span is coarse/unreliable when it carries an interpolation).
            if (looksQuoted(span.start, span.end)) {
              emitStringRegion(span.start, span.end);
            } else {
              // Bare (unquoted) interpolation, e.g. a selector/ident fragment.
              const re = new RegExp(interpSource, 'g');
              let m: RegExpExecArray | null;
              const region = text.slice(span.start, span.end);
              while ((m = re.exec(region)) !== null) {
                push(span.start + m.index, span.start + m.index + m[0].length, 'variable');
              }
            }
            break;
          }
          case 'Quoted': {
            // Plain (non-interpolated) string. Interpolated strings surface via
            // their `Interpolated` child; the `Quoted` span is unreliable there,
            // so only emit when the span actually points at a quoted literal.
            if (looksQuoted(span.start, span.end)) {
              emitStringRegion(span.start, span.end);
            }
            break;
          }
          default:
            break;
        }
      }

      // Resolve overlaps: prefer the innermost (shortest) token at any position.
      // Sorting by (start asc, length asc) then greedily accepting anything that
      // starts at/after the last accepted end yields a non-overlapping, fine-
      // grained set (a coarse parent span loses to the finer pieces inside it).
      cands.sort((a, b) => (a.start - b.start) || ((a.end - a.start) - (b.end - b.start)));

      type Pending = { line: number; char: number; length: number; typeIdx: number; modifiers: number };
      const pending: Pending[] = [];
      let acceptedEnd = -1;
      for (const c of cands) {
        if (c.start < acceptedEnd) {
          continue;
        }
        acceptedEnd = c.end;
        // A single semantic token cannot span multiple lines; split on newlines.
        let segStart = c.start;
        while (segStart < c.end) {
          const startPos = doc.positionAt(segStart);
          const lineEndOffset = doc.offsetAt(Position.create(startPos.line + 1, 0));
          const segEnd = Math.min(c.end, lineEndOffset);
          // Trim a trailing newline out of the segment length.
          let len = segEnd - segStart;
          const endPos = doc.positionAt(segEnd);
          if (endPos.line !== startPos.line && len > 0) {
            len -= 1;
          }
          if (len > 0) {
            pending.push({ line: startPos.line, char: startPos.character, length: len, typeIdx: c.typeIdx, modifiers: 0 });
          }
          segStart = segEnd;
        }
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

      const treeAsNode: Node = parse.tree;
      const colors = await colorUtils.findColorsInAST(treeAsNode);
      const result: ColorInformation[] = [];

      for (const { node, color: colorNode } of colors) {
        const span = colorUtils.getNodeSpan(node);
        if (!span) {
          continue;
        }

        try {
          const lspColor = colorUtils.colorToLSP(colorNode);
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
      const presentations = colorUtils.getColorPresentations(color);

      // Set textEdit for each presentation
      return presentations.map((p: ColorPresentation) => ({
        ...p,
        textEdit: TextEdit.replace(range, p.label)
      }));
    }
  };
}
