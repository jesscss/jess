/*
 * The OVER-NARROW probe runner.
 *
 * Reports, it does not gate. `over-narrow-corpus.ts` asserts spec validity from
 * OUTSIDE the repo, so a red gate here would be a red gate about work that has
 * not been scheduled. What it must do instead is be DEMONSTRABLY sensitive, and
 * the two control assertions below are that demonstration:
 *
 *  - a POSITIVE control — an input all four must reject — proving the runner can
 *    report a reject at all. An instrument that reports "accepted" for
 *    everything would otherwise show a clean sweep and be indistinguishable from
 *    four perfect grammars.
 *  - a DIVERGENCE control — `svg|circle`, which less accepts and css rejects —
 *    proving the runner resolves four SEPARATE grammars and not one grammar four
 *    times. A harness that accidentally bound the same runner to all four keys
 *    would agree with itself perfectly and report zero findings.
 *
 * Both controls are asserted, so this file goes red if the instrument stops
 * being able to see. The findings themselves are printed.
 */
import { describe, expect, it } from 'vitest';
import { DIALECTS, type Dialect, parseVerdict } from '../dialects.js';
import { OVER_NARROW_PROBES, PROBE_GROUPS, type Probe } from './over-narrow-corpus.js';

type Row = {
  readonly probe: Probe;
  readonly verdicts: Record<Dialect, boolean>;
  readonly crashes: Record<Dialect, string | undefined>;
};

/*
 * The four dialects are spelled out rather than folded from `DIALECTS`. A fold
 * builds an index signature, and narrowing that back to `Record<Dialect, …>`
 * needs a type assertion the lint config rightly refuses. Four keys, written
 * once.
 */
function measure(probe: Probe): Row {
  const css = parseVerdict('css', probe.source);
  const less = parseVerdict('less', probe.source);
  const scss = parseVerdict('scss', probe.source);
  const jess = parseVerdict('jess', probe.source);
  return {
    probe,
    verdicts: {
      css: css.parses,
      less: less.parses,
      scss: scss.parses,
      jess: jess.parses
    },
    crashes: {
      css: css.crashed,
      less: less.crashed,
      scss: scss.crashed,
      jess: jess.crashed
    }
  };
}

const ROWS: readonly Row[] = OVER_NARROW_PROBES.map(measure);

function find(id: string): Row {
  const row = ROWS.find(candidate => candidate.probe.id === id);
  if (row === undefined) {
    throw new Error(`probe ${id} is missing — the control cannot be evaluated`);
  }
  return row;
}

describe('over-narrow probe: instrument sensitivity', () => {
  it('reports a reject for an input no dialect can accept', () => {
    const rejected = DIALECTS.filter(
      dialect => !parseVerdict(dialect, 'a { color: red } }}}').parses
    );
    expect(rejected).toEqual([...DIALECTS]);
  });

  /*
   * `|a` and not `svg|circle`, deliberately. The obvious divergence control is
   * `svg|circle`, and it does not work: css ACCEPTS it — through
   * `combinator = keywords(['||', '>', '+', '~', '|'])`
   * (`packages/syntax/css/css-parser/src/grammar.ts:998`), which reads the
   * namespace bar as a combinator and builds two compound segments. That is a
   * WRONG NODE, not an accept, and it is exactly why an acceptance-only
   * instrument needs `over-narrow-node-probe.test.ts` beside it. `|a` has no
   * left operand for the combinator reading, so css genuinely rejects it and it
   * is a usable control.
   */
  it('resolves four separate grammars, not one grammar four times', () => {
    const row = find('sel-03');
    expect(row.verdicts.less).toBe(true);
    expect(row.verdicts.css).toBe(false);
  });

  it('reports an accept for plain CSS in every dialect', () => {
    const accepted = DIALECTS.filter(
      dialect => parseVerdict(dialect, 'a { color: red }').parses
    );
    expect(accepted).toEqual([...DIALECTS]);
  });
});

describe('over-narrow probe: findings', () => {
  it('prints the matrix', () => {
    const lines: string[] = [];
    const mark = (row: Row, dialect: Dialect): string =>
      row.crashes[dialect] !== undefined ? '!' : (row.verdicts[dialect] ? 'Y' : 'n');

    for (const [group, probes] of Object.entries(PROBE_GROUPS)) {
      lines.push(`\n### ${group}`);
      for (const probe of probes) {
        const row = find(probe.id);
        const cells = DIALECTS.map(dialect => mark(row, dialect)).join(' ');
        const flag = probe.valid && DIALECTS.some(dialect => !row.verdicts[dialect]) ? ' <== DEFECT' : '';
        lines.push(
          `${probe.id} [${cells}] ${probe.valid ? 'valid ' : 'INVALID'} ${probe.name}${flag}`
        );
      }
    }

    const defects = ROWS.filter(
      row => row.probe.valid && DIALECTS.some(dialect => !row.verdicts[dialect])
    );
    const crashes = ROWS.filter(row => DIALECTS.some(dialect => row.crashes[dialect] !== undefined));
    const overAccepted = ROWS.filter(
      row => !row.probe.valid && DIALECTS.every(dialect => row.verdicts[dialect])
    );

    lines.push(`\ncolumns: ${DIALECTS.join(' ')}`);
    lines.push(`probes: ${ROWS.length}  valid: ${ROWS.filter(r => r.probe.valid).length}`);
    lines.push(`valid-but-rejected somewhere: ${defects.length}`);
    lines.push(`rejected by ALL FOUR (invisible to the acceptance matrix): ${
      defects.filter(row => DIALECTS.every(dialect => !row.verdicts[dialect])).length
    }`);
    lines.push(`crashes: ${crashes.length}`);
    lines.push(`invalid-but-accepted everywhere: ${overAccepted.length}`);
    for (const row of crashes) {
      for (const dialect of DIALECTS) {
        if (row.crashes[dialect] !== undefined) {
          lines.push(`CRASH ${row.probe.id} ${dialect}: ${row.crashes[dialect]}`);
        }
      }
    }

    console.log(lines.join('\n'));
    expect(ROWS.length).toBe(OVER_NARROW_PROBES.length);
  });
});
