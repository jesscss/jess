# Parser and AST Performance Ideas

## Measurement discipline

Measure the built dialect package on a named fixture with fixed warm-up and
sample count. Separate parse, canonical-AST construction, evaluation, and CSS
emission. Match input and requested work when comparing with Dart Sass; a
transform or serialization pipeline is not a parser comparison.

Record the fixture's composition as well as its byte size. A large file with a
small preprocessor tail is a useful CSS-heavy compile-throughput case, but it is
not evidence about a large authored-preprocessor program. Keep CPU-profile
percentages attached to the exact workload and process shape that produced
them; sampling profiles rank investigations, not release claims.

## Current profile: PostCSS preprocessor workload

Initial profile date: 2026-07-29. Latest reprofile: 2026-07-30, Jess commit
`bda41a0bb`; Node `v24.11.1`,
Darwin arm64; built `jess`, `@jesscss/core`, and
`@jesscss/less-parser` `2.0.0-alpha.5`; resolved
`parseman@0.43.0`. The upstream checkout was
`postcss/benchmark@ddc1a86710a65de302e0675ef3a5a1cc7db270bd`.

The workload must not be called "Bootstrap Less". Its 288,434-byte Less input
contains 279,683 bytes of compiled Bootstrap CSS and 8,751 appended bytes of
Less variables, mixins, calls, and nesting: **96.97% of the input is the
compiled-CSS base**. It does perform full parse + eval + emit, but primarily
measures a Less frontend compiling CSS.

An isolated warm phase sample reported:

| workload | prepare/parse | eval + emit |
| --- | ---: | ---: |
| PostCSS-derived Jess Less, 288,434 bytes | 52.30 ms | 88.08 ms |
| `packages/jess/benchmark/benchmark.less`, 106,802 authored Less bytes | 28.51 ms | 33.57 ms |

The CPU profiles used 10 warmups and 30 measured renders. Percentages below are
direct self samples over the whole profiled Node process, so module loading and
profiler overhead remain in the denominator:

| direct sampled bucket | CSS-heavy PostCSS case | authored-Less control |
| --- | ---: | ---: |
| suppressed warning location + code-frame construction | **39.3%** | **0.0%** |
| garbage collector | 7.3% | 14.1% |
| Parseman root-trivia index (`appendGap`, `gapsWithKind`, maps) | 4.5% | 3.8% |
| canonical-AST span WeakMap set/get | 2.0% | 3.6% |

The 39.3% bucket maps to one successful-render path:

1. A registered function rejects arguments that it cannot evaluate and
   `ValueEvaluator.call()` preserves the CSS call.
2. `evalCall()` eagerly calls `callSiteLocation()`, which invokes
   `lineColAt()` from the start of the 288 KB source.
3. `Context.warn()` converts the `JessError` with `toDiagnostic()` before it
   checks `warnings.silence`; that conversion splits the entire source through
   `extractRelevantLines()`.
4. `suppressWarnings: true` finally discards the completed diagnostic.

The profile therefore does **not** identify general evaluation as the gap, and
it does not contradict a real Less workload that avoids this path. The
authored-Less control spends no samples there. A fresh full
`bootstrap-less-port` control could not be recorded on this commit because the
current parser stops in `mixins/_forms.less` at line 59; this profile neither
confirms nor refutes any prior full-Bootstrap comparison.

## Ranked targets from the current profiles

### P0 — make preserved-function diagnostics genuinely cold

This is the only target large enough to explain the CSS-heavy result.

Status: implemented and reprofiled 2026-07-30.

- `Context.warn()` now decides silence, fatal promotion, and repetition/cap
  admission before `toDiagnostic()`. Repeated or capped warnings therefore do
  not allocate frame lines.
- A registered function that declines CSS-compatible arguments now preserves the
  authored call silently. There is no `function/unresolved` code, callback,
  source lookup, or warning object on that expected path; `functionMode:
  'error'` remains the explicit strict policy, and genuine plugin execution
  failures remain diagnostics.
- Surviving diagnostics now share a file-owned lazy line-start index—the same
  newline-offset / binary-search algorithm Parseman uses—and slice only the
  requested frame lines. They no longer scan from byte zero or split the entire
  file per diagnostic site.
- `verify:diagnostic-cold-path`, its focused tests, and the PR workflow protect
  the ordering and index/slice implementation. This is an explicit V8
  architecture invariant (R7), not an implementation preference.
- Audit the registered-function preserve lane. A routine "not applicable to
  these CSS arguments" result must not require throw/catch/Error control flow;
  use a typed miss/preserve result while retaining real exceptions for actual
  function failures.

Proof: preserve warning bytes and locations for unsilenced, fatal, capped, and
verbose modes; pin zero diagnostic construction for a silenced code; then
reprofile both workloads. The authored-Less control is a required no-regression
case even though it currently has no samples in this path.

Reprofile result: the exact PostCSS workload above, after ten warmups and 80
Jess-Less samples, produced 3,982 CPU samples. The former warning location /
frame bucket has **zero** samples: no `callSiteLocation`, `lineColAt`,
`extractRelevantLines`, `toDiagnostic`, or source-line split frame appears.
`unresolvedFunction` had one isolated sample in this pre-policy-removal profile;
the code path has since been deleted rather than made cheaper. A second direct
Jess-Less profile (ten warmups / 160 renders, 7,181 samples) confirms zero
samples for `unresolved`, `callSiteLocation`, `lineColAt`,
`extractRelevantLines`, and `toDiagnostic`; its leading remaining direct buckets
are GC (17.67%), Parseman `appendGap` (2.83%), Parseman `gapsWithKind` (2.55%),
and Parseman `buildRootMaps` (1.53%). The single-engine warm run (10 warmups /
30 samples) reports a 47.56 ms median; the comparable multi-engine run (5
warmups / 15 samples) reports Jess Less 49.45 ms versus Less 4.8.1 at 30.37 ms
and PostCSS at 16.53 ms. A post-collector paired confirmation (ten warmups / 30
interleaved samples) reports Jess Less 47.46 ms versus Less 4.8.1 at 29.02 ms
(1.64×); its output still contains the required evaluated feature markers. That
is a successful deletion of the profiled architecture failure, not benchmark
victory.

Second reprofile result: `bda41a0bb` removes the remaining legacy root-trivia
map trigger from comment-only AST emission. A 50-render CPU profile fell from
about 5% direct samples in `appendGap` / `buildRootMaps` / `getMaps` to one
incidental 0.05% `buildRootTriviaIndex` sample; it is a source bucket deletion,
not a claim about total process GC (sampling proportions vary with collection
timing). Two fresh 61-sample interleaved runs measure Jess Less at **38.32 ms**
and **37.74 ms**, Less 4.8.1 at **26.85 ms** and **26.68 ms** (1.43× and 1.41×).
The harness's evaluated-feature assertions pass and Jess emitted 289,779 bytes
with SHA-256 `3ea6c1bdae41511923deece75676d453ff470cb447f531aae935b44eae6f5083`.

### P1 — remove cross-workload metadata overhead

- **Warning event storage:** implemented as a Context-owned columnar collector.
  Jess-originated warnings now pass policy/cap admission before template
  interpolation, retain scalar fields in parallel arrays, and materialize the
  public `WarningDiagnostic[]` only for a renderer/result boundary. The compiler
  uses `warningCount` for successful-path bookkeeping. Parser/plugin APIs still
  supply normalized objects at their public boundary, which are copied into the
  columns rather than made part of an internal object chain. The guard proves a
  silenced or repeated compiler warning does not render its template, and that
  no diagnostic array exists until requested. This is an allocation architecture
  correction; it is not yet a benchmark claim.

- **Canonical AST source spans:** `withSourceSpan()` and `sourceSpanOf()` account
  for 2.0% of the CSS-heavy profile and 3.6% of the authored-Less control. Test a
  fixed-shape inline or parser-owned indexed representation that removes the
  per-node WeakMap set/get without introducing polymorphic node shapes. Do this
  after P0 so warning-only span reads do not inflate the result.

  Rejected implementation shape (2026-07-30): encoding `{ start, end }` in a
  number-valued `WeakMap`, then decoding on every `sourceSpanOf()` read, made the
  exact Node v24.11.1 eval+emit workload slower (45.29 ms versus 38.90 ms in a
  reverse-order run). Caching the decoded objects was still slower (42.07 ms).
  Do not merely move the same allocation from parse to render. The next audit
  must identify which semantic/render facts actually require a span and remove
  whole writes for facts that do not, while preserving the uniform AST shape.

  Implemented (2026-07-30): standalone Less `Dimension` nodes no longer receive
  source spans. The Less grammar folds each arithmetic operation from Parseman's
  already-supplied raw child spans, so every intermediate operation retains its
  authored range without a per-dimension WeakMap write. A chained
  `1px * 1em / 1cm` test pins both operation ranges and its public strict-unit
  diagnostic. The exact held-AST measurement removes 2,969 writes (14.7%) and
  119 KB/document (1.76%). Reverse-order exact eval+emit samples were 38.33 ms
  and 37.44 ms for the cut versus 39.75 ms for the clean baseline; this is
  favorable but remains a confirmation signal, not a universal throughput claim.
- **Parseman trivia indexing:** the Jess-side generic-map trigger is deleted in
  `bda41a0bb`: legacy labeled logs stream contiguous comment ranges directly,
  and comment-only emission uses an exact binary search over those sparse runs.
  The larger root-capture cost remains until Parseman 0.44.0 is published. Its
  release branch `release/0.44.0-root-trivia` (currently `0d5ddfd`) adds
  `run(..., { rootTrivia: { selectedKinds } })`: labeled `blockComment` and
  `lineComment` markers retain their complete owning gap without storing every
  whitespace entry. The release fix also carries selected markers through
  semantic `leaf()` wrappers and uses the requested label table rather than a
  scope-local label index, so composed grammar factories can use different
  trivia-label orders. It is verified across composed grammar factories,
  macro-fused artifacts, transactional rollback, and AST/CST host modes.

  A disposable local Jess build against that branch passes the Less
  custom-property comment round trip, `check:macro` (zero interpreter
  fallbacks), `verify:compose-integrity`, the AST-v2 production ratchet, and
  the all-Less corpus. On the exact 288,434-byte source it reduces Parseman's
  root payload from 67,989 numbers / 22,663 entries / 22,631 gaps to 100 numbers
  / 20 selected entries / 16 gaps. This is an allocation and retained-memory
  correction, not a claimed end-to-end speedup: one local 61-sample eval+emit
  run measured Jess at 38.64 ms and Less at 28.32 ms (1.36×), while isolated
  parser timing remains order-sensitive. Do not put an unavailable dependency
  range on Jess; adopt it through the Less parser only once `parseman@0.44.0`
  exists in the registry, then re-run all-Less and this exact eval+emit harness.

- **Selector-atom re-derivation:** do not land a partial direct-traversal
  rewrite. A 2026-07-30 prototype replaced
  `selectorTermCanonical(term)` + one regex pass with a DFS over
  `CompoundSelector`/`ComplexSelector`/`RelativeSelector`/structured pseudo
  nodes, but still regex-scanned every raw simple leaf. That turns one cached
  canonical-string regex into multiple `match()` arrays plus four new helper
  calls and a fresh selector walk at every namespaced mixin lookup. Its exact
  PostCSS eval+emit pairs were inconclusive (candidate 36.72/36.91 ms versus
  baseline 39.79/36.29 ms), so it is rejected rather than called a speedup.

  The replacement must be one compact, parser/factory-owned ordered lookup-atom
  fact for static selectors, not a lookup-time cache or a leaf-by-leaf scan. Its
  contract must preserve the current atom stream until a deliberate semantic
  decision changes it: the legacy matcher includes pseudo names and structured
  pseudo arguments as well as words from opaque pseudo and attribute text; it is
  not just CSS element identity. Pin compound, complex, relative, `&`, opaque
  pseudo, structured pseudo, and interpolated namespace cases, then require an
  allocation/CPU profile plus reverse-order exact PostCSS measurements before
  landing.

- **Ruleset whole-span elision:** implemented conditionally on 2026-07-30. An
  initial generic deletion was rejected because the Less optional trailing `;`
  and its intervening comment trivia lie outside the brace-body span. The final
  grammar retains a full source span only when that final terminator is present;
  ordinary rulesets retain selector/body facts and no duplicate whole-rule span.
  On the exact 288,434-byte PostCSS input this removes 3,050 of 3,056 ruleset
  span writes, retaining six semicolon-tail spans. `statementEndOf` prefers the
  retained tail span and otherwise uses the brace-body end; async namespace
  guard diagnostics use the surviving selector span.

  Parser tests pin top-level/nested no-tail elision, optional-tail provenance,
  and silent-rule comment suppression; async evaluation pins source location.
  The exact reverse benchmark pairs were candidate/base 35.93/35.58 ms and
  base/candidate 38.29/38.77 ms, so this is an allocation/provenance deletion,
  not a claimed time win.

### P2 — allocation profile after sparse root capture

GC remains a leading sampled frame but CPU samples do not identify object
families. Capture an allocation profile after Parseman 0.44 selected-root
capture lands in Jess. Rank concrete object families from that profile; do not
treat "reduce allocations" or the GC frame itself as an actionable target.

### Not promoted by this profile

- Do not prioritize more value-math grammar edits from this run. Generated
  declaration/value/math reductions are individually diffuse and sit below the
  diagnostic lane.
- Do not attribute the 88 ms `renderAstStylesheet` phase to CSS writing. It
  includes evaluation, registered-function recovery, warning construction, and
  emission.
- Do not reorder the real Bootstrap/import/eval queue from this CSS-heavy
  fixture. Re-run a byte-correct full Bootstrap control once its parser blocker
  is cleared.

## Parser candidates

- Use Parseman first sets, shared-prefix factoring, and small grammar lookahead
  to remove profiled speculative descent.
- Keep interpolation, imports, values, selectors, and at-rule structure in the
  grammar so no later byte scan is needed.
- Avoid runtime scanner/regex/string reparse helpers in parser packages; move
  recognition into grammar combinators or delete the obsolete path.
- Retain trivia only where a CST/AST consumer demonstrably uses it.
- Benchmark macro-compiled grammar output against an identical fixture and
  check generated artifacts before claiming an optimization applies to release
  builds.

## AST/eval candidates

- Keep one canonical source tree and lazy placement state; avoid routine clones,
  materialization, side maps, and rediscovery walks.
- Rendering should write strings directly. Evaluation should not create nodes
  solely for immediate serialization.
- Prefer construction-time facts over later source/parent/selector discovery.
- Use profiles before changing hot code. Object-count reduction is evidence only
  when it explains lower measured time or memory.

## Landed levers

- **Value-piece slash left-factoring (parse, ~-11 ms / ~13% whole-render).**
  `DirectLessValuePiece`/`DirectLessFunctionValuePiece` used to list
  `DirectLessPreservedDivision` (a full `DirectLessTopSum` + REQUIRED slash tail)
  ahead of a bare `DirectLessTopSum`. The two arms share `TopSum`'s first-set, so
  the `choice` is not disjoint and cannot dispatch: every non-slash value (the
  overwhelming majority) parsed a full `TopSum`, failed the slash tail,
  backtracked, and re-parsed `TopSum` from the same position — a redundant full
  value descent per piece. Replaced with a single left-factored
  `DirectLessTopSumMaybeDivision` (`TopSum` once, then an OPTIONAL `many` slash
  tail): a bare value when no slash follows, the identical `SpacedValue` when one
  does. Measured same-worktree interleaved A/B on `benchmark.less`: parse median
  69 → 57.5 ms; whole-render median 84 → 73 ms. Byte-identical render; core
  (3194), less-parser (273), and the Less unit/config corpora unchanged.

- **Value-math `{collapse:true}` (parse, ~-3–4 ms / ~7% of parse).** The AST
  value-math precedence chain builds up to five nested nodes per value
  (`TopSum→TopProduct→MathAtom→MathUnary→ValueAtom`) even for a plain `#fff` with
  no operator. Each level is a single-child pass-through whose build action
  (`foldOperation`/`requireValueNode`) just returns `children[0]`. Adding
  parseman's `{collapse:true}` (a wrapper rule IS its single child) to
  `MathAtom`/`MathUnary`/`MathProduct`/`MathSum`/`TopProduct`/`TopSum` returns the
  child directly when no operator matched (`length===1`), skipping the redundant
  build-action call and node object; the fold still runs when operators are
  present. Byte-safe by construction (single-child fold == identity). NOTE: this
  is NOT the shelved parser-thing precedence-collapse experiment (#7) — that
  removed fold *scaffolding* V8 escape-analyzes away and was measured only on a
  trivial example; this elides whole *nodes* on the real Less value chain, where
  it measures a consistent ~7% parse win (byte-identical; core 3194, less-parser
  273, Less corpora green). NB: parse is ~68% of render and does NOT capture CST
  (`ctx.build===undefined` → grammar build actions run directly); the cost is
  node volume + recognizer descent, not capture.

## Gates

Any candidate needs focused behavior proof and a matched benchmark. At an
integration boundary rebuild dependencies, run core tests, the Jess AST-v2
production-route ratchet, and the Less corpus. SCSS-vs-Dart-Sass claims require matched
syntax coverage and a recorded median; otherwise report them as unmeasured.
