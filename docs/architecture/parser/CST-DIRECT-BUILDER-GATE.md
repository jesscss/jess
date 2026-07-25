# A direct builder in a CST grammar loses a node silently

Measured 2026-07-25 on branch `jess-hostmode` (base `dev` @ `8a17d505b`). Everything
here was reproduced in this repo, on both the pinned `parseman@0.32.0` and a local
build of `parseman@0.41.0` (parser-thing `main` @ `d1053a8` — PR #80 plus the #81
follow-ups). The behaviour DIFFERS between those two versions, which is the main
finding.

## The failure

A parseman `node()` has two shapes:

```ts
node(combinator)                    // STRUCTURAL — the ctx.build host builds it
node(combinator, children => …)     // DIRECT     — the callback builds it
```

The four CST grammars (`packages/*/src/grammar.ts`) must be all-structural, because
`cssCstBuildHost` (`packages/css-parser/src/cst.ts`) is what turns a node into a
positioned `{ _tag: 'node', span, … }`. A direct builder returns its OWN object
instead; `isCssCstChild` filters that object out of `children`; the node disappears
from the tree with `ok: true` and no error, warning, or diagnostic anywhere.

Reproduced by giving the css CST's `Declaration` rule a `_children => ({…})` builder:

```
parseCssCst('.a { color: red }')  →  ok: true

Stylesheet
  Ruleset
    SelectorList
      ComplexSelector
        CompoundSelector
          BasicSelector          ← no Declaration
```

## On the pinned 0.32.0, the host flag is the fix

`_parsemanCstOutput` is parseman's contract for "re-route a direct builder through
this host". At 0.32.0 it is read per node at PARSE time, so setting it makes the
re-route actually happen. A/B with the same direct builder, the flag as the only
difference:

| `cssCstBuildHost._parsemanCstOutput` | `.a { color: red }` |
| --- | --- |
| set | `Ruleset > Declaration` — correct |
| absent | `Ruleset` with no `Declaration` — silent loss |

jess's host never set it. That is what this change fixes, and on the version jess
actually ships it is a live correctness fix, not a declaration.

Both host objects need it: `cssCstBuildHostFor(options)` builds a NEW function for the
`collapse` case, and a wrapper does not inherit the marker. Losing it there would
re-open the gap on precisely the language-service path that uses `collapse`.

## On 0.40.0+, the flag stops being enough — and the guard cannot see jess

0.40.0 made host mode a COMPILE-time decision. A direct builder in an artifact
compiled `hostMode: 'ast'` (the default) no longer emits the host branch at all, so
the flag can no longer rescue it. In exchange, `assertHostModeCompatible` is supposed
to throw rather than let the tree degrade.

It does work in general — verified firing on a `compile()`d parser and on a
runtime-`compose()`d one. It cannot see jess's case, for two independent reasons:

1. **`parseCst` never reaches it.** The assertion runs from `parseDoc` and from a
   `compile()`d parser's `parseWithContext`. `parseCst` drives the grammar through
   `run()`, which does not call it — `run()` receives a single rule function, not the
   registry, so it has nothing to read the mode off.

2. **The macro artifact carries no host-mode stamp.** The assertion reads
   `Symbol.for('parseman.fusedHostElided')` off the rule map. `fuseRules` — the
   RUNTIME fuse — stamps it. `emitFusedSource` — the MACRO fuse, which is how all four
   grammars are actually built — does not. It reads `undefined` → `false` → "no direct
   builder was elided" → passes.

Verified on the built artifacts at 0.41.0, flag set, direct builder present:

```
cssGrammar[Symbol.for('parseman.fusedHostMode')]   = undefined
cssGrammar[Symbol.for('parseman.fusedHostElided')] = undefined
cssCstBuildHost._parsemanCstOutput                 = true
→ parseCssCst : NO THROW, Declaration missing
→ parseCssDoc : NO THROW, Declaration missing
```

So on 0.40.0+ the failure is silent again on both jess CST paths. Both gaps are
parseman's and are worth filing upstream; neither is worked around here.

## What guards this now

`scripts/check-cst-direct-builders.mjs`. It parses the CST grammar entry points with
the TypeScript compiler API, follows their workspace imports through each package's
`exports` map to reach every contributing SOURCE module, and fails on any `node()`
whose build slot holds anything other than an options object or an explicit
`undefined` / `void 0` placeholder. Wired into `verify-pr.mjs` and the PR quality
gate; the detector is pinned by `scripts/__tests__/check-cst-direct-builders.test.mjs`.

Following imports rather than hardcoding a file list matters: `scss-parser`'s CST
composes `@jesscss/internal-css-recognition`'s recognition map, and that map is SHARED
with the AST grammars — which have direct builders by design. That shared module is
exactly where one would arrive from.

Being source-level, this gate is the only guard that works on BOTH parseman versions
and on both CST paths.

## Current state

Direct builders reachable from a CST grammar: **0**, across 5 modules —
`{css,less,scss,jess}-parser/src/grammar.ts` and
`internal-css-recognition/src/recognition.ts`. Independently confirms the count the
work started from.

The 22 `node('Operation', …, undefined, { collapse: true })` sites across the four
grammars are the explicit-placeholder form, not builders; the gate accepts them and
its test pins that.

The AST grammars run in the default `hostMode: 'ast'` and are out of scope.

## Why this matters at the eight-grammars-to-four collapse

The collapse is when the AST grammars start serving both consumers, so the
direct-builder count stops being 0 by accident. At that point one grammar source needs
TWO compilations — `hostMode: 'ast'` for eval, `hostMode: 'cst'` for the language
service.

**The macro plugin cannot express that today.** `src/plugin/index.ts` calls
`compileRuleMap` / `compileLinkable` with `{ trivia, scanSkip, recovery, coverage }`
and never passes `hostMode`, so a macro-built grammar is always `'ast'`. Adding
`hostMode` to the macro plugin (and to `emitFusedSource`'s stamping, per gap 2 above)
is the upstream prerequisite for the collapse. This gate is what makes its absence
land as a build failure instead of as missing nodes.

## On the parseman pin

jess stays pinned at **0.32.0**. The 0.41.0 work above was done under a temporary
`pnpm.overrides` entry pointing at a local worktree, which was REMOVED before landing
— an unpublished local path cannot ship (npm `parseman` latest is 0.36.0). Resolution
was verified each way (realpath, version, and `dist/index.js` contents) rather than
assumed.

Worth recording for whoever moves the pin: the whole workspace builds and tests green
on 0.41.0. `check:macro` reports 0 interpreter fallbacks, and all six suites pass —
css-parser 242, less-parser 439, scss-parser 290, jess-parser 248, language-service
189, core 3212. Moving the pin also re-enables `analyzeGating()`, which constraint #2
of `PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md` records as unable to analyze any of the
four grammars at 0.32.0; it now runs during each parser build and emits findings.
Those are informational and were not acted on here.
