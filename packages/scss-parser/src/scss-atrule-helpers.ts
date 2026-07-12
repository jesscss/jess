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
  const text = preludeExtra.trim();
  if (/\bas\s+[^\s;]+-\*/.test(text)) {
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
