# Variable Resolution Semantics

This is the reader-facing companion to
[`RESOLVER-SHAPE-SPEC.md`](./RESOLVER-SHAPE-SPEC.md).

## The two lookup modes

- `$foo` reads the live/current binding.
- `$^foo` reads through the scoped/final declaration lookup.
- Less `@foo` is the dialect spelling of the scoped/final lookup.
- `$!` and `$$` are retired and must not be documented as fallback spellings.

Both `$foo: value` and `$^foo: value` create or update the live and scoped
bindings. The reference sigil affects lookup only; it never selects a different
declaration kind.

## Assignments

`$foo?: value` tests the live map and creates/updates both bindings only on a
miss; `$^foo?: value` does the same against the scoped/final map. `$foo :=`
updates the live/current binding; `$^foo :=` updates the scoped/final binding.

## Scoped behavior

Scoped lookup is lazy, order-independent, and last-wins. An active declaration
is excluded while its RHS evaluates, which makes self-reference fall back and
terminates mutual cycles. A missing strict lookup throws `ReferenceError`.

## Live behavior

Live lookup reads the nearest current cell at evaluation time. It never falls
back to a scoped declaration, and scoped lookup never falls back to a live cell.

Implementation shape and performance invariants live in the resolver spec.
