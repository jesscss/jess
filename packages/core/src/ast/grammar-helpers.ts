/**
 * Reducer helpers shared verbatim by the four dialect grammars.
 *
 * A grammar reduction is compiled by the parseman macro plugin, and the plugin
 * can only carry a name a reduction reads if that name has provenance — a
 * module it can name in an import manifest. A helper declared module-privately
 * inside `grammar.ts` is a free binding with no source, which is why the
 * canonical-AST constructors (`keyword`, `withBodySpan`, ...) already live in
 * this package and are imported rather than redeclared. These helpers are the
 * same category: they wrap those constructors, or read the raw parseman child
 * shape, and every dialect needs the identical definition.
 *
 * ADMISSION TEST — a helper belongs here only when it is **byte-identical** in
 * the grammars that declare it. A helper that differs between dialects is
 * drift, not a merge candidate: unifying it silently would change parsing.
 * Dialect-specific helpers stay in their own `grammar.ts`.
 */
import { keyword, NULL_NODE } from './nodes.js';
import { withBodySpan } from './provenance.js';
import type {
  ComplexSelector,
  ForBinding,
  Keyword,
  ModuleImport,
  Null,
  SelectorBranch
} from './nodes.js';

/** The `{ start, end }` offset pair parseman hands a reduction. */
export type SourceSpan = { readonly start: number; readonly end: number };

/** A raw parseman child that still carries its own span. */
export type SpannedToken = { readonly value: unknown; readonly span: SourceSpan };

/** A reduced child whose payload is its literal text. */
export type Token = { readonly value: string };

export function isSpannedToken(value: unknown): value is SpannedToken {
  return typeof value === 'object'
    && value !== null
    && 'value' in value
    && 'span' in value
    && typeof value.span === 'object'
    && value.span !== null
    && 'start' in value.span
    && 'end' in value.span
    && typeof value.span.start === 'number'
    && typeof value.span.end === 'number';
}

export function isToken(value: unknown): value is Token {
  return typeof value === 'object' && value !== null && 'value' in value && typeof value.value === 'string';
}

/**
 * The interior of a `{ ... }` body, taken from the brace tokens' own spans.
 *
 * This exists for the renderer, not for diagnostics: trivia captured INSIDE a
 * ruleset is replayed against the owner's BODY span, so a block-bearing node
 * with no body span silently drops every comment authored inside it. The four
 * dialects must agree on where a body starts and ends.
 */
export function bodySpanFromRaw(rawChildren: readonly unknown[]): SourceSpan | undefined {
  let start: number | undefined;
  let end: number | undefined;
  for (const child of rawChildren) {
    if (!isSpannedToken(child)) {
      continue;
    }
    if (child.value === '{' && start === undefined) {
      start = child.span.end;
    } else if (child.value === '}') {
      end = child.span.start;
    }
  }
  return start === undefined || end === undefined || end < start ? undefined : { start, end };
}

export function withBlockBody<T extends object>(node: T, rawChildren: readonly unknown[]): T {
  const span = bodySpanFromRaw(rawChildren);
  return span === undefined ? node : withBodySpan(node, span);
}

/** Collapse every whitespace run to one space, leaving other characters alone. */
export function semanticGapText(text: string): string {
  let out = '';
  let inGap = false;
  for (const char of text) {
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f') {
      if (!inGap) {
        out += ' ';
        inGap = true;
      }
    } else {
      out += char;
      inGap = false;
    }
  }
  return out;
}

/**
 * A value-position identifier, with `null` recognised as the LITERAL it is in
 * `.scss` and `.jess` (§4.3) rather than as an identifier that happens to spell
 * one.
 *
 * The GRAMMAR decides this, not core: in those dialects `null` is the absent
 * VALUE — a declaration holding it is dropped, a list drops it, `1 + null` is
 * `1`, and `@if null` takes the false branch — while `b: null` in `.css`/`.less`
 * is an ordinary identifier that must pass through verbatim. Core sees a `Null`
 * node and never asks which dialect produced it; sniffing `src` at materialize
 * time (the route `true`/`false` take, where every dialect agrees) could not
 * tell the two apart.
 *
 * Author-written `null` mints the EXPLICIT literal: the shared `NULL_NODE`
 * leaf, which materializes to `makeNull(true)`.
 *
 * Only a value-position identifier terminal calls this. The identifier
 * positions that must keep reading `null` as a NAME — a media/container name,
 * an `@import layer(…)` name, a `@counter-style` / `@keyframes` name, a static
 * `@supports` operand — reference `g.Keyword` directly.
 */
export function keywordOrNull(src: string): Keyword | Null {
  return src === 'null' ? NULL_NODE : keyword(src);
}

export function isForBinding(value: unknown): value is ForBinding {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false;
  }
  if (value.kind === 'single') {
    return 'name' in value && typeof value.name === 'string';
  }
  return (value.kind === 'comma' || value.kind === 'bracket' || value.kind === 'tuple')
    && 'names' in value && Array.isArray(value.names)
    && value.names.every(name => name === undefined || typeof name === 'string');
}

export function isComplexSelector(value: unknown): value is ComplexSelector {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'ComplexSelector'
    && 'value' in value && Array.isArray(value.value);
}

export function isRelativeSelector(value: unknown): value is Extract<SelectorBranch, { readonly type: 'RelativeSelector' }> {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'RelativeSelector'
    && 'value' in value && Array.isArray(value.value);
}

export function isModuleImport(value: unknown): value is ModuleImport {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'ModuleImport';
}
