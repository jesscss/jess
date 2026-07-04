/**
 * Exportable Jess grammar fragment — the delta on top of the SCSS grammar.
 *
 * Spread AFTER `lessGrammarRules` and `scssGrammarRules` in a consumer's
 * `rules()` map. Jess-specific rules (`$-if`, mixins, `@-compose`, etc.) will
 * be added here as the functional grammar matures.
 *
 * Macro-neutral: imports `'parseman'` without `with { type: 'macro' }`.
 */
export type JessGrammarDeps = { build: (type: string, c: any, r: any, s: any) => any };

/**
 * Jess-specific rule overrides and additions. Currently a no-op scaffold —
 * the composed Less + SCSS grammar is sufficient for basic Jess round-tripping
 * until control-flow and mixin syntax are ported to typed AST nodes.
 */
export const jessGrammarRules = (_g: any, _deps: JessGrammarDeps) => ({});
