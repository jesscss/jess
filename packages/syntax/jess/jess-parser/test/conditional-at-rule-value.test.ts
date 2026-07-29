import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/jess-parser';

/**
 * A conditional at-rule prelude is the CSS "value hole": a composite shape whose
 * inner value production each dialect must supply itself. `parser-shared` can
 * only hold `g`-free `regex()` terminals, so the shared artifact stops at the
 * comparison operator and the at-keywords — the ratio, the `<mf-range>`, and the
 * condition chain are hand-written per dialect and have drifted apart repeatedly
 * (`@media (aspect-ratio: 16/9)`, `@media (100px < width < 200px)`, the
 * custom-property `!important` tail).
 *
 * Shared grammar is not available; shared TESTS are. This matrix is replicated
 * verbatim across the css / less / scss / jess parser packages, exactly like
 * `custom-property.test.ts`, so a dialect that re-invents one of these shapes
 * fails here instead of drifting silently. Valid CSS must parse in every dialect
 * and produce the SAME canonical AST (the "valid CSS is valid in all dialects"
 * keystone); a genuine dialect difference is encoded below as a named constant
 * with a reason, never as a silently-forked expectation.
 *
 * Node vocabulary (canonical AST v2): a parenthesized feature is a `Block`
 * (`delimiter: 'paren'`) wrapping an `Operation`; a bare boolean feature wraps a
 * `Keyword`; whitespace-joined query terms are a `SpacedValue`; a comma-separated
 * media-query list is a `List`. There is deliberately no `MediaFeature` node.
 */

const kw = (src: string) => ({ type: 'Keyword', src });
const dim = (src: string) => ({ type: 'Dimension', src });
const paren = (inner: unknown) => ({ type: 'Block', delimiter: 'paren', value: inner });
const op = (operator: string, left: unknown, right: unknown) => ({ type: 'Operation', operator, left, right });
const ratio = (n: string, d: string) => op('/', dim(n), dim(d));
const call = (name: string, args: unknown[]) => ({ type: 'FunctionCall', name, args });
const staticUrl = (src: string) => ({ type: 'Url', value: { type: 'Any', src } });
const list = (...value: unknown[]) => ({ type: 'List', sep: ',', value });

/**
 * `<ratio>` — mediaqueries-4 §2.1, `<number> [ / <number> ]?`. The slash is a
 * typed `Operation`, never a value-position slash list and never re-joined text.
 * A lone `<number>` is a whole ratio, so the slash tail is optional, not implied.
 */
const RATIO: Array<[string, string, object]> = [
  ['a ratio feature value', '@media (aspect-ratio: 16/9) { a { color: red; } }', paren(op(':', kw('aspect-ratio'), ratio('16', '9')))],
  ['a min- prefixed ratio', '@media (min-aspect-ratio: 4/3) { a { color: red; } }', paren(op(':', kw('min-aspect-ratio'), ratio('4', '3')))],
  ['a max- prefixed ratio', '@media (max-aspect-ratio: 16/9) { a { color: red; } }', paren(op(':', kw('max-aspect-ratio'), ratio('16', '9')))],
  ['a square ratio', '@media (aspect-ratio: 1/1) { a { color: red; } }', paren(op(':', kw('aspect-ratio'), ratio('1', '1')))],
  ['a ratio spaced around the solidus', '@media (aspect-ratio: 16 / 9) { a { color: red; } }', paren(op(':', kw('aspect-ratio'), ratio('16', '9')))],
  ['a ratio spaced before the solidus', '@media (aspect-ratio: 16 /9) { a { color: red; } }', paren(op(':', kw('aspect-ratio'), ratio('16', '9')))],
  ['a ratio spaced after the solidus', '@media (aspect-ratio: 16/ 9) { a { color: red; } }', paren(op(':', kw('aspect-ratio'), ratio('16', '9')))],
  ['an integer-only ratio', '@media (aspect-ratio: 1) { a { color: red; } }', paren(op(':', kw('aspect-ratio'), dim('1')))],
  ['a device-aspect-ratio', '@media (device-aspect-ratio: 16/9) { a { color: red; } }', paren(op(':', kw('device-aspect-ratio'), ratio('16', '9')))],
  ['a ratio as a range bound', '@media (aspect-ratio >= 16/9) { a { color: red; } }', paren(op('>=', kw('aspect-ratio'), ratio('16', '9')))],
  ['a ratio in @container', '@container (aspect-ratio: 16/9) { a { color: red; } }', paren(op(':', kw('aspect-ratio'), ratio('16', '9')))]
];

/**
 * `<mf-range>` — mediaqueries-4 §4.3. Name-first and value-first both reduce to a
 * typed `Operation`; the double-ended form nests left-to-right so the authored
 * operand order survives. Every comparison spelling must be accepted.
 */
const RANGE: Array<[string, string, object]> = [
  ['a name-first >= range', '@media (width >= 600px) { a { color: red; } }', paren(op('>=', kw('width'), dim('600px')))],
  ['a name-first <= range', '@media (width <= 600px) { a { color: red; } }', paren(op('<=', kw('width'), dim('600px')))],
  ['a name-first > range', '@media (width > 600px) { a { color: red; } }', paren(op('>', kw('width'), dim('600px')))],
  ['a name-first < range', '@media (width < 600px) { a { color: red; } }', paren(op('<', kw('width'), dim('600px')))],
  ['a name-first = range', '@media (width = 600px) { a { color: red; } }', paren(op('=', kw('width'), dim('600px')))],
  ['a value-first <= range', '@media (600px <= width) { a { color: red; } }', paren(op('<=', dim('600px'), kw('width')))],
  ['a value-first > range', '@media (600px > width) { a { color: red; } }', paren(op('>', dim('600px'), kw('width')))],
  ['a value-first = range', '@media (600px = width) { a { color: red; } }', paren(op('=', dim('600px'), kw('width')))],
  ['a height range', '@media (height >= 600px) { a { color: red; } }', paren(op('>=', kw('height'), dim('600px')))],
  ['an unspaced range', '@media (width>=600px) { a { color: red; } }', paren(op('>=', kw('width'), dim('600px')))],
  ['a double-ended < range', '@media (100px < width < 200px) { a { color: red; } }', paren(op('<', op('<', dim('100px'), kw('width')), dim('200px')))],
  ['a double-ended <= range', '@media (100px <= width <= 200px) { a { color: red; } }', paren(op('<=', op('<=', dim('100px'), kw('width')), dim('200px')))],
  ['a double-ended > range', '@media (200px > width > 100px) { a { color: red; } }', paren(op('>', op('>', dim('200px'), kw('width')), dim('100px')))],
  ['a double-ended >= range', '@media (200px >= width >= 100px) { a { color: red; } }', paren(op('>=', op('>=', dim('200px'), kw('width')), dim('100px')))],
  ['a range in @container', '@container (width > 400px) { a { color: red; } }', paren(op('>', kw('width'), dim('400px')))],
  ['a double-ended range in @container', '@container (100px < width < 200px) { a { color: red; } }', paren(op('<', op('<', dim('100px'), kw('width')), dim('200px')))]
];

/**
 * `<mf-value>` generally — lengths, integers, keywords, resolutions — plus the
 * boolean context (`<mf-boolean>`, mediaqueries-4 §4.4), which is a bare
 * `Keyword` inside the paren block rather than an `Operation`.
 */
const FEATURE_VALUE: Array<[string, string, object]> = [
  ['a length feature value', '@media (min-width: 600px) { a { color: red; } }', paren(op(':', kw('min-width'), dim('600px')))],
  ['a negative length feature value', '@media (min-width: -600px) { a { color: red; } }', paren(op(':', kw('min-width'), dim('-600px')))],
  ['a decimal length feature value', '@media (min-width: 60.5px) { a { color: red; } }', paren(op(':', kw('min-width'), dim('60.5px')))],
  ['an integer feature value', '@media (min-color: 8) { a { color: red; } }', paren(op(':', kw('min-color'), dim('8')))],
  ['a keyword feature value', '@media (orientation: landscape) { a { color: red; } }', paren(op(':', kw('orientation'), kw('landscape')))],
  ['a dppx resolution', '@media (min-resolution: 2dppx) { a { color: red; } }', paren(op(':', kw('min-resolution'), dim('2dppx')))],
  ['a dpi resolution', '@media (min-resolution: 300dpi) { a { color: red; } }', paren(op(':', kw('min-resolution'), dim('300dpi')))],
  ['a scripting keyword', '@media (scripting: enabled) { a { color: red; } }', paren(op(':', kw('scripting'), kw('enabled')))],
  ['an update keyword', '@media (update: fast) { a { color: red; } }', paren(op(':', kw('update'), kw('fast')))],
  ['a prefers-color-scheme keyword', '@media (prefers-color-scheme: dark) { a { color: red; } }', paren(op(':', kw('prefers-color-scheme'), kw('dark')))],
  ['a hover keyword value', '@media (hover: none) { a { color: red; } }', paren(op(':', kw('hover'), kw('none')))],
  ['a boolean hover feature', '@media (hover) { a { color: red; } }', paren(kw('hover'))],
  ['a boolean pointer feature', '@media (pointer) { a { color: red; } }', paren(kw('pointer'))],
  ['a boolean color feature', '@media (color) { a { color: red; } }', paren(kw('color'))],
  ['a plain @container size feature', '@container (min-width: 400px) { a { color: red; } }', paren(op(':', kw('min-width'), dim('400px')))]
];

/**
 * A function in a value position. mediaqueries-5 §2.4 takes whatever `<mf-value>`
 * the feature's own type allows, and css-values-4 §11 makes `var()` and `env()`
 * substitutable wherever a component value is — so the set of functions that can
 * appear here is open-ended and grows with the platform.
 *
 * The parser's job stops at the css-syntax-3 §4.3.4 function token: an ident with
 * `(` glued directly to it. WHICH function is meaningful in WHICH feature is a
 * language-service fact, and a parser that name-checks it turns a diagnosable
 * squiggle into a lost file — so every name below reduces the same way, including
 * one the grammar has never heard of.
 */
const FUNCTION_VALUE: Array<[string, string, object]> = [
  ['a var() feature value', '@media (min-width: var(--w)) { a { color: red; } }', paren(op(':', kw('min-width'), call('var', [kw('--w')])))],
  ['an env() feature value', '@media (min-width: env(safe-area-inset-top)) { a { color: red; } }', paren(op(':', kw('min-width'), call('env', [kw('safe-area-inset-top')])))],
  ['an env() feature value with a fallback', '@media (min-width: env(safe-area-inset-top, 10px)) { a { color: red; } }', paren(op(':', kw('min-width'), call('env', [kw('safe-area-inset-top'), dim('10px')])))],
  ['a min() feature value', '@media (min-width: min(100px, 200px)) { a { color: red; } }', paren(op(':', kw('min-width'), call('min', [dim('100px'), dim('200px')])))],
  ['a clamp() feature value', '@media (min-width: clamp(1px, 2px, 3px)) { a { color: red; } }', paren(op(':', kw('min-width'), call('clamp', [dim('1px'), dim('2px'), dim('3px')])))],
  ['a function the grammar has never heard of', '@media (min-width: -webkit-foo(1px)) { a { color: red; } }', paren(op(':', kw('min-width'), call('-webkit-foo', [dim('1px')])))],
  ['a function as a name-first range bound', '@media (width >= var(--w)) { a { color: red; } }', paren(op('>=', kw('width'), call('var', [kw('--w')])))],
  ['a function as a value-first range bound', '@media (var(--w) < width) { a { color: red; } }', paren(op('<', call('var', [kw('--w')]), kw('width')))],
  ['a function value in an and chain', '@media screen and (min-width: var(--w)) { a { color: red; } }',
    { type: 'SpacedValue', parts: [kw('screen'), kw('and'), paren(op(':', kw('min-width'), call('var', [kw('--w')])))] }],
  ['a function value in @container', '@container (min-width: var(--w)) { a { color: red; } }', paren(op(':', kw('min-width'), call('var', [kw('--w')])))],
  ['a function value in a named @container', '@container card (min-width: env(x)) { a { color: red; } }',
    { type: 'SpacedValue', parts: [kw('card'), paren(op(':', kw('min-width'), call('env', [kw('x')])))] }]
];

/**
 * `@property` descriptors — css-properties-values-api-1 §3. A descriptor value is
 * an ordinary CSS component value, so the same rule holds one level down: the
 * registered syntax decides whether `var()` is USEFUL in an `initial-value`, and
 * that decision is not the parser's. `url()` is the one name that legitimately
 * changes the shape, because css-syntax-3 §4.3.6 makes it a distinct token type
 * with its own consume algorithm and its own `Url` node — a token, not a function
 * the grammar dislikes.
 */
const DESCRIPTOR: Array<[string, string, object]> = [
  ['a var() initial-value', '@property --x { initial-value: var(--y); }', call('var', [kw('--y')])],
  ['an env() initial-value', '@property --x { initial-value: env(safe-area-inset-top); }', call('env', [kw('safe-area-inset-top')])],
  ['a url() initial-value', '@property --x { initial-value: url(a.png); }', staticUrl('a.png')],
  ['a min() initial-value', '@property --x { initial-value: min(1px, 2px); }', call('min', [dim('1px'), dim('2px')])],
  ['a modern rgb() initial-value', '@property --x { initial-value: rgb(1 2 3); }', call('rgb', [[dim('1'), dim('2'), dim('3')]])]
];

/**
 * Query-term composition: a media type, the `only` modifier, and `and`/`or`
 * chains join into a `SpacedValue` whose connectives are ordinary `Keyword`
 * parts. A named `@container` is the same shape (name, then the feature block).
 */
const COMPOSITION: Array<[string, string, object]> = [
  ['a media type with a feature', '@media screen and (min-width: 600px) { a { color: red; } }',
    { type: 'SpacedValue', parts: [kw('screen'), kw('and'), paren(op(':', kw('min-width'), dim('600px')))] }],
  ['an only-modified media type', '@media only screen and (hover) { a { color: red; } }',
    { type: 'SpacedValue', parts: [kw('only'), kw('screen'), kw('and'), paren(kw('hover'))] }],
  ['an and chain of two features', '@media (min-width: 600px) and (max-width: 900px) { a { color: red; } }',
    { type: 'SpacedValue', parts: [paren(op(':', kw('min-width'), dim('600px'))), kw('and'), paren(op(':', kw('max-width'), dim('900px')))] }],
  ['an or chain of two features', '@media (hover) or (pointer) { a { color: red; } }',
    { type: 'SpacedValue', parts: [paren(kw('hover')), kw('or'), paren(kw('pointer'))] }],
  ['a range combined with a ratio', '@media (min-aspect-ratio: 16/9) and (width >= 600px) { a { color: red; } }',
    { type: 'SpacedValue', parts: [paren(op(':', kw('min-aspect-ratio'), ratio('16', '9'))), kw('and'), paren(op('>=', kw('width'), dim('600px')))] }],
  ['a named @container', '@container card (min-width: 400px) { a { color: red; } }',
    { type: 'SpacedValue', parts: [kw('card'), paren(op(':', kw('min-width'), dim('400px')))] }],
  ['an and chain in @container', '@container (min-width: 400px) and (min-height: 400px) { a { color: red; } }',
    { type: 'SpacedValue', parts: [paren(op(':', kw('min-width'), dim('400px'))), kw('and'), paren(op(':', kw('min-height'), dim('400px')))] }],
  ['a comma-separated media-query list', '@media screen, print { a { color: red; } }', list(kw('screen'), kw('print'))],
  ['a three-item media-query list', '@media screen, print, tv { a { color: red; } }', list(kw('screen'), kw('print'), kw('tv'))],
  ['a list of parenthesized features', '@media (min-width: 1px), (max-width: 2px) { a { color: red; } }',
    list(paren(op(':', kw('min-width'), dim('1px'))), paren(op(':', kw('max-width'), dim('2px'))))],
  ['a list whose first query is only-modified', '@media only screen, print { a { color: red; } }',
    list({ type: 'SpacedValue', parts: [kw('only'), kw('screen')] }, kw('print'))],
  ['a list whose first query is an and chain', '@media screen and (hover), print { a { color: red; } }',
    list({ type: 'SpacedValue', parts: [kw('screen'), kw('and'), paren(kw('hover'))] }, kw('print'))],
  ['a comma-separated @container query list', '@container (width > 1px), (height > 1px) { a { color: red; } }',
    list(paren(op('>', kw('width'), dim('1px'))), paren(op('>', kw('height'), dim('1px'))))]
];

/**
 * The parser is not a linter. Which feature names exist, which keywords are
 * meaningful for a feature, and which units are real are all language-service
 * facts — the grammar's job is the SHAPE. A dialect that rejects one of these
 * turns a diagnosable squiggle into a lost file, so they are pinned here.
 */
const NOT_A_LINTER: Array<[string, string, object]> = [
  ['an unknown feature name', '@media (future-feature: 3) { a { color: red; } }', paren(op(':', kw('future-feature'), dim('3')))],
  ['an unknown keyword for a known feature', '@media (orientation: sideways) { a { color: red; } }', paren(op(':', kw('orientation'), kw('sideways')))],
  ['an unknown unit', '@media (min-width: 5qq) { a { color: red; } }', paren(op(':', kw('min-width'), dim('5qq')))],
  ['a nonsensical but well-formed unit', '@media (min-width: 17deg) { a { color: red; } }', paren(op(':', kw('min-width'), dim('17deg')))]
];

/**
 * `@supports` — css-conditional-3 §2. A supported declaration is the same
 * `Block(Operation)` as a media feature; `not`/`and`/`or` compose into a
 * `SpacedValue`. A form the dialect does not model as a declaration — a
 * `selector()` test, or a custom property, whose value grammar is
 * `<declaration-value>` — is preserved as `GeneralEnclosed` rather than being
 * flattened to raw text.
 */
const SUPPORTS: Array<[string, string, object]> = [
  ['a supported declaration', '@supports (display: grid) { a { color: red; } }', paren(op(':', kw('display'), kw('grid')))],
  ['a negated condition', '@supports not (display: grid) { a { color: red; } }',
    { type: 'SpacedValue', parts: [kw('not'), paren(op(':', kw('display'), kw('grid')))] }],
  ['an and chain', '@supports (display: grid) and (gap: 1px) { a { color: red; } }',
    { type: 'SpacedValue', parts: [paren(op(':', kw('display'), kw('grid'))), kw('and'), paren(op(':', kw('gap'), dim('1px')))] }],
  ['an or chain', '@supports (display: grid) or (display: flex) { a { color: red; } }',
    { type: 'SpacedValue', parts: [paren(op(':', kw('display'), kw('grid'))), kw('or'), paren(op(':', kw('display'), kw('flex')))] }],
  ['a selector() test', '@supports selector(a:hover) { a { color: red; } }', { type: 'GeneralEnclosed', name: 'selector' }],
  ['a complex selector() test', '@supports selector(h2 > p) { a { color: red; } }', { type: 'GeneralEnclosed', name: 'selector' }],
  ['a font-tech() test', '@supports font-tech(color-COLRv1) { a { color: red; } }', { type: 'GeneralEnclosed', name: 'font-tech' }],
  ['a font-format() test', '@supports font-format(opentype) { a { color: red; } }', { type: 'GeneralEnclosed', name: 'font-format' }],
  ['a custom-property test', '@supports (--x: red) { a { color: red; } }', { type: 'GeneralEnclosed' }]
];

function descriptorValue(source: string): unknown {
  const first = parse(source).rules[0];
  if (first === undefined || !('body' in first)) {
    throw new TypeError(`Expected an at-rule block for: ${source}`);
  }
  const declaration = first.rules[0];
  if (declaration === undefined || !('value' in declaration)) {
    throw new TypeError(`Expected an @property descriptor for: ${source}`);
  }
  return declaration.value;
}

function prelude(source: string): unknown {
  const first = parse(source).rules[0];
  if (first === undefined || !('prelude' in first)) {
    throw new TypeError(`Expected an at-rule prelude for: ${source}`);
  }
  return first.prelude;
}

describe('Jess conditional at-rule value holes', () => {
  for (const [group, cases] of [
    ['<ratio>', RATIO], ['<mf-range>', RANGE], ['<mf-value>', FEATURE_VALUE],
    ['query composition', COMPOSITION], ['@supports', SUPPORTS],
    ['<mf-value> functions', FUNCTION_VALUE], ['not a linter', NOT_A_LINTER]
  ] as const) {
    for (const [label, source, expected] of cases) {
      it(`${group}: accepts ${label}`, () => {
        expect(prelude(source), source).toMatchObject(expected);
      });
    }
  }

  for (const [label, source, expected] of DESCRIPTOR) {
    it(`@property descriptor: accepts ${label}`, () => {
      expect(descriptorValue(source), source).toMatchObject(expected);
    });
  }

  /**
   * The custom-property `!important` tail — css-syntax-3 §5.5.6 strips the marker
   * and sets the priority flag before the original-text step. This shipped wrong in
   * all four dialects because "custom-property value text" had three separate
   * implementations; `custom-property.test.ts` owns the full matrix, and this is the
   * regression anchor that keeps the at-rule work from re-forking it.
   */
  it('keeps the custom-property !important tail out of the preserved value', () => {
    expect(parse('a { --x: red !important; }')).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: '--x', value: { type: 'Any', src: 'red' }, important: true }] }]
    });
  });

  /**
   * `;` is a declaration-list SEPARATOR, not a terminator — css-syntax-3 §5.4.7
   * "consume a list of declarations" ends a declaration at `;` OR at the end of
   * the block, and an empty declaration between two separators is discarded
   * rather than being an error. Valid CSS must parse in every dialect, so a
   * missing trailing `;` cannot be a dialect difference.
   *
   * The nested-at-rule cases are that same rule one step further out: when the
   * thing a declaration ends AT is a nested at-rule, the value has to stop at the
   * at-keyword instead of swallowing it and stranding the `{` with no statement
   * to open.
   */
  for (const [label, source] of [
    ['a block with no trailing semicolon', 'a { color: red }'],
    ['a block with a trailing semicolon', 'a { color: red; }'],
    ['a doubled separator', 'a { color: red;; }'],
    ['an empty declaration', 'a { ; }'],
    ['a leading separator', 'a { ; color: red }'],
    ['several empty declarations', 'a { ;;; color: red;;; }'],
    ['a final declaration among several', 'a { color: red; background: blue }'],
    ['an unterminated custom property', 'a { --x: 1px }'],
    ['an unterminated important declaration', 'a { color: red !important }'],
    ['a declaration before a nested rule', 'a { color: red; b { x: 1 } }'],
    ['a declaration before a nested at-rule', 'a { color: red; @media all { x: 1 } }'],
    ['an unterminated declaration before a nested at-rule', 'a { color: red @media all { x: 1 } }'],
    ['an unterminated declaration glued to a nested at-rule', 'a { color: red@media all { x: 1 } }']
  ] as Array<[string, string]>) {
    it(`declaration list: accepts ${label}`, () => {
      expect(() => parse(source), source).not.toThrow();
    });
  }

  /**
   * A declaration with no `;` directly before a nested QUALIFIED rule is the one
   * genuinely ambiguous shape in this family, and it is INVALID. Decided here on
   * the spec, not inherited from whichever dialect happened to accept it.
   *
   * css-syntax-3 §5.4.6 "consume a declaration": if the value contains a
   * top-level simple block with an associated `{` token AND any other
   * non-<whitespace-token> value, return nothing — the spec note names the
   * nested-rule/declaration ambiguity as its reason. So `color: red b { x: 1 }`
   * is not a declaration. The §5.4.4 fallback is a qualified rule, and its
   * prelude `color: red b` is not a valid selector either: selectors-4 §3.5
   * spells a pseudo-class as `':' <ident-token>` with NO whitespace token
   * between, so `color` + `: red` is not a compound selector. Both readings
   * invalid ⇒ invalid CSS. A browser drops it; a compiler reports it.
   *
   * This is not a `;`-separator gap: `a { color: red; b { x: 1 } }` is valid and
   * sits in the accepted list above. css used to accept the unterminated form
   * only because its pseudo colon tolerated a following whitespace token — which
   * also let `a : hover { }` through — so the cell was green by accident rather
   * than by decision. With that fixed, css, less and jess agree.
   *
   * SCSS is the one exception, and it is a real dialect FEATURE rather than
   * drift: Sass nested properties give the same bytes a defined meaning — the
   * declaration `color: red b` plus a nested `color-x: 1`, the same shape as
   * `font: 12px/1.5 { family: serif }`. The SCSS twin of this file pins that
   * reading instead of this rejection.
   */
  it('declaration list: rejects an unterminated declaration before a nested qualified rule', () => {
    expect(() => parse('a { color: red b { x: 1 } }')).toThrow();
  });

  /**
   * The selector half of that decision, kept honest on its own: a pseudo-class is
   * `':' <ident-token>` with no whitespace token between (selectors-4 §3.5).
   * Whether a COMMENT may sit in that gap is a separate question this matrix does
   * not settle — css and less accept a block comment there, scss and jess reject
   * it — so only the whitespace rule, which all four now share, is pinned here.
   */
  for (const [label, source] of [
    ['a whitespace-separated pseudo colon', 'a : hover { x: 1 }'],
    ['a declaration-shaped pseudo colon', 'a: hover { x: 1 }']
  ] as Array<[string, string]>) {
    it(`declaration list: rejects ${label}`, () => {
      expect(() => parse(source), source).toThrow();
    });
  }

  it('preserves a custom-property value verbatim inside a conditional at-rule', () => {
    expect(parse('@media (min-width: 600px) { a { --x: 1px solid black; } }')).toMatchObject({
      rules: [{ type: 'AtRuleBlock', rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: '--x', value: { type: 'Any', src: '1px solid black' } }] }] }]
    });
  });

  /**
   * `<mf-value>` is ONE component value (mediaqueries-4 §4). A multi-part or
   * comma-separated operand is therefore not a feature at all: mediaqueries-5
   * §3.1 makes it `<general-enclosed>`, which no dialect implements for
   * media/container yet, so all four reject it today.
   *
   * What is pinned here is the CONTRACT, not the rejection. css used to MATCH
   * this shape and then throw a raw internal `Error` out of its reduction, so a
   * consumer could not tell "your CSS is malformed" from "the parser crashed".
   * Whichever way the general-enclosed gap is closed, a failure must reach the
   * caller as the package's typed parse error — a `SyntaxError` subclass
   * carrying `code: 'parse/syntax-error'` — and never as a bare `Error`.
   */
  for (const [label, source] of [
    ['a space-separated feature value', '@media (foo: bar baz) { a { color: red; } }'],
    ['a comma-separated feature value', '@media (foo: a, b) { a { color: red; } }'],
    ['a space-separated @container feature value', '@container (foo: bar baz) { a { color: red; } }']
  ] as Array<[string, string]>) {
    it(`non-<mf-value>: reports ${label} as a typed parse error, never a raw Error`, () => {
      let thrown: unknown;
      try {
        parse(source);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, source).toBeInstanceOf(SyntaxError);
      expect(thrown, source).toMatchObject({ code: 'parse/syntax-error' });
    });
  }
});
