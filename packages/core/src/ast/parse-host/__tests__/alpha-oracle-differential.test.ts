/**
 * Differential correctness oracle: ast/ render vs REAL less.js `alpha` (v5) goldens.
 *
 * WHY this exists (task #32 — replaces the legacy `oracle-run.mjs`):
 *   `oracle-run.mjs` produced its "oracle" from the legacy `tree/` Compiler, which
 *   has real `&`-expansion bugs on benchmark.less (doubles segments / drops
 *   ancestors) — so a diff against it flagged the ast/ engine as wrong when ast/
 *   was actually correct. The trustworthy v5 oracle is the OWNER-MAINTAINED less.js
 *   `alpha` fixture goldens (`:is()` compaction, nested-default, etc.), NOT a live
 *   re-render of anything Jess-backed (that would be circular — less.js alpha wraps
 *   Jess). We diff ast/ render against the COMMITTED `.css` next to each `.less` in
 *   the less.js alpha `test-data/tests-unit` corpus.
 *
 * THE GATE IS BASELINE-DIFF, NOT diff==0.
 *   ast/ is not yet a drop-in replacement (see `A4-BUILDERHOST-RETIREMENT.md` §2
 *   feature-gap list: quoted/selector interpolation loop, `+:`/`+_:` merge, url()
 *   `@{}`, imports/plugins the driver does not resolve). Many fixtures legitimately
 *   THROW or DIFF today. The gate is: NO fixture regresses below its recorded
 *   baseline status. New MATCHes are welcome; a MATCH→DIFF or MATCH→THREW fails.
 *   As feature gaps close, promote the baseline entry (statuses only ever improve).
 *
 * ORACLE LOCATION (external, READ-ONLY):
 *   default `~/git/worktrees/less.js/content-alpha3/packages/test-data/tests-unit`
 *   override with env `LESSJS_ALPHA_TESTDATA`. Absent → the suite SKIPS (a machine
 *   without the less.js worktree still builds green).
 *
 * INTENDED-DIVERGENCE ALLOWLIST: statuses in `alpha-oracle-baseline.json` ARE the
 *   allowlist — a DIFF/THREW recorded there is an accepted, not-yet-closed gap.
 *   Categorized rationale lives in `A4-BUILDERHOST-RETIREMENT.md` §2/§4.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAstFile } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../../../..');
const SCRATCH = path.join(REPO_ROOT, 'packages/core/.bmark-ast');
const BASELINE = path.join(HERE, 'alpha-oracle-baseline.json');

function corpusRoot(): string | undefined {
  const env = process.env.LESSJS_ALPHA_TESTDATA;
  if (env && fs.existsSync(env)) return env;
  const def = path.join(
    os.homedir(),
    'git/worktrees/less.js/content-alpha3/packages/test-data/tests-unit',
  );
  return fs.existsSync(def) ? def : undefined;
}

/** Status ranking — higher is better; the gate forbids dropping below baseline. */
const RANK = { MATCH: 3, MATCH_NORM: 2, DIFF: 1, THREW: 0 } as const;
type Status = keyof typeof RANK;

interface FixtureResult {
  status: Status;
  /** css byte length, or null if the render threw before producing bytes. */
  bytes: number | null;
  /** throw name:message when status === THREW, else undefined. */
  threw?: string;
}

/** Collapse trailing per-line whitespace + a single trailing newline. */
function normalize(s: string): string {
  return s.replace(/[ \t]+$/gm, '').replace(/\n+$/, '\n').trimEnd();
}

/**
 * Recursively collect `.less` files that have a sibling `.css` golden.
 *
 * EXCLUDES any fixture under a `legacy/` segment: in the alpha corpus a
 * `legacy/` subfolder holds the OLD Less 4.x reference output, not the v5
 * target. The top-level `.css` next to a `.less` is the accepted v5 golden;
 * the `legacy/*.css` files are 4.x and MUST NOT be diffed against v5 ast/
 * output (doing so flags every intended 4.x→v5 divergence as a false gap).
 */
function pairedFixtures(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (ent.name === 'legacy') continue; // 4.x reference, not a v5 target
        walk(path.join(dir, ent.name));
      } else {
        const p = path.join(dir, ent.name);
        if (ent.name.endsWith('.less') && fs.existsSync(`${p.slice(0, -5)}.css`)) out.push(p);
      }
    }
  };
  walk(root);
  return out.sort();
}

function evaluate(lessPath: string): FixtureResult {
  let res;
  try {
    res = renderAstFile(lessPath, { evaluator: buildEvaluator(makeBuiltinRegistry()) });
  } catch (e) {
    return { status: 'THREW', bytes: null, threw: `outer: ${(e as Error).message}` };
  }
  if (res.threw || res.css === undefined) {
    return { status: 'THREW', bytes: null, threw: res.threw ? `${res.threw.name}: ${res.threw.message}` : 'no css' };
  }
  const golden = fs.readFileSync(`${lessPath.slice(0, -5)}.css`, 'utf8');
  if (res.css === golden) return { status: 'MATCH', bytes: res.css.length };
  if (normalize(res.css) === normalize(golden)) return { status: 'MATCH_NORM', bytes: res.css.length };
  return { status: 'DIFF', bytes: res.css.length };
}

const ROOT = corpusRoot();

describe.skipIf(!ROOT)('ast/ vs less.js alpha differential oracle (baseline-diff gate)', () => {
  it('no fixture regresses below its recorded baseline status', () => {
    const root = ROOT!;
    const fixtures = pairedFixtures(root);
    const report: Record<string, FixtureResult> = {};
    for (const f of fixtures) {
      report[path.relative(root, f)] = evaluate(f);
    }

    const tally = { MATCH: 0, MATCH_NORM: 0, DIFF: 0, THREW: 0 };
    for (const r of Object.values(report)) tally[r.status]++;

    fs.mkdirSync(SCRATCH, { recursive: true });
    fs.writeFileSync(path.join(SCRATCH, 'alpha-oracle-report.json'), `${JSON.stringify(report, null, 2)}\n`);

    console.log('\n===== ast/ vs less.js alpha differential oracle =====');
    console.log('corpus     :', root);
    console.log('fixtures   :', fixtures.length);
    console.log('tally      :', JSON.stringify(tally));
    console.log('report     :', path.join(SCRATCH, 'alpha-oracle-report.json'));

    // First run (or `UPDATE_ORACLE_BASELINE=1`): write the baseline and pass.
    if (!fs.existsSync(BASELINE) || process.env.UPDATE_ORACLE_BASELINE) {
      fs.writeFileSync(BASELINE, `${JSON.stringify(report, null, 2)}\n`);
      console.log('baseline   : WROTE', BASELINE);
      return;
    }

    const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as Record<string, FixtureResult>;
    const regressions: string[] = [];
    for (const [name, cur] of Object.entries(report)) {
      const base = baseline[name];
      if (!base) continue; // newly added fixture — informational, not a regression
      if (RANK[cur.status] < RANK[base.status]) {
        regressions.push(`${name}: ${base.status} -> ${cur.status}${cur.threw ? ` (${cur.threw})` : ''}`);
      }
    }
    if (regressions.length) {
      console.log('REGRESSIONS:\n  ' + regressions.join('\n  '));
    }
    expect(regressions, `oracle regressions vs baseline:\n${regressions.join('\n')}`).toHaveLength(0);
  });
});
