/**
 * Roll a `--cpu-prof` profile up into macro-compiled-grammar buckets.
 *
 * The Less macro artifact (`lib/grammar2.js`) emits four shapes of function:
 *   `_r_<Rule>`   a named grammar rule
 *   `_<hash>__pf` an inlined combinator fragment (choice/seq/many/attempt)
 *   `_<hash>__tf` a trivia scanner (whitespace/comment skip between tokens)
 *   `(anonymous)` a grammar build action (reducer)
 *
 *   node scripts/analyze-grammar-profile.mjs <file.cpuprofile>
 *
 * Read-only; not part of the build.
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  throw new TypeError('Usage: node scripts/analyze-grammar-profile.mjs <file.cpuprofile>');
}
const profile = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(profile.nodes.map(node => [node.id, node]));
const total = profile.samples.length;

const self = new Map();
for (const id of profile.samples) {
  self.set(id, (self.get(id) ?? 0) + 1);
}

const shapeOf = (name) => {
  if (/^_r_/.test(name)) {
    return 'rule';
  }
  if (/__pf\d+$/.test(name)) {
    return 'combinator-fragment';
  }
  if (/__tf\d+$/.test(name)) {
    return 'trivia-scanner';
  }
  if (/__fx\d+$/.test(name)) {
    return 'failure-expectation';
  }
  if (name === '(anonymous)') {
    return 'build-action';
  }
  return `helper:${name}`;
};

const shapes = new Map();
const entries = new Map();
let grammarTotal = 0;
for (const [id, count] of self) {
  const frame = byId.get(id)?.callFrame;
  if (!frame?.url?.includes('grammar2.js')) {
    continue;
  }
  grammarTotal += count;
  const name = frame.functionName || '(anonymous)';
  const shape = shapeOf(name);
  const bucket = shape.startsWith('helper:') ? 'helper' : shape;
  shapes.set(bucket, (shapes.get(bucket) ?? 0) + count);
  const key = `${name}:${frame.lineNumber + 1}`;
  const hit = entries.get(key);
  if (hit) {
    hit.count += count;
  } else {
    entries.set(key, { count, name, line: frame.lineNumber + 1, shape: bucket });
  }
}

const pct = n => `${((n / total) * 100).toFixed(2)}%`;
console.log(`total process samples: ${total}`);
console.log(`grammar2.js self samples: ${grammarTotal} (${pct(grammarTotal)})\n`);
console.log('== grammar2.js self samples by emitted shape ==');
for (const [shape, count] of [...shapes].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(count).padStart(5)}  ${pct(count).padStart(7)}  ${shape}`);
}

console.log('\n== grammar2.js frames, >= 10 self samples ==');
for (const entry of [...entries.values()].sort((a, b) => b.count - a.count)) {
  if (entry.count < 10) {
    continue;
  }
  console.log(
    `${String(entry.count).padStart(5)}  ${pct(entry.count).padStart(7)}  `
    + `${entry.shape.padEnd(20)} ${entry.name}  grammar2.js:${entry.line}`
  );
}
