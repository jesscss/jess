# Aggressive Cutting Review

> This review applies to the public AST-v2 architecture. It does not authorize
> a private AST grammar, CST-to-AST bridge, or later public wiring stage.

Delete unnecessary machinery before adding code. A change may not introduce a
parser host, action registry, bridge, compatibility alias, source reparse, or
fallback path. New traversal, allocation, copying, metadata, helper/API
surface, and hot-path state need explicit ownership and measured evidence.

Before a queue pass, update the self-prosecution block in `HANDOFF.md` and run:

```sh
pnpm run verify:aggressive-cutting-review
```

Release enforcement is patch-scoped: `--mode=staged` (pre-commit) and the
default working scope must prove only the changed patch. The former aggregate
`--mode=upstream` scan was deleted: it could not name a bounded owner,
remediation, or release decision, and therefore created migration noise. A
cost-cutting patch needs an exact owner hunk contract plus measured evidence;
a semantic output change needs focused behavior, build, and boundary evidence
and must not invent a performance or byte-identity claim. Parser/frontend and
public-boundary changes use their dedicated boundary evidence. A broad
`owner-plus-named-carry-forward-support` record never proves unrelated hunks.

Alpha release snapshots use `--mode=release` from `release:alpha:check`. This
mode validates the registry and self-prosecution block, but does not treat the
full historical `dev` → `alpha` squash diff as one new optimization patch. It
therefore does not require aggregate changed-path, danger-token, or
cost-contract A/B accounting; those remain strict in the default working and
`--mode=staged` modes. Package/API safety remains owned by the later dedicated
steps in `release:alpha:check`.

The root pre-commit hook makes the same bounded distinction. A staged commit on
the exact `alpha` branch invokes `--mode=release`, because the staged patch is
the already-validated `dev` snapshot being squash-committed. Staged commits on
`dev`, feature branches, or detached heads continue to invoke `--mode=staged`;
the release exception is not available to ordinary development commits and
does not require bypassing the hook with `--no-verify`.

A staged source-only formatting commit may skip runtime cost accounting only
when the verifier can reproduce every indexed byte exactly from `HEAD` by
running ESLint with the fixed allowlist of non-semantic formatting rules. This
proof accepts modified lintable files under the reviewed source roots only; it
rejects added/deleted/renamed files, any other staged path, unstaged overlap,
dirty ESLint/package/lock configuration, remaining lint diagnostics, and any
indexed byte not produced by the approved fixes. Failure falls through to the
ordinary semantic/runtime review automatically. This is semantic-identity
proof for the staged patch, not benchmark byte identity or a performance claim.

`semantic-preflight` is intentionally narrower than an optimization contract.
Use it only where a semantic source-order inspection must occur before the
engine can know whether planner work is needed. It must prove an exercised
false path creates no collector/planner/IR/placement facts, an exercised named
feature path creates the expected facts, and record the current benchmark
output/time as a baseline. It must declare `performanceClaim: "none"`; it is
never a way to describe a semantic addition as neutral, faster, or bounded by
the ordinary per-container admission cap.

`semantic-boundary` is for a named dispatch/result policy that has no traversal
or admission surface: for example, an optional FunctionCall name miss versus a
failure from a callable that was actually selected. It must test each named
branch, account for its call-path allocation shape, and record a current output
baseline with `performanceClaim: "none"`. It must not use counters or an A/B to
pretend that a semantic policy correction is an optimization.

`semantic-runtime` is the explicit lane for a coordinated AST-v2 evaluator/value
cutover whose changed helpers span more than one traversal or dispatch family.
It is file-owned, not hunk-anchored: the record names the semantic scope and
cases, runs focused behavior and build commands, and records a current
`benchmark.less` timing/output baseline with `performanceClaim: "none"`. It
does not claim neutrality, speed, byte identity, or a cost decrease. The danger
inventory and self-prosecution labels still apply, while precise/conservative/
redundant optimization records remain required for changes that actually claim
cutting or performance.

The registry stays intentionally bounded. Its semantic-runtime entry is an
explicit evidence owner for the current coordinated AST-v2 value cutover, not
a blanket optimization exemption or a new active architecture queue.

<!-- BEGIN AGGRESSIVE-CUTTING-COST-CONTRACTS -->
```json
[
  {
    "id": "ast-extend-import-preflight",
    "kind": "semantic-preflight",
    "surface": "typed imported-extend placement preflight",
    "files": ["packages/core/src/ast/serialize.ts"],
    "coverage": "owner-plus-named-carry-forward-support",
    "necessity": {
      "status": "proven",
      "factSource": "A loaded import document's typed Rule, AtRuleBlock, and For bodies are the first authoritative source for whether imported selectors or concrete loop placements can contribute an extend.",
      "rediscovery": "Without the preflight, the renderer would discover imported extend facts after the root extend plan was already computed, losing source-order cross-import placement semantics.",
      "carryForward": "The loaded document body is inspected once in source order; only its existing typed selector facts and one token per concrete extend-bearing loop iteration are carried into the root plan overlay.",
      "whyNotCarried": "The importer cannot carry an arbitrary imported document's extend fact before Context/plugin resolution loads that document; the loaded typed body is the earliest truthful boundary."
    },
    "semanticPreflight": {
      "trigger": "a loadable imported document body is encountered",
      "scope": "The preflight reads only typed loaded-import statements before selector-plan allocation. A false result does not enter the collector, create overlay IR, or issue loop-placement tokens; a true result carries only the concrete placement facts the existing root planner needs.",
      "falsePath": {
        "fixture": "extend-preflight-contract:no-extend",
        "requiredZeroCounters": ["collectorCalls", "overlaySubjects", "overlayInstructions", "loopPlacements"]
      },
      "featurePath": {
        "fixture": "extend-preflight-contract:imported-loop",
        "minimumCounters": {"importsVisited": 1, "loopPlacements": 2, "overlaySubjects": 2}
      },
      "baseline": {"fixture": "benchmark.less", "phase": "parse-render"}
    },
    "sourceCheck": {
      "file": "packages/core/src/ast/serialize.ts",
      "caller": "function planImportedExtends(",
      "guard": "bodyMayPlanExtend",
      "call": "collectPlacedExtendFacts",
      "profile": "recordAstExtendProfile"
    },
    "evidence": {"command":["pnpm","--filter","@jesscss/core","test","--","--run","src/ast/__tests__/extend-preflight-contract.test.ts"]}
  },
  {
    "id": "ast-evaluator-function-call-boundary",
    "kind": "semantic-boundary",
    "surface": "ValueEvaluator optional FunctionCall and selected-callable failure policy",
    "files": ["packages/core/src/ast/evaluator.ts"],
    "semanticBoundary": {
      "trigger": "a typed FunctionCall reaches evaluator dispatch with a registry miss or a selected callable result",
      "scope": "Only the value evaluator owns this boundary. An unregistered plain FunctionCall is an optional CSS call and returns authored call bytes; a selected scoped or global callable either returns its typed result or sends its synchronous/asynchronous rejection through functionMode. MixinCall lookup, variable/property resolution, and mixin recursion are outside this seam.",
      "cases": ["unresolved-optional-function-call", "registered-sync-call-failure", "registered-async-call-failure"],
      "baseline": {"fixture": "benchmark.less", "phase": "render"}
    },
    "sourceCheck": {
      "file": "packages/core/src/ast/evaluator.ts",
      "caller": "const call = (",
      "guard": "if (registry.has(name))",
      "call": "recoverAsyncCall("
    },
    "evidence": {"command": ["pnpm", "vitest", "run", "packages/core/src/ast/__tests__/evaluator-call-boundary.test.ts"]}
  },
  {
    "id": "ast-value-guard-equality-modes",
    "kind": "semantic-boundary",
    "surface": "typed guard equality compatibility modes",
    "files": ["packages/core/src/ast/value-guards.ts"],
    "semanticBoundary": {
      "trigger": "a typed guard comparison receives Less, Sass, or exact equalityMode",
      "scope": "Only typed guard comparison owns mode-specific equality: Less permits unitless numeric coercion and emitted escaped-word equality, Sass keeps unit distinctions while comparing quoted and keyword text, and exact retains the structural distinction. Function dispatch, variable resolution, and declaration rendering do not enter this branch.",
      "cases": ["less-unitless-dimension", "sass-quoted-keyword", "exact-structural-distinction"],
      "baseline": {"fixture": "benchmark.less", "phase": "render"}
    },
    "sourceCheck": {
      "file": "packages/core/src/ast/value-guards.ts",
      "caller": "function compareNodes(",
      "guard": "if (equalityMode === 'sass')",
      "call": "selfCompare(a, b, equalityMode)"
    },
    "evidence": {"command": ["pnpm", "vitest", "run", "packages/core/src/ast/__tests__/value-operate-compare.test.ts", "packages/jess/test/less/equality-mode.test.ts"]}
  },
  {
    "id": "ast-value-guard-negate-result",
    "kind": "semantic-boundary",
    "surface": "closed guard-comparison result negation",
    "files": ["packages/core/src/ast/value-guards.ts"],
    "semanticBoundary": {
      "trigger": "an ordered guard comparison reverses its left and right operands",
      "scope": "Only the closed comparison result is inverted: undefined remains undefined, negative becomes positive, positive becomes negative, and equality remains equality. Equality-mode dispatch, operand materialization, variable resolution, and declaration rendering do not enter this helper.",
      "cases": ["incomparable-remains-undefined", "negative-and-positive-reverse", "equality-remains-zero"],
      "baseline": {"fixture": "benchmark.less", "phase": "render"}
    },
    "sourceCheck": {
      "file": "packages/core/src/ast/value-guards.ts",
      "caller": "const negate = (",
      "guard": "if (c === undefined)",
      "call": "return c === -1 ? 1 : c === 1 ? -1 : 0;"
    },
    "evidence": {"command": ["pnpm", "vitest", "run", "packages/core/src/ast/__tests__/value-operate-compare.test.ts", "packages/jess/test/less/equality-mode.test.ts"]}
  },
  {
    "id": "ast-value-operate-preserve-calc",
    "kind": "semantic-boundary",
    "surface": "typed arithmetic preserve-mode calc result policy",
    "files": ["packages/core/src/ast/value-operate.ts"],
    "semanticBoundary": {
      "trigger": "a typed arithmetic operation sees a preserved calc operand or a percentage product in preserve mode",
      "scope": "Only arithmetic result construction owns this boundary. It preserves percentage-by-percentage as calc in preserve mode and composes an already-preserved calc result without collapsing its operator; loose arithmetic keeps Less numeric output. The remaining calc byte inspection is tracked as parser-structure debt and is not presented as a permanent architecture or performance result.",
      "cases": ["preserve-percentage-product", "loose-percentage-product", "explicit-calc-composition"],
      "baseline": {"fixture": "benchmark.less", "phase": "render"}
    },
    "sourceCheck": {
      "file": "packages/core/src/ast/value-operate.ts",
      "caller": "export function operate(",
      "guard": "modes.unitMode === 'preserve'",
      "call": "makeKeyword(`calc("
    },
    "evidence": {"command": ["pnpm", "vitest", "run", "packages/core/src/ast/__tests__/value-operate-units.test.ts", "packages/jess/test/less/calc-explicit-compose.test.ts"]}
  },
  {
    "id": "ast-semantic-runtime-cutover",
    "kind": "semantic-runtime",
    "surface": "canonical AST-v2 evaluator/value cutover",
    "files": [
      "packages/core/src/ast/evaluator.ts",
      "packages/core/src/ast/functions/types.ts",
      "packages/core/src/ast/guard.ts",
      "packages/core/src/ast/nodes.ts",
      "packages/core/src/ast/serialize-value.ts",
      "packages/core/src/ast/serialize.ts",
      "packages/core/src/ast/value-operate.ts",
      "packages/core/src/ast/mixin-dispatch.ts",
      "packages/core/src/ast/provenance.ts",
      "packages/core/src/ast/value-dispatch.ts",
      "packages/core/src/ast/value-eval.ts",
      "packages/core/src/ast/value-factory.ts",
      "packages/core/src/ast/value-guards.ts",
      "packages/core/src/ast/value-list.ts",
      "packages/core/src/ast/extend/compose.ts",
      "packages/core/src/ast/extend/emit.ts",
      "packages/core/src/ast/extend/ir.ts",
      "packages/core/src/ast/extend/match.ts",
      "packages/core/src/ast/extend/plan.ts",
      "packages/core/src/ast/extend/solve.ts"
    ],
    "semanticRuntime": {
      "owner": "the canonical AST-v2 evaluator/value/extend owners listed by ast-semantic-runtime-cutover",
      "scope": "This coordinated cutover changes recursive ValueGroup/List/Block facts, authored value layout, callable binding, mixin argument resolution, reference/index access, strict final-unit validation, typed guard equality, Less lazy color-call demand, and asynchronous declaration deduplication across cooperating runtime owners. Those changes are semantic architecture work with real traversal and allocation shape; no single admission counter, byte-identical A/B, or speed claim would describe them truthfully.",
      "cases": [
        "ValueSlot-array-evaluation-and-authored-layout",
        "List-value-separator-and-Block-delimiter-facts",
        "reference-index-and-For-array-access",
        "Less-lazy-color-call-demand-boundary",
        "defineFunction-typed-positional-named-and-lazy-binding",
        "mixin-dispatch-ValueSlot-argument-resolution",
        "ValueLayout-provenance-side-table",
        "preserve-mode-calc-result-composition",
        "extend-composition-plan-and-fixpoint-solve",
        "Less-eager-bare-slash-precedence-and-parens-division",
        "recursive-ValueGroup-final-unit-validation",
        "async-declaration-dedup-output-order"
      ],
      "performanceClaim": "none",
      "baseline": {"fixture": "benchmark.less", "phase": "render"}
    },
    "evidence": {
      "behaviorCommand": ["pnpm", "--filter", "@jesscss/core", "test", "--", "--run", "src/ast/__tests__/value-define-function.test.ts", "src/ast/__tests__/value-list.test.ts", "src/ast/__tests__/plugin-direct-body-scope.test.ts", "src/ast/__tests__/extend-direct-acceptance.test.ts", "src/ast/__tests__/extend-preflight-contract.test.ts", "src/ast/__tests__/value-operate-units.test.ts", "src/tree/__tests__/declaration.test.ts", "src/tree/__tests__/declaration-merge.test.ts"],
      "buildCommand": ["pnpm", "--filter", "@jesscss/core", "build"]
    }
  },
  {
    "id": "context-external-import-dispatch-boundary",
    "kind": "semantic-boundary",
    "surface": "Context explicit external import capability admission",
    "files": ["packages/core/src/context.ts"],
    "semanticBoundary": {
      "trigger": "a stylesheet import has a URL or protocol-relative identifier before Context path dispatch",
      "scope": "Context alone owns the external-import admission decision. An unclaimed identifier returns to serializer as a CSS terminal without resolver, locator, source getter, parser, cache, or network action. A claiming plugin then uses the existing Context resolve, locate, source, and parser route exactly once; core does not classify a resolver result or implement a second loader.",
      "cases": ["claimed-external-import", "unclaimed-external-terminal", "ordinary-local-import"],
      "baseline": {"fixture": "benchmark.less", "phase": "render"}
    },
    "sourceCheck": {
      "file": "packages/core/src/context.ts",
      "caller": "async loadImport(",
      "guard": "EXTERNAL_IMPORT_SPECIFIER.test(importPath)",
      "call": "plugin.canResolveImport?.(",
      "profile": ["const EXTERNAL_IMPORT_SPECIFIER", "plugin.canResolveImport?.("]
    },
    "evidence": {"command": ["pnpm", "--filter", "@jesscss/core", "test", "--", "--run", "src/ast/__tests__/import-at-rule.test.ts"]}
  },
  {
    "id": "core-context-emit-selector-contract",
    "kind": "semantic-runtime",
    "surface": "retained Context, emit, selector-match, sequence, callable, and serializer type contracts",
    "files": [
      "packages/core/src/context.ts",
      "packages/core/src/tree/extend/extend-index.ts",
      "packages/core/src/tree/sequence.ts",
      "packages/core/src/tree/util/callable-candidate-output.ts",
      "packages/core/src/tree/util/emit-walk.ts",
      "packages/core/src/tree/util/selector-match-core.ts",
      "packages/core/src/tree/util/serialize-helper.ts"
    ],
    "semanticRuntime": {
      "owner": "the retained Context/plugin dispatcher and tree evaluation/render owners listed by core-context-emit-selector-contract",
      "scope": "This bounded type-contract slice makes existing runtime facts truthful without adding a bridge, parser host, resolver, alternate evaluator, or output policy. Context keeps plugin-based source/parser/module dispatch; emit-walk reads the existing Context output option and passes Ruleset facts to the existing selector helper; selector matching exposes the string-or-node combinator surface it already filters; extend-index uses tagged IR facts instead of narrowing assertions; Sequence preserves its concrete subclass through a checked constructor boundary; callable output and serializer helpers use existing node discriminants for declaration, rules, at-rule, and selector surfaces.",
      "cases": [
        "Context-plugin-source-parser-dispatch",
        "emit-walk-context-output-option",
        "Ruleset-interpolated-selector-boundary",
        "selector-match-string-and-node-combinators",
        "extend-index-tagged-graft-atoms",
        "Sequence-subclass-preserving-evaluation",
        "callable-output-root-property-guard",
        "serializer-at-rule-and-selector-surface"
      ],
      "performanceClaim": "none",
      "baseline": {"fixture": "benchmark.less", "phase": "render"}
    },
    "evidence": {
      "behaviorCommand": ["pnpm", "--filter", "@jesscss/core", "test", "--", "--run"],
      "buildCommand": ["pnpm", "--filter", "@jesscss/core", "build"]
    }
  },
  {
    "id": "legacy-tree-strict-contract-drain",
    "kind": "semantic-runtime",
    "surface": "retained legacy tree strict runtime contracts",
    "files": [
      "packages/core/src/tree/ampersand.ts",
      "packages/core/src/tree/call.ts",
      "packages/core/src/tree/declaration.ts",
      "packages/core/src/tree/default-guard.ts",
      "packages/core/src/tree/extend.ts",
      "packages/core/src/tree/mixin.ts",
      "packages/core/src/tree/rules.ts",
      "packages/core/src/tree/scope-frame.ts",
      "packages/core/src/tree/reference.ts",
      "packages/core/src/tree/ruleset.ts",
      "packages/core/src/tree/selector-list.ts",
      "packages/core/src/util/bitset.ts",
      "packages/core/src/tree/util/combinator.ts",
      "packages/core/src/tree/util/extend.ts",
      "packages/core/src/tree/util/extend-roots.ts",
      "packages/core/src/tree/util/extend-walk.ts",
      "packages/core/src/tree/util/render-buffer.ts",
      "packages/core/src/tree/util/selector-analysis.ts"
    ],
    "supportFiles": [
      "packages/core/src/util/calculate.ts",
      "packages/core/src/tree/color.ts",
      "packages/core/src/tree/dimension.ts",
      "packages/core/src/tree/node.ts",
      "packages/core/src/tree/number.ts",
      "packages/core/src/tree/operation.ts",
      "packages/core/src/tree/selector.ts",
      "packages/core/src/tree/util/selector-utils.ts",
      "packages/core/src/tree/util/should-operate.ts"
    ],
    "coverage": "owner-plus-named-carry-forward-support",
    "semanticRuntime": {
      "owner": "the sixteen retained tree value, guard, selector-surface, registration, rendering, bitset, combinator, call, and extend owners listed by legacy-tree-strict-contract-drain",
      "scope": "This bounded strict-contract drain makes existing runtime facts truthful while retained tree consumers are removed: declaration rendering propagates existing MaybePromise results and reads provenance only through its accessor, DefaultGuard owns the value its constructor already writes, bitsets use their existing inversion reader instead of an undeclared dependency field, the shared combinator recognizer exposes the exact string-literal-or-node type it already recognizes, selector-list/extend helpers state their existing singleton-collapse and array-or-node inheritance behavior, and rules/ruleset/ampersand consumers accept the parser-delivered string-or-array selector surface they already receive. Ampersand only materializes an array where append or resolved-selector node behavior requires a node; key-set analysis consumes the raw array directly. A Call whose registered function declines CSS-compatible arguments preserves its authored call silently; an explicit error mode still propagates the failure. A mixin's invisible render is synchronously empty when it has no effect to await, and interpolated-name registration truthfully returns Mixin rather than promising the receiver subtype because preparation may return a distinct withParts result. Extend registration, root composition, and composed-match walking now admit the same selector surface and materialize it only at APIs that require Selector node behavior. It adds no compatibility shim, alternate evaluator, traversal, output policy, or performance claim.",
      "cases": [
        "declaration-sync-and-async-render-result",
        "declaration-merge-source-span-exclusion",
        "default-guard-owned-value",
        "bitset-inversion-and-disjointness",
        "string-and-node-combinator-recognition",
        "selector-list-singleton-collapse",
        "selector-list-array-or-node-inheritance",
        "parser-delivered-selector-array-ampersand",
        "selector-array-ruleset-callable-registration",
        "selector-array-key-set-analysis",
        "function-call-silent-preserve",
        "selector-compose-cache-node-boundary",
        "ordered-registration-context-restoration",
        "property-merge-container-scope",
        "mixin-invisible-sync-render-and-registration-result",
        "extend-record-selector-surface",
        "extend-root-composition-selector-surface",
        "extend-walk-composed-match-selector-surface"
      ],
      "performanceClaim": "none",
      "baseline": {"fixture": "benchmark.less", "phase": "render"}
    },
    "evidence": {
      "behaviorCommand": ["pnpm", "--filter", "@jesscss/core", "test", "--", "--run", "src/tree/__tests__/declaration.test.ts", "src/tree/__tests__/declaration-merge.test.ts"],
      "buildCommand": ["pnpm", "--filter", "@jesscss/core", "build"]
    }
  },
  {
    "id": "legacy-tree-visitor-abi-removal",
    "kind": "neutral-or-negative",
    "surface": "legacy tree Node.accept and per-node Visitor ABI removal",
    "files": ["packages/core/src/tree/node-base.ts"],
    "neutralRefactor": {
      "costDelta": "neutral",
      "why": "The Less-style Visitor and Node.accept ABI had no production or test consumers after the compat bridge cutover. Removing the dead per-node dispatch surface deletes only unreachable methods, probes, symbols, and the visitor module; Context's separate emit lifecycle hook remains internal, and no parser, import resolver, plugin dispatcher, or canonical AST serializer path enters this deleted boundary.",
      "byteIdentity": {"fixture": "benchmark.less", "collapseNesting": true, "outputSha256": "ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6", "outputBytes": 122390}
    },
    "benchmark": {"fixture": "benchmark.less", "phase": "render", "medianMs": 80.056, "outputSha256": "ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6", "outputBytes": 122390},
    "evidence": {"command": ["pnpm", "--filter", "@jesscss/core", "test", "--", "--run"]}
  },
  {
    "id": "legacy-tree-style-import-executor-removal",
    "kind": "neutral-or-negative",
    "surface": "legacy tree StyleImport executor and spine integration removal",
    "files": ["packages/core/src/tree/import-style.ts"],
    "supportFiles": [
      "packages/core/src/tree/index.ts",
      "packages/core/src/tree/mixin.ts",
      "packages/core/src/tree/node-base.ts",
      "packages/core/src/tree/rules.ts",
      "packages/core/src/tree/tree.ts",
      "packages/core/src/tree/extend/spine-extend.ts",
      "packages/core/src/tree/util/emit-walk.ts",
      "packages/core/src/tree/util/print.ts",
      "packages/core/src/tree/util/serialize-helper.ts"
    ],
    "coverage": "owner-plus-named-carry-forward-support",
    "neutralRefactor": {
      "costDelta": "decrease",
      "allowsProsecutedDangerTokens": true,
      "why": "The deleted legacy StyleImport class and its Rules/spine consumers duplicated the canonical AST-v2 serializer's typed import execution. This cut removes the tree resolver, retry queue, placement construction, import-body scans, registration wiring, caches, dedupe ledger, imported-extend re-gate, public tree export, and abort sentinel. Context/plugin loading and AST StyleImport execution remain unchanged, and no replacement bridge, traversal, allocation, or output policy is introduced.",
      "byteIdentity": {"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
    }
  },
  {
    "id": "bounded-core-tree-lint-guards",
    "kind": "semantic-runtime",
    "surface": "bounded core tree list and validation helper type-safety cleanup",
    "files": [
      "packages/core/src/tree/list.ts",
      "packages/core/src/tree/util/check-valid-nodes.ts",
      "packages/core/src/tree/util/evaluate-node-array.ts",
      "packages/core/src/tree/util/callable-candidate.ts",
      "packages/core/src/tree/util/extend-helpers.ts"
    ],
    "semanticRuntime": {
      "owner": "the five bounded core tree helper owners listed by bounded-core-tree-lint-guards",
      "scope": "This batch removes unsafe type assertions and a runtime class import cycle while preserving the existing List, node-validation, array-evaluation, callable-candidate, and extend-helper behavior. It truthfully models parser raw values at List boundaries and uses the existing coercer only where node-only consumers require it; this is semantic/type-safety work with no claimed speed, neutrality, byte identity, or cost decrease.",
      "cases": [
        "List raw NodeArrayItem normalization",
        "canonical node-array prefix guard",
        "root node validation narrowing",
        "callable candidate record narrowing",
        "extend helper lint-safe syntax"
      ],
      "performanceClaim": "none",
      "baseline": {"fixture": "benchmark.less", "phase": "render"}
    },
    "evidence": {
      "behaviorCommand": ["pnpm", "--filter", "@jesscss/core", "exec", "vitest", "run", "src/tree/__tests__/list.test.ts", "src/tree/util/__tests__/callable-candidate.test.ts", "src/tree/util/__tests__/callable-candidate-execution.test.ts", "src/tree/util/__tests__/callable-candidate-loop.test.ts", "src/tree/util/__tests__/callable-candidate-match.test.ts", "src/tree/util/__tests__/callable-candidate-output.test.ts", "src/tree/util/__tests__/callable-candidate-state.test.ts", "src/tree/util/__tests__/check-valid-nodes.test.ts", "src/tree/util/__tests__/find-extendable-locations.test.ts"],
      "buildCommand": ["pnpm", "--filter", "@jesscss/core", "run", "compile"]
    }
  }
]
```
<!-- END AGGRESSIVE-CUTTING-COST-CONTRACTS -->

### Retired snapshot records

The following seven records were evidence for earlier, narrow changes, not
active owners of the current `origin/dev..HEAD` integration delta:
`ast-merge-importance-signal`, `plugin-comment-only-filemanager-deletion`,
`ast-property-accessor-importance-signal`, `ast-dead-style-import-deletion`,
`ast-extend-prefilter-toggle-deletion`,
`ast-evaluator-stale-adapter-comment-deletion`, and
`ast-extend-public-toggle-export-deletion`.

`ast-extend-emit-lint-only-normalization` is also retired as of the AST extend
IR naming cleanup: `emit.ts` now belongs to the broader
`ast-semantic-runtime-cutover` owner, and the old lint-only record would
incorrectly claim a non-lint patch.

They are deliberately absent from the machine-readable registry. Several owned
files now contain independent AST-v2/runtime work (in particular
`serialize.ts`); retaining file-wide neutral ownership would falsely accept
that later work. Their historical `benchmark.less` oracle was 133,983 bytes,
whereas the current compiler anchor is 122,390 bytes, so it cannot be restated
as a current byte-identity proof. The underlying deletions/repairs remain in
git history; a new contract must own a current, exact runtime surface and prove
its own behavior and cost rather than borrowing any of these records.
