import type { Context } from '../context.js';
import { ERR } from '../error/diagnostics.js';
import { callSiteLocation } from './call-site-location.js';
import { isValueSlotArray } from './css-grammar-helpers.js';
import type { Declaration, ValueSlot } from './nodes.js';

/**
 * What a declaration value holds that parses as balanced CSS and is then an
 * error: legacy Internet Explorer syntax (ledger P47), or a delim no CSS value
 * accepts (ledger P48).
 */
export interface InvalidValueSyntax {
  readonly code: 'css/legacy-ie-syntax' | 'css/invalid-value-punctuation';

  /** The construct as the message names it: `progid:`, `opacity=` or the delim. */
  readonly what: string;
  readonly fix: string;
}

/** A `progid:` value. */
export const PROGID_IE_SYNTAX: InvalidValueSyntax = {
  code: 'css/legacy-ie-syntax',
  what: 'progid:',
  fix: 'Remove the declaration, or write what the filter did in standard CSS (opacity, a linear-gradient() background, or the filter property\'s functions).'
};

/** A `name=value` call argument, by its name. */
export function nameValueIeSyntax(name: string): InvalidValueSyntax {
  return {
    code: 'css/legacy-ie-syntax',
    what: `${name}=`,
    fix: 'Remove the argument, or write what it did in standard CSS (alpha(opacity=50) is opacity: 0.5).'
  };
}

/*
 * A delim's spelling, whole: only the punctuation a delim run reads, at least
 * one of it from the owner's list. Tested against the token the parser built,
 * never against the source around it.
 */
const INVALID_DELIM_SPELLING = /^[-+*/<>$@%&:.~=|^?]*[.~=|^?][-+*/<>$@%&:.~=|^?]*$/;

/**
 * A delim component (the `Any` a `PunctuationValue` builds) holding `.`, `~`,
 * `=`, `|`, `^` or `?` (owner 2026-10-16), by its spelling: `a.b`'s `.`,
 * `a==b`'s `==`. A delim may also hold the other punctuation a run reads
 * (`+ - * / < > $ @ % & :`); an `Any` holding anything else (`U+4??`, a
 * custom property's text) is not a delim.
 */
export function invalidValuePunctuation(spelling: string): InvalidValueSyntax | undefined {
  return INVALID_DELIM_SPELLING.test(spelling)
    ? { code: 'css/invalid-value-punctuation', what: spelling, fix: 'Remove it. To pass the text through unchanged, write it in a custom property or a string.' }
    : undefined;
}

/**
 * A call whose arguments are not an ordinary value: a `var()`, `env()` or
 * `attr()` fallback is any tokens, and `attr()`'s name takes a namespace `|`.
 */
export function isAnyTokenFunction(name: string): boolean {
  if (name.length > 4) {
    return false;
  }
  const lower = name.toLowerCase();
  return lower === 'var' || lower === 'env' || lower === 'attr';
}

/**
 * The first error in a declaration value, read from its parsed shape (owner
 * 2026-10-16: valid, balanced syntax parses, and is then an error where CSS
 * gives it no meaning):
 *
 * - legacy IE syntax (P47): a `progid:` value — the keyword `progid` (any
 *   case) and the `:` delim after it — or a `name=value` call argument, a
 *   positional argument that is exactly an identifier, the `=` delim and one
 *   value (`alpha(opacity=50)`). Less reads `=` in a call argument as its
 *   comparison, so a Less argument never has this shape.
 * - a delim no CSS value accepts ({@link invalidValuePunctuation}).
 *
 * Legacy IE syntax is the more specific error, so it wins over a delim
 * anywhere in the same value. Only runs, comma lists, paren groups, call
 * arguments and the values of a call's branches and of a lowered `if()` are
 * entered. A branch condition, a dialect's own expression (a Less or SCSS
 * condition, a `.jess` `$(…)`), a lookup, a string and a `var()`, `env()` or
 * `attr()` call are leaves here.
 */
export function invalidValueSyntaxIn(value: ValueSlot): InvalidValueSyntax | undefined {
  if (isValueSlotArray(value)) {
    let found: InvalidValueSyntax | undefined;
    for (let i = 0; i < value.length; i++) {
      const item = value[i]!;
      if (isProgid(item, value[i + 1])) {
        return PROGID_IE_SYNTAX;
      }
      const inner = invalidValueSyntaxIn(item);
      if (inner?.code === 'css/legacy-ie-syntax') {
        return inner;
      }
      found ??= inner;
    }
    return found;
  }
  switch (value.type) {
    case 'Any':
      return invalidValuePunctuation(value.src);
    case 'FunctionCall': {
      if (isAnyTokenFunction(value.name)) {
        return undefined;
      }
      let found: InvalidValueSyntax | undefined;
      for (const arg of value.args) {
        const inner = (arg.name === undefined ? nameValueArgument(arg.value) : undefined) ?? invalidValueSyntaxIn(arg.value);
        if (inner?.code === 'css/legacy-ie-syntax') {
          return inner;
        }
        found ??= inner;
      }
      return found;
    }
    case 'List': {
      let found: InvalidValueSyntax | undefined;
      for (const item of value.value) {
        const inner = invalidValueSyntaxIn(item);
        if (inner?.code === 'css/legacy-ie-syntax') {
          return inner;
        }
        found ??= inner;
      }
      return found;
    }
    case 'IfValue': {
      let found: InvalidValueSyntax | undefined;
      for (const branch of value.branches) {
        const inner = invalidValueSyntaxIn(branch.value);
        if (inner?.code === 'css/legacy-ie-syntax') {
          return inner;
        }
        found ??= inner;
      }
      return found;
    }
    case 'Block':
    case 'Branch':
      return invalidValueSyntaxIn(value.value);
    default:
      return undefined;
  }
}

function isProgid(item: ValueSlot, next: ValueSlot | undefined): boolean {
  return !isValueSlotArray(item) && item.type === 'Keyword' && item.src.length === 6 && item.src.toLowerCase() === 'progid'
    && next !== undefined && !isValueSlotArray(next) && next.type === 'Any' && next.src === ':';
}

function nameValueArgument(arg: ValueSlot): InvalidValueSyntax | undefined {
  if (!isValueSlotArray(arg) || arg.length !== 3) {
    return undefined;
  }
  const name = arg[0]!;
  const delim = arg[1]!;
  if (isValueSlotArray(name) || name.type !== 'Keyword' || isValueSlotArray(delim) || delim.type !== 'Any' || delim.src !== '=') {
    return undefined;
  }
  return nameValueIeSyntax(name.src);
}

/** The error for a finding, at the place `args` names. */
export function invalidValueSyntaxError(found: InvalidValueSyntax, args: Parameters<typeof ERR.invalidValuePunctuation>[0]) {
  return found.code === 'css/legacy-ie-syntax' ? ERR.legacyIeSyntax(args) : ERR.invalidValuePunctuation(args);
}

/**
 * An error in a declaration's authored value fails the compile at the
 * declaration (owner 2026-10-16: "if the diagnostic treats it as an error,
 * then no it doesn't succeed"). The evaluator calls it where it takes each
 * declaration in source order, before a later duplicate can replace it; a
 * value that is not a run, a list, a group or a call passes at its type test.
 * A custom property's value is any tokens: the evaluator's own
 * `isCustomProperty` says which names those are, asked only of a value that
 * holds an error. `at` is the authored declaration a nested property's part
 * came from.
 */
export function assertValidValueSyntax(
  node: Declaration,
  s: { readonly context: Context | undefined },
  isCustomProperty: (name: Declaration['name']) => boolean,
  at: Declaration = node
): void {
  const found = invalidValueSyntaxIn(node.value);
  if (found !== undefined && !isCustomProperty(node.name)) {
    throw invalidValueSyntaxError(found, {
      node: at,
      ...callSiteLocation(at, s),
      meta: { what: found.what, fix: found.fix }
    });
  }
}
