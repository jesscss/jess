/**
 * Split a `--cpu-prof` profile into AST-surface and CST-surface subtrees and
 * roll each side up into macro-compiled-grammar buckets.
 *
 * Extends `scripts/analyze-grammar-profile.mjs` in two ways:
 *   1. the macro artifact is matched by path shape (`*-parser/lib/grammar*.js`),
 *      because Less ships `grammar2.js` while css/scss/jess ship `grammar.js`;
 *   2. every sample is attributed to the nearest enclosing surface entry frame
 *      (`astSurfaceEntry` / `cstSurfaceEntry` from `profile-dialect-parse.mjs`),
 *      so AST-vs-CST cost is separated by call-tree ancestor rather than by
 *      running two processes.
 *
 *   node scripts/analyze-surface-profile.mjs <file.cpuprofile> [minSamples=10]
 *
 * Frames are reported with `file:line` into the generated artifact plus the
 * owning source rule, recovered from the artifact's call graph (see below).
 * Read-only; not part of the build.
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const minSamples = Number(process.argv[3] ?? 10);
if (!file) {
  throw new TypeError('Usage: node scripts/analyze-surface-profile.mjs <file.cpuprofile> [minSamples]');
}

const profile = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(profile.nodes.map(node => [node.id, node]));
const total = profile.samples.length;

const parentOf = new Map();
for (const node of profile.nodes) {
  for (const child of node.children ?? []) {
    parentOf.set(child, node.id);
  }
}

const self = new Map();
for (const id of profile.samples) {
  self.set(id, (self.get(id) ?? 0) + 1);
}

const SURFACE_ENTRY = {
  astSurfaceEntry: 'ast',
  cstSurfaceEntry: 'cst'
};

/** Walk to the root, returning the nearest enclosing surface entry frame. */
const surfaceOf = (id) => {
  for (let cursor = id; cursor !== undefined; cursor = parentOf.get(cursor)) {
    const name = byId.get(cursor)?.callFrame?.functionName;
    if (name && SURFACE_ENTRY[name]) {
      return SURFACE_ENTRY[name];
    }
  }
  return 'outside';
};

const ARTIFACT = /\/([a-z]+)-parser\/lib\/(grammar2?\.js)$/;

/*
 * Owner attribution.
 *
 * The macro artifact emits every inlined combinator fragment in one block ahead
 * of the rule functions, so "nearest preceding `_r_`" is meaningless here. A
 * fragment's owner is instead resolved through the CALL GRAPH: index every
 * `function <name>(` definition and its line span, record which fragment names
 * each body references, then walk callers upward until an `_r_<Rule>` is hit.
 *
 * `(anonymous)` build actions live in a flat reducer array with no name at all,
 * so they are identified by an excerpt of their first source line.
 */
const artifactCache = new Map();
const indexArtifact = (path) => {
  if (artifactCache.has(path)) {
    return artifactCache.get(path);
  }
  const index = { defs: [], callersOf: new Map(), lines: [] };
  try {
    index.lines = readFileSync(path, 'utf8').split('\n');
  } catch {
    artifactCache.set(path, index);
    return index;
  }
  for (let i = 0; i < index.lines.length; i++) {
    const hit = /^\s*function\s+([A-Za-z0-9_$]+)\s*\(/.exec(index.lines[i]);
    if (hit) {
      index.defs.push({ start: i + 1, name: hit[1] });
    }
  }
  for (let d = 0; d < index.defs.length; d++) {
    const def = index.defs[d];
    def.end = d + 1 < index.defs.length ? index.defs[d + 1].start - 1 : index.lines.length;
    const body = index.lines.slice(def.start, def.end).join('\n');
    for (const call of body.matchAll(/\b(_[0-9a-f]{8}__(?:pf|tf|fx)\d+)\s*\(/g)) {
      if (call[1] === def.name) {
        continue;
      }
      if (!index.callersOf.has(call[1])) {
        index.callersOf.set(call[1], new Set());
      }
      index.callersOf.get(call[1]).add(def.name);
    }
  }
  artifactCache.set(path, index);
  return index;
};

/** Walk callers upward from a fragment until `_r_<Rule>` definitions are reached. */
const ownerRules = (path, fragment) => {
  const index = indexArtifact(path);
  const seen = new Set([fragment]);
  const found = new Set();
  let frontier = [fragment];
  for (let depth = 0; depth < 24 && frontier.length > 0; depth++) {
    const next = [];
    for (const name of frontier) {
      for (const caller of index.callersOf.get(name) ?? []) {
        if (caller.startsWith('_r_')) {
          found.add(caller.slice(3));
          continue;
        }
        if (!seen.has(caller)) {
          seen.add(caller);
          next.push(caller);
        }
      }
    }
    frontier = next;
  }
  if (found.size === 0) {
    return '(unreferenced)';
  }
  const sorted = [...found].sort();
  return sorted.length <= 3 ? sorted.join('+') : `${sorted.slice(0, 3).join('+')}+${sorted.length - 3}more`;
};

/** First-line excerpt, used to identify a nameless reducer. */
const excerpt = (path, line) => {
  const index = indexArtifact(path);
  const text = (index.lines[line - 1] ?? '').trim();
  return text.length > 72 ? `${text.slice(0, 72)}…` : text;
};

const owningRule = (path, entry) => {
  if (entry.shape === 'rule') {
    return entry.name.slice(3);
  }
  if (entry.shape === 'build-action') {
    return `reducer{${excerpt(path, entry.line)}}`;
  }
  if (entry.shape === 'helper') {
    return `helper:${entry.name}`;
  }
  return ownerRules(path, entry.name);
};

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
  return 'helper';
};

const pct = n => `${((n / total) * 100).toFixed(2)}%`;

const surfaceTotals = new Map();
const grammarTotals = new Map();
const shapeTotals = new Map();
const frames = new Map();
let artifactPath = null;
let artifactName = null;

for (const [id, count] of self) {
  const frame = byId.get(id)?.callFrame;
  if (!frame) {
    continue;
  }
  const surface = surfaceOf(id);
  surfaceTotals.set(surface, (surfaceTotals.get(surface) ?? 0) + count);

  const url = frame.url ?? '';
  const match = ARTIFACT.exec(url);
  if (!match) {
    continue;
  }
  const path = url.replace(/^file:\/\//, '');
  artifactPath ??= path;
  artifactName ??= `${match[1]}-parser/lib/${match[2]}`;

  grammarTotals.set(surface, (grammarTotals.get(surface) ?? 0) + count);
  const name = frame.functionName || '(anonymous)';
  const shape = shapeOf(name);
  const shapeKey = `${surface}/${shape}`;
  shapeTotals.set(shapeKey, (shapeTotals.get(shapeKey) ?? 0) + count);

  const line = frame.lineNumber + 1;
  const key = `${surface}|${name}|${line}`;
  const hit = frames.get(key);
  if (hit) {
    hit.count += count;
  } else {
    frames.set(key, { count, surface, name, line, shape, path });
  }
}

console.log(`file: ${file}`);
console.log(`total process samples: ${total}`);
console.log(`macro artifact: ${artifactName ?? '(none matched)'}`);

console.log('\n== self samples by surface (whole process) ==');
for (const [surface, count] of [...surfaceTotals].sort((a, b) => b[1] - a[1])) {
  const grammar = grammarTotals.get(surface) ?? 0;
  console.log(
    `${String(count).padStart(6)}  ${pct(count).padStart(7)}  ${surface.padEnd(8)}`
    + `  of which macro grammar: ${String(grammar).padStart(6)}  ${pct(grammar).padStart(7)}`
  );
}

console.log('\n== macro-grammar self samples by surface and emitted shape ==');
for (const [key, count] of [...shapeTotals].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(count).padStart(6)}  ${pct(count).padStart(7)}  ${key}`);
}

for (const surface of ['ast', 'cst']) {
  const rows = [...frames.values()]
    .filter(entry => entry.surface === surface && entry.count >= minSamples)
    .sort((a, b) => b.count - a.count);
  if (rows.length === 0) {
    continue;
  }
  console.log(`\n== ${surface}: macro-grammar frames >= ${minSamples} self samples ==`);
  for (const entry of rows) {
    const rule = owningRule(entry.path, entry);
    console.log(
      `${String(entry.count).padStart(5)}  ${pct(entry.count).padStart(7)}  `
      + `${entry.shape.padEnd(20)} ${entry.name.padEnd(18)} `
      + `${(artifactName ?? '?')}:${entry.line}  owner=${rule}`
    );
  }
}

/*
 * Per-owning-rule rollup: fragments and build actions are attributed back to the
 * source rule that emitted them, which is the level a grammar edit acts on.
 */
for (const surface of ['ast', 'cst']) {
  const byRule = new Map();
  for (const entry of frames.values()) {
    if (entry.surface !== surface) {
      continue;
    }
    const rule = owningRule(entry.path, entry);
    byRule.set(rule, (byRule.get(rule) ?? 0) + entry.count);
  }
  const rows = [...byRule].sort((a, b) => b[1] - a[1]).filter(([, count]) => count >= minSamples);
  if (rows.length === 0) {
    continue;
  }
  console.log(`\n== ${surface}: rolled up to owning source rule (>= ${minSamples}) ==`);
  for (const [rule, count] of rows) {
    console.log(`${String(count).padStart(5)}  ${pct(count).padStart(7)}  ${rule}`);
  }
}
