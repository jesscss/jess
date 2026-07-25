/**
 * CST-grounded LINT RULES (MS vscode-css-languageservice parity).
 *
 * A configurable, tolerant lint pass modelled on Microsoft's
 * `services/lintRules.ts` / `services/lint.ts`. Unlike the semantic diagnostics
 * (undefined variable / mixin), which run on the eval AST and only fire on a
 * fully-valid document, these rules read the tolerant, incremental CST
 * (`buildCstIndex`) so they keep working while the document is half-typed.
 *
 * Each rule has a stable `code`, a default severity, and is toggleable through
 * the engine's `configure()` severity map (`ignore`/`off` disables it). Severity
 * resolution is delegated to the caller via `severityOf(code)`: a `null` result
 * means the rule is disabled and emits nothing.
 *
 * SPAN MODEL: the CST stores PARENT-RELATIVE spans, so every absolute offset is
 * resolved through `buildCstIndex(root).spanOf` — never `node.span` directly.
 */
import type { CssCstChild, CssCstNode } from '@jesscss/css-parser';
import type { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver-types';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { buildCstIndex } from './cst-analysis.js';

export type JessLangLike = 'css' | 'less' | 'scss' | 'jess';

/** Stable lint diagnostic codes (also the keys used by `configure()`). */
export const LINT_CODES = {
  emptyRules: 'lint/empty-rules',
  unknownProperties: 'lint/unknown-property',
  unknownAtRules: 'lint/unknown-at-rule',
  duplicateProperties: 'lint/duplicate-property',
  hexColorLength: 'lint/hex-color-length',
  zeroUnits: 'lint/zero-units',
  /**
   * SCSS forms Jess parses (so a converted file still yields a tree) but will
   * never evaluate: `@forward … as <prefix>-*`, `@forward … show/hide`, and the
   * `@at-root (<filter>)` prelude form. Documented in the "Unsupported Sass
   * Features" guide, which specifies a warning at the use site.
   */
  unsupportedSassForm: 'unsupported/sass-form'
} as const;

/** Data + severity hooks the engine supplies (it owns the property/at-rule data
 * loaded from `@vscode/web-custom-data` + `known-css-properties`). */
export type LintDeps = {
  severityOf(code: string): DiagnosticSeverity | null;
  /** Bare, lowercased property name → is it a known CSS property? */
  isKnownProperty(name: string): boolean;
  /** Bare, lowercased at-rule name (no `@`) → is it a known CSS at-rule? */
  isKnownAtRule(name: string): boolean;
};

// Length units where a zero value makes the unit redundant (`0px` → `0`).
// Percentages, angles, times, resolutions and frequencies are NOT flagged: a
// bare `0` is not always interchangeable there.
const LENGTH_UNITS = new Set([
  'px', 'em', 'rem', 'ex', 'ch', 'cap', 'ic', 'lh', 'rlh',
  'vw', 'vh', 'vi', 'vb', 'vmin', 'vmax',
  'cm', 'mm', 'q', 'in', 'pt', 'pc'
]);

// Dialect at-rules that are legitimate but absent from the CSS at-rule data.
// The dialect grammars usually give these their OWN grammarType (`ScssMixin`
// etc.) so they never reach the unknown-at-rule check; this is a safety net for
// tolerant parses that fall back to a generic `AtRuleBlock`.
const DIALECT_AT_RULES: Record<JessLangLike, Set<string>> = {
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

// Selector-ish children of a Ruleset (used to tell an empty body from a bare
// selector node when deciding whether a rule has content).
const RULESET_TYPES = new Set(['Ruleset']);

// `@forward` prelude forms Jess parses but will never evaluate.
const FORWARD_AS_PREFIX = /\bas\s+\S+-\*/;
const FORWARD_VISIBILITY = /\b(show|hide)\b/;

function isCstNode(c: CssCstChild): c is CssCstNode {
  return c._tag === 'node';
}

/**
 * Text of a `ScssForward`'s post-path prelude leaf (`as *`, `as a-*`, `show …`,
 * `hide …`), or `null` when the at-rule has none. The grammar captures the
 * prelude as ONE leaf after the `Quoted` path, so it is read off the CST rather
 * than re-scanned out of the at-rule slice; only the leaf's own text is
 * inspected. Loud/silent comments and line breaks inside it are normalized away,
 * so a prefix form interrupted by a comment or a newline still matches.
 */
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

function toRange(doc: TextDocument, start: number, end: number): Range {
  return {
    start: doc.positionAt(Math.max(0, start)),
    end: doc.positionAt(Math.max(Math.max(0, start), end))
  };
}

/** Property name (before the first `:`) of a Declaration slice, trimmed. */
function propNameOf(slice: string): string {
  const colon = slice.indexOf(':');
  const head = colon >= 0 ? slice.slice(0, colon) : slice;
  return head.trim();
}

/** Blank out quoted regions (preserving length + offsets) so a value scan does
 * not treat `#…` inside a string as a color. */
function blankStrings(value: string): string {
  return value.replace(/"[^"]*"|'[^']*'/g, m => ' '.repeat(m.length));
}

/**
 * Run the CST lint rules over one document. Returns fully-formed diagnostics
 * (severity already resolved); disabled rules (`severityOf` → null) contribute
 * nothing. Tolerant: safe on partial/invalid input.
 */
export function cstLintDiagnostics(root: CssCstNode, doc: TextDocument, lang: JessLangLike, deps: LintDeps): Diagnostic[] {
  const index = buildCstIndex(root);
  const src = doc.getText();
  const out: Diagnostic[] = [];

  const emptyRulesSev = deps.severityOf(LINT_CODES.emptyRules);
  const unknownPropSev = deps.severityOf(LINT_CODES.unknownProperties);
  const unknownAtSev = deps.severityOf(LINT_CODES.unknownAtRules);
  const dupPropSev = deps.severityOf(LINT_CODES.duplicateProperties);
  const hexSev = deps.severityOf(LINT_CODES.hexColorLength);
  const zeroSev = deps.severityOf(LINT_CODES.zeroUnits);
  const unsupportedSev = deps.severityOf(LINT_CODES.unsupportedSassForm);

  const push = (code: string, sev: DiagnosticSeverity, message: string, start: number, end: number) => {
    out.push({
      code,
      source: 'jess',
      message,
      severity: sev,
      range: toRange(doc, start, end)
    });
  };

  const dialectAtRules = DIALECT_AT_RULES[lang];

  for (const { node, start, end } of index.nodes) {
    const gt = node.grammarType;

    // --- emptyRules: a ruleset whose body between `{` and `}` is whitespace. ---
    if (emptyRulesSev !== null && RULESET_TYPES.has(gt)) {
      const slice = src.slice(start, end);
      const open = slice.indexOf('{');
      const close = slice.lastIndexOf('}');
      if (open >= 0 && close > open && slice.slice(open + 1, close).trim() === '') {
        push(LINT_CODES.emptyRules, emptyRulesSev, 'Do not use empty rulesets', start, end);
      }
    }

    // --- unsupportedSassForm: parsed-but-never-evaluated SCSS forms. ---
    // Recognition is STRUCTURAL: `ScssAtRootFilter` is the grammar's own node for
    // the `@at-root (<filter>)` form, and the `@forward` prelude is the grammar's
    // own captured leaf. Both diagnostics take the full node span, matching the
    // spans the SCSS builder used to save before these checks moved editor-side.
    if (unsupportedSev !== null && gt === 'ScssAtRootFilter') {
      push(
        LINT_CODES.unsupportedSassForm, unsupportedSev,
        '@at-root prelude/filter forms are not yet supported in Jess. Write the hoisted rules directly instead.',
        start, end
      );
    }
    if (unsupportedSev !== null && gt === 'ScssForward') {
      const prelude = forwardPreludeOf(node, start, src);
      if (prelude !== null) {
        if (FORWARD_AS_PREFIX.test(prelude)) {
          push(
            LINT_CODES.unsupportedSassForm, unsupportedSev,
            '@forward with "as <prefix>-*" prefixing is not supported in Jess and will never be. Use explicit namespacing instead.',
            start, end
          );
        }
        if (FORWARD_VISIBILITY.test(prelude)) {
          push(
            LINT_CODES.unsupportedSassForm, unsupportedSev,
            '@forward with "show"/"hide" lists is not supported in Jess and will never be. Visibility control belongs to the module itself.',
            start, end
          );
        }
      }
    }

    // --- unknownAtRules: an at-rule whose name is not a known/dialect at-rule. ---
    if (unknownAtSev !== null && (gt === 'AtRuleBlock' || gt === 'AtRuleStatement' || gt === 'UnknownAtRuleBlock' || gt === 'QueryAtRuleBlock')) {
      const slice = src.slice(start, end);
      const m = /^@([-\w]+)/.exec(slice);
      if (m) {
        const name = m[1]!.toLowerCase();
        if (!deps.isKnownAtRule(name) && !dialectAtRules.has(name)) {
          push(LINT_CODES.unknownAtRules, unknownAtSev, `Unknown at-rule @${m[1]}`, start, start + m[0].length);
        }
      }
    }

    // --- zeroUnits: a `0` value carrying a redundant length unit (`0px`). ---
    if (zeroSev !== null && gt === 'Dimension') {
      const slice = src.slice(start, end).trim();
      const m = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]+)$/i.exec(slice);
      if (m && Number(m[1]) === 0 && LENGTH_UNITS.has(m[2]!.toLowerCase())) {
        push(LINT_CODES.zeroUnits, zeroSev, `The unit "${m[2]}" is unnecessary for a zero value`, start, end);
      }
    }

    // --- Declaration-scoped rules: unknown property, hex color length. ---
    if (gt === 'Declaration') {
      const slice = src.slice(start, end);
      const colon = slice.indexOf(':');
      const name = propNameOf(slice);

      if (unknownPropSev !== null && name.length > 0) {
        const lower = name.toLowerCase();
        const skip = lower.startsWith('--')
          || lower.startsWith('-')
          || lower.startsWith('$')
          || lower.startsWith('@')
          || lower.includes('#{')
          || lower.includes('@{')
          || lower.includes('${');
        if (!skip && !deps.isKnownProperty(lower)) {
          const nameStart = start + slice.indexOf(name);
          push(LINT_CODES.unknownProperties, unknownPropSev, `Unknown property: '${name}'`, nameStart, nameStart + name.length);
        }
      }

      if (hexSev !== null && colon >= 0) {
        const valueStart = colon + 1;
        const value = blankStrings(slice.slice(valueStart));
        const hexRe = /#([0-9a-fA-F]+)/g;
        let hm: RegExpExecArray | null;
        while ((hm = hexRe.exec(value)) !== null) {
          const digits = hm[1]!.length;
          if (digits !== 3 && digits !== 4 && digits !== 6 && digits !== 8) {
            const hexStart = start + valueStart + hm.index;
            push(LINT_CODES.hexColorLength, hexSev, `Hex color '${hm[0]}' does not have 3, 4, 6 or 8 digits`, hexStart, hexStart + hm[0].length);
          }
        }
      }
    }

    // --- duplicateProperties: same property name twice in one direct block. ---
    if (dupPropSev !== null) {
      const seenProps = new Map<string, boolean>();
      for (const child of node.children) {
        if (!isCstNode(child) || child.grammarType !== 'Declaration') {
          continue;
        }
        const childSpan = index.spanOf(child);
        if (!childSpan) {
          continue;
        }
        const name = propNameOf(src.slice(childSpan.start, childSpan.end));
        if (name.length === 0 || name.includes('#{') || name.includes('@{') || name.includes('${')) {
          continue;
        }
        const key = name.toLowerCase();
        if (seenProps.has(key)) {
          push(LINT_CODES.duplicateProperties, dupPropSev, `Duplicate property '${name}'`, childSpan.start, childSpan.end);
        } else {
          seenProps.set(key, true);
        }
      }
    }
  }

  return out;
}
