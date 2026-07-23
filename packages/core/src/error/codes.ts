import type { DiagnosticDisplay } from '../warnings.js';

export type Phase = 'parse' | 'resolve' | 'import' | 'eval' | 'extend' | 'plugin';
export type Severity = 'error' | 'warn';

export type JessErrorCode =
  | 'parse/unexpected-token'
  | 'parse/unterminated-string'
  | 'parse/unexpected-syntax'
  | 'parse/syntax-error'
  | 'parse/dynamic-charset'
  | 'resolve/name-not-found'
  | 'import/circular-compose'
  | 'eval/bad-call-arity'
  | 'eval/type-mismatch'
  | 'eval/invalid-function'
  | 'eval/ambiguous-default'
  | 'eval/invalid-statement'
  | 'eval/property-in-root'
  | 'eval/ruleset-on-property'
  | 'eval/unit-conversion'
  | 'extend/protected-boundary'
  | 'extend/not-found'
  | 'extend/not-accessible'
  | 'plugin/unsupported-feature'
  | 'eval/deprecated'
  | 'resolve/unused-variable'
  | 'selector/duplicate'
  | 'selector/parentless-ampersand'
  | 'selector/comma-list-interpolation'
  | 'function/unresolved';

/**
 * Template record for codes. Keep these short and actionable.
 * Use `${placeholders}` for meta fields.
 */
type Template = { summary: string; reason: string; fix: string };

const TEMPLATES = new Map<JessErrorCode, Template>([
  // Parse/Lex
  ['parse/unexpected-token', {
    summary: 'Unexpected token',
    reason: 'Token "${token}" is not valid here.',
    fix: 'Check for a missing quote/comma or wrong operator.'
  }],
  ['parse/unterminated-string', {
    summary: 'Unterminated string',
    reason: 'Missing closing quote.',
    fix: 'Close the string, e.g. url("hero.jpg").'
  }],
  ['parse/unexpected-syntax', {
    summary: 'Unexpected syntax',
    reason: 'Expected ${expected}, got ${got}.',
    fix: 'Add the expected token or remove the unexpected one.'
  }],
  ['parse/syntax-error', {
    summary: 'Syntax error',
    reason: '${message}',
    fix: 'Check surrounding tokens near this location.'
  }],
  ['parse/dynamic-charset', {
    summary: 'Dynamic @charset is not supported in Less 5',
    reason: 'Interpolation is not valid inside the CSS @charset token.',
    fix: 'Use a static declaration such as @charset "UTF-8";.'
  }],

  // Resolve/Import
  ['resolve/name-not-found', {
    summary: 'Name not found',
    reason: 'Symbol "${symbol}" is undefined in this scope.',
    fix: 'Define "${symbol}" or import a file that provides it.'
  }],
  ['import/circular-compose', {
    summary: 'Circular @-compose detected',
    reason: '${chain}',
    fix: 'Break the cycle (extract shared bits and compose that).'
  }],

  // Eval
  ['eval/bad-call-arity', {
    summary: 'Bad call: wrong arity',
    reason: '${callee} expects ${expectedCount} args, got ${gotCount}.',
    fix: 'Add/remove arguments to match the signature.'
  }],
  ['eval/type-mismatch', {
    summary: 'Type mismatch',
    reason: '${callee} expects ${expected}, got ${got}.',
    fix: 'Pass a ${expected}; convert or choose a compatible value.'
  }],
  ['eval/invalid-function', {
    summary: 'Invalid function call',
    reason: '"${name}" could not be evaluated: ${reason}',
    fix: 'Pass arguments accepted by the function, or use functionMode: \'preserve\' to retain the CSS call.'
  }],
  ['eval/ambiguous-default', {
    summary: 'Ambiguous default() mixin guard',
    reason: 'More than one default() decision can match "${callee}".',
    fix: 'Make the default() guard select exactly one mixin definition.'
  }],
  ['eval/invalid-statement', {
    summary: 'Value node is not valid as a statement',
    reason: '${what} is a value; it cannot stand on its own in a rules body — it was likely returned by a function/mixin or leaked from a detached ruleset.',
    fix: 'Wrap it in a declaration (property: value) or return a valid statement node (ruleset, declaration, at-rule).'
  }],
  ['eval/property-in-root', {
    summary: 'Properties must be inside selector blocks. They cannot be in the root',
    reason: 'The property "${what}" was evaluated at the root — most often a mixin or detached ruleset call that dropped its declarations into the top level.',
    fix: 'Put the property inside a selector block (e.g. call the mixin/detached ruleset from within a ruleset).'
  }],
  ['eval/ruleset-on-property', {
    summary: 'Rulesets cannot be evaluated on a property',
    reason: 'The value of "${what}" evaluated to a detached ruleset; a detached ruleset can only be called (e.g. `@dr();` inside a block), not used as a property value.',
    fix: 'Call the detached ruleset in statement position instead of assigning it to a property.'
  }],
  ['eval/unit-conversion', {
    summary: 'Cannot convert "${value}" to a color',
    reason: 'A dimension with a unit cannot be compared against a color.',
    fix: 'Drop the unit, or compare compatible types.'
  }],

  // Extend
  ['extend/protected-boundary', {
    summary: 'Extend blocked by protected boundary',
    reason: '"${target}" is defined behind a protected compose boundary.',
    fix: 'Move "${target}" to a shared file or create a local shim.'
  }],
  ['extend/not-found', {
    summary: 'Extend target "${target}" not found',
    reason: 'No ruleset found matching "${target}" in accessible extend roots.',
    fix: 'Ensure "${target}" exists and is accessible from the current extend root.'
  }],
  ['extend/not-accessible', {
    summary: 'Extend target "${target}" not accessible',
    reason: '"${target}" exists but is not accessible from the current extend root (blocked by at-rule or compose boundary).',
    fix: 'Move the extend or the target to a shared extend root, or use a different approach.'
  }],

  // Plugin
  ['plugin/unsupported-feature', {
    summary: 'Unsupported feature',
    reason: 'Plugin "${plugin}" does not implement ${feature}.',
    fix: 'Use a supported alternative or enable a fallback.'
  }],

  // Warnings
  ['eval/deprecated', {
    summary: 'Deprecated feature',
    reason: '"${what}" is deprecated.',
    fix: 'Use "${use}" instead.'
  }],
  ['resolve/unused-variable', {
    summary: 'Unused variable',
    reason: '"${symbol}" is declared but its value is never used.',
    fix: 'Remove it or prefix with "_" to silence.'
  }],
  ['selector/duplicate', {
    summary: 'Duplicate selector',
    reason: 'Selector "${selector}" is defined multiple times.',
    fix: 'Consolidate rules or remove the duplicate.'
  }],
  ['selector/parentless-ampersand', {
    summary: 'Parentless ampersand ignored',
    reason: 'Selector "${selector}" uses "&" without an available parent selector in this context.',
    fix: 'Move the selector under a real parent selector, or remove the stray "&".'
  }],
  ['selector/comma-list-interpolation', {
    summary: 'Comma-list value in a selector',
    reason: 'The value interpolated into selector "${selector}" is a comma-separated list; a list can\'t be spliced into a selector position.',
    fix: 'Use each() to distribute a rule over a list instead of interpolating the list into the selector.'
  }],
  ['function/unresolved', {
    summary: 'Function "${name}" left as-is',
    reason: '"${name}" matched a registered function but could not be evaluated: ${reason}',
    fix: 'Fix the arguments, or set functionMode: \'error\' to make this fail.'
  }]
]);

const JESS_ERROR_CODE_SET: ReadonlySet<string> = new Set(TEMPLATES.keys());

export function isJessErrorCode(code: string): code is JessErrorCode {
  return JESS_ERROR_CODE_SET.has(code);
}

/**
 * Resolve a code's template strings, filling `${key}` placeholders from `meta`.
 * Unknown codes fall back to `parse/syntax-error`; unset keys render as `<key>`.
 */
export function resolveTemplate(
  code: JessErrorCode,
  meta: Record<string, unknown>
): Template {
  const t = TEMPLATES.get(code) ?? TEMPLATES.get('parse/syntax-error')!;
  return {
    summary: interpolate(t.summary, meta),
    reason: interpolate(t.reason, meta),
    fix: interpolate(t.fix, meta)
  };
}

function interpolate(s: string, meta: Record<string, unknown>): string {
  return s.replace(/\$\{(\w+)\}/g, (_: string, k: string) => String(meta[k] ?? `<${k}>`));
}

/**
 * Per-category presentation overrides. A code listed here pins its display tier
 * regardless of the severity default (e.g. promote an easy-to-miss warning to a
 * full code frame). Codes with no entry fall back to the severity default.
 */
const DISPLAY_OVERRIDES = new Map<string, DiagnosticDisplay>([
  // A comma-list spliced into a selector is subtle enough to always warrant the
  // full frame, even though it is only a warning.
  ['selector/comma-list-interpolation', 'frame']
]);

/** The pinned display tier for a diagnostic `code`, if any. */
export function displayOverrideFor(code: string): DiagnosticDisplay | undefined {
  return DISPLAY_OVERRIDES.get(code);
}
