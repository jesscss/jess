/** Reports raw and gzip bytes for every built probe artifact, sorted by name. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const dir = new URL('./probe-lib/', import.meta.url).pathname;
const base = statSync(dir + 'p00-base.js').size;

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
    String(raw.length - base).padStart(8)
  );
}
