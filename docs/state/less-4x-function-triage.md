# Less 4.x builtin functions vs jess — complete function-level triage

**Scope:** BUILT-IN FUNCTIONS ONLY. Language constructs (mixins, guards, `@import`,
detached rulesets) and the docs audit are separate lanes; anything noticed outside
this slice is parked in §8.

**jess side:** `origin/dev` @ `74b9fcb4d`, worktree `~/git/worktrees/jess-fn-triage`,
full ordered build (recognition → parsers → awaitable-pipe → core → fns → config →
style-resolver), all green.

**4.x reference:** `~/git/worktrees/less.js/less-4x` @ `97ddc62d718f71881fac88bf6e0e9938d26c419e`,
`@less/root` 4.8.1, READ-ONLY. **Not** `~/git/oss/less.js` — that checkout is the v5
alpha whose wrapper imports `jess`, i.e. jess measured against itself.

## 0. Relationship to `LESS-4X-FEATURE-TRIAGE.md`, and three corrections

A parallel lane landed
[`../architecture/core/LESS-4X-FEATURE-TRIAGE.md`](../architecture/core/LESS-4X-FEATURE-TRIAGE.md)
(`7d6f2c9c2`) covering Less features broadly, with a builtin-function section. That
doc is the feature-level entry point; this one is the function-level depth behind its
§2, and it goes past name presence to arity, argument handling, and per-call output.
Three of its function claims are corrected here, each measured:

1. **"89 builtins."** The 4.x runtime registry holds **92**
   (`functionRegistry.getLocalFunctions()`, 4.8.1). The three not in the 89 are
   `%`, `~` and `_self`.
2. **"`isurl` and `style` are the only 2 not reachable."** `style()` produces the
   **same output as 4.x** — `@v: 1; style(@v)` → `style(1)` in both — because verbatim
   preservation lands on 4.x's own result shape (§5). The genuine second absence is
   `_self` (§6). So the pair is `isurl` + `_self`, not `isurl` + `style`.
3. **Presence is not the coverage question.** Six functions that ARE present reject
   argument shapes 4.x accepts, five emit `NaN` into CSS, one rounds negative halves
   the other way, and two emit the wrong colour form (§4, §7). None of these are
   visible in a name-by-name check.

## 1. Method (so a re-run reproduces it)

1. The 4.x function set was taken from the **runtime registry**, not from docs and not
   from a directory listing: `functionRegistry.getLocalFunctions()` after loading
   `packages/less/lib/less-node/index.js`. **92 names.**
2. The jess set was taken from the **built artifact's** `lessFns`
   (`packages/fns/lib/index.js`), which is what `makeLessRegistry()` registers.
   **83 names.**
3. **Reachability was tested by calling each function the way a user writes it** and
   diffing the rendered CSS against `less.render()` from the 4.x checkout, same source
   string, in `a{…}`. 175 rendered cases across 5 batches. This is the part that
   matters: `registryOf()` keys on `fn.name`
   (`packages/core/src/ast/value-dispatch.ts:319`, `:323`), so an export alias proves
   nothing — only the string passed to `defineFunction` reaches the table.
4. Every jess case was rendered twice: default config and `functionMode: 'error'`,
   because the default swallows dispatch failures (§4).

## 2. Registry delta

`grep`-free set difference of the two enumerations:

| In 4.x, absent from jess's `lessFns` | Verdict |
| --- | --- |
| `if`, `boolean`, `isdefined`, `isruleset` | **IMPLEMENTED elsewhere** — core special-forms them: `LOGICAL_FNS` at `packages/core/src/ast/serialize.ts:4228`, dispatched `:4521`; `isdefined`/`isruleset` at `:4091`/`:4101`. All four verified working (§3). |
| `each` | **IMPLEMENTED elsewhere** — parsed as a language construct, `packages/syntax/less/less-parser/src/grammar.ts:4333` (`EachCallback`), `:4387`. Verified working. |
| `default` | **IMPLEMENTED elsewhere** — `packages/core/src/ast/serialize.ts:4487`, guard-scoped. Verified working in a real mixin guard. |
| `~` | **IMPLEMENTED elsewhere** — `~"…"` escaping is parser-level. `~(1, 2)` matches 4.x. |
| `style` | **DELIBERATELY-DIFFERENT / effectively equivalent** — see §5. |
| `isurl` | **MISSING.** See §6. |
| `_self` | **MISSING.** See §6. |

| In jess, absent from 4.x | Verdict |
| --- | --- |
| `string-format` | Intentional jess addition — `packages/fns/src/less/format.ts:60`, the sprintf spelling of `%`. `%` itself is still registered at `format.ts:67`. Both dispatch; verified. |

So: **90 of 92 4.x names are reachable in jess.** The two absent ones are `isurl` and
`_self`.

## 3. Per-function table

Status key: **OK** = call-verified byte-identical to 4.x; **OK\*** = call-verified,
differs from 4.x by a SETTLED v5 ruling (evidence column names the ruling);
**FIXED** = a previously recorded divergence now covered by a regression and a
named ledger row; **BUG** = call-verified divergence with no ruling behind it;
**MISSING** = does not dispatch.

`file:line` is the `defineFunction` site under `packages/fns/src/`.

### Math

| Fn | 4.x signature | Status | Evidence |
| --- | --- | --- | --- |
| `ceil` | `(n)` | OK | `shared/math/ceil.ts:4` — `ceil(2.4)`→`3` |
| `floor` | `(n)` | OK | `shared/math/floor.ts:4` — `floor(2.6)`→`2` |
| `abs` | `(n)` | OK | `shared/math/abs.ts:4` — `abs(-18%)`→`18%` |
| `sqrt` | `(n)` | OK / see §7-A | `less/sqrt.ts:6` — `sqrt(25cm)`→`5cm`; `sqrt(-4)`→`NaN` (bug) |
| `sin` | `(n)` | OK\* | `less/sin.ts:6` — `sin(1rad)`→`0.8414709848` vs 4.x `0.84147098` (V4) |
| `cos` | `(n)` | OK\* | `less/cos.ts:6` — same precision class |
| `tan` | `(n)` | OK\* | `less/tan.ts:6` — same |
| `asin` | `(n)` | OK\* / §7-A | `less/asin.ts:6` — `asin(-0.8)`→`-0.927295218rad`; `asin(2)`→`NaNrad` (bug) |
| `acos` | `(n)` | OK\* / §7-A | `less/acos.ts:4` — same shape |
| `atan` | `(n)` | OK\* | `less/atan.ts:6` — `atan(-1)`→`-0.7853981634rad` |
| `pi` | `()` | OK\* | `less/pi.ts:5` — `3.1415926536` vs 4.x `3.14159265` (V4) |
| `pow` | `(x, y)` | OK / §7-A | `less/pow.ts:6` — `pow(2,3)`→`8`; `pow(-1,0.5)`→`NaN` (bug) |
| `mod` | `(a, b)` | OK / §7-A | `less/mod.ts:6` — `mod(3,2)`→`1`; `mod(1,0)`→`NaN` (bug) |
| `percentage` | `(n)` | OK | `less/percentage.ts:6` — `percentage(0.5)`→`50%` |
| `round` | `(n, f=0)` | **BUG** | `less/round.ts:10` → `packages/core/src/ast/round.ts:12` uses `Math.round` (half toward +∞); 4.x uses `toFixed` (half away from zero). `round(-1.5)`→jess `-1`, 4.x `-2`. `round(-2.5)`→`-2` vs `-3`. `round(-1.55, 1)`→`-1.5` vs `-1.6`. Positive halves agree. See §7-B. |
| `min` | `(...)` | OK | `less/min.ts:5` — `min(5,1,3,2)`→`1`; incomparable units preserved verbatim, matching 4.x |
| `max` | `(...)` | OK | `less/max.ts:5` — `max(5,1,3,2)`→`5` |
| `convert` | `(val, unit)` | OK | `less/convert.ts:10` — `convert(9s,"ms")`→`9000ms`; incompatible unit returns input, matching 4.x |
| `unit` | `(val, unit?)` | OK (better) | `less/unit.ts:9` — `unit(5,px)`→`5px`; `unit(5px,"")`→jess `5`, 4.x emits invalid `5""`. jess is correct. |
| `get-unit` | `(n)` | OK | `less/get-unit.ts:10` — `get-unit(5px)`→`px` |

### Lists

| Fn | 4.x signature | Status | Evidence |
| --- | --- | --- | --- |
| `length` | `(list)` | OK | `less/length.ts:8` — `length(1px solid black)`→`3` |
| `extract` | `(list, i)` | OK | `less/extract.ts:12` — `extract(1px solid black, 2)`→`solid`; out-of-range and `0` both preserve verbatim, matching 4.x |
| `range` | `(start, end?, step?)` | OK | `less/range.ts:12` — `range(4)`→`1 2 3 4`; `range(1px,10px,3px)`→`1px 4px 7px 10px` |
| `each` | `(list, rs)` | OK | grammar `:4333` — `@value`/`@key`/`@index` all bind; list and detached-ruleset forms both verified |
| `_self` | `(n)` | **MISSING** | §6 |

### Logic / introspection

| Fn | 4.x signature | Status | Evidence |
| --- | --- | --- | --- |
| `if` | `(cond, t, f?)` | OK | `serialize.ts:4228`/`:4521` — lazy arms verified (`if(iscolor(@u), red(@u), 0)` does not evaluate the dead arm) |
| `boolean` | `(cond)` | OK | same — also verified feeding a mixin guard |
| `isdefined` | `(var)` | OK | `serialize.ts:4091` — defined→`true`, undefined→`false` |
| `isruleset` | `(v)` | OK | `serialize.ts:4101` |
| `default` | `()` | OK | `serialize.ts:4487` — verified in a real `when (default())` guard, both hit and miss |
| `iscolor` | `(v)` | OK | `less/types.ts:12` |
| `isnumber` | `(v)` | OK | `less/types.ts:18` |
| `isstring` | `(v)` | OK | `less/types.ts:24` |
| `iskeyword` | `(v)` | OK | `less/types.ts:30` |
| `isunit` | `(v, unit)` | OK | `less/types.ts:36` |
| `ispixel` | `(v)` | OK | `less/types.ts:44` |
| `ispercentage` | `(v)` | OK | `less/types.ts:50` |
| `isem` | `(v)` | OK | `less/types.ts:56` |
| `isurl` | `(v)` | **MISSING** | §6 |

### Strings

| Fn | 4.x signature | Status | Evidence |
| --- | --- | --- | --- |
| `e` | `(str)` | OK | `less/e.ts:5` — quoted, unquoted and `~"…"` inputs all match |
| `escape` | `(str)` | OK | `less/escape.ts:10` — `escape("a=b:c#d;e(f)g")` byte-identical |
| `replace` | `(s, pat, rep, flags?)` | OK | `less/replace.ts:20` — 3-arg and 4-arg (`"gi"`) both match |
| `%` | `(fmt, ...)` | OK | `less/format.ts:67` — `%s`/`%d`/`%a`, uppercase URI-encoding, `%%`, and extra-arg truncation all match |
| `~` | `(...)` | OK | parser-level |

### Colour — definition

| Fn | 4.x signature | Status | Evidence |
| --- | --- | --- | --- |
| `rgb` | `(r,g,b)` | OK\* | `less/rgb.ts:44`. 3-slot call emits authored bytes (`rgb(90, 129, 32)`) where 4.x emits `#5a8120` — **ledger F5, SETTLED**. Operated (`rgb(…) + #000001`) correctly computes `#5a8121`, so the fn is reachable. |
| `rgba` | `(r,g,b,a)` | OK\* | `less/rgba.ts:6` — same F5 rule |
| `hsl` | `(h,s,l)` | OK\* | `less/hsl.ts:62` — same F5 rule |
| `hsla` | `(h,s,l,a)` | OK\* | `less/hsla.ts:6` — same F5 rule |
| `hsv` | `(h,s,v)` | OK | `less/hsv.ts:10` — not CSS, so computed: `hsv(90,100%,50%)`→`#408000`. Degree hue verified. |
| `hsva` | `(h,s,v,a)` | OK | `less/hsva.ts:11` — `rgba(64, 128, 0, 0.5)` |
| `argb` | `(color)` | OK | `less/argb.ts:15` — `argb(rgba(90,23,148,.5))`→`#805a1794`; opaque input verified |
| `color` | `(string)` | OK | `less/color.ts:19` — keyword, 3-hex, 6-hex verified |

### Colour — channels

| Fn | Status | Evidence |
| --- | --- | --- |
| `hue` / `saturation` / `lightness` | OK | `less/hue.ts:6`, `less/saturation.ts:6`, `less/lightness.ts:6` |
| `hsvhue` / `hsvsaturation` / `hsvvalue` | OK | `less/hsvhue.ts:6`, `less/hsvsaturation.ts:6`, `less/hsvvalue.ts:6` |
| `red` / `green` / `blue` / `alpha` | OK | `shared/color/{red,green,blue,alpha}.ts:4` |
| `luma` / `luminance` | OK | `less/luma.ts:6`, `less/luminance.ts:6` — `21.26%`; alpha-weighted input verified |

### Colour — operations

| Fn | 4.x signature | Status | Evidence |
| --- | --- | --- | --- |
| `saturate` | `(c, amt, method?)` | OK | `less/saturate.ts:6` — absolute AND `relative` both match |
| `desaturate` | `(c, amt, method?)` | FIXED / V14 | `less/color-helper.ts` — clamps the written HSL channel; achromatic `#888`/`#999`, low-saturation, chromatic, and `relative` cases pinned |
| `lighten` | `(c, amt, method?)` | OK | `less/lighten.ts:6` — `#b3f075` |
| `darken` | `(c, amt, method?)` | OK | `less/darken.ts:6` — `#4d8a0f` |
| `fadein` | `(c, amt, method?)` | OK / §7-C | `less/fadein.ts:7` — `rgba(…,0.6)` matches; result saturating to alpha 1 emits `rgb(255, 0, 0)` where 4.x emits `#ff0000` |
| `fadeout` | `(c, amt, method?)` | OK | `less/fadeout.ts:7` |
| `fade` | `(c, amt)` | OK / §7-C | `less/fade.ts:7` — `fade(#80e619,50%)` matches; `fade(#f00,100%)` → `rgb(255, 0, 0)` vs `#ff0000` |
| `spin` | `(c, deg)` | OK | `less/spin.ts:7` — wraparound verified |
| `mix` | `(c1, c2, w=50%)` | OK | `less/mix.ts:7` — 2-arg default and `0%` edge verified |
| `tint` | `(c, amt)` | OK | `less/tint.ts:7` |
| `shade` | `(c, amt)` | OK | `less/shade.ts:7` |
| `greyscale` | `(c)` | OK | `less/greyscale.ts:6` |
| `contrast` | `(c, dark?, light?, thr?)` | OK | `less/contrast.ts:13` — 1-arg and 4-arg verified; non-colour first arg preserved verbatim, matching 4.x |

### Colour — blending (all `(c1, c2)`)

`multiply` `less/multiply.ts:9` · `screen` `less/screen.ts:9` · `overlay`
`less/overlay.ts:14` · `softlight` `less/softlight.ts:17` · `hardlight`
`less/hardlight.ts:10` · `difference` `less/difference.ts:9` · `exclusion`
`less/exclusion.ts:9` · `average` `less/average.ts:9` · `negation`
`less/negation.ts:9` — **all nine OK**, byte-identical to 4.x on `(#ff6600, #000000)`.

### IO / URL

| Fn | 4.x signature | Status | Evidence |
| --- | --- | --- | --- |
| `svg-gradient` | `(dir, ...stops)` | OK | `less/svg-gradient.ts:9` — the full 400-byte data-URI is byte-identical to 4.x |
| `data-uri` | `(mime?, path)` | OK | `less/data-uri.ts:12` — verified against a real 62-byte SVG (URI-encoded) and a real PNG (`;base64`), both byte-identical |
| `image-size` | `(path)` | OK | `less/image-size.ts:11` — real 2×3 PNG → `2px 3px` |
| `image-width` | `(path)` | OK | `less/image-width.ts:10` — `2px` |
| `image-height` | `(path)` | OK | `less/image-height.ts:10` — `3px` |
| `style` | `(...)` | see §5 | not registered; reaches the same output by verbatim preservation |

## 4. THE SYSTEMIC FINDING — arity and type rejection is silent by default

> **RECORDED AS A STANDING PROCESS RULE (2026-07-30).**
> **`functionMode: 'preserve'` is the DEFAULT, and the default mode CANNOT be used
> as a reachability test.** Under it, an arity rejection, a type rejection, an IO
> file-not-found, and an unknown CSS function all render as byte-identical preserved
> call text. There is no output difference to notice, so a registered-but-broken
> function and a genuine CSS passthrough are indistinguishable — that is exactly what
> hid the Sass `map-get`/`map-keys` non-dispatch. **Any future function audit MUST run
> under `functionMode: 'error'`**, and must say in its method section that it did.
> This is a rule about the audit, not a defect in `preserve`: `preserve` is the
> correct default for users. Note also that it does not catch everything even when
> enabled — see §7-A, where the function SUCCEEDED and returned a bad value.

**OBSERVATION.** `packages/core/src/ast/evaluator.ts:107-123`: when a name IS in the
registry but `dispatch` throws, the throw is caught and turned into
`fallbackCall(name, args)` (`:31`) — a keyword holding the verbatim call bytes. The
default is `functionMode: 'preserve'` (`packages/core/src/context.ts:251`).

**OBSERVATION.** That makes an arity/type rejection produce *the same output as an
unknown CSS function*. Measured, default config:

| call | jess default | jess `functionMode:'error'` | 4.x |
| --- | --- | --- | --- |
| `ceil(2.4, 9)` | `ceil(2.4, 9)` | `Invalid function call` | `3` |
| `unit(5, px, junk)` | `unit(5, px, junk)` | `Invalid function call` | `5px` |
| `pi(1)` | `pi(1)` | (accepted, `3.14…`) | `3.14159265` |
| `isunit(1rem)` | `isunit(1rem)` | `Invalid function call` | error |
| `unit(red, px)` | `unit(red, px)` | `Invalid function call` | error |
| `color("notacolor")` | `color("notacolor")` | `Invalid function call` | error |
| `greyscale(#f00, 1)` | `greyscale(#f00, 1)` | `Invalid function call` | `#808080` |
| `argb(#f00, 1)` | `argb(#f00, 1)` | `Invalid function call` | `#ffff0000` |
| `iscolor(#f00, 1)` | `iscolor(#f00, 1)` | `Invalid function call` | `true` |
| `tint(#f00)` | `tint(#f00)` | `Invalid function call` | `#ff8080` |
| `hsv(90,100%,50%,.5)` | verbatim | `Invalid function call` | `#408000` |
| `percentage(0.5, 1)` | verbatim | `Invalid function call` | `50%` |
| `multiply(#f00,#0f0,#00f)` | verbatim | `Invalid function call` | `#000000` |
| `totally-not-a-fn(1)` | verbatim | verbatim | verbatim |

**INTERPRETATION.** Two separate things fall out of this.

1. **jess is STRICTER than 4.x on excess arguments, and that is defensible** — 4.x
   silently drops them. But jess's stricter arity is *invisible* in the default
   config: the last row is indistinguishable from all the rows above it. This is the
   exact failure shape that hid the Sass `map-get`/`map-keys` non-dispatch: a
   registered-but-unreachable name and a mis-arity'd call both render as preserved
   bytes, and no fixture catches either. **The default mode cannot be used as a
   reachability test.** Every future fn audit must run `functionMode: 'error'`.
2. **jess REJECTS shapes 4.x accepts**, in cases where 4.x's leniency is arguably
   right: `greyscale(#f00, 1)`, `argb(#f00, 1)`, `iscolor(#f00, 1)` and
   `percentage(0.5, 1)` are excess-arg calls 4.x computes. `tint(#f00)` and
   `hsv(h,s,v,a)` are more interesting — 4.x has real defaults there. These are OWNER
   calls, not obvious bugs; they are listed so the decision is made rather than
   inherited.

Note that jess is also *more forgiving* than 4.x on the whole class of missing-arg
calls (`mod(3)`, `pow(2)`, `fade(#fff)`, `spin(#f00)`, `contrast()`, `range()`,
`svg-gradient()`, `convert(9s)`, `extract(1 2 3)`, `replace("a","b")`,
`multiply(#f00)`): 4.x throws a raw JS TypeError leak ("Cannot read properties of
undefined"), jess preserves. jess's behaviour is better here; 4.x's messages are
plainly unintended.

## 5. `style()`

`style` is NOT in jess's registry. 4.x (`lib/less/functions/style.js`) resolves its
argument as a variable and emits `style(<value>)`, returning `undefined` (→ CSS
passthrough) on any failure. jess reaches the same output by verbatim preservation
with variable bytes resolved: `@v: 1; x: style(@v)` → `style(1)` in **both**. The two
paths differ only in the error message for an undefined variable (jess `Name not
found`, 4.x `variable @nope is undefined`) — jess's is arguably the better outcome,
since `style()` in `@container style(--x: true)` is real CSS. **Classified
DELIBERATELY-DIFFERENT with no work needed**; it is recorded here so nobody
"implements" it and breaks the CSS `style()` passthrough.

## 6. The two genuinely MISSING functions

| Fn | 4.x | jess | What it needs |
| --- | --- | --- | --- |
| `isurl(v)` | `isa(n, URL)` → `true`/`false` | preserved verbatim: `isurl(url(a.png))` → `isurl(url(a.png))` | **Blocked by a design fact, not effort.** `packages/fns/src/less/types.ts:5` states it deliberately: `Url` is syntax, not a materialized `Value` tag, so once evaluated a `url(...)` is opaque and the predicate would have to sniff output bytes — which this layer must not do. Fixing it needs a `Url` value tag (or a `src`-carried marker) in the value domain, i.e. a core change. **There is no DESIGN-DECISIONS row for this**; it is an in-code comment only. Recommend an OPEN ledger row. |
| `_self(n)` | identity, `lib/less/functions/list.js:22` | preserved verbatim: `_self(1)` → `_self(1)` | 4.x's internal helper for `each()`, exposed by accident (registered by `addMultiple` over the list module). jess's `each` works without it. **Recommend NOT implementing**; record as intentional. |

## 7. Behavioural divergences with no ruling behind them

> **ALL FOUR RULED AND LANDED 2026-07-30** (`docs/architecture/core/DESIGN-DECISIONS.md`):
> §7-A → **V7** (SETTLED), §7-B → **V8** (OPEN, implemented on the defensible
> reading), §7-C → **V10** (SETTLED). The §4 rejections were also ruled: **V9**
> (OPEN) — five of the six are CORRECT rejections and were kept; `tint`/`shade`
> were a real gap and were fixed. §7-D is untouched and remains open.

### 6-A. `NaN` leaks into emitted CSS

**OBSERVATION**, default config, all five verified:

| call | jess | 4.x |
| --- | --- | --- |
| `sqrt(-4)` | `x: NaN` | error `Dimension is not a number.` |
| `asin(2)` | `x: NaNrad` | error |
| `acos(2)` | `x: NaNrad` | error |
| `pow(-1, 0.5)` | `x: NaN` | error |
| `mod(1, 0)` | `x: NaN` | error |

`functionMode: 'error'` does **not** catch these — the fn *succeeds* and returns a
`Dimension` whose number is `NaN`, so no throw reaches `evaluator.ts:113`. The output
is invalid CSS. **This is the highest-severity item in this triage.** 4.x's guard is
in `math-helper.js` (rejects a non-finite result); jess has no equivalent. Note the
fix is a policy choice — reject (4.x), or emit `0`, or preserve the call verbatim —
and it belongs with the numeric-emit owner (ledger V4), since `format-number.ts` is
the single output policy site.

**RESOLVED — ledger V7, SETTLED, landed 2026-07-30.** Reject. The guard went in at
`formatNumber` (`packages/core/src/ast/format-number.ts`), NOT in the five functions:
stated over the construct ("a computed number"), it covers every path that can ever
produce one, and it is free because the integer fast path has already returned for
every value a stylesheet really holds. `serializeDimension`'s `NaN`/`infinity`
spelling — which was the leak — is deleted. All five now fail the call, so
`functionMode` decides: default `preserve` renders `sqrt(-4)` verbatim, `error` says
`Invalid function call`. `1e400 + 1` is an arithmetic overflow rather than a call, so
it is a hard eval error with no `functionMode` fallback. Un-operated `1e999px` is
untouched (V1). Side effect: a non-finite `Dimension` is now unconstructible, which
deleted `extract`'s non-finite-index branch and the three `packages/fns` tests that
pinned the old spelling.

### 6-B. `round()` rounds negative halves the other way

`packages/core/src/ast/round.ts:12` uses `Math.round`, which is half-toward-`+∞`. 4.x
uses `Number.prototype.toFixed`, which is half-away-from-zero. Diverges only on exact
negative halves: `round(-1.5)` → `-1` vs `-2`; `round(-2.5)` → `-2` vs `-3`;
`round(-1.55, 1)` → `-1.5` vs `-1.6`. Positive values agree everywhere tested.

Not a precision-policy question — V4 governs *how many digits* a computed number gets,
not *which way a tie breaks*. Ledger has no row. **Needs an owner call**: CSS has no
opinion, Sass's `math.round` is half-away-from-zero, and `Math.round`'s asymmetry is a
JS artifact rather than a decision. jess's own `round.ts` header calls itself "the
ROUNDING KERNEL, not the output policy", which is exactly the right framing for
putting a tie rule in it.

**RESOLVED — ledger V8, OPEN row, implemented 2026-07-30.** Half-away-from-zero.
`round(-1.5)` → `-2`, `round(-2.5)` → `-3`, `round(-1.55, 1)` → `-1.6`, `round(-0.5)`
→ `-1`; positive values unchanged. The decisive argument is not 4.x parity but
self-consistency: `Math.round` makes the kernel disagree with itself under negation
(`round(-x) !== -round(x)` at every exact half). The lodash exponential-shift
algorithm is kept — only the tie call site changed — so the kernel still beats
`toFixed` on decimally-representable inputs. V4 is untouched: digits and tie
direction are independent. Colour quantization reads the same kernel but its inputs
are non-negative, so V5 is unaffected.

### 6-C. An alpha-adjusted colour that ends up opaque emits `rgb(...)`, not hex

`fade(#f00, 100%)` and `fadein(rgba(255,0,0,0.9), 50%)` → jess `rgb(255, 0, 0)`, 4.x
`#ff0000`. Also `fade(#f00, 150%)` (clamped).

Cause is two lines: `packages/fns/src/less/color-helper.ts:50` — `withAlpha` retags a
plain-hex input to `RGB` **unconditionally**, without checking whether the new alpha
is `1`; then `packages/core/src/ast/color.ts:149` emits `rgb(r, g, b)` for an `RGB`
colour at `a === 1`. `withAlpha`'s own docstring commits to "an opaque hex turns to
`rgba(…)` the moment it becomes translucent" — it does not address the reverse trip,
so this looks like an unconsidered case rather than a decision. Narrow, cosmetic, but
it is a computed colour (F5's verbatim rule does not apply) and every other computed
opaque colour in the corpus emits hex (`lighten` → `#b3f075`, `mix` → `#800080`).

**RESOLVED — ledger V10, SETTLED, landed 2026-07-30.** The retag now fires only when
the RESULT is translucent, which is the rule `mixColors` in the same file already
applied (`alpha < 1 ? RGB : c1.format`) — so this is one rule stated over the
construct, not a second special case. `fade(#f00, 100%)` and `fade(#f00, 150%)` now
emit `#ff0000`. `fadein(rgba(255,0,0,0.9), 50%)` still emits `rgb(255, 0, 0)`, NOT
4.x's `#ff0000`: the input's authored `rgb` family is provenance and survives, the
same way V1 keeps `1.0px`. That divergence is deliberate.

### 6-D. Missing-file IO errors are silent

`image-size("missing.png")` / `image-width` / `image-height` → jess preserves the call
verbatim; 4.x errors with the resolution paths tried. Same mechanism as §4 (the IO
throw is caught at `evaluator.ts:113`). `functionMode: 'error'` was not separately
measured for this case. Listed because "your icon-sizing broke and the CSS said
nothing" is a worse outcome than a compile error, and because the file-not-found case
is *not* an argument-shape rejection, which is what `preserve` was designed for.

## 8. Ledger / doc conflicts found

- **V2 vs F5 disagreed about a Less variable inside `rgb()` — RESOLVED 2026-07-30 by
  amending V2, the losing row.** V2 (SETTLED) said the Less fn runs "when the value is
  operated OR args are Less-non-CSS (contain a Less var/expr…)". F5 (SETTLED, later)
  says any 3+-slot `rgb`/`rgba`/`hsl`/`hsla` emits authored bytes, with no var
  exception. Measured: `@g: 129; x: rgb(90, @g, 32)` → `rgb(90, 129, 32)` — the var
  resolves to bytes and the call stays verbatim, i.e. **F5's reading**. **V2 was
  amended, not F5**, for a reason beyond "F5 is later and matches measurement": a
  resolved variable produces ordinary CSS bytes, so the construct is still valid CSS
  and V2's own premise (CSS-superset verbatim pass-through) covers it. The clause
  that survives in V2 is the historical-Less form, which is genuinely not CSS. F5
  keeps its narrower jurisdiction over the 3+-slot colour constructors.
- `isurl`'s absence is recorded only as a source comment. It should be an OPEN ledger
  row (§6). **Not done in this pass** — it needs a `Url` value tag, i.e. a core value-
  domain change, and is out of scope for the four function-layer defects.

## 9. What was NOT tested, and why

Stated explicitly, per the brief.

- **Nothing in the 92-name registry was skipped for reachability.** Every one of the
  92 was called in user spelling and its output compared to 4.x.
- **Not exhaustively fuzzed:** argument-shape coverage is representative, not
  complete. Each function got its canonical call plus, where cheap, one or two edge
  shapes (arity ±1, unit edges, out-of-domain). A function marked OK is OK *for the
  shapes listed in its evidence cell*, not proven total.
- **`data-uri` fallback modes not exhausted:** the >32KB inline-size fallback, the
  `--relative-urls`/rootpath interaction, and the ieCompat threshold were not
  exercised. Only the URI-encoded and `;base64` happy paths and the missing-file path.
- **`svg-gradient` tested with one direction and two stops.** Angle directions,
  3+ stops, and explicit stop positions were not tested.
- **`style()` inside a real `@container`/`@supports` prelude was not tested** — the
  parse of `style(--responsive: true)` fails in both engines at the value position
  I used, so the container-query position is unmeasured. Flagged for the
  language-construct lane.
- **`functionMode: 'error'` was measured only on batches 3–5** (the 68 cases where a
  default-mode divergence appeared). Batches 1–2 ran default only.
- **No timings.** Nothing here needs them.
- **Async/plugin-scoped shadowing of builtins was not tested** — `@plugin`-registered
  functions take priority (`evaluator.ts:100`) and that path is out of this slice.

## 10. Bottom line

Function coverage is in far better shape than the brief's priors suggested: 90 of
92 4.x names dispatch, and the four "special-formed" ones plus `each` and `default`
all work in their real positions. The two absences are `isurl` (blocked on a value-
domain `Url` tag — needs an OPEN ledger row) and `_self` (4.x's leaked internal;
recommend never implementing).

The real finding is not a missing function. It is that **`functionMode: 'preserve'`
makes an arity rejection, a type rejection, a file-not-found, and an unknown CSS
function all render as identical preserved bytes** — the same blind spot that hid the
Sass `map-get` non-dispatch, still wide open and still the default. Three
undocumented behavioural divergences sit inside it: `NaN` reaching emitted CSS from
five math functions (severe — invalid output, and `functionMode: 'error'` does not
catch it), `round()`'s negative-half tie direction, and `fade`/`fadein` emitting
`rgb(...)` for a result that came back opaque.
