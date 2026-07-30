#!/usr/bin/env node
/**
 * Capture the gating diagnostic parseman ALREADY emits during the production
 * macro build of each parser package, and roll it up per rule.
 *
 * This is the ground truth for "what does the shipping build path say", as
 * opposed to `run.mjs`, which re-derives the same question from an interpreted
 * rebuild. `check-macro-buildable.mjs` greps this same output only for
 * "falling back to runtime", so these warnings currently scroll past unread.
 */
import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './_load.mjs';

const PACKAGES = [
  { dir: 'packages/parser-shared', npm: '@jesscss/parser-shared' },
  { dir: 'packages/syntax/css/css-parser', npm: '@jesscss/css-parser' },
  { dir: 'packages/syntax/less/less-parser', npm: '@jesscss/less-parser' },
  { dir: 'packages/syntax/scss/scss-parser', npm: '@jesscss/scss-parser' },
  { dir: 'packages/syntax/jess/jess-parser', npm: '@jesscss/jess-parser' }
];

const CHOICE = /^parseman gating: choice @ (\S+) is (UNGATED|RECOVERABLE)[^[]*\[(\w+)\]/;
const out = {};

for (const pkg of PACKAGES) {
  rmSync(resolve(ROOT, pkg.dir, 'lib'), { recursive: true, force: true });
  const result = spawnSync('pnpm', ['--filter', pkg.npm, 'build'], { cwd: ROOT, encoding: 'utf8' });
  const text = String(result.stdout ?? '') + String(result.stderr ?? '');
  const byId = new Map();
  const other = [];
  for (const line of text.split('\n')) {
    const m = CHOICE.exec(line.trim());
    if (m) {
      const id = m[1];
      if (!byId.has(id)) {
        byId.set(id, { id, rule: id.split('#')[0], verdict: m[2], strategy: m[3], count: 0 });
      }
      byId.get(id).count += 1;
    } else if (/^parseman[ :]/.test(line.trim()) && !/^parseman gating:/.test(line.trim())) {
      other.push(line.trim());
    }
  }
  out[pkg.npm] = {
    status: result.status,
    distinctChoices: byId.size,

    /* Each package builds ESM+CJS, so every warning is emitted twice. */
    choices: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    otherParsemanLines: [...new Set(other)]
  };
  console.error(`${pkg.npm}: exit=${result.status} distinct ungated/recoverable choices=${byId.size}`);
}

const dir = resolve(ROOT, 'scripts/parseman-diagnostics/out');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'build-warnings.json'), JSON.stringify(out, null, 2));

for (const [npm, r] of Object.entries(out)) {
  const rules = new Map();
  for (const c of r.choices) {
    rules.set(c.rule, (rules.get(c.rule) ?? 0) + 1);
  }
  console.log(`\n${npm}  (${r.distinctChoices} choices across ${rules.size} rules)`);
  console.log('  ' + [...rules].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v > 1 ? `×${v}` : ''}`).join(', '));
  if (r.otherParsemanLines.length) {
    console.log('  other parseman output:');
    for (const l of r.otherParsemanLines) {
      console.log('    ' + l);
    }
  }
}
