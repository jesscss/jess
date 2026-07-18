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
**[BRIDGE-RELEASED]**.

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

| file:line | regex | classifies |
|---|---|---|
| `builders.ts:257` `/(?:^|[\s,])\.-?[_a-zA-Z]/` | class-selector-in-value detect (`_buildVarDeclaration`) |
| `builders.ts:281` `/^\s*\[([^\]]+)\]/` + `:306` `/^\s*\(\s*\)/` | accessor bracket / empty-call after value |
| `builders.ts:407` `/[#.][^#.>+~\s]*/g` | ns-accessor head segment split (`_buildNsAccessor`) |
| `builders.ts:1168,:1175,:1190,:1202` `/[#.][^#.]*/g` etc. | segment split in `_assembleSegment` / accessor decode |
| `builders.ts:2789` def `nsMediaRe` + `:2824` use; `:2830` `/[#.][^#.]*/g` | ns-media path split |
| `builders.ts:2842,:3189` `/^([.#][^\[\]()\s]+)(\[([^\]]*)\])?$/` | arg-ref `.mixin[key]` split |
| `builders.ts:3043` `/^[#.]-?[_a-zA-Z…]/`, `:3045` `/^[>+~|]$|^\|\|$/` | selector-head vs combinator classify |
| `builders.ts:3112` `/[#.][^#.]*/g` | segment split (namespace ref) |
| `builders.ts:3218` `/^\[([^\]]*)\]/` + `:3234,:3239` `/^\(\s*\)/` | accessor bracket / empty-call (2nd site) |
| `builders.ts:1039` `/^!?all$/` | extend `!all` flag (`_buildExtendTarget`) → (b) grammar `optional(flag)` child (pairs w/ PH `extend.ts` ALL_FLAG) |

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
| `at-rules.ts:232` `/^@@([A-Za-z_][\w-]*)$/u` | `@@name` indirect var | | (b) grammar indirect-var child · **[BRIDGE-RELEASED]** (generic at-rule, not query) |
| `at-rules.ts:235` `/@([A-Za-z_][\w-]*)/gu` + `:239` use | `@name` refs in prelude | | (b) prelude var leaves |

### Cluster PH2 — custom-props.ts interp-name re-tokenize  → (b), **[BRIDGE-RELEASED]**

| file:line | regex | classifies | note |
|---|---|---|---|
| `custom-props.ts:109` `/@\{\s*([^}]+?)\s*\}/g` + `:114` use | `@{…}` in custom-prop NAME | TB-1/TB-2 | **[BRIDGE-RELEASED]** — split `grammar.ts:96` `customPropInterp` into `--`+ident+`lessInterp` leaves, consume via `interpFromRegion`; the `--@{k}`→`--` regression that froze it is now an acceptable bridge red |

### Cluster PH3 — import.ts specifier / keyword / url re-derive  → (b), import subsystem + **[BRIDGE-RELEASED]**

| file:line | regex | classifies | note |
|---|---|---|---|
| `import.ts:296` `/\.css([?#].*)?$/` | `.css` extension test | | (c)/(b) — resolution domain, moves w/ import subsystem |
| `import.ts:450` def `IMPORT_KEYWORD_RE` + `:520` use | `@import`/`@-import`/`@-export` name | | (a) grammar already lexes `atKeyword`; consume typed keyword |
| `import.ts:484` `/^url\(\s*(.*?)\s*\)$/is` | `url(...)` unwrap | | (b) typed `url()` child |
| `import.ts:466` `.includes('@{')/'@@'` (TB-4, substring not regex) | interpolated-specifier detect inside `Quoted` | | **[BRIDGE-RELEASED]** — land §3.3 `Quoted` grammar structuring, read the `Interpolated` child |

### Related deferred host sites (not regex, tracked in burndown TB-4/TB-5, **[BRIDGE-RELEASED]**)

| file:line | what | note |
|---|---|---|
| `value-leaf.ts:87` `quotedInterp`/`quotedLeaf` (TB-5, char-scan) | `@{…}` inside quoted-string VALUE | consume §3.3 `Quoted` `Interp` child instead of re-scanning the leaf |
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
| **[BRIDGE-RELEASED]** (unblocked purely by the 2026-07-18 ruling) | **7** | PH2 `custom-props.ts` @{} (TB-1/TB-2, 1 site); PH3 `import.ts:466` TB-4; `value-leaf.ts` TB-5; PH1 `at-rules.ts:232` `@@name`; grammar-side `customPropInterp` split (`grammar.ts:96`); L2 `escapedStrRe` shared with bridge; L3 quoted-path shared re-tokenize |
| **[PRELUDE-SPLIT]** (need a real grammar query-prelude split — coverage gap, never bridge-coupled) | **~11** | L5 whole `_buildAtRulePrelude` cluster (6) + PH1 `at-rules.ts` query sites (`:203/:209/:235`, ~5). **TB-3.** Highest blast radius. |
| **PENDING #44** (node-construction shape depends on #44's final literal fields) | **~14** | all of L1 (4, Dimension/ratio) + L2 Quoted-constructing sites (5) + L3 path-`Quoted` (2) + L2 paren/operand (3). Cannot rewrite the builder's `new Dimension(...)`/`new Quoted(...)` until #44 fixes `type`+verbatim-image fields. |
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
| **S3** | L4 selector/ns-accessor/mixin-head re-split | (b) recurse over typed segment children | **MEDIUM** — many sites, but selector nodes are NOT in #44's value-literal set (structural `Complex`/`Compound`/`Simple`), so no #44 coupling. Guard with mixin/ns-accessor differential fixtures. |
| **S4** | PH2 + grammar `customPropInterp` split + PH1 `@@name` + PH3 TB-4 + `value-leaf.ts` TB-5 | (b) [BRIDGE-RELEASED] grammar interp-leaf split | **MEDIUM** — bridge byte-identity WILL go red (accepted); gate is ast/ differential (`--@{k}:…`, `@import "@{theme}.less"` must parse structurally). Independent of #44 (Interp is structural, not a value literal). |

### Coupled cluster (MUST land WITH #44)

| # | cluster | why coupled | risk |
|---|---|---|---|
| **S5** | L1 (Dimension/number/ratio) + L2 (var/escaped-str/quoted/paren/operand) + L3 quoted-path | Every site **constructs a value literal** (`Dimension`/`Quoted`) whose `type`+field shape is exactly what #44 redefines (verbatim image, PascalCase `type`, `Word` elimination). Relocating the grammar to emit `Dimension{value,unit}` / `Quoted` children AND rewiring the builder to map them is the same edit as #44's producer flip. Doing it twice = the double-rewrite the owner forbids. | **HIGH** — value path is the hot differential surface; verbatim-vs-canonicalized Dimension output (`1.0px`→`1.0px`) is a #44 semantic. Land `grammar.ts` value-terminal reshape + `builders.ts` L1/L2/L3 rewrite + `nodes.ts` literal reshape as ONE commit gated on the ast/ differential. |

### Coupled cluster (MUST land WITH the query-prelude grammar split — TB-3)

| # | cluster | why coupled | risk |
|---|---|---|---|
| **S6** | L5 `_buildAtRulePrelude` + PH1 query sites (`:203/:209/:235`) | Both are the builder/host twins of the SAME missing structured child: the media/supports/container prelude arrives as one opaque region. Neither can drop its regex until the grammar emits query-prelude leaves. Land the grammar prelude-split, then delete BOTH re-tokenizers in the same landing. | **HIGH** — ships wrong output today (`@media @{q}`); the fix changes real fixtures. Independent of #44 (prelude condition nodes are not value literals), so S6 and S5 are parallel coupled tracks, not nested. |

### Recommended order

1. **S1, S2** first (low-risk, immediate grep-gate progress, no coupling).
2. **S3, S4** next, in parallel (both MEDIUM, disjoint files — S3 selector/ns, S4 interp/
   custom-prop/import-specifier). S4 accepts bridge red.
3. **S5 lands as part of #44's node-model migration commit** (the value-literal producer
   flip). Do not start S5 standalone.
4. **S6 lands as part of the TB-3 query-prelude grammar split** (its own higher-risk shape,
   already committed in `TIER-B-INTERPOLATION-GRAMMAR-SPEC` §3.4).
5. Directory deletion: once S4+S5+S6 consume structured children, `parse-host/**` has no
   remaining re-derivation and is deleted at reorg A4 (closes burndown 0.a, 1.b, 2.b,
   3.f/g/j/k, Cluster 7).

**Gate for every landing:** the ast/ differential
(`alpha-oracle-differential.test.ts` vs `alpha-oracle-baseline.json`) stays green.
Bridge byte-identity is NON-SACRED and repaired at the less-compat re-point (S4/S5 will
turn it red by construction). Final program DONE-criterion: the standing law grep is EMPTY
on the maintained path except the documented synthetic-bytes KEEP set
(`value-operate.ts` `CALC_WRAP_RE`, `literal-tag.ts` `NUM_RE`/`HEX_RE` until the `Numeric`
leaf emits a structured tag).
