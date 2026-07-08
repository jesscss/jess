#!/usr/bin/env node
/**
 * Build guard: every functional grammar MUST stay fully macro-buildable.
 *
 * The parseman macro plugin compiles each `rules()`/`compose()` grammar to inline
 * JS at build time. If a rule can't be compiled it silently falls back to the
 * INTERPRETER — emitted as `_rp[N].parse(...)` in the built bundle. That is a real
 * regression (correct but slow, and it means a construct stopped lowering). This
 * script builds each parser in dependency order and FAILS if any interpreter
 * fallback (or a compose/rules-level parseman warning) appears.
 *
 * It also reports how many regexes lowered to the fast `charCodeAt` path vs the
 * `RegExp.exec` fallback (informational — RegExp.exec is an accepted path, not a
 * failure), so drift is visible.
 *
 * Run: `node scripts/check-macro-buildable.mjs`  (wired as `pnpm check:macro`).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Dependency order: each parser composes over the previous one's compiled artifact.
const PARSERS = ['css-parser', 'less-parser', 'scss-parser', 'jess-parser'];

let failed = false;

for (const pkg of PARSERS) {
  const name = `@jesscss/${pkg}`;
  let output = '';
  const result = spawnSync('pnpm', ['--filter', name, 'build'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  output = String(result.stdout ?? '') + String(result.stderr ?? '');
  if (result.status !== 0) {
    console.error(`✗ ${name}: build FAILED\n${output}`);
    failed = true;
    continue;
  }

  // A `[parseman] … falling back to runtime` warning means a whole grammar (or a
  // compose arg) didn't compile — a hard regression.
  const composeWarn = /\[parseman\].*(falling back to runtime|isn't a build-resolvable)/i.exec(output);

  const bundle = ['index.js', 'grammar.js', 'jess.js']
    .map(file => readFileSync(resolve(root, 'packages', pkg, 'lib', file), 'utf8'))
    .join('\n');
  const interp = (bundle.match(/_rp\[\d+\]\.parse\(/g) ?? []).length;
  const regexExec = (bundle.match(/\.exec\(input\)/g) ?? []).length;

  if (interp > 0 || composeWarn) {
    console.error(
      `✗ ${name}: NOT fully macro-buildable — `
      + `${interp} interpreter fallback(s)${composeWarn ? `, warning: ${composeWarn[0]}` : ''}`
    );
    failed = true;
  } else {
    console.log(`✓ ${name}: fully compiled — 0 interpreter fallbacks (${regexExec} RegExp.exec paths)`);
  }
}

if (failed) {
  console.error('\nMacro-buildability guard FAILED. A grammar rule stopped compiling to inline JS.');
  process.exit(1);
}
console.log('\nAll parsers are fully macro-buildable.');
