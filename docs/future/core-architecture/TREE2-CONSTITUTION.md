# tree2 Constitution — the hard bar for the demolition + rebuild

Owner mandate (2026-07-16): the engine is "50% horseshit despite speed gains." Get it
in control: massive deletion of shit code, refactor to quality, kill garbage names
(`runFunctionalParseT2`), kill arbitrary "bridges". This document is the binding
constraint on **every** agent touching the engine. Byte-identity is a FLOOR, not the bar.

The root disease, named precisely: the engine was built as a **second pass over the
legacy AST** (`bridge.ts`: parse → legacy tree → *rebuild* as tree2). Because the bridge
reconstructs structure from legacy nodes' raw strings, it re-derives structure from
BYTES — and the parser build-host `actions/` were told to "mirror the bridge," so they
copied that byte-re-derivation into shipping code. Every string-scan, every `@{}` regex,
every `@@name`/`=== value` reconstruction is a symptom of this one architectural sin.

---

## P0 — The parser is the SOLE source of structure. Core NEVER re-derives structure from bytes. (KEYSTONE)

The parser (`css-parser`/`less-parser`) already tokenizes and structures the source ONCE.
Core consumes parser nodes. Core does **not** slice raw source and pattern-match it to
rebuild something the parser already produced.

**Proof this is not aspirational:** `less-parser` emits a structured, recursive
`Interpolated { source, replacements }` (`productions/values.ts` `processStringInterpolation`)
that handles nested braces, full expressions inside the interpolation, and both `@{}`
and `${}`. tree2 threw that away and re-scanned raw spans with
`/@\{\s*([^}]+?)\s*\}/g` — strictly weaker, buggy on nesting, `@`-only. That regex,
in all its copies, is DELETED; the build-host consumes the parser's `Interpolated` node.

**Banned in shipping core, no exceptions:**
- Any `@{}` / `${}` / `@@name` / `@name` **regex or string-split** to find/rebuild structure.
- `src.slice(span)` followed by pattern-matching to reconstruct a node the parser built.
- `` `@@${x}` === value `` / `` `@${x}` === value `` and any decision routed through a
  reconstructed source string when the built node already carries the answer in a field.
- Re-emitting Less source text (`` literal(`@${name}`) ``) as a "fallback" for a resolution
  miss unless that is the *provably intended byte-faithful output*, documented as such.
- Rebuilding `calc(...)` operands by string-unwrapping.

If you find yourself reading `ctx.src` to decide a node's shape, STOP — the parser already
decided it. Consume the structured child.

**The target node model (owner, verbatim intent):** a value that CAN contain interpolation —
`Quoted`, an ident/selector fragment, a custom-property value — is, at PARSE TIME, ONE of two
things: (a) a plain string (no interpolation), or (b) a **series of child nodes** where the
interpolation is a real child node carrying an EXPRESSION. It is never a string that a later
pass re-scans. The parser decides which, because **the interpolation sigils are
language-defined** (`@{}` in Less, `${}`/`#{}` and friends elsewhere) and **both `.jess` and
`.scss` allow FULL EXPRESSIONS inside interpolation** — a downstream regex cannot and will not
parse those. So: `Quoted` holds `string | Node[]`; the `Node[]` form is produced by the parser
with interpolation as a structured child; core consumes that union and NEVER re-tokenizes the
string form looking for sigils.

## P1 — Delete the bridge.

The double-build (`tree2-frontend/bridge.ts`) is the source of the disease. The build-host
consumes the parser output DIRECTLY. The bridge may survive ONLY as a quarantined test-time
reference (clearly isolated, never imported by shipping code, never "mirrored"). Its
byte-re-derivation is not a pattern to copy — it is the thing we are deleting.

## P2 — No verbatim ports. The legacy `tree/` engine is what we are DELETING.

Legacy `tree/` is ~68k lines of the smell we are replacing. It is a byte-identity reference
for OUTPUT, never a source to copy IMPLEMENTATION from. Every `// mirrors the bridge` /
`// ported from legacy` / `// port of Operation.*` marker is a debt to erase by making it
untrue. Re-derive the lean tree2 form from the parser's structure; do not lift.

## P3 — Real names. Names describe intent, not implementation history.

- `runFunctionalParseT2`, `tree2`, `tree2-frontend`, `poc-*`, numeric family suffixes,
  `guard*` names on value ops (`nativeGuardCmp`), `*T2` suffixes — all go.
- Engine directory: `tree/` (new) replaces the legacy `tree/` (→ deleted, not preserved as
  ceremony). "frontend" is not a concept — the parser build-host is `parse-host/` or folded
  into the engine; actions CO-LOCATE with the node family they build.
- A name that requires a comment to justify it is the wrong name.

## P4 — DRY. One implementation of each concept.

Catalogued duplication to collapse to one: the `@{}` tokenizer (×4 + selector), `rgbUnclamped`
vs `colorRawRgb`, `renderCombinator` (×3), `calc` string-unwrap (×2), `declParts`/`isNode`/
`simpleText` (×2), `@name` var-miss fallback (×4 sites).

## P5 — Complexity is a GATE, reviewed BEFORE landing.

No O(N×M) solve, no re-scan/re-alloc per frame, no per-placement reconstruction ships. State
the cost as N grows at review time. (See `feedback-guard-performance-aggressively`.) The
packed representation must make dominant ops cheap BY CONSTRUCTION, not by a memoization
band-aid.

## P6 — Byte-identity is the floor; quality is the bar.

Tests-green proves the RESULT, nothing about the implementation. Every change is reviewed on
the 8 axes (correctness-beyond-bytes, smell, Less-anchoring, verbatim-port, DRY, naming,
packed-struct efficiency, structural-vs-string) — see the adversarial-review rubric.

---

## Process (governance)

Agents PROPOSE → a reviewer adversarially VETS (first question: "what does this cost as N
grows?" second: "what structure did the parser already give you that you're re-deriving?") →
I DECIDE the final shape. Editing agents run in isolated worktrees; collision-prone sweeps
(the rename/reorg) run atomically, sequenced AFTER the content demolition so we don't rename
files we're about to delete.
