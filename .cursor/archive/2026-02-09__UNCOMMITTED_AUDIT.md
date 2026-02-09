# Archived (2026-02-09)

Original path: `.cursor/UNCOMMITTED_AUDIT.md`

---

# Uncommitted vs dev – what changed and why it’s wrong or right

**Core problem you care about:** extend reaching the right selector (e.g. `.me`/`.mf` in `@media (plasma)` extending `.mb`/`.md` in parent `@media (tv)` without merging into ancestor `.md` at `@media (tv)`).

**State you want:** At some point only one file was failing (extend-chaining / media). Now more are failing (extend-chaining, extend-media, extend-nest, at-rules, css-guards, detached-rulesets). So something in uncommitted changes widened failures.

---

## Reverted (done)

- **packages/core/src/tree/util/serialize-helper.ts**  
  - **On dev:** `rules.flatRules(true)`  
  - **Was changed to:** inline filter + undefined `visibleOnly` (build fix band-aid).  
  - **Why revert:** Serialization is unrelated to “extend reaching the right selector”. Touching it was wrong. Restored `rules.flatRules(true)`.

---

## Changes that are not about “extend reaching the right selector”

| File | What changed | Verdict |
|------|----------------|--------|
| **.cursor/changes.md** | Log of work | Keep or drop as you like. |
| **packages/core/…/ampersand.test.ts, at-rule.test.ts, extend-eval-integration.test.ts, extend-roots.test.ts** | Test edits/snapshots | Could have been to match new behavior; may need revert if we revert core. |
| **packages/core/…/extend-ampersand-boundary.test.ts, extend-combinator-handling.test.ts, process-extends.test.ts** | Test edits | Same. |
| **packages/core/…/ampersand.ts, node-base.ts, selector-complex.ts, selector-compound.ts, extend.ts (tree/), extend-helpers.ts, extend.ts (util/), selector-utils.ts** | Mix of debug logs and small logic tweaks | Should be reverted unless each change is justified for “extend reaches right selector” only. |
| **packages/core/…/rules.ts** | Large removal: agent log blocks, syncLog import, and possibly root/stack registration logic | **Critical.** Dev has `context.root` and `extendRootStack` setup before `_multiPassPreEval`. If current code removed or altered that, it could explain “extend targets not accessible” and multiple extend failures. Need to compare root/stack handling line-by-line with dev. |
| **packages/core/…/ruleset.ts** | 274 lines changed | Likely registration/logic. Should be audited: only keep what’s needed for extend root registration. |
| **packages/core/…/at-rule.ts** | registerInnerExtendRootIfHoisted, parent = parentExtendRoot ?? context.root, don’t push for nestable in preEval, lots of syncLog | The *logic* (inner extend root registration, parent, not pushing nestable in preEval) might be necessary for extend to see the right roots. The **syncLog / debugExtendRegistration** blocks are not; strip them or guard so they don’t affect behavior. |
| **packages/core/…/extend-roots.ts** | ~1200 lines removed, ~240 added. Removed syncLog/agent tracing; added processLeadingIs; changed maybeHoistMixedNestingSelectorList (materializeImplicitAmpersand for prefixed check); new “visible roots” / accessible-roots model | **Core file.** The “visible roots” / getAccessibleRoots / isAncestorRoot / sameOrDescendantRoot filtering is the actual “extend reaches the right selector” fix. The rest (removed logging, processLeadingIs, materializeImplicitAmpersand in maybeHoistMixedNestingSelectorList) may have side effects on other tests (e.g. extend-nest, extend-media). |
| **packages/jess/test/less/all-less.test.ts** | One comment removed | Trivial; can revert to match dev. |
| **vitest.config.ts** | Small config change | Unrelated to extend. Revert if it wasn’t intentional. |
| **EXTEND_*.md, docs/extend-ancestor-*.md, .cursor/EXTEND_DEBUG_PLAN.md, packages/jess/scripts/, extend-chaining-ast-compare.test.ts, process-leading-is.ts, process-leading-is.test.ts** | New files / docs | Not needed for the single-file media fix; can be reverted or deleted. |

---

## What to do next

1. **serialize-helper** – Already reverted to dev (`flatRules(true)`).
2. **Don’t touch serialize-helper again** for this bug; the bug is in extend *reach*, not serialization.
3. **Decide strategy:**
   - **Option A (minimal):** Revert all uncommitted changes to dev, then re-apply only the minimal change that makes “extend reach the right selector” (likely in extend-roots: ensure we only merge into rulesets in the same or descendant extend root, not ancestor).
   - **Option B (surgical):** Keep extend-roots “visible roots” / sameOrDescendantRoot logic; revert everything else (rules.ts, ruleset.ts, at-rule.ts to dev, then re-apply only the minimal at-rule/rules registration needed so extend sees nested @media rulesets).
4. **rules.ts:** Compare with dev line-by-line for `context.root`, `extendRootStack`, `registerRoot`, `pushExtendRoot` and any code that runs before `_multiPassPreEval`. If current code is missing logic that was on dev, that could explain “Extend targets … not accessible” and the extra failures.
5. **Strip debug from at-rule.ts:** Remove or no-op all syncLog / debugExtendRegistration blocks so the only remaining change is the extend-root registration logic.

---

## Summary

- **serialize-helper:** Reverted; had no business being changed for this bug.
- **extend-roots:** Contains the real fix (who can extend whom) but also large refactor and other behavior changes; may need to isolate the minimal “accessible roots” change.
- **rules.ts / ruleset.ts / at-rule.ts:** May have introduced regressions (e.g. root/stack not set in time); should be compared to dev and only the minimal registration/stack behavior kept.
- **Everything else:** Revert unless it’s provably required for the single failing case (extend-chaining media).

