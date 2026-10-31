import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The binary the pinned `deno` package installs, then Deno on PATH — the order @jesscss/plugin-js uses. */
function findDeno(): string | undefined {
  const runs = (command: string): boolean => spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;
  try {
    const packageDir = path.dirname(createRequire(import.meta.url).resolve('deno/package.json'));
    const binary = path.join(packageDir, process.platform === 'win32' ? 'deno.exe' : 'deno');
    if (runs(binary)) {
      return binary;
    }
  } catch {
    // not installed: fall back to PATH
  }
  return runs('deno') ? 'deno' : undefined;
}

const deno = findDeno();
const script = fileURLToPath(new URL('./deno/loader-channel.mjs', import.meta.url));

/*
 * A KNOWN LIMITATION, pinned (docs/design/DENO-SANDBOX-COMPILE.md §5): Deno's
 * module loader loads a file under ANY `node_modules` folder through
 * `require()` and `import()`, whatever `--allow-read` says. An `fs` read of
 * the same file, and a load from outside any `node_modules`, are denied. If a
 * Deno release changes this, this test fails, and the doc and the pinned
 * Deno version need a look.
 */
describe('Deno module loader and --allow-read (pinned behaviour)', () => {
  if (deno === undefined) {
    it.skip('skipped: no `deno` on PATH and the `deno` package binary is not installed', () => {});
    return;
  }

  it('loads code under any node_modules outside the read set, and refuses fs reads of it', () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jess-loader-channel-')));
    try {
      const root = path.join(base, 'root');
      const outside = path.join(base, 'outside');
      for (const dir of [root, path.join(outside, 'node_modules/pkg'), path.join(outside, 'plain')]) {
        fs.mkdirSync(dir, { recursive: true });
      }
      for (const dir of [path.join(outside, 'node_modules/pkg'), path.join(outside, 'plain')]) {
        fs.writeFileSync(path.join(dir, 'data.json'), '{"secret":"S"}');
        fs.writeFileSync(path.join(dir, 'index.mjs'), 'export const secret = "S";');
      }
      const run = spawnSync(deno, ['run', '--no-prompt', `--allow-read=${root}`, '--ignore-read', script, outside], {
        cwd: root,
        encoding: 'utf8',
        timeout: 60_000
      });
      expect(run.status, run.stderr).toBe(0);
      expect(JSON.parse(run.stdout.trim().split('\n').at(-1)!)).toEqual({
        requireUnderNodeModules: { ok: true, value: 'S' },
        importUnderNodeModules: { ok: true, value: 'S' },
        readUnderNodeModules: { ok: false, error: 'Error' },
        requireElsewhere: { ok: false, error: 'NotFound' },
        importElsewhere: { ok: false, error: 'TypeError' }
      });
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }, 70_000);
});
