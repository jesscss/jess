import { parse as parseCssAst, parseCssDoc, type CssCstChild, type CssCstNode, type ParseDoc } from '@jesscss/css-parser';
import { parseJessDoc } from '@jesscss/jess-parser/cst';
import { parseLessDoc } from '@jesscss/less-parser/cst';
import { parseScssDoc } from '@jesscss/scss-parser/cst';
import { bodySpanOf, sourceSpanOf, walkAuthoredValue, type AstSourceSpan, type ValueSlot } from '@jesscss/core/ast';
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

const RULESET_TYPES = new Set(['Ruleset', 'DirectScssRule', 'DirectJessRule']);
const ATRULE_TYPES = new Set([
  'AtRuleBlock',
  'AtRuleStatement',
  'UnknownAtRuleBlock',
  'QueryAtRuleBlock',
  'OpaqueAtRuleBlock'
]);
const DECLARATION_TYPES = new Set(['Declaration', 'DirectScssDeclaration', 'DirectJessDeclaration']);
const DIMENSION_TYPES = new Set(['Dimension', 'DirectScssDimension', 'DirectJessDimension']);
const FORWARD_AS_PREFIX = /\bas\s+\S+-\*/;
const FORWARD_VISIBILITY = /\b(show|hide)\b/;

type AstRecord = {
  readonly type?: unknown;
  readonly children?: unknown;
  readonly body?: unknown;
  readonly rules?: unknown;
  readonly name?: unknown;
  readonly value?: unknown;
  readonly number?: unknown;
  readonly unit?: unknown;
  readonly src?: unknown;
};

function isCstNode(c: CssCstChild): c is CssCstNode {
  return c._tag === 'node';
}

function cstChildrenOf(node: CssCstNode): readonly CssCstChild[] {
  return node.rules;
}

function isAstRecord(value: unknown): value is AstRecord & object {
  return typeof value === 'object' && value !== null;
}

function isValueSlot(value: unknown): value is ValueSlot {
  return Array.isArray(value) || (isAstRecord(value) && typeof value.type === 'string');
}

function astChildrenOf(value: unknown, key: 'children' | 'body' | 'rules'): readonly unknown[] {
  if (!isAstRecord(value)) {
    return [];
  }
  const child = value[key];
  return Array.isArray(child) ? child : [];
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

function lineCommentStartBetween(source: string, start: number, end: number): number {
  for (let i = start; i < end - 1; i++) {
    if (source.charCodeAt(i) === 47 /* / */ && source.charCodeAt(i + 1) === 47 /* / */) {
      return i;
    }
  }
  return -1;
}

function declarationEnd(source: string, start: number, blockEnd: number): number {
  const semi = source.indexOf(';', start);
  if (semi < 0 || semi > blockEnd) {
    return blockEnd;
  }
  return semi + 1;
}

function locateDeclaration(
  source: string,
  name: string,
  cursor: number,
  blockEnd: number
): { nameStart: number; declarationEnd: number; valueStart: number } | null {
  let search = cursor;
  while (search < blockEnd) {
    const nameStart = source.indexOf(name, search);
    if (nameStart < 0 || nameStart >= blockEnd) {
      return null;
    }
    const colon = source.indexOf(':', nameStart + name.length);
    if (colon < 0 || colon >= blockEnd) {
      return null;
    }
    const lineComment = lineCommentStartBetween(source, nameStart + name.length, colon);
    if (lineComment < 0) {
      return {
        nameStart,
        declarationEnd: declarationEnd(source, colon + 1, blockEnd),
        valueStart: colon + 1
      };
    }
    search = lineComment + 2;
  }
  return null;
}

function findValueSource(source: string, src: string, start: number, end: number): AstSourceSpan | undefined {
  if (src.length === 0) {
    return undefined;
  }
  const valueStart = source.indexOf(src, start);
  if (valueStart < 0 || valueStart >= end) {
    return undefined;
  }
  return { start: valueStart, end: valueStart + src.length };
}

function blankStrings(value: string): string {
  return value.replace(/"[^"]*"|'[^']*'/g, m => ' '.repeat(m.length));
}

function blankStringsAndComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n\r]*|"[^"]*"|'[^']*'/g, m => ' '.repeat(m.length));
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
  start: number,
  end: number,
  filePath?: string
): SourceDiagnostic {
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
    end: Math.max(start, end)
  };
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
    return parseLessDoc(source);
  }
  if (language === 'scss') {
    return parseScssDoc(source);
  }
  if (language === 'jess') {
    return parseJessDoc(source);
  }
  return parseCssDoc(source);
}

export function parseDiagnosticsForDoc(doc: ParseDoc<CssCstNode>, filePath?: string): SourceDiagnostic[] {
  const diagnostics: SourceDiagnostic[] = [];
  for (const error of doc.errors) {
    diagnostics.push(diagnostic(
      'parse/syntax-error',
      'error',
      'Unexpected syntax',
      Number(error.span.start),
      Number(error.span.end),
      filePath
    ));
  }
  if (doc.unconsumedFrom !== null) {
    diagnostics.push(diagnostic(
      'parse/syntax-error',
      'error',
      'Unexpected input',
      doc.unconsumedFrom,
      doc.unconsumedFrom + 1,
      filePath
    ));
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
  const cssData = metadataWithDefaults(metadata);
  const dialectAtRules = DIALECT_AT_RULES[language];
  const push = (
    code: string,
    severity: DiagnosticSeverityName,
    message: string,
    start: number,
    end: number
  ) => {
    const key = `${code}:${start}:${Math.max(start, end)}`;
    if (emitted.has(key)) {
      return;
    }
    emitted.add(key);
    out.push(diagnostic(code, severity, message, start, end, filePath));
  };

  const visit = (node: CssCstNode) => {
    const start = absoluteStart(node);
    const end = absoluteEnd(node);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return;
    }
    const gt = node.grammarType;

    if (RULESET_TYPES.has(gt)) {
      const open = source.indexOf('{', start);
      const close = source.lastIndexOf('}', end - 1);
      if (open >= start && close > open && isWhitespaceOnly(source, open + 1, close)) {
        push(LINT_CODES.emptyRules, 'warning', 'Do not use empty rulesets', start, end);
      }
    }

    if (gt === 'AtRootFilter') {
      push(
        LINT_CODES.unsupportedSassForm, 'warning',
        '@at-root prelude/filter forms are not yet supported in Jess. Write the hoisted rules directly instead.',
        start, end
      );
    }
    if (gt === 'ForwardRule') {
      const prelude = forwardPreludeOf(node, source);
      if (prelude !== null) {
        if (FORWARD_AS_PREFIX.test(prelude)) {
          push(
            LINT_CODES.unsupportedSassForm, 'warning',
            '@forward with "as <prefix>-*" prefixing is not supported in Jess and will never be. Use explicit namespacing instead.',
            start, end
          );
        }
        if (FORWARD_VISIBILITY.test(prelude)) {
          push(
            LINT_CODES.unsupportedSassForm, 'warning',
            '@forward with "show"/"hide" lists is not supported in Jess and will never be. Visibility control belongs to the module itself.',
            start, end
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
            push(LINT_CODES.unknownAtRules, 'warning', `Unknown at-rule @${rawName}`, start, nameEnd);
          }
        }
      }
    }

    if (DIMENSION_TYPES.has(gt)) {
      const slice = source.slice(start, end).trim();
      const m = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]+)$/i.exec(slice);
      if (m && Number(m[1]) === 0 && LENGTH_UNITS.has(m[2]!.toLowerCase())) {
        push(LINT_CODES.zeroUnits, 'hint', `The unit "${m[2]}" is unnecessary for a zero value`, start, end);
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
          push(LINT_CODES.unknownProperties, 'warning', `Unknown property: '${name}'`, nameStart, nameStart + name.length);
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
            push(LINT_CODES.hexColorLength, 'error', `Hex color '${hm[0]}' does not have 3, 4, 6 or 8 digits`, hexStart, hexStart + hm[0].length);
          }
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
            push(LINT_CODES.duplicateProperties, 'warning', `Duplicate property '${name}'`, childStart, childEnd);
          } else {
            seenProps.set(key, true);
          }
        }
      }
      visit(child);
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
          match.index,
          match.index + match[0].length
        );
      }
    }
  }

  return out;
}

function visitValueDimensions(
  value: unknown,
  source: string,
  start: number,
  end: number,
  visit: (src: string, unit: string, span: AstSourceSpan | undefined) => void
): void {
  if (!isValueSlot(value)) {
    return;
  }
  walkAuthoredValue(value, {
    enterNode(node) {
      if (node.type === 'Dimension' && node.number === 0) {
        visit(node.src, node.unit, findValueSource(source, node.src, start, end));
      }
    }
  });
}

function cssAstLintDiagnostics(
  source: string,
  metadata?: Partial<CssDiagnosticMetadata>,
  filePath?: string
): SourceDiagnostic[] | null {
  let root: unknown;
  try {
    root = parseCssAst(source);
  } catch {
    return null;
  }

  const out: SourceDiagnostic[] = [];
  const cssData = metadataWithDefaults(metadata);
  const push = (
    code: string,
    severity: DiagnosticSeverityName,
    message: string,
    start: number,
    end: number
  ) => {
    out.push(diagnostic(code, severity, message, start, end, filePath));
  };

  const visitBody = (children: readonly unknown[], bodySpan: AstSourceSpan | undefined) => {
    const seenProps = new Map<string, boolean>();
    let cursor = bodySpan?.start ?? 0;
    const bodyEnd = bodySpan?.end ?? source.length;

    for (const child of children) {
      if (!isAstRecord(child)) {
        continue;
      }
      if (child.type === 'Declaration' && typeof child.name === 'string') {
        const located = locateDeclaration(source, child.name, cursor, bodyEnd);
        const nameStart = located?.nameStart ?? cursor;
        const declarationEndValue = located?.declarationEnd ?? nameStart + child.name.length;
        const key = child.name.toLowerCase();
        const skip = key.startsWith('--') || key.startsWith('-');
        if (!skip && !cssData.isKnownProperty(key)) {
          push(LINT_CODES.unknownProperties, 'warning', `Unknown property: '${child.name}'`, nameStart, nameStart + child.name.length);
        }
        if (seenProps.has(key)) {
          push(LINT_CODES.duplicateProperties, 'warning', `Duplicate property '${child.name}'`, nameStart, declarationEndValue);
        } else {
          seenProps.set(key, true);
        }
        visitValueDimensions(child.value, source, located?.valueStart ?? nameStart, declarationEndValue, (src, unit, span) => {
          if (LENGTH_UNITS.has(unit.toLowerCase())) {
            push(
              LINT_CODES.zeroUnits,
              'hint',
              `The unit "${unit}" is unnecessary for a zero value`,
              span?.start ?? nameStart,
              span?.end ?? nameStart + src.length
            );
          }
        });
        cursor = declarationEndValue;
      } else {
        visitAstNode(child);
        const span = sourceSpanOf(child) ?? bodySpanOf(child);
        if (span && span.end > cursor) {
          cursor = span.end;
        }
      }
    }
  };

  const visitAstNode = (node: unknown): void => {
    if (!isAstRecord(node)) {
      return;
    }
    if (RULESET_TYPES.has(node.type)) {
      const bodySpan = bodySpanOf(node);
      const body = astChildrenOf(node, 'rules');
      if (body.length === 0 && bodySpan && isWhitespaceOnly(source, bodySpan.start, bodySpan.end)) {
        const span = sourceSpanOf(node) ?? bodySpan;
        push(LINT_CODES.emptyRules, 'warning', 'Do not use empty rulesets', span.start, span.end);
      }
      visitBody(body, bodySpan);
      return;
    }
    if ((node.type === 'AtRuleStatement' || node.type === 'AtRuleBlock') && typeof node.name === 'string') {
      const rawName = node.name.startsWith('@') ? node.name.slice(1) : node.name;
      const lower = rawName.toLowerCase();
      const span = sourceSpanOf(node);
      if (span && !cssData.isKnownAtRule(lower)) {
        push(LINT_CODES.unknownAtRules, 'warning', `Unknown at-rule @${rawName}`, span.start, span.start + rawName.length + 1);
      }
      if (node.type === 'AtRuleBlock') {
        visitBody(astChildrenOf(node, 'rules'), bodySpanOf(node));
      }
      return;
    }
    visitBody(astChildrenOf(node, 'rules'), undefined);
  };

  visitAstNode(root);
  return out;
}

export function collectTolerantDiagnostics(input: CollectDiagnosticsInput): CollectDiagnosticsResult {
  if (input.language === 'css') {
    const cssAstDiagnostics = cssAstLintDiagnostics(input.source, input.metadata, input.filePath);
    if (cssAstDiagnostics !== null) {
      return { diagnostics: cssAstDiagnostics };
    }
  }

  const doc = parseDocForLanguage(input.source, input.language);
  const needsTolerantSourceScan = doc.errors.length > 0 || doc.unconsumedFrom !== null;
  const lintDiagnostics = doc.tree
    ? cstLintDiagnostics(
        doc.tree,
        input.source,
        input.language,
        input.metadata,
        input.filePath,
        needsTolerantSourceScan
      )
    : [];
  return {
    diagnostics: [
      ...parseDiagnosticsForDoc(doc, input.filePath),
      ...lintDiagnostics
    ]
  };
}
