/**
 * Read-only CPU-profile reader for `--cpu-prof` output.
 *
 * Aggregates SELF samples per call frame, then rolls them up into source
 * groups so a profile can be quoted as "N / TOTAL samples" the same way the
 * root-trivia figure in docs/architecture/core/PERF_IDEAS.md was produced.
 *
 *   node scripts/analyze-cpuprofile.mjs <file.cpuprofile> [topN=40]
 *
 * It does not modify anything and is not part of the build.
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const topN = Number(process.argv[3] ?? 40);
if (!file) {
  throw new TypeError('Usage: node scripts/analyze-cpuprofile.mjs <file.cpuprofile> [topN]');
}

const profile = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(profile.nodes.map(node => [node.id, node]));

const selfSamples = new Map();
for (const id of profile.samples) {
  selfSamples.set(id, (selfSamples.get(id) ?? 0) + 1);
}
const total = profile.samples.length;

/** Classify a frame into a coarse source group. */
const groupOf = (frame) => {
  const url = frame.url ?? '';
  const name = frame.functionName || '(anonymous)';
  if (name === '(garbage collector)') {
    return 'gc';
  }
  if (name === '(program)' || name === '(idle)' || name === '(root)') {
    return `v8:${name}`;
  }
  if (url.includes('/parseman/')) {
    return 'parseman-runtime';
  }
  if (url.includes('/less-parser/lib/')) {
    return 'less-parser';
  }
  if (url.includes('/css-parser/lib/')) {
    return 'css-parser';
  }
  if (url.includes('/scss-parser/lib/')) {
    return 'scss-parser';
  }
  if (url.includes('/jess-parser/lib/')) {
    return 'jess-parser';
  }
  if (url.includes('/internal-css-recognition/')) {
    return 'css-recognition';
  }
  if (url.includes('/packages/core/lib/')) {
    return 'core';
  }
  if (url.includes('/packages/fns/')) {
    return 'fns';
  }
  if (url.includes('/packages/jess/lib/')) {
    return 'jess-cli';
  }
  if (url.startsWith('node:')) {
    return 'node-internal';
  }
  if (url === '') {
    return 'v8-builtin/no-url';
  }
  return 'other';
};

const frames = [];
const groups = new Map();
for (const [id, count] of selfSamples) {
  const node = byId.get(id);
  if (!node) {
    continue;
  }
  const frame = node.callFrame;
  const group = groupOf(frame);
  groups.set(group, (groups.get(group) ?? 0) + count);

  // cpuprofile line/column numbers are 0-based
  frames.push({
    count,
    group,
    name: frame.functionName || '(anonymous)',
    site: `${frame.url}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`
  });
}

// merge identical (name, site) frames appearing under multiple tree nodes
const merged = new Map();
for (const entry of frames) {
  const key = `${entry.name}@${entry.site}`;
  const hit = merged.get(key);
  if (hit) {
    hit.count += entry.count;
  } else {
    merged.set(key, { ...entry });
  }
}

const pct = n => `${((n / total) * 100).toFixed(2)}%`;

console.log(`file: ${file}`);
console.log(`total samples: ${total}`);
console.log(`sample interval (us): ${profile.timeDeltas ? 'variable' : 'n/a'}`);
console.log('\n== self samples by group ==');
for (const [group, count] of [...groups].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(count).padStart(6)}  ${pct(count).padStart(7)}  ${group}`);
}

console.log(`\n== top ${topN} self-time frames ==`);
for (const entry of [...merged.values()].sort((a, b) => b.count - a.count).slice(0, topN)) {
  console.log(
    `${String(entry.count).padStart(5)}  ${pct(entry.count).padStart(7)}  `
    + `[${entry.group}] ${entry.name}  ${entry.site}`
  );
}

const needles = process.env.NEEDLES?.split(',').map(s => s.trim()).filter(Boolean);
if (needles?.length) {
  console.log('\n== needle totals (self samples, name or site substring) ==');
  for (const needle of needles) {
    let count = 0;
    for (const entry of merged.values()) {
      if (entry.name.includes(needle) || entry.site.includes(needle)) {
        count += entry.count;
      }
    }
    console.log(`${String(count).padStart(6)}  ${pct(count).padStart(7)}  ${needle}`);
  }
}
