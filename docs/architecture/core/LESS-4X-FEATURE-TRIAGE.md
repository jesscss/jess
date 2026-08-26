# Less 4.x feature triage

**What this is.** A feature-by-feature inventory of Less 4.x measured against
jess, derived from **Less 4.x itself** rather than from what jess happens to
implement. It exists because fixture pass/fail cannot see a feature nobody
wrote a fixture for: `all-less` being nearly green proves the corpus is nearly
green and says nothing about coverage.

**What this is not.** Not a status tracker, not a burndown, not a plan. Each row
is a measurement with a reproduction. Re-measure before relying on any row.

---

## 0. Provenance — what was measured, where, and when

| Fact | Value |
| --- | --- |
| jess commit measured | `74b9fcb4dd4ad6e3ea643e1d7bd8e92601c36a51` (`origin/dev` at the time of measurement, 2026-07-30). **`origin/dev` moved by four commits while this was being written, one of them `75002c4a3 build(deps): raise the parseman floor to ^0.45.0` — a parser-floor bump that could move the §4.5 and §4.1 parse rows. Re-measure those two before acting on them.** |
| Build | full `pnpm run build:release` in a dedicated worktree; no partial build |
| Less 4.x reference | `~/git/worktrees/less.js/less-4x` @ `97ddc62d` = `v4.8.1-9-g97ddc62d`; `git status` clean apart from two untracked benchmark files |
| Corpus (`all-less` reads this) | `~/git/oss/less.js/packages/test-data` @ `2f309b667df0fed192c83e1b32b4a72f045798f4` — an **external, unpinned** checkout |
| Oracle used for every DIFF row | `node ~/git/worktrees/less.js/less-4x/packages/less/bin/lessc` reporting `lessc 4.8.1` — run directly, never through the v5 alpha wrapper |

**The v5 alpha package is not an oracle.** Its wrapper does
`import { Compiler } from 'jess'`, so agreeing with it is a tautology
(`DESIGN-DECISIONS.md` **E6**). Every "less4:" line below is real `lessc 4.8.1`.

**Correctness is the documented v5 design, not 4.x** (`DESIGN-DECISIONS.md`
**E5**). A diff against 4.x is evidence, never a verdict. Rows where v5
deliberately diverges are marked `DELIBERATE` with the ledger row that licenses
them.

### Status vocabulary

| Status | Meaning |
| --- | --- |
| `IMPLEMENTED` | reachable under the name/spelling a user writes, and behaviour matches 4.x (or the licensed v5 divergence) |
| `PARTIAL` | works in some positions/spellings and not others; the gap is named |
| `MISSING` | not reachable at all — parse error, or silently preserved verbatim |
| `BUG` | reachable, produces **wrong output with no diagnostic** |
| `DELIBERATE` | 4.x behaviour intentionally not carried into v5; ledger row cited |

### Method note — reachability, not existence

An implementation that exists but is not reachable under the name a user writes
is indistinguishable from a missing one from the outside. The Less function
registry keys on `fn.name` (`packages/core/src/ast/value-dispatch.ts:323,327`,
lower-cased), so a re-export can register the wrong key. Every function row
below was checked by **rendering Less source**, not by reading an index.

---

## 1. The seven declared work-in-progress areas — verified

The v5 alpha CHANGELOG (`~/git/oss/less.js/CHANGELOG.md`, `v5.0.0-alpha.1
(unreleased)`, @ `2f309b66`) lists seven WIP areas. **Three of the seven are
wrong.**

| # | Declared WIP | Verified status | Evidence |
| --- | --- | --- | --- |
| 1 | legacy plugin execution | **PARTIAL — function registration works, hooks do not** | `plugin.install?.(this.less, undefined, this.registry)` — `packages/syntax/less/jess-plugin-less-compat/src/less-api-bridge.ts:360`; the manager parameter is typed `undefined` at `:35`. `less.functions.functionRegistry.add/addMultiple` work (used by the `all-less` harness plugin, `packages/jess/test/less/all-less.test.ts:32-48`). `less.tree` exposes only `Dimension`, `Quoted`, `Color`, `Anonymous` (`less-api-bridge.ts:46-52`) against 4.x's full `tree` export. |
| 2 | file-manager and pre/post-processor hooks | **MISSING — confirmed, structurally unreachable** | `addVisitor` / `addPreProcessor` / `addPostProcessor` / `addFileManager` appear **nowhere in any source package** — only in two test files. Because the manager argument is `undefined` (row 1) there is no object to call them on. The four corresponding fixtures are skipped as "needs scope decision": `packages/jess/test/less/all-less.test.ts:145-149,161`. |
| 3 | source maps | **MISSING — confirmed** | `renderToResult(f, { outputFile })` with `output.sourceMap: true` returns keys `css,errors,warnings,loadedUrls` — no map of any kind, inline or external. Same with `sourceMapFileInline`. Nine `sourcemaps*` fixtures are skipped or expected-failures (`all-less.test.ts:152-159,214-229`). |
| 4 | URL rewriting options | **WRONG — these are IMPLEMENTED** | `output.rewriteUrls:'all'` on `@import "sub/inner.less"` gives `url("sub/rel.png")`, byte-identical to `lessc --rewrite-urls=all`. `output.rootpath:'/cdn/'` → `url("/cdn/img/a.png")` = `lessc --rootpath`. `output.urlArgs:'v=1'` → `url("img/a.png?v=1")` = `lessc --url-args`. **The options live in `output`, not `compile`** — passing them in `compile` is silently ignored, which is how this was mis-recorded. See §6. |
| 5 | compressed-output parity | **MISSING — confirmed** | `compress: true` in **either** `output` or `compile` returns fully expanded CSS. `lessc -x` gives `.x{background:url("img/a.png");color:red}`. Three compression fixtures skipped (`all-less.test.ts:141-144`). |
| 6 | browser compilation | **MISSING — confirmed, as declared** | `packages/jess/package.json` has no `browser` field, `exports` is `"."` + `"./package.json"` only, and no browser entry/bundle target exists in any package. |
| 7 | "the remaining long-tail Less 4 fixture corpus" | **Not a status — this is the admission §2-§5 replaces** | — |

**Also verified against the CHANGELOG's supported list and its stated quality
bar** ("Unsupported syntax should fail with filename, line, column, and source
context rather than raw parser offsets"): **MET**. Every diagnostic carries
`code, phase, message, reason, fix, filePath, line, column, endLine, endColumn,
lines`, and the renderer prints `file:line:col` with a source excerpt and caret.
One qualification: `resolve/*` diagnostics populate `filePath` but leave the
`file` object undefined, so a consumer reading `d.file.name` gets nothing where
a `parse/*` diagnostic would give a name. Not a gap in the bar as written.

---

## 2. Builtin functions — complete, name by name

> **Superseded on the count and the per-function detail** by
> [`../../state/less-4x-function-triage.md`](../../state/less-4x-function-triage.md)
> (landed `803b91c8a`, independently). It enumerates from the 4.x **runtime**
> registry — `functionRegistry.getLocalFunctions()`, **92** names — rather than
> by reading the source files, and calls every one of the 92 in user spelling
> under two configs. Prefer its numbers to this section's. The two lanes agree
> on the original `isurl` finding; V15 now resolves it. They differ on `style()`
> (reconciled in the row below), and this
> section adds two findings that lane did not have: the `style()` prelude
> position (below) and the now-fixed `desaturate()` achromatic bug (§4.6).

Less 4.x registers **89** names by source reading (every file in
`less-4x/packages/less/lib/less/functions/` read; registry is `addMultiple`
keyed by object key, lower-cased —
`less-4x/.../functions/function-registry.js:4,15`; registration site
`functions/index.js:21-32`; no `functionRegistry.add*` anywhere outside that
directory).

jess's Less dialect index registers **84** (enumerated at runtime via
`fnsOf(await import('@jesscss/fns/less'))`, not read off a file).

All names were checked by rendering one call per name through both engines — not
sampled, and not read off an index. The mutable parity count and per-function
status now live only in
[`../../state/less-4x-function-triage.md`](../../state/less-4x-function-triage.md).
This broader audit also found the formerly missing `style()` container-prelude
position; that parser gap is now fixed below.
`isurl` is fixed through the typed value domain under V15, and the achromatic
`desaturate()` defect originally found here is fixed under ledger V14 (§4.6).
The remaining colour-constructor differences are
deliberate under F1/F5/V4, while `isdefined`/`isruleset`/`extract`/`length`
surfaced the unrelated compact-property parser bug in §4.5.

### Function and position follow-up

| Name | Status | Evidence |
| --- | --- | --- |
| `isurl` | **FIXED / V15** | `.x { a: isurl(url(x)); b: isurl(1); }` now emits `a: true; b: false`. Typed evaluation projects the parser-owned `Url` AST wrapper to `UrlValue` only for a typed consumer; ordinary URL output stays on the prior string path, and url-shaped quoted/keyword/call bytes remain false. |
| `style` | **FIXED — function and container-query position** | In a declaration value, `style(@v)` remains an ordinary function call (`docs/state/less-4x-function-triage.md` §5). The Less grammar now also constructs typed container style queries: `@container style(--x: 1) { .y { c: 1 } }` and the named `@container card style(--x: 1) { … }` both parse and re-emit exactly. Parser coverage is in `ast-grammar.test.ts` and `cst-public.test.ts`; `scroll-state(...)` and ordinary size queries share the same public at-rule path. |

### The eight not in the fns registry that are nonetheless reachable

Checked individually because a registry diff alone would have called them
missing:

| Name | Reachable? | Evidence |
| --- | --- | --- |
| `if` | yes | `if((1 > 0), red, blue)` → `red` |
| `boolean` | yes | `boolean(1 > 0)` → `true` |
| `isdefined` | yes | `isdefined(@v)`/`isdefined(@nope)` → `true`/`false`; serializer branch `packages/core/src/ast/serialize.ts:4091` |
| `isruleset` | yes | → `true`/`false`; `serialize.ts:4101` |
| `default` | yes | guard machinery `packages/core/src/ast/guard.ts:34,137,152,176`; `.m(1){…} .m(@x) when (default()){…}` picks the fallback |
| `each` | yes | `each(@l, {…})` expands; also handles the `@{key}`/`@{value}`/`@{index}` bindings |
| `~` | yes (as syntax) | `~"raw"` → `raw` |
| `_SELF` / `@@name` | yes | `@n: col; @col: red; c: @@n` → `red` |

### Names jess has that Less 4.x does not

`image-size`, `image-width`, `image-height` (Less ships these as a plugin, not a
builtin) and `string-format` (the canonical name for `%()`, ledger **A5**).
Neither is a gap; recorded so a future diff does not read them as drift.

### Output differences on implemented functions — all DELIBERATE

`pi()` → jess `3.1415926536` vs less4 `3.14159265`; `luma(#333)` → jess
`3.310476657%` vs less4 `3.31047666%`. This is the settled v5 numeric-emit
policy (ledger **V4**: shortest decimal within relative `1e-10`, no
significant-figure cap), not a precision bug.

**One OPEN observation, not a ruling:** `round(1.45, 1)` → jess `1.5`, less4
`1.4`. Less 4.x uses `toFixed` (so it inherits the binary float representation
of `1.45`); jess rounds half-up. Both are defensible; **no ledger row governs
rounding mode for `round/2`.** Recorded for the owner, not adjudicated here.

---

## 3. Language features — measured, by area

Every row below was run through both engines. `SAME`/`DIFF` is normalized-
whitespace comparison of the two outputs (per the cross-engine rule, group
splitting and whitespace are not gaps).

### 3.1 Mixins — IMPLEMENTED

`.m;` · `.m();` · `#id;` · default params · named args · variadic `@rest...` ·
argument spread `.m(@l...)` · `@arguments` · pattern matching on literal params ·
`when` guards with `and`/`or`/`,`/`not` · type-predicate guards · `default()` ·
`!important` on a call · recursion · `#ns > .m()` · `#ns.m()` · `#a > #b > .m()` ·
guards on the namespace path · css guards (`.a when (…)`) · mixin closures ·
interpolated mixin names (both engines reject `.@{n}()` — parity) — **all SAME**.

### 3.2 Detached rulesets — IMPLEMENTED

Definition, `@dr()`, passing as a mixin argument, `@media` inside, definition-
site scope capture — all SAME.

### 3.3 Lookups and maps — IMPLEMENTED (one shared blocker, §4.1)

`@m[k]` · `@m[]` (last declaration) · `.m()[k]` · `#ns[k]` · `$prop` accessor ·
`@v()` variable call — all SAME. `@m[@var]`, `.m()[@var]`, `#ns[@var]` appear to
fail but do not: the parse error is §4.1 in the *definition*, not the lookup.
The grammar does carry `keyKind: 'var'`
(`packages/syntax/less/less-parser/src/grammar.ts:2387,2390`).

### 3.4 `:extend` — IMPLEMENTED

Selector position · body `&:extend(…)` · `all` · `!all` · extend list ·
chaining · inside `@media` · attribute targets · through `(reference)` imports —
all SAME **except** the shape of `all` propagation, which is the settled `:is()`
compaction (`DESIGN-DECISIONS.md` **O2**, `memory:v5-is-compaction-rule`):
less4 `.a .b, .z .b` vs jess `:is(.a, .z) .b`. `DELIBERATE`.

### 3.5 Operations and unit math — IMPLEMENTED

`+ - * /` · parens · unary negation · unit conversion (`1cm + 10mm` → `3cm`) ·
unit algebra and cancellation (`(4px * 3px) / 2px`) · dimension↔colour coercion ·
percentage math · `calc()` passthrough · CSS custom properties — all SAME.

Math modes: `output.math` — `always`, `parens-division`, `parens`/`strict` all
behave correctly. `output.strictUnits: true` on `1px + 2em` raises
`eval/invalid-unit-arithmetic`. Both **IMPLEMENTED** — see §6 for the placement
trap that made them look otherwise.

### 3.6 Escaping, strings, interpolation — IMPLEMENTED

`~"…"` · `e()` · `%()` and `string-format` · selector interpolation ·
property-name interpolation · string interpolation · `url()` interpolation ·
at-rule prelude interpolation (`@media @{n}`) · interpolated selector lists via
an escaped string · CSS identifier escapes (`.\31 23`) — all SAME.

### 3.7 Parent selector — IMPLEMENTED

`&-suffix` · `&&` · `& &` · `.p &` · `:not(&.a, &.b)` — SAME. `& + &` on a
selector list is `:is()`-compacted (**O2**, `DELIBERATE`).

### 3.8 Property merge — IMPLEMENTED

`+:` comma merge, `+_:` space merge, merge across an `@import`, merge with
`!important` — all SAME.

### 3.9 At-rules — IMPLEMENTED

`@media` bubbling · media variables · `not`/`only` · range syntax
(`400px < width < 700px`) · `@supports` · `@container` · `@layer` · `@keyframes`
with an interpolated name · `@namespace` · `@font-face` · `@charset` ·
`unicode-range` — all SAME.

`@media` **merging** of nested queries is not performed — settled **O2** (v5
does not merge `@media`). `DELIBERATE`.

### 3.10 Variables — IMPLEMENTED

Lazy evaluation · scope/frames · last-wins · `@@name` indirection · variables in
selectors, property names, urls, at-rule preludes and media queries — all SAME.

Bare `@var` in a non-value at-rule prelude is a **hard error** in v5 where 4.x
warned — settled **P7**. `DELIBERATE`; the two upstream fixtures that use the
bare form are kept running and asserted to fail (`all-less.test.ts:290-299`).

### 3.11 JavaScript evaluation — DELIBERATE

Backtick `` `expr` `` raises `parse/unsupported-inline-javascript: Inline
backtick JavaScript is not supported.` with file/line/column, **including with
`javascriptEnabled: true`**. This is ledger **A3** (removed entirely in v5, not
opt-in; the parser still recognizes it so migration tooling can point at
`@use`/`@-from`). Working as designed.

---

## 4. Gaps found that are on no list — the highest-value output

None of the six original findings below was in the CHANGELOG's WIP list,
`known-failures.json`, or the fixture corpus. Four are now fixed or deliberately
resolved; §4.5 remains a reproducible compact-source parser gap.

### 4.1 FIXED — a variable declaration cannot be the last statement in a block without a trailing `;`

Fixed in `a63d855f8`. `VarDeclaration` now ends on the same `declarationEnd`
terminator the property-declaration item already used, so all three value-map
forms below parse and render identically to `lessc` 4.8.1. Scope was fixed by
measuring 4.8.1 rather than by matching it wholesale: `@o: 3` at
end-of-stylesheet stays a parse error because 4.8.1 rejects it too, and the two
shapes 4.8.1 only "accepts" by mis-parsing (`.a { @o: 3 color: red; }`, and
`.a { @o: 3 b { x: 1 } }`, which emits a ruleset selected by `@o : 3 b`) stay
rejected under the settled unterminated-declaration ruling. Regression coverage
is in `packages/syntax/less/less-parser/test/public-parse.test.ts`; the
byte-identity oracle was unmoved on both surfaces including the error channel.
The original report follows.

```less
.a { @o: 3 }        →  jess: parse/invalid-value "Invalid value." (1:5)   less4: (empty, valid)
.a { @o: 3; }       →  SAME
.a { o: 3 }         →  SAME          ← property declarations tolerate it
```

Applies uniformly to plain rulesets, mixin definitions, detached rulesets and
namespaces, and therefore blocks every idiomatic value-map form:

```less
.m()  { @o: 3 }        .x { b: .m()[@o]; }    →  parse/invalid-value
@d: { @o: 3 };         .x { b: @d[@o]; }      →  parse/invalid-value
#n()  { @o: 3 }        .x { b: #n[@o]; }      →  parse/invalid-value
```

**Cause:** `VarDeclaration` requires a terminating `literal(';')` —
`packages/syntax/less/less-parser/src/grammar.ts:2726-2728`. Property
declarations do not. The asymmetry looks like an oversight rather than a ruling;
a final declaration with the semicolon omitted is valid in CSS and in Less. It
is unrelated to the settled "`;` is a separator" ruling, which is about an
unterminated declaration *before a nested rule*.

**Cost to fix:** make the trailing `;` optional at end-of-block in that one
production, matching the property-declaration rule. One production.

**Why no fixture caught it:** every upstream fixture that declares a variable in
a block writes the semicolon.

### 4.2 FIXED — `name=value` function arguments evaluated to `false`

```less
.x { filter: alpha(opacity=50); }   →  jess: filter: alpha(false)    less4: alpha(opacity=50)
.x { a: foo(bar=1); }               →  jess: a: foo(false)           less4: foo(bar=1)
```

The Less grammar now recognizes this as `FunctionAssignmentArgument`, ahead of
the comparison grammar, and preserves the authored assignment pair as one
opaque argument value. Both examples above now emit `opacity=50` / `bar=1`
rather than a boolean. This is generic, not IE-specific; exact parser and public
render coverage includes whitespace variants and non-`alpha` function names.

`progid:DXImageTransform…` is a hard `parse/syntax-error`; that one is covered by
the deliberate `ie-filters-REMOVED` removal (`all-less.test.ts:257-260`) and is
not filed here. The `name=value` argument form is not.

Less 4.x's dedicated `Assignment` node (`less-4x/.../tree/assignment.js`, parsed
at `.../parser/parser.js:715`) was evidence for the construct, not the v5
representation: v5 keeps the pair as authored bytes because its value is not
evaluated independently.

### 4.3 FIXED — `@import` option keywords leaked into emitted CSS

```less
@import (css) "imp-a";              →  jess: @import (css) "imp-a";      less4: @import "imp-a";
@import (optional) "nope";  .x{a:1} →  jess: @import (optional) "nope";  less4: (dropped entirely)
                                          .x { a: 1 }                            .x { a: 1 }
```

The parser now owns typed import options. A CSS-terminal import consumes `(css)`
without leaking it into the emitted at-rule, while an `(optional)` compile-time
import still attempts normal resolution and suppresses only a missing-file
failure. Existing files continue through the ordinary import path. Exact
optional-missing and optional-present coverage is in core's
`import-at-rule.test.ts`; Less parser CST coverage pins the option list.

### 4.4 DELIBERATE — a compile-time `@import` cannot carry a media query

```less
@import "imp-a" screen;
```
Less 4.x wraps the imported content in `@media screen { … }`. V5 deliberately
does not: under the settled §12.3b import rule, a postlude describes a linked CSS
resource, while a compile-time import splices a parsed document. Combining the
two is therefore a parse error. A plain CSS-terminal `@import "imp-a.css"
screen;` remains valid and re-emits its postlude. Public coverage and the owner-
maintained fixture disposition are in `import-media-query.test.ts` and
`all-less.test.ts` respectively.

### 4.5 BUG — `prop:fn(@var)` with no space after the property colon is a parse error

This remains a hard failure on ordinary compact Less 4.x source.

```less
@v: 1;
.x{a:ceil(@v)}     →  jess: parse/syntax-error        less4: a: 1
.x{a: ceil(@v)}    →  SAME                            ← one space fixes it
.x{a:ceil(1)}      →  SAME                            ← literal argument is fine
.x{a:@v}           →  SAME                            ← bare variable is fine
```

The trigger is exactly: **no whitespace between the property colon and a
function call whose argument list contains an `@variable`.** Isolated across the
whitespace matrix — leading space inside the brace, trailing space before the
brace, and a trailing `;` all still fail; only the space *after the colon*
matters. It is independent of argument count (`rgb(@v,2,3)`), of operators
inside the call (`ceil(@v + 1)`), and of which function is called.

Any minifier output, and a good deal of hand-written compact Less, hits this.

**V5-alpha qualification (re-measured 2026-08-25):** the owner alpha parser also
rejects the compact variable-bearing form while accepting the spaced form and
the compact literal form. In Jess, the standalone `Declaration` production
already parses `a:ceil(@v)`; the failure occurs only in a statement body, where
the selector-first route reads `a:ceil(` as a functional pseudo and Parseman's
selected dispatch branch commits when bare `@v` is invalid selector syntax.
Widening pseudo arguments would change the language, and speculative full
declaration/ruleset lookahead would parse the same source twice. This row needs
a left-factored declaration/ruleset design (or an owner/Parseman routing
decision), not a regex scan into the function body.

### 4.6 FIXED — `desaturate()` saturates an achromatic colour

```less
.x { a: desaturate(#888, 10%); }  →  before: #7c9494   current: #888888
.x { a: desaturate(#999, 10%); }  →  before: #8fa3a3   current: #999999
```

Desaturating a grey must be a no-op. The shared Less HSL adjustment kernel used
to write a negative saturation, and converting that invalid HSL value produced
a saturated teal. It now clamps the written saturation/lightness channel to the
normalized `[0, 1]` domain after either absolute or `relative` adjustment. Direct
tests pin both bounds across all four adjusters and the public compiler test pins
the two achromatic cases exactly. This was a non-corpus function gap, so no Less
fixture status changed.

### Also recorded

- **`isurl`** (§2) is fixed under V15; **`style()`** (§2) is reachable both as a
  function and as a typed container-query prelude.
- **`dumpLineNumbers`** has no effect in either option bucket. Less 4.x
  deprecates it and `packages/config/src/types.ts:225-229` marks it `@removed`,
  so this is consistent with intent — recorded, not filed.
- **`lint`**, **`insecure`**, **`strictImports`** are accepted by the options
  type and produce no observable behaviour change in the cases probed. **Not
  investigated further** — see §7.

---

## 5. Where jess is deliberately different from 4.x

Do not file any of these as gaps.

| Area | v5 behaviour | Ledger |
| --- | --- | --- |
| Inline backtick JavaScript | removed entirely, recognized only to diagnose | **A3** |
| `@plugin` | superseded by `@use`/`@-use` as the script-module route | **A2** |
| Default output shape | nested (`collapseNesting:false`); 4.x flatten is opt-in | **O1** |
| `@media` merging | not performed | **O2** |
| Extend cascades | `:is()`-compacted | **O2**, `v5-is-compaction-rule` |
| Bare `@var` in an at-rule prelude | hard error (4.x warned) | **P7** |
| Un-operated literals | source-verbatim; only computed values canonicalize | **V1** |
| Numeric emit | shortest decimal within relative `1e-10` | **V4** |
| Operators/separators | always spaced | **F1** |
| IE `progid:` filter syntax | not supported | `ie-filters-REMOVED` |

---

## 6. The options-placement trap

`math`, `strictUnits`, `rootpath`, `rewriteUrls`, `urlArgs` and `sourceMap`
belong in the **`output`** bucket. Passed in `compile` they are **silently
ignored** — no error, no warning, no type complaint at the `Compiler` boundary.

This is the direct cause of at least one wrong status record: the CHANGELOG lists
"URL rewriting options" as WIP and the fixture harness records "urlArgs URL query
appending is not implemented" (`all-less.test.ts:206-209`) and
"relativeUrls=false/rootpath static URL behavior is not implemented"
(`all-less.test.ts:202-205`) — all three work when placed in `output`.

Measured, both buckets, same input:

| Option | in `compile` | in `output` |
| --- | --- | --- |
| `math: 'always'` on `4 / 2` | `4 / 2` (ignored) | `2` ✓ |
| `strictUnits` on `1px + 2em` | `3px` (ignored) | `eval/invalid-unit-arithmetic` ✓ |
| `rootpath: '/cdn/'` | unchanged | `url("/cdn/img/a.png")` ✓ |
| `rewriteUrls: 'all'` | `url("rel.png")` | `url("sub/rel.png")` ✓ |
| `urlArgs: 'v=1'` | unchanged | `url("img/a.png?v=1")` ✓ |
| `compress: true` | ignored | ignored (genuinely unimplemented) |

**Worth an owner decision:** an unrecognized key in either bucket should be a
diagnostic. A silently-ignored option is the same failure class this repo pays
for — a check that reports success because it cannot see the failure mode.

---

## 7. What was NOT examined

Stated precisely, because a triage presented as complete that sampled is an
invalid result.

**Covered completely:** all 89 Less 4.x builtin function names (each rendered
through both engines); the seven declared WIP areas; the `@import` option set
(`reference`, `inline`, `less`, `css`, `once`, `multiple`, `optional`,
interpolated paths, media queries, nested imports); the mixin, guard, detached-
ruleset, lookup, extend, merge, parent-selector, escaping/interpolation and
at-rule surfaces as enumerated in §3.

**Not examined:**

- **Source-map *content*.** Established that no map is produced at all; did not
  evaluate mapping accuracy, `sourceMapRootpath`/`Basepath`/`URL`/
  `OutputFilename` handling, or the annotation comment.
- **`lint`, `insecure`, `strictImports`, `depends`, `paths`, `globalVars`,
  `modifyVars`, `processImports`, `color`, `quiet`.** Only spot-checked, or not
  at all. `strictImports` in particular has three-valued semantics
  (`false`/`true`/`'error'`, `packages/config/src/types.ts:123`) and none of the
  three was verified against 4.x.
- **The `lessc` CLI surface.** jess ships `bin/jess`; the `lessc` shim lives in
  the external alpha repo and no CLI flag was exercised end to end.
- **Error-message text and error *codes*.** Checked that diagnostics carry
  file/line/column/context; did not compare which inputs error against 4.x
  beyond the cases above. The nine `tests-error/eval/*` entries that just
  graduated (§8) suggest this surface moves.
- **`@plugin` JS execution semantics in depth** — the Deno runtime path, the
  `@plugin (args)` form, plugin scoping/`root-registry`, and the legacy
  CommonJS `require()` graph (a recorded expected-failure,
  `all-less.test.ts:250-253`).
- **Compressed-output *parity*.** Established that `compress` does nothing;
  did not enumerate which 4.x compression transforms would be needed.
- **The 136 `tests-unit` / 78 `tests-config` / 100 `tests-error` fixture files
  individually.** Their aggregate pass/fail is the `all-less` lane's job; this
  triage deliberately does not restate it.
- **Browser runtime behaviour.** Established that no browser build exists;
  nothing beyond that.
- **SCSS and `.jess` dialects.** Out of scope — this is the Less 4.x lane.

---

## 8. Ratchet reconciliation

Measured by me at `74b9fcb4d`, full clean build, `pnpm run
verify:jess-suite-ratchet`:

```
tests: 1018   failing: 30   baseline (gating): 13   baseline (flaky): 0
NEW 28   FIXED 10   STALE 1
```

State the SHA with the number: the count moves as other lanes land, and figures
of 13, 28, 29, 36 and 37 have all been quoted for this gate. **28 at
`74b9fcb4d`.**

One naming caveat, so the next reader does not chase it: running
`test/min-max-dialect.test.ts` in isolation reports **16** failures, and the
ratchet's NEW list names all 16 — 16 min-max plus 12 others is exactly 28.

### The 28 NEW, classified

**None of the 28 is an unimplemented language feature.** They are 8 real bugs
across four mechanical defects, plus 4 stale expectations — three of which the
tests themselves name the fix for. Nothing here belongs in §3 or §4.

| Root cause | Failures | Class | Evidence |
| --- | --- | --- | --- |
| **RC-1 — the `.jess` dialect registers no value evaluator at all** (**CLOSED; the count and the classification below are both superseded — see the correction under this table**). `JessPlugin` never calls `context.registerValueEvaluator(…)`; both sibling plugins do. Every typed leaf degrades to a bare `Keyword` and every call is preserved verbatim, so `.jess` has no arithmetic and no builtins. | ~~**18**~~ → **3** measured (`jess-render` only; the 16 `min-max-dialect` are stale expectations, not this bug) | BUG (arithmetic half only) | missing call: `packages/syntax/jess/jess-plugin-jess/src/index.ts:26-39`; present at `packages/syntax/less/jess-plugin-less/src/index.ts:414` and `packages/syntax/scss/jess-plugin-scss/src/index.ts:71`. `registerValueEvaluator` is recent (`d32f6622d`) — the per-dialect-registry refactor wired Less and Sass and left `.jess` behind. Degradation sites `packages/core/src/ast/serialize.ts:2461,2483,4365,4503`. Direct check: `.jess` `$(1px + 2px)` → `1px + 2px`; `.less` `1px + 2px` → `3px`. Every one of the 16 min-max assertion messages names `.jess`; `.less` and `.scss` pass all 24. |
| **RC-2 — body-form `&:extend()` keeps only the first branch of a comma-list rule** (**CLOSED — the body form now reduces to its own tagged `BodyExtendFact` instead of a bare `{target, partial}[]`; see the section under this table**). `ExtendStatement` reduced to the same `{target, partial}` shape the inline-extend predicate tests for, so the body form was filed as a first-branch extend and stamped with `selector[0]` where it must carry the whole rule selector. | **2** | BUG | `packages/syntax/less/less-parser/src/grammar.ts:6025` (`ExtendStatement`), predicates `:1703`/`:1709`, consumers `:6108`/`:6129`/`:6227`. Repro: `.foo{display:none} .a, .b { &:extend(.foo all); }` → `.foo, .a` — `.b` dropped. Hit `tests-unit/extend/extend.less:26-30` in two harnesses. |
| **RC-3 — a detached-ruleset body rejects leading-combinator nested rules** (**CLOSED — `BodyStatement` now takes the same `nestedGuardedRuleset` arm `blockItem` takes**). The `ValueBlock` body used the absolute selector-list production; the ordinary nested body uses the relative one, which admits `>`/`+`/`~`. | **1** | BUG (fixed) | `.../less-parser/src/grammar.ts:4349` (was `guardedRuleset` → `g.RulesetWithExtends` → `selectorListWithExtends`; now `nestedGuardedRuleset` → `g.NestedRulesetWithExtends` → `relativeSelectorListWithExtends`). Regressed by `d10c7fd38`, which split the absolute/relative selector lists and moved only `blockItem`. Repro: `@r: { ~ .a { x: 1 } }` fails, `@r: { & ~ .a { x: 1 } }` and `.z { ~ .a { x: 1 } }` both pass. Unblocked `bootstrap-less-port/less/{_card,_tables,mixins/_forms,mixins/_table-row}.less`. Two things this fix deliberately did **not** touch are recorded under the table. |

> **RC-3 — root-level leading combinators are `DELIBERATE`, a settled divergence
> from lessc, not a gap.**
>
> `bootstrap-less-port/less/_navbar.less:251` opens
> `> .container, > .container-fluid { … }` at the STYLESHEET ROOT, as its
> documented workaround for emulating Sass placeholder selectors. `lessc` 4.x
> tolerates this and emits ` > .container`. **jess rejects it, and that rejection is
> correct.** Owner ruling: _"there's no rational reason to emit `> .container`
> at the root"_ and _"the fact Less lets you write shit styles and emits shit
> styles is not helpful to an author."_
>
> The reasoning, so this is not re-litigated:
>
> - A root-level leading combinator is meaningless CSS. There is no parent for
>   the combinator to relate to, so it emits a selector no browser can match.
> - Matching lessc on **valid** input is the contract. Reproducing its
>   willingness to emit unmatched selectors would be inheriting a bug, not
>   honouring compatibility. lessc's acceptance is evidence of lessc's
>   permissiveness and of nothing else.
> - A parse error naming the line serves the author better than a clean compile
>   that produces dead CSS — especially in a Sass→Less port, where a root-level
>   combinator is more plausibly translation noise than anything a Less author
>   meant to write.
>
> So `d10c7fd38` making the stylesheet root an error was right, and
> `_navbar.less` failing to parse is jess being correct. Nothing is owed here.
> The nested contexts are the only place a leading combinator is legal, which is
> exactly what RC-3 fixed. Guarded by
> `less-parser/test/ast-grammar.test.ts` ("still rejects a leading-combinator
> selector at the stylesheet root") and by
> `css-parser/test/css/errors/selector-leading-combinator.css`.
>
> **RC-3a (open, real) — a leading-combinator selector cannot carry an inline
> `:extend()`.** `.z { > td:extend(.x) { … } }` and
> `@d: { > td:extend(.x) { … } };` both throw. This is a NESTED-context defect,
> where a leading combinator IS legal, and must not be confused with the
> root-level ruling above. Cause:
> `relativeSelectorListWithExtends` (`.../less-parser/src/grammar.ts:5961`) is
> `choice(SelectorBranch, node('SelectorBranch', g.RelativeComplex, …))`. The
> extend-carrying arm, `SelectorBranch` (`:5916`), opens on `ExtendComplex`
> (`:5852`), whose head is `InlineExtendSubjectCompound` — there is no leading
> combinator slot in it at all, so `> td:extend(.x)` cannot match it. The
> fallback arm, `g.RelativeComplex`, does admit the combinator but has no extend
> tail and hard-codes `extensions: []`, so the `:extend(…)` is left unconsumed
> and the whole parse fails rather than silently dropping the extend. Fixing it
> means giving the relative branch the same extend tail the absolute one has,
> which is the same three-level absolute/relative fork noted against these
> consts. Pre-existing — RC-3 made the detached body behave identically to the
> ordinary nested body, which is the point; it did not introduce this and did
> not widen it.
| **RC-4 — `${…}` is absent from the Jess value-atom set.** It works in selectors, `url()`, quoted strings, custom-property names and media preludes, but not in a plain value or a statement at-rule prelude. | **1** | BUG | `packages/syntax/jess/jess-parser/src/grammar.ts:3288-3299` is `choice(Expression, DollarInterp)` — `DollarBrace` (defined `:1533`) is missing; consumed at `:3331`. |
| **`$extend &`** — the extend-target policy validator has no carve-out for the parent selector, so `&` is rejected under the default `['class']` policy. `&` is not a selector kind the option means to gate. | **1** | BUG | `packages/syntax/jess/jess-parser/src/index.ts:87,102-110,117-122` |
| **RC-5 — leading-combinator (implicit `&`) SCSS selectors now parse.** Two baselines record it as a gap; the ratchet is firing on an *improvement* and both tests say so in their failure text. | **2** | stale expectation | `test/scss/bootstrap-corpus.test.ts:284` (31 parse now, baseline names 29 — add `_button-group.scss`, `_type.scss`); `test/scss/scss-construct-support.test.ts:240` |
| **`JessError` no longer extends `Error`** — `toBeInstanceOf(Error)` is stale; the change was deliberate (skip stack capture). | **1** | stale expectation | `packages/core/src/error/jess-error.ts:78`; failing line `test/diagnostics.test.ts:432`. **Carries an owner question:** `renderString` now rejects with a non-`Error`, and that perf decision was taken in `lint`'s context, not the public API's. |
| **`quote`/`unquote` now register** — the guard asserting Sass's "still-unconverted globals register nothing" is a placeholder that reality overtook. | **1** | stale expectation | `packages/fns/src/sass/index.ts:88-89`, real bodies in `packages/fns/src/sass/string/quote.ts`; delete `test/dialect-builtins.test.ts:81-82` |

> **RC-1 CORRECTED AND CLOSED — the "18 behind one line" figure was wrong, and
> the fix is NOT a Less/Sass registry.** Owner ruling 2026-07-30, recorded as
> `DESIGN-DECISIONS.md` **P17**: `.jess` has **no ambient global builtin
> namespace by design** — functions arrive through `@-use`/`@-compose` or as a
> stylesheet-defined lambda. Only the ARITHMETIC half was a bug, and its
> spelling is the `$( … )` expression form (P13(d)), never bare `1 + 2`.
>
> The fix landed is `buildEvaluator(createFnRegistry())` — an evaluator over an
> **EMPTY** table — in `packages/syntax/jess/jess-plugin-jess/src/index.ts`. It
> restores `operate`/`materialize`/`compare`/`typeCheck` (the `!e.ev` fallback
> at `packages/core/src/ast/serialize.ts:3191` was re-emitting operand bytes)
> while leaving unknown-call output byte-identical.
>
> **Measured, not predicted.** Ratchet at `ecb5a4f01`: **28 NEW** before,
> **27 NEW** after. Exactly **3** entries flipped, all in `jess-render.test.ts`
> (`$for` bindings, stylesheet-defined functions, function-as-a-value) — the
> three that needed arithmetic. The **16 `min-max-dialect` entries did NOT flip
> and must not**: they assert `.jess` serves the *Less* builtin set
> (`packages/jess/test/min-max-dialect.test.ts:81-82`, "`.jess` has no dialect
> fns of its own yet and takes the Less set"), which P17 rules is the wrong
> language model. **Reclassify all 16 from BUG to stale expectation.** The
> remaining 2 `jess-render` entries were never RC-1's: they are the `$extend &`
> policy row and the RC-4 `${…}` row already listed separately.
>
> The "Open, not decided here" question below — `makeLessRegistry()` vs a
> `jessFns` index — is therefore **answered: neither.** Do not create
> `packages/fns/src/jess/`.

RC-2 and RC-3 are both in the Less parser's ruleset-body/extend classification
and are plausibly one work item.

### The baseline edit

`packages/jess/test/known-failures.json` was reduced from 13 named entries to 2:
the 10 FIXED and the 1 STALE were deleted, per the file's own rule that the gate
requires deletion the moment a listed test passes. The classification of the 28
NEW is recorded there and in the commit that lands this document.

Of the FIXED, nine are `tests-error/eval/*` entries — unmatched mixin calls,
namespace member misses and undefined property accessors now raise eval errors
where they previously rendered. That is a real capability gain and the reason
this document does not treat "errors where Less errors" as an open area.

### RC-2 and RC-3 — LANDED

Both were in the Less parser's ruleset-body/extend classification. They were
predicted to be one work item; they landed as two. RC-3 landed on its own in
`a493bcee8`, independently discovered while this branch sat unmerged, so the
change described here carries RC-2 only. Both are in
`packages/syntax/less/less-parser/src/grammar.ts`.

**RC-2.** `isExtendInstruction` and `isExtendTargetFact` were byte-identical
predicates, so `RulesetTail`'s `extensions` bucket — selected by
`isExtendInstruction(v) && !isExtendTargetFact(v)` — could never be non-empty.
Every body-form extend fell into `firstExtensions` and `ClassIdStatement`
stamped `subject: selist(prefix.selector)` on it. The fix gives the body form its
own reduced fact (`BodyExtendFact`, field `bodyExtensions`) instead of a bare
`{target, partial}[]` that is indistinguishable from an inline extend's. Body
extends now reach `extensions` carrying **no** `subject`, which is already the
documented whole-rule contract on `ExtendInstruction` and already what
`RulesetWithExtends` / `NestedRulesetWithExtends` produced on their own path.

**RC-3** (landed separately as `a493bcee8`). `BodyStatement` composes `nestedGuardedRuleset`, the same
production the ordinary nested `blockItem` uses, rather than the absolute
`guardedRuleset`. A detached-ruleset / `each()` body is evaluated in the
caller's nesting context, so its rules are nested rules. `RelativeComplex` is a
strict superset of `Complex` and reduces to the identical branch when no leading
combinator is present, so this is a pure widening on the AST surface.

**Ratchet: NEW 15 → 13**, failing 17 → 15 (`pnpm run verify:jess-suite-ratchet`,
re-measured against `origin/dev` `089c02adf`). The two that go green are
`all-less.test.ts` and `extend-exact-oracle.test.ts`, both on
`tests-unit/extend/extend.less`. The post-change set is a strict subset of the
pre-change set: nothing is introduced. The ratchet is red on `origin/dev` for
unrelated reasons and stays red; this change only shrinks it.

**Less test-data: 80/81 → 81/81** (`pnpm run test:less:test-data:unit`). The
single fixture that flips is `tests-unit/extend/extend.less`. Less-parser unit
suite is 702/702 on 13 files. `pnpm run verify:types` is red on both sides with
byte-identical output (2/25 configs, 863 diagnostics, `@jesscss/jess-parser` 450
and `@jesscss/scss-parser` 413) — pre-existing and untouched here.

**`bootstrap-memory-bisect.test.ts` does NOT go green, and RC-3 was not its only
blocker.** The table above attributes 1 failure to RC-3; that attribution was
optimistic. `mixins/_forms.less:88-91` now parses, and the test advances to a
second, unrelated defect in `bootstrap-less-port/less/_navbar.less:256` —
`each(map-keys(@grid-breakpoints), #(@breakpoint) { … })`, which the parser
rejects with "Unexpected Less input after a complete stylesheet." reported at
line 251. `_navbar.less` is byte-identical between the pre- and post-fix parser
in the byte-identity digest and holds the parse-failure hash in both, so this is
pre-existing and untouched by either fix. It needs its own root cause.

**Byte-identity: rebaselined here, with the move set classified first.** An
earlier revision of this note claimed the baseline was already red on
`origin/dev` and therefore could not gate the change. That is no longer true —
the corpus and baseline have since converged. On `089c02adf` the gate is
**PASS**, IDENTICAL on both surfaces: 715 entries, ast `b97690c7885e8fe3…`
`threw=118`, cst `4ec13927dcff0cd7…` `threw=0`. So the committed baseline *is*
dev's per-entry truth and the differential below is taken against it directly.

With RC-2 applied the ast aggregate moves to `e301f07fa7554731…` — **14 of 715
shared entries, cst byte-identical, `threw` unchanged at 118 → 118.** No entry
gained or lost an extend instruction and no ruleset count changed; every
difference is an `ExtendInstruction.subject` going from present to absent.

The move set is *exactly* the files carrying a body-form `&:extend` under a
class/id-led selector, verified in both directions: all 14 moved files contain
one, and no file without one moved. Four files contain a body extend and do not
move, each for a reason that confirms the scope — `_popover.less` and
`_tooltip.less` carry theirs under `&`-led selectors, which route through
`NestedRulesetWithExtends` and were already correct; `selectors.less` uses the
inline form; `_navbar.less` throws identically on both sides.

Of the 14, **three are output-changing** and eleven are AST-shape-only:

| Entry | Class | Why |
| --- | --- | --- |
| `tests-unit/extend/extend.less` | output-changing | `.ext3, .ext4` — subject `.ext3` → absent |
| `tests-unit/extend-chaining/extend-chaining.less` | output-changing | `.me, .mf` — subject `.me` → absent |
| `bootstrap-less-port/less/mixins/_grid-framework.less` | output-changing | multi-branch compound — subject → absent |
| the other 11 | AST-shape-only | single-branch carrying selector, so the stamped subject already equalled the whole rule; CSS is unchanged |

The three output-changing entries are corrections, not regressions, and
`extend.less` proves it against the owner-maintained expected CSS: before the
fix jess emitted `:is(.foo, .ext1 .ext2, .ext3)`, dropping `.ext4` from a
`.ext3, .ext4` comma list; the expected output is
`:is(.foo, .ext1 .ext2, .ext3, .ext4)`. `extend-chaining.less` and
`_grid-framework.less` are the same defect in a position where the emitted CSS
happened not to differ, so both remain green. `_grid-framework.less` has no
expected-CSS oracle in this suite and is covered only by the parse digest.

Corpus provenance for the run: `@less/test-data` is a `link:` to the sibling
`~/git/oss/less.js` checkout at `2f309b667` (branch `alpha`, clean tree). The
gate is not reproducible across machines without that pin.

**Perf: NOT re-measured after the rebase.** The original A/B was taken on the
pre-rebase base and covered RC-2 and RC-3 together, so it does not describe the
change that actually lands here. That run read NEUTRAL, and could only be called
that: `ab-compare.mjs` (same worktree, git-toggled, interleaved) was run twice
cleanly and disagreed in direction — at `4 3 8 25` every case read +1.5%…+7.1%
median for the candidate, at `6 3 8 25` every case read −2.9%…+0.6% with
win-rates at 7–12 of 18. The tell was the control: `css-corpus-ok` and
`css-corpus-ok-joined` are plain CSS with no `:extend` and no detached ruleset,
so neither fix can touch them structurally, yet they moved by the same magnitude
and sign as the Less corpora in both runs. That is cross-run bias, exactly the
constraint [`GRAMMAR-REVIEW-STANDARD.md`](../parser/GRAMMAR-REVIEW-STANDARD.md)
§4 records (`3.864x → 3.564x` on identical code).

On structure, RC-2 adds one wrapper object per `ExtendStatement` reduction and
replaces an `Array.isArray` scan of every ruleset child with a single-key
predicate over the same children, so it is not expected to move the needle in
either direction. That is a prediction, not a measurement — if a perf claim is
needed for this change, re-run the A/B against `089c02adf`.
