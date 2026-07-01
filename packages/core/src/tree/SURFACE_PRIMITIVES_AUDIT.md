# Surface / Copy / Frame Primitive Audit (DRY consolidation)

Tracking doc for collapsing the sprawl of near-duplicate "create a surface",
"copy a node", "derive", "materialize", and scope-frame helpers in core eval.

Goal (per `LIVE_BINDING_ARCHITECTURE.md` §3, §5, §6.2): **one thin-surface
primitive, one frame model, one variable-resolution walk.** Every variant below
must either fold into a parametrized primitive or prove (on object count /
behavior) why it must stay. Collapse to the SMALLEST / most performant form.

**STRICTER STANCE (owner directive):** the copy/clone family is NOT "variants to
tidy" — §5 forbids `clone(deep)`, `*WithReusableLeaves`, deep `cloneForPlacement`,
per-subsystem copy helpers, and `reuseLeaf`/`frozen`. These exist ONLY because
eval still produces per-placement output by copy+mutate (clone-era) and because
`new Foo()` still ADOPTS (reparents) its parts, so a shared template can't be
handed to a constructor without a defensive copy. The end state is DELETION, not
consolidation: share the immutable template, carry placement state in the frame.
Proven concretely: `Declaration.derive` / `deriveWithParts` were copying UNCHANGED
parts for nothing — switched to sharing them, 0 regressions. Full deletion of the
copy family is gated on the constructor/factory split (invariant 7) + `frozen`.

Status legend: 🔴 duplicate to collapse · 🟡 needs review · 🟢 canonical (keep) · ✅ done · ⛔ §5-forbidden (delete, gated on ctor-split)

---

## A. Callable rules surfaces (`util/callable-surface.ts`) — ✅ DONE
- ✅ Collapsed `createUnlockedCallableRulesSurface` + `createOwnedCallableRulesSurface`
  (byte-identical) into the single primitive `createCallableRulesSurface`
  (renamed from `createShallowCallableRulesSurface`).
- ✅ Collapsed the interface param pair `createOwnedRules`/`createUnlockedRules`
  → single `createCallableRules` across `callable-candidate-loop.ts`,
  `callable-candidate-state.ts`, `callable-special-case.ts`, `callable-eval.ts`
  (+ 4 test files). Removed a dead `canUseUnlockedRules` F_STATIC ternary and a
  now-unused `F_STATIC` import. The Owned/Unlocked axis is gone.
- 🟡 `createDerivedRulesSurface` (+ `createCallableOuterRules`,
  `createMixinOutputRulesWrapper`, `createEmptyCallableOutputSurface`) — one base
  + 3 thin option wrappers; likely fine but re-check against `Rules.derive`.

## B. Rules.derive / deriveRulesSurface (`rules.ts`, `import-style.ts`)
- 🟡 `Rules.derive` / `Rules._deriveShell` (canonical copy-on-write surface).
- 🟡 `deriveRulesSurface` (import-style) — overlaps `derive` + the callable
  surfaces; check whether it folds into `derive` + options.
- 🟡 `createConfiguredImportedSurface` / `createConfiguredResultSurface` (with/set
  configs) — build surfaces + attach frame bindings; candidate to express via the
  primitive + `attachConfiguredVarBindings`.

## C. Node copy / clone (`util/cloning.ts` + scattered)
- ✅ `copyWithReusableLeaves` / `copyOwnedWithReusableLeaves` /
  `copyWithReusableLeavesPreservingComments` — folded into one `copyForPlacement`
  core with `{ owned, preserveComments }` flags; the 3 exported names are now thin
  wrappers (zero call-site churn, deduped the Comment/ampersand/reuse/clone logic).
- 🟢 per-part derive copies (`copyNameForDerived`/`copyValueForDerived`/
  `copyValueNodeForDerived`/`copyImportantForDerived`, declaration.ts) — reviewed:
  genuinely field-specific (string vs array vs boolean vs Node); the shared core
  IS `copyValueNodeForDerived`. Keep.
- 🟡 `cloneForPlacement`, `cloneValue`, `cloneBoundValue`, `clone` — review.
- 🟡 selector copies: `copySelectorForExtend`, `copySelectorForExtendRecord`,
  `copySelectorForPlacement`, `copyComplexComponentForPlacement` — extend/placement
  selector copies; check overlap.

## D. Scope frames (`scope-frame.ts`)
- 🟢 `lookupScopeFrameVariable` — THE single live-frame-aware walk. All variable
  resolution must go through it (no bespoke `f = f.parent` elsewhere). VERIFY no
  other module hand-walks frame `.parent`.
- 🟡 `buildScopeFrame` / `copyScopeFrameLiveBindingSlots` / `attachConfiguredVarBindings`
  — frame construction; keep but ensure single entry.

## E. Materialize (`ruleset.ts` etc.)
- 🟡 `materialize*` (7): `materializeValueState`, `materializeValueForSemantics`,
  `materializeRegistrationState`, `materializeRawSelectorForSemantics`,
  `materializeRawSelectorBranch`, `materializeImportPlacementState`,
  `materializeHeaderForSemantics` — review for shared shape.

---

## Progress log
- (in progress) A: collapsing the Owned/Unlocked callable-surface duplicates.
