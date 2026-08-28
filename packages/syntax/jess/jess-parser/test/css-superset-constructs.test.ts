/*
 * The spec-derived CSS construct space, run against the Jess grammar.
 *
 * The table lives in `test/css-superset-corpus.ts` and drives all four dialect
 * suites from ONE enumeration, because "valid CSS is valid in all four
 * dialects" is one-way: a construct three dialects accept and the fourth
 * rejects is a defect in the fourth, not a dialect difference.
 *
 * The enumeration is derived from the CSS specs, NOT from the grammars —
 * a checklist read off the grammar can only tell you the grammar covers what
 * the grammar covers. That is exactly how `@keyframes` came to have no CSS
 * fixture at all while every suite stayed green.
 *
 * PINNED DEFECT cases assert the CURRENT, WRONG behaviour and carry the reason
 * in the corpus entry's `defect` field. Fixing the defect fails the pin: drop
 * the dialect from `brokenIn` and the entry becomes a contract.
 */
import { describe, expect, it } from 'vitest';
import { parseJessCst } from '@jesscss/jess-parser/cst';
import { acceptedIn, pinnedDefectsIn, CSS_CONSTRUCTS } from '../../../../../test/css-superset-corpus.js';

const DIALECT = 'jess';

/**
 * A clean parse is all three at once. `ok` alone is not enough: the CST reports
 * success on input it never consumed, so a non-null `unconsumedFrom` is a
 * silent truncation that would otherwise read as coverage.
 */
function parsesCleanly(source: string): { clean: boolean; detail: string } {
  try {
    const cst = parseJessCst(source);
    const clean = cst.ok && cst.errors.length === 0 && cst.unconsumedFrom === null;
    return {
      clean,
      detail: `ok=${cst.ok} errors=${cst.errors.length} unconsumedFrom=${String(cst.unconsumedFrom)}`
    };
  } catch (error) {
    return { clean: false, detail: `threw ${String(error instanceof Error ? error.message : error)}` };
  }
}

describe('CSS construct space — Jess grammar', () => {
  it('enumerates a non-empty corpus', () => {
    expect(CSS_CONSTRUCTS.length).toBeGreaterThan(100);
  });

  const accepted = acceptedIn(DIALECT);
  it.each(accepted.map(construct => [construct.id, construct.source] as const))(
    'accepts %s',
    (_id, source) => {
      const { clean, detail } = parsesCleanly(source);
      expect(clean, `${JSON.stringify(source)} → ${detail}`).toBe(true);
    }
  );

  const pinned = pinnedDefectsIn(DIALECT);
  it.each(pinned.map(construct => [construct.id, construct.source, construct.defect ?? ''] as const))(
    'PINNED DEFECT — rejects %s',
    (_id, source, defect) => {
      const { clean, detail } = parsesCleanly(source);
      expect(
        clean,
        `This valid CSS now parses in ${DIALECT} — the defect is fixed. Drop `
        + `"${DIALECT}" from its brokenIn list in test/css-superset-corpus.ts so `
        + `the case becomes a contract. Pinned defect: ${defect} (${detail})`
      ).toBe(false);
    }
  );
});
