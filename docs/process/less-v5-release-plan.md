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

| Fixture                                                    | Feature                                                                                | Why deferred                               | Target  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------ | ------- |
| `rewrite-urls-all`, `rewrite-urls-local`                   | `rewriteUrls` mode (all / local) — rebase `url()` paths relative to the importing file | URL rebasing not implemented               | Phase C |
| `rootpath-rewrite-urls-all`, `rootpath-rewrite-urls-local` | `rootpath` + `rewriteUrls` combined                                                    | depends on rewriteUrls                     | Phase C |
| `static-urls/urls`                                         | static `url()` handling under rewrite                                                  | depends on rewriteUrls                     | Phase C |
| `url-args/urls`                                            | `urlArgs` — append a cache-busting arg to every `url()`                                | not implemented                            | Phase C |
| `import/import-remote`                                     | Remote URL imports that fetch and inline external Less sources                         | needs explicit network/IO allowlisting     | Phase C |

These are option-plumbing over the URL/import handling that the core already does;
each is a contained addition once the render pipeline is stable post-flip.
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

## Related deferrals tracked elsewhere (not config-lane)

- **Eval-path correctness cluster** (property/namespace lookup crashes, mixin
  "no matching", nested-render failures) — deferred to the **D-EVAL flip** (Phase
  B); the spine subsuming nested-render/lookup is expected to graduate many at once
  rather than needing independent fixes. Tracked in `CUTOVER-STATUS.md`.
- **Permissive `--*` custom-property parsing** (`permissive-parse.less`) —
  **owner-decided (2026-07-11): a real gap to FIX, not defer.** Custom-property
  values must accept arbitrary token streams (CSS-spec `<declaration-value>`),
  implemented at the **CSS-parser base level** so it propagates to less/scss/jess
  via grammar composition. (Fix dispatched — active, not deferred.)
- **Bare selector capture `*[...]`** (`parse-interpolation.less`) — NOT a
  deprecation. A NEW feature already implemented in the `.jess` parser
  (`jess-parser` `SelectorCapture`, `grammar.ts:369`); being **ported into `.less`**.
  A real work item, not an owner decision. (Port dispatched.)
