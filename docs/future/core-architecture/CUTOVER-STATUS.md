# Cutover Status — compact board

At-a-glance status of the single-eval-emit cutover + core slimming. **Kept current by the orchestrator** (update on every land/dispatch; if stale, distrust it and reconcile against `git log origin/work/cutover-p1` + the ratchets). Canonical detail lives in `CUTOVER-CHECKLIST.md` (governance) + `P4-ENDGAME-PLAN.md` (sequence) + per-workstream design docs.

Legend: ✅ landed on `work/cutover-p1` · 🔵 in-flight · ⏸ queued (core-lane serializes) · 🔒 gated/deferred

Tip: `origin/work/cutover-p1` = `84e61a580`.

## ✅ Landed
- **Extend (spine, faster than eval, byte-identical):** common modes, Cases 1–3, Shape 4, extend-nest, extend-selector, #4a expanded-mode; combinator subjects/targets; partial list-targets; trailing/mid descendant wraps. **Perf: O(n²)→O(n) fan pre-reject — 2.4× slower → 1.37–1.43× faster.** Ratchet 61/61.
- **Mixin:** terminal-sink A/B/C (ruleset-as-mixin, mixed-match, non-recursive nested-call), #6 intermediate-scope closure.
- **At-rule:** @layer/@scope/@property folded; ampersand-append folded.
- **Imports:** common modes + transitive nested-linking bug fix.
- **Value/decl:** `@x ?:` (CondAssign) + same-scope `setDefined` folds; `:=` (nearestOuter) EVAL ORACLE implemented (spine fold deferred).
- **Slimming:** `!important` constant → bare string (Any reduction); lean-selector string-form consumers + 16 tests; string-forms model (ComplexSelector/RelativeSelector positional).
- **Parser (on dev+alpha):** grammar-thinning wrapper drops (css/less/scss/jess) + SelectorCapture interior-trivia fix.
- **Docs (unblock producer work):** STRINGS-OVER-NODES, P4-ENDGAME-PLAN, conditional-decls, extend-4a, any-name-reduction, basic-selector-boundary, parseman-trivia-audit.

## 🔵 In-flight
- **interpolated-name fold** (M8 interpolated-selector callable + V4 interpolated var-name + R2 interpolated at-rule-name) — the plan's 3-for-1.

## ⏸ Queued P4 folds → 100% spine coverage (core-lane, one at a time)
- nested-container mixin body
- merge-across-mixin / mixin-as-value / detached-ruleset arg
- import edge-modes: interpolated-path retry, extend-through-import, compose/forward
- reference-mode; value frontier; at-rule-`&`-through-hoist
- **measured-last (A/B, revert-churn risk):** namespace-merge, recursive-arg mixin
- **extend hard-tail (poor-ROI-last):** (A) multi-branch selector-list subjects + nested-ruleset-subject targets → fully flips `extend.less`; (B) extend-in-@media (at-rule-scoped gather)
- inner-fallback elimination (mixin/import `kind:'eval'` candidates)

## 🔒 Gated / deferred (not blocked-on-me)
- **Producer flips** (jess-parser emits strings: BasicSelector-position, Any static tokens) — gated on parseman trivia compiler change. Keystone STRINGS-OVER-NODES + never-revert guardrail in place.
- **parseman trivia compiler change** (Option A fuse-time default vs B caller-context) — **owner's other agent**.
- `:=` spine fold (mechanism-B); cross-scope `setDefined`; node-field slimming.

## 🎯 The deletions — D-EVAL flip (ALL-OR-NOTHING, gated on 100% coverage; one coordinated flip)
Deletes together: eval two-walk (`evalForRender`/`Rules.derive`/`_deriveShell`) + output-tree staging + clone families (D1) + `F_STATIC`/`F_NON_STATIC`/`F_HAS_NODE_CHILD`/`F_CHILD_DERIVED` + `propagateFlagsFrom` (D2) + TreeVisitor/preSerializeRoot (D3) + **old extend apply** `extend-roots`/`processExtends`/legacy-`extend.ts` (D4) + `inherit` span (D5). `treeContext` (D6) is NOT independently deletable (it's the per-node provenance carrier — verified) → also rides the flip.
</content>
