import type { DiagnosticDisplay } from '../warnings.js';

export type Phase =
  | 'parse'
  | 'resolve'
  | 'import'
  | 'eval'
  | 'extend'
  | 'lint'
  | 'plugin';
export type Severity = 'error' | 'warn';

export type JessErrorCode =
  | 'parse/unexpected-token'
  | 'parse/unterminated-string'
  | 'parse/unexpected-syntax'
  | 'parse/syntax-error'
  | 'parse/invalid-value'
  | 'parse/dynamic-charset'
  | 'parse/unsupported-inline-javascript'
  | 'parse/unsupported-bare-variable-interpolation'
  | 'parse/unsupported-variable-name'
  | 'parse/unsupported-mixin-name'
  | 'parse/unparenthesized-mixin-guard'
  | 'resolve/name-not-found'
  | 'import/circular-compose'
  | 'import/not-found'
  | 'import/load-failed'
  | 'eval/bad-call-arity'
  | 'eval/type-mismatch'
  | 'eval/invalid-function'
  | 'eval/ambiguous-default'
  | 'eval/invalid-statement'
  | 'eval/property-in-root'
  | 'eval/root-call-without-root'
  | 'eval/guarded-selector-list'
  | 'eval/ruleset-on-property'
  | 'eval/async-in-sync-position'
  | 'eval/recursive-reference'
  | 'eval/invalid-unit-arithmetic'
  | 'eval/unit-conversion'
  | 'extend/protected-boundary'
  | 'extend/not-found'
  | 'extend/not-accessible'
  | 'plugin/unsupported-feature'
  | 'plugin/function-threw'
  | 'plugin/load-failed'
  | 'plugin/log'
  | 'eval/deprecated'
  | 'resolve/unused-variable'
  | 'selector/duplicate'
  | 'selector/parentless-ampersand'
  | 'selector/comma-list-interpolation';

/**
 * Template record for codes. Keep these short and actionable.
 * Use `${placeholders}` for meta fields.
 */
type Template = { summary: string; reason: string; fix: string };

const TEMPLATES = new Map<JessErrorCode, Template>([
  // Parse/Lex
  [
    'parse/unexpected-token',
    {
      summary: 'Unexpected token',
      reason: 'Token "${token}" is not valid here.',
      fix: 'Check for a missing quote/comma or wrong operator.'
    }
  ],
  [
    'parse/unterminated-string',
    {
      summary: 'Unterminated string',
      reason: 'Missing closing quote.',
      fix: 'Close the string, e.g. url("hero.jpg").'
    }
  ],
  [
    'parse/unexpected-syntax',
    {
      summary: 'Unexpected syntax',
      reason: 'Expected ${expected}, got ${got}.',
      fix: 'Add the expected token or remove the unexpected one.'
    }
  ],
  [
    'parse/syntax-error',
    {
      summary: 'Syntax error',
      reason: '${message}',
      fix: 'Check surrounding tokens near this location.'
    }
  ],
  [
    'parse/invalid-value',
    {
      summary: 'Invalid value',
      reason: '${dialect} expected a value here, but this token cannot start one.',
      fix: 'Rewrite this position as a valid value or move the syntax into a statement position.'
    }
  ],
  [
    'parse/dynamic-charset',
    {
      summary: 'Dynamic @charset is not valid',
      reason: 'Interpolation is not valid inside the CSS @charset token.',
      fix: 'Use a static declaration such as @charset "UTF-8";'
    }
  ],
  [
    'parse/unsupported-inline-javascript',
    {
      summary: 'Inline JavaScript is not supported',
      reason: 'Backtick JavaScript expressions are not evaluated.',
      fix: 'Move the expression into an explicit @from/@-from script import or a plugin function.'
    }
  ],
  [
    'parse/unsupported-bare-variable-interpolation',
    {
      summary: 'Bare variable interpolation is not valid here',
      reason:
        'Bare @variable references are values; syntax and prelude interpolation must use @{variable}.',
      fix: 'Wrap the variable name in interpolation braces, for example @{name}.'
    }
  ],
  [
    'parse/unsupported-variable-name',
    {
      summary: 'Unsupported Less variable name',
      reason: 'Less variable names must not be numeric-leading or dash-only.',
      fix: 'Rename the variable to a descriptive name and update its references.'
    }
  ],
  [
    'parse/unsupported-mixin-name',
    {
      summary: 'Unsupported Less mixin name',
      reason: 'Dash-only Less mixin names are not supported.',
      fix: 'Rename the mixin to a descriptive selector-like name, for example .mixin().'
    }
  ],
  [
    'parse/unparenthesized-mixin-guard',
    {
      summary: 'Less mixin guard conditions must be parenthesized',
      reason: 'Top-level Less mixin guards require each condition after when to be wrapped in parentheses.',
      fix: 'Wrap the guard condition, for example: when (default()).'
    }
  ],

  // Resolve/Import
  [
    'resolve/name-not-found',
    {
      summary: 'Name not found',
      reason: 'Symbol "${symbol}" is undefined in this scope.',
      fix: 'Define "${symbol}" or import a file that provides it.'
    }
  ],
  [
    'import/circular-compose',
    {
      summary: 'Circular @-compose detected',
      reason: '${chain}',
      fix: 'Break the cycle (extract shared bits and compose that).'
    }
  ],
  [
    'import/not-found',
    {
      summary: 'Import not found',
      reason: 'Could not resolve "${specifier}" from "${from}".',
      fix: 'Check the import path, extension, and configured include paths.'
    }
  ],
  [
    'import/load-failed',
    {
      summary: 'Import "${specifier}" could not be loaded: ${reason}',
      reason: 'Loading the stylesheet import failed: ${reason}',
      fix: 'Check that the imported file can be read and parsed, or remove the import.'
    }
  ],

  // Eval
  [
    'eval/bad-call-arity',
    {
      summary: 'Bad call: wrong arity',
      reason: '${callee} expects ${expectedCount} args, got ${gotCount}.',
      fix: 'Add/remove arguments to match the signature.'
    }
  ],
  [
    'eval/type-mismatch',
    {
      summary: 'Type mismatch',
      reason: '${callee} expects ${expected}, got ${got}.',
      fix: 'Pass a ${expected}; convert or choose a compatible value.'
    }
  ],
  [
    'eval/invalid-function',
    {
      summary: 'Invalid function call',
      reason: '"${name}" could not be evaluated: ${reason}',
      fix: 'Pass arguments accepted by the function, or use functionMode: \'preserve\' to retain the CSS call.'
    }
  ],
  [
    'eval/ambiguous-default',
    {
      summary: 'Ambiguous default() mixin guard',
      reason: 'More than one default() decision can match "${callee}".',
      fix: 'Make the default() guard select exactly one mixin definition.'
    }
  ],
  [
    'eval/invalid-statement',
    {
      summary: 'Value node is not valid as a statement',
      reason:
        '${what} is a value; it cannot stand on its own in a rules body — it was likely returned by a function/mixin or leaked from a detached ruleset.',
      fix: 'Wrap it in a declaration (property: value) or return a valid statement node (ruleset, declaration, at-rule).'
    }
  ],
  [
    'eval/property-in-root',
    {
      summary:
        'Properties must be inside selector blocks. They cannot be in the root',
      reason:
        'The property "${what}" was evaluated at the root — most often a mixin or detached ruleset call that dropped its declarations into the top level.',
      fix: 'Put the property inside a selector block (e.g. call the mixin/detached ruleset from within a ruleset).'
    }
  ],
  [
    'eval/root-call-without-root',
    {
      summary: 'Function did not return a root node',
      reason:
        'The root-level function call "${name}" evaluated to a value or void result instead of a root-level statement.',
      fix: 'Call the function from a value position, or return a ruleset/declaration block that can be emitted at the root.'
    }
  ],
  [
    'eval/guarded-selector-list',
    {
      summary: 'Guarded selector lists are not supported',
      reason:
        'A when guard applies to ${count} selectors. Less guards are only allowed on a single CSS selector.',
      fix: 'Split the selector list into separate guarded rulesets.'
    }
  ],
  [
    'eval/ruleset-on-property',
    {
      summary: 'Rulesets cannot be evaluated on a property',
      reason:
        'The value of "${what}" evaluated to a detached ruleset; a detached ruleset can only be called (e.g. `@dr();` inside a block), not used as a property value.',
      fix: 'Call the detached ruleset in statement position instead of assigning it to a property.'
    }
  ],
  [
    'eval/recursive-reference',
    {
      summary: 'Recursive reference',
      reason: '${kind} ${symbol} refers to itself while it is being evaluated.',
      fix: 'Break the cycle by assigning through an earlier value or a different name.'
    }
  ],
  [
    'eval/invalid-unit-arithmetic',
    {
      summary: 'Invalid unit arithmetic',
      reason: '${reason}',
      fix: 'Use compatible units, cancel compound units before emission, or use unit() to normalize the value.'
    }
  ],
  [
    'eval/unit-conversion',
    {
      summary: 'Cannot convert "${value}" to a color',
      reason: 'A dimension with a unit cannot be compared against a color.',
      fix: 'Drop the unit, or compare compatible types.'
    }
  ],

  // Extend
  [
    'extend/protected-boundary',
    {
      summary: 'Extend blocked by protected boundary',
      reason: '"${target}" is defined behind a protected compose boundary.',
      fix: 'Move "${target}" to a shared file or create a local shim.'
    }
  ],
  [
    'extend/not-found',
    {
      summary: 'Extend target "${target}" not found',
      reason:
        'No ruleset found matching "${target}" in accessible extend roots.',
      fix: 'Ensure "${target}" exists and is accessible from the current extend root.'
    }
  ],
  [
    'extend/not-accessible',
    {
      summary: 'Extend target "${target}" not accessible',
      reason:
        '"${target}" exists but is not accessible from the current extend root (blocked by at-rule or compose boundary).',
      fix: 'Move the extend or the target to a shared extend root, or use a different approach.'
    }
  ],

  // Plugin
  [
    'plugin/unsupported-feature',
    {
      summary: 'Unsupported feature',
      reason: 'Plugin "${plugin}" does not implement ${feature}.',
      fix: 'Use a supported alternative or enable a fallback.'
    }
  ],

  // Warnings
  [
    'eval/deprecated',
    {
      summary: 'Deprecated feature',
      reason: '"${what}" is deprecated.',
      fix: 'Use "${use}" instead.'
    }
  ],
  [
    'resolve/unused-variable',
    {
      summary: 'Unused variable',
      reason: '"${symbol}" is declared but its value is never used.',
      fix: 'Remove it or prefix with "_" to silence.'
    }
  ],
  [
    'selector/duplicate',
    {
      summary: 'Duplicate selector',
      reason: 'Selector "${selector}" is defined multiple times.',
      fix: 'Consolidate rules or remove the duplicate.'
    }
  ],
  [
    'selector/parentless-ampersand',
    {
      summary: 'Parentless ampersand ignored',
      reason:
        'Selector "${selector}" uses "&" without an available parent selector in this context.',
      fix: 'Move the selector under a real parent selector, or remove the stray "&".'
    }
  ],
  [
    'selector/comma-list-interpolation',
    {
      summary: 'Comma-list value in a selector',
      reason:
        'The value interpolated into selector "${selector}" is a comma-separated list; a list can\'t be spliced into a selector position.',
      fix: 'Use each() to distribute a rule over a list instead of interpolating the list into the selector.'
    }
  ],
  [
    'plugin/function-threw',
    {
      summary: 'Plugin function "${name}" threw',
      reason:
        'The @plugin function "${name}" failed while evaluating this call: ${reason}',
      fix: 'Fix the plugin function (its stack is attached), or stop calling it here. Run with breakOnError to stop at the first failure.'
    }
  ],
  [
    'eval/async-in-sync-position',
    {
      summary: 'Value needs to be awaited in a position that cannot wait',
      reason:
        'The ${where} still requires an already-settled value, but this one resolves asynchronously (typically a function call that returns a promise).',
      fix: 'Bind the value to a variable evaluated outside this position, or call the mixin directly instead of through a namespace path.'
    }
  ],
  [
    'plugin/load-failed',
    {
      /*
       * The summary carries the underlying failure verbatim: a load error is only
       * actionable if it says WHY, and the summary is what a thrown error's
       * message shows.
       */
      summary: 'Plugin "${specifier}" could not be loaded: ${reason}',
      reason: 'Loading the @plugin failed: ${reason}',
      fix: 'Check the plugin path and that the script runs without throwing at load time.'
    }
  ],
  [
    'plugin/log',
    {
      summary: 'Plugin function "${name}" reported a problem',
      reason: '${level}: ${message}',
      fix: 'Address what the plugin reported, or stop calling it here.'
    }
  ]
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
  return s.replace(/\$\{(\w+)\}/g, (_: string, k: string) =>
    String(meta[k] ?? `<${k}>`)
  );
}

/**
 * Per-category presentation overrides. A code listed here pins its display tier
 * regardless of the severity default (e.g. promote an easy-to-miss warning to a
 * full code frame). Codes with no entry fall back to the severity default.
 */
const DISPLAY_OVERRIDES = new Map<string, DiagnosticDisplay>([
  /*
   * A comma-list spliced into a selector is subtle enough to always warrant the
   * full frame, even though it is only a warning.
   */
  ['selector/comma-list-interpolation', 'frame']
]);

/** The pinned display tier for a diagnostic `code`, if any. */
export function displayOverrideFor(
  code: string
): DiagnosticDisplay | undefined {
  return DISPLAY_OVERRIDES.get(code);
}
