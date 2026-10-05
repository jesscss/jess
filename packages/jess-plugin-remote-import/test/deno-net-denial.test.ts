import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Deno on PATH first, then the binary the `deno` package installs — the order @jesscss/plugin-js uses. */
function findDeno(): string | undefined {
  const runs = (command: string): boolean => spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;
  if (runs('deno')) {
    return 'deno';
  }
  try {
    const packageDir = path.dirname(createRequire(import.meta.url).resolve('deno/package.json'));
    const binary = path.join(packageDir, process.platform === 'win32' ? 'deno.exe' : 'deno');
    return runs(binary) ? binary : undefined;
  } catch {
    return undefined;
  }
}

const deno = findDeno();
const script = fileURLToPath(new URL('./deno/net-denial.ts', import.meta.url));

/*
 * The claim this proves: under Deno the allow list is enforced by the runtime,
 * not only by this plugin. The script's plugin allows both hosts, so only
 * `--allow-net` can stop the off-list one. A positive control shows the denial
 * is per host, not a blanket network ban, and a runtime-followed redirect shows
 * the runtime re-checks every hop.
 */
describe('Deno --allow-net enforces the remote-import allow list', () => {
  if (deno === undefined) {
    it.skip('skipped: no `deno` on PATH and the `deno` package binary is not installed', () => {});
    return;
  }

  it('denies an off-list host at the runtime with the app-level check out of the way', () => {
    const run = spawnSync(deno, ['run', '--no-prompt', '--allow-net=allowed.invalid,127.0.0.1', script], {
      cwd: path.dirname(script),
      encoding: 'utf8',
      timeout: 60_000
    });

    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout.trim().split('\n').at(-1)!)).toEqual({
      denied: 'runtime-denied',
      allowed: 'reached-network',
      guardedDenied: 'runtime-denied',
      guardedAllowed: 'reached-network',
      redirectHop: 'runtime-denied'
    });
  }, 70_000);
});
