/**
 * JessGrammar — Parséman-based Jess parser, extending ScssGrammar.
 *
 * The inheritance chain is: CssParser → LessGrammar → ScssGrammar → JessGrammar.
 *
 * Jess is a CSS superset that extends SCSS with:
 *   - `@-compose`, `@-from`, `@-export` at-rules
 *   - Control flow: `$if`, `$for`, `$while` (keyword forms)
 *   - Mixin definitions and calls
 *   - `$()` expression context
 *
 * Status: **scaffold** — inherits full CSS + Less + SCSS parsing from
 * ScssGrammar. Jess-specific control flow (`$if`, `$for`, etc.) and mixin
 * syntax are not yet parsed into typed AST nodes; they fall through to the
 * `unknown` catch-all or produce generic Reference/Declaration nodes.
 * This is sufficient for tooling that only needs to round-trip basic Jess
 * syntax. Full Jess-specific AST nodes will be added in a future iteration.
 */

import { ScssGrammar } from '@jesscss/scss-parser';

// ---------------------------------------------------------------------------
// JessGrammar
// ---------------------------------------------------------------------------

export class JessGrammar extends ScssGrammar {
  // All CSS, Less, and SCSS rules inherited from the chain.
  //
  // Jess-specific features like `@-compose` / `@-from` / `@-export` are
  // handled by CssParser's generic AtRuleBlock / AtRuleStatement rules since
  // they follow standard at-rule syntax.
  //
  // Future additions here:
  //   - Override `declarationList` to recognise `$if { } $else { }` blocks
  //   - Add `JessControl` rule for control flow nodes (If, For, While)
  //   - Add `JessMixin` rule for mixin definitions and calls
}
