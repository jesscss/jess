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
> on `isurl`; they differ on `style()` (reconciled in the row below), and this
> section adds two findings that lane did not have: the `style()` prelude
> position (below) and the `desaturate()` achromatic bug (§4.6).

Less 4.x registers **89** names by source reading (every file in
`less-4x/packages/less/lib/less/functions/` read; registry is `addMultiple`
keyed by object key, lower-cased —
`less-4x/.../functions/function-registry.js:4,15`; registration site
`functions/index.js:21-32`; no `functionRegistry.add*` anywhere outside that
directory).

jess's Less dialect index registers **83** (enumerated at runtime via
`fnsOf(await import('@jesscss/fns/less'))`, not read off a file).

**All 89 were checked by rendering one call per name through both engines** — not
sampled, and not read off an index. Result: **77 byte-identical, 12 differing.**
The 12:

| Count | Names | Verdict |
| --- | --- | --- |
| 2 | `isurl`, `style` | **MISSING** — below |
| 1 | `desaturate` | **BUG** — §4.6 |
| 5 | `rgb`, `rgba`, `hsl`, `hsla`, `luma` | **DELIBERATE** — un-operated colour constructors stay authored (settled F5 lazy boundary, `all-less.test.ts:320-334`), plus **F1** separator spacing and **V4** numeric emit |
| 4 | `isdefined`, `isruleset`, `extract`, `length` | not function gaps at all — artifacts of the unrelated **§4.5** parse bug; all four render correctly once a space follows the property colon |

So: **85 IMPLEMENTED, 2 MISSING, 1 BUG, 1 unrelated parse bug surfaced.**

### The two that are missing

| Name | Status | Evidence |
| --- | --- | --- |
| `isurl` | **MISSING** | `.x { a: isurl(url(x)); b: isurl(1); }` → less4 `a: true; b: false`; jess emits `a: isurl(url(x)); b: isurl(1)` **verbatim, with no diagnostic**. Not in the fns index and not in the core guard predicate table `packages/core/src/ast/value-guards.ts:205-225` (which has `iscolor/isnumber/isstring/iskeyword/ispixel/ispercentage/isem/isunit` — `isurl` and `isruleset` are absent from it; `isruleset` is handled elsewhere, `isurl` nowhere). Unknown calls fall through to `fallbackCall` (`packages/core/src/ast/evaluator.ts:125`), so this fails silently. **Exactly the class no fixture can catch.** |
| `style` | **not a function gap — a PARSER gap** | In a declaration value, `style(@v)` renders identically in both engines, so as a *function* it is fine (`docs/state/less-4x-function-triage.md` §5). But in the position it exists for — a container style query — jess cannot parse it: `@container (style(--x: 1)) { .y { c: 1 } }` → less4 renders it unchanged; jess `parse/syntax-error: Missing closing parenthesis.` at 1:22. That doc records this prelude position as **not tested** (its §9); this row is the measurement. |

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

None of the six below is in the CHANGELOG's WIP list, none is in
`known-failures.json`, and none is caught by any fixture. Two of them (§4.5,
§4.6) produce a hard parse error or silently wrong colour on ordinary Less.

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

### 4.2 BUG — `name=value` function arguments evaluate to `false`

```less
.x { filter: alpha(opacity=50); }   →  jess: filter: alpha(false)    less4: alpha(opacity=50)
.x { a: foo(bar=1); }               →  jess: a: foo(false)           less4: foo(bar=1)
```

Silent wrong output, no diagnostic. Less 4.x models this as a dedicated
`Assignment` node (`less-4x/.../tree/assignment.js`, parsed at
`.../parser/parser.js:715`); jess parses it as an equality comparison and emits
the boolean. **This is generic**, not IE-specific — `foo(bar=1)` is affected.

`progid:DXImageTransform…` is a hard `parse/syntax-error`; that one is covered by
the deliberate `ie-filters-REMOVED` removal (`all-less.test.ts:257-260`) and is
not filed here. The `name=value` argument form is not.

**Cost to fix:** an `Assignment`-shaped call argument in the value grammar,
preserved verbatim on emit.

### 4.3 BUG — `@import` option keywords leak into emitted CSS

```less
@import (css) "imp-a";              →  jess: @import (css) "imp-a";      less4: @import "imp-a";
@import (optional) "nope";  .x{a:1} →  jess: @import (optional) "nope";  less4: (dropped entirely)
                                          .x { a: 1 }                            .x { a: 1 }
```

The first emits a directive no browser understands. The second emits an
`@import` for a file that was deliberately declared optional and does not exist.
Both are invalid CSS in the output.

### 4.4 MISSING — `@import` with a media query does not wrap

```less
@import "imp-a" screen;
```
less4 wraps the imported content in `@media screen { … }`; jess passes the
`@import` through verbatim. Known internally (the `import.less` expected-failure
reason at `all-less.test.ts:191-194` mentions it) but never stated as a feature
row.

### 4.5 BUG — `prop:fn(@var)` with no space after the property colon is a parse error

The single highest-impact finding here, because it is a hard failure on
ordinary compact Less.

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

### 4.6 BUG — `desaturate()` saturates an achromatic colour

```less
.x { a: desaturate(#888, 10%); }  →  jess: #7c9494   less4: #888888
.x { a: desaturate(#999, 10%); }  →  jess: #8fa3a3   less4: #999999
```

Desaturating a grey must be a no-op; jess returns a *saturated* teal. Scoped by
probe: `saturate` on the same input is correct, `desaturate` on a chromatic
colour is correct, `desaturate(…, 0%)` is correct, and `#fff`/`#000` are correct
(lightness 100/0). So the fault is confined to the achromatic case where hue is
undefined — a NaN/undefined-hue path that produces a hue instead of preserving
grey. Silent wrong colour, no diagnostic.

### Also recorded

- **`isurl`** (§2) and **`style()`** (§2) — MISSING builtins.
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
| **RC-2 — body-form `&:extend()` keeps only the first branch of a comma-list rule.** `ExtendStatement` reduces to the same `{target, partial}` shape the inline-extend predicate tests for, so the body form is filed as a first-branch extend and stamped with `selector[0]` where it must carry the whole rule selector. | **2** | BUG | `packages/syntax/less/less-parser/src/grammar.ts:5872-5878`, predicate `:1678`, routing `:6065-6075`, stamp `:6128-6133`. Repro: `.foo{display:none} .a, .b { &:extend(.foo all); }` → `.foo, .a` — `.b` dropped. Hits `tests-unit/extend/extend.less:26-30` in two harnesses. |
| **RC-3 — a detached-ruleset body rejects leading-combinator nested rules.** The `ValueBlock` body uses the absolute selector-list production; the ordinary nested body uses the relative one, which admits `>`/`+`/`~`. | **1** | BUG | `.../less-parser/src/grammar.ts:4316-4321` vs `:4293`, relative form `:5928`. Repro: `@r: { ~ .a { x: 1 } }` fails, `@r: { & ~ .a { x: 1 } }` and `.z { ~ .a { x: 1 } }` both pass. Breaks `bootstrap-less-port/less/mixins/_forms.less:88-91`. |
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
