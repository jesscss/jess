import { parseCssDoc, type CssCstNode, type ParseDoc } from '@jesscss/css-parser';

/*
 * CST parsing is a language-service capability. Compiler/plugin imports use the
 * root parser entrypoints, which construct canonical AST v2 Stylesheets directly.
 */
import { parseLessDoc } from '@jesscss/less-parser/cst';
import { parseScssDoc } from '@jesscss/scss-parser/cst';
import { parseJessDoc } from '@jesscss/jess-parser/cst';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractImports, resolveImport } from '@jesscss/style-resolver';
import {
  cstLintDiagnostics,
  LINT_CODES
} from '@jesscss/diagnostics-core';
import * as colorUtils from './color-utils.js';
import { buildCstIndex, cstDocumentSymbols, cstFoldingRanges, cstSelectionRanges } from './cst-analysis.js';
import { cstSymbolAtOffset, cstFindDefinitionInDoc, cstCollectReferencesInDoc, type CstSymbol } from './cst-symbols.js';
import { cstSemanticTokens, cstVariableNames, cstDeclaredSymbols } from './cst-syntactic.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  CompletionItem,
  InsertTextFormat,
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
  ColorPresentation,
  DocumentHighlight
} from 'vscode-languageserver-types';

export type JessLang = 'css' | 'less' | 'scss' | 'jess';

type TrackedDoc = {
  document: TextDocument;
  lang: JessLang;

  /*
   * The language service is syntactic and incremental: Parseman's tolerant CST
   * is its one source tree. Compiler-facing parser entrypoints build AST v2;
   * language-service features never reparse through a legacy core tree.
   */
  cstDoc: ParseDoc<CssCstNode> | null;

  /*
   * Diagnostic counters (test-visible via `_debugState`): how many content
   * changes took the incremental `.edit()` path vs a full CST rebuild.
   */
  editApplied: number;
  fullRebuild: number;
};

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

// Build the incremental CST document for a dialect.
function parseDocFor(text: string, lang: JessLang): ParseDoc<CssCstNode> {
  if (lang === 'less') {
    return parseLessDoc(text);
  }
  if (lang === 'scss') {
    return parseScssDoc(text);
  }
  if (lang === 'jess') {
    return parseJessDoc(text);
  }
  return parseCssDoc(text);
}

/*
 * Minimal single-range diff between old and new text: the shared prefix and
 * (non-overlapping) shared suffix pin down one contiguous replaced span, which
 * is exactly the `(from, to, replacement)` shape `ParseDoc.edit` wants. An LSP
 * incremental change is already this shape; when the client hands us only merged
 * full text (the `TextDocuments` manager does), this recovers the same edit so a
 * one-character keystroke stays a one-character `.edit()`.
 */
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

/*
 * The functional parsers do not expose the legacy Chevrotain `.suggest()`
 * content-assist entry, so completion routing is driven off the document text
 * and the Jess AST (see `getCompletions`) rather than a token-lookahead stream.
 * Kept as a stable no-op so the routing heuristics fall through to their
 * text/AST-based defaults.
 */
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
  /*
   * Look backwards from offset to find the most recent `:` that's inside a block.
   * Then extract the property name before that colon.
   */
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

/*
 * Conditional-group at-rules whose body may hold nested at-rules AND style rules,
 * so at-rules valid at stylesheet root stay valid inside them (`@font-face` inside
 * `@media` is fine; `@font-face` inside `.a { … }` is not).
 */
const NESTABLE_GROUP_AT = /@(?:media|supports|container|layer|scope|document|-moz-document)\b/i;

/** Is the block enclosing `offset` a STYLE-RULE body (`selector { … }`) rather than
 * the stylesheet root or a conditional-group at-rule body (`@media { … }`)? Used to
 * hide top-level-only at-rules (`@import`, `@font-face`, …) inside style rules. */
function enclosingBlockIsStyleRule(text: string, offset: number): boolean {
  // Walk back to the nearest unclosed `{`.
  let depth = 0;
  let openAt = -1;
  for (let i = Math.min(offset, text.length) - 1; i >= 0; i--) {
    const ch = text.charCodeAt(i);
    if (ch === 125) {
      depth++;
    } else if (ch === 123) {
      if (depth === 0) {
        openAt = i;
        break;
      }
      depth--;
    }
  }
  if (openAt < 0) {
    return false; // stylesheet root
  }

  // The block's header runs back to the previous `{` / `}` / `;`.
  let start = openAt - 1;
  while (start >= 0) {
    const ch = text.charCodeAt(start);
    if (ch === 123 || ch === 125 || ch === 59) {
      break;
    }
    start--;
  }
  const prelude = text.slice(start + 1, openAt);
  return !NESTABLE_GROUP_AT.test(prelude);
}

/** Folding ranges from `/* #region *​/` … `/* #endregion *​/` marker comments
 * (the VS Code convention), paired via a stack so they nest correctly. */
function regionFoldingRanges(document: TextDocument): FoldingRange[] {
  const text = document.getText();
  const re = /\/\*\s*#(region|endregion)\b.*?\*\//g;
  const stack: number[] = [];
  const out: FoldingRange[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const line = document.positionAt(m.index).line;
    if (m[1] === 'region') {
      stack.push(line);
    } else {
      const start = stack.pop();
      if (start !== undefined && line > start) {
        out.push({ startLine: start, endLine: line, kind: 'region' });
      }
    }
  }
  return out;
}

const STYLE_EXTS = new Set(['.css', '.less', '.scss', '.jess', '.sass']);

/** Completions for a filesystem path inside `url(…)` or an `@import`/`@use`/
 * `@forward`/`@from` string. Returns null when the cursor is NOT in such a context
 * (so normal completion proceeds), or a (possibly empty) item list when it is —
 * an empty list still suppresses unrelated completions. Only `file:` docs resolve. */
function pathCompletions(document: TextDocument, offset: number): CompletionItem[] | null {
  const docUri = document.uri;
  if (!docUri.startsWith('file:')) {
    return null;
  }
  const text = document.getText();
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineBefore = text.slice(lineStart, offset);
  const urlM = /url\(\s*['"]?([^'")]*)$/i.exec(lineBefore);
  const impM = /@-?(?:import|use|forward|from)\s+['"]([^'"]*)$/i.exec(lineBefore);
  const m = urlM ?? impM;
  if (!m) {
    return null;
  }
  const partial = m[1] ?? '';

  // Skip absolute URLs / protocol / data URIs / fragments — nothing on disk.
  if (/^(?:[a-z][\w+.-]*:|\/\/|#|\/)/i.test(partial)) {
    return null;
  }
  const slash = partial.lastIndexOf('/');
  const dirPart = slash >= 0 ? partial.slice(0, slash + 1) : '';
  const namePrefix = (slash >= 0 ? partial.slice(slash + 1) : partial).toLowerCase();
  let baseDir: string;
  try {
    baseDir = path.resolve(path.dirname(fileURLToPath(docUri)), dirPart);
  } catch {
    return null;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return []; // valid context, unreadable dir → suppress unrelated completions
  }
  const wantStyleOnly = urlM == null; // @import/@use → style files + dirs only
  const replace = toRange(document, offset - namePrefix.length, offset);
  const items: CompletionItem[] = [];
  for (const ent of entries) {
    const name = ent.name;
    if (name.startsWith('.') && !namePrefix.startsWith('.')) {
      continue; // hide dotfiles unless the user is explicitly typing a dot
    }
    if (namePrefix && !name.toLowerCase().startsWith(namePrefix)) {
      continue;
    }
    if (ent.isDirectory()) {
      items.push({ label: `${name}/`, kind: CompletionItemKind.Folder, textEdit: TextEdit.replace(replace, `${name}/`) });
    } else if (!wantStyleOnly || STYLE_EXTS.has(path.extname(name).toLowerCase())) {
      items.push({ label: name, kind: CompletionItemKind.File, textEdit: TextEdit.replace(replace, name) });
    }
  }
  return items;
}

function pos(line1: number | undefined, col1: number | undefined): Position {
  return Position.create(Math.max(0, (line1 ?? 1) - 1), Math.max(0, (col1 ?? 1) - 1));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/*
 * Within `[start, end)` of `text`, find the first whole-identifier occurrence of
 * `ident` and return its absolute offsets. "Whole identifier" = not flanked by a
 * CSS identifier character (letter/digit/hyphen/underscore), so inside `@primary`
 * the `primary` matches but inside `@primary-alt` / `@primaryX` it does not. This
 * is how a node-level span (a reference `@primary`, or a whole declaration
 * `@primary: red;`, or a mixin block `.button() { … }`) is narrowed to just the
 * name token — rename edits and did-you-mean fixes only touch the identifier and
 * leave the sigil / combinator / punctuation in place.
 */
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

/*
 * Small Levenshtein edit distance, capped: powers the "did you mean" quick fix
 * (suggest a declared symbol close to an undefined reference).
 */
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

/*
 * Data sources:
 * - At-rules: from VS Code's published web custom data (npm package).
 * - Properties: use the same package Less parser uses (`known-css-properties`).
 * - Property values: from web custom data (properties have `values` arrays).
 */
const require = createRequire(import.meta.url);

// Shared enrichment fields carried by web-custom-data entries (used in hover).
type MdnRef = { name: string; url: string };
type Baseline = { status?: 'high' | 'low' | false; baseline_low_date?: string; baseline_high_date?: string };
type Enrich = { syntax?: string; references?: MdnRef[]; baseline?: Baseline };
type AtDirectiveEntry = { name: string; description?: string | { value: string; kind?: string } } & Enrich;
type PropertyEntry = { name: string; description?: string | { value: string; kind?: string }; values?: Array<{ name: string; description?: string | { value: string; kind?: string } }>; restrictions?: string[] } & Enrich;
type PseudoEntry = { name: string; description?: string | { value: string; kind?: string } } & Enrich;
type WebCssData = {
  atDirectives?: AtDirectiveEntry[];
  properties?: PropertyEntry[];
  pseudoClasses?: PseudoEntry[];
  pseudoElements?: PseudoEntry[];
};

/*
 * Host-injectable custom CSS data (MS `setDataProviders` shape) — extra
 * properties / at-rules / pseudos merged into completion + hover per engine.
 */
export type CustomCssData = WebCssData;

const webCssData: WebCssData = require('@vscode/web-custom-data/data/browsers.css-data.json');

const AT_RULES: string[] = (webCssData.atDirectives ?? []).map(d => d.name).filter(Boolean);

/*
 * At-rules valid ONLY at stylesheet root — never nested at all (not even in a
 * conditional-group like `@media`). `@import`/`@charset` must precede all rules.
 */
const ROOT_ONLY_AT_RULES = new Set(['charset', 'import', 'namespace']);

/*
 * At-rules invalid directly inside a STYLE rule, but fine at root or in a
 * conditional-group (`@font-face` inside `@media` is valid). Mirrors MS filtering.
 */
const STYLE_RULE_INVALID_AT_RULES = new Set([
  'font-face', 'keyframes', 'page', 'property', 'counter-style',
  'font-feature-values', 'viewport', 'document'
]);
const AT_RULES_MAP = new Map<string, AtDirectiveEntry>();
for (const d of webCssData.atDirectives ?? []) {
  if (d.name) {
    AT_RULES_MAP.set(d.name.toLowerCase(), d);
  }
}

const knownCssProperties: { all?: unknown } = require('known-css-properties');
const CSS_PROPERTIES: string[] = Array.isArray(knownCssProperties.all) ? knownCssProperties.all.filter((v): v is string => typeof v === 'string') : [];

/*
 * Lowercased set for the unknown-property lint (reuses the `known-css-properties`
 * data that also feeds completions). The web-custom-data `PROPERTIES_MAP` is
 * consulted alongside it at lint time for extra coverage.
 */
const CSS_PROPERTY_SET = new Set<string>(CSS_PROPERTIES.map(p => p.toLowerCase()));

// Build property name -> property data map for hover/completions.
const PROPERTIES_MAP = new Map<string, PropertyEntry>();
const PROPERTY_VALUES = new Map<string, string[]>();

/*
 * `restrictions` is the value-KIND hint (color/length/timing-function/…) that
 * drives rich value completions — the data MS reads and Jess previously ignored.
 */
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
const PSEUDO_CLASSES_MAP = new Map<string, PseudoEntry>();
const PSEUDO_ELEMENTS_MAP = new Map<string, PseudoEntry>();
for (const p of webCssData.pseudoClasses ?? []) {
  if (p.name) {
    PSEUDO_CLASSES_MAP.set(p.name.toLowerCase(), p);
  }
}
for (const p of webCssData.pseudoElements ?? []) {
  if (p.name) {
    PSEUDO_ELEMENTS_MAP.set(p.name.toLowerCase(), p);
  }
}

/** Append MDN link + Baseline status + formal syntax to a hover, from the
 * enrichment fields web-custom-data ships. Empty string when nothing to add. */
function hoverExtras(entry: Enrich): string {
  const parts: string[] = [];
  if (entry.syntax) {
    parts.push(`**Syntax:** \`${entry.syntax}\``);
  }
  const status = entry.baseline?.status;
  if (status === 'high') {
    parts.push('✓ Baseline: widely available');
  } else if (status === 'low') {
    parts.push('⚠ Baseline: newly available');
  } else if (status === false) {
    parts.push('⚠ Limited availability — not Baseline');
  }
  const mdn = entry.references?.find(r => /mdn/i.test(r.name));
  if (mdn) {
    parts.push(`[MDN Reference](${mdn.url})`);
  }
  return parts.length ? `\n\n${parts.join('  \n')}` : '';
}

/*
 * Value-completion vocab. CSS-wide keywords are valid for every property; the
 * rest are gated on the property's `restrictions`.
 */
const CSS_WIDE_KEYWORDS = ['inherit', 'initial', 'unset', 'revert', 'revert-layer'];
const COLOR_FUNCTIONS = ['rgb()', 'rgba()', 'hsl()', 'hsla()', 'hwb()', 'lab()', 'lch()', 'oklab()', 'oklch()', 'color()'];

// @media prelude vocabulary (feature names + types + logical operators).
const MEDIA_FEATURES = ['width', 'min-width', 'max-width', 'height', 'min-height', 'max-height', 'aspect-ratio', 'orientation', 'resolution', 'min-resolution', 'max-resolution', 'prefers-color-scheme', 'prefers-reduced-motion', 'prefers-contrast', 'hover', 'any-hover', 'pointer', 'any-pointer', 'display-mode', 'color', 'color-gamut', 'forced-colors', 'scripting'];
const MEDIA_PRELUDE = [...MEDIA_FEATURES, 'screen', 'print', 'all', 'speech', 'and', 'or', 'not', 'only'];

// Built-in Sass modules (scss/jess) and their members — for `math.<x>` completions.
const SASS_MODULES: Record<string, string[]> = {
  math: ['abs()', 'ceil()', 'floor()', 'round()', 'div()', 'max()', 'min()', 'percentage()', 'random()', 'clamp()', 'pow()', 'sqrt()', 'hypot()', 'log()', 'sin()', 'cos()', 'tan()', 'compatible()', 'is-unitless()', 'unit()', '$pi', '$e'],
  color: ['adjust()', 'change()', 'scale()', 'red()', 'green()', 'blue()', 'hue()', 'saturation()', 'lightness()', 'alpha()', 'mix()', 'complement()', 'invert()', 'grayscale()', 'ie-hex-str()'],
  string: ['quote()', 'unquote()', 'index()', 'insert()', 'length()', 'slice()', 'to-upper-case()', 'to-lower-case()', 'unique-id()', 'split()'],
  list: ['append()', 'index()', 'join()', 'length()', 'nth()', 'set-nth()', 'separator()', 'is-bracketed()', 'slash()', 'zip()'],
  map: ['get()', 'has-key()', 'keys()', 'merge()', 'remove()', 'values()', 'set()', 'deep-merge()', 'deep-remove()'],
  meta: ['type-of()', 'inspect()', 'keywords()', 'call()', 'content-exists()', 'feature-exists()', 'function-exists()', 'global-variable-exists()', 'mixin-exists()', 'variable-exists()', 'module-variables()', 'module-functions()', 'get-function()', 'get-mixin()', 'apply()', 'accepts-content()', 'calc-name()', 'calc-args()'],
  selector: ['append()', 'extend()', 'is-superselector()', 'nest()', 'parse()', 'replace()', 'simple-selectors()', 'unify()']
};
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

    // A `foo()` completion inserts as a snippet placing the cursor inside the parens.
    const isFn = label.endsWith('()');
    const newText = isFn ? `${label.slice(0, -1)}$1)` : label;
    const item: CompletionItem = { label, kind, textEdit: TextEdit.replace(replaceRange, newText) };
    if (isFn) {
      item.insertTextFormat = InsertTextFormat.Snippet;
    }
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
  findDocumentHighlights(uri: string, position: Position): DocumentHighlight[];
  prepareRename(uri: string, position: Position): { range: Range; placeholder: string } | null;
  rename(uri: string, position: Position, newName: string): WorkspaceEdit | null;
  getDocumentSymbols(uri: string): DocumentSymbol[];
  getDiagnostics(uri: string): Diagnostic[];
  getFoldingRanges(uri: string): FoldingRange[];
  getSelectionRanges(uri: string, positions: Position[]): SelectionRange[];
  getCodeActions(uri: string, range: Range, context: CodeActionContext): CodeAction[];
  formatDocument(uri: string): TextEdit[];
  formatRange(uri: string, range: Range): TextEdit[];
  setDataProviders(data: CustomCssData[]): void;
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

/** Small CST/source formatter for editor requests. It deliberately formats only
 * structural punctuation; semantic rendering belongs to the compiler. */
function formatStyleSource(source: string): string {
  let out = '';
  let indent = 0;
  let pendingSpace = false;
  const write = (text: string) => {
    out += text;
  };
  const newline = () => {
    out = out.replace(/[ \t]+$/, '');
    if (!out.endsWith('\n')) {
      write('\n');
    }
    write('  '.repeat(indent));
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      pendingSpace = true;
      continue;
    }
    if (ch === '{') {
      out = out.replace(/[ \t]*$/, '');
      write(' {');
      indent++;
      newline();
      pendingSpace = false;
    } else if (ch === '}') {
      indent = Math.max(0, indent - 1);
      out = out.replace(/[ \t\n]*$/, '');
      if (out.length > 0 && !out.endsWith('{') && !out.endsWith('}') && !out.endsWith(';')) {
        write(';');
      }
      write('\n' + '  '.repeat(indent) + '}');
      pendingSpace = false;
    } else if (ch === ';') {
      out = out.replace(/[ \t]*$/, '');
      write(';');
      newline();
      pendingSpace = false;
    } else if (ch === ':') {
      out = out.replace(/[ \t]*$/, '');
      write(': ');
      pendingSpace = false;
    } else {
      if (pendingSpace && out.length > 0 && !out.endsWith('\n') && !out.endsWith(' ') && !out.endsWith('(')) {
        write(' ');
      }
      write(ch);
      pendingSpace = false;
    }
  }
  return out.trimEnd();
}

export function createEngine(): JessLanguageServiceEngine {
  const docs = new Map<string, TrackedDoc>();

  // Host-injected custom CSS data (setDataProviders), merged into completion/hover.
  let customData: CustomCssData[] = [];
  const customProperties = () => customData.flatMap(d => d.properties ?? []);
  const customAtRules = () => customData.flatMap(d => d.atDirectives ?? []);

  // Import graph: maps URI -> Set of imported URIs
  const importGraph = new Map<string, Set<string>>();

  // Cached imported documents (loaded from disk)
  const importedDocs = new Map<string, TrackedDoc>();
  let semanticDiagnosticSeverities: Record<string, DiagnosticSeverity> = {
    /* eslint-disable @typescript-eslint/naming-convention */
    'var/undefined': DiagnosticSeverity.Warning,
    'mixin/undefined': DiagnosticSeverity.Warning,

    /*
     * CST lint rules (MS vscode-css-languageservice parity). Keys match
     * `LINT_CODES`; every rule's severity is settable via `configure()` and
     * disabled with `ignore`/`off`.
     */
    [LINT_CODES.emptyRules]: DiagnosticSeverity.Warning,
    [LINT_CODES.unknownProperties]: DiagnosticSeverity.Warning,
    [LINT_CODES.unknownPropertyValues]: DiagnosticSeverity.Warning,
    [LINT_CODES.unknownAtRules]: DiagnosticSeverity.Warning,
    [LINT_CODES.duplicateProperties]: DiagnosticSeverity.Warning,
    [LINT_CODES.hexColorLength]: DiagnosticSeverity.Error,
    [LINT_CODES.invalidColorFunctionChannels]: DiagnosticSeverity.Error,
    [LINT_CODES.zeroUnits]: DiagnosticSeverity.Hint,
    [LINT_CODES.fontFaceMissingRequiredProperties]: DiagnosticSeverity.Warning,
    [LINT_CODES.propertyIgnoredDueToDisplay]: DiagnosticSeverity.Warning,

    /*
     * Parsed-but-never-evaluated SCSS forms. The "Unsupported Sass Features"
     * guide specifies a warning at the use site, not a hard parse error.
     */
    [LINT_CODES.unsupportedSassForm]: DiagnosticSeverity.Warning
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
      case 'ignore':
        return null;
      default:
        return null;
    }
  }

  /*
   * Raw fetch (no analysis) — for the sync path (`change`/`edit`) that only needs
   * to update text + the CST doc, deferring the Jess-AST re-derivation.
   */
  function get(uri: string): TrackedDoc {
    const doc = docs.get(uri);
    if (!doc) {
      throw new Error(`Unknown document: ${uri}`);
    }
    return doc;
  }

  /*
   * Rebuild the incremental CST document from scratch (used on open and as the
   * fallback when an edit can't be expressed as one contiguous range).
   */
  function rebuildCstDoc(t: TrackedDoc) {
    try {
      t.cstDoc = parseDocFor(t.document.getText(), t.lang);
    } catch {
      t.cstDoc = null;
    }
  }

  // Apply a single contiguous text edit to a tracked doc and sync its CST.
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
  }

  // Load and parse an imported file from disk
  function loadImportedFile(importedUri: string, lang: JessLang, _visited: Set<string>): TrackedDoc | null {
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

    /*
     * Imported files are loaded from disk and never edited in place. They still
     * need a CST doc so symbol features can search across imports.
     */
    const tracked: TrackedDoc = { document, lang: inferredLang, cstDoc: null, editApplied: 0, fullRebuild: 0 };
    rebuildCstDoc(tracked);
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

          /*
           * Recursively load imported file (with cycle detection)
           * If file is already in docs, we still want to track it in the import graph
           * but we don't need to load it again
           */
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

  /*
   * Resolve a URI to its CST tree + document, for cross-document symbol search.
   * Both open (`docs`) and imported (`importedDocs`) files carry an eagerly-built
   * CST doc; a doc whose CST failed to build (null tree) is skipped.
   */
  function cstDocRef(targetUri: string): { doc: TextDocument; tree: CssCstNode } | null {
    const tracked = docs.get(targetUri) ?? importedDocs.get(targetUri);
    const tree = tracked?.cstDoc?.tree;
    if (!tracked || !tree) {
      return null;
    }
    return { doc: tracked.document, tree };
  }

  /*
   * Collect declared CSS custom properties (`--name:`) from a document and all of
   * its transitive imports, for `var()` completion. Text-mined (cheap + tolerant);
   * custom properties are a flat global namespace, so cross-import merge is exact.
   */
  function collectCustomProps(startUri: string): Set<string> {
    const props = new Set<string>();
    const visited = new Set<string>();
    const walk = (uri: string) => {
      if (visited.has(uri)) {
        return;
      }
      visited.add(uri);
      const tracked = docs.get(uri) ?? importedDocs.get(uri);
      if (tracked) {
        const re = /(--[-\w]+)\s*:/g;
        const src = tracked.document.getText();
        let m: RegExpExecArray | null;
        while ((m = re.exec(src)) !== null) {
          props.add(m[1]!);
        }
      }
      for (const imported of importGraph.get(uri) ?? []) {
        walk(imported);
      }
    };
    walk(startUri);
    return props;
  }

  /*
   * Helper: find a symbol's definition across documents (current doc first, then
   * its imports, depth-first with cycle detection) off the tolerant CST.
   */
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

  /*
   * Helper: collect a symbol's references + declaration in a single document's
   * CST (the caller loops all open + imported docs with a shared `visited` set,
   * so each doc is processed once regardless of import edges).
   */
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

  /*
   * Shared resolver behind find-references AND rename: from a cursor position,
   * resolve the innermost variable/mixin declaration or reference off the CST,
   * then collect every reference to that symbol across the current + imported +
   * open docs. Returns the symbol kind, the bare identifier to target inside each
   * span, and the node-level locations. `findReferences` returns `.locations`
   * verbatim; rename narrows each location to its identifier via `findIdentInSpan`.
   */
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
      /*
       * Expected shape (from client settings): { diagnostics?: { severity?: Record<string, string> } }
       * Example: { diagnostics: { severity: { "var/undefined": "error" } } }
       */
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
            /*
             * off/ignore or invalid: delete so the rule is disabled (a missing
             * key yields no severity at lookup-time, so the rule emits nothing).
             */
            if (v === 'off' || v === 'ignore') {
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
      const tracked: TrackedDoc = { document, lang, cstDoc: null, editApplied: 0, fullRebuild: 0 };
      docs.set(uri, tracked);
      rebuildCstDoc(tracked);
      updateImportGraph(uri, tracked);
    },
    change(uri, version, text) {
      /*
       * Full-text change notification (what the `TextDocuments` manager delivers):
       * recover the minimal contiguous edit vs the previous text and drive the CST
       * doc through `.edit()`, so a keystroke reparses one subtree, not the file.
       */
      const tracked = get(uri);
      const oldText = tracked.document.getText();
      const { from, to, replacement } = diffRange(oldText, text);
      applyContiguousEdit(tracked, from, to, replacement, text, version);
      updateImportGraph(uri, tracked);
    },
    edit(uri, version, changes) {
      /*
       * LSP incremental-change form: each change is `{ range?, text }`. A single
       * ranged change maps directly to one `(from, to, replacement)` `.edit()`.
       * Anything else (a rangeless full replace, or a multi-range batch that a
       * single `.edit()` can't express) falls back to a full CST rebuild — still
       * correct, just not incremental.
       */
      const tracked = get(uri);
      const single = changes.length === 1 ? changes[0] : undefined;
      if (single?.range) {
        const from = tracked.document.offsetAt(single.range.start);
        const to = tracked.document.offsetAt(single.range.end);
        const oldText = tracked.document.getText();
        const newText = oldText.slice(0, from) + single.text + oldText.slice(to);
        applyContiguousEdit(tracked, from, to, single.text, newText, version);
      } else {
        tracked.document = TextDocument.update(tracked.document, [...changes], version);
        rebuildCstDoc(tracked);
        tracked.fullRebuild++;
      }
      updateImportGraph(uri, tracked);
    },
    close(uri) {
      docs.delete(uri);
      importGraph.delete(uri);

      // Note: We keep importedDocs in cache even after close, as they may be referenced by other files
    },

    /*
     * Test/diagnostic hook: the incremental CST tree (Parseman relative spans) and
     * the edit-path counters. Not part of the LSP surface.
     */
    _debugState(uri) {
      const tracked = get(uri);
      return {
        cstTree: tracked.cstDoc?.tree ?? null,
        editApplied: tracked.editApplied,
        fullRebuild: tracked.fullRebuild
      };
    },

    getCompletions(uri, position) {
      /*
       * CST-grounded for the syntactic paths (declared variables/mixins): reads
       * the tolerant CST (no AST reparse) so completion survives half-typed input.
       * Property / value / at-rule / pseudo completions are data + text driven.
       */
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

      /*
       * 0) Filesystem path completion inside `url(…)` / `@import`/`@use` strings.
       * Returns null when not in a path context (fall through to normal logic).
       */
      const pathItems = pathCompletions(document, offset);
      if (pathItems) {
        return { isIncomplete: false, items: pathItems };
      }

      /*
       * 0b) Placeholder completions, mined from every placeholder token in the doc
       * (defs + prior usages), deduped. SCSS uses the `%name` sigil (after `%`
       * / `@extend %`); Jess uses `\\name` (after `\\` / `$extend \\`) — the
       * escaped-backslash sigil the scss `%` lowers to.
       */
      const placeholderSigil =
        tracked.lang === 'scss' && currentWord.startsWith('%')
          ? /%[-\w]+/g
          : tracked.lang === 'jess' && currentWord.startsWith('\\')
            ? /\\\\[-\w]+/g
            : null;
      if (placeholderSigil) {
        const seen = new Set<string>();
        const re = placeholderSigil;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          seen.add(m[0]);
        }
        for (const ph of seen) {
          if (ph.toLowerCase() === prefix) {
            continue; // the partial under the cursor, not a real candidate
          }
          if (prefix.length > 1 && !ph.toLowerCase().startsWith(prefix)) {
            continue;
          }
          push(ph, CompletionItemKind.Class);
        }
        if (items.length > 0) {
          return { isIncomplete: false, items };
        }
      }

      /*
       * 0a2) `var(…)` custom-property completion, mined across the document AND its
       * transitive imports (custom props are a flat global namespace).
       */
      {
        const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
        const lineBefore = text.slice(lineStart, offset);
        if (/var\(\s*(?:--[-\w]*)?$/i.test(lineBefore)) {
          for (const name of collectCustomProps(uri)) {
            if (prefix && !name.toLowerCase().startsWith(prefix)) {
              continue;
            }
            push(name, CompletionItemKind.Variable);
          }
          if (items.length > 0) {
            return { isIncomplete: false, items };
          }
        }
      }

      /*
       * 0c) Interpolation-context variable completion: inside Less `@{…}` or Jess
       * `${…}` / `$[…]` the sigil is the wrapper, so offer BARE variable
       * names. (SCSS `#{$x}` already flows through the `$`-prefixed variable
       * path below.) Jess spells interpolation `${…}` in name, selector, and
       * string positions and keeps `$[…]` as the value-position lookup, so
       * both openers are completion contexts.
       */
      {
        const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
        const lineBefore = text.slice(lineStart, offset);
        const inInterp =
          (tracked.lang === 'less' && /@\{[-\w]*$/.test(lineBefore))
          || (tracked.lang === 'jess' && /\$[[{][-\w]*$/.test(lineBefore));
        if (inInterp && cstTree) {
          for (const name of cstVariableNames(cstTree, document)) {
            if (prefix && !name.toLowerCase().startsWith(prefix)) {
              continue;
            }
            push(name, CompletionItemKind.Variable);
          }
          if (items.length > 0) {
            return { isIncomplete: false, items };
          }
        }
      }

      /*
       * 1) Variable completions: Less @var, SCSS $var, CSS custom properties --x.
       * .jess uses `$`-sigil variables like SCSS (both parse to VarDeclaration/Reference).
       */
      const scssLike = tracked.lang === 'scss' || tracked.lang === 'jess';
      const wantVar =
        tracked.lang === 'less'
          ? currentWord.startsWith('@')
          : scssLike
            ? currentWord.startsWith('$')
            : currentWord.startsWith('--');
      if (wantVar && cstTree) {
        for (const nameWithoutPrefix of cstVariableNames(cstTree, document)) {
          const label = tracked.lang === 'less'
            ? `@${nameWithoutPrefix}`
            : scssLike ? `$${nameWithoutPrefix}` : `--${nameWithoutPrefix}`;
          if (prefix && !label.toLowerCase().startsWith(prefix)) {
            continue;
          }
          push(label, CompletionItemKind.Variable);
        }
        if (items.length > 0) {
          return { isIncomplete: false, items };
        }
      }

      /*
       * 2) SCSS mixin completions after `@include ` — reuses the CST declared-mixin
       * inventory (same one the did-you-mean quick fix uses).
       */
      if (tracked.lang === 'scss' && cstTree && /@include\s+$/.test(before)) {
        for (const name of cstDeclaredSymbols(cstTree, document).mixins) {
          if (prefix && !name.toLowerCase().startsWith(prefix)) {
            continue;
          }
          push(name, CompletionItemKind.Function);
        }
        return { isIncomplete: false, items };
      }

      /*
       * 2b) Less/Jess mixin-call completions: `.foo(` inside a rule block (a `.foo`
       * at top level is a selector definition, so gate on nesting depth). Jess
       * reuses Less-style `.name() { … }` mixins (grammarType `Mixin`).
       */
      if ((tracked.lang === 'less' || tracked.lang === 'jess') && cstTree && currentWord.startsWith('.') && braceDepthBefore(text, offset) > 0) {
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

      // 2e) Sass built-in module members: `math.<x>` (scss/jess).
      if (scssLike) {
        const nsMatch = /^(math|color|string|list|map|meta|selector)\.([\w-]*)$/.exec(currentWord);
        if (nsMatch) {
          const ns = nsMatch[1]!;
          const memberPrefix = nsMatch[2]!.toLowerCase();
          for (const member of SASS_MODULES[ns] ?? []) {
            if (memberPrefix && !member.toLowerCase().startsWith(memberPrefix)) {
              continue;
            }
            const full = `${ns}.${member}`;
            const isFn = member.endsWith('()');
            const item: CompletionItem = {
              label: full,
              kind: isFn ? CompletionItemKind.Function : CompletionItemKind.Variable,
              textEdit: TextEdit.replace(replaceRange, isFn ? `${full.slice(0, -1)}$1)` : full)
            };
            if (isFn) {
              item.insertTextFormat = InsertTextFormat.Snippet;
            }
            items.push(item);
          }
          if (items.length > 0) {
            return { isIncomplete: false, items };
          }
        }
      }

      // 2c) @media prelude: feature names / media types / logical operators.
      if (/@media\b[^{}]*$/.test(before)) {
        for (const f of MEDIA_PRELUDE) {
          if (prefix && !f.toLowerCase().startsWith(prefix)) {
            continue;
          }
          push(f, CompletionItemKind.Property);
        }
        if (items.length > 0) {
          return { isIncomplete: false, items };
        }
      }

      // 2d) @keyframes body: from / to selectors.
      if (/@keyframes\s+[\w-]+\s*\{[^{}]*$/.test(before)) {
        for (const k of ['from', 'to']) {
          if (prefix && !k.startsWith(prefix)) {
            continue;
          }
          push(k, CompletionItemKind.Keyword);
        }
        if (items.length > 0) {
          return { isIncomplete: false, items };
        }
      }

      /*
       * 3) Pseudo-class / -element completions: a `:`/`::` in SELECTOR position —
       * i.e. the colon is NOT a declaration value colon after a known property.
       */
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

      /*
       * 4) At-rule names — context-filtered: inside a style rule, hide at-rules
       * that are only valid at stylesheet root (or in a conditional-group).
       */
      if (wantsAt) {
        const nested = braceDepthBefore(text, offset) > 0;
        const inStyleRule = nested && enclosingBlockIsStyleRule(text, offset);
        for (const name of [...AT_RULES, ...customAtRules().map(a => a.name).filter(Boolean)]) {
          if (prefix && !name.toLowerCase().startsWith(prefix)) {
            continue;
          }
          const bare = name.replace(/^@/, '').toLowerCase();
          if (nested && ROOT_ONLY_AT_RULES.has(bare)) {
            continue;
          }
          if (inStyleRule && STYLE_RULE_INVALID_AT_RULES.has(bare)) {
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
          for (const name of [...CSS_PROPERTIES, ...customProperties().map(p => p.name).filter(Boolean)]) {
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
      const tracked = get(uri);
      const document = tracked.document;
      const text = document.getText();
      const offset = document.offsetAt(position);
      const word = getCurrentWord(text, offset);

      if (!word) {
        return null;
      }

      // Check for at-rule hover.
      if (word.startsWith('@')) {
        const entry = AT_RULES_MAP.get(word.toLowerCase())
          ?? customAtRules().find(a => a.name.toLowerCase() === word.toLowerCase());
        if (entry?.description) {
          const desc = typeof entry.description === 'string' ? entry.description : entry.description.value;
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: `**${entry.name}**\n\n${desc}${hoverExtras(entry)}`
            }
          };
        }
      }

      // Pseudo-class / -element hover (the word is the ident after `:` / `::`).
      {
        const WB = ' \t\n\r":{[()]},*>+;}';
        let s = offset - 1;
        while (s >= 0 && WB.indexOf(text.charAt(s)) === -1) {
          s--;
        }
        let colons = 0;
        while (s >= 0 && text.charAt(s) === ':') {
          colons++;
          s--;
        }
        if (colons === 1 || colons === 2) {
          const entry = colons === 2
            ? PSEUDO_ELEMENTS_MAP.get(`::${word}`.toLowerCase())
            : (PSEUDO_CLASSES_MAP.get(`:${word}`.toLowerCase()) ?? PSEUDO_ELEMENTS_MAP.get(`::${word}`.toLowerCase()));
          if (entry?.description) {
            const desc = typeof entry.description === 'string' ? entry.description : entry.description.value;
            return {
              contents: {
                kind: MarkupKind.Markdown,
                value: `**${entry.name}**\n\n${desc}${hoverExtras(entry)}`
              }
            };
          }
        }
      }

      // Check for property name hover.
      const propEntry = PROPERTIES_MAP.get(word.toLowerCase())
        ?? customProperties().find(p => p.name.toLowerCase() === word.toLowerCase());
      if (propEntry?.description) {
        const desc = typeof propEntry.description === 'string' ? propEntry.description : propEntry.description.value;
        return {
          contents: {
            kind: MarkupKind.Markdown,
            value: `**${propEntry.name}**\n\n${desc}${hoverExtras(propEntry)}`
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
      /*
       * CST-grounded (Option B): resolve the symbol under the cursor off the
       * tolerant CST (no AST reparse), then search the current doc + its imports
       * for its declaration. Only a REFERENCE navigates (a cursor on a
       * declaration has nothing to go to), matching the AST behavior.
       */
      const tracked = get(uri);
      const document = tracked.document;
      const tree = tracked.cstDoc?.tree;
      if (!tree) {
        return null;
      }

      const offset = document.offsetAt(position);
      const sym = cstSymbolAtOffset(tree, document, offset);
      if (sym?.role !== 'reference') {
        return null;
      }

      return findDefinitionAcrossDocs(uri, sym, new Set());
    },

    findReferences(uri, position) {
      return collectReferenceSet(uri, position)?.locations ?? [];
    },

    findDocumentHighlights(uri, position) {
      /*
       * Highlight all occurrences of the symbol under the cursor in THIS document
       * (reuses the reference resolver, scoped to the current file).
       */
      const set = collectReferenceSet(uri, position);
      if (!set) {
        return [];
      }
      return set.locations.filter(l => l.uri === uri).map(l => ({ range: l.range }));
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

      /*
       * Only offer rename when the cursor is on the symbol itself (its sigil or
       * name), not elsewhere in a wider declaration span (e.g. on the value).
       */
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

      /*
       * Normalize the requested name to a bare identifier: only the name token is
       * rewritten at each site, so the sigil (`@`/`$`) or mixin combinator (`.`/`#`)
       * already present in the source is preserved. A user who types a sigil is
       * tolerated (it is stripped).
       */
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
      /*
       * CST-grounded (Option B): the tolerant, incremental CST powers the
       * outline, so it survives half-typed input where the eval AST yields
       * nothing. No AST reparse needed (uses the eagerly-synced cstDoc).
       */
      const tracked = get(uri);
      const tree = tracked.cstDoc?.tree;
      if (!tree) {
        return [];
      }
      return cstDocumentSymbols(tree, tracked.document);
    },

    getDiagnostics(uri) {
      const tracked = get(uri);
      const doc = tracked.document;
      const cstDoc = tracked.cstDoc;
      if (!cstDoc) {
        return [];
      }

      const diagnostics: Diagnostic[] = [];
      const text = doc.getText();
      const textLength = text.length;

      /*
       * A parser reports where CONSUMPTION stopped, which is the boundary BEFORE
       * the whitespace preceding the offending token (`a { color: |) ;`). Where
       * the squiggle goes is an editor concern, not a parser fact: anchor it on
       * the offending TOKEN so the underline never covers only a space. A
       * whitespace-only tail keeps the original offset, so a stop at EOF still
       * produces a range.
       */
      const skipBlank = (from: number): number => {
        let at = from;
        while (at < textLength && /\s/.test(text.charAt(at))) {
          at++;
        }
        return at < textLength ? at : from;
      };
      const diagnosticRange = (start: number, end: number): Range => {
        const from = Math.max(0, Math.min(textLength, start));
        const to = Math.max(from, Math.min(textLength, end));
        const anchor = skipBlank(from);
        return {
          start: doc.positionAt(anchor),
          end: doc.positionAt(to > anchor ? to : Math.min(textLength, anchor + 1))
        };
      };
      const rootFailureAnchor = (): number => {
        const open = text.indexOf('{');
        if (open < 0) {
          return skipBlank(0);
        }
        const bodyStart = skipBlank(open + 1);
        const colon = text.indexOf(':', bodyStart);
        const badCloseParen = text.indexOf(')', bodyStart);
        if (colon >= 0 && badCloseParen > colon) {
          return badCloseParen;
        }
        return bodyStart;
      };

      /*
       * ParseDoc is the parser's editor-facing result: recovery errors and a
       * hard failure are already absolute, so report the first one rather than
       * reparsing through an obsolete AST result.
       */
      const parseError = cstDoc.errors[0];
      if (parseError) {
        diagnostics.push({
          code: 'parse/parser',
          source: 'jess',
          message: parseError.expected.length > 0
            ? `Expected ${parseError.expected.join(' or ')}`
            : 'Parsing error',
          severity: DiagnosticSeverity.Error,
          range: diagnosticRange(parseError.span.start, parseError.span.end)
        });
      } else if (cstDoc.unconsumedFrom !== null) {
        const unconsumedFrom = cstDoc.unconsumedFrom === 0 && cstDoc.tree?.span.end === 0
          ? rootFailureAnchor()
          : cstDoc.unconsumedFrom;
        diagnostics.push({
          code: 'parse/parser',
          source: 'jess',
          message: 'Unexpected input',
          severity: DiagnosticSeverity.Error,
          range: diagnosticRange(unconsumedFrom, unconsumedFrom + 1)
        });
      }

      const tree = cstDoc.tree;
      if (tree) {
        const cstDiagnostics = cstLintDiagnostics(tree, text, tracked.lang, {
          isKnownProperty: name => CSS_PROPERTY_SET.has(name) || PROPERTIES_MAP.has(name),
          isKnownAtRule: name => AT_RULES_MAP.has(`@${name}`)
        }, undefined, cstDoc.errors.length > 0 || cstDoc.unconsumedFrom !== null);
        for (const diagnostic of cstDiagnostics) {
          const configured = semanticDiagnosticSeverities[diagnostic.code];
          if (typeof configured !== 'number') {
            continue;
          }
          diagnostics.push({
            code: diagnostic.code,
            source: diagnostic.source,
            message: diagnostic.message,
            severity: configured,
            range: diagnosticRange(diagnostic.start, diagnostic.end)
          });
        }

        /*
         * Undefined-name diagnostics are editor heuristics, not compiler
         * evaluation. Keep them CST/source-grounded: declarations come from the
         * tolerant tree and every occurrence retains its exact source span.
         */
        if (tracked.lang !== 'css') {
          const declared = cstDeclaredSymbols(tree, doc);
          const modern = tracked.lang === 'scss'
            ? /@use\s+/.test(text)
            : tracked.lang === 'less' && /@(from|compose)\s+/.test(text);
          const severity = (code: string) => {
            const configured = semanticDiagnosticSeverities[code];
            return typeof configured === 'number' ? configured : null;
          };
          const variable = /(?:@|\$)\{?\s*([\w-]+)\s*\}?/g;
          let match: RegExpExecArray | null;
          while ((match = variable.exec(text)) !== null) {
            const name = match[1]!;
            const after = text[match.index + match[0]!.length];
            if (after === ':' || ['import', 'media', 'use', 'mixin', 'include', 'function', 'from', 'compose'].includes(name) || declared.vars.has(name)) {
              continue;
            }
            const configured = severity('var/undefined');
            if (configured !== null) {
              diagnostics.push({
                code: 'var/undefined',
                source: 'jess',
                message: `Undefined variable ${formatVarName(tracked.lang, name)}`,
                severity: modern ? DiagnosticSeverity.Error : configured,
                range: diagnosticRange(match.index, match.index + match[0]!.length)
              });
            }
          }
          if (tracked.lang === 'less') {
            const mixin = /[.#]([\w-]+)\s*\(/g;
            while ((match = mixin.exec(text)) !== null) {
              const name = match[1]!;
              if (declared.mixins.has(name)) {
                continue;
              }
              const configured = severity('mixin/undefined');
              if (configured !== null) {
                diagnostics.push({
                  code: 'mixin/undefined',
                  source: 'jess',
                  message: `Undefined mixin ${match[0]!.trim().replace(/\($/, '')}`,
                  severity: configured,
                  range: diagnosticRange(match.index, match.index + match[0]!.lastIndexOf('('))
                });
              }
            }
          }
        }
      }

      diagnostics.sort((a, b) => {
        if (a.range.start.line !== b.range.start.line) {
          return a.range.start.line - b.range.start.line;
        }
        return a.range.start.character - b.range.start.character;
      });
      const seen = new Set<string>();
      return diagnostics.filter((diagnostic) => {
        const key = `${diagnostic.code ?? ''}:${diagnostic.range.start.line}:${diagnostic.range.start.character}:${diagnostic.range.end.line}:${diagnostic.range.end.character}:${diagnostic.message}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      }).slice(0, 200);
    },
    getFoldingRanges(uri) {
      const tracked = get(uri);
      const tree = tracked.cstDoc?.tree;
      const structural = tree ? cstFoldingRanges(tree, tracked.document) : [];

      // Region markers fold independently of structure (and survive invalid input).
      return structural.concat(regionFoldingRanges(tracked.document));
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
      /*
       * CST-grounded for the SYNTACTIC paths: the declared-symbol inventory
       * behind "did you mean" reads the tolerant CST (no AST reparse), and the
       * undefined identifier is recovered from the diagnostic message. The
       * create-variable / create-mixin fixes are pure text edits. All of this
       * survives an otherwise-invalid document.
       */
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

      /*
       * Rewrite just the identifier inside a diagnostic range, keeping the sigil /
       * combinator, and yield a "Change to X" quick fix per close-by candidate.
       */
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
          /*
           * The undefined name is carried by the diagnostic message (produced by
           * getDiagnostics), so no AST node lookup is needed.
           */
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
      const tracked = get(uri);
      const doc = tracked.document;
      if (!tracked.cstDoc?.tree) {
        return [];
      }
      let formatted = formatStyleSource(doc.getText());
      if (!formatted.endsWith('\n')) {
        formatted += '\n';
      }
      if (formatted === doc.getText() || formatted === doc.getText() + '\n') {
        return [];
      }
      return [TextEdit.replace({
        start: Position.create(0, 0),
        end: doc.positionAt(doc.getText().length)
      }, formatted)];
    },

    formatRange(uri, range) {
      const tracked = get(uri);
      const tree = tracked.cstDoc?.tree;
      if (!tree) {
        return [];
      }
      const doc = tracked.document;
      const start = doc.offsetAt(range.start);
      const end = doc.offsetAt(range.end);
      const topLevelRules = buildCstIndex(tree).nodes.filter(({ node, start: nodeStart, end: nodeEnd }) =>
        node.grammarType === 'Ruleset' && nodeStart < end && nodeEnd > start);
      if (topLevelRules.length === 0) {
        return [];
      }
      const from = Math.min(...topLevelRules.map(rule => rule.start));
      const to = Math.max(...topLevelRules.map(rule => rule.end));
      const formatted = topLevelRules
        .map(rule => formatStyleSource(doc.getText().slice(rule.start, rule.end)))
        .join('\n');
      if (doc.getText().slice(from, to) === formatted) {
        return [];
      }
      return [TextEdit.replace(toRange(doc, from, to), formatted)];
    },

    setDataProviders(data) {
      customData = Array.isArray(data) ? data : [];
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

      /*
       * 1) url(...) links (quoted or unquoted)
       * We keep this regex conservative to avoid false positives.
       */
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

      /*
       * 2) @import/@use links (tolerant extraction + real resolution).
       * Skip links for imports with interpolations (they're not static file links)
       */
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

        /*
         * Check if this import specifier contains interpolations
         * Look for @{...} pattern in the specifier text
         */
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
      const tracked = get(uri);
      const tree = tracked.cstDoc?.tree;
      return { data: tree ? cstSemanticTokens(tree, tracked.document, tracked.lang) : [] };
    },

    getDocumentColors(uri) {
      const tracked = get(uri);
      const tree = tracked.cstDoc?.tree;
      if (!tree) {
        return [];
      }
      return colorUtils.findColorsInCst(tree, tracked.document).map(({ start, end, color }) => ({
        color: colorUtils.colorToLSP(color),
        range: { start: tracked.document.positionAt(start), end: tracked.document.positionAt(end) }
      }));
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
