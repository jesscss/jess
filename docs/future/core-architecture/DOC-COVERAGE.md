# 3-Location Documentation Coverage Matrix

Enforces the owner's **3-location documentation rule**: every decided feature (and,
per the scope expansion, every language feature + built-in function) should exist in
all three places:

1. **In-code JSDoc** — on the implementing node / function / parser rule.
2. **Internal design doc** — a `docs/future/core-architecture/**` design doc or a
   `DESIGN-DECISIONS.md` row (or a `.cursor/rules/**` package rule).
3. **User-facing Docusaurus** — a page on the Less site (`packages/docs-content/docs/less`,
   `less` facing) and/or the Jess site (`.../docs/jess`, `jess` facing).

Legend: ✓ present · ~ partial/thin · ✗ gap · n/a not applicable.

This matrix is **read-only w.r.t. engine code**. Location-1 and location-2 gaps are
flagged for the feature agents to fill; this docs task only fills location 3.

---

## A. Decided v5 features (this session — priority)

| Feature | L1 JSDoc | L2 internal | L3 Less | L3 Jess |
|---|---|---|---|---|
| `collapseNesting:false` default (nested output) | ✓ `jess-plugin-less/src/index.ts` (`lessPluginDefaults`) | ✓ DD `O1` | ✓ `advanced/output-model` + `usage/migrating-to-v5` | ✓ `06-Advanced/01-output-model` |
| `:is()` selector compaction | ✓ `core/src/tree/util/extend.ts` | ✓ DD `O2`,`X3` | ✓ `advanced/output-model` | ✓ `06-Advanced/01-output-model` |
| `@media` not merged (v5) | ~ (implicit in nesting emit) | ✓ DD `O2` | ✓ `advanced/output-model` | ✓ `06-Advanced/01-output-model` |
| Extend `all` → `:is()` sub-span wrapping | ✓ `core/src/tree/util/extend.ts` | ✓ DD `X1`–`X9` (cites `EXTEND-SEMANTICS.md` †) | ✓ `advanced/extend-is-wrapping` (new) | ✓ `06-Advanced/05-extend` (new) |
| `+:` / `+_:` merge + LAST-occurrence anchor | ✓ `core/src/tree/util/spine-merge.ts` | ✓ DD `M1`–`M6` | ✓ `advanced/merge-anchoring` (new) + `features/merge` | ✓ `06-Advanced/04-merge` (new) |
| Verbatim / lazy-print of un-operated values | ~ (partial: `declaration.ts` mentions verbatim; no explicit rule on Dimension/Color serialize) | ✓ DD `V1`,`V2` (cites `VALUE-LITERAL-TAG-SPEC.md` †) | ✓ `advanced/verbatim-values` (new) | ✓ `06-Advanced/02-verbatim-values` (new) |
| `%()` → string-format lowering | ✓ parser grammar reduction (`%()` lowers to `string-format`) | ✓ DD `A5` (name OPEN) | ✓ `advanced/string-format` (new) | ✓ `06-Advanced/03-string-formatting` (new) |
| Backtick inline JS removed → `@use`/`@-use` | ~ (`import-js.ts` documents `@use` round-trip; no explicit "backtick removed" marker) | ✓ DD `A3` | ✓ `advanced/inline-javascript` (new) + `usage/migrating-to-v5` | ✓ `02-Language/04-atrules` (@use) + `06-Advanced/06-plugins` |
| Consolidated output-format + eval cheat sheet (STEP-0 for agents) | n/a | ✓ `V5-OUTPUT-SEMANTICS.md` + DD `F1`–`F5`,`V3`,`R9`,`P7`,`P8`,`A7` | ✓ `advanced/output-and-eval-cheatsheet` (new) | ✓ `06-Advanced/07-output-and-eval-cheatsheet` (new) |
| Operators/separators spaced (`12px/16px`→`12px / 16px`) | ✓ `ast/value-eval.ts` (`sepGlue`) + `ast/serialize.ts` `Operation` fallback | ✓ DD `F1` | ✓ `advanced/value-formatting` (new) | ✓ `06-Advanced/08-value-formatting` (new) |
| Comma value-list normalization (`, `; newlines preserved) | ✓ `ast/value-eval.ts` (`sepGlue`) | ✓ DD `F1` · `V5-OUTPUT-SEMANTICS.md` A2 | ✓ `advanced/value-formatting` (new) | ✓ `06-Advanced/08-value-formatting` (new) |
| `:nth-*()` `An+B` unspaced exception | ~ | ✓ DD `F2` | ✓ `advanced/value-formatting` (new) | ✓ `06-Advanced/08-value-formatting` (new) |
| Function-shape verbatim vs grouping-paren dissolve | ~ | ✓ DD `F3`,`F4` | ✓ `advanced/verbatim-values` (§ added) + cheat sheet | ✓ `06-Advanced/02-verbatim-values` (§ added) + cheat sheet |
| Un-operated `rgb`/`hsl` = bare verbatim Call | ✓ `ast/color.ts` (`serializeColor` `c.node` wins) | ✓ DD `F5`,`V2` | ✓ `advanced/verbatim-values` (§ added) + cheat sheet | ✓ `06-Advanced/02-verbatim-values` (§ added) + cheat sheet |
| Compact `:is()` nesting-collapse (prefix-factored) | ✓ `ast/serialize.ts` (`wrapIsList`/`isPrefix`) | ✓ DD `O2`,`X3` · `V5-OUTPUT-SEMANTICS.md` A7 | ✓ `advanced/selector-compaction` (new) | ✓ `06-Advanced/09-selector-compaction` (new) |
| Number precision (8dp values; full-precision interp) | ✓ `ast/serialize-value.ts` (`serializeDimension`/`emitValueInterp`) + `ast/literal-tag.ts` | ✓ `V5-OUTPUT-SEMANTICS.md` A1 | ✓ `advanced/number-precision` (new) | ✓ `06-Advanced/10-number-precision` (new) |
| Alpha colors → `rgba`; alpha-hex preserved; gamut clamp | ✓ `ast/color.ts` (`serializeColor`/`toHex`/`clamp`) | ✓ DD `V2` · `V5-OUTPUT-SEMANTICS.md` A6 | ✓ `advanced/color-output` (new) | ✓ `06-Advanced/11-color-output` (new) |
| Escaped `~"..."` opaque comparison | ~ | ✓ DD `V3` | ~ (cheat sheet) | ~ (cheat sheet) |
| Mixin var-unlock low-priority leak | ~ | ✓ DD `R9` | ✗ | ~ (cheat sheet) |
| Bare `@var` in at-rule prelude = error | ~ | ✓ DD `P7` | ~ (cheat sheet) | ~ (cheat sheet) |
| `if()`/`boolean()` branch-laziness | ~ | ✓ DD `P8` | ~ (cheat sheet) | ~ (cheat sheet) |
| `@import (reference)` per-branch visibility | ~ | ✓ DD `A7` | ~ (cheat sheet) | ~ (cheat sheet) |

† The DESIGN-DECISIONS rows cite detail docs (`EXTEND-SEMANTICS.md`,
`VALUE-LITERAL-TAG-SPEC.md`, `VARIABLE-RESOLUTION-SEMANTICS.md`,
`RESOLVER-SHAPE-SPEC.md`) that are **not present** in this worktree's
`docs/future/core-architecture/` tree — see gap G5.

## B. Core language features

| Feature | L1 JSDoc | L2 internal | L3 Less | L3 Jess |
|---|---|---|---|---|
| Variables (live `$`, scoped/final `$$`, `:=`, member access) | ~ | ✓ DD `R1`–`R7` | ✓ `features/variables` | ✓ `02-Language/02-variables` |
| Mixins (parametric, guards, loops, aliasing, as-functions) | ~ | ~ | ✓ `features/mixins*` (7 pages) | ✓ `02-Language/05-mixins`, `03-Features/05-mixins` |
| Nesting / parent selectors (`&`, `&-1`, `&()`) | ~ | ✓ DD `O1` | ✓ `features/nested`, `features/parent-selectors` | ✓ `03-Features/02-nesting` |
| Selector capture | ~ | n/a | ✓ `features/selector-capture` (shared) | ✓ shared `15-selector-capture` |
| Imports (`@import`) | ~ | ✓ DD `A1`,`A2` | ✓ `features/imports` | ✓ `02-Language/04-atrules` |
| Modules (`@use`/`@compose`/`@forward`/`@-*`) | ~ | ✓ DD `A1`,`A2`,`A4` | ✓ `features/modules-and-imports` (shared) | ✓ `02-Language/04-atrules` |
| Extend (base `:extend` / `$extend`) | ✓ `extend.ts` | ✓ DD `X1`–`X9` | ✓ `features/extend` | ✓ `02-Language/05a-advanced-extend` |
| Maps / namespaces | ~ | n/a | ✓ `features/maps` | ✓ `02-Language/10-namespaces-and-maps` |
| Merge (base) | ✓ `spine-merge.ts` | ✓ DD `M1`–`M6` | ✓ `features/merge` | ✓ `06-Advanced/04-merge` (new) |
| Scope | ~ | ✓ DD `R2`,`R6` | ✓ `features/scope` | ~ (in variables) |
| Comments | n/a | n/a | ✓ `features/comments` | ~ |
| Guards (css-guards / mixin-guards / conditions) | ~ | ✓ DD `P3` | ✓ `features/css-guards`, `features/mixin-guards` | ✓ `02-Language/07-conditionals-iteration` |
| Detached rulesets | ~ | n/a | ✓ `features/detached-rulesets` | ~ |
| Operations / math mode | ~ | ✓ DD `P1` | ✓ `features/strictmath` | ✓ `02-Language/03-expressions` |
| Interpolation | ~ | ✓ DD `P2` + `TIER-B-INTERPOLATION-GRAMMAR-SPEC.md` | ~ (scattered) | ✓ `02-Language/08-interpolation` |
| Iteration (`each`, ranges) | ~ | ✓ DD `P3` | ~ | ✓ `02-Language/07-conditionals-iteration` |
| Values & types | ~ | ✓ DD `V1`,`V2` | ~ | ✓ `02-Language/09-values-and-types` |
| Custom props / unknown at-rules (permissive) | ~ | ✓ DD `P2` | ✗ | ~ |
| Plugin API (register language + extend parsers) | ~ (`plugin.ts` `PluginInterface` JSDoc) | ✓ DD `D1` | n/a (Jess-facing) | ✓ `06-Advanced/06-plugins` (new) |

## C. Built-in functions (`@jesscss/fns`, ~83 registered)

Per-function **JSDoc coverage is now broadly complete**: every registered Less fn
source file carries a JSDoc block (one-line summary + `@param`/`@returns`, plus a
Less-builtin / spec reference where one cleanly applies). Location 3 exists on the
**Less** site for every category and, as of this pass, on the **Jess** site too.

| Category | L1 JSDoc (per-fn) | L2 internal | L3 Less | L3 Jess |
|---|---|---|---|---|
| Math (`abs ceil floor round mod pow sqrt sin cos tan …`) | ✓ | ✓ `.cursor/rules/packages/fns.mdc` | ✓ `functions/math-functions` | ✓ `04-Functions/08-math` |
| Logical (`if iif boolean not and or`) | ✓ | ✓ | ✓ `functions/logical-functions` | ✓ `04-Functions/07-logical` |
| String (`e escape replace format`) | ✓ | ✓ | ✓ `functions/string-functions` | ✓ `04-Functions/09-string` (new) |
| List (`length extract range each`) | ✓ | ✓ | ✓ `functions/list-functions` | ✓ `04-Functions/06-list` |
| Type (`iscolor isnumber isstring ispixel isunit …`) | ✓ | ✓ | ✓ `functions/type-functions` | ✓ `04-Functions/10-type` (new) |
| Misc (`unit get-unit isdefined isruleset convert data-uri image-* svg-gradient`) | ✓ | ✓ | ✓ `functions/misc-functions` | ✓ `04-Functions/11-misc` (new) |
| Color definition (`rgb rgba hsl hsla hsv argb color`) | ✓ | ✓ | ✓ `functions/color-definition` | ✓ `04-Functions/02-color-definition` |
| Color channel (`hue saturation lightness red green blue alpha luma …`) | ✓ | ✓ | ✓ `functions/color-channel` | ✓ `04-Functions/03-color-channel` |
| Color operations (`saturate lighten darken fade spin mix tint shade …`) | ✓ | ✓ | ✓ `functions/color-operations` | ✓ `04-Functions/04-color-operations` |
| Color blending (`multiply screen overlay softlight hardlight difference …`) | ✓ | ✓ | ✓ `functions/color-blending` | ✓ `04-Functions/05-color-blending` |

---

## Ranked gap backlog (docs debt, highest value first)

Rows above marked ✗/~ roll up into this backlog. "Owner" = who should close it.

| # | Gap | Location | Owner | Notes |
|---|---|---|---|---|
| ~~G1~~ | ✅ **CLOSED** — every registered Less fn source file now has a JSDoc block (`@param`/`@returns` + Less-builtin/spec note). 75 fns documented across 67 files (plus the `math-factory` helpers); `mathv1.ts` is dead commented-out code, left as-is. | L1 | done | `packages/fns/src/less/**`. fns `pnpm build` (tsc) + 526 tests green. |
| ~~G2~~ | ✅ **CLOSED** — added the 3 missing Jess function pages (`04-Functions/09-string`, `10-type`, `11-misc`) mirroring the Less pages with Jess import framing. Jess sidebar is autogenerated. | L3 Jess | done | Jess Docusaurus build green (no broken links). |
| G3 | **Verbatim-values rule not asserted in code JSDoc** on the value serialize path (Dimension/Color). Only `declaration.ts` mentions "verbatim" tangentially. | L1 | core value agent | DD `V1`/`V2` is the ruling; add a JSDoc pointer on the un-operated-vs-computed serialize branch. |
| G4 | **Backtick-removal has no explicit in-code marker** at the parse site (only `@use` round-trip is documented). | L1 | parser agent | A one-line JSDoc/error note where backtick JS used to parse would make DD `A3` discoverable. |
| G5 | **Internal detail docs cited by DESIGN-DECISIONS are absent from this worktree**: `EXTEND-SEMANTICS.md`, `VALUE-LITERAL-TAG-SPEC.md`, `VARIABLE-RESOLUTION-SEMANTICS.md`, `RESOLVER-SHAPE-SPEC.md`. | L2 | core-arch owner | DD rows stand alone as the ruling, but the deep-detail L2 tier is a dangling reference — either restore the docs or drop the citations. |
| G6 | **`%()` runtime function public NAME unresolved** (DD `A5`: not `format`, not `sprintf`; `str-format` proposed). | L1/L3 | owner decision | The new Less/Jess string-format pages document the syntax but cannot name the function; finalize then update both pages. |
| G7 | **Less-site coverage thin for newer language constructs**: interpolation, iteration, values-and-types, namespaces, custom-prop/unknown-at-rule permissiveness, the `@-` at-rule family. Strong on the Jess site, scattered/absent on Less. | L3 Less | docs | Candidate follow-up Advanced/Language pages on the Less site. |
| G8 | **Mixin internals (parametric/guards/loops/aliasing/as-functions) lack an internal design doc** — only user docs + code. | L2 | core agent | Fine for now; note if mixin semantics get re-specified for v5. |
| G9 | **No dedicated Sass+ docs surface for a dialect cheat sheet.** The output/eval cheat sheet ships on the Less site (`advanced/output-and-eval-cheatsheet`) and the Jess site (`06-Advanced/07-output-and-eval-cheatsheet`). Sass+ has only the shared `04-guides/02-coming-from-sass/*` pages (incl. `03-stricter-than-sass.mdx`), no per-dialect Advanced cheat sheet. The Jess cheat sheet notes the Sass+ `#{}` interp + reject-invalid-CSS rules inline as a stopgap. | L3 Sass+ | docs | If/when a Sass+ dialect docs surface exists, add a mirror page; until then the shared guide + Jess-page note cover it. |

## Maintenance

- When a feature agent adds L1 JSDoc or an L2 design doc, flip the cell here.
- When the owner finalizes the `%()` runtime name (G6), update
  `less/advanced/string-format.md` and `jess/06-Advanced/03-string-formatting.md`.
- New user-facing pages must set `audiences:` frontmatter and (for the Less site)
  be wired into `packages/docs-content/sidebars/less.js`; the Jess sidebar is
  autogenerated from the directory tree.
