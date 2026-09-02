#!/usr/bin/env node
/*
 * Guard: every package.json that declares `engines.node` must use the ONE canonical
 * Node range. Prevents silent drift — e.g. a release-refresh once bumped the
 * require(esm) floor 22.12 -> 22.18 (commit eb0303428, empty body), which breaks
 * engine-strict installs on Node 22.12-22.17 even though the runtime is supported.
 *
 * The canonical range tracks require(esm) support: Node 20.19.0 (backport) and
 * 22.12.0 (mainline, unflagged). Do NOT "modernize" the 22.x floor. If the range
 * MUST change, edit CANONICAL below in the SAME commit — that makes the change
 * explicit and reviewable instead of a silent per-manifest edit.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CANONICAL = '^20.19.0 || >=22.12.0';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name.startsWith('.')) {
      continue;
    }
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      yield* walk(p);
    } else if (name === 'package.json') {
      yield p;
    }
  }
}

const offenders = [];
for (const f of [join(root, 'package.json'), ...walk(join(root, 'packages'))]) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    continue;
  }
  const node = pkg.engines?.node;
  if (node != null && node !== CANONICAL) {
    offenders.push({ file: f.slice(root.length + 1), value: node });
  }
}

if (offenders.length) {
  console.error(`\n✗ node-engines drift — these declare engines.node != canonical "${CANONICAL}":`);
  for (const o of offenders) {
    console.error(`  ${o.file}: "${o.value}"`);
  }
  console.error(`\nThe canonical range tracks require(esm) (Node 20.19.0 backport + 22.12.0 mainline).`);
  console.error(`Do NOT raise the 22.x floor (e.g. 22.18) — it breaks engine-strict installs on 22.12-22.17.`);
  console.error(`If the range truly must change, edit CANONICAL in scripts/check-node-engines.mjs in the same commit.`);
  process.exit(1);
}

console.log(`✓ node-engines: all declared engines.node == "${CANONICAL}"`);
