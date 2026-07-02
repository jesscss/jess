# Lookup Chains in Core Tree

> ⚠️ **CURRENT WORK IS PINNED IN [`SINGLE_FRAME_PLAN.md`](./SINGLE_FRAME_PLAN.md).**
> The scope/frame lookup system is mid-migration to a **single frame-based
> system**. Read that plan before touching frames, `getScopeFrame`,
> `wireCallableScopeFrames`, `Mixin.sourceNode`, `direct-rules-lookup`, or
> `_passedRulesWrapper`. The canonical target model is
> [`LIVE_BINDING_ARCHITECTURE.md`](./LIVE_BINDING_ARCHITECTURE.md).

This note documents the intended scope model for variable/mixin lookup.

## Two Chains

- `parent` chain: the primary lexical / current-placement lookup path.
- `fallbackFrame`: optional secondary caller lane, used only when `leakyRules`.

Both are needed; they answer different lookup questions without rebasing the
primary parent walk.

## Detached Rulesets / Mixin Calls

**No cloning.** (Invariant 7 / `LIVE_BINDING_ARCHITECTURE.md` — an earlier version
of this doc said the mixin body is "cloned"; that is WRONG and was the clone-era
model.) A mixin body call is a **thin surface** over the shared canonical body;
per-call state lives in a `ScopeFrame`, not a copied sub-tree.

The intended per-call scope shape:

1. The per-call surface carries the **parameter live-slots** *and* the body's
   declaration index, chained to the lexical definition scope.
2. The body and any **nested** rulesets resolve free variables up **that one
   surface's frame** — so a body var whose value is a param resolves even from a
   nested ruleset.
3. Emitted output is the evaluated body rules.

### KNOWN DIVERGENCE (current impl — being fixed, see SINGLE_FRAME_PLAN.md)
The current implementation does NOT yet match the above. It splits scope across
**two frames**: the per-call surface (`createCallableRules`) holds only param
live-slots (empty declaration index, `declarationsCovered=true`), while the body
vardecls live on a SEPARATE `Mixin.sourceNode` wrapper frame. Nested rulesets
chain (via static `.parent`) to the wrapper frame and cannot see per-call params.
There is also a second lookup system (`direct-rules-lookup`) used as a fallback
when a frame is `!declarationsCovered`, and it drops the owner frame. Do not add
new capture patches per path — the fix is the single-frame migration.

## Reference Lookup Order (Variable)

For untargeted variable lookup in `Reference`:

1. Resolve against `resolvedTarget` (primary scope).
2. If unresolved and `leakyRules` is enabled, fall back to:
   - the active `Rules.scopeFrame`
   - then any chained `fallbackFrame`

The fallback lane allows caller-style resolution without overriding primary
lexical resolution.

## Rule of Thumb

If a fix requires "remove things after eval," re-check whether those nodes should
have been in emitted output scope at all. Prefer modeling scope through frame
ancestry plus explicit fallback lanes over post-hoc cleanup. If a fix requires
"capture the closure scope at yet another resolution path," STOP — that is the
fragmentation the single-frame migration removes.
