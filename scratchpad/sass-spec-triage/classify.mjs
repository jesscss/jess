/**
 * Classify each corpus case against its ORIGIN in sass-spec, then classify each
 * failure by the construct at the failure offset.
 *
 * Axis 1 (from sass-spec itself, not from jess): does the HRX directory that
 * owns this `input.scss` also carry an `error` / `error-*` sibling? A sass-spec
 * `error` sibling means dart-sass is REQUIRED to reject the input, so a jess
 * rejection there is agreement, not a gap. `output.css` means dart-sass is
 * required to ACCEPT it, so a jess rejection there is a real divergence.
 *
 * Axis 2: the first source line whose offset brackets the reported error, plus
 * a normalised token, so gaps aggregate rather than being 1909 singletons.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const pkg = resolve(repo, 'packages/syntax/scss/scss-parser');
const cache = resolve(pkg, '.cache/sass-spec');

const manifest = JSON.parse(readFileSync(resolve(cache, 'manifest.json'), 'utf8'));
const rows = JSON.parse(readFileSync(resolve(here, 'rows.json'), 'utf8'));
const byId = new Map(rows.map(r => [r.id, r]));

/** Re-parse HRX to recover the FULL section list, including error/output siblings. */
function parseHrxSections(text) {
  const out = [];
  let cur;
  let buf = [];
  const flush = () => { if (cur) out.push({ path: cur, contents: buf.join('\n') }); };
  for (const line of text.split(/\r?\n/)) {
    const start = /^<===>\s+(.+?)\s*$/.exec(line);
    if (start) { flush(); cur = start[1]; buf = []; continue; }
    if (/^<===+>\s*$/.test(line)) { flush(); cur = undefined; buf = []; continue; }
    if (/^=+$/.test(line)) continue;
    if (cur) buf.push(line);
  }
  flush();
  return out;
}

const specRoot = manifest.specRoot;
const hrxCache = new Map();
function sectionsFor(rel) {
  if (!hrxCache.has(rel)) {
    const p = resolve(specRoot, rel);
    hrxCache.set(rel, existsSync(p) ? parseHrxSections(readFileSync(p, 'utf8')) : null);
  }
  return hrxCache.get(rel);
}

/**
 * A sass-spec case directory is the dirname of its `input.scss` section path.
 * Options (`options.yml`) cascade DOWN from ancestors, and so does nothing else;
 * `error` and `output.css` are per-case files, so only exact-dir siblings count.
 */
function verdictFor(hrxRel, sectionPath) {
  const secs = sectionsFor(hrxRel);
  if (!secs) return 'hrx-missing';
  const dir = posix.dirname(sectionPath);
  const siblings = secs
    .filter(s => posix.dirname(s.path) === dir)
    .map(s => posix.basename(s.path));
  const hasError = siblings.some(b => b === 'error' || b.startsWith('error-'));
  const hasOutput = siblings.some(b => b === 'output.css' || b.startsWith('output-'));
  if (hasError && !hasOutput) return 'expect-error';
  if (hasError && hasOutput) return 'expect-error-or-output';
  if (hasOutput) return 'expect-output';
  return 'no-verdict-sibling';
}

/** The construct that stopped the parse, normalised so gaps aggregate. */
const SIGNATURES = [
  [/^@(use|forward)\b/, '@use / @forward (module system)'],
  [/^@(if|else)\b/, '@if / @else'],
  [/^@(each|for|while)\b/, '@each / @for / @while'],
  [/^@(mixin|include)\b/, '@mixin / @include'],
  [/^@function\b/, '@function'],
  [/^@return\b/, '@return'],
  [/^@content\b/, '@content'],
  [/^@extend\b/, '@extend'],
  [/^@at-root\b/, '@at-root'],
  [/^@debug\b/, '@debug'],
  [/^@warn\b/, '@warn'],
  [/^@error\b/, '@error'],
  [/^@import\b/, '@import'],
  [/^@media\b/, '@media'],
  [/^@supports\b/, '@supports'],
  [/^@keyframes\b/, '@keyframes'],
  [/^@[-\w]+/, 'other at-rule'],
  [/^\$[-\w]/, '$variable declaration / use'],
  [/^#\{/, '#{} interpolation'],
  [/^\}/, 'close brace'],
  [/^\)/, 'close paren'],
  [/^[.#&\[*:>+~]/, 'selector'],
  [/^[-\w]+\s*:/, 'declaration'],
  [/^\/\//, '// silent comment'],
  [/^\/\*/, '/* loud comment */']
];

function signature(source, offset) {
  if (offset === null || offset === undefined) return { sig: 'no-offset', line: '' };
  const clamped = Math.max(0, Math.min(offset, source.length));
  const lineStart = source.lastIndexOf('\n', clamped - 1) + 1;
  let lineEnd = source.indexOf('\n', clamped);
  if (lineEnd < 0) lineEnd = source.length;
  const line = source.slice(lineStart, lineEnd);
  const tail = source.slice(clamped, lineEnd).trim() || line.trim();
  for (const [re, name] of SIGNATURES) {
    if (re.test(tail)) return { sig: name, line: line.trim(), tail: tail.slice(0, 60) };
  }
  if (tail === '') return { sig: 'end of input', line: line.trim(), tail: '' };
  return { sig: `other: ${tail.slice(0, 24)}`, line: line.trim(), tail: tail.slice(0, 60) };
}

const out = [];
for (const c of manifest.cases) {
  const r = byId.get(c.id);
  const source = readFileSync(resolve(cache, c.inputRelPath), 'utf8');
  const verdict = verdictFor(c.hrxRelPath, c.sectionPath);
  const sg = r.astOk ? { sig: '(passes)', line: '', tail: '' } : signature(source, r.errOffset);
  out.push({ ...r, verdict, sig: sg.sig, line: sg.line, tail: sg.tail, src: source.slice(0, 400) });
}

writeFileSync(resolve(here, 'classified.json'), JSON.stringify(out, null, 1));

const tally = (rowsIn, key) => {
  const m = new Map();
  for (const r of rowsIn) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

const fails = out.filter(r => !r.astOk);
const passes = out.filter(r => r.astOk);

console.log('=== corpus by sass-spec verdict (what the SUITE requires) ===');
for (const [k, v] of tally(out, 'verdict')) {
  const f = out.filter(r => r.verdict === k && !r.astOk).length;
  console.log(`  ${String(k).padEnd(24)} total=${String(v).padStart(5)}  jess-rejects=${String(f).padStart(5)}  jess-accepts=${String(v - f).padStart(5)}`);
}

console.log('\n=== failures by construct at failure offset (top 30) ===');
for (const [k, v] of tally(fails, 'sig').slice(0, 30)) console.log(`  ${String(v).padStart(5)}  ${k}`);

console.log('\n=== failures by feature bucket ===');
for (const [k, v] of tally(fails, 'feature')) console.log(`  ${String(v).padStart(5)}  ${k}`);

console.log(`\npasses=${passes.length} fails=${fails.length}`);
