import { mapMaybe, type MaybePromise } from '@jesscss/awaitable-pipe';
import type { Context } from '../context.js';
import { ERR } from '../error/diagnostics.js';
import { callSiteLocation } from './call-site-location.js';
import { isValueSlotArray } from './css-grammar-helpers.js';

export { checkedSupportsPrelude, checkedImportTarget } from './supports-condition.js';
import type { Any, CallValue, Declaration, ValueSlot } from './nodes.js';

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
 * one of it from the owner's list or `:`, `<`, `>`, `$`, `%`, `&`. Tested
 * against the token the parser built, never against the source around it.
 */
const INVALID_DELIM_SPELLING = /^[-+*/<>$@%&:.~=|^?]*[<>$%&:.~=|^?][-+*/<>$@%&:.~=|^?]*$/;

/**
 * A delim component (the `Any` a `PunctuationValue` builds) holding `.`, `~`,
 * `=`, `|`, `^` or `?`, or `:`, `<`, `>`, `$`, `%` or `&` (owner 2026-10-16:
 * "all that punctuation is out"), by its spelling: `a.b`'s `.`, `a==b`'s `==`,
 * `a:b`'s `:`. A dialect that gives one of them meaning builds another node
 * for it (a comparison, a modulo, a variable), so its punctuation never
 * reaches here; a branch's colon is not entered ({@link invalidValueSyntaxIn}).
 * A delim may also hold `+ - * / @`; an `Any` holding anything
 * else (`U+4??`, a custom property's text) is not a delim.
 */
export function invalidValuePunctuation(spelling: string): InvalidValueSyntax | undefined {
  return INVALID_DELIM_SPELLING.test(spelling)
    ? { code: 'css/invalid-value-punctuation', what: spelling, fix: 'Remove it. To pass the text through unchanged, write it in a custom property or a string.' }
    : undefined;
}

/**
 * How many leading arguments of a call are not a value: the first of `var()`
 * (the custom-property name), `env()` (the variable name) and `attr()` (the
 * attribute name, its namespace `|` and its `type(…)`). The fallback after it
 * is substituted into the property, so it is a value (owner 2026-10-16: "errr...
 * but a.b is not a valid value").
 */
export function nameArguments(name: string): number {
  return name.length <= 4 && NAMED_FALLBACK_FUNCTION.test(name) ? 1 : 0;
}

const NAMED_FALLBACK_FUNCTION = /^(?:var|env|attr)$/i;

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
 * condition, a `.jess` `$(…)`), a lookup, a string and the name argument
 * of a `var()`, `env()` or `attr()` call ({@link nameArguments}) are leaves
 * here.
 */
export function invalidValueSyntaxIn(value: ValueSlot, kept?: ValueCheckLane['s']): InvalidValueSyntax | undefined {
  if (isValueSlotArray(value)) {
    let found: InvalidValueSyntax | undefined;
    for (let i = 0; i < value.length; i++) {
      const item = value[i]!;
      if (isProgid(item, value[i + 1])) {
        return PROGID_IE_SYNTAX;
      }
      const inner = invalidValueSyntaxIn(item, kept);
      if (inner?.code === 'css/legacy-ie-syntax') {
        return inner;
      }
      found ??= inner;
    }
    return found;
  }
  switch (value.type) {
    case 'Any':
      /*
       * A mixin argument's snapshot holds evaluated bytes, not a parsed delim:
       * it answers from what its evaluation kept (`kept`), never by its text.
       */
      return kept?.snapshotValues?.has(value) === true ? kept.invalidArguments.get(value) : invalidValuePunctuation(value.src);
    case 'FunctionCall': {
      let found: InvalidValueSyntax | undefined;
      for (let i = nameArguments(value.name); i < value.args.length; i++) {
        const arg = value.args[i]!;
        const branchValue = i === 0 && arg.name === undefined ? branchValueOf(arg.value) : undefined;
        const inner = branchValue !== undefined
          ? invalidValueSyntaxIn(branchValue, kept)
          : (arg.name === undefined ? nameValueArgument(arg.value) : undefined) ?? invalidValueSyntaxIn(arg.value, kept);
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
        const inner = invalidValueSyntaxIn(item, kept);
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
        const inner = invalidValueSyntaxIn(branch.value, kept);
        if (inner?.code === 'css/legacy-ie-syntax') {
          return inner;
        }
        found ??= inner;
      }
      return found;
    }
    case 'Block':
    case 'Branch':
      return invalidValueSyntaxIn(value.value, kept);
    default:
      return undefined;
  }
}

function isProgid(item: ValueSlot, next: ValueSlot | undefined): boolean {
  return !isValueSlotArray(item) && item.type === 'Keyword' && item.src.length === 6 && item.src.toLowerCase() === 'progid'
    && next !== undefined && !isValueSlotArray(next) && next.type === 'Any' && next.src === ':';
}

/*
 * A call's first argument holding a top-level `:` after its first component is
 * a branch (ledger P38, in every dialect): what precedes the colon is its
 * condition, which is not entered, as a `Branch`'s is not. A dialect that does
 * not yet build the `Branch` (`.jess`, jess#297) leaves the run, so its colon
 * is not a delim. Returns the branch's value, or `undefined` for any other
 * argument.
 */
function branchValueOf(arg: ValueSlot): ValueSlot | undefined {
  if (!isValueSlotArray(arg)) {
    return undefined;
  }
  for (let i = 1; i < arg.length; i++) {
    const item = arg[i]!;
    if (!isValueSlotArray(item) && item.type === 'Any' && item.src === ':') {
      return arg.slice(i + 1);
    }
  }
  return undefined;
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
 * The error for a finding, at the declaration `at`, or, for a part of an SCSS
 * nested property, which carries no span, at the declaration it came from.
 */
function invalidValueSyntaxAt(found: InvalidValueSyntax, at: Declaration, s: ValueCheckLane['s']) {
  const node = s.nestedPropertyOwners?.get(at) ?? at;
  return invalidValueSyntaxError(found, { node, ...callSiteLocation(node, s), meta: { what: found.what, fix: found.fix } });
}

/** Of two findings, the more specific: legacy IE syntax, else the first. */
function moreSpecific(kept: InvalidValueSyntax | undefined, found: InvalidValueSyntax): InvalidValueSyntax {
  return kept === undefined || (kept.code !== 'css/legacy-ie-syntax' && found.code === 'css/legacy-ie-syntax') ? found : kept;
}

/** {@link ValueCheckLane.checks} while a mixin argument is bound. */
const ARGUMENT = 'argument';

/**
 * What the evaluator's lane carries for checking a value a reference reaches
 * (serialize.ts `Lane`, `EvalSession`).
 */
export interface ValueCheckLane {
  /**
   * The declaration whose value is being written, `'argument'` while a mixin
   * argument is bound, or `undefined` where a value is not written as a CSS
   * value.
   */
  checks: Declaration | typeof ARGUMENT | undefined;
  readonly s: {
    readonly context: Context | undefined;

    /** What the mixin argument being bound holds or reached. */
    argumentSyntax: InvalidValueSyntax | undefined;

    /**
     * Mixin arguments and collection entries holding an error, by the typed
     * value each evaluated to and the snapshot an argument binds as. One map
     * per render, shared by its capture-only sessions.
     */
    readonly invalidArguments: Map<object, InvalidValueSyntax>;

    /** The snapshots mixin arguments bind as (serialize.ts `EvalSession.snapshotValues`). */
    readonly snapshotValues: { has(key: Any): boolean } | undefined;

    /** The authored declaration each part of an SCSS nested property came from. */
    readonly nestedPropertyOwners: Map<Declaration, Declaration> | undefined;
  };
}

/**
 * A value a reference reached, checked as the declaration value it is written
 * into is checked (owner 2026-10-16: "Nah, variables aren't looser"): legacy IE
 * syntax or a delim no CSS value accepts (`found`) fails the compile at the
 * declaration that writes it. While a mixin argument is bound the finding is
 * kept for it ({@link bindingArgument}), legacy IE syntax first. Each hop of a
 * chain is checked as it is reached, so no walk follows a reference itself.
 */
export function reportReached(e: ValueCheckLane, found: InvalidValueSyntax | undefined): void {
  const at = e.checks;
  if (found === undefined || at === undefined) {
    return;
  }
  if (at === ARGUMENT) {
    e.s.argumentSyntax = moreSpecific(e.s.argumentSyntax, found);
    return;
  }
  throw invalidValueSyntaxAt(found, at, e.s);
}

/**
 * An evaluated value a reference reached — a collection entry, a loop item —
 * checked by what was kept when it was evaluated ({@link boundArgument}).
 */
export function reachedEvaluated<T extends object>(e: ValueCheckLane, value: T): T {
  if (e.checks !== undefined && e.s.invalidArguments.size !== 0) {
    reportReached(e, e.s.invalidArguments.get(value));
  }
  return value;
}

/**
 * Start binding a mixin argument or a collection entry (`source`): until
 * {@link boundArgument}, what a reference in it reaches is kept, not raised,
 * and the argument as written is the first finding. Returns the finding of an
 * enclosing argument, which {@link boundArgument} restores.
 */
export function bindingArgument(e: ValueCheckLane, source: ValueSlot): InvalidValueSyntax | undefined {
  const outer = e.s.argumentSyntax;
  e.checks = ARGUMENT;
  e.s.argumentSyntax = invalidValueSyntaxIn(source, e.s);
  return outer;
}

/**
 * Finish binding an argument, also when its evaluation threw: restores the
 * enclosing argument's `checks` and finding, and returns what this one held or
 * reached, for {@link keepArgument}.
 */
export function boundArgument(e: ValueCheckLane, checks: ValueCheckLane['checks'], outer: InvalidValueSyntax | undefined): InvalidValueSyntax | undefined {
  const found = e.s.argumentSyntax;
  e.checks = checks;
  e.s.argumentSyntax = outer;
  return found;
}

/**
 * What a bound argument held or reached (`found`) is kept for the value it
 * evaluated to, to be raised where a reference writes it
 * ({@link reachedEvaluated}, {@link keepArgumentSyntax}).
 */
export function keepArgument<T extends object>(s: ValueCheckLane['s'], found: InvalidValueSyntax | undefined, value: MaybePromise<T>): MaybePromise<T> {
  return found === undefined
    ? value
    : mapMaybe(value, (settled) => {
        s.invalidArguments.set(settled, found);
        return settled;
      });
}

/** What an argument's typed `value` holds is kept for the snapshot it binds as (`bound`). */
export function keepArgumentSyntax(s: ValueCheckLane['s'], value: object, bound: object): void {
  const found = s.invalidArguments.size === 0 ? undefined : s.invalidArguments.get(value);
  if (found !== undefined) {
    s.invalidArguments.set(bound, found);
  }
}

/**
 * The first error in a value a reference reached, read from its shape as a
 * declaration value is ({@link invalidValueSyntaxIn}). A mixin argument's
 * snapshot, alone or as a member of a rest parameter or `@arguments`, holds
 * evaluated bytes, not a parsed delim, so it is answered only from what its
 * evaluation kept ({@link keepArgumentSyntax}): `e("=")` or `~"."` passed to a
 * mixin is not a delim. A mixin call is not a value.
 */
export function reachedValueSyntax(value: CallValue, s: ValueCheckLane['s']): InvalidValueSyntax | undefined {
  return !isValueSlotArray(value) && value.type === 'MixinCall' ? undefined : invalidValueSyntaxIn(value, s);
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
