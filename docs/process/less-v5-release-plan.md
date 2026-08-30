# Less v5 Release Plan — deferred-feature roadmap

Companion to [`less-v5-alpha-readiness.md`](../state/less-v5-alpha-readiness.md). The
readiness doc gates **the current alpha**; this doc tracks features **deliberately
deferred past the current alpha**, what each is, why it's deferred, and the
sequence in which it's planned to land — so "out of scope for now" is a tracked
commitment, not a silent drop.

**Owner decision (2026-07-11):** remaining config-lane + source-map fixtures are
tracked outside the current alpha's main correctness bar unless the active
stabilization pass graduates one explicitly. Deferred items are NOT abandoned —
each is sequenced here, generally behind core work (the D-EVAL flip completion
and the drive to Less-4.x perf parity).

## Operating model — two tracks, rolling alpha cadence

**Owner decision (2026-08-29):** release cadence and roadmap work run as **two
independent tracks**. Neither blocks the other; both land on `dev` continuously.

1. **Foundation track** — the ordered roadmap: *grammar cleanup → normalize AST →
   bug fixes → Less feature gaps* (see `docs/state/GRAMMAR-DEDUP-LOG.md` and
   `docs/design/GRAMMAR-REBUILD-SPEC.md`). Grammar edits are serialized and gated
   by the `grammar-reviewer` (evidence per const). This track is foundational and
   mostly **not** user-facing on its own.

2. **Release-cadence track** — whenever `dev` accumulates a meaningful batch of
   **user-facing** change, cut an alpha: `release:alpha:update-from-dev --push`
   → `release:alpha:check` → publish (mechanics in
   [`releasing-alpha.md`](./releasing-alpha.md)). Ship real Less v5 progress each
   release rather than waiting for the whole roadmap.

**Rework-risk rule (why the tracks don't just merge):** the roadmap puts cleanup
first so features aren't built on a grammar that is about to be rewritten. So the
release track pulls only user-facing work **independent of the grammar surface
currently being cleaned** — eval/semantics fixes, diagnostic fixes, and feature
gaps whose grammar is already stable. A feature gap that needs a grammar change
**waits** until that grammar's cleanup lands, then is implemented once.

**What gates a release:** user-facing content on `dev`, not the release machinery
(which is always ready). Non-user-facing cleanup (test infra, ESM, dead-package
removal) does **not** gate a release and is **not**, by itself, a reason to
publish — except a deliberate cadence bump to keep `alpha` near `dev` or to prove
the loop, which is the owner's call. The version number is spent on **publish**,
not on the refresh.

## Sequencing principle

```
Phase A  CURRENT ALPHA  — functional core: Less correctness + lessc CLI, v5 nested
                          default, SCSS included. Perf ~5.4x Less 4.x (GA-gated).
Phase B  GA CORE        — finish the single-eval-emit D-EVAL flip (delete eval,
                          shed allocation) + close the ~5.4x toward Less-4.x parity.
Phase C  CONFIG-LANE    — URL/import config features (standalone wiring; slots in
                          once core render is stable post-flip).
Phase D  SOURCE MAPS    — gated on the provenance / emit-context mechanism (the
                          M1 / sourcemap-prototype thread); sequenced behind the
                          flip + a settled emit-time provenance model.
Phase E  LEGACY HOST    — Less 4.x plugin host compatibility APIs that expose
                          preprocessors, postprocessors, visitors, custom file
                          managers, or legacy tree mutation hooks.
```

Rationale: Config-lane URL/import features are mostly standalone option-plumbing —
cheap once the render core stops moving under the cutover, so they wait for Phase B
to land rather than churn against it. Source maps depend on a **settled emit-time
provenance model** (see the M1 / emit-context provenance discussion in the
core-architecture docs), so they can't be built until that mechanism is decided —
hence Phase D, last.

## Versioned language retirements

Less 4 compatibility spellings split into two lanes. Some remain accepted with a
deprecation diagnostic; others are removed in Less 5 but should still be
recognized well enough to report a precise migration diagnostic and recover in
language services. Neither lane makes the legacy spelling a permanent
canonical-AST capability.

| Compatibility spelling                                | Less 4 behavior | Less 5 behavior                                                     |
| ----------------------------------------------------- | --------------- | ------------------------------------------------------------------- |
| Numeric-leading variable name, such as `@1` or `@{1}` | Accept and warn | Removed: report the precise unsupported-syntax diagnostic.          |
| Dash-only mixin name, `.-()`                          | Accept and warn | Removed: report the precise unsupported-syntax diagnostic.          |
| Plain `@name` in an interpolated position             | Accept and warn | Removed: recognize it, report the exact `@{name}` fix, and recover. |
| Whitespace between a mixin name and call parens       | Accept          | Accepted with deprecation diagnostic.                               |
| Paren-less mixin call                                 | Accept          | Accepted with deprecation diagnostic.                               |

The warning/fatal diagnostic is a plugin/context diagnostic, not a parser side
effect. The parser still owns enough structure for removed syntax to produce a
better message than a generic expected-token failure. The source forms were
verified against Less 4.6.3 before this policy was recorded.

## Phase C — config-lane URL / import features

The local URL-rewrite portion of this phase has graduated. `rewriteUrls`,
`rootpath`, their combined imported-file behavior, and `urlArgs` all run through
the typed URL/import transform path. The full corpus now passes the dedicated
rewrite/rootpath/url-args fixtures; `static-urls/urls` retains only the separately
recorded authored multiline-value spelling difference. Remote source loading is
the sole remaining Phase C feature and still needs an owner-approved network/IO
allowlist.

| Fixture                                                    | Feature                                                                                | Current disposition                                      |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `rewrite-urls-all`, `rewrite-urls-local`                   | `rewriteUrls` mode (all / local) — rebase `url()` paths relative to the importing file | **IMPLEMENTED**                                           |
| `rootpath-rewrite-urls-all`, `rootpath-rewrite-urls-local` | `rootpath` + `rewriteUrls` combined                                                    | **IMPLEMENTED**                                           |
| `static-urls/urls`                                         | static `url()` handling under rewrite                                                  | **IMPLEMENTED**; only authored-layout mismatch remains   |
| `url-args/urls`                                            | `urlArgs` — append a cache-busting arg to every `url()`                                | **IMPLEMENTED**                                           |
| `import/import-remote`                                     | Remote URL imports that fetch and inline external Less sources                         | **DEFERRED** — needs explicit network/IO allowlisting     |

The implemented rows are option-plumbing over the URL/import handling that the
core already owns. They are retained here to keep the original phase inventory
auditable rather than silently deleting completed commitments.
`process-imports/google.less` graduated on 2026-07-28: `processImports: false`
now leaves remote/CSS imports un-inlined in the public alpha fixture lane.
Remote URL import loading remains excluded from the alpha fixture lane until the
resolver has an explicit allowlist/security model for network access.

## Phase D — source maps

| Fixture                                                                                                    | Feature                                              | Why deferred                                            | Target  |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- | ------- |
| `sourcemaps-basepath`                                                                                      | `sourceMapBasepath`                                  | needs `.map` emission + a source-map output harness     | Phase D |
| `sourcemaps-include-source`                                                                                | `sourceMapIncludeSource` (inline sources in the map) | same                                                    | Phase D |
| `sourcemaps-rootpath`                                                                                      | `sourceMapRootpath`                                  | same                                                    | Phase D |
| `sourcemaps-url`                                                                                           | `sourceMapURL` (annotation)                          | same                                                    | Phase D |
| (suite) `sourcemaps/basic`, `sourcemaps/custom-props`, `sourcemaps-disable-annotation`, `sourcemaps-empty` | general `.map` output correctness                    | the render API emits CSS only today; no `.map` artifact | Phase D |

**Hard dependency:** source-map output maps generated CSS bytes back to source
positions. On the projecting spine that requires a **decided emit-time provenance
model** — resolving a computed value's source position from the enclosing
source-bearing construct at emit time, gated on `tracksSources`. That model is an
open design item (M1 / emit-context provenance); source maps are sequenced strictly
after it settles. The external Less wrapper currently rejects source-map options
as unsupported in alpha; in Jess, `renderToResult` returns CSS/diagnostics only
and does not expose a `map` artifact yet.

## Phase E — legacy Less host APIs

Less 5 alpha.1 supports the Jess plugin route and the Less `@plugin`
function-registration path needed by the active fixture lane. It does **not**
promise the full Less 4.x host API surface.

| Fixture | Feature | Why deferred | Target |
| --- | --- | --- | --- |
| `filemanagerPlugin/filemanager` | custom Less file-manager plugin API | needs an explicit resolver/importer bridge and security model | Phase E |
| `preProcessorPlugin/preProcessor` | Less preprocessor plugin hook | rewrites source before parsing; needs a reviewed pre-parse extension boundary | Phase E |
| `postProcessorPlugin/postProcessor` | Less postprocessor plugin hook | rewrites emitted CSS after render; needs a reviewed output-extension boundary | Phase E |
| `visitorPlugin/visitor` | Less visitor plugin API | legacy tree visitor ABI does not map directly to the canonical Jess tree/projection model | Phase E |
| `plugin-module`, `plugin-preeval` | legacy CommonJS plugin graphs and pre-eval/tree visitor behavior | requires compatibility decisions beyond ordinary Less `@plugin` function registration | Phase E |

These are release-note limitations for the first alpha, not silent fixture
drops. When one graduates, add focused API/diagnostic tests before adding the
upstream fixture to the public alpha lane.

## Related deferrals tracked elsewhere (not config-lane)

- **Eval-path correctness cluster** (property/namespace lookup crashes, mixin
  "no matching", nested-render failures) — deferred to the **D-EVAL flip** (Phase
  B); the spine subsuming nested-render/lookup is expected to graduate many at once
  rather than needing independent fixes. **The `CUTOVER-STATUS.md` tracker is
  retired** — it now lives at
  `docs/architecture/core/archive/CUTOVER-STATUS-2026-07-18.md`, and
  `docs/architecture/core/README.md` says archived files are for archaeology and
  must never be cited as current. Use `docs/architecture/core/HANDOFF.md` as the
  live entry point instead.
- **Permissive `--*` custom-property parsing** (`permissive-parse.less`) —
  implemented at the **CSS-parser base level** and pinned by
  `css-parser/test/custom-property.test.ts`; there is no remaining custom-property
  grammar feature in this fixture. The fixture itself remains outside the v5 lane
  because it begins with bare `@function-name` interpolation in an at-rule prelude,
  which settled P7 rejects in favor of `@{function-name}`. Its later golden rows
  also encode bare-variable custom-property evaluation that settled P2 leaves
  literal unless explicitly interpolated.
- **Bare selector capture `*[...]`** (`parse-interpolation.less`) — implemented
  in both the Jess and Less parsers; there is no remaining selector-capture
  feature work in this fixture. Its final mismatch is an **intended output-policy
  divergence** (owner ruling 2026-08-22): local `collapseNesting:false` preserves
  the captured parent/suffix-ampersand child boundary, while explicit collapse
  produces the golden `.fruit-cap-apple, …` branches. Less `each()` is the opt-in
  for one emitted rule per ordinary list item without changing global nesting.
  The same fixture also exposes two independent OPEN O8 output-policy questions: whether
  an interpolated multi-branch nested header keeps the canonical one-branch-per-line
  form, and whether leading whitespace inside an escaped quoted selector is
  preserved at the header boundary. The maintained golden also has `foo: bar`
  where the quoted-case source says `foo: baz`. Those rows require owner
  reconciliation; they are not remaining selector-capture implementation work.
