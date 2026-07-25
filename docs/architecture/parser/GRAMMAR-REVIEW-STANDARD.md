# Grammar review standard

The standing brief for work on the eight grammar files. Attach it to the task;
do not reconstruct it.

| CST (`src/grammar.ts`) | consts | AST (`src/ast/grammar.ts`) | consts |
| --- | --- | --- | --- |
| `css-parser` | 131 | `css-parser` | 246 |
| `less-parser` | 222 | `less-parser` | 575 |
| `scss-parser` | 166 | `scss-parser` | 361 |
| `jess-parser` | 107 | `jess-parser` | 406 |

(Counts as of 2026-07-25 @ `bcb3107a1`; they drift, the method does not.)

These grammars are parseman's reference implementation. "Exemplary" has been
asked for repeatedly and has not stuck, because *make it good* is not checkable
and a passing test ends the job. This document replaces that instruction with
thirteen questions and a rule about how many things you ask them of.

---

## 1. The method — every `const`, no sampling

**The checklist is applied to every `const` in the file.** Not sampled, not "the
ones that look suspicious". In these files a rule *is* a `const` — the CST
grammars declare them inside the `rules()` closure, the AST grammars at module
scope — so "every const" is literally every rule, terminal, and helper.

The exhaustiveness *is* the method. The failure mode being fixed is an agent
reading linearly, pattern-matching locally, and stopping when the immediate task
looks done. "Review the grammar" gets skimmed. "Answer these thirteen questions
for every `const` in this file" cannot be.

Two things make this tractable rather than crushing:

- **Most consts pass in one line.** A bare terminal that uses the API correctly,
  is documented, and duplicates nothing gets a one-word verdict. Volume is not
  the same as effort. A 200-const file is mostly a fast scroll.
- **"Conforms" is a claim, not a default.** The `less-parser` pass found a
  byte-identical copy of a shared rule *whose own docstring named the local
  copy* — trivially visible the moment someone actually read that const, and
  invisible for however long nobody did. If you write "conforms" you are
  asserting you read it.

### Outcome vocabulary

One of exactly four per const, so reports are comparable across files and agents:

| outcome | means |
| --- | --- |
| **conforms** | read, nothing to do. One line. |
| **converted** | changed — cite the commit. |
| **blocked** | should change, can't yet — cite the *specific* reason (reducer stride, separator capture, AST movement, missing 0.34 export). |
| **deliberate exception** | should not change — cite the justification. |

**`blocked` and `deliberate exception` are the load-bearing ones.** A documented
non-collapse is worth as much as a collapse: it stops the next agent
re-proposing it. Two guard-operator spellings were correctly left alone because
they look identical and differ in whitespace framing — that fact is only useful
if it is written down against those consts.

---

## 2. The checklist

Every written rule must answer:

1. **Is this from CSS?** Does it need to be duplicated? Is it called a different
   name — and if so, why, and is that justified? This is a question about
   *duplication*, not about naming style. A production that restates a CSS
   construct the base grammar already defines should compose on it, not re-spell
   it. `less-parser` carried a byte-identical copy of a shared rule; the shared
   rule's docstring even named the local copy.

2. **Is it readable and well formatted?** In practice this splits into items 3
   and 4, which fail differently — see *the floor and the bar* below.

3. **Is this pretty?** A judgement call, and it stays one. The bar: *a screenshot
   of this code should be blown up to lecture-hall size for its elegance and
   formatting.* Per const, the test is whether the rule's shape **teaches what it
   does when projected on a wall**, or needs narration. Nesting readable as
   indentation, matching parens down the left edge, no twenty-combinator
   one-liners, consistent with its neighbours. This cannot be mechanised and
   should not pretend to be — say what you judged and why.

4. **Does it pass our rigid ESLint stylistic formatting?** Purely mechanical, a
   hard gate rather than an opinion. A max-strictness config covers all eight
   grammar files: `@stylistic/function-paren-newline` and
   `@stylistic/function-call-argument-newline` (expanded call form — one argument
   per line, closing paren aligned with its opener), `eslint-plugin-regexp`,
   JSDoc requirements, no multi-line `//` comments, blank line before comments,
   no literal non-ASCII in regexes, no factories or hoisted consts.

5. **Does it have a JSDoc block?**

6. **Is this the simplest representation in parseman combinators?**

7. **Does it duplicate parts of other rules in the grammar that could be
   reused?** — not just whole rules: shared sub-sequences, repeated bracket
   scans, the same terminal spelled twice.

8. **Does it use the API instead of hand-rolling it?** Real instances in
   `less-parser`: keyword regexes carrying a hand-written `(?![-\w])` boundary
   where `word()`/`keywords()` is the API (15 found in the first pass; the
   boundary appears 32 times across the two Less grammar files, so re-count);
   39 hand-rolled separated-list sites against 6 uses of `sepBy`; and the
   duplicate in item 1.

9. **Are its regexes correct?** Three defects found, each of which a reviewer
   can only catch by reading the pattern character by character:
   - `\uXXXX` escapes instead of the literal non-ASCII character — a reviewer
     cannot verify a range they cannot see.
   - the `u` flag alongside `i`, or non-ASCII case folding that is simply wrong.
   - ranges that stop at the BMP, which break astral characters.

10. **Does it consume its own separator?** `optional(literal(';'))` inside a
    declaration — 24 sites in `less-parser`. `;` *separates*; the list owns it.
    Pending an owner ruling, so today these are `blocked`, not `converted`.

11. **Is it gated?** A leading `not()` is the anti-pattern — 18 sites. So is
    `not(regex(...))` used as an end-of-value assertion: that is gating work
    done by hand where a first-set gate is the mechanism. Less carries roughly
    an order of magnitude more `not()` than the CSS grammar for the same surface
    (owner measurement: ~460 against 21); re-measure rather than quoting the
    figure.

12. **Is it reachable and covered?** One production was CST-only, dead, and had
    zero tests. Ask which entry rule reaches this const and which test exercises
    it. If neither answer exists, that is the finding.

13. **If changed, does the AST stay byte-identical?** The oracle answers this
    mechanically (§4). **A change that moves the tree is a failed change, not a
    judgement call.**

### The floor and the bar

**Lint (item 4) is the floor; prettiness (item 3) is the bar.** They fail
differently and must be reported separately: lint is pass/fail and automatable,
prettiness is a human call lint will never capture. A rule can be lint-clean and
still ugly — a correctly-formatted twenty-line `sequence` that should have been
three rules passes every mechanical check.

The mechanical items exist so the judgement items get attention. If a reviewer is
spending its effort on paren placement, the lint config is not doing its job;
that is a finding about the config, not about the const.

---

## 3. Hard constraints

These override anything the checklist might suggest.

**The macro constraint — parameterless combinator `const`s and plain reducers
only. No factories, no `[...spread]`, no hoisted `const`s — including plain
strings.** This is a *correctness* rule, not a style preference. When `compose()`
cannot statically resolve its argument, parseman falls back to the interpreter,
and **a macro-fallback build is not AST-equivalent to a macro-compiled build** —
it emits a different tree for the same input. Reproduced end to end in
[`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md`](./PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md)
§1: a single hoisted boundary string moved the CST aggregate, and inlining it
back moved the aggregate back byte-for-byte. So `check-macro-buildable` guards
correctness, not just speed, and a red run **invalidates any differential taken
on that build**. Literal duplication at each call site is the correct answer.

**No regex outside `regex()`.** Pattern text belongs in a `regex()` argument,
nowhere else.

**Never create a `productions.ts`.** Upgrade `productions/*.ts` in place.

**The gating diagnostic depends on what you feed it.** The parseman analysis
surface **can** analyse these grammars when given their `rules()` map, captured
*before* `compose()`. It is the fused compiled artifact that throws — and it now
throws with an actionable message rather than reporting empty. So "the diagnostic
cannot see our grammars" is wrong as a blanket statement; the input matters.
Feed it the pre-compose map, and never read a clean result obtained from the
fused artifact as evidence of anything. (`PARSEMAN-0.32-VERIFIED-CONSTRAINTS.md`
§2 states the blanket form of this claim; it is superseded on that point.)

---

## 4. Verification method — propose, verify, measure, keep

In that order, one conversion class at a time.

1. **Propose** the change for a named set of consts.
2. **Verify** with the oracle. It parses the built `lib/`, because that is the
   macro-compiled artifact that ships:

   ```
   pnpm --filter @jesscss/less-parser build
   node scripts/check-macro-buildable.mjs
   node packages/less-parser/test/ast-identity-oracle.mjs before.json
   # …edit, rebuild, re-run as after.json
   ```

   Both aggregates (`aggAst` from `parse()`, `aggCst` from `parseLessCst()`) must
   be unchanged. Parse failures are hashed too, so error behaviour is in the
   differential. A grammar touching one surface should move neither — the
   untouched surface is the control.
3. **Measure** if the change was motivated by cost. Do not claim a win you did
   not measure.
4. **Keep** only what survives 2 and 3. Otherwise revert, or record it as
   `blocked` / `deliberate exception` with the reason.

The oracle currently exists only for `less-parser`
(`packages/less-parser/test/ast-identity-oracle.mjs`). There is no equivalent
script for the other three. Because `less-parser` composes on `css-parser` and
`scss-parser` composes on `less-parser`, a `css-parser` change is partly covered
by the Less oracle — but say plainly which surfaces you actually hashed rather
than implying full coverage.

---

## 5. Definition of done

Not "tests pass". All four, stated with evidence:

- **diagnostic clean** — zero TypeScript/editor diagnostics in the files you
  touched (`pnpm run verify:types`), and, where you ran parseman's gating
  analysis, it was fed the pre-`compose()` `rules()` map (§3).
- **lint clean** — `pnpm run lint`.
- **oracle byte-identical** — both aggregates unchanged, quoted before/after.
- **macro-buildable clean** — `pnpm run check:macro`, `0 interpreter fallbacks`.

A green test suite is context. It is not any of these four.
