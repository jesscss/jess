# Design decisions — implementation notes

Implementation state for rows of the owner decision ledger,
[`DESIGN-DECISIONS.md`](DESIGN-DECISIONS.md): what landed where, which tests
pin it, what is still pending, and agent observations. One `## <row id>`
section per row, newest note last, each dated.

This file exists so the owner's rows stay the owner's words. Owner-ruled rows
are hash-locked (`owner-rulings.lock.json`, checked by
`pnpm check:guardrails`), so a note appended to one fails the gate. Write the
note here instead.

A note records state and evidence. It never restates, narrows or amends the
ruling, and Less 4.x / lessc output is not a reason for anything written here.
When the code disagrees with a ruling, record the disagreement here and
escalate it to the owner.

Existing notes inside owner rows have not been moved yet, except the rows the 2026-10-09 integration (`integ/v5-wave10`) changed: their agent text is below.

<!-- Format:

## P2

- 2026-10-09 (`<commit>`): <what landed, where, which test pins it>.

-->

## J6

- 2026-10-09 — implementation note, moved from the row: **Fixed (2026-10-05, `lane/v5-4-serialize-eval`):** early publication does not count as a load (a nested `set` compose it was observed on is now the not-top-level error, owner 2026-10-09).

## J13

- 2026-10-09 — agent rationale, moved from the row (the clause is now attributed to the owner's 2026-10-09 words): The owner's 2026-07-23/24 rule is that a `&` glued to a name is Less concatenation, not CSS nesting: CSS nesting reads `.block { &__el {} }` as `&` then the type selector `__el`, and a browser drops `&-1`, so the authored form is silently dead CSS.

## J16

- 2026-10-09 — implementation note, moved from the row: The text value carries the group in its `groups` field (`value-eval.ts` `Any.groups`; `emitValue`/`writtenText` write it, `readText` reads without it).

- 2026-10-09 — agent judgment 2026-10-09, awaiting owner (the SCSS reading has no owner words): A `.scss` unquoted string is text inside a calculation and, from a call in a group that math reads, outside one (`(unquote("1px + 2px")) * 2` → `calc((1px + 2px) * 2)`); its group is written only in math, and any other `.scss` keyword in a group is an identifier (`(foo) * 2` stays `(foo) * 2`, `$g * 2` with `$g: (foo)` is `foo * 2`).

## X7

- 2026-10-09 — implementation note, moved from the row: **Note (2026-10-09):** a lone `@{list}` of escaped text used as an extender (`@s: ~".q, .w"; @{s}:extend(.z) {}`) was skipped in the root sheet while an imported sheet or a mixin applied it; text now prints as written (owner 2026-10-09, O8 amended), so it appends its text as one branch (`.z,` / `.q, .w`) in all three placements.

## O8

- 2026-10-09 — implementation note, moved from the row: Implementation: `serialize.ts` `refGroupInterp` (only a `*[…]` capture is a group).

- 2026-10-09 — golden bookkeeping, moved from the row: The parse-interpolation edits the owner accepted 2026-10-09 are registered in `pending-golden-edits.ts`.

## N11

- 2026-10-09 — implementation (the owner row's premise that a hoisted `@charset` may come from an imported file): An imported sheet's `@charset` is now hoisted: the first document-level `@charset` in the output — the entry's, or one at the top level of a sheet an import places — is written at the very start. Before, an imported one was dropped: `@import "lib.less";` with lib starting `@charset "UTF-8";` wrote none. Code: `serialize.ts` `emitHoistedCharset` (reserves the top chunk), `hoistCharsets`; pin `packages/jess/test/less/import-charset.test.ts`.

- 2026-10-09 — agent judgment 2026-10-09, awaiting owner: A later `@charset` written the same is dropped; a later one naming another encoding is dropped with an `eval/charset-conflict` warning, since one output stylesheet declares one encoding (CSS Syntax 3 §3.2) and a silent drop is surprising. A `(reference)` sheet's `@charset` is not hoisted.

## N17

- 2026-10-09 — implementation note, moved from the row: The parser records the fact as structure: the shared `QueryNot` / `QueryAndOr` tokens are `<ident-token>`s that never match a glued `(`, a glued `and(` / `or(` after a condition operand is one more operand (`QueryGluedConnective`), and the glued call carries its span. The condition emitter warns on that call, never by reading bytes, and the query normalizer no longer turns `and(` into `and (`.

- 2026-10-09 — agent judgment 2026-10-09, awaiting owner (scope of the warning): **Exempt:** conditions the compiler evaluates and never writes — Less guards (`when (@a) and(@b)`, `when not(@a)`), `if()` / `boolean()` arguments, Sass `@if` and `not()`, `.jess` guards and `$if` — keep reading `and(` / `not(` as the keyword before a group (`LogicalNot` / `LogicalAnd` / `LogicalOr`) and do not warn. **Not covered (no structure to warn from):** the raw-text `@import` tail in css, Less and `.jess`, and `@custom-media`, are written as authored without a warning; so is a glued keyword among the component values of a media `<general-enclosed>` group (`@media ((a) and(b))`).

## P2

- 2026-10-09 — history, moved from the row: **Restored 2026-10-09 (`fix/v5-custom-property-literal`):** 849d09a1b (2026-07-27) had made the Less custom-property value read a bare `@var` as a variable, so `@c: red; --x: @c` gave `--x: red` and `--x: @nope` was an eval error; the owner reaffirmed this row on 2026-10-09.

- 2026-10-09 — implementation note, moved from the row: Less grammar `CustomPart`/`CustomInnerPart` read a bare `@name` through the parser-shared `CustomValueAtName` leaf.

- 2026-10-09 — implementation note, moved from the row: The fallback keeps its own production (less grammar `VarFallbackPart`/`VarFallbackInnerPart`/`VarFallbackGroup`), unchanged in behaviour from before this fix: variable reads and `@{…}` resolve, and nothing computes.

- 2026-10-09 — state and fixture bookkeeping, moved from the row (the fixture-source decision was relayed from the owner 2026-10-09; no verbatim words in tree): Valid CSS `--x: @c` now emits the same bytes in all four dialects (SEMANTIC-INVARIANTS 4). Pinned in `packages/jess/test/custom-property-literal.test.ts`; the two fixtures that wrote a bare `@var` in a custom property move their SOURCES to the v5 spelling `@{var}` and keep their goldens' real values (owner 2026-10-09): bootstrap4 through the `bootstrap-less-port` patch (`_root.less`), `tests-config/namespacing/namespacing-8` through the less.js fork test-data, with a temporary edit in `packages/jess/test/less/pending-golden-edits.ts` until that lands. SCSS (`#{}` only) and `.jess` (`${}` only) already kept a bare variable literal.

## P46

- 2026-10-09 — the implementing lane's statement of the rule, moved from the row (agent text): A `;` in a Less mixin argument or parameter list makes every `,` in that list a comma-list comma. When a call or definition list holds any `;` separator (a trailing one included), `;` separates its arguments and every `,`, before or after the `;`, belongs to a comma-list value; with no `;`, `,` separates arguments as before. A named argument's value is the comma list of its group: `.m(@a: d, e; @b: f)` gives `@a` = `d, e`; a definition default `@m: 2, 2, 2, 2;` is one value. Storage, owner 2026-10-09: the AST holds the NORMALIZED form, the node `~( … )` builds (`Block` `paren`, `escaped`, around the `List`), so `.m(@a: d, e; @b: f)` parses to exactly what `.m(@a: ~(d, e), @b: f)` does and the separator mode never reaches the AST. Parse, owner 2026-10-09: the list is read forward once as items and separator tokens, and the reducer reassembles it when the list ends (`reassembleMixinInterior`); an item that only a `;` makes invalid raises at its own position, the first in source order, and the tolerant CST reports every one.

- 2026-10-09 — agent judgment 2026-10-09, awaiting owner (consequences the implementing lane chose): (a) in a `;` list a `@name:` may only start its comma run, and a spread or rest (`@x...`, `...`) cannot be part of a run of two or more items, though it stands alone between `;` (`.m(0; @x...)`); both are `parse/invalid-mixin-argument`; (b) a definition run that does not start with `@name:` is a pattern, so `.m(@a, @b; @c)` is a `~(@a, @b)` pattern and `@c`; (c) value-position calls (`@r: .m(…)`, `@dr(…)`, `each(.m(), …)`) read the same items as statement calls, so a spread of a non-variable value (`.m(foo...)`), never accepted in a statement call, is no longer accepted there either. `.jess` has no spelling yet for the `~( … )` node, so the `.less` → `.jess` converter names that gap for these lists.

- 2026-10-09 — OPEN, escalated to the owner (evaluator): a guard orders two `~( … )` lists by their bytes, so `.generic(a, b, c; a, b, d)` now matches `when (@a < @b)`, as `.generic(~(a, b, c), ~(a, b, d))` and two lists bound to variables already did; `tests-unit/mixins-guards/mixins-guards.less` is an expected failure until that is decided.

## A11

- 2026-10-09 — implementation note, moved from the row: Less no longer writes `@page Test:first` (golden `media.css`) or `@page :left:blank` with a space before each pseudo-page — a glued run is one header atom — and `.jess` no longer rewrites `@page wide :left` to `wide:left`: its header is the authored bytes of its span.

## A18

- 2026-10-09 — implementation note, moved from the row: The option is not on a Jess-native surface (`input` entries); the Jess-only `'error'` value is gone. The less.js wrapper accepts `strictImports` and `lessc --strict-imports` and passes them through.
