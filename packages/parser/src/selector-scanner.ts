import { isSourceWhitespace } from './source-scanner.js';

export type CheapSelectorComponent =
  | string[]
  | ' '
  | '>'
  | '+'
  | '~';

function isSelectorNameCode(code: number): boolean {
  return (
    (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || (code >= 48 && code <= 57)
    || code === 45
    || code === 95
  );
}

function isSelectorNameStartCode(code: number, allowUppercase: boolean): boolean {
  return (
    (code >= 97 && code <= 122)
    || (allowUppercase && code >= 65 && code <= 90)
    || code === 95
    || code === 45
  );
}

function isTypeSelectorStartCode(code: number): boolean {
  return (code >= 97 && code <= 122) || code === 95;
}

function scanBasicSelectorAtom(source: string, start: number): number {
  const first = source[start];
  if (first === '*') {
    return start + 1;
  }
  let cursor = start;
  if (first === '.' || first === '#') {
    cursor++;
    if (cursor >= source.length || !isSelectorNameStartCode(source.charCodeAt(cursor), true)) {
      return -1;
    }
    if (source[cursor] === '-' && (cursor + 1 >= source.length || !isSelectorNameCode(source.charCodeAt(cursor + 1)))) {
      return -1;
    }
  } else if (!isTypeSelectorStartCode(source.charCodeAt(cursor))) {
    return -1;
  }
  while (cursor < source.length && isSelectorNameCode(source.charCodeAt(cursor))) {
    const code = source.charCodeAt(cursor);
    if (first !== '.' && first !== '#' && code >= 65 && code <= 90) {
      return -1;
    }
    cursor++;
  }
  return cursor;
}

function scanCompoundSelector(source: string, start: number): { component: string[]; end: number } | undefined {
  const atoms: string[] = [];
  let cursor = start;
  while (cursor < source.length) {
    const end = scanBasicSelectorAtom(source, cursor);
    if (end === -1) {
      break;
    }
    atoms.push(source.slice(cursor, end));
    cursor = end;
  }
  if (atoms.length === 0) {
    return undefined;
  }
  return {
    component: atoms,
    end: cursor
  };
}

/**
 * Tokenize only cheap selector structures that are safe to share across
 * CSS-family parser proofs.
 *
 * This helper returns strings and combinator markers only. Language packages
 * decide whether to materialize those components into core selector nodes.
 */
export function scanCheapSelectorComponents(selector: string): CheapSelectorComponent[] | undefined {
  const source = selector.trim();
  if (!source) {
    return undefined;
  }
  const components: CheapSelectorComponent[] = [];
  let cursor = 0;
  let sawWhitespace = false;
  let lastWasCombinator = false;
  while (cursor < source.length) {
    const code = source.charCodeAt(cursor);
    if (isSourceWhitespace(code)) {
      sawWhitespace = components.length > 0 && !lastWasCombinator;
      cursor++;
      continue;
    }
    const char = source[cursor];
    if (char === '>' || char === '+' || char === '~') {
      if (components.length === 0 || lastWasCombinator) {
        return undefined;
      }
      components.push(char);
      cursor++;
      sawWhitespace = false;
      lastWasCombinator = true;
      continue;
    }
    if (sawWhitespace) {
      components.push(' ');
      sawWhitespace = false;
    }
    const compoundResult = scanCompoundSelector(source, cursor);
    if (!compoundResult) {
      return undefined;
    }
    components.push(compoundResult.component);
    cursor = compoundResult.end;
    lastWasCombinator = false;
  }
  if (components.length === 0 || lastWasCombinator) {
    return undefined;
  }
  return components;
}
