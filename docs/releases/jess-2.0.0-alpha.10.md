# Jess 2.0.0-alpha.10 - draft release notes

> **Draft for owner review.** This note describes the next registry-safe alpha
> closure selected by the release tooling. It is not a publish announcement:
> the `alpha` branch still needs the controlled source refresh, release
> preflight, owner approval, tag, and npm publish.

## Highlights

### Shared compiler package

The alpha publish set includes `@jesscss/compiler`. That package owns the
shared compiler/render pipeline used by `jess` and by dialect-specific package
assemblies such as the external Less 5 alpha. The root `jess` package remains
the batteries-included assembly and CLI surface; downstream packages that only
need Less assembly can depend on the compiler plus Less plugins directly.

The alpha allowlist validates 18 runtime packages and publishes
`@jesscss/compiler` before `@jesscss/plugin-less` and `jess`.

### Less alpha readiness

The Less alpha lane is green enough for the first external alpha once the Jess
runtime closure is published. Current readiness centers on CSS/Less stability,
public Less fixture flow, parser/eval error quality, and the registry-backed
consumer proof for the sibling `less` package.

External `less@5.0.0-alpha.1` should not publish until
`@jesscss/compiler@2.0.0-alpha.10` and the rest of the Jess runtime closure are
queryable from npm. After that publish, the sibling Less branch can refresh its
lockfile and run its `lessc` smoke and packed-consumer checks against registry
dependencies instead of workspace links.

### Parser architecture

All four shipped parser dialects are folded to one host-mode grammar source per
dialect. Parseman `0.41.x` is the active grammar floor, with macro and compose
integrity proving the shipped parser artifacts compile without interpreter
fallbacks.

The surviving grammar cleanup continues inside that architecture: use
spec-shaped rule names, keep comments as trivia, prefer Parseman
`dispatch(...)` / `routed()` only for shared-opener routes, and keep
`choice(...)` for body/list families and closed token tables.

### Diagnostics

Public Less parser diagnostics now preserve parser-provided ranges for targeted
unsupported syntax such as inline backtick JavaScript, deprecated bare
at-variable interpolation in prelude positions, dynamic `@charset`
interpolation, unsupported variable/mixin names, and unparenthesized mixin
guards.

Parser expected-token summaries also avoid leaking raw internal token lists for
common cases such as invalid value positions, missing delimiters, and duplicate
semicolon expectations.

## Performance note

Current Less parse and render timings are acceptable for alpha.1, but not the
end-state target. The folded grammar remains the architecture; ongoing work is
to reduce intermediate CST/trivia volume, improve Parseman lowering where it
removes real repeated recognition, and prepare static import graphs during
compile so first render does less import work.

Repeated renders of the same compiled document already reuse loaded static
imports within a compiler context. First-render import preparation is tracked
separately in the static import preparation design.

## What this alpha does not claim

- It does not publish the external `less@5.0.0-alpha.1` package.
- It does not claim complete Less 4.x corpus parity.
- It does not make SCSS or `.jess` grammar cleanup a release gate for Less
  alpha.1.
- It does not treat parser-performance investigation as a rollback reason for
  the one-grammar parser fold.
- It does not publish from workspace links; registry-backed package resolution
  remains part of the release proof.

## Before publishing

Refresh `alpha` from pushed `dev` with the controlled two-tree patch flow, run
the provenance/version restoration step, review these notes, and run
`pnpm run release:alpha:dry-run`. With explicit owner approval, run
`pnpm run release:alpha` from the clean refreshed `alpha` worktree.
