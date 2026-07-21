# R3 — Live and Scoped Binding Stores

Status: active owner direction. Earlier `$!` terminology is retired.

## Source contract

| Form | Operation |
| --- | --- |
| `$foo` | Read the live/current map. |
| `$$foo` | Read the scoped/final map. |
| `$foo:` or `$$foo:` | Create or update both maps. |
| `$foo?:` | Test live; create/update both maps only if absent. |
| `$$foo?:` | Test scoped/final; create/update both maps only if absent. |
| `$foo :=` | Update live/current. |
| `$$foo :=` | Update scoped/final. |

`$!` is retired. A sigil never selects the binding created by a declaration; it
selects the lookup map used by a reference or lookup-bearing assignment.

## Runtime shape

Every activation has separate live cells and a shared-by-body scoped declaration
index. The scoped index is immutable and lazy; live cells are mutable current
values. A scoped reassignment uses a per-activation overlay rather than mutating
the shared index. See
[`../RESOLVER-SHAPE-SPEC.md`](../RESOLVER-SHAPE-SPEC.md) for the complete frame
contract, exclusion rule, and performance constraints.
