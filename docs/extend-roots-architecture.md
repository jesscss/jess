# Extend roots architecture

## 1. What is an extend root?

An **extend root** is a `Rules` node that acts as the scope for extend lookups. Each extend root has:

- **Scope**: The rulesets (and their descendants) that “belong” to this root for the purpose of extend.
- **Parent/children**: A tree of extend roots. Child roots are nested scopes (e.g. `@media` body, `@layer` body, imported/composed stylesheet).

Only certain `Rules` nodes are registered as extend roots: document root, bodies of nestable at-rules (`@media`, `@supports`, `@layer`, `@container`, `@scope`), and roots created by `@import` / `@compose`.

## 2. Registration rule: where rulesets belong

**All rulesets and all descendants of those rulesets are considered to belong to the current extend root** — until a descendant is itself another extend root.

- While walking the tree, any ruleset is under the extend root that is current at that point.
- As soon as we hit a `Rules` node that is registered as an extend root, that node starts a **new** root. Rules under it belong to that new root, not to the parent root.
- So the “boundary” between two extend roots is: the child extend root’s `Rules` node. Nothing above it (in the parent root) can claim rulesets that live under the child root.

Concretely: when we push an extend root (e.g. enter `@media` body), that `Rules` is the current root. Rulesets and other nodes inside it belong to this root until we descend into another `Rules` that is itself registered as an extend root (e.g. nested `@supports` body). Then that nested `Rules` is a **child** extend root; its rulesets belong to it, and the parent root’s “descendants” for extend are the set of child extend roots (like that `@supports` body), not the raw AST under them.

## 3. Extend target scope (accessible roots)

**An extend can only target rulesets in:**

1. **The extend root** where the extend was registered (same root).
2. **Descendant extend roots** of that root (child roots, recursively, subject to boundaries below).

There is **no ancestor targeting**. So:

- **From document root**: Can extend selectors in the document root and in any descendant root (e.g. inside `@media`, `@layer`, imported stylesheets).
- **From inside `@media`**: Can extend only in that `@media` root and in its descendant roots (e.g. nested `@supports`). Cannot extend selectors at document root or in an outer `@media`.

“Do extend inside” (Less wording): root rules **can** extend selectors inside `@media`. We support that (outside → inside). We do **not** support inside → ancestor.

Implementation: **accessible roots = self + descendants**. `getAccessibleRoots(root)` returns that set. No ancestors are included.

## 3a. Non-goal: Less “child extends ancestor” declaration copying

Less has a behavior where an extend inside a child scope (e.g. inside `@media`) that targets an ancestor selector does **not** merge selectors in the ancestor scope. Instead, it creates a ruleset in the child scope that **copies** the ancestor’s declarations.

Jess does **not** implement this behavior (we do not support “inside → ancestor” targeting; see §3).

Reference minimal example files:

- `docs/extend-ancestor-minimal-example.less`
- `docs/extend-ancestor-minimal-expected.css`

## 4. Boundaries: compose vs import

**Compose** creates a **file boundary**:

- The composed stylesheet is registered as its own extend root (with `isCompose: true`).
- By default it is **protected** (`isProtected: true` unless `mutable: true`). Protected roots are not traversed when computing accessible roots: you cannot extend across a protected compose boundary (except for placeholders, if applicable).
- If the stylesheet allows mutation (`mutable: true`), the compose root is not protected and **is** visible as a descendant, so extending into it is allowed.

**Import** does **not** create that kind of boundary:

- `@import` of a stylesheet allows mutation by default. The imported `Rules` is registered as a **child** of the current extend root (not as a separate boundary).
- So the importing root’s “descendants” include the imported rules; extends at the importing root can target rulesets in the import. Extends inside the import use the **parent’s** extend root (they don’t push a new root), so they see the same scope as the file that did the import.

So: compose = boundary (no cross-extend unless mutable); import = no boundary, shared scope with parent.

## 5. Tree and lookup (summary)

- **Extend roots** form a tree: `parentRoot` / `childrenRoots` in the registry.
- **Registration**: Document root, nestable at-rule bodies, and import/compose roots are registered with their parent so the tree is correct. Rulesets are not registered individually; they “belong” to the root that contains them until another extend root is encountered.
- **Accessible roots** for a given root = that root + its descendant roots (recursively), stopping at protected roots. No ancestors. Same-layer roots (e.g. `@layer one`) are also included so multiple blocks with the same layer name share extend scope.
- **Merge rule**: When an extend finds a target ruleset, we only merge (add the extending selector) into rulesets whose root is the extend root or a descendant of it (`isSameOrDescendantRoot`). We never merge into an ancestor root.

This gives a single, consistent model: extend root + descendant roots only, with clear boundaries at protected compose and no ancestor targeting.

---

## 6. Code conformance audit

### Conforms

- **getAccessibleRoots**: Returns only self + descendants (traverseChildren from root). No ancestor walk. Stops at protected children. Same-layer roots included. Matches §3.
- **Compose**: `import-style.ts` registers compose roots with `isCompose: true`, `isProtected: !importOptions.mutable`. Default protected; `mutable: true` → not protected. Matches §4.
- **Import**: Import does not push a new extend root during eval; after eval we `registerRoot(finalRules, currentParentExtendRoot, { isProtected })`. Import is a child of parent; extends inside import use parent’s root. Matches §4.
- **Nestable at-rules**: In `at-rule.ts` we register the body with `parent = getCurrentExtendRoot()` and add child roots (e.g. nested @supports) with that body as parent. Extends are registered during ruleset eval when the actual body is on the stack, so extendRoot is the actual body and children are attached to it. Tree is correct for eval-time lookups.
- **Merge rule**: processExtends uses `isSameOrDescendantRoot` and explicitly excludes ancestor roots (no merge into ancestor). `isAncestorRoot` is used only to block merge, not to copy declarations.

### Gaps / fixes

1. **isAncestorRoot JSDoc**: The comment says “copy that target’s declarations into the extending ruleset (Less behavior)”. We do not support that; we do not target ancestors. The helper is used only to _prevent_ merging into rulesets in an ancestor root. JSDoc should be updated (see code fix below).

2. **Duplicate nestable body registration**: Earlier registration prep could
   create one root identity for a nestable at-rule body and later register a
   different body identity from `at-rule.ts` eval. That gave the document root
   two children for the same @media body. Fix applied: nestable at-rule body
   registration now keeps the pushed/evaluated body and the registered body
   aligned, so the registry has a single child of doc per at-rule body.

**Note:** Three extend-roots tests still fail (extends from inside at-rule into nested at-rules; layers with same name share extend roots; nested layers concatenate names). Cause is under investigation (e.g. registration order or which Rules identity is used for extendRoot vs. children).

### Extend-chaining hypothesis and fix

**Why extend-chaining was failing:** We were pushing one at-rule body identity
(for example, an `@media` body) as the extend root, then evaluating and
registering a different body identity. Rulesets and child roots ended up
attached to one object while the registry pointed at another. So:

- Root `.mb:extend(.ma)` could not find `.ma` inside `@media` (the root we searched was the wrong Rules).
- Extends from inside `@media` could not see nested `@supports` (child root was attached to the clone, not the registered root).

**Fix:** In `at-rule.ts`, nestable at-rules now push, evaluate, and register
the same body identity. The object that gets rulesets and child roots is the
same object the registry sees. Root→inside extends (e.g. `.mb:extend(.ma)` at
root finding `.ma` in `@media`) then work.

**Result:** Root→inside extends work. Same-root extends (e.g. `.ma` and `.md` in the same `@media` body) use the same extend root; no ancestor targeting is involved. The fixture is not skipped.
