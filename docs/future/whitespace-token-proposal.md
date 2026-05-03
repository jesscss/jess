# TriviaMap Status

This document started as the proposal for removing node-owned `pre` / `post`
formatting state. That migration is now far enough along that the useful thing
is a status/spec note, not the old proposal text.

## Current Model

Trivia is file-context data. It is not node-owned data.

The parser builds one `TriviaMap` for continuous skipped-token runs. A run can
be looked up relative to an offset:

```ts
trivia.lookup(offset, 'before' | 'after')
```

`before` and `after` are lookup directions. They are not trivia kinds, and they
do not imply ownership. The same token run can be indexed from both neighboring
source offsets so callers can ask for trivia before the next token or after the
previous token. During one render traversal, a token run is consumed once through
`PrintOptions.emittedTrivia`.

That gives the serializer the one invariant it needs:

- whitespace and inline/value comments live in the `TriviaMap`
- direct rule-body block comments are `Comment` nodes
- direct rule-body `Comment` nodes serialize in rule order
- numeric/indexed `Rules` lookup skips those direct `Comment` nodes
- copied or evaluated values that move to a new placement must not keep copied
  source-offset trivia; use `detachTrivia(deep)` for those values
- generated/API-created nodes without source offsets use the owning container's
  normal formatting rule

## Parser State

Parser-side trivia ownership is gone. The parser should not have `getPrePost`,
`usedSkippedTokens`, `preSkippedTokenMap`, or `postSkippedTokenMap` concepts.

The parser may index the same skipped-token run for lookup from either side of a
boundary, but it is still one run. Rendering decides which side consumes it.

## Serializer State

Node `toString()` emits source trivia through the active print options and
tracks consumed token runs with `emittedTrivia`.

Sequence spacing follows this rule:

- if child offsets provide source evidence for the boundary, use that evidence
- if source trivia exists, emit it
- if the source boundary has no trivia, do not invent spacing for that boundary
- if there is no source evidence, use the sequence/container default spacing

This avoids per-node spacing metadata. A sequence should not learn about
selector-specific edge cases or store boundary hints just to satisfy a fixture.

Container serializers still normalize trivia by context. Jess does not preserve
trivia everywhere:

- declaration value line breaks are preserved when they are authored value
  structure
- selector pseudo arguments such as `:is(...)` should stay on one line unless a
  specific serializer rule says otherwise
- standalone rule-body comments are semantic rule entries
- inline/value comments remain trivia and are emitted only where the owning
  serializer chooses to consume them

## Removed Systems

These old systems should not come back:

- node-owned `.pre` / `.post`
- parser `wrap()` calls that attach skipped tokens to nodes
- parser `getPrePost()`
- parser `usedSkippedTokens`
- `processPrePost()` and `stripPrePost()`
- boundary-intent metadata such as `preIntent`, `postIntent`,
  `signalBoundaryIntent`, and `captureWithMeta`
- `_triviaOffsets` or any replacement field that copies source trivia offsets
  onto evaluated nodes

If a copied/evaluated node needs to remember its original semantic source node,
that is `sourceNode`. It is not permission to reuse the original formatting
offsets at a new render placement.

## Comment Shape

Jess uses a deliberate hybrid:

- direct block comments in rule bodies are `Comment` children
- inline comments in values/selectors stay in the `TriviaMap`
- whitespace is always trivia

This keeps rule-body comments visible where they behave like rule entries, while
avoiding comment pollution in values and selector internals.

The direct rule-body case is the only child-array exception. Do not generalize it
into "comments are AST nodes everywhere."

## Remaining Cleanup

The parser side is no longer the main migration surface. Remaining work is mostly
serializer and AST-shape cleanup:

- keep removing old proposal language from handoff/performance docs when it
  suggests parser-owned pre/post or `_triviaOffsets`
- audit `serialize-helper.ts` for ad hoc text/comment scanning and replace it
  with `TriviaMap` or explicit `Comment` node handling when there is a tested
  structural rule
- keep helper names clear that `before` / `after` are lookup directions, not
  trivia ownership
- continue the `toString()` to `render()` conversion after the TriviaMap contract
  is stable

For any new serializer rule, prove the node shape first. A rule should be backed
by multiple serialization tests or direct AST evidence, not by matching one Less
fixture substring.
