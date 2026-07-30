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
  readonly inKeyframeBlock: boolean;
};

const ROOT_VISIT_CONTEXT: VisitContext = {
  inVarCall: false,
  inCustomDeclaration: false,
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
    const nodeContext: VisitContext = {
      inVarCall: context.inVarCall || gt === 'VarCall',
      inCustomDeclaration: context.inCustomDeclaration || CUSTOM_DECLARATION_TYPES.has(gt),
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
