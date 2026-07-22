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
    "id": "rules-merge-coalescing",
    "surface": "Rules._coalesceMergedDeclarations",
    "files": ["packages/core/src/tree/rules.ts"],
    "coverage": "owner-plus-named-carry-forward-support",
    "supportFiles": ["packages/core/src/tree/apply.ts", "packages/core/src/tree/at-rule.ts", "packages/core/src/tree/call.ts", "packages/core/src/tree/control.ts", "packages/core/src/tree/import-style.ts", "packages/core/src/tree/ruleset.ts", "packages/core/src/tree/util/callable-surface.ts"],
    "necessity": {"status":"proven","factSource":"Declaration.options.normalizedFromAssign identifies merge assignments at construction and evaluation boundaries","rediscovery":"The old path recursively scanned Rules surfaces and child Rules nodes at finish time","carryForward":"Rules.rulesFlags carries one merge-presence bit and updates it at construction, derivation, insertion, replacement, and destructive-array repair","whyNotCarried":"The bounded refresh remains only after destructive whole-array rewrites"},
    "admission": {"predicate":"cheap merge-output-surface presence check","cost":"cheap","counter":"admissionCalls","workCounter":"admissionItemsVisited","maxItemsPerContainer":8,"before":"collection and allocation"},
    "counters": ["calls", "admittedCalls", "admissionCalls", "admissionItemsVisited", "containers", "featureBearingContainers", "itemsVisited", "featureItems", "noFeatureAllocations", "noFeatureMisses"],
    "commonCaseProof": "counter test and no-merge benchmark workload",
    "benchmark": {"fixture":"benchmark.less","phases":["parse-render","render"],"warmup":20,"pairs":45},
    "relations": ["calls <= admittedCalls", "admittedCalls <= admissionCalls", "admittedCalls <= featureBearingContainers", "featureBearingContainers < containers", "noFeatureAllocations === 0"],
    "evidence": {"command":["node","scripts/profile-less-benchmark.mjs","--assert-merge-contract","--assert-live-merge-contract"]},
    "sourceCheck": {"file":"packages/core/src/tree/rules.ts","caller":"_finishSourceOrderEvaluation","call":"_coalesceMergedDeclarations","guard":"hasMergeOutputSurface","profile":["MERGE_PROFILE_COUNTERS_KEY","recordMergeProfile"]}
  },
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
      "packages/core/src/ast/serialize.ts",
      "packages/core/src/ast/value-operate.ts",
      "packages/core/src/ast/mixin-dispatch.ts",
      "packages/core/src/ast/provenance.ts",
      "packages/core/src/ast/value-dispatch.ts",
      "packages/core/src/ast/value-eval.ts"
    ],
    "semanticRuntime": {
      "owner": "the seven canonical AST-v2 evaluator/value owners listed by ast-semantic-runtime-cutover",
      "scope": "This coordinated cutover changes ValueSlot/List/Block facts, authored value layout, callable binding, mixin argument resolution, reference/index access, and Less lazy color-call demand across cooperating runtime owners. Those changes are semantic architecture work with real traversal and allocation shape; no single admission counter, byte-identical A/B, or speed claim would describe them truthfully.",
      "cases": [
        "ValueSlot-array-evaluation-and-authored-layout",
        "List-value-separator-and-Block-delimiter-facts",
        "reference-index-and-For-array-access",
        "Less-lazy-color-call-demand-boundary",
        "defineFunction-typed-positional-named-and-lazy-binding",
        "mixin-dispatch-ValueSlot-argument-resolution",
        "ValueLayout-provenance-side-table",
        "preserve-mode-calc-result-composition"
      ],
      "performanceClaim": "none",
      "baseline": {"fixture": "benchmark.less", "phase": "render"}
    },
    "evidence": {
      "behaviorCommand": ["pnpm", "run", "verify:baseline"],
      "buildCommand": ["pnpm", "run", "build:release"]
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
    "id": "legacy-tree-visitor-abi-removal",
    "kind": "neutral-or-negative",
    "surface": "legacy tree Node.accept and per-node Visitor ABI removal",
    "files": ["packages/core/src/tree/node-base.ts"],
    "neutralRefactor": {
      "costDelta": "neutral",
      "why": "The Less-style Visitor and Node.accept ABI had no production or test consumers after the compat bridge cutover. Removing the dead per-node dispatch surface deletes only unreachable methods, probes, symbols, and the visitor module; Context's separate SpineVisitor lifecycle hook remains, and no parser, import resolver, plugin dispatcher, or canonical AST serializer path enters this deleted boundary.",
      "byteIdentity": {"fixture": "benchmark.less", "collapseNesting": true, "outputSha256": "ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6", "outputBytes": 122390}
    },
    "benchmark": {"fixture": "benchmark.less", "phase": "render", "medianMs": 80.056, "outputSha256": "ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6", "outputBytes": 122390},
    "evidence": {"command": ["pnpm", "--filter", "@jesscss/core", "test", "--", "--run"]}
  },
  {
    "id": "serializer-lint-only-normalization",
    "kind": "neutral-or-negative",
    "surface": "mechanical ESLint normalization in the existing serializer/import walk",
    "files": ["packages/core/src/tree/util/serialize-helper.ts"],
    "supportFiles": ["packages/core/src/tree/util/emit-walk.ts"],
    "coverage": "owner-plus-named-carry-forward-support",
    "neutralRefactor": {
      "costDelta": "neutral",
      "allowsProsecutedDangerTokens": true,
      "why": "This slice changes only ESLint-required indentation/control-bracing and upgrades an existing StyleImport discriminant check into a truthful TypeScript type predicate. It adds no runtime branch, traversal, allocation, resolver, or output policy; the predicate preserves the existing type check and the serializer/import walk remains the same execution path.",
      "byteIdentity": {"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"ea918f2d9ab4512b401cf6fd0bf96e9aab025357dd92c35f23e14b878a5891c6","outputBytes":122390}
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

They are deliberately absent from the machine-readable registry. Several owned
files now contain independent AST-v2/runtime work (in particular
`serialize.ts`); retaining file-wide neutral ownership would falsely accept
that later work. Their historical `benchmark.less` oracle was 133,983 bytes,
whereas the current compiler anchor is 122,390 bytes, so it cannot be restated
as a current byte-identity proof. The underlying deletions/repairs remain in
git history; a new contract must own a current, exact runtime surface and prove
its own behavior and cost rather than borrowing any of these records.
