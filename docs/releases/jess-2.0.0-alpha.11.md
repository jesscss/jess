# Jess 2.0.0-alpha.11 - draft release notes

> **Draft for owner review.** This note describes the next registry-safe alpha
> candidate after `2.0.0-alpha.10`. It is not a publish announcement: the
> `alpha` branch still needs the controlled source refresh, release preflight,
> owner approval, tag, and npm publish.

## Highlights

### Less alpha package unblocker

This alpha is the Jess runtime closure intended to unblock the external
`less@5.0.0-alpha.1` PR from consuming current Jess package behavior through the
registry instead of workspace links. The sibling Less PR already assembles the
direct Less plugin stack through `@jesscss/compiler` and does not depend on the
batteries-included `jess` package.

After this Jess alpha is published and queryable, the Less PR should bump its
Jess alpha dependencies to `2.0.0-alpha.11`, rerun its built `lessc` smoke
tests, alpha fixture contract, publish dry-run tests, and packed-consumer proof,
then use that evidence for the final Less alpha review.

### Diagnostics

Public diagnostic rendering now writes stable Linecraft frames without leaking a
duplicate live-region render. `lessc` error paths must continue to show colored
Linecraft diagnostics by default, remove control sequences under `--no-color`,
and suppress output under `--silent`.

The external Less PR also routes successful Jess warnings to `stderr`, keeps
CSS-only output on `stdout`, and suppresses warning output under `--quiet`. That
behavior is proved in the Less package, but this Jess alpha is needed before the
external package can prove the single-frame renderer against registry
dependencies.

### Parser architecture

The Less grammar remains on the single host-mode `src/grammar.ts` architecture.
The parser source and focused parser tests no longer carry local `DirectLess*`,
`LessDirect*`, or `LessAst*` migration prefixes; the AST/CST entry rule is the
plain `Document` host-mode grammar.

Function openers in the Less grammar now use the Parseman dispatch/routed shape
for shared generic/specific function starts where that is the right grammar
model. Further grammar work should keep favoring short spec-shaped names,
comments-as-trivia, no reparsing, narrow lookahead, and dispatch only for
already-consumed same-family openers.

### Less behavior fixes

The current dev candidate includes the container query bubbling and formatting
fixes needed by the external Less alpha fixture contract, plus the parser and
diagnostic hardening recorded in the readiness tracker.

## What this alpha does not claim

- It does not publish the external `less@5.0.0-alpha.1` package.
- It does not claim complete Less 4.x corpus parity.
- It does not make SCSS or `.jess` grammar cleanup a release gate for Less
  alpha.1.
- It does not treat parser-performance investigation as a rollback reason for
  the one-grammar parser fold.
- It does not publish from workspace links; registry-backed package resolution
  remains part of the release proof.

## Known Limitations

The Less alpha fixture lane is intentionally a classified compatibility signal,
not a claim that every upstream Less 4.x fixture is byte-identical. The current
release-facing inventory is
[`less-v5-corpus-inventory.md`](../state/less-v5-corpus-inventory.md); the
readiness gates and open package-flow blockers are tracked in
[`less-v5-alpha-readiness.md`](../state/less-v5-alpha-readiness.md).

As of this candidate, the public-route corpus contains 108 exercised cases: 92
ordinary byte-identical checks and 16 active expected-failure checks. The
expected-failure registry contains 26 named cases, including cases outside the
current alpha selection. Those entries document known gaps such as URL/import
option handling, source-map artifacts, removed legacy plugin/parser behavior,
and settled Less 5 policy boundaries. Keep those names visible until the
corresponding behavior is implemented or intentionally removed from the alpha
scope.

## Before publishing

Refresh `alpha` from pushed `dev` with the controlled two-tree patch flow, run
the provenance/version restoration step, review these notes, and run
`pnpm run release:alpha:dry-run`. With explicit owner approval, run
`pnpm run release:alpha` from the clean refreshed `alpha` worktree.
