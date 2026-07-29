# R1 EXTEND — implementation brief (tree2 definitive rewrite)

Worktree: `/private/tmp/jess-tree2-r1-20260715` (branch `experiment/tree2-r1-extend-20260715`,
off `origin/experiment/tree2-cleanroom-20260715`). Already `pnpm install`ed and built in order
(parsers → awaitable-pipe → fns → plugins → core). The parseman symlinks were repointed to
absolute `/Users/matthew/git/oss/parser-thing`. `cd packages/core && pnpm exec vitest run src/tree2`
is GREEN at baseline (163 passed).

## HARD RULES (non-negotiable)
- NO `../tree` import anywhere inside `packages/core/src/tree2/` (boundary guard vitest must stay
  green; `grep -rn "\.\./tree" packages/core/src/tree2` empty). The BRIDGE
  (`tree2-frontend/bridge.ts`) MAY touch parser + `../tree` provenance — extend EXTRACTION from the
  parser tree belongs there. The extend ALGORITHM lives in a new boundary-clean
  `packages/core/src/tree2/extend.ts`.
- NO `as any`. Use structural guards / proper types.
- Port the ALGORITHM from `packages/core/src/tree/extend/{plan,solve,emit,pipeline}.ts` and
  especially the match+construct engine in `packages/core/src/tree/extend/extend-index.ts`
  (`extendByIndexOwn` and friends) — read them as a SPEC, write tree2-native code, do NOT import them.
- clone/inherit/withComponents op-counts must stay structurally ZERO (tree2 never clones nodes).

## THE REFERENCE (decided — do not re-litigate; flag divergences for owner)
Every prior tree2 rung gates byte-identity against `renderRealOracle` /
`renderRealOracleNested` (`tree2-frontend/oracle.ts`) — the Jess v5 legacy engine rendered on the
SAME `.less` tree2 bridges. USE THAT as the R1 byte-identity reference too (flatten = renderRealOracle,
nested = renderRealOracleNested). It is self-consistent and equals the owner-maintained graduate-v5
`.css` expected output for matching inputs.

The Jess v5 engine uses `:is()`-COMPACTED extend cascades (NOT expansion). Concrete captured reference
outputs for all 7 fixtures live in
`packages/core/src/tree2-frontend/__tests__/_r1_oracle/*.{flat,nested}.css` (rendered via
renderRealOracle/Nested from the alpha-release-port `.less` inputs). These are your concrete targets.

KNOWN reference caveats — FLAG for owner, do NOT silently match if it forces ugly hacks:
1. less.js `upstream/alpha` (checkout `/Users/matthew/git/worktrees/less.js/alpha-release-port`,
   verified `[upstream/alpha]`) ships EXPANDED extend expected output (no `:is()`), e.g.
   `.error.intrusion, .badError.intrusion`. The Jess v5 engine `:is()`-compacts
   (`:is(.error, .badError).intrusion`). This is an intended-v5-vs-less.js divergence — owner item.
2. renderRealOracle has KNOWN legacy extend bugs (roadmap §4 R-extend): a nested extender can render
   as a bare fragment, e.g. extend-selector `.footer .footer-nav:extend(.header .header-nav all)`
   renders `.footer-nav` (bare) not `.footer .footer-nav`. Where tree2 hits such a case, matching the
   bug byte-for-byte is acceptable for the ratchet BUT must be listed as a divergence-from-intent.

## Concrete extend SEMANTICS (from the captured reference — study `_r1_oracle/*.css`)
Parser representation (verified): a `:extend()` (attached `.a:extend(...)` OR body `&:extend(...)`)
appears as an `Extend` node that is `ruleset.rules[0]` of the SUBJECT ruleset. Fields:
- `.target` — the FIND selector. A string (`".error"`) or a SelectorList node for `:extend(.aa,.bb)`.
- `.flag` — `0` ⟺ `all` (partial=true); `1` ⟺ exact (partial=false). (Verified by probe.)
The SUBJECT (the thing appended / substituted-in) is the ruleset's OWN selector list.

Output shapes (byte-exact, from the reference):
- EXACT (flag=1): the extender selector is APPENDED as a whole new comma-branch to every rule whose
  full composed complex EQUALS the target. `.a`→`.a, .effected`. Chaining `.b:extend(.a)`,
  `.c:extend(.b)` → `.a, .b, .c`. Multi-target `:extend(.aa,.bb)` (non-partial) fans per branch.
- ALL (flag=0): the matched target span inside a subject compound/complex is replaced IN PLACE by
  `:is(<matched original span>, <extenders...>)`. Examples:
  `.error.intrusion` find `.error` → `:is(.error, .badError).intrusion`;
  `.intrusion .error` → `.intrusion :is(.error, .badError)`;
  multiple extenders + transitive chain collapse into one `:is(...)`:
  `.foo .bar` (`.foo` extended by `.ext1 .ext2`(all), `.ext3`, `.ext4`) →
  `:is(.foo, .ext1 .ext2, .ext3, .ext4) .bar`; chaining nests:
  `.g.h` → `:is(.g, :is(.i, .k).j).h`.
- Child composition against an extended (multi-branch) parent uses tree2's existing `:is()`
  parentToken grouping automatically: `.aa .dd` (`.aa` extended by `.cc`) → `:is(.aa, .cc) .dd`.
  THIS IS KEY: tree2 already composes children via `:is()` (serialize.ts `parentToken`). So extend
  mostly needs to (a) compute each subject rule's EXTENDED own-branch list, (b) let existing
  composition group children.
- Scope: extend inside `@media` only reaches subjects in that media body (+ nested media); a
  root-level extend reaches everything EXCEPT it does NOT cross INTO a media body's private subjects
  in the other direction. See `extend-media.flat.css` / `extend-chaining.flat.css` `@media` block.
- Self / circular reference is ignored (see extend-chaining `.u`, `.w`, `.x/.y/.z`).

## DESIGN (tree2-native)
1. BRIDGE (`bridge.ts`): in `toRuleset`, detect `Extend` nodes in `node.rules`. Extract each into an
   extend-instruction and DO NOT emit it as a body statement. Attach the instruction list to the
   tree2 `Rule` (add an optional `extends?: ExtendInstruction[]` field to the `Rule` node in
   `tree2/nodes.ts`, OR carry a side-table). Each instruction = { target: <tree2 SelectorList built
   from the Extend.target via existing toSelectorList>, partial: flag===0 }. The subject selector is
   the Rule's own `.selector`. Interpolated target (`[data=@{x}]`) → raise `UnsupportedShape`
   ('extend:interpolated-target'). Reference-import extend → `UnsupportedShape` ('extend:reference').
2. tree2/extend.ts (boundary-clean): a tree2-native selector IR + the PLAN/SOLVE/EMIT engine
   producing, for each subject rule, its EXTENDED own-branch SelectorList (string branches, plus the
   `:is(...)` wraps as tree2 selector structures). Reuse the composed-string forms serialize.ts
   already computes. Port `extend-index.ts` `extendByIndexOwn` match + `:is`-wrap construction, and
   `solve.ts` fixpoint (transitive chaining, fire-once on (subject,branchValue,instruction), dedup
   preserving document order, self/circular avoidance), and `plan.ts` reachability (root vs each
   @media/at-rule scope). Do it over tree2 Complex/Compound token structures (build a small IR by
   reading `Complex`/`Compound` tokens — NOT by cloning nodes).
3. EMIT integration (serialize.ts): before emitting a rule header, replace the rule's own composed
   branch list with the EXTENDED branch list from the engine. Both flatten (`compose`/`flatten`) and
   nested (`emitNestedRule`) paths must consult it. Because children compose via the existing
   `parentToken` `:is()` path, an extended multi-branch parent groups automatically. Add the
   zero-cost gate: no Extend instructions in the whole document → skip all extend work (pure
   streaming, byte-identical to today).
4. LEADING-COMBINATOR model fix (flagged by R0): nested `.a { > .b { … } }` /
   `#ns { > .mixin }` must parse as `RelativeSelector`, not as `ComplexSelector`
   plus a leading-combinator side field. `ComplexSelector` requires internal
   combinators; a leading combinator belongs in the branch shape. Corpus example:
   `rulesets/rulesets.less`.

## PROVE
- Add `packages/core/src/tree2-frontend/__tests__/extend-byte-identity.test.ts`: for each of the 7
  extend fixtures, bridge the `.less`, `serialize` in flatten and nested modes, compare to
  `renderRealOracle` / `renderRealOracleNested`. Report per-fixture pass/fail + first diff.
  `.less` inputs: `/Users/matthew/git/worktrees/less.js/alpha-release-port/packages/test-data/tests-unit/extend*/*.less`.
- Add an extend census (like `nested-census.test.ts`) over the full corpus to confirm no regression:
  the previously-passing 33 fixtures must STAY passing in both modes; boundary guard green; op-counts
  clone/inherit ZERO on an extend-heavy fixture (extend-nest).
- Delete the `_r1_oracle/` helper dir before final commit (it was only a reference capture) UNLESS
  you wire the tests to read it; prefer computing the reference live via renderRealOracle.

## Files to read first
- `packages/core/src/tree2/serialize.ts` (compose/parentToken/flatten + emitNested* + composeStats)
- `packages/core/src/tree2/nodes.ts` (Complex/Compound/Simple/canonical; add fields here)
- `packages/core/src/tree2-frontend/bridge.ts` (toRuleset/toSelectorList; add extend extraction)
- `packages/core/src/tree/extend/{extend-index.ts,solve.ts,plan.ts,emit.ts,pipeline.ts}` (SPEC only)
- reference captures: `packages/core/src/tree2-frontend/__tests__/_r1_oracle/*.css`

## Report back
Per-fixture byte-identity (flat + nested) vs renderRealOracle; the concrete `:is()` shapes handled;
what's deferred (interpolated-target, reference) with UnsupportedShape; op-counts; and the two owner
divergences above (alpha-expand vs `:is()`; legacy nested-extender bare-fragment bug). If you cannot
finish, commit progress and state EXACTLY where you are.

# ============================================================
# FINALIZATION — OWNER-SETTLED REFERENCE (supersedes any earlier reference wording)
# ============================================================

The owner has SETTLED the extend reference definitively and LIFTED the hold. Finalize to this:

## Compaction rule (DERIVED from the expected `.css` — document precisely in the R1 spec)
- Extend ALWAYS conceptually produces `:is(<original matched span>, <extender composed forms…>)`
  at the matched location. COMPACT `:is()` MAXIMALLY — even multi-compound / descendant extenders
  go INSIDE the `:is()` (e.g. `:is(.foo, .ext1 .ext2, .ext3, .ext4) .bar`; chaining nests:
  `:is(.g, :is(.i, .k).j).h`).
- EXPAND (comma-separated sibling branches) is the NARROW FALLBACK, used ONLY where a `:is()` would
  occupy the ENTIRE selector-branch position — i.e. the matched span IS the whole complex with no
  surrounding atoms/compounds. Then `:is(A, B, …)` at the selector root degenerates to the comma
  list `A, B, …` (semantically identical; Less normalizes a whole-selector `:is()` to a list).
  This is the ONLY structural expand case ("crosses a nested selector" = the whole-branch case).
  Examples that EXPAND: exact extend (`.a, .effected`); whole-complex all-extend
  (`.error` → `.error, .badError`; `.ext8 .ext9` → `…, .buu`; `.sidebar` → `.sidebar, .sidebar2,
  .type1 .sidebar3, .type2.sidebar4`). Examples that COMPACT (proper sub-part): `:is(.error,
  .badError).intrusion`, `.intrusion :is(.error, .badError)`, child-vs-extended-parent
  `:is(.aa, .cc) .dd`.

## FIX the expected `.css`, don't just flag (owner PRE-AUTHORIZED editing JESS expected output; NOT less.js alpha's)
Two renderRealOracle BUGS the intended v5 output must NOT reproduce — tree2 produces CORRECT output,
and any Jess `.css` expected output that encodes the bug (or an expanded-where-compactable shape) gets UPDATED
to tree2's correct+compact bytes:
  BUG 1 — EXACT extend leaking into nested children. renderRealOracle emits `:is(.aa, .cc) .dd` for
    `.cc:extend(.aa)` (EXACT, flag=1) with `.aa { .dd {} }`. WRONG: exact matches ONLY the whole
    `.aa` selector; `.aa .dd` must stay UNCHANGED. Only `all` (flag=0) propagates into sub-spans.
  BUG 2 — nested-extender BARE FRAGMENT. renderRealOracle emits bare `.footer-nav` for
    `.footer .footer-nav:extend(.header .header-nav all)`. WRONG: contribute the extender's COMPOSED
    form `.footer .footer-nav` (whole-branch → `.header .header-nav, .footer .footer-nav`).
Also: graduate-v5's "nested" extend `.css` expected output are actually FLATTENED `:is()` (NOT truly nested,
e.g. `:is(.sidebar,…) .box` instead of a nested `.box` block) — regenerate them to the correct
nested-mode output. Report a DIFF SUMMARY (which `.css` changed, what, and the derivation
justification) — no per-file approval needed.
JESS expected `.css` live in the graduate-v5 less.js worktree
(`/Users/matthew/git/worktrees/less.js/graduate-v5/packages/test-data/tests-unit/extend*`): top-level
`.css` = v5 (correct+compact, nested for nested mode), `legacy/*.css` = the flattened form. Do NOT
edit `alpha-release-port` / `upstream/alpha` expected output (less.js's own expanded behavior).

## Deferred (UnsupportedShape, fail-loud): interpolated-target extend (`[data=@{x}]`), reference extend.

## Land steps (hold lifted): once tree2 is CORRECT+COMPACT green in BOTH modes, disagreeing Jess
expected output fixed, full tree2 suite + boundary guard green, clone/inherit/withComponents ZERO:
  1. Write the R1 spec section in `TREE2-DESIGN-SPEC.md` (PLAN/SOLVE/EMIT algorithm, the concrete
     `:is()` shapes, the derived compaction/expand-exception rule, both-collapse-mode projection,
     the leading-combinator model change, the expected-output-fix list, the deferred cases).
  2. Append a handoff experiment-log entry in `AST-ARENA-EXPERIMENT-HANDOFF.md`.
  3. Delete this brief file and the `_r1_oracle/` capture dir.
  4. Commit to `experiment/tree2-r1-extend-20260715`, push, then FAST-FORWARD
     `experiment/tree2-cleanroom-20260715` to it (`git push origin
     experiment/tree2-r1-extend-20260715:experiment/tree2-cleanroom-20260715 --no-verify` or local FF
     + push). Do NOT merge to dev.
  5. Report: new head sha, per-fixture byte-identity (both modes), the derived compaction rule, the
     expected-output DIFF SUMMARY, race/op-counts.
