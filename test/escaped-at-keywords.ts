/**
 * Escaped at-keywords, shared by the four dialect parser suites so the dialects
 * are held to one expectation.
 *
 * css-syntax-3 §4.3.11 consumes a valid escape (§4.3.8) into the identifier it
 * follows, and a hex escape also consumes one following whitespace. So
 * `@page\61` is the one at-keyword `@pagea`, never `@page` followed by `\61`,
 * and in `@counter-style\61 x` the `x` is still part of the name. None of these
 * names is a typed at-rule, so each must parse as an ordinary at-rule whose
 * name is the whole escaped identifier as authored.
 * @see https://drafts.csswg.org/css-syntax-3/#consume-name
 */
export const ESCAPED_AT_KEYWORDS: ReadonlyArray<readonly [source: string, name: string]> = [
  ['@counter-style\\61 x { a: b; }', '@counter-style\\61 x'],
  ['@scope\\61 (.a) { .b { c: d; } }', '@scope\\61 '],
  ['@property\\61 x { a: b; }', '@property\\61 x'],
  ['@font-face\\61 { a: b; }', '@font-face\\61 '],
  ['@charset\\61 "x";', '@charset\\61 '],
  ['@import\\61 "x";', '@import\\61 '],
  ['@media\\61 x { a { b: c; } }', '@media\\61 x'],
  ['@supports\\61 x { a { b: c; } }', '@supports\\61 x'],
  ['@keyframes\\61 x { from { a: b; } }', '@keyframes\\61 x'],
  ['@layer\\61 x { a { b: c; } }', '@layer\\61 x'],
  ['@page\\61 { a: b; }', '@page\\61 '],
  ['@debug\\61 x;', '@debug\\61 x'],
  ['@while\\61 x { a { b: c; } }', '@while\\61 x'],
  ['@-use\\61 "x";', '@-use\\61 '],
  ['@-compose\\61 "x";', '@-compose\\61 ']
];

/** The name of the single at-rule a stylesheet parsed to, or what it parsed to instead. */
export function atRuleName(stylesheet: { readonly rules: readonly unknown[] }): unknown {
  const [rule] = stylesheet.rules;
  if (stylesheet.rules.length === 1 && typeof rule === 'object' && rule !== null && 'type' in rule && 'name' in rule
    && (rule.type === 'AtRuleBlock' || rule.type === 'AtRuleStatement' || rule.type === 'UnknownAtRuleBlock')) {
    return rule.name;
  }
  return stylesheet.rules;
}
