# The perf drift gate

**Status: LANDED, DISABLED. `PERF_GATE` defaults to `off`.**

Enabling it is an owner decision and must not happen before the
[enablement checklist](#enablement-checklist-owner) is satisfied. The spec this
implements is `docs/architecture/parser/GRAMMAR-REVIEW-STANDARD.md` §"The drift
gate"; that section remains the authority on intent.

---

## 1. What it defends against, and what it must not do

The failure mode is **twenty consecutive `+2%` commits that each read as noise
and compound to `+49%`**. A differential gate cannot see it: with a ±1.4–3.6%
noise floor a `+2%` commit reads as inconclusive, lands, and then *becomes the
reference for the next measurement*. Nothing in that loop remembers where the
cleanup started.

The opposing constraint is stronger, and it wins every design argument here:

> `c3db7e53e` is the repo's own record that **gates which are red on an
> untouched checkout are not gates; they teach people to reach for
> `--no-verify` on the ones that matter.**

That risk is measured, not theoretical. `parse-bench.mjs` with
`BENCH_CASES=css-corpus` runs 33 files / 6.5 KB, ~1.2 ms per pass. Eleven
identical processes at one commit, same built artifact, no source change,
produced AST medians spanning **−11.8% to +26.4%**. A warmup sweep drifted
monotonically upward in wall order (1.067 → 1.012 → 1.105 → 1.114 → 1.516 ms).

**A gate on that corpus would fire constantly and be bypassed within a week.**
So: a false alarm is a worse outcome than a missed regression, and every
not-a-pass outcome below (`UNRESOLVED`, `NO_BASELINE`, `UNCALIBRATED`,
`COMPARATOR_MISSING`, `BUILD_UNVERIFIED`, `WORKLOAD_INVALID`) exits **zero**.

---

## 2. Where it lives

| File | Job |
| --- | --- |
| `scripts/perf-gate/index.mjs` | orchestration, tiering, verdict, trailers, escape hatch |
| `scripts/perf-gate/stats.mjs` | paired-difference statistics and **resolving power** |
| `scripts/perf-gate/measure.mjs` | interleaved runner, build verification, workload validation |
| `scripts/perf-gate/comparators.mjs` | comparator registry (**seam**) |
| `scripts/perf-gate/baseline.mjs` | committed baseline + rebaseline guards (**seam**) |
| `scripts/perf-gate/chain.mjs` | `Perf-AB:` trailer chain accumulation detector |
| `scripts/__tests__/perf-gate.test.mjs` | 22 tests, including the no-misfire proof |

Invoked from `scripts/prepush-dispatch.mjs` — the existing tiered dispatcher,
extended rather than duplicated.

---

## 3. How the number is computed

### Ratio, not milliseconds

Each case measures **jess time ÷ an in-run comparator** (`lessc` 4.x for Less,
PostCSS for CSS, dart-sass for SCSS) on the same corpus in the same process.
Absolute ms encode the machine, its thermal state and the node version, so a
committed absolute floor produces false alarms on any box that is not the one it
was recorded on. A ratio cancels that, which is what makes **one** baseline valid
on a laptop and in CI. It is also the same axis as the standing goal of Less
alpha reaching 4.x parse performance.

**No structure adjustment, ever.** PostCSS parses materially less structure than
jess does and the goal is to beat it anyway (owner, 2026-07-30). The comparator
`caveat` string describes the difference so the number is interpretable; the
number itself is never adjusted by it.

### Paired within the round, not median-vs-median

Interleaving samples is *not* sufficient. Under a monotone drift,
`median(A)` vs `median(B)` compares two different regions of the drift curve.
Instead, each round measures jess and the comparator **adjacently** and reduces
them to one observation, `ln(a) − ln(b)`, before anything is aggregated.
Whatever the machine was doing during round *r* affects both halves of round *r*
and divides out. Rounds alternate A-B / B-A so residual ordering bias cancels.

Logs rather than raw differences because the gated quantity is a ratio:
multiplicative noise becomes additive, and `exp(mean)` is the number reported.

### Against a committed baseline, not the parent commit

`docs/perf/perf-drift.baseline.json` is a fixed absolute floor — exactly as
`oracle-byte-identity.baseline.json` is for correctness. Drift is measured from
the start of the cleanup rather than from yesterday, which is what makes gradual
decay visible at all. Cases are **named** (`dialect/surface/corpus`); a single
pooled number cannot distinguish "nothing moved" from "one case got faster and
another got slower".

---

## 4. Resolving power — the most important part

Every run reports the smallest relative effect it could actually have detected
(two-sided α = 0.05, 80% power):

```
mde = (z₀.₉₇₅ + z₀.₈₀) · s / √n        s = sd of the paired log-differences
```

The uncertainty that matters when comparing against a *committed* baseline is
not the within-run interval alone — the baseline was measured in a different
process, on a different machine, at a different time. Three components combine
in quadrature:

```
resolvable = √( mde_thisRun² + mde_baseline² + nullBias² )
```

`nullBias` is the **measured same-commit A/B spread** — the empirical answer to
"how far apart do two measurements of the *same code* land". If it is absent the
gate returns `UNCALIBRATED` and grades nothing. That is deliberate: it is the
structural reason the gate ships disabled.

**If `resolvable > threshold`, the gate refuses to emit a verdict.** Not a pass
(which would launder drift) and not a fail (which would misfire). It says which
threshold the corpus cannot see and how many rounds would be needed:

```
roundsToResolve = n · (mde / target)²
```

### Measured on this repo at `dc563e4f9`

| case | corpus | n | ratio | resolving power |
| --- | --- | --- | --- | --- |
| `less/ast/test-data` | 136 files, 136.7 KB | 25 | 3.864x | **±8.30%** |
| `less/ast/test-data` | 136 files, 136.7 KB | 70 | 3.564x | **±4.91%** |

Two findings the owner needs before enabling anything:

1. **The largest available corpus at the default 25 rounds resolves only
   ±8.3%.** It cannot enforce a 5% threshold. The `roundsToResolve` prediction
   (~69 rounds) was verified empirically: at 70 rounds it reached ±4.91%.
2. **The ratio moved 3.864x → 3.564x (≈8%) between two runs of identical code.**
   That cross-run bias is *larger* than the within-run resolving power at n=70.
   Within-run precision is therefore **not** the binding constraint — `nullBias`
   is, and it is exactly the quantity the null-calibration work must supply.
   Until it exists, no threshold below roughly 10% is defensible.

---

## 5. Accumulated drift

Two mechanisms, different jobs, both required.

**The chain detector** (`chain.mjs`) reads `Perf-AB:` trailers from
`git log <baseline.signOff.acceptedAt>..HEAD` and sums them in log space. Eight
consecutive commits that each shrugged `+1.5%` are visibly `+12.7%` in the log.
It also flags **direction**: N consecutive positive sub-noise results is a real
regression being laundered one commit at a time.

This is a **detector, not a measurement** — composed deltas are not reliable
arithmetic. A chain alarm never fails a push on its own; it demands the absolute
re-measurement and makes an `UNRESOLVED` absolute result loud instead of quiet.

**The absolute baseline ratio** is the truth check, and it is inherently
cumulative because the baseline does not move.

A commit with no measurable surface must still say so —
`Perf-AB: none (no measurable surface)` — so a missing trailer always reads as an
omission and never as "not applicable".

---

## 6. Tiering

| tier | trigger | cost |
| --- | --- | --- |
| `skip` | `docs/**`, `*.md`, `.cursor/**`, `packages/docs/**`, tests | none |
| `light` | any other source | none; reminds about the trailer |
| `full` | `packages/syntax/*/*/src/{,ast/}grammar.ts`, `src/productions/**`, `packages/core/src/ast/**` | build verification + A/B |

A gate that taxes unrelated work is a gate people route around.

---

## 7. Build verification

A worktree without `node_modules` has been observed to make
`pnpm run build:release` **exit 0 while every package fails**. A zero exit code
is therefore not accepted as evidence of anything. Before any timing:

- repo root `node_modules` must exist;
- `<pkg>/lib` must exist and contain `.js` artifacts;
- newest `lib` mtime must not be older than newest `src` mtime (staleness).

**Workload validation.** The timed loop swallows per-source errors on purpose —
the corpora deliberately contain invalid stylesheets and rejecting them is part
of the workload. That tolerance is a trapdoor, and it opened during development:
a wrong lessc entry point threw on every input across all 25 rounds and the
harness reported `ratio 2.936x CI95 [2.435, 3.540]` — a confident interval
measuring nothing but exception cost. Both sides' parse success rates are now
counted before timing, reported in the output, and enforced at ≥50%.

`Perf-Env:` reports the **resolved parseman path** as well as its version. A
stale `link:` or a parent-directory `node_modules` fails silently and cleanly.

---

## 8. The escape hatch

`--no-verify` leaves **no trace in git history at all**. The honest path must
therefore be easier than the dishonest one. On a `FAIL` the gate prints:

```
git commit --amend --no-edit --trailer "Perf-Override: <reason, >=12 chars>"
```

A recorded override passes the gate and is permanently auditable via
`git log --grep "Perf-Override"`. An accepted regression becomes **visible**
rather than invisible.

---

## 9. Rebaselining

Without owner sign-off an agent simply rebaselines the drift away and the
ratchet is theatre. Four structural constraints, none of which rely on an agent
choosing to behave:

1. **Nothing writes the live file.** `pnpm perf:baseline:propose` emits
   `perf-drift.baseline.json.new`, mirroring the existing
   `oracle:less:byte-identity:write` convention. Promoting it is a manual owner
   action, and the proposal ships with `acceptedBy` / `reason` literally set to
   `UNSIGNED`.
2. **A push may not change the baseline and a gated source file together.**
   Landing a regression alongside the rebaseline that hides it is two separate,
   individually reviewable pushes.
3. **`history` is append-only.** Mutating or dropping a past entry is a hard
   failure, so the record of where the ratchet started cannot be erased.
4. **The diff is loud.** One case per line, sorted, ratio inline — a rebaseline
   shows exactly which number moved and by how much.

A baseline whose recorded `mdePct` does not resolve its own `thresholdPct` is
rejected as invalid.

---

## 10. Proof it does not fire on a clean checkout

`scripts/__tests__/perf-gate.test.mjs` — 22 tests, all passing at `dc563e4f9`:

- *is disabled by default and does no work*
- ***passes on an unmodified checkout even in enforce mode*** (`PERF_GATE=enforce`, exit 0)
- *never exits non-zero in report mode*
- *recovers a known ratio through a large monotone drift* (40% drift, error < 0.01)
- *refuses a verdict when the workload cannot resolve the threshold*
- *refuses a verdict when no null calibration has been recorded*
- *passes an unchanged ratio and **fails a real accumulated regression*** — the
  20 × `+2%` → `+49%` scenario is caught
- *does not fail a drift that exceeds the threshold but not the noise floor*

Run with `pnpm perf:gate:test`.

---

## 11. Open seams

| seam | consumed as | status |
| --- | --- | --- |
| PostCSS comparator bar | `COMPARATORS.postcss` in `comparators.mjs` | **stubbed** — `postcss` does not resolve in the workspace; gate reports `COMPARATOR_MISSING` → `UNRESOLVED`, exit 0 |
| Baseline file format | `baseline.mjs` schema 1 | **stubbed** — file absent; gate reports `NO_BASELINE`, exit 0. Only `normalise()` changes if the shipped format differs |
| Same-commit null calibration | `baseline.calibration.nullBiasPct` | **stubbed** — absent; gate reports `UNCALIBRATED` and grades nothing |
| dart-sass comparator | `COMPARATORS.dartSass` | `sass` does not resolve; also has **no parse-only API**, so its ratio is not comparable to css/less. Interpret per-case, never pooled |
| `less/ast/benchmark` case | `measure.mjs` `CASES` | `benchmark.less` has `@import`s, so `less.parse` resolves asynchronously and cannot be paired-timed. Needs an import-free variant |

---

## Enablement checklist (owner)

The gate must not be enabled until **all** of these hold. Each is currently
unmet.

- [ ] **Null calibration run and recorded.** Same-commit A/B, quantifying
      cross-run and cross-worktree bias, written to
      `baseline.calibration.nullBiasPct`. Until then the gate grades nothing.
      *Observed here: ≈8% between two runs of identical code — expect the
      honest floor to be high.*
- [ ] **Baseline committed** at `docs/perf/perf-drift.baseline.json` with a real
      `signOff` block (`acceptedBy`, `reason`), promoted from a `.new` proposal
      in a push that changes nothing else.
- [ ] **Resolving power recorded per gated case, and it exceeds the threshold
      that case enforces.** `validate()` rejects any case where it does not.
      *Currently `less/ast/test-data` needs ≥70 rounds to reach ±4.91%, and no
      other case is measurable at all.*
- [ ] **A comparator resolves for every gated dialect.** `postcss` and `sass`
      are absent from the workspace today.
- [ ] **`PERF_GATE=report` run across several real commits** with no `FAIL` on
      changes believed to be perf-neutral.
- [ ] Then, and only then, set `PERF_GATE=enforce` (env or `.perf-gate.json`).

Recommended intermediate step: run at `PERF_GATE=report` for a cleanup phase and
read the accumulated chain. That yields the drift signal with **zero** risk of
teaching anyone to reach for `--no-verify`.
