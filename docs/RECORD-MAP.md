# Jess — Record Map

> The authoritative-source index. For any topic, this says **which document is the
> method of record and what it owns** — so you read the source before proposing,
> instead of planning from memory or a second-hand summary. Curated, not
> exhaustive: it lists the docs you MUST consult, not every file. Big areas link
> to a sub-map that breaks them down further.

**The reflex (why this file exists):** before proposing any architecture /
grammar / semantics / perf / release plan — or a "here are the corrections" list
— find the topic below, open the **method-of-record** doc, and cite it. Never
plan from memory or a recon-agent summary when a record exists. A recon agent
points you at the source; then you read the source. Treat a subagent's
*interpretation* as a lead to verify, never a fact to repeat.

## Owner requirements — never redefine, narrow, or close

- [OWNER-REQUIREMENTS.md](OWNER-REQUIREMENTS.md): every standing owner requirement, verbatim, with stable `OR-*` IDs. **Owner-owned, hash-frozen.** A conflict is an ESCALATION, never a closure. Enforced by `pnpm check:guardrails`.

## Grammar — the four dialect parsers (`packages/syntax/*/*-parser/src/grammar.ts`)

> **Sub-map:** [architecture/parser/GRAMMAR-RECORD-MAP.md](architecture/parser/GRAMMAR-RECORD-MAP.md) — every grammar doc, what it owns, and which parts are stale.

- [design/COMPOSE-MIGRATION-SPEC.md](design/COMPOSE-MIGRATION-SPEC.md): **METHOD OF RECORD** for grammar compose / dedup / Stages A–D. §4 classification method, §5 staged plan, §8 pilot (mechanism PROVEN + the SETTLED-P28 converge decision), §9 CST-name convergence worklist. Read this before ANY compose / Stage-C / "collapse the duplication" plan.
- [design/GRAMMAR-REBUILD-SPEC.md](design/GRAMMAR-REBUILD-SPEC.md): the rebuild spec — **§0 = start here** (status / plan / what-gates-what). Caveat: its §0.2 parseman version and §0.5/§5.x "compose blocked" language are STALE — COMPOSE-MIGRATION-SPEC supersedes them.
- [architecture/parser/GRAMMAR-REVIEW-STANDARD.md](architecture/parser/GRAMMAR-REVIEW-STANDARD.md): the per-`const` review bar + the four hard rules. Applies to EVERY grammar edit; the `grammar-reviewer` gates on it. Evidence-per-const, never a bare verdict.
- [state/GRAMMAR-DEDUP-LOG.md](state/GRAMMAR-DEDUP-LOG.md): the LIVE worklog — lanes, status, evidence. Update it in the same turn you learn something.
- [state/GRAMMAR-SIZE-FACTS.md](state/GRAMMAR-SIZE-FACTS.md): measured grammar-size facts ledger. Re-measure; do not quote stale numbers.
- [architecture/parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md](architecture/parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md): which parseman combinator to reach for.

## Semantics — anything that changes emitted CSS

- [architecture/SEMANTIC-INVARIANTS.md](architecture/SEMANTIC-INVARIANTS.md): **METHOD OF RECORD** — the invariants + incident catalogue. The `semantics-reviewer` gates on it. "Matches less.js" is never a justification.
- [architecture/core/DESIGN-DECISIONS.md](architecture/core/DESIGN-DECISIONS.md): the owner **DECISION LEDGER** (P- / X- / E- / O- / V-series; each SETTLED or OPEN). Cite the SETTLED row a change relies on, or add an OPEN row. Only the owner moves a row to SETTLED.
- [architecture/core/EXTEND-SEMANTICS.md](architecture/core/EXTEND-SEMANTICS.md): extend semantics record (the ledger's X-series rows point here).

## Perf — hot path (core eval/render, grammar/parser, extend/selector)

- [perf/BENCHMARKS.md](perf/BENCHMARKS.md): **METHOD OF RECORD** — the command-first index of every canonical harness, the standard fixtures, and the history/baseline files. Never invent or search for a harness; start here.
- [perf/V8-ARCHITECTURE.md](perf/V8-ARCHITECTURE.md): the numbered perf-invariant checklist + regression-fixture catalogue. The `perf-architecture-reviewer` gates on it.
- [architecture/llm-quality-enforcement-design.md](architecture/llm-quality-enforcement-design.md): the enforcement design behind the reviewers and gates.

## Core architecture / eval-render cutover

- [architecture/core/HANDOFF.md](architecture/core/HANDOFF.md): the ACTIVE entry point for core architecture / eval-render / cutover work.
- [state/PROJECT_STATE.md](state/PROJECT_STATE.md): transient debugging state + latest-baseline notes (not a permanent record — read for current state, not settled design).

## Release — Jess / Less v5 alpha

- [process/less-v5-release-plan.md](process/less-v5-release-plan.md): release STRATEGY + the two-track **operating model** (§Operating model): release cadence and roadmap run in parallel; ship alphas as user-facing work lands.
- [process/releasing-alpha.md](process/releasing-alpha.md): release MECHANICS — branch/version policy, cut the snapshot from `dev`, publish order, one-command flow.
- [state/less-v5-alpha-readiness.md](state/less-v5-alpha-readiness.md): the current-alpha readiness gate.

## Keeping this map honest

Every method-of-record / `*SPEC*` / `*STANDARD*` / `*INVARIANT*` doc must be
listed here. `pnpm check:record-map` fails if a link here does not resolve, and
warns if such a doc exists but is not indexed. When you add, rename, or retire
one of these docs, update this map in the same change.
