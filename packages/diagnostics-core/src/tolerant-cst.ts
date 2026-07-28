import { parseCssDoc, type CssCstChild, type CssCstNode, type ParseDoc } from '@jesscss/css-parser';
import { parseJessDoc } from '@jesscss/jess-parser/cst';
import { parseLessDoc } from '@jesscss/less-parser/cst';
import { parseScssDoc } from '@jesscss/scss-parser/cst';
import { buildCstIndex } from './cst-analysis.js';
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

function isCstNode(c: CssCstChild): c is CssCstNode {
  return c._tag === 'node';
}

function forwardPreludeOf(node: CssCstNode, nodeStart: number, src: string): string | null {
  let afterPath = false;
  for (const child of node.children) {
    if (isCstNode(child)) {
      if (child.grammarType === 'Quoted') {
        afterPath = true;
      }
      continue;
    }
    if (!afterPath) {
      continue;
    }
    const text = src.slice(nodeStart + Number(child.span.start), nodeStart + Number(child.span.end));
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
  filePath?: string
): SourceDiagnostic[] {
  const index = buildCstIndex(root);
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

  for (const { node, start, end } of index.nodes) {
    const gt = node.grammarType;

    if (RULESET_TYPES.has(gt)) {
      const slice = source.slice(start, end);
      const open = slice.indexOf('{');
      const close = slice.lastIndexOf('}');
      if (open >= 0 && close > open && slice.slice(open + 1, close).trim() === '') {
        push(LINT_CODES.emptyRules, 'warning', 'Do not use empty rulesets', start, end);
      }
    }

    if (gt === 'ScssAtRootFilter') {
      push(
        LINT_CODES.unsupportedSassForm, 'warning',
        '@at-root prelude/filter forms are not yet supported in Jess. Write the hoisted rules directly instead.',
        start, end
      );
    }
    if (gt === 'ScssForward') {
      const prelude = forwardPreludeOf(node, start, source);
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
      const slice = source.slice(start, end);
      const m = /^@([-\w]+)/.exec(slice);
      if (m) {
        const name = m[1]!.toLowerCase();
        if (!cssData.isKnownAtRule(name) && !dialectAtRules.has(name)) {
          push(LINT_CODES.unknownAtRules, 'warning', `Unknown at-rule @${m[1]}`, start, start + m[0].length);
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

    const seenProps = new Map<string, boolean>();
    for (const child of node.children) {
      if (!isCstNode(child) || !DECLARATION_TYPES.has(child.grammarType)) {
        continue;
      }
      const childSpan = index.spanOf(child);
      if (!childSpan) {
        continue;
      }
      const name = propNameOf(source.slice(childSpan.start, childSpan.end));
      if (name.length === 0 || name.includes('#{') || name.includes('@{') || name.includes('${')) {
        continue;
      }
      const key = name.toLowerCase();
      if (seenProps.has(key)) {
        push(LINT_CODES.duplicateProperties, 'warning', `Duplicate property '${name}'`, childSpan.start, childSpan.end);
      } else {
        seenProps.set(key, true);
      }
    }
  }

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

  return out;
}

export function collectTolerantDiagnostics(input: CollectDiagnosticsInput): CollectDiagnosticsResult {
  const doc = parseDocForLanguage(input.source, input.language);
  const lintDiagnostics = doc.tree
    ? cstLintDiagnostics(doc.tree, input.source, input.language, input.metadata, input.filePath)
    : [];
  return {
    diagnostics: [
      ...parseDiagnosticsForDoc(doc, input.filePath),
      ...lintDiagnostics
    ]
  };
}
