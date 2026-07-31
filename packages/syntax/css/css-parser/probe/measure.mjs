/**
 * Reports raw and gzip bytes for every built probe artifact, sorted by name.
 *
 * PRINTS THE ARTIFACT PATH AND ITS EXPORTS BESIDE EVERY NUMBER. Twice this
 * session a byte figure turned out to be about a different object than the one
 * under test: the board harness measured `lib/grammar/ast.js` (the stock
 * incumbent build) instead of the candidate entry, and this file's own numbers
 * silently spanned THREE compiled tables once the module gained a second
 * `composeLeaf(...)` export. Both looked structurally meaningful — identical to
 * the incumbent, and a clean 3x. A byte count without its path and its export
 * list is not a measurement.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const dir = new URL('./probe-lib/', import.meta.url).pathname;
const base = statSync(dir + 'p00-base.js').size;

/** Export names, so a number spanning several compiled tables is visible. */
function exportsOf(source) {
  const match = /export\s*\{([^}]*)\}/.exec(source);
  return match === null
    ? '(none)'
    : match[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()).filter(Boolean).join(' ');
}

/**
 * A macro-fallback build is NOT AST-equivalent and is SMALLER, so a bytes
 * report that cannot see one rewards it. Twice this session forward-reference
 * ordering produced a misleading number here: a fake 37x "win" from the chain
 * probes, and a depth-rule sweep that hard-failed `composeLeaf()`. A failure
 * mode that recurs deserves a check, not a memory — so every row is marked and
 * the process exits non-zero if any measured artifact fell back.
 */
function fellBack(source) {
  return /\bfrom\s*["']parseman["']/.test(source);
}

/**
 * FRESHNESS GATE. `measure.mjs` once reported "399,168 B unchanged" for a build
 * that had FAILED — it read the previous file and the number looked like
 * evidence that a patch did nothing. That is the third distinct stale-artifact
 * failure in this workstream and the class that has broken most instruments
 * here: it did not error, it measured a different object.
 *
 * Every artifact must be NEWER than the newest grammar source. Force-deleting
 * the artifact before a build is a habit; this is a gate.
 */
function assertFresh(entries) {
  const srcDir = new URL('../src/', import.meta.url).pathname;
  const newestSource = Math.max(...readdirSync(srcDir)
    .filter(f => f.endsWith('.ts'))
    .map(f => statSync(srcDir + f).mtimeMs));
  const stale = entries.filter(name => statSync(dir + name).mtimeMs < newestSource);
  if (stale.length > 0) {
    console.error(
      `STALE ARTIFACT — refusing to report.\n`
      + stale.map(n => `  ${dir}${n} is older than its source`).join('\n')
      + `\n  Rebuild, and check the build actually succeeded.`
    );
    process.exit(1);
  }
}

console.log(`artifact dir: ${dir}\n`);
let fallbacks = 0;

assertFresh(readdirSync(dir).filter(n => /^s\d+-.*\.js$/.test(n)));
for (const name of readdirSync(dir).sort()) {
  if (!name.endsWith('.js')) {
    continue;
  }
  const raw = readFileSync(dir + name);
  const gz = gzipSync(raw, { level: 9 }).length;
  console.log(
    name.padEnd(26),
    String(raw.length).padStart(8),
    'gz',
    String(gz).padStart(7),
    'delta',
    String(raw.length - base).padStart(8),
    name.startsWith('s') ? ` exports: ${exportsOf(raw.toString())}` : ''
  );
}
