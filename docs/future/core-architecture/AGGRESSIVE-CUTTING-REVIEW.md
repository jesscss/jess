# Aggressive Cutting Review

Delete unnecessary machinery before adding code. A change may not introduce a
parser host, action registry, bridge, compatibility alias, source reparse, or
fallback path. New traversal, allocation, copying, metadata, helper/API
surface, and hot-path state need explicit ownership and measured evidence.

Before a queue pass, update the self-prosecution block in `HANDOFF.md` and run:

```sh
pnpm run verify:aggressive-cutting-review
```

The registry stays intentionally minimal. It retains one valid contract solely
because the verifier currently requires a non-empty registry; it is not a new
active architecture queue.

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
    "id": "css-private-direct-ast-family",
    "kind": "private-unreachable",
    "surface": "private CSS AST grammar development family",
    "files": ["packages/css-parser/src/ast/grammar.ts"],
    "coverage": "owner-plus-named-carry-forward-support",
    "supportFiles": ["packages/css-parser/src/ast/syntax.grammar.ts"],
    "privateGrammar": {
      "entry": "packages/css-parser/src/ast/grammar.ts",
      "coldConstructionOnly": true,
      "why": "The module is intentionally absent from every CSS public entry and from the CST grammar. Its only importer is the focused construction test, so Parseman reductions and their temporary arrays run only when that test or a future explicit direct-AST root invokes this private rule."
    }
  },
  {
    "id": "less-private-direct-ast-family",
    "kind": "private-unreachable",
    "surface": "private Less AST grammar development family",
    "files": ["packages/less-parser/src/ast/grammar.ts"],
    "privateGrammar": {
      "entry": "packages/less-parser/src/ast/grammar.ts",
      "coldConstructionOnly": true,
      "why": "The module is intentionally absent from every Less public entry and from the CST grammar. Its only importers are focused construction tests, so Parseman reductions and their temporary arrays run only when those tests or a future explicit direct-AST root invokes this private rule."
    }
  },
  {
    "id": "ast-merge-importance-signal",
    "kind": "neutral-or-negative",
    "surface": "mergeFold importance propagation",
    "files": ["packages/core/src/ast/serialize.ts"],
    "neutralRefactor": {
      "costDelta": "neutral",
      "why": "The already-admitted declaration-merge loop carries one importance bit on its existing emit context instead of allocating a per-member sink. It repairs the ordinary declaration contract for Important values reached through a variable; it makes no speed claim.",
      "byteIdentity": {
        "fixture": "benchmark.less",
        "collapseNesting": true,
        "outputSha256": "adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840",
        "outputBytes": 133983
      }
    }
  },
  {
    "id": "plugin-comment-only-filemanager-deletion",
    "kind": "neutral-or-negative",
    "surface": "removal of commented-out FileManager sketch",
    "files": ["packages/core/src/plugin.ts"],
    "neutralRefactor": {
      "costDelta": "neutral",
      "why": "This deletes 107 lines that were entirely line comments: no emitted JavaScript, declarations, exports, imports, or runtime branches change. The retained PluginInterface and AbstractPlugin resolver methods are untouched.",
      "byteIdentity": {
        "fixture": "benchmark.less",
        "collapseNesting": true,
        "outputSha256": "adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840",
        "outputBytes": 133983
      }
    }
  },
  {
    "id": "ast-property-accessor-importance-signal",
    "kind": "neutral-or-negative",
    "surface": "PropRef declaration-importance propagation",
    "files": ["packages/core/src/ast/serialize.ts"],
    "neutralRefactor": {
      "costDelta": "neutral",
      "why": "The existing property-declaration lookup carries the source flag into the pre-existing ordinary/merge importance state. It adds no traversal, node, helper, map, or alternate value path and makes no speed claim.",
      "byteIdentity": {
        "fixture": "benchmark.less",
        "collapseNesting": true,
        "outputSha256": "adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840",
        "outputBytes": 133983
      }
    }
  },
  {
    "id": "ast-dead-style-import-deletion",
    "kind": "neutral-or-negative",
    "surface": "unreachable AST-v2 StyleImport node and serializer branch",
    "files": ["packages/core/src/ast/node.ts"],
    "coverage": "owner-plus-named-carry-forward-support",
    "supportFiles": ["packages/core/src/ast/nodes.ts", "packages/core/src/ast/serialize.ts"],
    "neutralRefactor": {
      "costDelta": "decrease",
      "why": "No parser, test, public entry, or production caller constructs AST-v2 StyleImport. Removing its union members, root hoist prewalk, root branch, and emit helpers leaves the live typed ImportAtRule path intact while deleting an unreachable node vocabulary and serializer work.",
      "byteIdentity": {
        "fixture": "benchmark.less",
        "collapseNesting": true,
        "outputSha256": "adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840",
        "outputBytes": 133983
      }
    }
  },
  {
    "id": "ast-extend-prefilter-toggle-deletion",
    "kind": "neutral-or-negative",
    "surface": "canonical AST extend candidate admission",
    "files": ["packages/core/src/ast/extend/solve.ts"],
    "coverage": "owner-plus-named-carry-forward-support",
    "supportFiles": ["packages/core/src/ast/extend.ts", "packages/core/src/ast/extend/emit.ts", "packages/core/src/ast/__tests__/extend-direct-acceptance.test.ts"],
    "neutralRefactor": {
      "costDelta": "decrease",
      "why": "The deleted mutable test toggle and alternate full-scan branch had no callers. The production candidate prefilter and prune were already permanently enabled; direct AST cases cover partial graft, nested own-extend descendant closure, media reachability, and structured interpolation without restoring a host or second runtime path. No speed claim is made.",
      "byteIdentity": {
        "fixture": "benchmark.less",
        "collapseNesting": true,
        "outputSha256": "adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840",
        "outputBytes": 133983
      }
    }
  },
  {
    "id": "ast-evaluator-stale-adapter-comment-deletion",
    "kind": "neutral-or-negative",
    "surface": "AST evaluator comments",
    "files": ["packages/core/src/ast/evaluator.ts"],
    "neutralRefactor": {
      "costDelta": "neutral",
      "why": "Deletes stale adapter terminology from comments only; emitted JavaScript and evaluator control flow are unchanged.",
      "byteIdentity": {"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}
    }
  },
  {
    "id": "ast-extend-public-toggle-export-deletion",
    "kind": "neutral-or-negative",
    "surface": "AST extend module export surface",
    "files": ["packages/core/src/ast/extend.ts"],
    "neutralRefactor": {
      "costDelta": "decrease",
      "why": "Deletes the uncalled test-only toggle export. The remaining module exports its live compute operation unchanged.",
      "byteIdentity": {"fixture":"benchmark.less","collapseNesting":true,"outputSha256":"adfd26732125a33fc1e264aca7d7ecde8c7c1da43f968e3106bd387a1f78e840","outputBytes":133983}
    }
  }
]
```
<!-- END AGGRESSIVE-CUTTING-COST-CONTRACTS -->
