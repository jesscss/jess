/**
 * `@keyframes` recognition, in all four dialects.
 *
 * ## Why this file exists
 *
 * The CSS suite had FOUR `@keyframes` fixtures and every one of them was a
 * reject case (`test/css/errors/keyframes-*.css`: a bad ident selector, a
 * missing selector, a dimension selector, a bare number selector). Nothing
 * anywhere asserted that a percentage keyframe selector is ACCEPTED. A grammar
 * that rejected `0%`, `50%` and `100%` outright therefore passed the entire
 * suite — the four reject fixtures would all still have rejected, for the wrong
 * reason. `ls test/css | grep -i keyframe` came back empty.
 *
 * Reject coverage without accept coverage is not coverage. It cannot tell
 * "rejects what it should" from "rejects everything".
 *
 * The accepting cases are pinned here rather than only in the CSS fixture
 * directory because the ruling under test is cross-dialect: **valid CSS is
 * valid in all four dialects**. A percentage keyframe selector that works in
 * `css` and not in `jess` is as much a defect as the reverse.
 *
 * Spec: css-animations-1 §4 — `<keyframe-selector> = from | to | <percentage>`,
 * `<keyframe-block-list>` is a comma-separated list of those.
 *
 * ## Relationship to `test/css-superset-corpus.ts`
 *
 * That table enumerates the CSS construct space from the specs and carries ONE
 * representative per construct — three of them are `@keyframes` (a percentage
 * selector, a `from` selector, `@-webkit-keyframes`). This file is the DEPTH
 * pin for the same at-rule, and the two do different jobs: the enumeration
 * answers "is this construct probed at all", which is the question that was
 * answered `no`; this file answers "which spellings of it", including the
 * reject half, which an enumeration of accepted constructs cannot carry. Three
 * of the nineteen forms below overlap that table on purpose.
 */
import { describe, expect, it } from 'vitest';
import { DIALECTS, acceptingDialects, parseVerdict } from '../dialects.js';

/**
 * Every accepting form, one construct per entry.
 *
 * Counted, not just iterated: a list that silently empties would leave this
 * suite green while asserting nothing, which is the exact failure mode the file
 * was written to close.
 */
const ACCEPTS: ReadonlyArray<readonly [string, string]> = [
  ['from/to selectors', '@keyframes a { from { opacity: 0 } to { opacity: 1 } }'],
  ['percentage selectors', '@keyframes a { 0% { opacity: 0 } 100% { opacity: 1 } }'],
  ['interior percentage', '@keyframes a { 50% { opacity: 0.5 } }'],
  ['fractional percentage', '@keyframes a { 12.5% { opacity: 0 } }'],
  ['leading-dot percentage', '@keyframes a { .5% { opacity: 0 } }'],
  ['trailing-zero percentage', '@keyframes a { 100.0% { opacity: 1 } }'],
  ['percentage selector list', '@keyframes a { 0%, 50% { opacity: 0 } }'],
  ['mixed keyword/percentage list', '@keyframes a { from, 75% { opacity: 0 } }'],
  ['spaced selector list', '@keyframes a { 25% , 60% , to { opacity: 1 } }'],
  ['keyword and percentage blocks', '@keyframes a { from { opacity: 0 } 0% { opacity: 0 } to { opacity: 1 } }'],
  ['uppercase at-keyword', '@KEYFRAMES a { from { opacity: 0 } }'],
  ['uppercase selectors', '@keyframes a { FROM { opacity: 0 } TO { opacity: 1 } }'],
  ['vendor-prefixed at-keyword', '@-webkit-keyframes a { 0% { opacity: 0 } 100% { opacity: 1 } }'],
  ['quoted animation name', '@keyframes "quoted name" { 0% { opacity: 0 } }'],
  ['empty at-rule body', '@keyframes a {}'],
  ['empty keyframe block', '@keyframes a { 0% {} }'],
  ['trailing semicolons in blocks', '@keyframes a { 0% { opacity: 0; } 100% { opacity: 1; } }'],
  ['nested in @media', '@media screen { @keyframes a { 0% { opacity: 0 } } }'],
  ['nested in @supports', '@supports (opacity: 0) { @keyframes a { 0% { opacity: 0 } } }']
];

/**
 * Forms every dialect must refuse. These duplicate the CSS-only fixtures under
 * `test/css/errors/` on purpose: the point is that the rejection is shared, and
 * a dialect quietly accepting one of them is the superset ruling running
 * backwards.
 */
const REJECTS: ReadonlyArray<readonly [string, string]> = [
  ['bare number selector', '@keyframes a { 0 { opacity: 1 } }'],
  ['dimension selector', '@keyframes a { 50px { opacity: 1 } }'],
  ['arbitrary ident selector', '@keyframes a { foo { opacity: 1 } }'],
  ['block with no selector', '@keyframes a { { opacity: 1 } }']
];

describe('@keyframes across all four dialects', () => {
  it('covers the accepting and rejecting forms it claims to', () => {
    /* Prints on success: a check that says nothing when it passes is
     * indistinguishable from one that never ran. */
    expect(ACCEPTS.length).toBe(19);
    expect(REJECTS.length).toBe(4);
    expect(DIALECTS.length).toBe(4);
    console.log(
      `[keyframes] ${ACCEPTS.length} accept forms x ${REJECTS.length} reject forms `
      + `x ${DIALECTS.length} dialects = ${(ACCEPTS.length + REJECTS.length) * DIALECTS.length} verdicts`
    );
  });

  for (const dialect of DIALECTS) {
    describe(dialect, () => {
      for (const [name, source] of ACCEPTS) {
        it(`accepts ${name}`, () => {
          const verdict = parseVerdict(dialect, source);
          expect(
            verdict.parses,
            `${dialect} rejected ${JSON.stringify(source)}: `
            + `unconsumedFrom=${verdict.unconsumedFrom}, recovered=${verdict.recovered}, `
            + `expected=${JSON.stringify(verdict.expected.slice(0, 6))}`
          ).toBe(true);
        });
      }

      for (const [name, source] of REJECTS) {
        it(`rejects ${name}`, () => {
          expect(parseVerdict(dialect, source).parses, `${dialect} accepted ${JSON.stringify(source)}`)
            .toBe(false);
        });
      }
    });
  }

  it('accepts every form in every dialect — the one-way superset ruling', () => {
    const divergent = ACCEPTS
      .map(([name, source]) => ({ name, source, accepted: acceptingDialects(source) }))
      .filter(entry => entry.accepted.length !== DIALECTS.length);
    expect(divergent, JSON.stringify(divergent, null, 2)).toEqual([]);
  });
});
