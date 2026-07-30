# Jess AST v2 — Variable Lookup + Binding Shape

Status: active owner direction. This replaces prior `$!`-based sigil language.

## Public sigil contract

| Source form | Meaning |
| --- | --- |
| `$foo` | Live/current reference: consult cells only. |
| `$^foo` | Scoped/final reference: consult the declaration stack only. |
| `@foo` | Less dialect spelling for scoped/final lookup. |
| `$foo:` or `$^foo:` | Create or update **both** the live cell and scoped declaration binding. The spelling does not choose what is created. |
| `$foo?:` | Test the live map, then create/update both bindings only on a miss. |
| `$^foo?:` | Test the scoped/final map, then create/update both bindings only on a miss. |
| `$foo :=` | Update the live/current binding. |
| `$^foo :=` | Update the scoped/final binding. |

`$!` and `$$` are retired. They have no compatibility recommendation or parser
fallback. `$^name` is a scoped/final lookup, not a third binding store.

## Frame shape

```
Frame {
  parent
  kind: 'scope' | 'transparent'
  declIndex: DeclIndex | null       // shared, immutable stack index
  cells: Map<name, BindingCell> | null // per-activation mutable current values
  reassign: Map<name, VarDeclaration> | null
  callables: Map<name, MixinDef[]> | null
  propIndex: PropIndex | null
  pending: VarDeclaration[] | null
  importFallback: Frame | null
  closureFrame: Frame | null
}
DeclIndex { byName: Map<name, VarDeclaration[]> }
PropIndex { byName: Map<name, Declaration[]> }
```

The two stores are deliberately separate. A live read never falls through to
`declIndex`; a scoped/final read never falls through to `cells`.

## Scoped lookup

A scoped/final read (`$^foo`, or Less `@foo`) walks `declIndex` from the
current frame toward its parent. Each name bucket is walked backwards and skips
declarations in the active exclusion set. This supplies lazy, last-wins,
order-independent resolution without a depth cap. The index is built once per
body and shared by reference; it is never mutated.

When a scoped declaration RHS is evaluated, that declaration is added to the
active exclusion set for the synchronous evaluation span. This lets a
self-reference fall back to an earlier or outer declaration and terminates
mutual cycles without a `MAX_VAR_DEPTH` limit.

## Live lookup

A live read (`$foo`) walks only `cells` from the current frame outward and reads
the nearest cell's current value. A live assignment updates the resolved owner
cell in place. A live lookup never promotes, creates, or reads a scoped stack
entry by accident.

## Writes

Both declaration spellings create or update both stores. Assignment operators
use the target lookup mode exactly:

- `$foo?:` tests the live map and creates/updates both only when it misses;
  `$^foo?:` performs the same conditional operation against the scoped/final map.
- `$foo :=` updates the live/current binding; `$^foo :=` updates the scoped/final
  binding. The scoped path writes a per-activation `reassign` overlay.
- `!global` lowers to the scoped `:=` behavior at the SCSS boundary; it is not a
  separate root-write operation.

The exact SCSS lowering is recorded in
[`spec/R6-plugins-compat-modules.md`](./spec/R6-plugins-compat-modules.md).

## Other resolution facts

- Parameters and loop synthetic declarations participate in the scoped stack.
- `closureFrame` and `importFallback` stay distinct.
- Property/member lookup uses a lazy, body-cached `PropIndex`; bare variable
  reads do not consult it.
- Strict misses throw `ReferenceError`; explicitly optional operations receive a
  miss sentinel.

## Invariants and review gates

1. Shared `DeclIndex` is never mutated.
2. A `$` read touches only `cells`; a `$^`/`@` read touches only `declIndex`.
3. `reassign` is per activation and is read before the owning shared stack.
4. No parser or evaluator re-parses source to discover a variable, import, or
   interpolation boundary.
5. Tests cover self and mutual exclusion, live/scoped separation, current and
   outer `:=`, `?:`, unbound assignment, member ambiguity, and async exclusion
   release timing.
