# LLM Quality Enforcement — Design v1 (post-adversarial-review)

Supersedes v0. v0's thesis ("AST-lints are the strong layer; teeth in CI") survived only *half*
intact after three independent adversarial reviews. This v1 is what they converged on.

## What the review changed (the three convergent findings)

1. **Confidence was inversely correlated with cost.** v0 mechanically caught the *cheap, textual*
   incident (serialize→regex) and fell back on model-dependent prose for the *biggest* costs
   (polymorphic node shapes ~50% C++, extend O(n·m)). "It catches what's easy to lint and hopes a
   model catches what actually matters."
2. **AST-lints are regression pins, not the backbone.** They catch the exact filed shape (~90%) but
   the *class* only ~20–30% — every evasion (extract-to-helper, alias `serialize`, `indexOf` vs
   `.includes`, split a 20-arm choice into two 12s, dedupe the source but keep the re-scan) yields
   byte-identical output and identical cost, so all other gates stay green.
3. **The only unbypassable gate is GitHub PR CI + branch protection.** Husky/`--no-verify` is routine
   here (memory confirms). Claude PostToolUse hooks do NOT fire on Codex edits. And **the repo already
   has six perf gate scripts that gate nothing on a normal PR** — the highest-leverage, nearly-free move.

**Rebalance:** the spine is **(A) deterministic-cost gates in PR CI + (B) a checklist-driven,
evidence-citing reviewer**. Lints are demoted to regression pins. Prose/skills are guidance backed by
a hard gate, never the gate.

## The spine (three layers that actually resist evasion + shared blind spots)

### A. Deterministic-cost gates in PR CI (the real teeth — cost can't be hidden by a rename)
- **Shape-stability assertion (top priority — defends the #1 cost).** A dev/test harness records each
  node `type`'s field-key signature at construction and **fails on a second shape per type**. Directly,
  non-noisily detects the polymorphism that becomes megamorphic keyed-store cost — which no lint or
  wall-time budget can see. Pair with a lint banning `delete node.*` / conditional field assignment /
  `{...node}` spread on AST nodes; require construction through one frozen factory.
- **Operation-counter budgets (defend the complexity costs deterministically).** Instrument counters:
  (a) extend work **must be zero** on an extend-free fixture → kills `documentHasExtend` where no
  "don't tree-walk" lint can be both precise and low-false-positive; (b) extend comparison-op count at
  N vs 2N selectors **must not grow super-linearly** (~4× ⇒ quadratic) → kills O(n·m) regardless of code
  shape. These are byte-identity-invisible and lint-invisible; only a counter sees them.
- **Deterministic proxies block; wall-clock does not.** Alloc counts, shape-transition counts, arm
  counts, node counts, byte-length are identical across runs → hard blocking gates, zero flakiness.
  Wall-clock is advisory *unless* measured the disciplined way (below) and retry-confirmed.
- **Clean-build + compose-integrity gate (from a live incident, 2026-07-22).** Phase 2 (`DetachedRuleset`
  rip-out) passed the authoring agent's gate ("scss 140 passed") but was BROKEN on a from-clean build: a
  stale/incremental worktree build kept an old scss lib whose grammar still had the composed rule, masking
  `compose(): rule "Call" references missing rule "AnonymousMixin"` (a dangling CST reference). A fresh
  rebuild hard-failed 3 test files. Two deterministic detectors this yields: (1) **gates MUST run from a
  clean build** — delete `lib/`, serial topo rebuild — never trust an incremental build to re-verify
  regenerated artifacts (grammar codegen); (2) a **compose-integrity check that FAILS on any grammar
  `compose()` "missing rule" / "falling back to runtime" warning**. Both are deterministic, zero-flakiness,
  and would have caught this before merge. (This is exactly the incident→detector learning loop below.)
- **Wire the six gates the repo ALREADY has into `pull_request` CI** (currently only in the manual
  `release:alpha:check`): `verify:aggressive-cutting-review`, `verify:node-copy-frontier`,
  `verify:materialization-frontier`, `verify:render-buffer-frontier`, `verify:binding-lookup-hot-paths`,
  `audit:node-creation`; plus run `pnpm lint` + `pnpm ci` (no workflow runs them today). **This realizes
  most of the enforcement with near-zero new code and is step 0.**

### B. Checklist-driven, evidence-citing reviewer (defends intent — can't be fooled by indirection)
- The `perf-architecture-reviewer`'s real authority is the **`docs/perf/V8-ARCHITECTURE.md` checklist**,
  NOT model diversity (both LLMs share the V8 blind spot that caused these incidents). Each checklist
  item is a blind-spot patch: "does this add a conditional field / `delete` / shape divergence? y/n +
  evidence." Force the answer.
- **Output must be evidence, not a verdict.** "Approved" is invalid. Required: "shape base=3 PR=3, alloc
  base=N PR=N, extend re-derived O(n) not O(n·m) because …". A review that can't cite the deterministic
  proxies (from A) is auto-rejected → rubber-stamping is mechanically detectable.
- **The reviewer is cross-checked against the CI budgets** (if it says "no alloc regression" but the
  proxy shows +30%, CI catches the contradiction) and **has its own regression suite**: every past
  disaster (selectorAtoms, documentHasExtend, extend-includes, 20×7 choice) is a fixture; a reviewer
  prompt/model change that stops catching a known incident is a reviewer regression.
- **Automated cross-model:** a GitHub Action on core/grammar PRs sends `diff + design/NNN.md +
  V8-ARCHITECTURE.md` to a model **API** (the opposite provider from the branch author) as a **required
  status check**. Until it's an API-backed required check, cross-model review is prompt-dependent hope.

### C. Lints = regression pins (precision-gated, never the backbone)
- Custom ESLint pack (built, `error`, in CI): serialize→reparse (**interprocedural taint**: source =
  any `serialize`/`*Canonical` return, sink = any string-scan, followed across helpers — same-function
  matching is defeated by one extract-to-helper); recursive full-subtree walk under an explicit hot-dir
  allowlist; `choice(...)` arm-count > N + duplicated-choice detection; ban deprecated node names.
- **Precision policy (the #1 killer is false positives → muting):** every new lint ships **advisory for
  a 2-week bake and must clear <5% false-positive on real PRs before it may block**. A bare
  `// eslint-disable` fails CI — only a structured, greppable `invariant-waive(rule-id, reason,
  tracker)` is allowed; **waiver-count dashboard auto-flags a rule for retirement** when waivers climb;
  waivers expire. Precision > recall for blockers; the reviewer (B) absorbs recall as comments.

## Cross-tool enforcement (the corrected reality)
- **The only model-independent gate is GitHub PR CI + branch protection.** Husky is local + `--no-verify`
  is routine → not a gate. Everything that must hold terminates in CI.
- **Codex reads `AGENTS.md`** — NOT `CLAUDE.md`, NOT `.cursor/rules`. `AGENTS.md` currently has ~zero
  perf/invariant content. **Add the Codex surface**: `CLAUDE.md` + `AGENTS.md` + `.cursor/rules/*` must
  all reference the same canonical `INVARIANTS.md` + `V8-ARCHITECTURE.md`, enforced by a **surface-parity
  CI check**. Move Codex skills INTO the repo (they're hand-copied to `~/.codex/skills` today → invisible
  drift) so the parity check can see them.
- **Claude PostToolUse hooks fire only on Claude edits** → demote to a Claude-only *convenience* that
  duplicates the real gate. The model-independent equivalent is **git pre-commit + CI**.

## Learning loop (so it doesn't decay)
An architectural incident **cannot be closed until it emits a detector**: a deterministic budget
(preferred — evasion-resistant), a pinned lint (regression only), OR an explicit reviewer-checklist item
tagged "not mechanizable". The incident-filer owns producing it (low bar). A quarterly waiver/false-positive
review retires dead rules. Incidents add rules; waiver-pressure removes them.

## The knowledge layer (V8-ARCHITECTURE.md — canonical, feeds skill + reviewer + checklist)
Monomorphic node shapes (fixed field set+order, one hidden class per type); allocation discipline (no
hot-path `[...spread]`/clone; single-value fast-paths); never re-derive structure from bytes you have
structured; never full-tree-walk in hot paths (parse flags + O(1) bitset fast-reject); lazy + cache
derived keys on immutable nodes; dispatch a leading token once then switch; **clean-room rewrite preserves
DESIGN PRINCIPLES / complexity class, not necessarily code** (the extend lesson); consult the tuned impl
before rewriting.

## Placement & weight (MUST NOT slow local commit/push)
Owner constraint: commits/pushes must stay fast — the slow pre-push dependent-retest ("zillion years") is
the anti-goal. So:
- **All heavy gates live in CI (server-side), triggered on PRs** — clean-build + the six perf scripts +
  budgets + compose-integrity + shape-stability + the reviewer. These never run on a local commit/push.
- **Local = ONE manual `pnpm verify:pr` command** that runs the same gate a PR would, opt-in, for when a
  dev wants the full check before pushing. NOT wired into git hooks.
- **Git hooks stay LIGHT:** pre-commit = fast staged-line lint only; **remove the slow dependent-retest
  from pre-push** (move it to CI). Nothing heavy fires on commit/push.
- **Enforcement (branch protection / required checks) is enabled when we take on external contributors.**
  Until then the CI gates run and report but are advisory; internal flow stays fast + trust-based, backed
  by the manual `verify:pr` when wanted.
- Corollary for the "maybe move to PRs" question: the CI gates presume a PR to run against. Adopting a
  PR-based flow (even self-merge PRs) is what activates the server-side teeth; direct-push-to-dev keeps
  only the manual local gate. Recommend PR-based for anything touching core/grammar/eval.

## Rollout order (leverage-first)
0. **Wire the six existing gate scripts + `pnpm lint`/`ci` into `pull_request` CI.** Near-zero code, realizes most of A immediately.
1. Shape-stability assertion + operation-counter budgets (the two biggest costs; deterministic).
2. `V8-ARCHITECTURE.md` + the reviewer as an API-backed required status check (evidence-citing, with its regression suite).
3. Interprocedural-taint lint pack, advisory→earn-blocking under the precision policy.
4. `design/NNN.md` presence check for core/grammar PRs + the "reinvent tuned code?" backstop = the complexity budgets in (1).
5. Surface-parity check + move Codex skills in-repo + add perf content to `AGENTS.md`.
6. Learning loop + quarterly waiver review.
