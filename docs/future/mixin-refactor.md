# Mixin Call Refactor: move to the `$for` shape

## Status
In progress on `dev-tree-swap`.

## Problem
`MixinCollection.evalCall` in [rules.ts](../../packages/core/src/tree/rules.ts) (~600 lines, starting around line 1825) currently shapes every mixin call as:

1. **Deep clone** the candidate mixin's body: `rules = candidate.value.rules.clone(true)`
2. **Deep walk + reset** the clone in `resetEvalStateDeep`, clearing `preEvaluated`, `evaluated`, and `Ampersand._selectorContainer`/`_storedSelector` on every node in the subtree
3. **Mutate** the clone's `.value` directly during eval

Deep cloning + deep state-resetting is the largest remaining CPU and memory cost in the compiler and the architectural wart underneath several long-tail bugs (stale selector containers, recursion detection bugs, per-call state leaking across sibling calls). It also makes the cost of a mixin call scale with the **size of its body**, not the number of times it's actually executed.

## The `$for` shape already solves this
Look at [control.ts:215-280](../../packages/core/src/tree/control.ts#L215-L280). `For.evalNode` iterates without cloning:

```ts
const renderKey = context.ruleCounter++
// ... build fresh iterationRules wrapper ...
context.renderKeyStack.push(renderKey)
const result = await iterationRules.eval(context)
context.renderKeyStack.pop()
result._renderKey = renderKey
```

Each iteration gets a unique `renderKey`. When the body's nodes get adopted into the iteration wrapper, `Node.adopt` stores the new parent in the node's `_parentForks` map keyed by `renderKey` — the original parent link in the `CANONICAL` fork is untouched. During eval, `Node.getValue(renderKey)` reads per-renderKey forks of `.value`, so writes route into the iteration's own copy without touching the definition-form nodes.

No clones. No resets. The definition-form tree stays immutable.

## Target shape for mixin calls

For each candidate in `MixinCollection.evalCall`:

1. **No clone, no reset.** The candidate's body stays in definition form.
2. `const renderKey = context.ruleCounter++`
3. Build `outerRules = Rules.create([])`; fill with fresh `VarDeclaration` param nodes.
4. `outerRules.push(...candidate.value.rules.value)` — adopts the body children. Parent writes go into `_parentForks[renderKey]`.
5. `context.renderKeyStack.push(renderKey)` around `outerRules.eval(context)`.
6. Tag `result._renderKey = renderKey` so serialization reads the matching forks.

## Known sharp edges

### `Ampersand._selectorContainer`
`resetEvalStateDeep` currently clears `_selectorContainer` and `_storedSelector` on every cloned Ampersand so call-site frames rebind via `Ampersand.evalNode` reading `context.rulesetFrames`. Without the reset, an Ampersand from the definition tree carries a stale container pointing at definition-time selectors.

Options:
- **A. Parse-time**: never set `_selectorContainer` on definition-form Ampersands. Rebind on every eval, every call. Cleanest.
- **B. Per-renderKey storage**: heaviest, but most general.
- **C. Eval-time guard**: `Ampersand.evalNode` prefers `rulesetFrames` when `_renderKey` is set. Lightweight but leaky.

**Try A first**; fall back to C if single-call ruleset tests regress.

### `preEvaluated` / `evaluated` flags
These live on the node itself, not in `.value`. In the fork model they need to be renderKey-keyed or re-derived. Simplest: extend node-base to store these per-renderKey in a small map, `CANONICAL` as the default.

### Scope/registry on Rules nodes
`Rules` holds a per-scope registry. The new `outerRules` wrapper is fresh per call — its registry starts empty, which is correct. Audit: does `Rules.eval` write to `this.registry` (the definition's registry) or build a fresh registry per call? If it writes to `this`, that's the bug, and the fix is to move registry state onto `outerRules` (the wrapper) at call time.

### Recursion guard
`thisContext.rulesEvalStack` and `callMap` use identity. With no clone, the same `candidate.value.rules.sourceNode` participates in every call, so the existing check `inStack = thisContext.rulesEvalStack.includes(candidate.value.rules.sourceNode as Rules)` still works unchanged.

## Incremental plan
Keep commits small. Run full core tests after each step.

1. **Delete `resetEvalStateDeep` and its call sites.** Catalog failures — that's the set of "things that secretly rely on state reset."
2. **Stop cloning body rules.** Replace `let rules = sourceRules.clone(true)` with direct adoption of the definition rules into a fresh wrapper.
3. **Allocate `renderKey` per call.** Push/pop `renderKeyStack`; tag result `_renderKey`.
4. **Move `preEvaluated`/`evaluated` to per-renderKey storage** — only where step 1/2 proved it's needed.
5. **Fix `Ampersand._selectorContainer`** via option A (parse-time change) or fall back to C.
6. **Audit `Rules.eval` for scope/registry writes into `this`** — convert to fresh registry per call if needed.

## Success criteria
- `resetEvalStateDeep` gone.
- `clone(true)` in `evalCall` gone (except genuine ruleset-as-mixin unlocking, if truly needed — prefer not).
- Mixin tests pass. Recursion tests pass.
- Benchmark informational: mixin-heavy fixtures get measurably faster.
