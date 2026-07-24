import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/jess-parser';

/**
 * A conditional at-rule prelude is the CSS "value hole": a composite shape whose
 * inner value production each dialect must supply itself. `internal-css-recognition`
 * can only hold `g`-free `regex()` terminals, so the shared artifact stops at the
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
const paren = (inner: unknown) => ({ type: 'Block', delimiter: 'paren', inner });
const op = (operator: string, left: unknown, right: unknown) => ({ type: 'Operation', operator, left, right });
const ratio = (n: string, d: string) => op('/', dim(n), dim(d));

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
    { type: 'SpacedValue', parts: [paren(op(':', kw('min-width'), dim('400px'))), kw('and'), paren(op(':', kw('min-height'), dim('400px')))] }]
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

/** A comma-separated media-query list, mediaqueries-4 §2.1. */
const MEDIA_QUERY_LIST = { type: 'List', sep: ',', value: [{ type: 'Keyword', src: 'screen' }, { type: 'Keyword', src: 'print' }] };

function prelude(source: string): unknown {
  const first = parse(source).children[0];
  if (first === undefined || !('prelude' in first)) {
    throw new TypeError(`Expected an at-rule prelude for: ${source}`);
  }
  return first.prelude;
}

describe('Jess conditional at-rule value holes', () => {
  for (const [group, cases] of [
    ['<ratio>', RATIO], ['<mf-range>', RANGE], ['<mf-value>', FEATURE_VALUE],
    ['query composition', COMPOSITION], ['@supports', SUPPORTS]
  ] as const) {
    for (const [label, source, expected] of cases) {
      it(`${group}: accepts ${label}`, () => {
        expect(prelude(source), source).toMatchObject(expected);
      });
    }
  }

  /**
   * A comma-separated media-query list is a `List`, not a whitespace join —
   * mediaqueries-4 §2.1. Encoded as a constant because css-parser currently
   * folds the comma into a `SpacedValue`; see MEDIA_QUERY_LIST below.
   */
  it('reduces a comma-separated media-query list', () => {
    expect(prelude('@media screen, print { a { color: red; } }')).toMatchObject(MEDIA_QUERY_LIST);
  });

  /**
   * The custom-property `!important` tail — css-syntax-3 §5.5.6 strips the marker
   * and sets the priority flag before the original-text step. This shipped wrong in
   * all four dialects because "custom-property value text" had three separate
   * implementations; `custom-property.test.ts` owns the full matrix, and this is the
   * regression anchor that keeps the at-rule work from re-forking it.
   */
  it('keeps the custom-property !important tail out of the preserved value', () => {
    expect(parse('a { --x: red !important; }')).toMatchObject({
      children: [{ type: 'Rule', body: [{ type: 'Declaration', name: '--x', value: { type: 'Any', src: 'red' }, important: true }] }]
    });
  });

  /**
   * `;` is a declaration-list SEPARATOR, not a terminator — css-syntax-3 §5.4.7
   * "consume a list of declarations" ends a declaration at `;` OR at the end of
   * the block, and an empty declaration between two separators is discarded
   * rather than being an error. Valid CSS must parse in every dialect, so a
   * missing trailing `;` cannot be a dialect difference.
   *
   * Cross-dialect status when this landed: css and less accept all of these;
   * scss rejects `;;`, `{ ; }`, and a leading `;`; less and css reject a
   * declaration with no `;` directly before a nested at-rule. Those are gaps in
   * those dialects, not intended divergence.
   */
  for (const [label, source] of [
    ['a block with no trailing semicolon', 'a { color: red }'],
    ['a block with a trailing semicolon', 'a { color: red; }'],
    ['a doubled separator', 'a { color: red;; }'],
    ['an empty declaration', 'a { ; }'],
    ['a leading separator', 'a { ; color: red }'],
    ['a final declaration among several', 'a { color: red; background: blue }'],
    ['an unterminated custom property', 'a { --x: 1px }'],
    ['an unterminated important declaration', 'a { color: red !important }'],
    ['a declaration before a nested rule', 'a { color: red; b { x: 1 } }'],
    ['a declaration before a nested at-rule', 'a { color: red; @media all { x: 1 } }']
  ] as Array<[string, string]>) {
    it(`declaration list: accepts ${label}`, () => {
      expect(() => parse(source), source).not.toThrow();
    });
  }

  it('preserves a custom-property value verbatim inside a conditional at-rule', () => {
    expect(parse('@media (min-width: 600px) { a { --x: 1px solid black; } }')).toMatchObject({
      children: [{ type: 'AtRuleBlock', body: [{ type: 'Rule', body: [{ type: 'Declaration', name: '--x', value: { type: 'Any', src: '1px solid black' } }] }] }]
    });
  });
});
