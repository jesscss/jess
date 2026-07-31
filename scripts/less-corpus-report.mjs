#!/usr/bin/env node
/**
 * Full Less corpus completeness report (reporting-only).
 *
 * Orchestrates the src-path renderer in `packages/jess/test/less/_corpus-slice.test.ts`.
 * Because adversarial `tests-error` fixtures can OOM or infinite-loop, each slice
 * runs in a SEPARATE, killable `vitest` child (detached process group → SIGKILL on
 * timeout); `vitest` is also what supplies the TS transform for the src path. The
 * child appends one JSONL result line per fixture, flushing after each, so a
 * killed child pinpoints the exact culprit (first fixture with no line); the
 * parent records it as a crash and resumes past it.
 *
 * Output: packages/jess/test/less/CORPUS-REPORT.md + .json
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const jessDir = path.join(repoRoot, 'packages', 'jess');
const vitestBin = path.join(repoRoot, 'node_modules', '.bin', 'vitest');
const sliceTest = 'test/less/_corpus-slice.test.ts';
const reportDir = path.join(jessDir, 'test', 'less');
const require = createRequire(path.join(repoRoot, 'package.json'));

const BATCH = 40;
const BATCH_TIMEOUT_MS = 180_000;
const tmp = mkdtempSync(path.join(tmpdir(), 'less-corpus-'));

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function corpusProvenance() {
  const testDataRoot = path.dirname(require.resolve('@less/test-data/package.json'));
  const testDataChanges = git(['status', '--porcelain=v1', '--', '.'], testDataRoot)
    ?.split('\n')
    .filter(Boolean) ?? [];

  return {
    generatedAt: new Date().toISOString(),
    jessCommit: git(['rev-parse', 'HEAD'], repoRoot),
    route: 'src-path Vitest renderer in packages/jess/test/less/_corpus-slice.test.ts',
    configuration: {
      baseOutput: { collapseNesting: true },
      fixtureConfig: 'getTestCases() fixture-local config merged for each expected output'
    },
    testData: {
      root: testDataRoot,
      commit: git(['rev-parse', 'HEAD'], testDataRoot),
      scopedChanges: testDataChanges
    },
    runner: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    }
  };
}

const provenance = corpusProvenance();

function runVitest(env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(vitestBin, ['run', sliceTest, '--no-file-parallelism'], {
      cwd: jessDir,
      detached: true, // own process group so we can SIGKILL vitest + its workers
      stdio: 'ignore',
      env: { ...process.env, TEST: 'true', CI: 'true', ...env }
    });
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch { /* already gone */ }
    }, timeoutMs);
    child.on('exit', () => {
      clearTimeout(timer);
      resolve({ killed });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ killed: true });
    });
  });
}

function readJsonl(file) {
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// --- 1. discover ---
const jobsOut = path.join(tmp, 'jobs.json');
process.stdout.write('discovering corpus…\n');
await runVitest({ CORPUS_MODE: 'discover', CORPUS_JOBS_OUT: jobsOut }, 120_000);
if (!existsSync(jobsOut)) {
  console.error('discovery failed — no jobs written');
  process.exit(1);
}
const allJobs = JSON.parse(readFileSync(jobsOut, 'utf8'));
process.stdout.write(`discovered ${allJobs.length} cases\n`);

// --- 2. render slices with resume-past-crash ---
const results = [];
let queue = allJobs;
let batchNo = 0;
while (queue.length) {
  batchNo++;
  const slice = queue.slice(0, BATCH);
  const sliceFile = path.join(tmp, 'slice.json');
  const resultFile = path.join(tmp, 'result.jsonl');
  writeFileSync(sliceFile, JSON.stringify(slice));
  writeFileSync(resultFile, '');
  const { killed } = await runVitest(
    { CORPUS_MODE: 'render', CORPUS_SLICE_FILE: sliceFile, CORPUS_RESULT_FILE: resultFile },
    BATCH_TIMEOUT_MS
  );
  const done = readJsonl(resultFile);
  const doneFiles = new Set(done.map(d => d.file));
  results.push(...done);

  let advanced = 0;
  for (const job of slice) {
    if (doneFiles.has(job.file)) {
      advanced++;
      continue;
    }

    // first not-done in a spawned slice = the fixture the child died on
    results.push({ file: job.file, kind: job.kind, outcome: killed ? 'timeout' : 'crash', detail: 'child died here (OOM/hang)' });
    advanced++;
    break;
  }
  queue = queue.slice(advanced);
  process.stdout.write(`batch ${batchNo}: +${done.length} done, ${queue.length} left${killed ? ' (child killed)' : ''}\n`);
}

/*
 * --- 3. aggregate + report ---
 * Fixtures the hard gate (all-less.test.ts) already skips or marks
 * expected-failure — so we can flag which non-passes are already-known vs NEW.
 */
const known = new Set();
try {
  const gateSrc = readFileSync(path.join(reportDir, 'all-less.test.ts'), 'utf8');
  for (const m of gateSrc.matchAll(/['"`](tests-(?:unit|config|error)\/[^'"`]+\.less)['"`]/g)) {
    known.add(m[1]);
  }
} catch { /* gate file optional */ }
const tag = file => (known.has(file.replace(/ \[\d+\/\d+\]$/, '')) ? 'known' : 'NEW');

const render = results.filter(r => r.kind === 'render');
const error = results.filter(r => r.kind === 'error');
const group = f => f.file.split('/')[0];
const groups = [...new Set(render.map(group))];
const count = (rows, o) => rows.filter(r => r.outcome === o).length;

const L = [];
L.push('# Less corpus completeness report', '');
L.push(`Generated by \`scripts/less-corpus-report.mjs\` over the full \`@less/test-data\` corpus (src path).`, '');
L.push('Reporting-only — outcomes measured, not gated. Each slice ran in an isolated, killable vitest child.', '');
L.push('## Run provenance', '');
L.push(`- Generated: \`${provenance.generatedAt}\``);
L.push(`- Jess commit: \`${provenance.jessCommit ?? 'unavailable'}\``);
L.push(`- Route: ${provenance.route}`);
L.push(`- Configuration: base \`output.collapseNesting: true\`; ${provenance.configuration.fixtureConfig}`);
L.push(`- Test data: \`${provenance.testData.root}\` at \`${provenance.testData.commit ?? 'unavailable'}\``);
L.push(`- Test-data working tree: ${provenance.testData.scopedChanges.length ? `dirty (\`${provenance.testData.scopedChanges.join('`, `')}\`)` : 'clean'}`);
L.push(`- Runner: \`${provenance.runner.node}\` on \`${provenance.runner.platform}/${provenance.runner.arch}\``, '');
L.push('', '## Render corpus (expected CSS)', '');
L.push('| group | cases | pass | mismatch | error | timeout | crash |');
L.push('|---|--:|--:|--:|--:|--:|--:|');
for (const g of groups) {
  const rs = render.filter(r => group(r) === g);
  L.push(`| ${g} | ${rs.length} | ${count(rs, 'pass')} | ${count(rs, 'mismatch')} | ${count(rs, 'error')} | ${count(rs, 'timeout')} | ${count(rs, 'crash')} |`);
}
L.push(`| **total** | **${render.length}** | **${count(render, 'pass')}** | **${count(render, 'mismatch')}** | **${count(render, 'error')}** | **${count(render, 'timeout')}** | **${count(render, 'crash')}** |`);
L.push('', '## Error corpus (`tests-error` — classify only)', '');
L.push(`- errored (matches Less): **${count(error, 'errored')}** / ${error.length}`);
L.push(`- **accepted — DIVERGENCE, needs review: ${count(error, 'accepted')}**  _(Jess accepts what Less rejects: intentional repair or real gap)_`);
L.push(`- timeout: ${count(error, 'timeout')}, crash: ${count(error, 'crash')}`, '');
const accepted = error.filter(r => r.outcome === 'accepted');
if (accepted.length) {
  L.push('### Divergences to review (accepted where Less errors)', '');
  accepted.forEach(r => L.push(`- \`${r.file}\` (${tag(r.file)})`));
  L.push('');
}
const nonPass = render.filter(r => r.outcome !== 'pass');
const newNonPass = nonPass.filter(r => tag(r.file) === 'NEW');
L.push('## Render non-passes', '');
L.push(`${nonPass.length} total — ${nonPass.length - newNonPass.length} already known to the gate (skipped/expected-failure), **${newNonPass.length} NEW**.`, '');
L.push('### NEW (not skipped/expected-failure in the gate)', '');
for (const r of newNonPass) {
  L.push(`- [${r.outcome}] \`${r.file}\`${r.detail ? ` — ${r.detail}` : ''}`);
}
L.push('', '### Known (gate already skips / expects-failure)', '');
for (const r of nonPass.filter(r => tag(r.file) === 'known')) {
  L.push(`- [${r.outcome}] \`${r.file}\``);
}
L.push('');

const md = L.join('\n');
writeFileSync(path.join(reportDir, 'CORPUS-REPORT.md'), md, 'utf8');
writeFileSync(path.join(reportDir, 'CORPUS-REPORT.json'), JSON.stringify({ provenance, render, error }, null, 2), 'utf8');
process.stdout.write('\n' + md.split('\n').slice(0, 26).join('\n') + '\n\n→ packages/jess/test/less/CORPUS-REPORT.md\n');

const blocked = [
  ...render.filter(r => r.outcome === 'timeout' || r.outcome === 'crash'),
  ...error.filter(r => r.outcome === 'timeout' || r.outcome === 'crash')
];
if (blocked.length > 0) {
  process.stderr.write(
    `\nLess corpus report hit ${blocked.length} timeout/crash result(s); see packages/jess/test/less/CORPUS-REPORT.md for the stuck fixture(s).\n`
  );
  process.exitCode = 1;
}
