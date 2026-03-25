# Node Copy Reduction

## What This Refactor Is Now

This refactor is no longer mainly about deleting `clone()` calls.

It is about moving Jess to this runtime model:

- one immutable canonical/source tree
- many lazy session-local instances over that tree
- sparse shadow state only where behavior diverges
- dependency reach deciding which paths need shadow state

The current node-keyed session-overlay work was a useful bridge. It is not the final design.

## Read Order

1. [session-instance-architecture.md](./session-instance-architecture.md)
2. [dependency-graph.md](./dependency-graph.md)
3. [PROGRESS.md](./PROGRESS.md)
4. [node-session-status.md](./node-session-status.md)
5. [HANDOFF.md](./HANDOFF.md)

## Current Verdict

What the branch already proved:

- immutable source nodes are the right base
- a lot of canonical eval-time mutation can be removed
- the hard remaining cases are all pointing at the same missing abstraction

What the branch has not proved yet:

- multiple live instances of the same canonical subtree inside one eval session
- sparse shadowing across broad trees without broad wrapper/materialization pressure
- repeated imports and repeated mixin/function reuse on top of that model

So the branch is still not merge-ready.

## The Target Architecture

The target model is:

- `EvalSession`
  - one evaluation run
- `SessionInstanceRoot`
  - one import/call/reuse placement of a canonical subtree
- lazy node views
  - node-shaped runtime objects backed by a canonical source node plus one instance root
- sparse shadow state
  - only touched or dependency-affected nodes get local state

The API must stay elegant:

- `node.value`
- `node.parent`
- `node.eval(context)`

Not:

- `getField(node, context, instance)`
- `getParent(node, context, instance)`

## Hard Rules

### Runtime rule

Internal evaluation should operate on:

- canonical source nodes
- lazy instance-local views
- sparse shadow state

Not on fresh materialized trees.

### Materialization rule

Materialization is only allowed at an explicit downstream boundary where Jess must hand off a standalone evaluated object graph that may outlive the session.

If an internal eval path still needs materialization to work, that path is not done.

### API rule

Do not make node usage uglier.

- no explicit instance parameter on ordinary node access
- no second-class helper API for simple node work
- no bridge-helper growth without mapping it to the final instance model

## What Counts As Success

Two proofs matter more than local helper cleanup.

### Repeated import proof

Import the same file 3 times as `multiple`.

- import 1: no override
- import 2: one variable override
- import 3: one variable override

We need to prove:

- 3 instance roots over one canonical imported tree
- only thin local shadow state for imports 2 and 3
- untouched nodes stay source-backed

### Repeated mixin/function proof

Call the same mixin or stylesheet function 3 times.

- only one input changes on call 3
- only one declaration path is affected

We need to prove:

- 3 instance roots over one canonical body
- only the affected path gets local shadow state
- the rest of the tree stays source-backed

## What To Avoid

- treating the current `EvalSession` maps as the final runtime model
- treating local green slices as architectural completion
- adding more wrapper/helper categories instead of defining the instance model
- solving reuse pressure with broad shallow wrappers and calling it done

## Short Version

The old bridge work matters because it exposed the real problem.

The real problem is not “how do we remove one more clone.”

It is:

- “how do we represent many lazy session-local instances over one immutable source tree, with sparse dependency-driven shadow state, while keeping the node API unchanged?”
