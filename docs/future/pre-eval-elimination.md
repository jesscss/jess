# Pre-Eval Elimination

This note records the current replacement for the old public `preEval()` phase.
It is not a historical pass log; keep it focused on the active runtime contract.

## Current Contract

- The public `preEval()` method is removed.
- The old `preEvaluated` node flag and compatibility alias are removed.
- Registration identity setup is explicit: `prepareRegistration()` marks
  `registrationPrepared` when a node's lookup identity is stable enough to
  index.
- Registration is not evaluation. A node can be registration-prepared without
  having evaluated its renderable children.
- `eval()` is still allowed to produce a local evaluated node for the current
  step, but the target compile path must not retain a whole evaluated output
  tree and then serialize that tree later.

In other words, "single pass" means contextual eval/render with small local
setup and delayed slots where needed. It does not mean "no intermediate value
object can ever exist."

## Why Registration Still Exists

Jess lookup needs some facts before ordinary source-order evaluation can safely
run:

- stable child `.index` values for nearest-prior declaration lookup
- static declarations, mixins, functions, and callable rulesets indexed before
  references can resolve
- current root, rules context, import/reference scope, and extend root
- selector, at-rule, mixin, and declaration identities that are needed for
  lookup or extend registration

Those are registration concerns, not proof that a subtree has been evaluated.

## Eval/Render Direction

The desired path is:

1. Set up the local `Rules` context.
2. Assign source-order indices.
3. Register identities that are already stable.
4. Run source-order eval/render.
5. Defer only the narrow shapes that are genuinely blocked.
6. Finalize root-level output work, such as extends, after the required nested
   containers have been visited.

Do not bring back a broad priority queue or a hidden tree-wide preparation pass.
If a node needs earlier identity work, keep that hook named and scoped to the
identity it prepares.

## Known Remaining Bridge

`prepareRegistration()` and `registrationPrepared` are still production
machinery. That means pre-eval elimination is not the same thing as fully
finished single-pass eval/render.

The important remaining cleanup is to shrink registration prep until it only
does lookup identity work:

- dynamic declaration-name fixed-point registration
- interpolated selector/mixin/at-rule identity preparation
- import identity and retry timing
- extend-root registration timing

`Node.render(context)` is no longer a resolve/eval-then-serialize fallback. The
base implementation is a direct source serializer for static/source nodes.
Context-dependent nodes must override `render(...)`, choose the evaluated value
locally, and serialize that value through the shared print-state machinery.
`pnpm run verify:materialization-frontier` guards against reintroducing broad
resolve/eval-then-serialize seams.

## Non-Goals

- Do not weaken Less/Jess semantics to make the runtime look simpler.
- Do not replace `preEval()` with the same broad work under a different name.
- Do not make the render buffer into an AST v2.
- Do not use registration-prepared state as a synonym for evaluated state.
- Do not remove `prepareRegistration()` call sites until focused tests prove the
  lookup, extend, import, and dynamic-name contracts still hold.
