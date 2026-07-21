# Parseman diagnostic choice trace

This is a future Parseman design note. Parseman `0.28.0` is published; it does
not request a release, a Jess parser change, or normal-build instrumentation.

## Why the existing trace is insufficient

An isolated coverage-enabled macro transform of the current Less AST grammar
parses `packages/jess/benchmark/benchmark.less` completely. Its rule trace
records `DirectLessStaticNthPseudo` 14,360 entries (14,330 failures, 30
successes) and `DirectLessStaticPseudo` 14,330 entries (10,878 failures, 3,452
successes). The normal built Less bundle confirms the source: the static
compound choice tests only `:` before calling each whole rule in order. A failed
rule enters its structural-node wrapper before rejecting its name.

That proves a shared-prefix candidate exists. It does not identify the winning
rewrite. The diagnostic grammar currently has 241 `rule` definitions and zero
`choice-arm` definitions. It can report that `StaticNthPseudo` failed, but not
whether the failure was its name, opening paren, An+B argument, closing paren,
or a rollback from one of its two typed alternatives. It likewise cannot split
the selector-pseudo and generic-pseudo branches.

The special pseudo names and generic identifier path overlap after `:`. A
blind rewrite to “first-set dispatch” would need a literal trie plus a residual
identifier route and exact identifier-boundary behavior. It cannot be honestly
called a no-lookahead/no-regex simplification from the current aggregate rule
counts.

## Proposed diagnostic API

Keep existing stable `rule:<name>` IDs exactly as they are. Add stable,
deterministic structural choice-arm IDs derived from the named containing rule
and its structural child path, for example:

```text
choice:DirectLessStaticPseudo/choice[0]/arm[0]
choice:DirectLessStaticPseudo/choice[0]/arm[1]
```

The exact spelling is less important than these invariants:

- Existing rule and label IDs never change when choice-arm tracing is added.
- An arm ID identifies a grammar structure, never generated variable names,
  source offsets, or macro-emission order unrelated to its containing rule.
- Refactoring an unrelated grammar subtree does not renumber a stable sibling.
- `selected`, `success`, `failure`, `backtrack`, and `rollback` events use the
  same arm ID; rejected attempts do not become semantic coverage hits.

`GrammarCoverageDefinition.kind: 'choice-arm'` is already part of Parseman's
published type vocabulary. The diagnostic plan should populate it only for
named-rule-reachable choices. Coverage remains a semantic winner set: selected
arms can increment a collector, while failed/rolled-back arms remain trace-only.

The user-facing shape remains opt-in and bounded:

```ts
const trace = createGrammarTraceSink({ capacity: 50_000 });
const ctx = createGrammarInstrumentationContext({ collector, trace });
run(grammar.Entry, source, { trivia: grammar.whitespace, instrumentation: ctx });
```

Normal macro output must contain no coverage/trace hooks unless the build
explicitly enables `grammarCoverage`. A normal `run()` must not allocate a
collector, trace sink, event object, branch array, or runtime switch for this
facility. The existing separate Vite diagnostic transform is the intended Jess
consumer; benchmark and compiler paths remain uninstrumented.

## Adversarial acceptance plan

Before a Less grammar experiment, run the diagnostic transform against a small
selector matrix and assert arm selection plus parser acceptance/rejection:

- valid nth forms: `:nth-child(2n+1)`, `:nth-last-child(odd)`,
  `:nth-of-type(3n)`, `:nth-last-of-type(2)`;
- near prefixes that must stay generic or reject according to the current
  grammar: `:nth`, `:nth-`, `:nth-childish()`, `:nth-of-typex()`;
- generic functional pseudos: `:hover`, `:lang(en)`, `:is(.a, .b)`,
  `:not(:nth-child(2n))`;
- single/double colon variants, whitespace/comments around `(`, malformed
  opening/closing parens, `of` selector arguments, and nested selector lists;
- repeated selectors and declaration-colon contexts from `benchmark.less`, to
  distinguish genuine selector work from broad grammar speculative entry.

The report must include selected/failure/backtrack/rollback counts by arm and
the unchanged rule-coverage definition list. Only then choose between a
structural trie/residual experiment and preserving the current grammar.
