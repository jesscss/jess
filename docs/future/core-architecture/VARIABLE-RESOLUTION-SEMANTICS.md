# Jess Variable Resolution — Behavior Reference

Status: BEHAVIOR reference (not implementation). This pins the *observable* semantics of
variable resolution in Jess. For the resolver/lookup **data-shape** that implements these
rules (frames, `DeclIndex`, `cells`, the backward walk, the exclusion `Set`), see the
companion [`RESOLVER-SHAPE-SPEC.md`](./RESOLVER-SHAPE-SPEC.md).

Behavioral oracle: `packages/core/src/ast/parse-host/__tests__/var-exclusion.test.ts`
(branch `fix/var-exclusion`). Every worked example below is taken from that suite; the
suite is `describe.skip` until the reviewed resolver lands, at which point it flips to
`describe`. Legacy reference implementation of the same rules: the `searchScope` recursion
guard in `packages/core/src/tree/reference.ts` plus `packages/core/src/tree/scope-frame.ts`.

Jess has **two distinct variable models**. Which one applies is chosen by the sigil /
read-mode of the reference, not by the declaration:

1. **Regular lazy variables** (`@` / `$`) — declarative, order-independent, CSS-custom-
   property-like. The bulk of this document.
2. **Live bindings** (`$!` / `:=`) — imperative, order-dependent, read-current-then-mutate.
   The opposite model. See [Live bindings](#live-bindings-).

---

## 1. Regular variables (`@` / `$`) are LAZY

A declaration's value is evaluated **on demand at reference time**, never at declaration
time. Declaring `$a: expensive()` does no work until some reference to `$a` is resolved,
and it is re-evaluated per reference (the resolved value is not cached — the value depends
on the active exclusion context; see [§4](#4-cycles-are-impossible-by-construction)).

## 2. Order-INDEPENDENT, scope-upward, LAST-WINS

Like CSS custom properties, a reference resolves against the accessible scope regardless of
source order:

- **Forward references work.** A reference can precede the declaration textually.
- **Scope-upward.** Resolution walks the current scope, then each enclosing scope, outward.
- **Last-wins within a scope.** When a name is declared more than once in the same scope,
  the last declaration wins.

```less
.x { color: @a; } @a: red;
// → color: red      (forward reference; order-independent, scope-upward)
```

> Oracle: *"forward reference: order-independent, scope-upward"*.

```less
@a: 5; .x { @a: @a + 1; v: @a; }
// → v: 6            (inner @a reads the outer binding — see §3 — then §2 last-wins gives 6)
```

> Oracle: *"inner declaration reads the outer binding, not itself"*.

## 3. Per-declaration EXCLUSION

While a declaration's value is being resolved, **that declaration is excluded from
lookups of its own name**. The lookup falls back to *other* same-name declarations in
scope. This is exactly the CSS custom-property rule `--a: var(--a)` — the `var(--a)` on the
right resolves to a *prior/outer* `--a`, not to the declaration being defined.

```less
@a: 1; @a: @a + 1; .x { v: @a; }
// → v: 2
// The 2nd @a excludes ITSELF while resolving; its `@a` lookup falls back to the
// first `@a: 1` in the same scope → 1 + 1 = 2.
```

> Oracle: *"same-list redefinition sees the earlier declaration, not itself"*. This is the
> decisive case separating per-declaration exclusion from a plain "resolve to the outer
> scope" rule — there is no outer scope here; the fallback is the *earlier same-scope*
> declaration.

CSS parallel: `--a: foo; --a: var(--a);` → `foo`.

## 4. Cycles are impossible by CONSTRUCTION

The exclusion set **accumulates down the lazy-resolution descent** — each nested value
resolution adds its own declaration to the active exclusion set, and the set is held for
the synchronous span of that value's evaluation. So both self-cycles and mutual cycles
terminate: the cyclic reference simply finds nothing (every same-name declaration on the
path is already excluded) and the value resolves to **undefined**.

An undefined resolution is an eval error — a `ReferenceError` (see [§5](#5-strict-vs-optional-resolution)).
It is **never** a "cyclic reference" error (contrast Less 4.x, which detects cycles and
reports them specially) and **never** an infinite loop.

```less
@a: @a; .x { v: @a; }
// → ReferenceError   (direct self reference: @a excludes @a, no fallback → undefined)
```

> Oracle: *"direct self reference resolves to undefined (eval error)"*.

```less
@a: @b; @b: @a; .x { v: @a; }
// → ReferenceError   (mutual reference)
// Resolving @a excludes @a, evaluates @b; resolving @b excludes @b, evaluates @a —
// @a is ALREADY in the accumulated exclusion set → undefined. Terminates at any depth.
```

> Oracle: *"mutual reference resolves to undefined (eval error)"*.

```less
@a: @a + 1; .x { v: @a; }
// → ReferenceError   (self reference with no outer binding)
// The sole @a excludes itself; there is no fallback @a, so @a is undefined during
// its own resolution. Owner-settled: this is a plain undefined error, NOT a cyclic error.
```

> Oracle: *"self reference with no outer binding errors"* (owner-flagged in the oracle,
> now settled — see `RESOLVER-SHAPE-SPEC.md` "OPEN" note, resolved).

Because cycles cannot occur, there is **no depth cap** (`MAX_VAR_DEPTH` is deleted). The
legacy `ast/` bug this fixes recursed to a `MAX_VAR_DEPTH=64` cap and then emitted `@name`
byte-garbage; the correct behavior is a clean `ReferenceError`.

## 5. Strict vs optional resolution

Resolution has an orthogonal strict/optional flag:

- **Strict (default):** any failed resolution — unknown name, or a cycle-induced undefined —
  **throws `ReferenceError`**.
- **Optional:** an *existence test* (`isdefined()`, `!default` / `$foo?:`) returns nothing
  on a miss, with **no error**.

```less
.x { v: @undefined; }
// → ReferenceError   (an unknown variable is an eval error)
```

> Oracle: *"an unknown variable is an eval error"*.

The optional path depends on the strict path throwing `ReferenceError` specifically:
`fns/less/isdefined.ts` catches `ReferenceError` to implement the existence test. Any
resolver change must keep throwing exactly `ReferenceError` on a strict miss.

---

## Live bindings (`$!`)

`$!` live bindings are the **opposite model** — imperative and order-**dependent**. A `$!var`
reference reads the value **currently bound at that sequential evaluation point** — not
hoisted, not last-wins, not lazy. This is the R3 live-binding model.

```scss
$foo: $!foo + 1     // reads as `x = x + 1` — the current live value of foo, plus one
```

Assigning a live binding (`$!foo: …` or `:= `) mutates an **existing** binding in place:

- `$!foo: value` reassigns the live binding.
- `$foo := value` reassigns the **nearest enclosing** binding that already defines `foo`
  (JS-block style; distinct from Sass `!global`, which targets the top binding).

Live-assign to an **unbound** name is a `ReferenceError` — it does **not** auto-create the
binding. (Owner-settled: live-assign requires an existing binding.)

```scss
.btn {
  $color: red;
  color: $!color;   // live: reflects the latest value
  $color: blue;     // color resolves to blue
}
```

The regular vs live contrast in one line: a regular `$color` reference is declarative
(order-independent, resolves against the whole accessible scope); a `$!color` reference is
imperative (reads whatever is bound at that exact sequential point).

---

## OPEN — pending owner confirmation

**Regular `@` vs `$` read mode.** It is **not yet settled** whether there is a read-mode
distinction between Less-style `@` (hoisted-lazy) and Jess-style `$` (snapshot) for
*regular* variables, or whether regular `@` and `$` behave identically and only `$!` differs.
`RESOLVER-SHAPE-SPEC.md` records this as OPEN ("confirm `@`=hoisted-lazy, `$`=snapshot").
Everything above (lazy, order-independence, exclusion, cycle-safety, strict/optional →
`ReferenceError`, and the `$!` live model) holds under either resolution of this point;
only the possible `@`/`$` read-mode split remains unconfirmed. Do not assert a distinction
until the owner confirms.

The `$!` read = current-value point is SETTLED. `$!foo:` on an unbound name → `ReferenceError`
is SETTLED. The no-outer `@a:@a+1` → `ReferenceError` case is SETTLED.
