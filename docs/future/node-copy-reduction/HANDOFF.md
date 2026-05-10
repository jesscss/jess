# Node Copy Reduction — Handoff

## Start Here

Read this file and [README.md](./README.md). Do not look for stage trackers in
this folder; they were removed because they preserved stale architecture and
false status.

## Rules

- Preserve Jess behavior.
- Work from repo evidence first.
- Prefer small, verifiable production changes.
- Do not weaken tests or fixture expectations to make migration work look done.
- The goal is to reduce and, where possible, eliminate copy/clone from normal
  eval flow. Improving a legacy copy path is only a stopgap when callers still
  require an owned surface today.
- Do not introduce broad new runtime abstractions without multiple focused
  proofs and a clear owner.
- Do not use `sourceParent` to smuggle invocation scope.
- Treat `Context.rulesContext`, `ScopeFrame.fallbackFrame`, deep clone, and
  materialization as suspect surfaces, not automatic bugs.
- When a red only appears in `packages/jess/test/less/all-less.test.ts`, prefer
  a parser-accurate focused core repro first when practical.
- Update these docs only when the active frontier or rule set changes.

## Current Status

`packages/jess/test/less/all-less.test.ts` was green at the last pushed
baseline, and `pnpm run verify:baseline` was re-run during the docs quality pass
that condensed stale registry handoff state. Core focused proofs cover the formerly-live
`.Person(person, "Male"); .person.sayGender();` closure shape in
`packages/core/src/tree/__tests__/mixin.test.ts`.

The latest runtime pass in `packages/core/src/tree/rules.ts` narrowed the main
mixin clone boundaries without removing the owned eval surfaces that still
matter. Param binding reuses already-evaluated or static childless scalar
values with no source location instead of copying them just to create a live
slot. Copied param, default, rest, and `@arguments` containers also use the
shared reusable-leaf traversal now, so source-free scalar leaves are not cloned
just because the binding still needs an owned container surface. Resolving
live-slot values also reuses those scalar leaves, including children of copied
source-free `@arguments`/rest containers; source-backed values and containers
still use the defensive copy path. Static guards are
proven copy-free; dynamic guards and default-guard probes still use an owned
copy surface, but that surface reuses childless source-free scalar leaves.
`setDefined` insertion now uses the declaration-owned derivation path instead
of calling generic `VarDeclaration.copy()` during registration.
Ruleset call and ordinary mixin body clones reuse childless source-free scalar leaves;
the rules containers and non-leaf nodes still get owned eval surfaces, and
direct comment children remain cloned/preserved for each output placement.
Detached ruleset unlock now derives its wrapper instead of shallow-cloning the
source rules. Merged
declaration composition now uses the shared reusable-leaf copy traversal, so
source-free scalar leaves are not copied again while the output still gets its
own list/sequence/rules containers. In `packages/core/src/tree/reference.ts`,
`preserveRulesLike` variable
references now return the shallow owned rules-like wrapper directly without
using `clone(false)`; do not reintroduce a deep copy there. Childless static fallback values with no source
location also resolve directly; copied fallback and declaration reference
containers keep an owned surface while reusing source-free scalar leaves through
the shared reusable-leaf traversal. The old `freezeChildren` reference-result
branch and bespoke source-free list/sequence clone path are gone.
Source-backed fallbacks, defaults, and non-leaf nodes still use defensive owned
copies. Nested source-free reference result containers also use the shared
reusable-leaf traversal instead of freezing every child leaf. Merged
declaration reference flattening also reuses the copied value leaves it is
handed instead of copying them again, and merged declaration references
normalize the already-owned evaluated value directly instead of making one more
result copy. `packages/core/src/tree/declaration.ts` now derives registration
and eval-time declaration wrappers with owned/reusable child surfaces instead
of shallow-cloning the declaration before replacing individual children, so
source declaration values stay parented to the canonical source declaration
after `resolve(context)`. Interpolated declaration names also reuse
source-free scalar replacement leaves inside the owned name wrapper, and
source-backed `!important` flag leaves now use the same reusable-leaf copy path
instead of `clone(true)`. Post-eval merged declaration coalescing in
`packages/core/src/tree/rules.ts` now keeps
accumulated values read-only and lets merge composition own the copy boundary
instead of recopying stored/list-flattened leaves. The `Call.evalNode`
`sourceNode.parent` repair is still active because the detached-ruleset
non-leaky scope test fails without it. In `packages/core/src/tree/call.ts`,
ordinary JS functions with explicit empty positional arg lists no longer copy
the empty `List`; copied positional and callback arg containers now reuse
source-free scalar leaves while keeping an owned arg-list surface only when
needed. Plain string CSS calls now build evaluated `resolve(context)` output directly instead of
deep-cloning the whole call first; nested argument containers still get a local
copied eval surface when needed so source argument containers stay canonical.
Non-plain `Call.resolve()` also uses the shared reusable-leaf traversal now:
it derives a small owned call surface directly instead of reconstructing the
whole source `Call`; copied name/arg/content containers still own eval-time
mutation, but childless source-free scalar leaves are reused and the original
call-site parents are left alone. Optional fallback call output is derived directly
instead of shallow-cloning the source call, and variable-reference call names
that need `preserveRulesLike` use a derived reference wrapper instead of
cloning the source reference.
At-rule registration and resolve wrappers now use direct derived construction
with owned/reusable child surfaces instead of shallow clone/replacement, so
source preludes and rule bodies stay parented to the canonical at-rule.
Comment-free at-rule header serialization now uses that same owned/reusable
copy boundary for the local name/prelude print surface, so source-free prelude
leaves are not cloned just to suppress header trivia.
Ruleset registration/resolve prep now derives the wrapper with an owned selector
surface, so source selectors stay parented to the canonical ruleset. Body rules
remain the existing registration/eval surface because copying them changes
mixin and scope behavior. Ruleset `ownSelector` metadata also uses the shared
owned/reusable selector copy boundary now, so selector-list metadata does not
clone inert source-free selector leaves during registration prep. Comment-free
ruleset header serialization uses the same local print-surface boundary instead
of deep-cloning source-free selector leaves to suppress selector trivia.
Reference-mode ruleset header filtering uses that boundary too when it only
needs a local print surface; render-local selector visibility forcing now uses
the same owned/reusable boundary instead of deep-cloning reusable selector
leaves. The old unused hoisted implicit-ampersand
materialization helper in `ruleset.ts` has been removed rather than preserved
as dead deep-copy machinery. The ruleset-specific `copy()` override has also
been removed because no production eval/render caller needed it; the generic
Node API remains, but there is no special ruleset copy surface to optimize as a
future model. Mixin interpolated-name registration prep also derives an owned
wrapper directly, so source dynamic names, params, guards, and body rules stay
canonical.
`Rules.resolve(context)` now uses the same explicit
derived Rules surface instead of `clone(false)`, preserving function-registry
and live-slot ownership while forcing lazy registry re-indexing; derived
surfaces preserve rules-like subclasses such as `Collection`. Import-owned
child Rules surfaces reuse that helper too, so configured import placement no
longer shallow-clones imported source rules. Compose/import output visibility
wrappers also use `Rules.derive()` instead of shallow `Rules.clone()`, and
first-use import-local deep copies reuse childless source-free scalar leaves
through the shared clone helper while keeping owned container copies and
preserving direct comment children. Framed ampersand resolution now constructs
the framed wrapper directly instead of shallow-cloning the source ampersand just
to attach the active selector frame. Appended framed ampersands (`&-foo`) now
derive their generated selector output directly instead of deep-cloning and
mutating the frame selector; selector-list append, template-merge append, and
hoist-only output are covered separately so this does not change their
semantics. Implicit selector-list ampersand wrapping now builds the generated
`:is(...)` argument through the shared owned/reusable selector copy boundary,
so inert source-free selector leaves are reused and canonical source parents
are left alone.
Interpolated value resolve now constructs a fresh interpolated wrapper only
when replacement values actually change, and interpolated selector resolve
uses that resolve path instead of cloning the source interpolated value before
selector conversion.
Whole-selector interpolation now uses the shared reusable-leaf copy boundary
when the evaluated replacement is already a selector, so generated selector
output owns a wrapper without cloning inert source-free selector leaves.
The latest utility quality pass made `Context.getTree()` expose its no-tree
unsupported-file case without a hidden `any`, removed catch/rethrow and stale
commented import clone scaffolding there, and made import evaluation handle the
no-tree case explicitly. The follow-up cleanup removed redundant mixin-argument
eval catch/rethrow plumbing in `rules.ts`, moved import parse-error detection
behind small `unknown`-safe helpers, and made the small webpack resolver helper
whole-file lint clean. `packages/core/src/tree/util/bitset.ts` now keeps
third-party bitset internals behind local guards and preserves selector-bit
library identity without copying private fields through `any`; this is a
utility boundary cleanup, not a selector/extend generated-output clone change.
`packages/core/src/jess-error.ts` now keeps slash-style diagnostic codes in a
typed map and reads Chevrotain parser/lexer error details through local guards,
so the parser diagnostic adapter is whole-file lint clean without weakening the
diagnostic code contract. Diagnostic-code validation and
ErrorDiagnostic-to-JessError conversion also live there now, removing duplicate
throw-conversion blocks from `context.ts` and `plugin.ts`.
Broader typed cleanup in legacy high-debt files should be planned separately
because the staged-file hook lints whole touched files. This cleanup does not
change the selector/extend generated-output clone frontier below.
Derived empty mixin wrapper surfaces in
`packages/core/src/tree/rules.ts` are constructed directly instead of
shallow-cloning non-empty body rules and clearing them, avoiding parent churn on
cloned body children while preserving rule options and function registry
ownership. `$for` aggregate and zero-iteration output wrappers in
`packages/core/src/tree/control.ts` are also constructed directly now; the
per-iteration body wrapper owns a copied eval surface because it carries the
live-slot `ScopeFrame` for that iteration, while childless source-free scalar
leaves inside that body are reused through the shared reusable-leaf traversal
without calling `Rules.clone()`. Source-free scalar `$for` iteration values
bind without being copied or cloned first. `packages/core/src/tree/sequence.ts`
now derives `Sequence.operate('+')` output directly and routes operand children
through the shared reusable-leaf traversal, so sequence/list addition does not
reconstruct the source sequence, reparent source children, or clone childless
source-free scalar leaves. Sequence changed-value eval/resolve wrappers are
also constructed directly now instead of cloning before replacing the value
array. `packages/core/src/tree/list.ts` now does the same for
`List.operate('+')`, so list/list and list/scalar addition do not reconstruct
the source list while keeping source children canonical and reusing inert
scalar leaves.
`packages/core/src/tree/operation.ts` now builds preserved operation wrappers
directly from final operands instead of shallow-cloning before replacement, so
unchanged source operands remain parented to the source operation when a
resolved sibling keeps the operation shape alive. `packages/core/src/tree/paren.ts`
now builds resolved paren wrappers directly from the resolved child instead of
shallow-cloning before replacement, so resolving a child container leaves the
source paren value parented to the source paren. `packages/core/src/tree/block.ts`
now uses the same direct construction pattern for resolved block wrappers, so
source block values stay parented to the canonical source block after
`resolve(context)`. `packages/core/src/tree/quoted.ts` now constructs resolved
quoted wrappers directly as well, so interpolated source quoted values are no
longer reparented to the resolved string wrapper.
`packages/core/src/tree/selector-attr.ts` now constructs resolved attribute
selector wrappers with owned/reusable unchanged child surfaces, so resolving an
attribute selector no longer reparents the source attribute value. Pseudo,
selector-list, compound, and complex selector wrappers now use the same direct
derived-construction pattern for resolved selector arguments/items/components,
leaving source selector children parented to their canonical wrappers. Selector
expansion and extend clone sites are still a different category: they produce
generated selector output rather than repairing shallow-wrapper replacement.
`packages/core/src/tree/util/selector-utils.ts` now handles selector-list
implicit ampersand output by constructing a fresh `SelectorList` from mapped
generated items instead of cloning the source list and replacing children, so
source list children remain parented to the source list.
Implicit ampersand placement copies now use the shared owned/reusable selector
copy helper, so source-free selector leaves are not cloned just to add the
generated parent boundary.
Extend-generated selector output in `packages/core/src/tree/util/extend.ts`
and `packages/core/src/tree/util/extend-walk.ts` now uses an owned-root /
reusable-children copy helper from `packages/core/src/tree/util/cloning.ts`.
That keeps flag mutation (`F_EXTENDED` / `F_EXTEND_TARGET`) on generated output
surfaces without deep-cloning matched selector items or reusing the source item
as the flagged node.
Parent-boundary extend composition in
`packages/core/src/tree/util/extend-roots.ts` now uses that same
owned/reusable selector boundary when wrapping selector-list children and when
copying fully-composed `extendWith` selectors, so crossing extends no longer
deep-clone inert source-free selector leaves such as `.footer .footer-nav`.
Implicit ampersand extend output now has the same shape: `Ampersand.derive()`
constructs a new ampersand wrapper while preserving its live selector
container, and extend placement copies use the owned/reusable helper instead of
generic `.copy(true)` for compound/list replacement surfaces.
Extend record materialization in `packages/core/src/tree/extend.ts` now uses
the same owned/reusable selector boundary for generated selector-list surfaces,
avoiding deep clones of inert source-free selector leaves while still owning
the generated output container. `Extend` is explicitly async-capable now,
matching its existing async selector-eval branch, and the sync/async branches
share that same selector copy boundary.
The `createExtendedSelectorList()` self-parenting guard is now the placement
copy itself: selector-list items are copied through `copySelectorsForPlacement`
before adoption, so the old post-copy `s === inheritFrom ? s.clone(true)` guard
has been removed. `walkAndExtend()` selector-list reconstruction now follows
the same placement-copy rule: processed output is copied before generated list
adoption, so unchanged source-list items keep their canonical source parent and
the old `s === list ? s.clone(true)` guard is gone.
`extend-walk.ts` is now whole-file lint-clean; keep follow-up edits there on
the typed selector/component helper path instead of reintroducing `any`
assertions.
Legacy full-match extend paths no longer shallow-clone the source selector just
to supply inheritance metadata to `createExtendedSelectorList()`; the generated
list still owns placement copies before adoption.
The unused `freezeChildren`/`cloneOrReuseLeaf` helper surface has been removed
from `packages/core/src/tree/util/cloning.ts`.

Current remaining clone/copy frontier:

- `packages/core/src/tree/import-style.ts` still uses `cloneWithReusableLeaves`
  for the first plain-import local `Rules` surface. That is an import-site
  ownership boundary, not a generic stale deep clone.
- `packages/core/src/tree/rules.ts` still uses `cloneWithReusableLeaves` for
  callable rules output that must preserve direct comment children and own each
  generated placement.
- `packages/core/src/tree/ruleset.ts` no longer has the defensive
  `selector.copy(true)` fallback after the owned/reusable selector helper; the
  helper now returns a selector-shaped node or throws.
- `packages/core/src/tree/util/extend.ts` still contains generated selector
  output `.copy(...)` calls and pre-existing whole-file lint debt. Treat that as
  a distinct generated-output cleanup batch; do not mix it into ordinary eval
  copy removal unless the checkpoint also pays the lint cost.

Run `pnpm run verify:node-copy-frontier` before picking the next node-copy seam.
It intentionally scans only deep copy/clone-style call sites, not every
`copyWithReusableLeaves(...)` owned-surface boundary.

## Work Loop

1. Pick one production seam from `README.md`.
2. Read the relevant source and focused tests before editing.
3. Make the smallest behavior-preserving change.
4. Run the focused proof first.
5. Run the nearest broader verification.
6. Commit and push when the checkpoint is clean.

## Do Not Resurrect

- checked-in task registries or unattended task loops
- stage trackers that mostly describe absent machinery
- broad "current dirty diff" notes copied from an old session
- fixture-expectation changes that are not tied to an explicit Jess behavior
  decision
