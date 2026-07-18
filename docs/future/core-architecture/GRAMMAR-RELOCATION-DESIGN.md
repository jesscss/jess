# Grammar Relocation Design — reorg-A4 §0.11 "regex out of the builders, into the grammar"

> **Status:** design-only spec (no engine/parser/grammar code changed). Base: `origin/dev`.
> Maps every regex-based classification / byte-re-derivation site on the maintained Less
> parse path to a relocation target, coordinated with the in-flight value/literal
> node-model redesign (task **#44**, `VALUE-NODE-MODEL-DESIGN.md` — **not yet written**;
> node-set target inferred from `UNIFIED-NODE-MODEL-SPEC.md` + `VALUE-LITERAL-TAG-SPEC.md`).
>
> **Owner ruling folded in (2026-07-18):** the less-compat **bridge byte-identity is
> NON-SACRED** for this work. Shapes previously frozen to protect the bridge
> (`grammar.ts:96` `customPropInterp` single-leaf; the `custom-props.ts` / `import.ts` /
> `value-leaf.ts` `@{…}` re-tokenizers; burndown **TB-1..TB-5**) MAY now be split. The
> **only** correctness gate for the eventual execution is the **ast/ differential vs the
> v5 alpha `.css`** —
> `packages/core/src/ast/parse-host/__tests__/alpha-oracle-differential.test.ts` vs
> `alpha-oracle-baseline.json` — staying green. Bridge byte-identity tests may go red and
> are repaired later at the less-compat re-point.

## Adversarial-review corrections (2026-07-18)

The first-pass §6 sequencing broke on review — 4 of its 5 cluster claims were wrong. The
corrections below are **authoritative**; the inline §3/§6 text has been reconciled to match.
A future execution round must plan from this list, not the original §6 wording.

1. **S5 and S6 are NOT parallel/independent coupled tracks.** Both edit the **same method**
   `_buildAtRulePrelude` (`builders.ts` ~2524–2898). S5's prelude-embedded value construction
   and S6's query-prelude re-tokenize live in the same method body, so they MUST be **one
   coordinated method-rewrite** — or S6 (the TB-3 query-prelude grammar split) lands first and
   re-expresses S5's in-method prelude value sites. They cannot be scheduled as disjoint
   parallel commits. **The four prelude-embedded L4 sites** (`builders.ts:2789` `nsMediaRe`,
   `:2824`, `:2830`, `:2842`) that §3/L4 first placed in S3 **move INTO this coordinated
   S6/TB-3 method-rewrite** (they are inside `_buildAtRulePrelude`), and are therefore NOT
   part of the independent S3 subset.

2. **S4 `customPropInterp` (`grammar.ts:96`) is NOT "land now, ast/-differential-gated."**
   The single-leaf custom-prop **NAME** shape protects the legacy/maintained **BuilderHost**
   output too — not only the less-compat bridge. The grammar's own retirement note at that
   line gives the trigger: *"when the legacy BuilderHost is retired, reorg A4."* So it is
   re-gated to the **Jess ratchet / legacy-BuilderHost retirement (A4)**, NOT the ast/
   differential alone, and it carries an **unscoped legacy-builder custom-prop-NAME edit**.
   It moves OUT of the independent-S4 set into the **A4-coupled set** (with PH2
   `custom-props.ts`).

3. **S4 TB-4/TB-5 are blocked on unbuilt §3.3 `Quoted` grammar structuring** — a prerequisite
   that does **not exist on `origin/dev`**. `import.ts` ~`:466`/`:478` (`.includes('@{')`) and
   `value-leaf.ts` ~`:87` (char-scan) cannot "land independently now"; they need the §3.3
   `Quoted` `Interp` child first. The **only** possible clean independent S4 candidate is
   `at-rules.ts` ~`:232` `@@name`→`VarIndirect` — and **only if the grammar already emits an
   indirect-var child** (verify the terminal exists first).

4. **S3 is only PARTIALLY independent.** Its accessor-**KEY** sites build `Quoted` value
   literals (`builders.ts:349`, `:3227` `new Quoted(...)`) → those constructions are
   **#44-coupled** and deferred to #44's producer flip (edit only the segment/bracket regex
   there, not the `new Quoted`). The **non-prelude** L4 sites ARE independent. The four
   prelude L4 sites move to S6 (correction #1).

5. **The "~14 PENDING-#44" tally is a FLOOR, not exact.** Value constructions NOT enumerated
   in L1/L2/L3 also flip with #44's producer: `builders.ts` `new Color` @`:486`; `new Quoted`
   @`:219`, `:457`, `:724`, `:1270`, `:1327`, `:1343`. The true #44-producer-flip footprint is
   **larger** than the S5 list.

6. **"Bridge-release unblocks 7" over-claims.** 2 of the 7 — `escapedStrRe` @`builders.ts:2533`
   and the L3 quoted-path re-tokenize — construct `Quoted` and are correctly parked in **S5**
   (PENDING #44), so only **~5** are landable under the bridge ruling alone.

7. **Currently-executing cleared subset:** **S1 + S2 + non-prelude-S3** (with the
   `:349`/`:3227` `new Quoted` carve-outs) is being landed now by agent
   `work/regex-kill-s1-s2-s3clean`, gated on **ast/ differential + Jess ratchet + core suite**.

The §2 inventory table `file:line` numbers are **current and verified correct** — only the
burndown's line numbers were stale.

## 0. Governing law and node-set target

- **LAW (P6, `DESIGN-DECISIONS.md`):** no regex outside Parseman's `regex()` combinator on
  the maintained path. `grammar.ts` (the Parseman grammar) + `builders.ts` (the
  `LessGrammar`/`BuilderHost`) are a **1:1 Chevrotain port**; the authoritative node shape
  for every construct is `less-parser/src/productions/*.ts`. DONE-criterion for the whole
  program:
  `grep -nE '\.(test|exec|match|matchAll)\(|new RegExp|=\s*/[^/*]'` over `builders.ts`
  (maintained path) and over any surviving `ast/` engine file → EMPTY except a documented
  synthetic-bytes KEEP set.
- **#44 node-set target** (from `UNIFIED-NODE-MODEL-SPEC.md` §1 + `VALUE-LITERAL-TAG-SPEC.md`):
  one plain-data corpus, discriminant `type` PascalCase. Value literals are the typed set
  **`Keyword` / `Color` / `Dimension` / `Quoted` / `Bool`**, raw/opaque content is
  **`Any`**, and **`Word` is eliminated** (folded into the unified `type:'Dimension'` /
  literal-tag reshape). Un-operated literals serialize **source-verbatim** (a `Dimension`
  built by a builder must carry the verbatim image, not a canonicalized `value:number`).
  Any builder site that **constructs** a value literal is therefore blocked on #44's final
  field shape and is tagged **PENDING #44** below.

## 1. Relocation-target vocabulary

Each site maps to exactly one of:

- **(a) `regex()` terminal** — the classification becomes a lexical rule in `grammar.ts`;
  the builder consumes a typed leaf and never re-scans bytes.
- **(b) typed-child grammar rule** — the grammar emits a structured/typed child (a rule,
  not just a terminal) so the builder maps 1:1 with no re-derivation.
- **(c) non-regex string op** — genuinely trivial (`.trim()`, `.slice()`, `.includes()`,
  `.split(char)`); no grammar change; may stay, but must shed the *regex* form to satisfy
  the grep gate.
- **KEEP** — synthetic-bytes / no-parse-origin engine regex; documented, not relocated.

Annotations: **[BRIDGE-RELEASED]** = was held only for bridge byte-identity, now unblocked
by the 2026-07-18 ruling. **[PRELUDE-SPLIT]** = needs a real grammar query-prelude split
(coverage gap, never bridge-coupled). **[PENDING #44]** = node-construction shape depends
on #44's final literal fields.

---

## 2. Inventory — `less-parser/src/builders.ts` (maintained `BuilderHost`, 3281 LOC)

**Raw counts (verified on `origin/dev`):** 64 regex-op call sites
(`.test/.exec/.match/.matchAll/replace(/…/)`) + 26 regex-literal definitions (`= /…/`).
These collapse into **9 classification clusters** below. Every `file:line` is listed once
in its cluster; a line that both defines and uses a regex is counted at its use.

### Cluster L1 — Dimension / number / ratio re-split  → (a)+(b), **PENDING #44**

The builder re-splits an already-lexed value word into number+unit (or ratio numerator/
denominator) and constructs a `Dimension`. The grammar already lexes numbers; it should
emit a typed `Dimension{image,value,unit}` child (matching `VALUE-LITERAL-TAG-SPEC` verbatim
image), so the builder maps with no split.

| file:line | classifies | feeds | target |
|---|---|---|---|
| `builders.ts:943` `/^(\d+)([a-zA-Z]+|%)?$/u` | scalar decl value number+unit (`_buildDeferredScalarDeclaration`) | `Dimension` | (b) grammar `Dimension{value,unit}` child · PENDING #44 |
| `builders.ts:2653` `/^([+-]?(?:\d*\.\d+|\d+))([_a-zA-Z%][-_a-zA-Z0-9%]*)?$/` | prelude/value token number+unit (`_buildAtRulePrelude`) | `Dimension` | (b) same · PENDING #44 |
| `builders.ts:2615` `/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/` | aspect-ratio `n/d` (custom-prop value) | ratio value | (b) grammar ratio child · PENDING #44 |
| `builders.ts:1488` `/\d\s*\.\//` | division-like detection (`_buildLessDeclaration`) | math-mode routing | (c)/(b) fold into value grammar · PENDING #44 |

### Cluster L2 — value-token re-classify (var / escaped-string / var-accessor / paren)  → (b), **PENDING #44** (Quoted)

One shared family of 4 named regexes re-classifies a raw value word into `VarRef` /
`Quoted`(escaped) / `MapAccessor` / `Paren`. The grammar already lexes `lessVar`,
`singleStr`/`doubleStr`, and paren groups; these should arrive as typed value nodes.

| file:line | regex | classifies | target |
|---|---|---|---|
| `builders.ts:2525` def `singleVarRe` + uses `:2548,:2792` | `^@name$` | bare var → `Reference`/`VarRef` | (b) consume `lessVar` leaf |
| `builders.ts:2533` def `escapedStrRe` + uses `:2535,:2595,:2641` | `^~'…'$` | escaped string → `Quoted{escaped}` | (b) grammar `EscapedValue` child · PENDING #44 (Quoted) |
| `builders.ts:2543` `/^(['"])([\s\S]*)\1$/` + `:2605` paren `/^\(([\s\S]*)\)$/` | plain quoted / paren group | `Quoted` / `Paren` | (b) consume `singleStr`/`doubleStr`/paren rule · PENDING #44 |
| `builders.ts:2564` def `varAccRe` + uses `:2598,:2649`; `:2799` dup `varAccRe` + `:2800` | `^@name[key]$` | var index → `MapAccessor` | (b) grammar accessor child |
| `builders.ts:2622` `.includes('@')` + `/\s/` | interp-in-value guard | routing | (c) |
| `builders.ts:2663` `/^[-+*/]$/` | operator token in operand list | `Operation` operand | (b) consume `compareOp`/operator terminal |

### Cluster L3 — `@import` / `@use` prelude re-parse  → (b), partly **[BRIDGE-RELEASED]**, import subsystem

The import/use builders re-parse the opaque prelude string for quotes, options, `as`-alias,
and js-file class. Grammar should deliver typed prelude leaves (path `Quoted`, option
keywords, `as <ident>` alias). Moves with the import subsystem (REORG §0.8a); pairs with
parse-host `import.ts` (Cluster PH3). The interpolated-specifier detection (TB-4) is
**BLOCKED on the unbuilt §3.3 `Quoted` grammar** (corrected 2026-07-18 — not independently
landable now).

| file:line | regex | classifies | target |
|---|---|---|---|
| `builders.ts:2323` `/^\s*\(([^)]+)\)/` + `.replace(/^@import\s*/)` | `(inline\|css\|…)` option group | option keywords | (b) typed option leaves |
| `builders.ts:2340` `/(['"])([^'"]+)\1/`, `:2367` `/['"]([^'"]+)['"]/`, `:2934` `/(['"])(…)\1/` | quoted import path | path `Quoted` | (b) typed path leaf · PENDING #44 (Quoted) |
| `builders.ts:2352-2358` five `.replace(/…/)` (`@name`, `(opts)`, `url()`, quote, `as …`, `;`) | strip prelude → residue | residue | (b) typed prelude decomposition |
| `builders.ts:2427` `/\bas\s+([^\s;(]+)/`, `:2943` `/\bas\s+([^\s;]+)/` | `as <ns>` alias | namespace alias | (b) grammar `as` alias child |
| `builders.ts:2945` `/\.[cm]?[jt]sx?$/`, `:2950` two `.replace` | js-file class + ns sanitize | module class | (c) `.endsWith`/string map (js-detect stays classification: (a) small terminal or KEEP w/ doc) |

### Cluster L4 — selector / ns-accessor / mixin-call head re-split  → (b)

Repeated `match(/[#.][^#.]*/g)` splitting of a selector/namespace head string into segments,
plus accessor-bracket and empty-call detection. The grammar already lexes `basicSel` /
`mixinCallBasicSel` / interpolation parts; the builder should recurse over typed segment
children (one recursive `node()`), not re-split a joined string.

**Independence (corrected 2026-07-18):** only the **non-prelude** L4 sites are S3-independent.
Two carve-outs: (i) the accessor-**KEY** sites that build `Quoted` value literals
(`builders.ts:349`, `:3227` `new Quoted(...)`) are **#44-coupled** — edit only the
segment/bracket regex, defer the `new Quoted` to #44's producer flip (S5); (ii) the four
prelude-embedded sites (`:2789/:2824/:2830/:2842`, all inside `_buildAtRulePrelude`) move to
**S6** (the coordinated query-prelude method-rewrite), NOT S3.

| file:line | regex | classifies |
|---|---|---|
| `builders.ts:257` `/(?:^|[\s,])\.-?[_a-zA-Z]/` | class-selector-in-value detect (`_buildVarDeclaration`) |
| `builders.ts:281` `/^\s*\[([^\]]+)\]/` + `:306` `/^\s*\(\s*\)/` | accessor bracket / empty-call after value |
| `builders.ts:407` `/[#.][^#.>+~\s]*/g` | ns-accessor head segment split (`_buildNsAccessor`) |
| `builders.ts:1168,:1175,:1190,:1202` `/[#.][^#.]*/g` etc. | segment split in `_assembleSegment` / accessor decode |
| `builders.ts:2789` def `nsMediaRe` + `:2824` use; `:2830` `/[#.][^#.]*/g` | ns-media path split → **S6** (inside `_buildAtRulePrelude`) |
| `builders.ts:2842,:3189` `/^([.#][^\[\]()\s]+)(\[([^\]]*)\])?$/` | arg-ref `.mixin[key]` split (`:2842` prelude-embedded → **S6**; `:3189` → S3) |
| `builders.ts:3043` `/^[#.]-?[_a-zA-Z…]/`, `:3045` `/^[>+~|]$|^\|\|$/` | selector-head vs combinator classify |
| `builders.ts:3112` `/[#.][^#.]*/g` | segment split (namespace ref) |
| `builders.ts:3218` `/^\[([^\]]*)\]/` + `:3234,:3239` `/^\(\s*\)/` | accessor bracket / empty-call (2nd site) |
| `builders.ts:1039` `/^!?all$/` | extend `!all` flag (`_buildExtendTarget`) → (b) grammar `optional(flag)` child (pairs w/ PH `extend.ts` ALL_FLAG) |
| `builders.ts:349`, `:3227` accessor-KEY `new Quoted(...)` | accessor-key `Quoted` literal → **#44-coupled (S5)**; edit only the segment/bracket regex here, defer the `new Quoted` |

### Cluster L5 — media/supports query prelude classify  → (b), **[PRELUDE-SPLIT]**

`_buildAtRulePrelude` (2524-2897) hand-tokenizes the media/supports/container prelude:
whitespace normalization, media-keyword/comparison-op set membership, name+`(`/`not`
sniffing. This is the builder-side twin of parse-host `at-rules.ts` (Cluster PH1). It needs
a **real grammar query-prelude split** (the grammar currently delivers the prelude as one
opaque region — coverage gap, `TIER-B-INTERPOLATION-GRAMMAR-SPEC` §3.4, burndown **TB-3**);
NOT bridge-coupled.

| file:line | regex/op | classifies |
|---|---|---|
| `builders.ts:2688` `/[><=!]/` | colon-vs-comparison disambiguation in prelude |
| `builders.ts:2715-2717` three `.replace(/…/)` | paren/space/comparison-op whitespace normalize |
| `builders.ts:2756,:2760` `/\s/` | manual prelude tokenizer boundaries |
| `builders.ts:2881` `/^(@?-?[_a-zA-Z…])\s+(?:\(|not…)/i` + `:2884` `.replace(/^@/)` | function-name-in-prelude sniff |
| `builders.ts:1497` `/@[a-zA-Z][\w-]*/`, `:1504` `/\$[a-zA-Z][\w-]*/` | prelude-var warning detection (`_warnAtRulePreludeVars`) → (c) or warning stays |
| `builders.ts:1539,:1561` `/^\s*@-?[\w-]+/`, `/^@(-?[a-zA-Z…])/` | `_firstTopLevelBareAtVar` (bare-`@var` warning) → (c) warning path |

### Cluster L6 — guard / comparison operator classify  → (b)

The grammar already exposes a `compareOp` `regex()` terminal (`grammar.ts:235`); the builder
should consume the typed operator child instead of re-testing text.

| file:line | regex | classifies |
|---|---|---|
| `builders.ts:508` `/>=\|<=\|=>\|=<\|=~\|[<>=]/` | comparison-op leaf (`_isCompareOpLeaf`) → consume `compareOp` |
| `builders.ts:929` `/^[ \t\n\r\f]+$/u` | whitespace-only component check → (c) |

### Cluster L7 — legacy MS-filter / format-call classify  → (a)/(c), niche

`progid:DXImageTransform` legacy filter re-parse and `%()`/format spec-char scan. Low-traffic
IE-compat + format lowering; several are genuinely trivial string ops.

| file:line | regex | classifies |
|---|---|---|
| `builders.ts:909` `.replace(/;\s*$/)`, `:910` `/^progid:/i` | MS-filter detect (`_buildLegacyMSFilter`) |
| `builders.ts:972` `.replace(/\s*=\s*/g)`, `:973` def `varRe` + `:974` `.matchAll`, `:978` `.replace`, `:982` `/([A-Za-z]+)=$/`, `:983` `/colorstr$/i` | MS-filter key=value templating |
| `builders.ts:755,:760` `/[sda]/i`, `/[A-Z]/` | format-spec conversion char (`_lowerFormatString`) → (a) small terminal |
| `builders.ts:1319` `/^url\($/i` | url-open filter in interp | (c) `.toLowerCase()==='url('` |

### Cluster L8 — quote/prefix strip + numeric-name  → (c) trivial string ops

| file:line | regex | replaces-with |
|---|---|---|
| `builders.ts:193` `/^-?\d/` | numeric var-name check → `code>='0'…` or first-char test |
| `builders.ts:1017` `.replace(/^(['"])([\s\S]*)\1$/)` , `:1162` `.replace(/^\$/)` | strip outer quote / leading `$` → `.slice` |
| `builders.ts:1464` `.replace(/\s+$/)` | trailing-ws trim → `.trimEnd()` |
| `builders.ts:1605,:2015` `/^\S+\s+\(/` | "name space (" mixin-vs-decl sniff → grammar already disambiguates; (b)/(c) |

### Cluster L9 — known-at-rule name gate  → (a) already lexable

| file:line | regex | note |
|---|---|---|
| `builders.ts:65` def `KNOWN_AT_RULE_VAR_NAME_RE` + `:1651` use (`_buildVarCall`) | The grammar **already** has `knownAtVar`/`nonKnownAtVar` `regex()` terminals (`grammar.ts:179-180`) encoding this exact set → (a) consume the typed leaf; delete the builder copy |

---

## 3. Inventory — `core/src/ast/parse-host/**` (direct ast/ construction host)

Per burndown Cluster 2.b, **17 verified byte-rederivation sites**. `parse-host/` is
**deleted wholesale at reorg A4** (construction moves into the parser packages), so each site
either (i) retires with the directory once the grammar emits the structured child, or
(ii) moves with its subsystem (import). Several today ship **wrong output** (`@media @{q}`,
`--@{k}:…` misparse) and are the keystone P0 violations.

### Cluster PH1 — at-rules.ts query prelude re-tokenize  → (b), **[PRELUDE-SPLIT]**, HIGH risk

| file:line | regex | classifies | note |
|---|---|---|---|
| `at-rules.ts:203` def `AT_KEYWORD` + `:252` use | `@name` head of prelude | wrong output today | needs grammar query-prelude leaves (TB-3) |
| `at-rules.ts:209` `/@\{\s*([^}]+?)\s*\}/gu` + `:214` use | `@{…}` interp in prelude | `@media @{q}` misparse | route through structured `Interp` leaf |
| `at-rules.ts:232` `/^@@([A-Za-z_][\w-]*)$/u` | `@@name` indirect var → `VarIndirect` | | (b) grammar indirect-var child · **only possible clean independent S4 candidate — verify the grammar already emits an indirect-var terminal FIRST** (generic at-rule, not query) |
| `at-rules.ts:235` `/@([A-Za-z_][\w-]*)/gu` + `:239` use | `@name` refs in prelude | | (b) prelude var leaves |

### Cluster PH2 — custom-props.ts interp-name re-tokenize  → (b), **A4-COUPLED** (corrected 2026-07-18)

**Correction (2026-07-18):** the single-leaf custom-prop **NAME** shape (`grammar.ts:96`
`customPropInterp`) protects the **legacy/maintained BuilderHost** output too — not only the
less-compat bridge. The grammar's own retirement note at that line gives the trigger: *"when
the legacy BuilderHost is retired, reorg A4."* So this cluster (PH2 **and** the `grammar.ts:96`
`customPropInterp` split) is re-gated to the **Jess ratchet / legacy-BuilderHost retirement
(A4)**, NOT the ast/ differential alone, and it carries an **unscoped legacy-builder
custom-prop-NAME edit**. It is therefore **NOT** part of the independent-S4 set.

| file:line | regex | classifies | note |
|---|---|---|---|
| `custom-props.ts:109` `/@\{\s*([^}]+?)\s*\}/g` + `:114` use | `@{…}` in custom-prop NAME | TB-1/TB-2 | **A4-COUPLED** — split `grammar.ts:96` `customPropInterp` into `--`+ident+`lessInterp` leaves, consume via `interpFromRegion`. Gated on Jess ratchet / legacy-BuilderHost retirement (A4), not ast/ differential alone; carries an unscoped legacy-builder custom-prop-NAME edit |

### Cluster PH3 — import.ts specifier / keyword / url re-derive  → (b), import subsystem + **[BRIDGE-RELEASED]**

| file:line | regex | classifies | note |
|---|---|---|---|
| `import.ts:296` `/\.css([?#].*)?$/` | `.css` extension test | | (c)/(b) — resolution domain, moves w/ import subsystem |
| `import.ts:450` def `IMPORT_KEYWORD_RE` + `:520` use | `@import`/`@-import`/`@-export` name | | (a) grammar already lexes `atKeyword`; consume typed keyword |
| `import.ts:484` `/^url\(\s*(.*?)\s*\)$/is` | `url(...)` unwrap | | (b) typed `url()` child |
| `import.ts:466`/`:478` `.includes('@{')/'@@'` (TB-4, substring not regex) | interpolated-specifier detect inside `Quoted` | | **BLOCKED on §3.3 `Quoted` grammar structuring** (prerequisite does NOT exist on `origin/dev`) — cannot land independently now; needs the `Quoted` `Interp` child built first |

### Related deferred host sites (not regex, tracked in burndown TB-4/TB-5, **[BRIDGE-RELEASED]**)

| file:line | what | note |
|---|---|---|
| `value-leaf.ts:87` `quotedInterp`/`quotedLeaf` (TB-5, char-scan) | `@{…}` inside quoted-string VALUE | **BLOCKED on §3.3 `Quoted` grammar structuring** (does NOT exist on `origin/dev`) — consume the `Quoted` `Interp` child once built; NOT independently landable now |
| `mixins-def.ts:112` (TB, not interp, not regex) | multi-token space-list default (`thin dotted`) not assembled into `List` | §3.5 list value-assembly; left as-is, out of this program's regex scope |

---

## 4. Inventory — sibling parsers (cross-check; Less is the focus)

Flagged so a shared `preprocessorBase` relocation (task #34, `DESIGN-DECISIONS.md` P5) fixes
shared shapes once. **css-parser is already clean (0 sites)** — the CSS base carries no regex
debt, confirming the anti-pattern is dialect-builder-local.

| package | sites | lines | shared-shape note |
|---|---|---|---|
| `css-parser/src/builders.ts` | **0** | — | clean; the relocation target substrate |
| `scss-parser/src/builders.ts` | 7 | `:312` compare-op leaf, `:345` `not`, `:428` `@each`, `:1089` import path quote, `:1312` `@extend %` placeholder | `:312`/`:1089` mirror Less L6/L3 → **preprocessorBase-shareable**; `:428`/`:1312` are SCSS-specific |
| `jess-parser/src/builders.ts` | 1 | `:216` `/^[+-]?\d/` numeric-value first-char | mirrors Less L8:193 → shareable trivial (c) |

**Shared-shape wins (relocate once in `preprocessorBase`):** compare-op leaf (L6 / scss:312),
import-path quoted leaf (L3 / scss:1089), numeric-first-char (L8 / jess:216). The remaining
Less sites are Less-dialect-specific (var/interp/ns-accessor/mixin) and relocate into the
Less grammar directly.

---

## 5. Headline classification

**Total relocatable sites:** **~72 distinct classification sites** across the maintained path
— **55 in `less-parser/builders.ts`** (64 regex-op call sites + 26 literal defs collapsing to
55 distinct classification shapes across clusters L1–L9), **17 in `core/ast/parse-host/**`**
(the burndown-verified 2.b set). Sibling parsers add **8** (scss 7 + jess 1), of which **3**
are `preprocessorBase`-shareable with Less clusters.

| Bucket | count | which |
|---|---|---|
| **[BRIDGE-RELEASED]** (landable under the 2026-07-18 bridge ruling ALONE) | **~5** (corrected from 7) | PH1 `at-rules.ts:232` `@@name`→`VarIndirect` (verify terminal first); plus the bridge-only interp sites. **NOT** in this set: PH2 `custom-props.ts` @{} + `grammar.ts:96` `customPropInterp` (→ **A4-coupled**, protects legacy BuilderHost); `import.ts:466` TB-4 + `value-leaf.ts` TB-5 (→ **blocked on unbuilt §3.3 `Quoted` grammar**); L2 `escapedStrRe` @`:2533` + L3 quoted-path (→ construct `Quoted`, **parked in S5 / PENDING #44**) |
| **[PRELUDE-SPLIT]** (need a real grammar query-prelude split — coverage gap, never bridge-coupled) | **~11** | L5 whole `_buildAtRulePrelude` cluster (6) + PH1 `at-rules.ts` query sites (`:203/:209/:235`, ~5). **TB-3.** Highest blast radius. |
| **PENDING #44** (node-construction shape depends on #44's final literal fields) | **≥14 (FLOOR, not exact)** | all of L1 (4, Dimension/ratio) + L2 Quoted-constructing sites (5) + L3 path-`Quoted` (2) + L2 paren/operand (3). **PLUS un-enumerated value constructions that flip with the same #44 producer:** `builders.ts` `new Color` @`:486`; `new Quoted` @`:219`, `:457`, `:724`, `:1270`, `:1327`, `:1343`; accessor-KEY `new Quoted` @`:349`, `:3227`. Cannot rewrite the builder's `new Dimension(...)`/`new Quoted(...)`/`new Color(...)` until #44 fixes `type`+verbatim-image fields. The true producer-flip footprint is **larger than the S5 list**. |
| **grammar-terminal-ready now (a)** | ~6 | L9 known-at-rule (already lexed), L6 compare-op (already `compareOp`), PH3 `IMPORT_KEYWORD_RE` (already `atKeyword`), L7 format chars |
| **trivial (c), no grammar change, shed regex form** | ~15 | L8 (4), L7 niche (3), L5 warnings (4), scattered `.trim`/`.slice`/`.includes` |

---

## 6. Sequencing — rewrite `nodes.ts`/`grammar.ts`/`builders.ts` ONCE with #44

The mandate is to avoid rewriting the value-construction sites **twice** (once for regex
relocation, once for #44's node reshape). The split below isolates a **collision-free set**
that can land independently from the **coupled set** that must land *in the same landing* as
#44's node-model migration.

### Collision-free clusters (land independently, before or beside #44)

| # | cluster | target | risk (differential blast radius) |
|---|---|---|---|
| **S1** | L9 known-at-rule + L6 compare-op + PH3 `IMPORT_KEYWORD_RE` | (a) consume already-existing `regex()` terminals; delete builder copies | **LOW** — terminals already exist; pure builder deletion. No node-shape change. |
| **S2** | L8 + L7-trivial + L5-warnings + scss:216/jess trivial | (c) de-regex trivial string ops | **LOW** — behavior-identical string ops; grep-gate only. |
| **S3** (partial — see corrections #1/#4) | **non-prelude** L4 selector/ns-accessor/mixin-head re-split | (b) recurse over typed segment children | **MEDIUM** — selector nodes are NOT in #44's value-literal set (structural `Complex`/`Compound`/`Simple`), so no #44 coupling. **Carve-outs:** accessor-KEY `new Quoted` (`:349`, `:3227`) → S5 (#44-coupled); the four prelude-embedded sites (`:2789/:2824/:2830/:2842`) → S6. Guard with mixin/ns-accessor differential fixtures. |
| **S4** (shrunk — see corrections #2/#3) | **only** PH1 `at-rules.ts:232` `@@name`→`VarIndirect` — **and only if the grammar already emits an indirect-var terminal (verify first)** | (b) grammar indirect-var child | **MEDIUM** — the rest of the original S4 has left this set: PH2 `custom-props.ts` + `grammar.ts:96` `customPropInterp` are **A4-coupled** (protect legacy BuilderHost); `import.ts:466` TB-4 and `value-leaf.ts` TB-5 are **blocked on the unbuilt §3.3 `Quoted` grammar**. Gate is ast/ differential. |

### Coupled cluster (MUST land WITH #44)

| # | cluster | why coupled | risk |
|---|---|---|---|
| **S5** | L1 (Dimension/number/ratio) + L2 (var/escaped-str/quoted/paren/operand) + L3 quoted-path + accessor-KEY `new Quoted` (`:349`, `:3227`) + the un-enumerated `new Color`/`new Quoted` FLOOR sites (see §5, correction #5) | Every site **constructs a value literal** (`Dimension`/`Quoted`/`Color`) whose `type`+field shape is exactly what #44 redefines (verbatim image, PascalCase `type`, `Word` elimination). Relocating the grammar to emit `Dimension{value,unit}` / `Quoted` children AND rewiring the builder to map them is the same edit as #44's producer flip. Doing it twice = the double-rewrite the owner forbids. | **HIGH** — value path is the hot differential surface; verbatim-vs-canonicalized Dimension output (`1.0px`→`1.0px`) is a #44 semantic. Land `grammar.ts` value-terminal reshape + `builders.ts` L1/L2/L3 rewrite + `nodes.ts` literal reshape as ONE commit gated on the ast/ differential. |

### Coupled cluster (MUST land WITH the query-prelude grammar split — TB-3)

| # | cluster | why coupled | risk |
|---|---|---|---|
| **S6** | L5 `_buildAtRulePrelude` + the four prelude-embedded L4 sites (`:2789/:2824/:2830/:2842`) + PH1 query sites (`:203/:209/:235`) | Both are the builder/host twins of the SAME missing structured child: the media/supports/container prelude arrives as one opaque region. Neither can drop its regex until the grammar emits query-prelude leaves. Land the grammar prelude-split, then delete BOTH re-tokenizers in the same landing. | **HIGH** — ships wrong output today (`@media @{q}`); the fix changes real fixtures. |

> **Correction #1 (2026-07-18): S5 and S6 are NOT parallel independent coupled tracks.** S5's
> in-method prelude value construction and S6's query-prelude re-tokenize live in the **same
> method** `_buildAtRulePrelude` (`builders.ts` ~2524–2898). They MUST be **one coordinated
> method-rewrite**, OR S6 (the TB-3 query-prelude grammar split) lands first and re-expresses
> S5's in-method prelude value sites. They cannot be scheduled as disjoint parallel commits.
> The four prelude-embedded L4 sites (`:2789/:2824/:2830/:2842`) that §2/L4 first placed in S3
> move INTO this coordinated S6/TB-3 method-rewrite.

### A4-coupled cluster (MUST land WITH the legacy-BuilderHost retirement, reorg A4)

| # | cluster | why coupled | risk |
|---|---|---|---|
| **S-A4** | PH2 `custom-props.ts` @{}-in-NAME + `grammar.ts:96` `customPropInterp` single-leaf split | The single-leaf custom-prop NAME shape protects the **legacy/maintained BuilderHost** output, not only the less-compat bridge (grammar retirement note: *"when the legacy BuilderHost is retired, reorg A4"*). Splitting it carries an **unscoped legacy-builder custom-prop-NAME edit**. Gate is the **Jess ratchet / legacy-BuilderHost retirement (A4)**, not the ast/ differential alone. | **MEDIUM** — regate, not independent. |

### Blocked cluster (prerequisite grammar does NOT exist on `origin/dev`)

| # | cluster | blocker | risk |
|---|---|---|---|
| **S-Q3.3** | PH3 `import.ts:466`/`:478` TB-4 (`.includes('@{')`) + `value-leaf.ts:87` TB-5 (char-scan) | Both need the **§3.3 `Quoted` grammar structuring** (`Quoted` with an `Interp` child) — a prerequisite that is **unbuilt on `origin/dev`**. Cannot land independently now; land §3.3 first, then consume the `Interp` child. | **BLOCKED** — no-op until §3.3 exists. |

### Recommended order (corrected 2026-07-18)

1. **S1, S2, and the non-prelude subset of S3** first — low-risk, immediate grep-gate
   progress, no coupling. **This is the cleared subset now executing** (correction #7):
   agent `work/regex-kill-s1-s2-s3clean` is landing **S1 + S2 + non-prelude-S3** (with the
   `:349`/`:3227` `new Quoted` carve-outs deferred to S5), gated on **ast/ differential +
   Jess ratchet + core suite**.
2. **S4** shrinks to **only** `at-rules.ts:232` `@@name`→`VarIndirect`, and only after
   verifying the grammar already emits an indirect-var terminal. (PH2 + `customPropInterp` →
   S-A4; TB-4/TB-5 → S-Q3.3; neither is independent.)
3. **S-A4** (PH2 + `grammar.ts:96` split) lands **with the legacy-BuilderHost retirement at
   reorg A4** — it protects legacy BuilderHost output, so it is A4-gated, not ast/-gated.
4. **S-Q3.3** (`import.ts` TB-4 + `value-leaf.ts` TB-5) lands **after §3.3 `Quoted` grammar
   structuring is built** — blocked until then.
5. **S5 lands as part of #44's node-model migration commit** (the value-literal producer
   flip, footprint ≥ the enumerated list — see §5 FLOOR note). Do not start S5 standalone.
6. **S6 lands as part of the TB-3 query-prelude grammar split** (one coordinated
   `_buildAtRulePrelude` method-rewrite — see correction #1; higher-risk shape already
   committed in `TIER-B-INTERPOLATION-GRAMMAR-SPEC` §3.4).
7. Directory deletion: once S-A4 + S-Q3.3 + S5 + S6 consume structured children,
   `parse-host/**` has no remaining re-derivation and is deleted at reorg A4 (closes burndown
   0.a, 1.b, 2.b, 3.f/g/j/k, Cluster 7).

**Gate for every landing:** the ast/ differential
(`alpha-oracle-differential.test.ts` vs `alpha-oracle-baseline.json`) stays green.
Bridge byte-identity is NON-SACRED and repaired at the less-compat re-point (S4/S5 will
turn it red by construction). Final program DONE-criterion: the standing law grep is EMPTY
on the maintained path except the documented synthetic-bytes KEEP set
(`value-operate.ts` `CALC_WRAP_RE`, `literal-tag.ts` `NUM_RE`/`HEX_RE` until the `Numeric`
leaf emits a structured tag).
