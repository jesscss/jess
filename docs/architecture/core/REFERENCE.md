# The Reference (fixed, non-negotiable)

The expected output for every tree2 byte-identity check is the **less.js `alpha`
branch, TOP-LEVEL expected `.css`**, read READ-ONLY via `git show`:

```
git -C ~/git/oss/less.js show alpha:packages/test-data/tests-unit/<fixture>/<fixture>.css
```

The matching `.less` INPUT is read from the SAME tree:

```
git -C ~/git/oss/less.js show alpha:packages/test-data/tests-unit/<fixture>/<fixture>.less
```

Alpha's top-level `.css` is the Jess-v5 output: nested (`collapseNesting:false`)
with `:is()`-COMPACTED extend cascades.

## The single fetch helper (enforced)

Tests MUST obtain the expected `.css` ONLY through
`packages/core/src/tree2-frontend/oracle-source.ts`:

- `expectedCss(fixture)` — the alpha top-level `.css`.
- `fixtureLess(fixture)` — the alpha `.less` input.

Both take a **bare fixture name** and REFUSE any path containing `legacy/`,
`/`, or `..`. No test may hand-pick an expected-`.css` file by path.

## Pitfalls that repeatedly misled agents (do NOT do these)

1. **`legacy/*.css` is NOT the reference, and no test asserts it.** Those are the
   Less-4.x EXPANDED outputs (e.g. `.error, .badError` comma lists instead of
   `:is(.error, .badError)`), recorded when a fixture graduated to v5-expected.
   They are inert historical records — nothing reads them (see DESIGN-DECISIONS
   O5), and each one says so in a header on its first two lines. The helper
   throws if it sees a `legacy/` path.
2. **`graduate-v5`, `alpha-release-port`, or any OTHER less.js worktree/branch is
   NOT the reference.** Only `alpha` in `~/git/oss/less.js`.
3. **`upstream/alpha` is NOT the reference.** less.js's own upstream ships EXPANDED
   (non-`:is()`) extend expected `.css`; Jess v5 `:is()`-compacts. Use the local `alpha`.
4. **`renderRealOracle` / `renderRealOracleNested` are NOT a source of expected
   `.css`.** The legacy Jess-v5 engine has KNOWN extend bugs (nested-extender bare
   fragment; exact-extend leaking into nested children). It may still be used as a
   perf/parity lane for OTHER rungs, but never as the extend expected output.

## less.js worktrees are READ-ONLY

Never `git checkout`, `git switch`, or otherwise modify any less.js worktree or
the `~/git/oss/less.js` repo. `git show <ref>:<path>` reads a blob without
touching HEAD or the working tree — that is the only allowed access.
