# CSS-fold Phase A — §8.1b rename mapping

Recorded 2026-07-25 on the worktree `codex/css-phase-a-lean` (off `dev` @
`31236bd5e`). This file is the up-front §8.1b deliverable for Stage 3 Phase A
(the CSS pilot), per GRAMMAR-REBUILD-SPEC §8.1b and the Phase A task brief.

## Verdict — output-neutral, NO rename mapping needed

The Phase A edit is **byte-identical on both oracle aggregates** — `aggAst`
(`d436f6e07d267ffad4bfdd06dfa363ad170b64985e1a5c6aef0fcd21d84b290a`, threw=119)
and `aggCst` (`48e1e9dc0b80b8acae3f9adcb723243cf66a94da288634f81863f708093c3b27`,
threw=0) — against the committed floor
`packages/syntax/less/less-parser/test/oracle-byte-identity.baseline.json`. No
rule was renamed, so the rename-mapping residue is trivially EMPTY.

Formally, the §8.1b mapping table for this commit is:

| surface | renamed rules | residue after applying |
|---|---|---|
| AST (`parse()` over `less-parser`, aggAst) | — none — | EMPTY (output-neutral) |
| CST (`parseLessCst()`, aggCst) | — none — | EMPTY (output-neutral) |

## Scope of the edit

This Phase A pass touched only the two grammar files in
`packages/syntax/css/css-parser/src/`:

1. `src/grammar.ts` (the CST grammar) — replaced the untyped `(g: any)`
   factory parameter with a properly typed `CssGrammarSelf` interface
   (`Combinator<unknown>` per cross-referenced rule). This is the one
   `lint:absolute` `: any` violation the task brief required fixed; it does
   not change any recognition rule, so the CST aggregate is byte-identical.
2. `src/ast/grammar.ts` (the AST grammar) — removed the 102-line
   `CssAstLocalRules` typed-declaration interface (the 97-row reducer-noise
   floor per CSS-FOLD-DIAGNOSIS §"reducer noise class a"), dropped the 27
   redundant `<Type>` generics on `node<…>(…)` calls (the build callback's
   return type is inferred instead), and dropped the now-unused `Combinator`
   import. Recognition, the `node('Name', …)` rule keys, and every `build`
   reducer body are unchanged — so the CSS parser's AST output (verified by
   the 242-test css-parser suite) and the LESS parser's byte-identity oracle
   are byte-identical.

Phase B (the single-factory collapse with `hostMode`) is explicitly out of
scope for Phase A and is not started here.
