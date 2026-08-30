/*
 * The static complement's report. The GATE is `acceptance-matrix.test.ts`; this
 * file asserts only that the extractor WORKS, and prints the diff as candidate
 * material for the behavioural corpus.
 *
 * It is deliberately not a ratchet. An at-keyword a dialect names and css does
 * not is a candidate, not a defect: the grammars name productions at very
 * different granularities, and css reaches many at-rules through a generic arm
 * that names nothing at all. Turning this into a gate would ratchet a naming
 * convention, which is exactly the mistake the behavioural matrix exists to
 * avoid.
 *
 * The one thing it DOES assert is that the extractor sees `@charset` in all
 * four dialects — the calibration case, where scss names no production and the
 * keyword lives inside a `regex()` alternation. An extractor that misses it is
 * broken, and would report a large and entirely fictional css/scss diff.
 */
import { describe, expect, it } from 'vitest';
import { atKeywordsByDialect, extractAtKeywords, GRAMMAR_DIALECTS } from './at-keyword-literals.js';

describe('at-keyword literals across the four grammar sources', () => {
  const byDialect = atKeywordsByDialect();

  it('CALIBRATION — sees an at-keyword hidden inside a regex() alternation', () => {
    /* The exact scss arm: no `CharsetStatement` production exists there. */
    const expanded = extractAtKeywords(
      'regex(/@(?:charset|namespace|layer)(?![-_a-zA-Z0-9])/i)'
    );
    expect([...expanded].sort()).toEqual(['@charset', '@layer', '@namespace']);

    /* And prose mentions must NOT count, or the diff is all noise. */
    expect(extractAtKeywords('/* @charset is discussed here */').size).toBe(0);
    expect(extractAtKeywords('// @import in a line comment').size).toBe(0);

    for (const dialect of GRAMMAR_DIALECTS) {
      expect(
        byDialect[dialect].has('@charset'),
        `${dialect} grammar: extractor found no @charset literal — it is broken, not the grammar`
      ).toBe(true);
    }
  });

  it('extracts a non-empty set from every grammar', () => {
    for (const [dialect, keywords] of Object.entries(byDialect)) {
      expect(keywords.size, `${dialect} contributed no at-keywords`).toBeGreaterThan(5);
    }
  });

  it('reports the css-versus-superset diff as CANDIDATES for the behavioural corpus', () => {
    const css = byDialect.css;
    const lines: string[] = [];

    for (const dialect of ['less', 'scss', 'jess'] as const) {
      const extra = [...byDialect[dialect]].filter(k => !css.has(k)).sort();
      const missing = [...css].filter(k => !byDialect[dialect].has(k)).sort();
      lines.push(
        `${dialect}: ${byDialect[dialect].size} literals`
        + `\n  named in ${dialect}, absent from css (${extra.length}): ${extra.join(' ') || '—'}`
        + `\n  named in css, absent from ${dialect} (${missing.length}): ${missing.join(' ') || '—'}`
      );
    }

    /* Named in ALL THREE supersets and absent from css — the static echo of the
     * behavioural direction-2 signal, and the highest-value row here. */
    const inAllThree = [...byDialect.less]
      .filter(k => byDialect.scss.has(k) && byDialect.jess.has(k) && !css.has(k))
      .sort();

    console.log(
      `[at-keyword-literals] css: ${css.size} literals\n${lines.join('\n')}`
      + `\n  CANDIDATES — in all three supersets, absent from css (${inAllThree.length}): `
      + (inAllThree.join(' ') || '—')
      + '\n  READ THE "absent from <dialect>" ROWS WITH CARE: the three superset grammars COMPOSE on'
      + '\n  the CSS base, so an at-keyword css names and a superset does not is almost always'
      + '\n  INHERITED rather than missing. That noise is inherent to a name diff and is precisely'
      + '\n  why the behavioural matrix, not this file, is the gate.'
    );
  });
});
