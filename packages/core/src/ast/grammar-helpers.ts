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
import { keyword, NULL_NODE, pseudoHasInterp, selectorBranchCanonical, selectorBranchHasInterp, selectorCapture } from './nodes.js';
import { NO_SPAN, sourceEndOf, sourceStartOf, withBodySpan } from './provenance.js';
import type {
  ComplexSelector,
  ForBinding,
  Keyword,
  ModuleImport,
  Null,
  SelectorBranch,
  SelectorCapture,
  SelectorList
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

/*
 * Selector capture (ledger P49), shared by the `.less` and `.jess` grammars.
 *
 * `selector(` reads the selector list as far as it can, then — only where the
 * next token is not `)` — the rest of the argument as one opaque token. A
 * capture with no rest is the selector list; anything else is an error at the
 * argument (P45), and the value is the call as written.
 */

/** A raw child holding written text — not a selector node, not a padding run. */
function isWrittenToken(child: unknown): child is Token {
  return isToken(child) && child.value.trim() !== '';
}

/** The written token between a construct's opening and closing delimiter tokens, if any. */
function writtenTokenBetween(children: readonly unknown[]): Token | undefined {
  for (let index = 1; index < children.length - 1; index += 1) {
    const child = children[index];
    if (isWrittenToken(child)) {
      return child;
    }
  }
  return undefined;
}

function isSelectorListChild(child: unknown): child is SelectorList {
  return typeof child === 'object' && child !== null && 'type' in child && child.type === 'SelectorList';
}

/** The one leaf a scan matched, with its span: the opaque rest of a recovered construct. */
export function scannedLeaf(children: readonly unknown[]): SpannedToken & Token {
  const leaf = children[0];
  if (!isSpannedToken(leaf) || !isToken(leaf)) {
    throw new TypeError('A scan produced no leaf.');
  }
  return leaf;
}

/**
 * What `selector(…)` holds when its argument is not a selector list: where to
 * report it — the rest the list could not read, without its trailing padding,
 * or the whole call when the argument holds nothing — and the call, written
 * as a capture prints (the list canonical, the rest as written), or
 * `undefined` where the list reads an interpolation, which has no canonical
 * spelling: the call is then kept as authored (`authoredSource`).
 */
export interface SelectorCaptureProblem {
  readonly start: number;
  readonly end: number;
  readonly written: string | undefined;
}

/**
 * The capture a `selector(` reduction built, or the problem to report. A
 * capture holds its list as text, so it cannot hold an interpolation, which a
 * `:is()` / `:where()` item reads (`selector(.a:is(@{x}))`): that is reported
 * at the item.
 */
export function selectorCaptureOf(children: readonly unknown[], span: SourceSpan): SelectorCapture | SelectorCaptureProblem {
  const selector = children.find(isSelectorListChild);
  const rest = writtenTokenBetween(children);
  const list = selector?.selectors.map(selectorBranchCanonical).join(', ');
  if (selector?.selectors.some(selectorBranchHasInterp)) {
    const item = interpolatedItemIn(selector);
    return {
      start: item === undefined ? span.start : sourceStartOf(item),
      end: item === undefined ? span.end : sourceEndOf(item),
      written: undefined
    };
  }
  if (list !== undefined && rest === undefined) {
    return selectorCapture(selector!.selectors.map(selectorBranchCanonical), `selector(${list})`);
  }
  const open = children[0];
  const opener = isToken(open) ? open.value : 'selector(';
  if (rest === undefined) {
    return { start: span.start, end: span.end, written: `${opener})` };
  }
  const text = rest.value.trimEnd();
  const start = isSpannedToken(rest) ? rest.span.start : span.start;
  const lead = list === undefined ? '' : `${list}${text.startsWith(',') ? '' : ' '}`;
  return { start, end: start + text.length, written: `${opener}${lead}${text})` };
}

/**
 * A reduction that recovers from a problem builds a value and reports the
 * problem, but a reduction can run inside an attempt the parser later
 * abandons, and a report is not rolled back with it. So a report names the
 * value it was built for (`recoveredValue`), and after the run only the
 * reports whose value is in the accepted tree are kept.
 */
export function recoveredInTree<E extends object>(root: object, errors: readonly E[]): readonly E[] {
  if (!errors.some(error => 'recoveredValue' in error)) {
    return errors;
  }
  const seen = new Set<object>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const item = stack.pop();
    if (typeof item !== 'object' || item === null || seen.has(item)) {
      continue;
    }
    seen.add(item);
    for (const value of Object.values(item)) {
      if (typeof value === 'object' && value !== null) {
        stack.push(value);
      }
    }
  }
  return errors.filter(error => !('recoveredValue' in error) || (typeof error.recoveredValue === 'object' && error.recoveredValue !== null && seen.has(error.recoveredValue)));
}

/*
 * The first `:is()` / `:where()` item in a list that reads an interpolation,
 * found through the pseudos that hold it; `undefined` when it has no span.
 */
function interpolatedItemIn(list: SelectorList): SelectorBranch | undefined {
  for (const branch of list.selectors) {
    if (!selectorBranchHasInterp(branch)) {
      continue;
    }
    const terms = branch.type === 'ComplexSelector' || branch.type === 'RelativeSelector' ? branch.value : [branch];
    for (const term of terms) {
      const tokens = typeof term === 'string' ? [] : term.type === 'CompoundSelector' ? term.value : [term];
      for (const token of tokens) {
        if (token.type === 'PseudoSelector' && token.args !== null && pseudoHasInterp(token)) {
          return interpolatedItemIn(token.args) ?? (sourceStartOf(branch) === NO_SPAN ? undefined : branch);
        }
      }
    }
    if (sourceStartOf(branch) !== NO_SPAN) {
      return branch;
    }
  }
  return undefined;
}
