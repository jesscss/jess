---
id: variables
title: Variables
audiences:
  - jess
origin: jess
---

Jess exposes its two variable-resolution modes in the reference itself:

| Reference | Meaning |
| --- | --- |
| `$name` | Live reference. |
| `$^name` | Scoped/final lookup. |

Both `$name: value` and `$^name: value` create or update both bindings.
`$name?:` tests live and creates or updates both if absent; `$^name?:` tests
scoped/final and creates or updates both if absent. `$name :=` updates
live/current; `$^name :=` updates scoped/final.

See [Variables](/docs/Language/variables) for the current reference contract
and [Namespaces and maps](/docs/Language/namespaces-and-maps) for the collection
model.
