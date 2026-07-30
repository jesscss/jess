import { parseCssDiagnosticCst, parseCssDiagnosticDoc, type CssCstChild, type CssCstNode, type CssCstParseResult, type ParseDoc } from '@jesscss/css-parser';
import { parseJessDiagnosticCst, parseJessDiagnosticDoc } from '@jesscss/jess-parser/cst';
import { parseLessDiagnosticCst, parseLessDiagnosticDoc } from '@jesscss/less-parser/cst';
import { parseScssDiagnosticCst, parseScssDiagnosticDoc } from '@jesscss/scss-parser/cst';
import { defaultCssDiagnosticMetadata } from './metadata.js';
import type {
  CollectDiagnosticsInput,
  CollectDiagnosticsResult,
  CssDiagnosticMetadata,
  DiagnosticSeverityName,
  JessLanguage,
  SourceDiagnostic
} from './types.js';

export const LINT_CODES = {
  emptyRules: 'lint/empty-rules',
  unknownProperties: 'lint/unknown-property',
  unknownAtRules: 'lint/unknown-at-rule',
  duplicateProperties: 'lint/duplicate-property',
  hexColorLength: 'lint/hex-color-length',
  zeroUnits: 'lint/zero-units',
  customPropertyMissingVarFunction: 'lint/custom-property-no-missing-var-function',
  keyframeDuplicateSelectors: 'lint/keyframe-block-no-duplicate-selectors',
  keyframeDeclarationNoImportant: 'lint/keyframe-declaration-no-important',
  fontFamilyDuplicateNames: 'lint/font-family-no-duplicate-names',
  fontFamilyMissingGeneric: 'lint/font-family-no-missing-generic-family-keyword',
  duplicateAtImportRules: 'lint/no-duplicate-at-import-rules',
  unsupportedSassForm: 'unsupported/sass-form'
} as const;

const LENGTH_UNITS = new Set([
  'px', 'em', 'rem', 'ex', 'ch', 'cap', 'ic', 'lh', 'rlh',
  'vw', 'vh', 'vi', 'vb', 'vmin', 'vmax',
  'cm', 'mm', 'q', 'in', 'pt', 'pc'
]);

const DIALECT_AT_RULES: Record<JessLanguage, Set<string>> = {
  css: new Set(),
  less: new Set(['plugin']),
  scss: new Set([
    'mixin', 'include', 'function', 'return', 'if', 'else', 'each', 'for',
    'while', 'use', 'forward', 'content', 'extend', 'at-root', 'debug',
    'warn', 'error'
  ]),
  jess: new Set([
    'mixin', 'include', 'function', 'return', 'if', 'else', 'each', 'for',
    'while', 'use', 'forward', 'from', 'compose', 'content', 'extend',
    'at-root', 'debug', 'warn', 'error'
  ])
};

const RULESET_TYPES = new Set([
  'Ruleset',
  'NestedRuleset',
  'RulesetWithExtends',
  'NestedRulesetWithExtends',
  'DirectScssRule',
  'DirectJessRule'
]);
const ATRULE_TYPES = new Set([
  'AtRuleBlock',
  'AtRuleStatement',
  'UnknownAtRuleBlock',
  'QueryAtRuleBlock',
  'OpaqueAtRuleBlock'
]);
const DECLARATION_TYPES = new Set(['Declaration', 'DirectScssDeclaration', 'DirectJessDeclaration']);
const CUSTOM_DECLARATION_TYPES = new Set(['CustomDeclaration']);
const DIMENSION_TYPES = new Set(['Dimension', 'DirectScssDimension', 'DirectJessDimension']);
const CUSTOM_PROPERTY_VALUE_TYPES = new Set(['CustomPropertyValue']);
const KEYFRAMES_TYPES = new Set(['Keyframes']);
const KEYFRAME_BLOCK_TYPES = new Set(['KeyframeBlock']);
const IMPORTANT_TYPES = new Set(['Important', 'ImportantValue']);
const IMPORT_RULE_TYPES = new Set(['ImportStatement', 'ImportAtRule', 'StaticImportRule']);
const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong'
]);
const FONT_SIZE_KEYWORDS = new Set([
  'xx-small',
  'x-small',
  'small',
  'medium',
  'large',
  'x-large',
  'xx-large',
  'xxx-large',
  'larger',
  'smaller'
]);
const SYSTEM_FONT_KEYWORDS = new Set([
  'caption',
  'icon',
  'menu',
  'message-box',
  'small-caption',
  'status-bar'
]);
const FORWARD_AS_PREFIX = /\bas\s+\S+-\*/;
const FORWARD_VISIBILITY = /\b(show|hide)\b/;

type DiagnosticSpan = {
  readonly start: number;
  readonly end: number;
  readonly startLine?: number;
  readonly startColumn?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
};

type ParseDiagnosticSource = {
  readonly errors: readonly { readonly span: DiagnosticSpan }[];
  readonly unconsumedFrom: number | null;
  readonly tree: CssCstNode | null;
};

type VisitContext = {
  readonly inVarCall: boolean;
  readonly inCustomDeclaration: boolean;
  readonly inFontFaceAtRule: boolean;
  readonly inKeyframeBlock: boolean;
};

type FontFamilyPart = {
  readonly raw: string;
  readonly normalized: string;
  readonly isGeneric: boolean;
  readonly start: number;
  readonly end: number;
};

type ImportKey = {
  readonly key: string;
  readonly target: string;
};

const ROOT_VISIT_CONTEXT: VisitContext = {
  inVarCall: false,
  inCustomDeclaration: false,
  inFontFaceAtRule: false,
  inKeyframeBlock: false
};

function isCstNode(c: CssCstChild): c is CssCstNode {
  return c._tag === 'node';
}

function cstChildrenOf(node: CssCstNode): readonly CssCstChild[] {
  return node.rules;
}

function forwardPreludeOf(node: CssCstNode, src: string): string | null {
  let afterPath = false;
  for (const child of cstChildrenOf(node)) {
    if (isCstNode(child)) {
      if (child.grammarType === 'Quoted' || child.grammarType === 'StaticQuoted') {
        afterPath = true;
      }
      if (afterPath && child.grammarType === 'ForwardTail') {
        const text = src.slice(Number(child.span.start), Number(child.span.end));
        const normalized = text
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/\/\/[^\n\r]*/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return normalized === '' ? null : normalized;
      }
      continue;
    }
    if (!afterPath) {
      continue;
    }
    const text = src.slice(Number(child.span.start), Number(child.span.end));
    const normalized = text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n\r]*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (normalized === ';' || normalized.toLowerCase() === 'with') {
      continue;
    }
    return normalized;
  }
  return null;
}

function propNameOf(slice: string): string {
  const colon = slice.indexOf(':');
  const head = colon >= 0 ? slice.slice(0, colon) : slice;
  return head.trim();
}

function absoluteStart(node: CssCstNode): number {
  return Number(node.span.start);
}

function absoluteEnd(node: CssCstNode): number {
  return Number(node.span.end);
}

function isWhitespaceOnly(source: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const code = source.charCodeAt(i);
    if (code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 32) {
      return false;
    }
  }
  return true;
}

function atRuleNameEnd(source: string, start: number, end: number): number {
  let i = start + 1;
  while (i < end) {
    const code = source.charCodeAt(i);
    const isNameChar = (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57)
      || code === 45
      || code === 95;
    if (!isNameChar) {
      break;
    }
    i++;
  }
  return i;
}

function blankStrings(value: string): string {
  return value.replace(/"[^"]*"|'[^']*'/g, m => ' '.repeat(m.length));
}

function blankStringsAndComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n\r]*|"[^"]*"|'[^']*'/g, m => ' '.repeat(m.length));
}

function stripComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/g, ' ');
}

function stripBlockComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function normalizedCssWords(value: string): string {
  return stripComments(value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizedKeyframeSelectorKeys(source: string, node: CssCstNode): string[] {
  const raw = source.slice(absoluteStart(node), absoluteEnd(node));
  return blankStringsAndComments(raw)
    .split(',')
    .map(part => part.replace(/\s+/g, '').toLowerCase())
    .filter(Boolean)
    .map(part => part === 'from'
      ? '0%'
      : part === 'to'
        ? '100%'
        : part);
}

function firstChildNodeOf(node: CssCstNode, grammarType: string): CssCstNode | undefined {
  for (const child of cstChildrenOf(node)) {
    if (isCstNode(child) && child.grammarType === grammarType) {
      return child;
    }
  }
  return undefined;
}

function trimOffsets(value: string, absoluteOffset: number): { start: number; end: number } {
  let start = 0;
  let end = value.length;
  while (start < end) {
    const code = value.charCodeAt(start);
    if (code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 32) {
      break;
    }
    start++;
  }
  while (end > start) {
    const code = value.charCodeAt(end - 1);
    if (code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 32) {
      break;
    }
    end--;
  }
  return { start: absoluteOffset + start, end: absoluteOffset + end };
}

function unquoteFontFamily(raw: string): { value: string; quoted: boolean } {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed.charCodeAt(0);
    if ((first === 34 || first === 39) && trimmed.charCodeAt(trimmed.length - 1) === first) {
      return {
        value: trimmed.slice(1, -1).replace(/\\(["'])/g, '$1'),
        quoted: true
      };
    }
  }
  return { value: trimmed, quoted: false };
}

function unquoteImportTarget(raw: string): string {
  const trimmed = stripBlockComments(raw).trim();
  if (trimmed.length >= 2) {
    const first = trimmed.charCodeAt(0);
    if ((first === 34 || first === 39) && trimmed.charCodeAt(trimmed.length - 1) === first) {
      return trimmed.slice(1, -1).replace(/\\(["'])/g, '$1');
    }
  }
  return trimmed;
}

function skipWhitespace(source: string, start: number, end: number): number {
  let i = start;
  while (i < end) {
    const code = source.charCodeAt(i);
    if (code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 32) {
      break;
    }
    i++;
  }
  return i;
}

function balancedEnd(source: string, start: number, end: number): number {
  let quote = 0;
  let depth = 0;
  let inBlockComment = false;
  for (let i = start; i < end; i++) {
    const code = source.charCodeAt(i);
    const next = i + 1 < end ? source.charCodeAt(i + 1) : 0;
    if (inBlockComment) {
      if (code === 42 && next === 47) {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (quote !== 0) {
      if (code === 92) {
        i++;
        continue;
      }
      if (code === quote) {
        quote = 0;
      }
      continue;
    }
    if (code === 47 && next === 42) {
      inBlockComment = true;
      i++;
      continue;
    }
    if (code === 34 || code === 39) {
      quote = code;
      continue;
    }
    if (code === 40) {
      depth++;
      continue;
    }
    if (code === 41) {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return end;
}

function quotedEnd(source: string, start: number, end: number): number {
  const quote = source.charCodeAt(start);
  for (let i = start + 1; i < end; i++) {
    const code = source.charCodeAt(i);
    if (code === 92) {
      i++;
      continue;
    }
    if (code === quote) {
      return i + 1;
    }
  }
  return end;
}

function importTargetStart(source: string, start: number, end: number): number {
  let i = skipWhitespace(source, start, end);
  while (i < end && source.charCodeAt(i) === 40) {
    const optionsEnd = balancedEnd(source, i, end);
    if (optionsEnd <= i || optionsEnd >= end) {
      return i;
    }
    i = skipWhitespace(source, optionsEnd, end);
  }
  return i;
}

function normalizedImportKey(source: string, node: CssCstNode): ImportKey | null {
  const start = absoluteStart(node);
  let end = absoluteEnd(node);
  if (source.charCodeAt(end - 1) === 59 /* ; */) {
    end--;
  }
  const nameEnd = atRuleNameEnd(source, start, end);
  const targetStart = importTargetStart(source, nameEnd, end);
  if (targetStart >= end) {
    return null;
  }

  let targetEnd: number;
  const targetFirst = source.charCodeAt(targetStart);
  const lowerTargetHead = source.slice(targetStart, Math.min(targetStart + 4, end)).toLowerCase();
  if (targetFirst === 34 || targetFirst === 39) {
    targetEnd = quotedEnd(source, targetStart, end);
  } else if (lowerTargetHead === 'url(') {
    targetEnd = balancedEnd(source, targetStart + 3, end);
  } else {
    return null;
  }

  const rawPrefix = source.slice(nameEnd, targetStart);
  const rawTarget = source.slice(targetStart, targetEnd);
  const rawTail = source.slice(targetEnd, end);
  if (
    rawPrefix.includes('@{') || rawPrefix.includes('#{') || rawPrefix.includes('${')
    || rawTarget.includes('@{') || rawTarget.includes('#{') || rawTarget.includes('${')
    || rawTail.includes('@{') || rawTail.includes('#{') || rawTail.includes('${')
  ) {
    return null;
  }

  let target = rawTarget;
  if (lowerTargetHead === 'url(') {
    target = rawTarget.slice(4, -1);
  }
  const normalizedTarget = unquoteImportTarget(target);
  if (normalizedTarget === '') {
    return null;
  }

  return {
    key: `${normalizedCssWords(rawPrefix)}|${normalizedTarget}|${normalizedCssWords(rawTail)}`,
    target: normalizedTarget
  };
}

function splitFontFamilyValue(source: string, valueStart: number, valueEnd: number): FontFamilyPart[] {
  const parts: FontFamilyPart[] = [];
  let partStart = valueStart;
  let quote = 0;
  let parenDepth = 0;
  let inBlockComment = false;

  const pushPart = (absoluteEnd: number) => {
    const raw = source.slice(partStart, absoluteEnd);
    const trimmed = trimOffsets(raw, partStart);
    const trimmedRaw = source.slice(trimmed.start, trimmed.end);
    if (trimmedRaw !== '') {
      const unquoted = unquoteFontFamily(trimmedRaw);
      const normalized = unquoted.value.replace(/\s+/g, ' ').toLowerCase();
      parts.push({
        raw: unquoted.value,
        normalized,
        isGeneric: !unquoted.quoted && GENERIC_FONT_FAMILIES.has(normalized),
        start: trimmed.start,
        end: trimmed.end
      });
    }
    partStart = absoluteEnd + 1;
  };

  for (let i = valueStart; i < valueEnd; i++) {
    const code = source.charCodeAt(i);
    const next = i + 1 < valueEnd ? source.charCodeAt(i + 1) : 0;
    if (inBlockComment) {
      if (code === 42 && next === 47) {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (quote !== 0) {
      if (code === 92) {
        i++;
        continue;
      }
      if (code === quote) {
        quote = 0;
      }
      continue;
    }
    if (code === 47 && next === 42) {
      inBlockComment = true;
      i++;
      continue;
    }
    if (code === 34 || code === 39) {
      quote = code;
      continue;
    }
    if (code === 40) {
      parenDepth++;
      continue;
    }
    if (code === 41 && parenDepth > 0) {
      parenDepth--;
      continue;
    }
    if (code === 44 && parenDepth === 0) {
      pushPart(i);
    }
  }
  pushPart(valueEnd);
  return parts;
}

function isFontSizeToken(value: string): boolean {
  const beforeLineHeight = value.split('/')[0]!.toLowerCase();
  return FONT_SIZE_KEYWORDS.has(beforeLineHeight)
    || /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[a-z%]+)$/i.test(beforeLineHeight);
}

function nextNonWhitespace(source: string, start: number, end: number): number {
  let i = start;
  while (i < end) {
    const code = source.charCodeAt(i);
    if (code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 32) {
      break;
    }
    i++;
  }
  return i;
}

function fontShorthandFamilyStart(source: string, valueStart: number, valueEnd: number): number | null {
  const raw = source.slice(valueStart, valueEnd).trim();
  const lower = raw.toLowerCase();
  if (CSS_WIDE_KEYWORDS.has(lower) || SYSTEM_FONT_KEYWORDS.has(lower) || containsDynamicFontValue(raw)) {
    return null;
  }

  let tokenStart = -1;
  let quote = 0;
  let parenDepth = 0;
  let inBlockComment = false;
  const finishToken = (tokenEnd: number): number | null => {
    if (tokenStart < 0) {
      return null;
    }
    const token = source.slice(tokenStart, tokenEnd);
    if (!isFontSizeToken(token)) {
      tokenStart = -1;
      return null;
    }
    let familyStart = nextNonWhitespace(source, tokenEnd, valueEnd);
    if (familyStart < valueEnd && source.charCodeAt(familyStart) === 47) {
      familyStart = nextNonWhitespace(source, familyStart + 1, valueEnd);
      while (familyStart < valueEnd) {
        const code = source.charCodeAt(familyStart);
        if (code === 9 || code === 10 || code === 12 || code === 13 || code === 32) {
          break;
        }
        familyStart++;
      }
      familyStart = nextNonWhitespace(source, familyStart, valueEnd);
    }
    return familyStart < valueEnd ? familyStart : null;
  };

  for (let i = valueStart; i < valueEnd; i++) {
    const code = source.charCodeAt(i);
    const next = i + 1 < valueEnd ? source.charCodeAt(i + 1) : 0;
    if (inBlockComment) {
      if (code === 42 && next === 47) {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (quote !== 0) {
      if (code === 92) {
        i++;
        continue;
      }
      if (code === quote) {
        quote = 0;
      }
      continue;
    }
    if (code === 47 && next === 42) {
      inBlockComment = true;
      i++;
      continue;
    }
    if (code === 34 || code === 39) {
      quote = code;
      continue;
    }
    if (code === 40) {
      parenDepth++;
      continue;
    }
    if (code === 41 && parenDepth > 0) {
      parenDepth--;
      continue;
    }
    if ((code === 9 || code === 10 || code === 12 || code === 13 || code === 32) && parenDepth === 0) {
      const familyStart = finishToken(i);
      if (familyStart !== null) {
        return familyStart;
      }
      continue;
    }
    if (tokenStart < 0) {
      tokenStart = i;
    }
  }
  return finishToken(valueEnd);
}

function containsDynamicFontValue(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.includes('var(')
    || value.includes('@{')
    || value.includes('#{')
    || value.includes('${')
    || value.includes('$');
}

function isDeclarationValueContext(source: string, offset: number): boolean {
  const lastBlockOpen = source.lastIndexOf('{', offset);
  const lastBlockClose = source.lastIndexOf('}', offset);
  if (lastBlockOpen < 0 || lastBlockClose > lastBlockOpen) {
    return false;
  }

  const lastStatement = Math.max(lastBlockOpen, source.lastIndexOf(';', offset));
  const lastColon = source.lastIndexOf(':', offset);
  return lastColon > lastStatement;
}

function diagnostic(
  code: string,
  defaultSeverity: DiagnosticSeverityName,
  message: string,
  span: DiagnosticSpan,
  filePath?: string
): SourceDiagnostic {
  const start = Number(span.start);
  const end = Number(span.end);
  return {
    code,
    phase: code.startsWith('parse/') ? 'parse' : 'lint',
    source: 'jess',
    message,
    reason: '',
    fix: '',
    defaultSeverity,
    filePath,
    start,
    end: Math.max(start, end),
    line: span.startLine,
    column: span.startColumn,
    endLine: span.endLine,
    endColumn: span.endColumn
  };
}

function spanFromOffsets(start: number, end: number): DiagnosticSpan {
  return { start, end: Math.max(start, end) };
}

function spanAtOrContaining(node: CssCstNode, start: number, end: number): DiagnosticSpan {
  let enclosing: DiagnosticSpan | undefined;
  const visit = (child: CssCstChild) => {
    const childStart = Number(child.span.start);
    const childEnd = Number(child.span.end);
    if (childStart > start || childEnd < end) {
      return;
    }
    if (childStart === start && childEnd === end) {
      enclosing = child.span;
      return;
    }
    if (enclosing === undefined || childEnd - childStart < enclosing.end - enclosing.start) {
      enclosing = child.span;
    }
    if (child._tag === 'node') {
      for (const nested of child.rules) {
        visit(nested);
      }
    }
  };
  visit(node);
  return enclosing ?? spanFromOffsets(start, end);
}

function metadataWithDefaults(metadata?: Partial<CssDiagnosticMetadata>): CssDiagnosticMetadata {
  return {
    isKnownProperty(name) {
      return metadata?.isKnownProperty?.(name) ?? defaultCssDiagnosticMetadata.isKnownProperty(name);
    },
    isKnownAtRule(name) {
      return metadata?.isKnownAtRule?.(name) ?? defaultCssDiagnosticMetadata.isKnownAtRule(name);
    }
  };
}

export function parseDocForLanguage(source: string, language: JessLanguage): ParseDoc<CssCstNode> {
  if (language === 'less') {
    return parseLessDiagnosticDoc(source);
  }
  if (language === 'scss') {
    return parseScssDiagnosticDoc(source);
  }
  if (language === 'jess') {
    return parseJessDiagnosticDoc(source);
  }
  return parseCssDiagnosticDoc(source);
}

function parseResultForLanguage(source: string, language: JessLanguage): CssCstParseResult {
  if (language === 'less') {
    return parseLessDiagnosticCst(source);
  }
  if (language === 'scss') {
    return parseScssDiagnosticCst(source);
  }
  if (language === 'jess') {
    return parseJessDiagnosticCst(source);
  }
  return parseCssDiagnosticCst(source);
}

export function parseDiagnosticsForDoc(doc: ParseDiagnosticSource, filePath?: string): SourceDiagnostic[] {
  const diagnostics: SourceDiagnostic[] = [];
  const emitted = new Set<string>();
  const push = (span: DiagnosticSpan, message: string) => {
    const key = `parse/syntax-error:${span.start}`;
    if (emitted.has(key)) {
      return;
    }
    emitted.add(key);
    diagnostics.push(diagnostic(
      'parse/syntax-error',
      'error',
      message,
      span,
      filePath
    ));
  };
  for (const error of doc.errors) {
    push(error.span, 'Unexpected syntax');
  }
  if (doc.unconsumedFrom !== null) {
    const rootSpan = doc.tree?.span;
    const unconsumedSpan = rootSpan !== undefined && Number(rootSpan.end) === doc.unconsumedFrom
      ? {
          ...rootSpan,
          start: doc.unconsumedFrom,
          end: doc.unconsumedFrom + 1,
          startLine: rootSpan.endLine,
          startColumn: rootSpan.endColumn
        }
      : spanFromOffsets(doc.unconsumedFrom, doc.unconsumedFrom + 1);
    push(unconsumedSpan, 'Unexpected input');
  }
  return diagnostics;
}

export function cstLintDiagnostics(
  root: CssCstNode,
  source: string,
  language: JessLanguage,
  metadata?: Partial<CssDiagnosticMetadata>,
  filePath?: string,
  tolerantSourceScan = true
): SourceDiagnostic[] {
  const out: SourceDiagnostic[] = [];
  const emitted = new Set<string>();
  const seenImports = new Map<string, ImportKey>();
  const cssData = metadataWithDefaults(metadata);
  const dialectAtRules = DIALECT_AT_RULES[language];
  const push = (
    code: string,
    severity: DiagnosticSeverityName,
    message: string,
    span: DiagnosticSpan
  ) => {
    const start = Number(span.start);
    const end = Number(span.end);
    const key = `${code}:${start}:${Math.max(start, end)}`;
    if (emitted.has(key)) {
      return;
    }
    emitted.add(key);
    out.push(diagnostic(code, severity, message, span, filePath));
  };

  const visit = (node: CssCstNode, context: VisitContext = ROOT_VISIT_CONTEXT) => {
    const start = absoluteStart(node);
    const end = absoluteEnd(node);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return;
    }
    const gt = node.grammarType;
    const isFontFaceAtRule = (gt === 'DescriptorBlock' || ATRULE_TYPES.has(gt))
      && source.charCodeAt(start) === 64
      && source.slice(start + 1, atRuleNameEnd(source, start, end)).toLowerCase() === 'font-face';
    const nodeContext: VisitContext = {
      inVarCall: context.inVarCall || gt === 'VarCall',
      inCustomDeclaration: context.inCustomDeclaration || CUSTOM_DECLARATION_TYPES.has(gt),
      inFontFaceAtRule: context.inFontFaceAtRule || isFontFaceAtRule,
      inKeyframeBlock: context.inKeyframeBlock || KEYFRAME_BLOCK_TYPES.has(gt)
    };

    if (RULESET_TYPES.has(gt)) {
      const open = source.indexOf('{', start);
      const close = source.lastIndexOf('}', end - 1);
      if (open >= start && close > open && isWhitespaceOnly(source, open + 1, close)) {
        push(LINT_CODES.emptyRules, 'warning', 'Do not use empty rulesets', node.span);
      }
    }

    if (gt === 'AtRootFilter') {
      push(
        LINT_CODES.unsupportedSassForm, 'warning',
        '@at-root prelude/filter forms are not yet supported in Jess. Write the hoisted rules directly instead.',
        node.span
      );
    }
    if (gt === 'ForwardRule') {
      const prelude = forwardPreludeOf(node, source);
      if (prelude !== null) {
        if (FORWARD_AS_PREFIX.test(prelude)) {
          push(
            LINT_CODES.unsupportedSassForm, 'warning',
            '@forward with "as <prefix>-*" prefixing is not supported in Jess and will never be. Use explicit namespacing instead.',
            node.span
          );
        }
        if (FORWARD_VISIBILITY.test(prelude)) {
          push(
            LINT_CODES.unsupportedSassForm, 'warning',
            '@forward with "show"/"hide" lists is not supported in Jess and will never be. Visibility control belongs to the module itself.',
            node.span
          );
        }
      }
    }

    if (ATRULE_TYPES.has(gt)) {
      if (source.charCodeAt(start) === 64 /* @ */) {
        const nameEnd = atRuleNameEnd(source, start, end);
        if (nameEnd > start + 1) {
          const rawName = source.slice(start + 1, nameEnd);
          const name = rawName.toLowerCase();
          if (!cssData.isKnownAtRule(name) && !dialectAtRules.has(name)) {
            push(LINT_CODES.unknownAtRules, 'warning', `Unknown at-rule @${rawName}`, spanAtOrContaining(node, start, nameEnd));
          }
        }
      }
    }

    if (IMPORT_RULE_TYPES.has(gt)) {
      const importKey = normalizedImportKey(source, node);
      if (importKey !== null) {
        const previous = seenImports.get(importKey.key);
        if (previous !== undefined) {
          push(
            LINT_CODES.duplicateAtImportRules,
            'warning',
            `Duplicate @import rule ${importKey.target}`,
            node.span
          );
        } else {
          seenImports.set(importKey.key, importKey);
        }
      }
    }

    if (CUSTOM_PROPERTY_VALUE_TYPES.has(gt) && !nodeContext.inVarCall && !nodeContext.inCustomDeclaration) {
      const name = source.slice(start, end).trim();
      push(
        LINT_CODES.customPropertyMissingVarFunction,
        'warning',
        `Use var(${name}) when reading a custom property`,
        node.span
      );
    }

    if (nodeContext.inKeyframeBlock && IMPORTANT_TYPES.has(gt)) {
      push(
        LINT_CODES.keyframeDeclarationNoImportant,
        'warning',
        'Do not use !important inside keyframes',
        node.span
      );
    }

    if (DIMENSION_TYPES.has(gt)) {
      const slice = source.slice(start, end).trim();
      const m = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]+)$/i.exec(slice);
      if (m && Number(m[1]) === 0 && LENGTH_UNITS.has(m[2]!.toLowerCase())) {
        push(LINT_CODES.zeroUnits, 'hint', `The unit "${m[2]}" is unnecessary for a zero value`, node.span);
      }
    }

    if (DECLARATION_TYPES.has(gt)) {
      const slice = source.slice(start, end);
      const colon = slice.indexOf(':');
      const name = propNameOf(slice);

      if (name.length > 0) {
        const lower = name.toLowerCase();
        const skip = lower.startsWith('--')
          || lower.startsWith('-')
          || lower.startsWith('$')
          || lower.startsWith('@')
          || lower.includes('#{')
          || lower.includes('@{')
          || lower.includes('${');
        if (!skip && !cssData.isKnownProperty(lower)) {
          const nameStart = start + slice.indexOf(name);
          push(LINT_CODES.unknownProperties, 'warning', `Unknown property: '${name}'`, spanAtOrContaining(node, nameStart, nameStart + name.length));
        }
      }

      if (colon >= 0) {
        const valueStart = colon + 1;
        const value = blankStrings(slice.slice(valueStart));
        const hexRe = /#([0-9a-fA-F]+)/g;
        let hm: RegExpExecArray | null;
        while ((hm = hexRe.exec(value)) !== null) {
          const digits = hm[1]!.length;
          if (digits !== 3 && digits !== 4 && digits !== 6 && digits !== 8) {
            const hexStart = start + valueStart + hm.index;
            push(LINT_CODES.hexColorLength, 'error', `Hex color '${hm[0]}' does not have 3, 4, 6 or 8 digits`, spanAtOrContaining(node, hexStart, hexStart + hm[0].length));
          }
        }

        const lowerName = name.toLowerCase();
        const important = firstChildNodeOf(node, 'Important');
        const absoluteValueStart = start + valueStart;
        const absoluteValueEnd = important ? absoluteStart(important) : end;
        const fontFamilyStart = lowerName === 'font-family'
          ? absoluteValueStart
          : lowerName === 'font'
            ? fontShorthandFamilyStart(source, absoluteValueStart, absoluteValueEnd)
            : null;

        if (fontFamilyStart !== null && !nodeContext.inFontFaceAtRule) {
          const rawValue = source.slice(fontFamilyStart, absoluteValueEnd);
          const fontFamilies = splitFontFamilyValue(source, fontFamilyStart, absoluteValueEnd);
          const seenFontFamilies = new Map<string, FontFamilyPart>();
          for (const family of fontFamilies) {
            const previous = seenFontFamilies.get(family.normalized);
            if (previous !== undefined) {
              push(
                LINT_CODES.fontFamilyDuplicateNames,
                'warning',
                `Duplicate font family '${family.raw}'`,
                spanAtOrContaining(node, family.start, family.end)
              );
              continue;
            }
            seenFontFamilies.set(family.normalized, family);
          }
          const isCssWideOnly = fontFamilies.length === 1 && CSS_WIDE_KEYWORDS.has(fontFamilies[0]!.normalized);
          if (
            fontFamilies.length > 0
            && !isCssWideOnly
            && !containsDynamicFontValue(rawValue)
            && !fontFamilies.some(family => family.isGeneric)
          ) {
            push(
              LINT_CODES.fontFamilyMissingGeneric,
              'warning',
              'Add a generic font family keyword',
              node.span
            );
          }
        }
      }
    }

    if (KEYFRAMES_TYPES.has(gt)) {
      const seenSelectors = new Set<string>();
      for (const child of cstChildrenOf(node)) {
        if (!isCstNode(child) || !KEYFRAME_BLOCK_TYPES.has(child.grammarType)) {
          continue;
        }
        const selector = firstChildNodeOf(child, 'keyframeSelector');
        if (!selector) {
          continue;
        }
        for (const key of normalizedKeyframeSelectorKeys(source, selector)) {
          if (seenSelectors.has(key)) {
            push(
              LINT_CODES.keyframeDuplicateSelectors,
              'warning',
              `Duplicate keyframe selector '${source.slice(absoluteStart(selector), absoluteEnd(selector)).trim()}'`,
              selector.span
            );
            break;
          }
          seenSelectors.add(key);
        }
      }
    }

    let seenProps: Map<string, boolean> | undefined;
    for (const child of cstChildrenOf(node)) {
      if (!isCstNode(child)) {
        continue;
      }
      if (DECLARATION_TYPES.has(child.grammarType)) {
        const childStart = absoluteStart(child);
        const childEnd = absoluteEnd(child);
        const name = propNameOf(source.slice(childStart, childEnd));
        if (name.length > 0 && !name.includes('#{') && !name.includes('@{') && !name.includes('${')) {
          const key = name.toLowerCase();
          seenProps ??= new Map();
          if (seenProps.has(key)) {
            push(LINT_CODES.duplicateProperties, 'warning', `Duplicate property '${name}'`, child.span);
          } else {
            seenProps.set(key, true);
          }
        }
      }
      visit(child, nodeContext);
    }
  };

  visit(root);

  if (tolerantSourceScan) {
    const sourceForHexScan = blankStringsAndComments(source);
    const sourceHexRe = /#([0-9a-fA-F]+)/g;
    let match: RegExpExecArray | null;
    while ((match = sourceHexRe.exec(sourceForHexScan)) !== null) {
      const digits = match[1]!.length;
      if (digits !== 3 && digits !== 4 && digits !== 6 && digits !== 8 && isDeclarationValueContext(sourceForHexScan, match.index)) {
        push(
          LINT_CODES.hexColorLength,
          'error',
          `Hex color '${match[0]}' does not have 3, 4, 6 or 8 digits`,
          spanFromOffsets(match.index, match.index + match[0].length)
        );
      }
    }
  }

  return out;
}

export function collectTolerantDiagnostics(input: CollectDiagnosticsInput): CollectDiagnosticsResult {
  const result = parseResultForLanguage(input.source, input.language);
  const needsTolerantSourceScan = result.errors.length > 0 || result.unconsumedFrom !== null || !result.ok;
  const lintDiagnostics = result.tree
    ? cstLintDiagnostics(
        result.tree,
        input.source,
        input.language,
        input.metadata,
        input.filePath,
        needsTolerantSourceScan
      )
    : [];
  return {
    diagnostics: [
      ...parseDiagnosticsForDoc(result, input.filePath),
      ...lintDiagnostics
    ]
  };
}
