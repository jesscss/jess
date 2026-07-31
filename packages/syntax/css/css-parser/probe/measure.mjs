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

console.log(`artifact dir: ${dir}\n`);

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
