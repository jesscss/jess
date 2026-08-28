# Unified Node Model Spec

> **Historical design spec — superseded by the public AST-v2 model.** This
> document records an earlier tree2 value-model audit. It is not an approved
> target for parser/runtime shape. In particular, ordinary declaration/value
> terms are now recursive raw `ValueSlot` arrays (not `SpacedValue`), Sass
> separator facts live in `List.sep`, and delimiter/bracketedness lives in
> `Block.delimiter`. Use `docs/architecture/core/HANDOFF.md` and
> `DESIGN-DECISIONS.md` for the current public architecture; retain this file
> only for historical debt evidence.

READ-ONLY design spec. Base: `origin/dev`. Scope: `packages/core/src/ast/` (the
"tree2" corpus) and its former `packages/jess-plugin-less-compat/` consumer.

## 0. The debt in one sentence

`packages/core/src/ast/` ships **two incompatible node representations plus a
third the bridge reads**:

| Corpus | File(s) | Shape | Discriminant |
|---|---|---|---|
| Structural AST ("tree2") | `node.ts`, `nodes.ts`, `at-rule.ts` | `class X extends Node` | numeric `readonly kind = Kind.X` (`enum Kind { Dimension = 9 }`) |
| Value domain (eval results) | `value-eval.ts`, `value-factory.ts`, `serialize-value.ts` | plain-data `interface` | string-lowercase `kind: 'dimension'` |
| Less bridge target | `jess-plugin-less-compat/` | plain object | string-PascalCase `type: 'Dimension'` (Less.js native) |

`Dimension` exists as a class (`kind: Kind.Dimension`, fields `value`/`unit`) **and**
as an interface (`kind: 'dimension'`, fields `number`/`unit`/`bytes`). Three
discriminant styles for one conceptual model.

## 1. Owner-pinned target (DECIDED — not relitigated here)

1. **One representation corpus-wide = plain-data objects.** The
   `class … extends Node` hierarchy dies. `Node` stays the exported type *name*
   but becomes a **discriminated union of plain-data interfaces**. No emit
   methods on nodes (the free-function serialize/eval seam stays tree-shakeable).
2. **Discriminant = `type`, PascalCase, Less-matching**: `type: 'Dimension'`,
   `type: 'Rule'`, … The numeric `Kind` enum **and** the lowercase
   `kind: 'dimension'` both die. The value domain
   (Color/Dimension/Quoted/Keyword/List/Bool/Nil) also switches to PascalCase `type`.
3. `statements` **not** `stmts` (the `frame.stmts` field in `serialize.ts`).
4. `Sequence` **not** `Concat` (the `Concat` class in `nodes.ts`).

---

## A. Inventory

### A.1 Structural nodes — `enum Kind` (`node.ts`) + classes (`nodes.ts`, `at-rule.ts`)

27 kinds (0–26). All are `class X extends Node` with `readonly kind = Kind.X as const`.

| `Kind` | Class | Key fields | Target `type` |
|---|---|---|---|
| 0 Stylesheet | `Stylesheet` | `children: Statement[]` | `'Stylesheet'` |
| 1 Rule | `Rule` | `selector`, `body`, `extendInstructions?` | `'Rule'` |
| 2 Declaration | `Declaration` | `name: string \| Interp`, `value`, `merge`, `important` | `'Declaration'` |
| 3 Comment | `Comment` | `text` | `'Comment'` |
| 4 SelectorList | `SelectorList` | `selectors: Complex[]` | `'SelectorList'` |
| 5 Complex | `Complex` | selector/combinator `value` with no leading-combinator side field **+ methods** | `'Complex'` |
| 6 Compound | `Compound` | `simples` **+ methods** | `'Compound'` |
| 7 Simple | `Simple` | `text: string \| null`, `interp` | `'Simple'` |
| 8 Word | `Word` | `text`, `tag?: LiteralTag` | `'Word'` |
| 9 Dimension | `Dimension` | `value: number`, `unit: string` | `'Dimension'` ⚠ |
| 10 SpacedValue | `SpacedValue` | `parts: ValueNode[]` | `'SpacedValue'` |
| 11 VarRef | `VarRef` | `name` | `'VarRef'` |
| 12 MixinDef | `MixinDef` | `name`, `params`, `body`, `guard?` | `'MixinDef'` |
| 13 MixinCall | `MixinCall` | `name`, `args`, `path`, `important` | `'MixinCall'` |
| 14 VarDeclaration | `VarDeclaration` | `name`, `value` | `'VarDeclaration'` |
| 15 Concat | `Concat` | `parts: ValueNode[]` | **`'Sequence'`** (rename §1.4) |
| 16 Operation | `Operation` | `operator`, `left`, `right` | `'Operation'` |
| 17 FunctionCall | `FunctionCall` | `name`, `args`, `modern` | `'FunctionCall'` |
| 18 Paren | `Paren` | `inner` | `'Paren'` |
| 19 AtRuleBlock | `AtRuleBlock` | `name`, `prelude`, `body` | `'AtRuleBlock'` |
| 20 AtRuleStatement | `AtRuleStatement` | `name`, `prelude` | `'AtRuleStatement'` |
| 21 Interp | `Interp` | `parts: InterpPart[]` | `'Interp'` |
| 22 VarIndirect | `VarIndirect` | `nameRef` | `'VarIndirect'` |
| 23 DetachedRuleset | `DetachedRuleset` | `body`, `defFrame` (mutable) | `'DetachedRuleset'` |
| 24 MapAccessor | `MapAccessor` | `base`, `key`, `keyIsProp` | `'MapAccessor'` |
| 25 DetachedCall | `DetachedCall` | `varName` | `'DetachedCall'` |
| 26 RawInline | `RawInline` | `text` | `'RawInline'` |

Two non-node interfaces travel with these and need no discriminant change:
`ComplexSegment` (`comb`, `compound`), `ExtendInstruction` (`target`, `partial`),
`Param`, `PathSeg`, `InterpPart` (already a bare `{lit}|{ref,unquote}` union).

### A.2 Value domain — `interface` (`value-eval.ts`)

7 result types. All plain-data `interface` with `readonly kind: '<lower>'` + a
computed `bytes: string`.

| Current `kind` | Interface | Key fields | Target `type` |
|---|---|---|---|
| `'dimension'` | `Dimension` | `number`, `unit`, `bytes` | `'Dimension'` ⚠ |
| `'color'` | `Color` | `rgb`, `alpha`, `hsl?`, `format`, `node?`, …, `bytes` | `'Color'` |
| `'quoted'` | `Quoted` | `value`, `quote`, `escaped`, `bytes` | `'Quoted'` |
| `'keyword'` | `Keyword` | `text`, `bytes` | `'Keyword'` |
| `'list'` | `List` | `items`, `sep`, `bytes` | `'List'` |
| `'bool'` | `Bool` | `value`, `bytes` | `'Bool'` |
| `'nil'` | `Nil` | `bytes` | `'Nil'` |

`ValueObj = Dimension | Color | … | Nil`. `Value = ValueObj | string` (a bare
un-materialized literal is just its bytes — unchanged by this migration).

### A.3 Collision analysis

Under a **single `type` field**, all 27 structural + 7 value type-strings are
distinct **except one**:

- **`Dimension`** appears in BOTH corpuses. Everything else is disjoint: the
  value domain has no `Color`/`Quoted`/`Keyword`/`List`/`Bool`/`Nil` structural
  peer (the AST represents an authored color/string/keyword as a `Word` leaf
  tagged via `LiteralTag`, never a value node), and the structural domain has no
  `Operation`/`FunctionCall`/`Paren` value peer (those are AST-only; their
  *results* are `ValueObj`s).

**Resolution — the collision is NOT a true ambiguity, because the two
`Dimension`s live in two disjoint union types that are never merged:**

- AST `Dimension` ∈ `ValueNode` / `Node` (the union that says *how to compute* —
  a literal `10px` leaf; fields `value`/`unit`).
- Value `Dimension` ∈ `ValueObj` / `Value` (the union of eval *results*; fields
  `number`/`unit`/`bytes`).

No function parameter or field is ever typed `Node | ValueObj`, so TypeScript
never has to discriminate `type:'Dimension'` across the boundary — exactly as
today it never has to discriminate `Kind.Dimension` (9) from `'dimension'`
(they're separate namespaces). The `type` migration preserves that separation.

**Guardrail (document in both files):** the two `Dimension`s share a name but
have divergent shapes (`value` vs `number` + `bytes`). Keep the module boundary
that already forbids the value `Dimension` from being re-exported through
`ast/index.ts` (it is `type`-only-exported from `value-eval.js` today; see the
existing comment). The current `ast/index.ts:14-17` comment reads "it collides
with the AST `Dimension` node (`nodes.ts`)" — after the rename, update it to say
the value `type:'Dimension'` result collides with the AST `type:'Dimension'`
node; the module-qualification rationale is unchanged. Do **not** introduce a
`Node | ValueObj` union anywhere; if a future call site needs one, disambiguate
on a structural field (`'bytes' in v`), never on `type`.

---

## B. Target model

### B.1 The `Node` union (`node.ts` replaces the enum + base class)

```ts
// node.ts — no enum, no abstract class. Just the union + shared vocab.
export type NodeType =
  | 'Stylesheet' | 'Rule' | 'Declaration' | 'Comment' | 'SelectorList'
  | 'Complex' | 'Compound' | 'Simple' | 'Word' | 'Dimension'
  | 'SpacedValue' | 'VarRef' | 'MixinDef' | 'MixinCall' | 'VarDeclaration'
  | 'Sequence' | 'Operation' | 'FunctionCall' | 'Paren'
  | 'AtRuleBlock' | 'AtRuleStatement' | 'Interp' | 'VarIndirect'
  | 'DetachedRuleset' | 'MapAccessor' | 'DetachedCall' | 'RawInline';

export type Combinator = ' ' | '>' | '+' | '~';
export function renderCombinator(comb: Combinator): string {
  return comb === ' ' ? ' ' : ` ${comb} `;
}

// `Node` = the exported NAME, now a discriminated union of the plain-data members.
export type Node =
  | Stylesheet | Rule | Declaration | Comment | SelectorList | Complex | Compound
  | Simple | Word | Dimension | SpacedValue | VarRef | MixinDef | MixinCall
  | VarDeclaration | Sequence | Operation | FunctionCall | Paren
  | AtRuleBlock | AtRuleStatement | Interp | VarIndirect | DetachedRuleset
  | MapAccessor | DetachedCall | RawInline;
```

(`Node` may be assembled by re-exporting the `Statement`/`ValueNode`/selector
sub-unions already defined in `nodes.ts` — one canonical union, no new list to
drift.)

### B.2 Representative before/after pairs (verbatim)

**Dimension (structural leaf)**

```ts
// BEFORE (nodes.ts)
export class Dimension extends Node {
  readonly kind = Kind.Dimension as const;
  constructor(readonly value: number, readonly unit: string = '') { super(); }
}
export const dim = (value: number, unit = ''): Dimension => new Dimension(value, unit);

// AFTER
export interface Dimension {
  readonly type: 'Dimension';
  readonly value: number;
  readonly unit: string;
}
export const dim = (value: number, unit = ''): Dimension => ({ type: 'Dimension', value, unit });
```

**Sequence (was `Concat`) — §1.4 rename folded in**

```ts
// BEFORE
export class Concat extends Node {
  readonly kind = Kind.Concat as const;
  constructor(readonly parts: ValueNode[]) { super(); }
}
export const concat = (parts: ValueNode[]): Concat => new Concat(parts);

// AFTER
export interface Sequence {
  readonly type: 'Sequence';
  readonly parts: ValueNode[];
}
export const sequence = (parts: ValueNode[]): Sequence => ({ type: 'Sequence', parts });
// (keep `concat` as a deprecated re-export alias for one rebase cycle if callers straddle the in-flight fns rename.)
```

**Compound — the one member with methods (design wrinkle, see §D)**

```ts
// BEFORE — cached getters + private memo fields on the class
export class Compound extends Node {
  readonly kind = Kind.Compound as const;
  private _canon: string | undefined;
  constructor(readonly simples: Simple[]) { super(); }
  canonical(): string { /* memoised join */ }
  get hasInterp(): boolean { /* memoised */ }
  get hasAmpersand(): boolean { /* … */ }
}

// AFTER — plain data + free functions; memo is an optional mutable field
export interface Compound {
  readonly type: 'Compound';
  readonly simples: Simple[];
  _canon?: string;      // serializer-owned memo cache (mutable, non-enumerable intent)
  _hasInterp?: boolean;
}
export const compoundCanonical = (c: Compound): string =>
  (c._canon ??= c.simples.reduce((s, sim) => s + (sim.text ?? ''), ''));
export const compoundHasInterp = (c: Compound): boolean =>
  (c._hasInterp ??= c.simples.some((s) => s.interp !== null));
export const compoundHasAmpersand = (c: Compound): boolean =>
  c.simples.some((s) => s.text !== null && s.text.includes('&'));
```

**Value Dimension (result) — re-keyed to PascalCase `type`**

```ts
// BEFORE (value-eval.ts)
export interface Dimension {
  readonly kind: 'dimension';
  readonly number: number;
  readonly unit: string;
  readonly bytes: string;
}

// AFTER
export interface Dimension {
  readonly type: 'Dimension';
  readonly number: number;
  readonly unit: string;
  readonly bytes: string;
}
```

The value factories change identically, e.g.
`{ kind: 'dimension', number, unit, bytes }` → `{ type: 'Dimension', number, unit, bytes }`,
and every reader switch `case 'dimension':` → `case 'Dimension':`.

### B.3 `frame.stmts` → `frame.statements` (§1.3)

`serialize.ts` has a `Frame` interface field `stmts?: Statement[] | null` read at
~11 sites and written at ~9 (`stmts: root.children`, `stmts: rule.body`, …).
Rename the field to `statements` (leanest readable name — not `stmts`, not a
long identifier). Mechanical, local to `serialize.ts`.

---

## C. less-compat conversion cost — proving the `type` choice

### C.1 What the bridge reads TODAY

`packages/jess-plugin-less-compat/` is written against **PascalCase `.type`
strings** end to end:

- `transform/adapter.ts` derives the Less type via
  `mapJessTypeToLessType(node.type)` — it reads a **`.type` string off the node**.
- `transform/from-less.ts` dispatches reverse conversion on
  `lessNode.type === 'Dimension'`, `=== 'Color'`, `=== 'Quoted'`,
  `=== 'Declaration'`, `=== 'AtRule'`, … (7 string-equality sites).
- `transform/type-map.ts` is a **bidirectional string↔string table**:
  `mapJessTypeToLessType` (27 entries) + `mapLessTypeToJessType` (27 entries),
  most of them **identity** (`Dimension→Dimension`, `Color→Color`,
  `Operation→Operation`, `Comment→Comment`, `Paren→Paren`, `Condition→Condition`,
  `Extend→Extend`, `Keyword→Keyword`, `Declaration→Declaration`, …).

The bridge's entire currency is the PascalCase `type` string.

### C.2 What a numeric-`Kind` / lowercase-`kind` node would force

When the cutover repoints the bridge onto the `ast/` (tree2) corpus, a tree2 node
in its **current** shape cannot feed this machinery at all:

- `node.type` **does not exist** — the node carries `kind = Kind.Dimension` (the
  integer `9`). `mapJessTypeToLessType(node.type)` gets `undefined`. You must add
  a **new 27-entry numeric→PascalCase table** (`Kind → 'Dimension'`) just to
  recover the string the existing map already speaks.
- The value domain carries `kind: 'dimension'` (lowercase). Feeding it Less
  requires a **second 7-entry lowercase→PascalCase table**
  (`'dimension' → 'Dimension'`).
- `from-less.ts`'s 7 `=== 'Dimension'`-style dispatch sites would each need a
  numeric or lowercase twin to build tree2 nodes on the reverse path.

Net **new** conversion surface forced by keeping the current discriminants:
**~34 mapping entries** (27 numeric + 7 lowercase) **+ ~7 reverse dispatch
twins** — pure translation glue whose only job is to reach the PascalCase names
the bridge already uses.

### C.3 What `type: 'Dimension'` eliminates (and what it does NOT)

**Important correction — the bridge consumes the LEGACY jess tree today, not
tree2.** `jess-plugin-less-compat/src` has **zero** tree2 (`ast/`) imports:
`from-less.ts` imports `Any, Collection, Color, ColorFormat, Declaration,
Dimension, Node, Quoted, Rules` from `@jesscss/core` — every one a **legacy
`../tree` class**. `type-map.ts`'s keys are **legacy-jess** type names
(`Ruleset`, `Call`, `Mixin`, `Reference`, `Num`, `ComplexSelector`,
`CompoundSelector`, `BasicSelector`, `Expression`, …), which do **NOT** match the
`.type` strings tree2 will emit (`Rule`, `FunctionCall`/`MixinCall`, `MixinDef`,
`VarRef`, `Complex`, `Compound`, `Simple`, `SpacedValue`, …).

So this migration, **on its own, does not touch the bridge** — the bridge stays
on legacy until a separate cutover repoints it onto tree2. The `type` decision is
justified by what it does to that **future repoint**, not by an immediate edit.

What `type:'Dimension'` PascalCase buys the eventual repoint:

- **No numeric→string table, ever.** A tree2 node in its current shape carries
  `kind = Kind.Dimension` (integer `9`) — repointing would force a fresh 27-entry
  `Kind → 'Dimension'` table (§C.2) just to produce a string. PascalCase `.type`
  makes `node.type` a string the map machinery can consume directly.
- **No lowercase→PascalCase table, ever.** The value domain's `kind:'dimension'`
  would force a second 7-entry `'dimension' → 'Dimension'` table; PascalCase
  `type` removes it.
- **`from-less.ts`'s 7 reverse-dispatch `=== 'Dimension'` sites** compare against
  the same string namespace tree2 builds into — no numeric/lowercase twins.

What it does **NOT** buy (correcting the earlier draft's "existing map consumes
tree2 directly / stays as-is" claim):

- Repointing the bridge onto tree2 still requires **~15 key rekeys in
  `type-map.ts`** because tree2's structural names differ from legacy jess's:
  `Ruleset→Rule`, `Call→FunctionCall`+`MixinCall` (a split), `Mixin→MixinDef`,
  `Reference→VarRef`, `ComplexSelector→Complex`, `CompoundSelector→Compound`,
  `BasicSelector→Simple`, `Expression/Value→SpacedValue`/`List`,
  `AtRule→AtRuleBlock`+`AtRuleStatement` (a split), `Num→Dimension`, plus the
  no-longer-a-node cases (`Extend`→`ExtendInstruction`, `Condition`→`GuardNode`,
  `Color`/`Quoted`/`Keyword`→value-domain or `Word` leaf). These rekeys are
  **string→string** and unavoidable in ANY discriminant design — the two node
  models name things differently.

**Conclusion (revised):** the `type`-PascalCase choice does **not** make the
bridge consume tree2 for free — a future repoint still needs ~15 legacy→tree2
string rekeys in `type-map.ts`. What it **does** guarantee is that **no
numeric→string and no lowercase→PascalCase translation layer is ever needed**
(~34 entries + ~7 reverse twins avoided). That is the load-bearing, still-correct
justification for decision §1.2: keep PascalCase-over-numeric because it collapses
the discriminant-shape adapter to zero, leaving only the irreducible name-rename
map.

---

## D. Load-bearing-blocker check (adversarial, on the plan itself)

Full re-grep across `packages/core/src/ast/` (non-test). **The earlier draft
under-counted the surface ~5× by omitting the `parse-host/` subtree, which
imports the AST as `import * as t2 from '../index.js'` and uses `instanceof t2.X`
/ `new t2.X(` heavily.** Corrected surface:

| Pattern | In-scope count | Sites | Blocker? |
|---|---|---|---|
| `instanceof t2.X` (tree2 nodes) | 23 | `selector.ts` (7), `mixins-def.ts` (5), `extend.ts` (3), `ruleset.ts` (2), `comments.ts` (2), `host-context.ts:193`, `interp.ts:83`, `value-expr.ts:61`, `dispatch-host.ts:141` | **No** — `.type === 'X'`, or the new `isNode()` value predicate (see below). |
| `instanceof Word` (bare) | 2 | `mixin-dispatch.ts:139,145` | **No** — `v.type === 'Word'`. |
| `instanceof Node` (bare) | 1 | `nodes.ts:577` (`mixinCall`) | **No** — the new `isNode()` predicate. |
| `new t2.X(` / `new <Class>(` outside `nodes.ts` | ~23 | `selector.ts` (8× `new t2.Compound`), `custom-props.ts` (5× `new t2.Declaration`), `mixin-dispatch.ts` (3× `new Word`), `extend.ts` (2× `new t2.Compound`), `comments.ts:207`, `declaration-static.ts:30`, `selector-interp.ts:32`, `serialize.ts:1108` (`new Word`), + `at-rule.ts:58,61` factory bodies | **No** — swap for the `word()`/`complex()`/`decl()`/… factories (now plain-object builders). |
| structural `.kind` / `Kind.` reads in `parse-host/` | 8 | `import.ts:407` (2: `Kind.VarDeclaration`, `Kind.MixinDef`), `custom-props.ts:66,81,101` (6: `t2.Kind.Word`/`Interp`/`VarRef`/`Paren`/`FunctionCall`) | **No** — `.type === 'X'`. |
| `Kind.` refs (core `ast/`) | 133 | `serialize.ts` 98, `nodes.ts` 26, `extend.ts` 4, `at-rule.ts` 2, `mixin-dispatch.ts` 1, `literal-tag.ts` 1, `custom-props.ts` 1 | **No** — mechanical `Kind.X` → `'X'`. |
| Position `push({ …, kind: X.kind })` in `serialize.ts` | ~15 sites + interface | :671, :771, :1035, :1108, :1123, :1129, :1175, :1188, :1265, :1487, :1488, :1495, :1538, :1562, :1662, + `interface Position { kind: Kind }` (:85) | **No** — `type: X.type`; field `kind: Kind` → `type: NodeType`. |
| lowercase `kind:'…'` value reads | 46 (core+fns) | value-operate, guard, native/*, serialize-value, factories, fns, `parse-host/value-eval.ts` (transitional) | **No** — mechanical re-key (T3). |

**`Node` becomes a TYPE-ONLY binding — the real mechanical hazard.** When the
classes become interfaces, `t2.Node` **ceases to exist as a runtime value**, so
every `x instanceof t2.Node` is a compile error, not a rename. Five sites use
`instanceof t2.Node`/`Node` as a *value predicate* and must be rewritten against a
**hand-authored `isNode(x): x is Node`** exported from the AST module:

- `host-context.ts:193` — `isStatement(x) = x instanceof t2.Node`
- `value-expr.ts:61` — `isValueNode(x) = x instanceof t2.Node`
- `interp.ts:83` — inline `c instanceof t2.Node`
- `mixins-def.ts:47,111,149,166,167` — incl. the negated `!(x instanceof t2.Node)`
- `nodes.ts:577` — `a instanceof Node`

`isNode` must be defined as: `typeof x === 'object' && x !== null && typeof
(x as {type?: unknown}).type === 'string' && AST_NODE_TYPES.has(x.type)` where
`AST_NODE_TYPES` is the frozen set of the 27 structural `type` strings. A **naive
`'type' in x` is NOT sound** — value-domain `ValueObj`s now also carry
`type` (`'Dimension'`/`'Color'`/…), so a bare property test would misclassify a
value result as an AST node (the `Dimension` collision surfacing at the predicate
level). Membership in the AST `type` set neutralizes every collision except the
shared `Dimension` string, which is in turn neutralized by the lane invariant
below.

**Per-site marker/guard soundness audit (item 2).** The markers that share these
flows do **not** use `instanceof`, and none carries a `type` field, so they stay
sound with no change:

- `GuardNode` (`guard.ts:26-33`) — discriminated by **`g`** (`'cmp'`/`'and'`/…),
  no `type`. `isGuardNode` (`mixins-def.ts:47`) currently `… && !(x instanceof
  t2.Node) && 'g' in x`. Swap to `… && !isNode(x) && 'g' in x`. **Sound:** `g` is
  unique to `GuardNode`; even a value `ValueObj` (which now has `type`) lacks
  `g`, and `isNode` (AST-type-set) already excludes it. Belt-and-suspenders holds.
- `RestMarker` (`__rest`), `NamedMarker` (`__named`), `RawArg` (`__rawArg`),
  `Leaf` (`_tag:'leaf'`) — branded by `__*`/`_tag` fields, **not** `instanceof`,
  **no `type` field**. Their predicates (`isRestMarker`/`isNamedMarker`/
  `isRawArg`/`isLeaf`) are **untouched** by the migration and stay sound.
- **Lane invariant (why the `Dimension` predicate collision is harmless):** these
  parse-host predicates run in the **AST-build lane**, where `built`/`c`/`vals[0]`
  are AST `ValueNode`s constructed by the builders — a value-domain `ValueObj`
  (an eval *result*) never enters this lane (it lives behind the
  `ValueEvaluator` seam). So `isNode` keying on the AST `type` set is provably
  sound here, and the shared `Dimension` string never causes a misclassification.
  Enforce §A.3's "never a `Node | ValueObj` union" as the standing guarantee.

**Out of scope — do NOT touch in this migration:**

- `parse-host/value-eval.ts:116` `instanceof Dimension` and `:87` `new
  Dimension(...)` — the `Dimension` there is imported from **`../../tree/index.js`
  (legacy)**, the transitional adapter reaching legacy math, unrelated to the
  tree2 discriminant. Excluded from T5.
- The bridge (`jess-plugin-less-compat/`) — consumes legacy tree, zero tree2
  imports (§C.3).

**Prototype identity:** the base `Node` is `abstract` with a single abstract
`kind` and **no shared methods** — nothing relies on `Object.getPrototypeOf` or a
shared method table across node kinds. **No prototype-identity blocker.**

**Factories stay:** `word()`/`dim()`/`rule()`/`complex()`/`decl()`/… (`nodes.ts`,
`at-rule.ts`) remain free functions returning **object literals** — the
sanctioned construction path onto which all ~23 `new t2.X(` call sites converge.
Confirmed clear.

**The one real design cost (NOT a blocker):** `Compound` and `Complex` are the
only members carrying **methods + private memo fields** (`canonical()`,
`get hasInterp`, `get hasAmpersand`, `_canon`, `_hasInterp`, `_hasAmp`). Plain
objects can't hold methods. Convert each to a **free function** with the memo
moved to an **optional mutable field** on the object (see §B.2). Callers of
`.canonical()`/`.hasInterp`/`.hasAmpersand` (in `serialize.ts`, `selector.ts`,
`extend.ts`) become `compoundCanonical(c)` etc. `Word.tag`,
`DetachedRuleset.defFrame` (already mutable), and the selector memo fields are
plain fields — fine. ~2 node files + their call sites, gated byte-identical.
**Verdict: clear to go plain-data — no true blocker.**

---

## E. Switch-on-string perf note (honest)

`serialize.ts` dispatches the hot emit path through 5 `switch (node.kind)` blocks
(value emit at :308/:337, statement emit at :726/:821/:1282) with numeric `case
Kind.X`. V8 lowers a `switch` over a dense small-integer set to a **jump table**;
a `switch` over string literals lowers to a **hashed/branchy compare**. In
principle the string form costs a few extra ns per node on the emit loop.

**But the numeric tag was never measured**, and the owner bar is *only measured
perf justifies divergence*. The honest position:

- **Ship the `type` string.** It is the choice that unifies all three corpuses
  and guarantees no numeric→string / lowercase→PascalCase adapter layer is ever
  needed at the future bridge repoint (§C.3).
- **Then measure**, per the repo's controlled-measurement rule: same-worktree
  git-toggle (numeric ↔ string), warmup, N-median, **byte-identical output**, on
  the sanctioned `benchmark.less` fixture (not a synthetic micro-bench, not
  bootstrap). Serialize is ~20% of CPU per the perf memo, so a real regression
  would show there.
- **Revert to numeric ONLY on a demonstrated regression.** If one appears, the
  cheap mitigation is a parse-stamped numeric `tag` field carried *alongside*
  `type` used **only** by the 5 hot switches (leave `type` as the corpus-wide
  discriminant and bridge currency) — but do **not** pre-build this; it
  reintroduces the dual-discriminant debt this spec removes.

Recommendation: `type` string ships; numeric is a measured fallback, not a
default.

---

## F. Migration plan (ordered, mechanical, rebase-friendly)

Two edits are in flight against `nodes.ts`: **(a)** the literal-tag / parser
classification P0 (`demolish/literal-classification` — touches `Word.tag` /
`LiteralTag` and may add a kind), and **(b)** the fns landing / rename. The plan
sequences **behind both**. Transforms are keyed on **stable symbols** (class
name / `Kind` member / factory name) where a per-symbol rename genuinely
suffices — but **the `instanceof` / `new` / value-predicate / file-path surface
in §D is NOT auto-derivable from the enum**; those sites are listed explicitly
per transform below and must be re-grepped at apply time (the §D greps are the
authoritative checklist).

**T0 — rebase gate + fresh grep.** Apply only after (a) and (b) merge to
`origin/dev`; `git fetch && checkout -B <branch> origin/dev`. Re-run the §D greps
against the post-merge tree to regenerate the exact site list (an added/renamed
kind from (a) or a factory rename from (b) shows up here). The `Kind`-member and
factory renames flow from the enum/export list; the `instanceof t2.X` / `new
t2.X(` / `.kind` / Position-push / `isNode` sites do **not** — they are the
explicit lists in T4/T5.

**T1 — `node.ts`: kill the enum + base class (atomic with T4).** Replace
`enum Kind` and `abstract class Node` with `type NodeType` (the 27 PascalCase
literals) and `type Node` (the union), keep `Combinator`/`renderCombinator`.

**T2 — `nodes.ts` + `at-rule.ts`: classes → plain-data interfaces.** For each
member: `class X extends Node { readonly kind = Kind.X … }` →
`interface X { readonly type: 'X'; … }`; body fields become interface fields;
each factory (`word`/`dim`/… ) returns an object literal `{ type: 'X', … }`.
Fold the two renames here: `Concat`→`Sequence` (+ `concat`→`sequence`, keep a
deprecated `concat` alias one cycle), and lift `Compound`/`Complex`
methods+getters to free functions with optional memo fields (§B.2). Update
`ValueNode`/`Statement`/selector sub-unions to the interface members.

**T2b — author `isNode` + `AST_NODE_TYPES` (prerequisite for T4/T5).** In the AST
module, export `AST_NODE_TYPES` (frozen `Set` of the 27 structural `type`
strings) and `isNode(x): x is Node` (§D). This is the single value predicate that
replaces every `instanceof t2.Node`/`Node`. Land it in the T1+T4 atomic commit so
the type-only `Node` binding never leaves a dangling runtime `instanceof`.

**T3 — value domain: lowercase `kind` → PascalCase `type`.** In `value-eval.ts`,
`value-factory.ts`, `serialize-value.ts`: re-key the 7 interfaces
(`kind:'dimension'`→`type:'Dimension'`, …), every `make*` literal, and every
`serializeValue`/`value-operate` reader `case '<lower>':` → `case '<Pascal>':`.
Update the `ast/index.ts:14-17` boundary comment per §A.3 (keep the value
`Dimension` `type`-only-exported; the current text says "the AST `Dimension`
node (`nodes.ts`)").

**T4 — `serialize.ts` (atomic with T1 + T2b).** `case Kind.X` → `case 'X'` across
all 5 switches (:308,:337,:726,:821,:1282); `interface Position { kind: Kind }`
→ `{ type: NodeType }` (:85); **all ~15 `positions.push({ …, kind: X.kind })`
sites** → `type: X.type` (:671,:771,:1035,:1123,:1129,:1175,:1188,:1265,:1487,
:1488,:1495,:1538,:1562,:1662, and :1108 `kind: Kind.Word` → `type: 'Word'`);
the inline value-object builders (`{kind:'dimension',…}`/`{kind:'keyword',…}`/
`{kind:'list',…}` at ~:293,:310,:510) → `type:'…'`; `new Word(combined)` (:1108)
→ `word(combined)`. **Rename `frame.stmts` → `frame.statements`** (§1.3) — the
~11 reads + ~9 writes local to this file. T1+T2b+T4 land as one commit (union
type + `isNode` + switch are co-dependent for the build to pass).

**T5 — consumers re-key (EXPLICIT site list — not auto-derived).**

- *Structural `instanceof t2.X` → `.type === 'X'`* (23 sites): `selector.ts`
  (:52,:53,:54,:60,:61,:62,:87), `mixins-def.ts` (:111,:166,:167 — value-node
  `instanceof` → `.type`; :47 → `!isNode(x)`; :149 → `isNode(built)`),
  `extend.ts` (:57,:58,:59), `ruleset.ts` (:23,:24), `comments.ts` (:113,:194),
  `host-context.ts:193` (`isStatement` → `isNode`), `interp.ts:83`
  (→ `isNode(c)`), `value-expr.ts:61` (`isValueNode` → `isNode`),
  `dispatch-host.ts:141` (`instanceof t2.Stylesheet` → `.type === 'Stylesheet'`).
- *Bare `instanceof Word`/`Node`*: `mixin-dispatch.ts:139,145` → `v.type ===
  'Word'`; `nodes.ts:577` → `isNode(a)`.
- *`new t2.X(` → factory* (~23 sites): `selector.ts` (:54,:55,:62,:63,:90,:91,
  :139 `new t2.Compound` → `t2.compound?`/object builder), `custom-props.ts`
  (:119,:122,:124,:139,:161 `new t2.Declaration` → `t2.decl`-style),
  `mixin-dispatch.ts` (:109,:126,:140 `new Word` → `word`), `extend.ts`
  (:59,:60), `comments.ts:207` (`new t2.Rule`), `declaration-static.ts:30`,
  `selector-interp.ts:32`, `serialize.ts:1108` (in T4). `at-rule.ts:58,61` factory
  bodies → object literals (T2).
- *Structural `.kind`/`Kind.` reads in `parse-host/`* (8): `import.ts:407`
  (`Kind.VarDeclaration`/`Kind.MixinDef` → `'VarDeclaration'`/`'MixinDef'`),
  `custom-props.ts` (:66 `t2.Kind.Word`, :81 `t2.Kind.Interp`, :101
  `t2.Kind.Word|VarRef|Paren|FunctionCall`) → `.type === '…'`.
- *Value-domain lowercase `kind` reads*: `value-operate.ts`, `guard.ts`,
  `native-evaluator.ts`, `native/*` (6 files), `literal-tag.ts`,
  `parse-host/value-eval.ts` (its `left.kind === 'keyword'`/`'dimension'` value
  reads — the ValueObj lane), and `packages/fns/src`: lowercase → PascalCase.
- *Tests*: `instanceof MixinDef`/`instanceof Word`/`instanceof Dimension` in
  `__tests__/` → `.type === '…'`.

**Explicitly OUT of scope for T5:** `parse-host/value-eval.ts:116` `instanceof
Dimension` and `:87` `new Dimension(...)` — that `Dimension` is the **legacy**
node (`import … from '../../tree/index.js'`), the transitional adapter, not a
tree2 discriminant. Do not touch.

**T6 — less-compat: no change in THIS migration; a later repoint needs ~15
rekeys.** The bridge consumes the **legacy** tree and has **zero** tree2 imports
(§C.3), so the tree2 discriminant change does not reach it now. When a separate
cutover repoints the bridge onto tree2, `type-map.ts` needs **~15 legacy→tree2
string rekeys** (`Ruleset→Rule`, `Call→FunctionCall`+`MixinCall`,
`Mixin→MixinDef`, `Reference→VarRef`, `ComplexSelector→Complex`,
`CompoundSelector→Compound`, `BasicSelector→Simple`, `Expression/Value→
SpacedValue`/`List`, `AtRule→AtRuleBlock`+`AtRuleStatement`, `Num→Dimension`, …) —
**but never a numeric→string or lowercase→PascalCase table**, which is the whole
payoff of the PascalCase-`type` decision (§1.2). Record this as a note on the
future-repoint task; nothing to edit here.

**Rebase-friendliness recap:** the `Kind`-member and factory **renames** flow
from the post-merge enum/export lists (T0). The `instanceof`/`new`/`.kind`/
Position-push/`isNode` **site lists** do NOT self-derive — they are the explicit
T4/T5 lists above, re-grepped at T0 against the merged tree (§D greps are the
checklist). The only hand-authored, co-dependent unit is T1+T2b+T4 (union +
`isNode` + serialize switch), small and self-contained.

**Gates:** each transform is byte-identity-gated (native ≡ adapter serialize
output on `benchmark.less` + the tree2 census/byte-identity suites in
`ast/__tests__/` and `tree2-frontend/__tests__/`). No `as any` (repo hard rule);
the five `instanceof t2.Node`/`Node` value checks become the typed `isNode`
predicate (AST-`type`-set membership, §D), and per-site marker soundness is proven
in §D (GuardNode keys on `g`, markers on `__*`/`_tag`, none carry `type`). Perf
measurement (§E) runs after the T1+T2b+T4 commit lands green.
