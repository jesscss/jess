#!/usr/bin/env node
/*
 * `pnpm cod <args>` — the COD toolkit CLI (https://github.com/matthew-dean/cod-kit)
 * at the one pinned revision this repository's capability contracts are
 * verified with, locally and in CI. The toolkit is not published to npm; the
 * first run clones that revision into `.cache/cod-kit/<sha>` and builds it with
 * its own pinned pnpm (`tools/setup.mjs`), later runs reuse it.
 *
 *   pnpm cod catalog . capabilities                 the capability map
 *   pnpm cod inspect . capabilities/<id>/capability.json
 *   pnpm cod review . capabilities/<id>/capability.json --reason "…"
 *   pnpm verify:capabilities                         what CI runs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REVISION = 'eacab7d752916bf119be171de8dd4789f1c75c1b';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const kit = join(root, '.cache/cod-kit', REVISION);
const cli = join(kit, 'dist/cli.js');

function step(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    rmSync(kit, { recursive: true, force: true });

    // The toolkit could not be installed: nothing was checked (COD exit 2, unresolved).
    process.exit(2);
  }
}

if (!existsSync(cli)) {
  rmSync(kit, { recursive: true, force: true });
  mkdirSync(kit, { recursive: true });
  step('git', ['init', '-q'], kit);
  step('git', ['fetch', '-q', '--depth', '1', 'https://github.com/matthew-dean/cod-kit.git', REVISION], kit);
  step('git', ['checkout', '-q', 'FETCH_HEAD'], kit);
  step(process.execPath, ['tools/setup.mjs'], kit);
}

const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
process.exitCode = result.status ?? 2;
