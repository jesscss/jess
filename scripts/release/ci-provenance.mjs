/*
 * Did dev CI already run the source suites on the commit an alpha snapshot was
 * cut from? The snapshot's provenance record names that commit, and the
 * source-sync gate at the start of the preflight proves the tree matches it
 * (apart from manifest versions), so a green CI run there is evidence for this
 * tree. Every job named here must have a completed, successful check-run for
 * that exact SHA; anything else (missing job, failure, still running, no
 * network, no `gh`) yields "run the suites yourself".
 */
import { spawnSync } from 'node:child_process';

/* Job names from .github/workflows/ci.yml; a rename here or there is fail-safe. */
export const REQUIRED_CI_JOBS = [
  'Build · lint · types · tests · gates',
  'Source tests (build-free)'
];

/**
 * Pure decision over a GitHub check-runs response (`check_runs` array or null
 * when the query could not be made).
 */
export function ciProvenanceDecision(sha, checkRuns, requiredJobs = REQUIRED_CI_JOBS) {
  if (!Array.isArray(checkRuns)) {
    return { proven: false, reason: 'GitHub check-runs unavailable', runs: [] };
  }
  const runs = [];
  for (const job of requiredJobs) {
    const run = checkRuns.find(candidate => candidate?.name === job && candidate.head_sha === sha);
    if (!run) {
      return { proven: false, reason: `no check-run named '${job}' for ${sha}`, runs: [] };
    }
    if (run.status !== 'completed' || run.conclusion !== 'success') {
      return {
        proven: false,
        reason: `'${job}' for ${sha} is ${run.status}/${run.conclusion ?? 'no conclusion'} (${run.html_url})`,
        runs: []
      };
    }
    runs.push({ name: job, url: run.html_url });
  }
  return { proven: true, reason: `${runs.length} required CI job(s) succeeded for ${sha}`, runs };
}

/** Latest check-runs for `sha` via `gh`, or null when that is not possible. */
export function fetchCheckRuns(sha, rootDir = process.cwd()) {
  const result = spawnSync('gh', [
    'api',
    `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`,
    '--jq',
    '.check_runs'
  ], { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  if (result.error || result.status !== 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
