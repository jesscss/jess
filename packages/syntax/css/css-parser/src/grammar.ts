/**
 * CSS grammar. Combinators are imported `with { type: 'macro' }`, so the parseman
 * plugin compiles the whole grammar (CST capture + node construction) to flat JS
 * at build time; without the plugin the interpreter runs the identical tree.
 *
 * This file is JUST the grammar — terminals + the `cssGrammar` rule map. Every
 * capital rule is a structural `node(parser)`: parseman infers the rule key and
 * captures its terminals plus trivia. CSS exposes this grammar and its CST entry
 * only; dialect parsers compose it through their own direct construction paths
 * via `compose([cssGrammar, …])`.
 */
import {
  node, regex, literal, sequence, choice, many, oneOrMore, optional,
  not, noTrivia, scanTo, balanced, trivia, rules, expect, field, label
} from 'parseman' with { type: 'macro' };
import type { Combinator } from 'parseman';

/**
 * Self-reference shape for the {@link cssGrammar} factory. Every rule the
 * factory reaches through `g.<name>` is declared here as a `Combinator<unknown>`
 * so the factory lambda can be typed without `any` — the parseman `rules()`
 * signature annotates its own `self` parameter as `any`, so the concrete type
 * has to come from THIS annotation. The exported rule names (the factory
 * return) are a superset of these references; only the cross-referenced keys
 * need to appear here for `g.<x>` accesses to type-check.
 *
 * A dialect-prefixed name (`css…`) would be a defect per
 * `GRAMMAR-REVIEW-STANDARD.md` item 14 — these are undecorated because CSS is
 * the base dialect and shares these names with the dialects that compose on it.
 */
type CssGrammarSelf = {
  rw: Combinator<unknown>;
  Quoted: Combinator<unknown>;
  Num: Combinator<unknown>;
  Color: Combinator<unknown>;
  Paren: Combinator<unknown>;
  CalcCall: Combinator<unknown>;
  QueryFeature: Combinator<unknown>;
  QueryFunction: Combinator<unknown>;
  QueryInParens: Combinator<unknown>;
  QueryCondition: Combinator<unknown>;
  queryPrelude: Combinator<unknown>;
  Stylesheet: Combinator<unknown>;
  stylesheetBody: Combinator<unknown>;
  Ruleset: Combinator<unknown>;
  SelectorList: Combinator<unknown>;
  ComplexSelector: Combinator<unknown>;
  CompoundSelector: Combinator<unknown>;
  BasicSelector: Combinator<unknown>;
  simpleSelector: Combinator<unknown>;
  AttributeSelector: Combinator<unknown>;
  PseudoSelector: Combinator<unknown>;
  pseudoArg: Combinator<unknown>;
  Declaration: Combinator<unknown>;
  CustomDeclaration: Combinator<unknown>;
  declarationList: Combinator<unknown>;
  descriptorBody: Combinator<unknown>;
  keyframeSelector: Combinator<unknown>;
  KeyframeSelectorList: Combinator<unknown>;
  KeyframeBlock: Combinator<unknown>;
  keyframesBody: Combinator<unknown>;
  MarginAtRule: Combinator<unknown>;
  pageBody: Combinator<unknown>;
  FeatureValueBlock: Combinator<unknown>;
  fontFeatureValuesBody: Combinator<unknown>;
  valueList: Combinator<unknown>;
  valueSequence: Combinator<unknown>;
  value: Combinator<unknown>;
  parenBody: Combinator<unknown>;
  mathProduct: Combinator<unknown>;
  mathSum: Combinator<unknown>;
  calcBody: Combinator<unknown>;
  Dimension: Combinator<unknown>;
  numeric: Combinator<unknown>;
  Url: Combinator<unknown>;
  Call: Combinator<unknown>;
  anyValue: Combinator<unknown>;
  AtRuleBlock: Combinator<unknown>;
  AtRuleBlockTop: Combinator<unknown>;
  AtRuleStatement: Combinator<unknown>;
  ImportStatement: Combinator<unknown>;
  QueryAtRuleBlock: Combinator<unknown>;
  QueryAtRuleBlockTop: Combinator<unknown>;
  UnknownAtRuleBlock: Combinator<unknown>;
  atTokenStream: Combinator<unknown>;
  AtRulePreludeSegments: Combinator<unknown>;
};

/*
 * ---------------------------------------------------------------------------
 * Trivia + terminals — bare combinators; node() captures them automatically.
 *
 * Trivia (`rw`) is declared ONCE on the grammar via `rules({ trivia: rw }, …)`,
 * making it ambient in every rule: sequence/repeat read `ctx.trivia` dynamically
 * and a rule ref passes ctx straight through, so filler is skipped between terms
 * everywhere — including when a single rule is parsed on its own (incremental
 * parsing). No per-rule `parser({ trivia: rw }, …)` establishers are needed.
 * ---------------------------------------------------------------------------
 */

const ws = regex(/[ \t\n\r\f]+/);
const comment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const rw = trivia(oneOrMore(choice(
  label(
    'whitespace',
    ws
  ),
  label(
    'blockComment',
    comment
  )
)));

/**
 * CSS identifier. Starts with an ident-start code point (letter, non-ASCII, `_`),
 * optionally preceded by `-`; subsequent chars add digits and `-`.
 * Includes CSS escapes (\\hex / \\char). The escape tail is `[^\n\r\f]` (not
 * `[^\n]`): per §4.3.7 a `\` followed by a newline is NOT a valid escape, and a
 * newline is any of LF / CR / FF — so `\<CR>` and `\<FF>` are excluded too, same
 * as `\<LF>`. Shared verbatim by `basicSel` and `propName` below.
 * @see https://www.w3.org/TR/css-syntax-3/#ident-start-code-point
 * @see https://www.w3.org/TR/css-syntax-3/#ident-code-point
 * @see https://www.w3.org/TR/css-syntax-3/#consume-escaped-code-point
 */
const ident = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const basicSel = regex(/(?:[.#]?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\d+(?:\.\d+)?%|\*)/);
const combinator = choice(
  literal('||'),
  literal('>'),
  literal('+'),
  literal('~'),
  literal('|')
);
const pseudoColon = regex(/::?/);
const attrOp = regex(/[*~|^$]?=/);

/*
 * Only `i` / `s` are defined today; for forwards-compatibility any single ASCII
 * letter is accepted as an attribute-selector modifier (`[a=b c]`). A digit,
 * underscore, or other non-letter is still rejected.
 * @see https://www.w3.org/TR/selectors-4/#attribute-case
 */
const attrMod = regex(/[a-zA-Z]/);
const nth = regex(/even|odd|[-+]?\d*n(?:[ \t\n\r\f]*[+-][ \t\n\r\f]*\d+)?|[-+]?\d+/i);

/*
 * Same pattern as shared-value-rules.ts `singleStr`/`doubleStr` — local so the macro
 * can statically evaluate regex(); `\\` + newline is valid CSS line continuation.
 */
const singleStr = regex(/'(?:[^'\\]|\\[\s\S])*'/);
const doubleStr = regex(/"(?:[^"\\]|\\[\s\S])*"/);
const customProp = regex(/--[-_a-zA-Z0-9\u0080-\uffff]*/);
const atKeyword = regex(/@-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const numPart = regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)/);

/*
 * A dimension unit or `%`, collapsed to one regex (read as a single leaf). A `-`
 * inside the unit must NOT be followed by a digit: `17px-1px` is `17px` minus
 * `1px` (arithmetic), NOT a `17` with unit `px-1px`. Without the `-(?![0-9])`
 * guard the unit ident greedily swallows `-1px`, hiding the subtraction (Less
 * 4.x tokenizes the `-` as an operator here -> `16px`). A `-` before a LETTER
 * stays in the unit.
 */
const unitRegex = regex(/-?[_a-zA-Z\u0080-\uFFFF](?:[_a-zA-Z0-9\u0080-\uFFFF]|-(?![0-9]))*|%/);
const urlOpen = regex(/url\(/i);

/**
 * The unquoted `<url-token>` body — `( url-code-point | escape )+` per
 * consume-a-url-token. A url code point is any code point EXCEPT `"` `'` `(` `)`,
 * whitespace (tab U+0009, newline U+000A, form-feed U+000C, CR U+000D, space
 * U+0020), a non-printable (U+0000–08, U+000B, U+000E–1F, U+007F), and `\`; a `\`
 * begins an escaped code point (§4.3.7): `\` + 1–6 hex digits with one optional
 * trailing whitespace terminator (`\41 ` → `A`), OR `\` + any single non-newline
 * code point. The hex form's trailing-whitespace terminator is consumed as part
 * of the escape, so `url(a\41 b)` stays ONE token (the space after `\41` is the
 * escape terminator, not a token break) — the same escape idiom `ident` uses.
 * Note this deliberately EXCLUDES `(` (a `(` inside the body is a bad-url-token)
 * and non-printables, while INCLUDING Unicode spaces such as U+00A0 (which are
 * valid url code points — `\s` would wrongly strip them).
 * @see https://www.w3.org/TR/css-syntax-3/#consume-url-token
 * @see https://www.w3.org/TR/css-syntax-3/#consume-escaped-code-point
 */
const urlInner = regex(/(?:[^"'()\\ \t\n\f\r\x00-\x08\x0B\x0E-\x1F\x7F]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);
const anyValueTok = regex(/[+\-*/=<>|~^]+|[^\s;{}\[\]()'",!]+/);

/*
 * ---------------------------------------------------------------------------
 * Grammar — direct Parseman rules (node() → AST node, plain
 * combinator → its terminals bubble into the nearest enclosing node()).
 * ---------------------------------------------------------------------------
 */

export const cssGrammar = rules(
  { trivia: rw, scanSkip: [singleStr, doubleStr] },
  (g: CssGrammarSelf) => {
  /*
   * ── Stylesheet ────────────────────────────────────────────────────────────
   * Two structural FRAMES model the CSS "two starting points" (CSS Syntax):
   * • Frame 1 — `stylesheetBody`: a run of qualified rules + at-rules, NO bare
   * declarations. Used by the root Stylesheet, `@layer`, and the
   * conditional-group at-rules when NOT nested.
   * • Frame 2 — `declarationList`: declarations INTERLEAVED with nested rules
   * and at-rules (CSS Nesting). Used by every style rule's `{ }` and by
   * conditional-group at-rules when nested.
   * The frames differ ONLY in their BODY content model (bare declarations). The
   * selector grammar is SHARED: `&` is valid in both frames, because a top-level
   * `&` is valid CSS — it resolves to `:scope` (CSS Nesting / MDN). SCSS/Jess
   * override the selector/body rules to keep rejecting a top-level `&`.
   * No catch-all arm: input that matches no rule simply stops `many`, leaving
   * unconsumed input the driver reports as one syntax error; required closers are
   * wrapped in expect() so a missing one is reported (and recovered) by parseman.
   */
    /**
   * The stylesheet root: frame-1 content (qualified rules + at-rules, no bare
   * declarations).
   * @see https://www.w3.org/TR/css-syntax-3/#parse-stylesheet
   */
    const Stylesheet = node(g.stylesheetBody);

    /**
   * Frame 1 — the top-level content model: conditional-group / known / unknown
   * at-rules and qualified rules. NO bare declarations (a declaration at the root
   * has no owning rule). Referenced by the root Stylesheet and every frame-1
   * at-rule body (`@layer`, top-level `@media` …).
   * @see https://www.w3.org/TR/css-syntax-3/#consume-list-of-rules
   */
    const stylesheetBody = many(choice(
      g.QueryAtRuleBlockTop,
      g.AtRuleBlockTop,
      g.ImportStatement,
      g.AtRuleStatement,
      g.UnknownAtRuleBlock,
      g.Ruleset
    ));

    /* ── Rulesets ─────────────────────────────────────────────────────────────── */
    /**
   * A qualified rule: a selector list + a frame-2 body. Used both at the top
   * level and nested — a top-level `&` is valid CSS (`:scope`), so the selector
   * grammar is shared and no separate nested variant is needed. A rule's `{ }` is
   * a nesting context, so its body is `declarationList`.
   * @see https://www.w3.org/TR/css-syntax-3/#qualified-rule
   */
    const Ruleset = node(sequence(
      g.SelectorList,
      literal('{'),
      g.declarationList,
      expect(
        literal('}'),
        '}'
      )
    ));

    /* ── Selectors ──────────────────────────────────────────────────────────────── */
    /**
   * A comma-separated list of complex selectors.
   * @see https://www.w3.org/TR/selectors-4/#selector-list
   */
    const SelectorList = node(sequence(
      g.ComplexSelector,
      many(sequence(
        literal(','),
        g.ComplexSelector
      ))
    ));

    /**
   * Compound selectors joined by combinators (descendant is the implicit
   * whitespace combinator).
   * @see https://www.w3.org/TR/selectors-4/#complex
   */
    const ComplexSelector = node(sequence(
      g.CompoundSelector,
      many(sequence(
        optional(combinator),
        g.CompoundSelector
      ))
    ));

    /**
   * A run of simple selectors with no combinator between them.
   * @see https://www.w3.org/TR/selectors-4/#compound
   */
    const CompoundSelector = node(oneOrMore(g.simpleSelector));

    /**
   * A class / id / type / universal simple selector (`.a`, `#a`, `div`, `*`).
   * @see https://www.w3.org/TR/selectors-4/#simple
   */
    const BasicSelector = node(basicSel);

    /**
   * A simple selector — attribute / pseudo / `&` / basic. `&` is the CSS nesting
   * selector (the parent reference); at the top level it resolves to `:scope`, so
   * it is valid in every frame.
   * @see https://www.w3.org/TR/selectors-4/#simple
   * @see https://www.w3.org/TR/css-nesting-1/#nest-selector
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Nesting_selector
   */
    const simpleSelector = choice(
      g.AttributeSelector,
      g.PseudoSelector,
      literal('&'),
      g.BasicSelector
    );

    /**
   * An attribute selector `[name]` / `[name op value mod]`.
   * @see https://www.w3.org/TR/selectors-4/#attribute-selectors
   */
    const AttributeSelector = node(sequence(
      literal('['),
      field(
        'name',
        ident
      ),
      optional(sequence(
        field(
          'op',
          attrOp
        ),
        field(
          'value',
          choice(
            singleStr,
            doubleStr,
            ident
          )
        ),
        optional(field(
          'mod',
          attrMod
        ))
      )),
      literal(']')
    ));

    /**
   * A pseudo-class / pseudo-element selector, with an optional `( … )` argument.
   * @see https://www.w3.org/TR/selectors-4/#pseudo-classes
   */
    const PseudoSelector = node(sequence(
      pseudoColon,
      ident,
      optional(sequence(
        literal('('),
        g.pseudoArg,
        literal(')')
      ))
    ));

    /**
   * Pseudo argument. `:nth-child(An+B of S)` — the `of <selector-list>` form:
   * without consuming the `of S`, `nth` would match just `An+B` and the choice
   * would commit, leaving the outer `)` to fail. Selector arguments use the same
   * `SelectorList`, which accepts `&` inside `:is(&)` / `:not(&)`. The last arm
   * scans to `)` for arbitrary args, skipping balanced ()/[], strings, and
   * comments so an inner `)` doesn't close it early.
   * @see https://www.w3.org/TR/selectors-4/#the-nth-child-pseudo
   */
    const pseudoArg = choice(
      sequence(
        nth,
        optional(sequence(
          regex(/of(?![-\w])/i),
          g.SelectorList
        ))
      ),
      g.SelectorList,
      scanTo(
        literal(')'),
        { skip: [balanced(
          '(',
          ')'
        ), balanced(
          '[',
          ']'
        ), singleStr, doubleStr, comment] }
      )
    );

    /* ── Declarations ───────────────────────────────────────────────────────── */
    /**
   * Frame 2 — a rule body. With CSS Nesting it interleaves declarations with
   * nested rulesets (`Ruleset`) and nested at-rules, plus empty `;` statements.
   * What distinguishes this from frame 1 is that it admits BARE declarations; the
   * selector grammar (including `&`) is now shared, so the `&`-aware distinction
   * is gone — frames differ only in body content. Less/Scss/Jess override this
   * rule wholesale with their own body.
   * @see https://www.w3.org/TR/css-nesting-1/#syntax
   */
    const declarationList = many(choice(
      g.QueryAtRuleBlock,
      g.AtRuleBlock,
      g.AtRuleStatement,
      g.UnknownAtRuleBlock,
      g.Declaration,
      g.CustomDeclaration,
      g.Ruleset,
      literal(';')
    ));

    /**
   * `!important`. Keyword is ASCII case-insensitive; trivia between `!` and the
   * keyword is allowed (the grammar's ambient trivia skips it).
   * @see https://www.w3.org/TR/css-cascade-4/#importance
   */
    const important = sequence(
      literal('!'),
      regex(/important/i)
    );

    /**
   * Property name. Standard names are idents; we also accept a leading `*` for the
   * legacy IE7 star-hack (`*color: …`). `*` is NOT an ident-start code point and
   * "would not start an identifier", so it is genuinely non-conformant — valid only
   * as a hack. (`_prop`, the IE6 underscore hack, is just an ordinary ident: `_` IS
   * an ident-start code point, so no special handling.) When legacyMode lands, an
   * `off` setting should report-and-recover on `*`, not silently accept.
   * @see https://www.w3.org/TR/css-syntax-3/#would-start-an-identifier
   * @see https://www.w3.org/TR/css-syntax-3/#ident-start-code-point
   */
    const propName = regex(/\*?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);

    /*
     * A value immediately followed by `{` is not a declaration but a nested
     * ruleset whose selector looks declaration-like (`a:hover { … }`) — CSS
     * Nesting's declaration-vs-rule ambiguity. The `not('{')` guard rejects the
     * declaration parse so the enclosing choice falls through to `Ruleset`.
     */
    const Declaration = node(sequence(
      propName,
      literal(':'),
      g.valueList,
      not(literal('{')),
      optional(important),
      optional(literal(';'))
    ));

    /**
   * Custom property (`--foo: …`). Its value is a near-arbitrary declaration-value
   * token stream with balanced (), [], {} — scanned to the terminating `;`/`}`,
   * skipping balanced groups intact (parseman balanced() counts nested-pair depth).
   * @see https://www.w3.org/TR/css-variables-1/#defining-variables
   */
    const CustomDeclaration = node(sequence(
      customProp,
      literal(':'),
      scanTo(
        choice(
          literal(';'),
          literal('}')
        ),
        { skip: [balanced(
          '(',
          ')'
        ), balanced(
          '[',
          ']'
        ), balanced(
          '{',
          '}'
        )] }
      ),
      optional(literal(';'))
    ));

    /* ── Values ─────────────────────────────────────────────────────────────── */
    /**
   * A comma-separated list of value sequences (a declaration's full value).
   * @see https://www.w3.org/TR/css-values-4/#component-whitespace
   */
    const valueList = sequence(
      g.valueSequence,
      many(sequence(
        literal(','),
        g.valueSequence
      ))
    );

    /**
   * A whitespace-separated sequence of values.
   * @see https://www.w3.org/TR/css-values-4/#component-whitespace
   */
    const valueSequence = oneOrMore(g.value);

    /**
   * A single value component.
   * @see https://www.w3.org/TR/css-values-4/#component-types
   */
    const value = choice(
      g.numeric,
      g.Color,
      g.Url,
      g.Call,
      g.Paren,
      g.Quoted,
      g.anyValue
    );

    /*
   * ── Math expressions ───────────────────────────────────────────────────────
   * CSS does arithmetic ONLY inside `calc()` (and the parens nested in it), so these
   * rules are reached only via `CalcCall` and the calc-nested `calcParen`, never the
   * top-level `valueSequence` NOR the general bare `Paren` (which stays permissive —
   * a bare `(pixelradius=2)` in a legacy IE `filter` is not math). Precedence lives
   * in the grammar (`* / %` over `+ -`, left-assoc); `collapse` passes a single
   * operand through, and the build folds the flat children into Operation nodes (see
   * _buildOperation). `/` divides here (calc is a math context).
   */
    const prodOp = regex(/[*\/%]/);

    /*
   * `+`/`-` operator: standalone (space/non-number after) OR glued with no space
   * before (`1+2`). `1 +2` (space before, glued) is a separate signed operand.
   */
    const sumOp = regex(/[-+](?![0-9.])|(?<=\S)[-+](?=[0-9.])/);

    /*
   * A math operand is a value whose nested parens fold (calcParen), unlike the
   * general permissive `Paren`. Everything else matches the ordinary value set.
   */
    /** A math-context parenthesized sub-expression (folds). @see https://www.w3.org/TR/css-values-4/#calc-syntax */
    const calcParen = node(
      'Paren',
      sequence(
        literal('('),
        g.mathSum,
        expect(literal(')'))
      )
    );

    // A calc-scoped catch-all value token. Unlike the general `anyValue` (which
    // matches an operator-run — `[+\-*/=<>|~^]+` — as its FIRST alternative), a calc
    // value must not be a bare operator run: in `calc(...)` those characters are
    // ONLY operators (handled by `sumOp`/`prodOp`), never operands, so a lone `+` /
    // `*` is not a <calc-value> (css-values-4 §10). Excluding the operator chars
    // from the leaf keeps `calc(+)` / `calc(*)` from matching an operator as a value
    // (they now fail the required <calc-value> and error). Non-operator keyword
    // operands (`pi`, `e`, `infinity`) still match, so valid calc is unchanged; the
    // global `anyValue` used by ordinary values is untouched.
    const calcAnyTok = regex(/[^\s;{}[\]()'",!+\-*\/=<>|~^]+/);
    const calcValue = choice(
      g.numeric,
      g.Color,
      g.Url,
      g.Call,
      calcParen,
      g.Quoted,
      calcAnyTok
    );

    /** A `* / %` product level (left-assoc), folded into an Operation. @see https://www.w3.org/TR/css-values-4/#calc-syntax */
    const mathProduct = node(
      'Operation',
      sequence(
        calcValue,
        many(sequence(
          prodOp,
          calcValue
        ))
      ),
      undefined,
      { collapse: true }
    );

    /** A `+ -` sum level (left-assoc), folded into an Operation. @see https://www.w3.org/TR/css-values-4/#calc-syntax */
    const mathSum = node(
      'Operation',
      sequence(
        g.mathProduct,
        many(sequence(
          sumOp,
          g.mathProduct
        ))
      ),
      undefined,
      { collapse: true }
    );

    /**
   * A dimension — a number immediately followed by a unit or `%` (`10px`, `50%`).
   * `noTrivia` forbids whitespace between number and unit, so `1 px` / `1 %` stay a
   * bare number plus a separate token rather than gluing into a Dimension.
   * @see https://www.w3.org/TR/css-values-4/#dimensions
   */
    const Dimension = node(noTrivia(sequence(
      numPart,
      unitRegex
    )));

    /**
   * Unified numeric leaf: parse the number ONCE, then continue into the unit only
   * if it is present — no Dimension→Num backtrack. The build host turns a
   * unit-present match into a `Dimension` and a unit-absent match into a `Num`, so
   * downstream node types/fields are identical to the split `Dimension`/`Num` rules.
   */
    const numeric = node(
      'Numeric',
      noTrivia(sequence(
        numPart,
        optional(unitRegex)
      ))
    );

    /**
   * A `url()` value with an optional quoted or unquoted body.
   *
   * `url(` COMMITS: once the token opens, the closing `)` is `expect`ed rather
   * than a plain `literal`, so the rule can no longer fail-and-backtrack into the
   * generic `Call` arm. That matters for the unquoted (url-token) body: a
   * `<url-token>` may not contain interior whitespace (css-syntax-3 §4.3.6 —
   * `url(foo bar)` is a `<bad-url-token>`), so after the body run the next char
   * must be `)`; `url(foo bar)` now reports a hard error at `bar` instead of the
   * `Call` arm silently swallowing `foo bar`. The quoted body (`url("a b")`) is
   * the function form, where the string may hold whitespace; leading/trailing
   * whitespace (`url( foo )`) and the empty `url()` stay valid (ambient trivia).
   * @see https://www.w3.org/TR/css-syntax-3/#consume-url-token
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/url_function
   */
    const Url = node(sequence(
      urlOpen,
      optional(choice(
        singleStr,
        doubleStr,
        urlInner
      )),
      expect(
        literal(')'),
        ')'
      )
    ));

    /**
   * A function-call argument list — a PERMISSIVE value list (`rgb(255 0 0)`,
   * `min(1px, 2px)` are space / comma lists, not math expressions).
   * @see https://www.w3.org/TR/css-values-4/#functional-notation
   */
    const parenBody = sequence(
      optional(g.valueList),
      literal(')')
    );

    /**
   * `calc(…)` OR a generic function call OR a bare ident, as ONE node so a generic
   * call/ident no longer pays a separate `calc(` node frame ahead of it. The calc
   * arm (its body is ONE math expression — the only place plain CSS folds operators)
   * is tried first so `calc(` routes to math; everything else parses the ident once
   * and takes the call-args tail only when `(` follows. `_buildCall` returns a Call
   * node when args are present, otherwise the bare ident string — identical for both
   * arms (calc built exactly as the old `CalcCall` did).
   * @see https://www.w3.org/TR/css-values-4/#functional-notation
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/calc
   */
    const Call = node(choice(
      sequence(
        regex(/calc(?=\()/i),
        literal('('),
        g.calcBody
      ),
      sequence(
        ident,
        optional(sequence(
          literal('('),
          g.parenBody
        ))
      )
    ));

    /**
   * `calc(…)` body — ONE math expression (the only place plain CSS folds
   * operators). Matched before the generic `Call` so `calc(` routes here.
   *
   * The `<calc-sum>` is REQUIRED (css-values-4 §10 — a `<calc-sum>` needs ≥1
   * `<calc-value>`), so it is `expect`ed: an empty `calc()` or a lone-operator
   * `calc(+)` produces no `<calc-value>`, and rather than the calc arm failing and
   * backtracking into the generic `Call` arm (which would silently accept
   * `calc()` / `calc(+)` as an ordinary function call), `expect` commits the
   * `calc(` open and reports the missing value in place. Well-formed calc is
   * unchanged — `mathSum` matches and `expect` passes straight through.
   * @see https://www.w3.org/TR/css-values-4/#calc-func
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/calc
   */
    const calcBody = sequence(
      expect(
        g.mathSum,
        'calc value'
      ),
      expect(literal(')'))
    );

    /*
   * `CalcCall` (calc(…)) and the general value-position `Paren` come from the shared
   * `parenRules` fragment (spread below) — they defer to g.calcBody / g.parenBody here.
   * `Quoted` likewise comes from the `stringRules` fragment.
   */
    /**
   * A catch-all value token — non-ident value tokens only (ident-led values are
   * handled by `Call`). Keeps unmodeled value syntax structurally representable.
   * @see https://www.w3.org/TR/css-syntax-3/#component-value
   */
    const anyValue = anyValueTok;

    /*
   * ── At-rule query preludes (@media / @container / @supports) ────────────────
   * The condition sub-grammar (QueryFeature / QueryInParens / QueryCondition /
   * queryPrelude) comes from the shared `queryRules` fragment (spread below) — it is
   * identical across css & less. Only the block wrapper differs, so it stays here and
   * reads `g.queryPrelude` from the fragment.
   * @see https://www.w3.org/TR/mediaqueries-5/#mq-syntax
   */
    const queryAtKeyword = regex(/@(?:media|container|supports)(?![-\w])/i);

    /**
   * A conditional-group at-rule with a structured query prelude, NESTED inside a
   * style rule: the group is TRANSPARENT, so its body is the ambient frame 2
   * (`declarationList` — declarations apply to the enclosing rule, plus nested
   * rules/at-rules).
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_conditional_rules
   */
    const QueryAtRuleBlock = node(sequence(
      queryAtKeyword,
      g.queryPrelude,
      literal('{'),
      g.declarationList,
      expect(
        literal('}'),
        '}'
      )
    ));

    /**
   * The TOP-LEVEL conditional-group at-rule: same transparency, but the ambient
   * frame is frame 1 (`stylesheetBody`) — a bare declaration at the root has no
   * owning rule, so it is rejected/recovered. Built as `QueryAtRuleBlock` so the
   * AST/CST is unchanged.
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_conditional_rules
   */
    const QueryAtRuleBlockTop = node(
      'QueryAtRuleBlock',
      sequence(
        queryAtKeyword,
        g.queryPrelude,
        literal('{'),
        g.stylesheetBody,
        expect(
          literal('}'),
          '}'
        )
      )
    );

    /* ── At-rules ─────────────────────────────────────────────────────────────── */
    /**
   * A generic at-rule prelude is a grammar-owned token stream, never a later
   * whitespace split of one opaque scan. A token is a maximal top-level run;
   * balanced groups and strings remain one segment, while top-level commas stay
   * explicit. This keeps every segment spanned and lets the AST retain quoted,
   * nested, and future interpolation-bearing syntax without recognizing it again
   * in a builder.
   *
   * The `comment` stop makes a trailing comment ambient trivia rather than a
   * prelude byte. Parseman records it against the adjacent typed segment.
   * @see https://www.w3.org/TR/css-syntax-3/#consume-at-rule
   */
    const atPreludeStop = choice(
      ws,
      comment,
      literal(','),
      literal('{'),
      literal(';')
    );
    const atPreludeToken = node(
      'AtPreludeToken',
      sequence(
        not(atPreludeStop),
        scanTo(
          atPreludeStop,
          { skip: [balanced(
            '(',
            ')'
          ), balanced(
            '[',
            ']'
          ), singleStr, doubleStr] }
        )
      )
    );
    const atPreludeTokens = many(choice(
      node(
        'AtPreludeToken',
        literal(',')
      ),
      atPreludeToken
    ));

    /**
   * Lossless at-rule-prelude segments for canonical AST reduction. `atPreludeTokens`
   * remains the CST production; the public AST parser must use these segments
   * directly rather than scan or split source text again.
   *
   * The outer `noTrivia` is essential.  Header whitespace and comments are
   * syntax here, not ambient filler, so every byte before `{`/`;` has exactly
   * one segment owner.  Balanced groups and quoted strings stay atomic; an
   * escaped delimiter stays in a text segment rather than opening a new one.
   * This is static CSS structure only: Less/SCSS interpolation must supply its
   * own typed alternatives before any text/group arm and must not attach this
   * primitive as a generic dialect prelude transport.
   */
    const AtPreludeWhitespace = node(
      'AtPreludeWhitespace',
      noTrivia(ws)
    );
    const AtPreludeComment = node(
      'AtPreludeComment',
      noTrivia(comment)
    );
    const AtPreludeComma = node(
      'AtPreludeComma',
      noTrivia(literal(','))
    );
    const AtPreludeGroup = node(
      'AtPreludeGroup',
      noTrivia(choice(
        balanced(
          '(',
          ')',
          { skip: [singleStr, doubleStr, comment] }
        ),
        balanced(
          '[',
          ']',
          { skip: [singleStr, doubleStr, comment] }
        )
      ))
    );
    const AtPreludeQuoted = node(
      'AtPreludeQuoted',
      noTrivia(choice(
        singleStr,
        doubleStr
      ))
    );
    const atPreludeText = regex(/(?:\\[\s\S]|\/(?!\*)|[^\\/ \t\n\r\f,;{}()[\]"'])+/);
    const AtPreludeText = node(
      'AtPreludeText',
      noTrivia(atPreludeText)
    );
    const AtRulePreludeSegments = node(
      'AtRulePreludeSegments',
      noTrivia(many(choice(
        AtPreludeWhitespace,
        AtPreludeComment,
        AtPreludeComma,
        AtPreludeGroup,
        AtPreludeQuoted,
        AtPreludeText
      )))
    );

    /*
   * Statement at-rules retain their compact string-backed contract for now. They
   * do not split that scan in a builder; block at-rules below use the structured
   * token stream because their former builder did exactly that. Keep this seam
   * explicit so the remaining statement representation can be migrated without
   * silently changing its public AST shape.
   */
    const atTailTrivia = many(choice(
      ws,
      comment
    ));
    const atPreludeScan = scanTo(
      sequence(
        atTailTrivia,
        choice(
          literal('{'),
          literal(';')
        )
      ),
      {
        skip: [balanced(
          '(',
          ')'
        ), balanced(
          '[',
          ']'
        ), singleStr, doubleStr]
      }
    );
    const atPrelude = optional(atPreludeScan);

    /*
   * A REQUIRED prelude: the scan must consume at least one non-trivia char before the
   * `{`/`;`. `not(...)` asserts we are not sitting directly on the delimiter (after
   * ambient trivia), so an empty prelude fails; `expect` then reports the missing
   * prelude and RECOVERS IN PLACE (zero-width) so the enclosing block still parses —
   * rather than the rule failing and the at-rule falling through to the opaque
   * UnknownAtRuleBlock (which would silently accept the empty prelude).
   */
    const notDelim = not(choice(
      literal('{'),
      literal(';')
    ));
    const reqQueryPrelude = expect(
      sequence(
        notDelim,
        atPreludeTokens
      ),
      'query'
    );
    const reqImportPrelude = expect(
      sequence(
        notDelim,
        atPreludeScan
      ),
      'import path'
    );

    /*
   * `@supports` is stricter than `@media`/`@container`: its prelude is a
   * `<supports-condition>` (css-conditional-3 §2), which — unlike a media/container
   * query — has NO bare form. It must OPEN with `(`, the `not` keyword, or a
   * `<function-token>` (an ident glued to `(`, e.g. `selector(…)` /
   * `<general-enclosed>`). A bare `@supports color { … }` is invalid. The
   * well-formed parenthesized/not/function preludes are already taken by the
   * structured `QueryAtRuleBlock`; this required-condition fallback exists so the
   * leftovers that reach it (a bare ident, or an empty prelude) report the missing
   * condition rather than being swallowed by the permissive query fallback (or the
   * opaque UnknownAtRuleBlock). A zero-width lookahead asserts the opener without
   * consuming, so the shared token stream still owns the prelude; on failure
   * `expect` recovers in place and the block still parses.
   */
    const supportsCondAhead = regex(/(?=\(|not(?![-\w])|-?[_a-zA-Z\u0080-\uFFFF][-_a-zA-Z0-9\u0080-\uFFFF]*\()/i);
    const reqSupportsPrelude = sequence(
      expect(
        supportsCondAhead,
        'supports condition'
      ),
      atPreludeTokens
    );

    /*
   * An UNKNOWN at-rule prelude as a REAL token stream — distinct, properly-spanned
   * VERBATIM tokens, NOT one opaque leaf. Typed/semantic value nodes are reserved
   * for KNOWN at-rules (later increments); here every top-level token is kept
   * verbatim as one `Any` so glued runs (`a=b`, `foo(1)`, `[x]`, `foo!bar`) round-
   * trip byte-for-byte. One token is a maximal run that stops at a TOP-LEVEL
   * whitespace / `,` / `{` / `;`, skipping balanced ()/[] and strings so an inner
   * comma/space/paren never splits it; a top-level comma is its own token. The
   * `not(atRunStop)` guard forbids entering on a stop char, so `atToken` can never
   * match empty (no infinite `many` loop). Ambient trivia (`rw`) skips whitespace
   * between iterations; a trailing comment before `{` stays trivia (recoverable
   * via the trivia map) — same guarantee as the old atPreludeScan sentinel.
   * @see https://www.w3.org/TR/css-syntax-3/#consume-at-rule
   */
    const atRunStop = choice(
      ws,
      comment,
      literal(','),
      literal('{'),
      literal(';')
    );
    const atToken = node(
      'Any',
      sequence(
        not(atRunStop),
        scanTo(
          atRunStop,
          { skip: [balanced(
            '(',
            ')'
          ), balanced(
            '[',
            ']'
          ), singleStr, doubleStr] }
        )
      )
    );
    const atTokenStream = many(choice(
      node(
        'Any',
        literal(',')
      ),
      atToken
    ));

    /*
   * Known block at-rules are dispatched to a SHAPE-appropriate body per spec
   * (rather than one grab-bag): conditional-group + `@layer` + `@starting-style`
   * are transparent (ambient frame); the descriptor family is declarations-only;
   * `@scope` is frame 2; `@keyframes` is keyframe-selector blocks; `@page` is page
   * descriptors + margin at-rules; `@font-feature-values` is feature-value blocks;
   * `@document` wraps a frame-1 stylesheet body. Names inside a body are never a
   * parse error — an unknown descriptor/property name still parses (shape only)
   * and the language service judges it.
   */

    /*
   * A NON-paren conditional-group query (`@media screen { … }`) reaches here
   * rather than the structured QueryAtRuleBlock. These still REQUIRE a query — an
   * empty query (`@media {}`) is a real error — so they take a `reqQueryPrelude`
   * arm. Their body is the ambient frame (transparent), like QueryAtRuleBlock.
   * `@supports` is EXCLUDED here (it has no bare query form) and dispatched via
   * its own `supportsFallbackAtKeyword`/`reqSupportsPrelude` arm below.
   */
    const queryFallbackAtKeyword = regex(/@(?:media|container)(?![-\w])/i);
    const supportsFallbackAtKeyword = regex(/@supports(?![-\w])/i);

    /* `@starting-style` is transparent (no prelude), like the conditional group. */
    const startingStyleAtKeyword = regex(/@starting-style(?![-\w])/i);

    /*
   * `@layer <name> { }` block form (the `@layer a, b;` statement form is an
   * AtRuleStatement). Transparent — holds a stylesheet body / nested rules.
   */
    const layerAtKeyword = regex(/@layer(?![-\w])/i);

    /*
   * `@scope (start) to (end) { }` — its block holds style rules AND bare
   * declarations that apply to the scope root, i.e. a frame-2 body.
   */
    const scopeAtKeyword = regex(/@scope(?![-\w])/i);

    /*
   * Descriptor-list at-rules: their body is DECLARATIONS ONLY — no rules, no
   * nested at-rules. Any ident descriptor name is accepted (shape only).
   */
    const descriptorAtKeyword = regex(/@(?:font-face|counter-style|property|color-profile|font-palette-values|position-try|view-transition)(?![-\w])/i);

    /**
   * Descriptor-list body — `<ident>: <value>;` declarations ONLY. A ruleset or
   * nested at-rule does not match here, so `@font-face { .foo {} }` recovers as a
   * parseError (structural garbage) while any descriptor NAME parses (LS-judged).
   * Reused as the declarations-only body of keyframe blocks, page/margin boxes,
   * and feature-value blocks (all of which hold property declarations, no rules).
   * @see https://www.w3.org/TR/css-syntax-3/#consume-declaration
   */
    const descriptorBody = many(choice(
      g.Declaration,
      g.CustomDeclaration,
      literal(';')
    ));

    /*
   * ── @keyframes ───────────────────────────────────────────────────────────
   * `@keyframes <name> { <keyframe-block>* }` (+ vendor `@-webkit-keyframes` …).
   * A keyframe block is a keyframe-selector list (`from` | `to` | `<percentage>`)
   * followed by a declaration-only body. A bare declaration (no selector) or a
   * ruleset does not match a keyframe block, so `@keyframes k { color: red }` and
   * `@keyframes k { .foo {} }` recover as parseErrors (structural garbage).
   */
    const keyframesAtKeyword = regex(/@(?:-[a-z]+-)?keyframes(?![-\w])/i);

    /**
   * A keyframe percentage selector (`0%`, `50%`, `100%`, `.5%`). Shape only — the
   * 0–100 range is an LS concern, not a parse concern.
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@keyframes#values
   */
    const keyframePercent = regex(/[-+]?(?:\d+\.?\d*|\.\d+)%/);

    /**
   * A single keyframe selector — the `from` / `to` keywords or a percentage.
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@keyframes#values
   */
    const keyframeSelector = choice(
      regex(/from(?![-\w])/i),
      regex(/to(?![-\w])/i),
      keyframePercent
    );

    /**
   * A comma-separated list of keyframe selectors (`0%, 100%`).
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@keyframes#values
   */
    const KeyframeSelectorList = node(sequence(
      g.keyframeSelector,
      many(sequence(
        literal(','),
        g.keyframeSelector
      ))
    ));

    /**
   * A keyframe block — a selector list + a declaration-only body. Declarations
   * only (no nested rules), so a ruleset inside recovers as a parseError.
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@keyframes
   */
    const KeyframeBlock = node(sequence(
      g.KeyframeSelectorList,
      literal('{'),
      g.descriptorBody,
      expect(
        literal('}'),
        '}'
      )
    ));

    /**
   * `@keyframes` body — a run of keyframe blocks. A bare declaration does not
   * match (a keyframe block requires a selector), so `@keyframes k { color: red }`
   * recovers as a parseError.
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@keyframes
   */
    const keyframesBody = many(g.KeyframeBlock);

    /*
   * ── @page ────────────────────────────────────────────────────────────────
   * `@page <page-selector>? { <page-descriptor | margin-at-rule | ;>* }`. The
   * optional page pseudo-selector prelude (`:left` / `:right` / `:first` /
   * `:blank`) is absorbed by the generic `atPrelude` scan. The body holds page
   * descriptors (declarations) and the 16 margin-box at-rules — NO style rules,
   * so `@page { .foo {} }` recovers as a parseError.
   */
    const pageAtKeyword = regex(/@page(?![-\w])/i);

    /*
   * The 16 page margin boxes (longest alternative first so `@top-right-corner`
   * isn't shadowed by `@top-right`).
   */
    const marginAtKeyword = regex(/@(?:top-(?:left-corner|left|center|right-corner|right)|bottom-(?:left-corner|left|center|right-corner|right)|left-(?:top|middle|bottom)|right-(?:top|middle|bottom))(?![-\w])/i);

    /**
   * A page margin-box at-rule (`@top-center { content: "x" }`). Its body is page
   * descriptors (declarations only).
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@page#margin_at-rules
   */
    const MarginAtRule = node(sequence(
      marginAtKeyword,
      literal('{'),
      g.descriptorBody,
      expect(
        literal('}'),
        '}'
      )
    ));

    /**
   * `@page` body — page descriptors, margin-box at-rules, and empty `;`. NO style
   * rules: a ruleset does not match, so `@page { .foo {} }` recovers as a
   * parseError.
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@page
   */
    const pageBody = many(choice(
      g.Declaration,
      g.CustomDeclaration,
      g.MarginAtRule,
      literal(';')
    ));

    /*
   * ── @font-feature-values ───────────────────────────────────────────────────
   * `@font-feature-values <family># { <feature-value-block>* }`. The font-family
   * prelude is absorbed by the generic `atPrelude` scan. The body holds
   * feature-value blocks (`@styleset { … }` …) — NO bare declarations, so
   * `@font-feature-values F { color: red }` recovers as a parseError.
   */
    const fontFeatureValuesAtKeyword = regex(/@font-feature-values(?![-\w])/i);
    const featureTypeKeyword = regex(/@(?:stylistic|styleset|character-variant|swash|ornaments|annotation|historical-forms)(?![-\w])/i);

    /**
   * A feature-value block (`@styleset { nice: 1 }`). Its body is declarations
   * only (feature name → value indices).
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@font-feature-values
   */
    const FeatureValueBlock = node(sequence(
      featureTypeKeyword,
      literal('{'),
      g.descriptorBody,
      expect(
        literal('}'),
        '}'
      )
    ));

    /**
   * `@font-feature-values` body — a run of feature-value blocks. A bare
   * declaration does not match, so `@font-feature-values F { color: red }`
   * recovers as a parseError.
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@font-feature-values
   */
    const fontFeatureValuesBody = many(g.FeatureValueBlock);

    /*
   * ── @document (deprecated) ─────────────────────────────────────────────────
   * `@document <url-matching-fn># { <style-rule>* }` (+ legacy `@-moz-document`).
   * It wraps style rules, so its body is frame 1 (`stylesheetBody`).
   */
    const documentAtKeyword = regex(/@(?:-moz-)?document(?![-\w])/i);

    /* Shared known-block arms whose body is frame-INDEPENDENT (same nested vs top). */
    const descriptorBlock = sequence(
      descriptorAtKeyword,
      atPreludeTokens,
      literal('{'),
      g.descriptorBody,
      expect(
        literal('}'),
        '}'
      )
    );
    const scopeBlock = sequence(
      scopeAtKeyword,
      atPreludeTokens,
      literal('{'),
      g.declarationList,
      expect(
        literal('}'),
        '}'
      )
    );

    /*
   * Spec-specific bodies (Phase 2). Each is frame-INDEPENDENT (its own fixed
   * content model, identical top-level or nested): keyframe blocks / page +
   * margin at-rules / feature-value blocks / (for `@document`) a frame-1
   * stylesheet body.
   */
    const keyframesBlock = sequence(
      keyframesAtKeyword,
      atPreludeTokens,
      literal('{'),
      g.keyframesBody,
      expect(
        literal('}'),
        '}'
      )
    );
    const pageBlock = sequence(
      pageAtKeyword,
      atPreludeTokens,
      literal('{'),
      g.pageBody,
      expect(
        literal('}'),
        '}'
      )
    );
    const fontFeatureValuesBlock = sequence(
      fontFeatureValuesAtKeyword,
      atPreludeTokens,
      literal('{'),
      g.fontFeatureValuesBody,
      expect(
        literal('}'),
        '}'
      )
    );
    const documentBlock = sequence(
      documentAtKeyword,
      atPreludeTokens,
      literal('{'),
      g.stylesheetBody,
      expect(
        literal('}'),
        '}'
      )
    );
    const sharedKnownArms = choice(
      descriptorBlock,
      scopeBlock,
      keyframesBlock,
      pageBlock,
      fontFeatureValuesBlock,
      documentBlock
    );

    /**
   * A known block at-rule reached from a frame-2 (nested) body. The transparent
   * arms (conditional group, `@starting-style`, `@layer`) use the ambient frame 2
   * (`declarationList`); the descriptor / `@scope` / phase-2 arms use their own
   * fixed body.
   * @see https://www.w3.org/TR/css-syntax-3/#at-rule
   */
    const AtRuleBlock = node(choice(
      sequence(
        queryFallbackAtKeyword,
        reqQueryPrelude,
        literal('{'),
        g.declarationList,
        expect(
          literal('}'),
          '}'
        )
      ),
      sequence(
        supportsFallbackAtKeyword,
        reqSupportsPrelude,
        literal('{'),
        g.declarationList,
        expect(
          literal('}'),
          '}'
        )
      ),
      sequence(
        startingStyleAtKeyword,
        atPreludeTokens,
        literal('{'),
        g.declarationList,
        expect(
          literal('}'),
          '}'
        )
      ),
      sequence(
        layerAtKeyword,
        atPreludeTokens,
        literal('{'),
        g.declarationList,
        expect(
          literal('}'),
          '}'
        )
      ),
      sharedKnownArms
    ));

    /**
   * A known block at-rule reached from frame 1 (top level). Identical to
   * `AtRuleBlock` except the transparent arms use frame 1 (`stylesheetBody`) —
   * a bare declaration in a top-level conditional group / `@layer` has no owning
   * rule and is rejected/recovered. Built as `AtRuleBlock`.
   * @see https://www.w3.org/TR/css-syntax-3/#at-rule
   */
    const AtRuleBlockTop = node(
      'AtRuleBlock',
      choice(
        sequence(
          queryFallbackAtKeyword,
          reqQueryPrelude,
          literal('{'),
          g.stylesheetBody,
          expect(
            literal('}'),
            '}'
          )
        ),
        sequence(
          supportsFallbackAtKeyword,
          reqSupportsPrelude,
          literal('{'),
          g.stylesheetBody,
          expect(
            literal('}'),
            '}'
          )
        ),
        sequence(
          startingStyleAtKeyword,
          atPreludeTokens,
          literal('{'),
          g.stylesheetBody,
          expect(
            literal('}'),
            '}'
          )
        ),
        sequence(
          layerAtKeyword,
          atPreludeTokens,
          literal('{'),
          g.stylesheetBody,
          expect(
            literal('}'),
            '}'
          )
        ),
        sharedKnownArms
      )
    );

    /**
   * An UNKNOWN at-rule block — one of only two lenient/opaque spots: the UA owns
   * its meaning, so the body is scanned over (balanced `{}`) and never errors.
   * @see https://www.w3.org/TR/css-syntax-3/#consume-at-rule
   */
    const opaqueAtBody = scanTo(
      literal('}'),
      { skip: [balanced(
        '{',
        '}'
      ), singleStr, doubleStr, comment] }
    );
    const UnknownAtRuleBlock = node(sequence(
      atKeyword,
      g.atTokenStream,
      literal('{'),
      opaqueAtBody,
      literal('}')
    ));

    /**
   * A statement at-rule — `@name <prelude> ;` with no block (`@charset`,
   * `@namespace`, `@layer a, b;` …).
   * @see https://www.w3.org/TR/css-syntax-3/#consume-at-rule
   */
    const AtRuleStatement = node(sequence(
      atKeyword,
      atPrelude,
      literal(';')
    ));

    /**
   * `@import` — REQUIRES a prelude (a path); `@import ;` is a real error. Ordered
   * before the generic AtRuleStatement so `@import "x.css";` routes here; the
   * missing-prelude case is reported by `reqImportPrelude` and recovers in place
   * so the trailing `;` still closes the statement. Built as an AtRuleStatement.
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@import
   */
    const importAtKeyword = regex(/@import(?![-\w])/i);
    const ImportStatement = node(
      'AtRuleStatement',
      sequence(
        importAtKeyword,
        reqImportPrelude,
        literal(';')
      )
    );

    /*
   * ── Value leaves & sub-grammars ────────────────────────────────────────────
   * `Quoted`, `Num`/`Color`, value-position `Paren`/`calc()`, and the
   * `@media`/`@container`/`@supports` condition grammar. Less and Scss inherit
   * these verbatim through `compose([cssGrammar, …])`.
   */
    /** A quoted string value. @see https://www.w3.org/TR/css-values-4/#strings */
    const Quoted = node(choice(
      singleStr,
      doubleStr
    ));

    /* bare number; the not()-lookahead is folded into the regex → one match, one leaf. */
    const numTok = regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)(?![a-zA-Z\u0080-\uffff%])/);

    /*
   * Only the four valid hex-color lengths (3/4/6/8). Longest-first so a 5- or
   * 7-digit run (`#fffff`) can't partial-match — the trailing lookahead then
   * rejects it, making it a parse error (matches Less).
   */
    const colorHex = regex(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/);

    /** A bare number value. @see https://www.w3.org/TR/css-values-4/#numbers */
    const Num = node(numTok);

    /** A hex color (`#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`). @see https://www.w3.org/TR/css-color-4/#hex-notation */
    const Color = node(colorHex);

    /** A value-position parenthesized group (permissive; NOT a math context). @see https://www.w3.org/TR/css-values-4/#calc-syntax */
    const Paren = node(sequence(
      literal('('),
      g.parenBody
    ));

    /** `calc(…)` — the CSS math function. @see https://developer.mozilla.org/en-US/docs/Web/CSS/calc */
    const CalcCall = node(
      'Call',
      sequence(
        regex(/calc(?=\()/i),
        literal('('),
        g.calcBody
      )
    );
    const mfComparison = regex(/<=|>=|[<>=]/);

    /* Optional leading container name — an ident that is NOT a query keyword. */
    const containerName = regex(/(?!(?:not|and|or|only)(?![-\w]))-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/i);

    /**
   * A media/container feature test — `name`, `name: value`, or a range form
   * (`width >= 600px`, `400px < width < 700px`).
   * @see https://www.w3.org/TR/mediaqueries-5/#mq-features
   */
    const QueryFeature = node(sequence(
      ident,
      optional(choice(
        sequence(
          literal(':'),
          g.valueList
        ),
        sequence(
          mfComparison,
          g.value,
          optional(sequence(
            mfComparison,
            g.value
          ))
        )
      ))
    ));

    /*
   * A `<query-in-parens>` may also be a query function: `style(<style-query>)`,
   * `scroll-state(<scroll-state-query>)`, or `<general-enclosed>` — any
   * `<function-token>` (an identifier glued to `(`, with no whitespace)
   * wrapping arbitrary balanced content. The no-whitespace glue is what
   * distinguishes it from a container name (`sidebar (…)`, whitespace-separated).
   * @see https://drafts.csswg.org/css-conditional-5/#typedef-query-in-parens
   */
    const queryFunctionToken = regex(/-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*(?=\()/);
    const queryFunctionBody = scanTo(
      literal(')'),
      { skip: [balanced(
        '(',
        ')'
      ), singleStr, doubleStr] }
    );

    /**
   * A query function — `style(<style-query>)`, `scroll-state(…)`, or a
   * `<general-enclosed>` function token wrapping balanced content.
   * @see https://drafts.csswg.org/css-conditional-5/#typedef-query-in-parens
   */
    const QueryFunction = node(sequence(
      queryFunctionToken,
      literal('('),
      queryFunctionBody,
      expect(
        literal(')'),
        ')'
      )
    ));

    /**
   * A `<query-in-parens>` — a parenthesized condition/feature or a query function.
   * @see https://drafts.csswg.org/css-conditional-5/#typedef-query-in-parens
   */
    const QueryInParens = node(choice(
      g.QueryFunction,
      sequence(
        literal('('),
        choice(
          g.QueryCondition,
          g.QueryFeature
        ),
        literal(')')
      )
    ));

    /**
   * A query condition — `not (…)` or `(…) [and|or (…)]*`.
   * @see https://www.w3.org/TR/mediaqueries-5/#mq-syntax
   */
    const QueryCondition = node(choice(
      sequence(
        regex(/not(?![-\w])/i),
        g.QueryInParens
      ),
      sequence(
        g.QueryInParens,
        many(sequence(
          regex(/(?:and|or)(?![-\w])/i),
          g.QueryInParens
        ))
      )
    ));

    /**
   * A conditional-group prelude — an optional container name + a comma list of
   * query conditions.
   * @see https://www.w3.org/TR/mediaqueries-5/#mq-syntax
   */
    const queryPrelude = sequence(
      optional(containerName),
      g.QueryCondition,
      many(sequence(
        literal(','),
        g.QueryCondition
      ))
    );

    return {
      rw,
      Quoted, Num, Color, Paren, CalcCall,
      QueryFeature, QueryFunction, QueryInParens, QueryCondition, queryPrelude,
      Stylesheet, stylesheetBody, Ruleset,
      SelectorList, ComplexSelector, CompoundSelector, BasicSelector, simpleSelector,
      AttributeSelector, PseudoSelector, pseudoArg,
      Declaration, CustomDeclaration, declarationList, descriptorBody,
      keyframeSelector, KeyframeSelectorList, KeyframeBlock, keyframesBody,
      MarginAtRule, pageBody, FeatureValueBlock, fontFeatureValuesBody,
      valueList, valueSequence, value, parenBody, mathProduct, mathSum, calcBody,
      Dimension, numeric, Url, Call, anyValue,
      AtRuleBlock, AtRuleBlockTop, AtRuleStatement, ImportStatement,
      QueryAtRuleBlock, QueryAtRuleBlockTop, UnknownAtRuleBlock, atTokenStream,
      AtRulePreludeSegments
    };
  }
);

/*
 * Entry + notable rules pulled off the grammar map for the driver and tests.
 * Less/Scss don't import these — they extend the whole grammar via `compose()`.
 */
export const {
  Stylesheet, Ruleset, SelectorList, ComplexSelector, CompoundSelector,
  BasicSelector, AttributeSelector, PseudoSelector, Declaration, CustomDeclaration,
  Dimension, Num, Color, Url, Call, Paren, Quoted, AtRuleBlock, AtRuleStatement,
  AtRulePreludeSegments
} = cssGrammar;
