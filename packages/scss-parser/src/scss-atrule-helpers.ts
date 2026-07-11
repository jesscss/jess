/**
 * Shared helpers for SCSS module-system at-rules in the functional parser.
 */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import {
  Any,
  Quoted,
  isNode,
  N,
  sourceSpanOf,
  type Node,
  type LocationInfo,
  type ExtendSelectorKind,
  Url
} from '@jesscss/core';

export function isScriptUsePath(path: string): boolean {
  return path.endsWith('.js') || path.endsWith('.ts') || path.endsWith('.json');
}

export function defaultNamespaceFromPath(path: string): string | undefined {
  if (path.startsWith('sass:')) {
    const name = path.slice('sass:'.length);
    return name.split('/').filter(Boolean).pop();
  }
  const base = path.split('/').filter(Boolean).pop();
  if (!base) {
    return undefined;
  }
  const noExt = base.replace(/\.(scss|sass|css|jess|js|ts|json)$/i, '');
  return noExt || undefined;
}

export function quotedLike(original: Quoted, nextValue: string, loc?: LocationInfo): Quoted {
  const quote = original.options?.quote ?? '"';
  const escaped = original.options?.escaped;
  const nodeLoc: LocationInfo | undefined = loc ?? sourceSpanOf(original);
  return new Quoted(new Any(nextValue, { role: 'any' }), { quote, escaped }, nodeLoc);
}

/**
 * Detect the CSS `@import` ordering violations Sass parse-rejects (`error/wrong_order/*`).
 * The full media-query-list / `supports()` grammar is out of scope for the
 * scanned prelude, so this catches the clearly-invalid, low-false-positive
 * shapes on the raw prelude text (everything after `@import`, minus the path):
 *
 *   1. A bare media feature `(x: y)` (NOT a `fn(...)` call — hence the
 *      no-ident-before-`(` guard) followed by anything other than `and` / `or` /
 *      `,` / `;` / end. Catches `"a" (b: c) supports(d: e)`, `"a" (b: c) d`,
 *      `"a" (b: c) d(e)`.
 *   2. A comma directly followed by a function call `ident(` — a new import item
 *      can never be `supports(...)` or an unknown function. Catches
 *      `"a" b, supports(c: d)`, `"a" b, c(d)`, and `"a", url(b)`.
 *
 * Not caught (documented as remaining): a string after a comma in media context
 * (`"a" b, "c"` — indistinguishable from a valid plain-import continuation without
 * modelling media-vs-plain state) and `supports()` value-syntax errors
 * (`supports(--a:)`).
 */
export function checkImportPreludeOrder(
  preludeText: string,
  recordError: (message: string) => void
): void {
  const text = preludeText;
  // A bare media feature may be followed by `and`/`or` (query chain), `,`/`;`
  // (list / end), `{`/`}` (block bounds), or `)` (closes an enclosing
  // `supports(...)` / group). Anything else — `supports(`, an ident, a function —
  // is the wrong-order violation.
  const badFeatureOrder = /(?<![-\w])\([^()]*:[^()]*\)\s*(?!and(?![-\w])|or(?![-\w])|[,;{})])\S/i;
  const badCommaFunction = /,\s*[a-zA-Z][-\w]*\s*\(/;
  if (badFeatureOrder.test(text) || badCommaFunction.test(text)) {
    recordError('Invalid @import: a media-query list must not follow a media feature without `and`/`or`, and a comma-separated @import item must be a URL or string (not `supports(…)` or another function).');
  }
}

export function isPlainCssImportPath(rawPath: string): boolean {
  return /\.css(?:$|[?#])/i.test(rawPath)
    || /^[a-z]+:\/\//i.test(rawPath)
    || rawPath.startsWith('//');
}

export function isPlainCssImportPrelude(prelude: Node, extraText: string | undefined): boolean {
  if (prelude instanceof Url) {
    return true;
  }
  if (extraText && extraText.trim()) {
    return true;
  }
  if (isNode(prelude, N.Quoted)) {
    return isPlainCssImportPath(prelude.valueOf());
  }
  return true;
}

export function findDisallowedExtendSelector(
  selector: Node,
  allowed: readonly ExtendSelectorKind[]
): { kind: ExtendSelectorKind; selector: Node } | undefined {
  if (isNode(selector, N.SelectorList)) {
    for (const item of selector.value) {
      const disallowed = findDisallowedExtendSelector(item as Node, allowed);
      if (disallowed) {
        return disallowed;
      }
    }
    return undefined;
  }
  const kinds: ExtendSelectorKind[] = isNode(selector, N.BasicSelector)
    ? ['simple', 'basic']
    : isNode(selector, N.PseudoSelector)
      ? ['simple', 'pseudo']
      : isNode(selector, N.CompoundSelector)
        ? ['compound']
        : isNode(selector, N.ComplexSelector)
          ? ['complex']
          : ['simple'];
  if (isNode(selector, N.CompoundSelector) && selector.value.length === 1) {
    return findDisallowedExtendSelector(selector.value[0] as Node, allowed);
  }
  if (isNode(selector, N.ComplexSelector) && selector.value.length === 1) {
    return findDisallowedExtendSelector(selector.value[0] as Node, allowed);
  }
  if (kinds.some(k => allowed.includes(k))) {
    return undefined;
  }
  return { kind: kinds[0]!, selector };
}

export function validateExtendTarget(
  target: Node,
  allowed: readonly ExtendSelectorKind[] | undefined,
  recordError: (message: string) => void
): void {
  if (!allowed) {
    return;
  }
  const disallowed = findDisallowedExtendSelector(target, allowed);
  if (!disallowed) {
    return;
  }
  const kindList = allowed.length === 1 ? `${allowed[0]} value` : allowed.join(', ');
  recordError(
    `@extend only allows ${kindList}, but found ${disallowed.kind} selector "${disallowed.selector.valueOf()}".`
  );
}

export function checkForwardPreludeErrors(
  preludeExtra: string | undefined,
  recordError: (message: string) => void
): void {
  if (!preludeExtra?.trim()) {
    return;
  }
  // Normalize away loud/silent comments and collapse whitespace so a prefix form
  // interrupted by a comment or newline (`as /**/ a-*`, `as //\n a-*`) still
  // matches the rejection patterns below.
  const text = preludeExtra
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n\r]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/\bas\s+\S+-\*/.test(text)) {
    recordError(
      '@forward with "as <prefix>-*" prefixing is not supported in Jess and will never be. Use explicit namespacing instead.'
    );
  }
  if (/\b(show|hide)\b/.test(text)) {
    recordError(
      '@forward with "show"/"hide" lists is not supported in Jess and will never be. Visibility control belongs to the module itself.'
    );
  }
}

export function isPlaceholderExtendTarget(target: Node | string): boolean {
  if (typeof target === 'string') {
    return target.startsWith('\\');
  }
  if (isNode(target, N.BasicSelector)) {
    return target.value.startsWith('\\');
  }
  if (isNode(target, N.SelectorList) && target.value.length === 1) {
    return isPlaceholderExtendTarget(target.value[0] as Node);
  }
  if (isNode(target, N.CompoundSelector) && target.value.length === 1) {
    return isPlaceholderExtendTarget(target.value[0] as Node);
  }
  if (isNode(target, N.ComplexSelector) && target.value.length === 1) {
    return isPlaceholderExtendTarget(target.value[0] as Node);
  }
  return false;
}
