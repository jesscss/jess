import { describe, expect, it } from 'vitest';

import { REQUIRED_CI_JOBS, ciProvenanceDecision } from '../ci-provenance.mjs';

const sha = 'e86cdd053b49c1de55b356f119689257efeaa34c';

type CheckRun = {
  name: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  html_url: string;
};

function run(name: string, overrides: Partial<CheckRun> = {}): CheckRun {
  return {
    name,
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
    html_url: `https://github.com/jesscss/jess/actions/runs/1/job/${name.length}`,
    ...overrides
  };
}

const green = REQUIRED_CI_JOBS.map(name => run(name));

describe('ciProvenanceDecision', () => {
  it('is proven only when every required job completed successfully for the exact SHA', () => {
    const decision = ciProvenanceDecision(sha, [...green, run('Jess CLI on Node current')]);
    expect(decision.proven).toBe(true);
    expect(decision.runs.map(entry => entry.name)).toEqual(REQUIRED_CI_JOBS);
    expect(decision.runs.every(entry => entry.url.startsWith('https://'))).toBe(true);
  });

  it('falls back to running the suites when the query could not be made', () => {
    expect(ciProvenanceDecision(sha, null).proven).toBe(false);
  });

  it('rejects a missing required job', () => {
    const decision = ciProvenanceDecision(sha, [green[0]]);
    expect(decision.proven).toBe(false);
    expect(decision.reason).toContain(REQUIRED_CI_JOBS[1]);
  });

  it('rejects a run for a different SHA', () => {
    const other = green.map(entry => ({ ...entry, head_sha: 'f'.repeat(40) }));
    expect(ciProvenanceDecision(sha, other).proven).toBe(false);
  });

  it('rejects a failed or still-running job', () => {
    const failed = [green[0], run(REQUIRED_CI_JOBS[1], { conclusion: 'failure' })];
    expect(ciProvenanceDecision(sha, failed).proven).toBe(false);
    const running = [green[0], run(REQUIRED_CI_JOBS[1], { status: 'in_progress', conclusion: null })];
    const decision = ciProvenanceDecision(sha, running);
    expect(decision.proven).toBe(false);
    expect(decision.reason).toContain('in_progress');
  });
});
