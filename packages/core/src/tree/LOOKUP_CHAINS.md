# Lookup Chains in Core Tree

This note documents the intended scope model for variable/mixin lookup.

## Two Chains

- `parent` chain: definition/evaluation structure (lexical ancestry).
- `sourceParent` chain: call-site/source ancestry used for fallback behaviors (notably Less-style leaky lookups).

Both are needed; they represent different questions.

## Detached Rulesets / Mixin Calls

When evaluating a mixin with parameters:

1. Parameter declarations live in a **wrapper Rules scope**.
2. The cloned mixin body is evaluated as a **child Rules node** of that wrapper.
3. Emitted output should be the evaluated body rules, not the wrapper declarations.

This keeps parameter bindings available to lookup during evaluation while preventing parameter declarations from leaking into caller-visible output scope.

## Reference Lookup Order (Variable)

For untargeted variable lookup in `Reference`:

1. Resolve against `resolvedTarget` (primary scope).
2. If unresolved and `leakyRules` is enabled, fallback to:
   - `rulesParent`
   - then `sourceRulesParent`

The fallback chain allows call-site style resolution without overriding primary lexical resolution.

## Rule of Thumb

If a fix requires "remove things after eval," re-check whether those nodes should have been in emitted output scope at all. Prefer modeling scope through wrapper ancestry over post-hoc cleanup.
