/**
 * Attribute each FAILING corpus entry to the grammar gap that blocks it.
 *
 * Each gap below was confirmed by a hand-minimised probe against the shipping
 * `lib/index.cjs` (see report), so these are constructs the SCSS grammar does
 * not currently recognise — not guesses read off an error message.
 *
 * Two counts are reported and they answer different questions:
 *   - `primary`: the EARLIEST gap at or after the reported failure offset. This
 *     is the unblock-order ranking, because that is the construct the parser
 *     actually stopped on.
 *   - `present`: the gap occurs anywhere in the input. An entry can need several
 *     gaps fixed before it parses, so `present` sums to far more than 1909 and
 *     must not be read as a work estimate.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const cache = resolve(repo, 'packages/syntax/scss/scss-parser/.cache/sass-spec');

const rows = JSON.parse(readFileSync(resolve(here, 'classified.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(cache, 'manifest.json'), 'utf8'));
const pathById = new Map(manifest.cases.map(c => [c.id, c.inputRelPath]));

/** Ordered; first match at the earliest offset wins for `primary`. */
const GAPS = [
  /*
   * G19 sits ahead of G1 deliberately. Both match at the same offset (the glued
   * callee opener) for `ns.f($x: 1)`, and ties go to the earlier array entry —
   * but the blocker there is the ARGUMENT form, not the namespace: `f($x: 1)`
   * fails with no namespace at all. Ranking it under G1 is the same mis-ranking
   * class that once put `if()` at 7th. Definition sites (`@mixin a($b: 1)`,
   * `@function a($b: 1)`) already parse and are excluded by lookbehind.
   */
  ['G19 named / spread call argument  f($x: 1), f($x...)', /(?<!@mixin\s)(?<!@function\s)(?<![\w$.-])[a-zA-Z_][\w.-]*\((?:[^()]|\([^()]*\))*?\$[-\w]+\s*(?::|\.\.\.)/g],
  /*
   * G20 also precedes G1: a namespaced WRITE is a different production from the
   * namespaced READ that now parses, and it is not representable today —
   * `VariableDeclaration.name` is a plain string with no namespace slot.
   */
  ['G20 namespaced variable ASSIGNMENT  ns.$v: x', /(?:^|[\n{;])\s*[a-zA-Z_][\w-]*\.\$[-\w]+\s*:/g],
  ['G1 namespaced member  ns.fn(…) / ns.$var', /(?<![\w$.-])[a-zA-Z_][\w-]*\.(?:[a-zA-Z_][\w-]*\s*\(|\$)/g],
  ['G2 @if/@else-if non-comparison condition', /@(?:if|else\s+if)[^\n{]*/g],
  ['G3 @use/@forward with(…) / show / hide', /@(?:use|forward)\b[^\n;{]*\b(?:with\s*\(|show\b|hide\b)/g],
  ['G4 @include content-block / ns / using', /@include\b[^\n;]*?(?:\busing\s*\(|\{)|@include\s+[a-zA-Z_][\w-]*\./g],
  ['G5 @content', /@content\b/g],
  ['G6 @debug / @warn / @error', /@(?:debug|warn|error)\b/g],
  ['G7 @at-root <prelude> (non-paren)', /@at-root\s+[^({\s][^\n{]*\{/g],
  ['G8 @while', /@while\b/g],
  ['G9 @extend … !optional', /@extend\b[^\n;}]*!optional/g],
  ['G10 @import comma list', /@import\s+[^;\n]*,[^;\n]*/g],
  ['G11 $var inside @media feature', /@media[^\n{]*\(\s*[\w-]+\s*:[^)\n]*\$/g],
  ['G12 CSS if() with :/; arms', /\bif\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*[:;]/g],
  ['G13 leading/among-combinator selector', /(?:^|[\n{]|\(\s*)\s*[>+~](?:\s|$)/g],
  ['G14 @import tail (supports()/mq/comment)', /@import\s+(?:url\()?["'][^"'\n]*["']\)?[^\n;]*(?:supports\s*\(|\(|\/\*|\/\/)/g],
  ['G15 #{} as whole @media condition', /@media[^\n{]*\(\s*#\{/g],
  ['G16 @forward … as prefix-*', /@forward\b[^\n;]*\bas\s+[\w-]+\*/g],
  ['G17 attribute selector edge (|a, bare)', /\[\s*(?:\||[\w-]+\s+[\w-]+)/g],
  ['G18 newline inside argument list', /\([^)\n]*\n[^)]*\)/g]
];

function scan(source, from) {
  let best = null;
  for (const [name, re] of GAPS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
      if (m.index >= from) {
        if (best === null || m.index < best.at) best = { name, at: m.index, text: m[0].slice(0, 70) };
        break;
      }
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return best;
}

function present(source) {
  const out = [];
  for (const [name, re] of GAPS) {
    re.lastIndex = 0;
    if (re.test(source)) out.push(name);
  }
  return out;
}

const primary = new Map();
const presentCount = new Map();
const examples = new Map();
let unattributed = 0;
const unattributedRows = [];

const fails = rows.filter(r => !r.astOk);
for (const r of fails) {
  const source = readFileSync(resolve(cache, pathById.get(r.id)), 'utf8');
  const from = typeof r.errOffset === 'number' ? r.errOffset : 0;
  // Offset 0 means the failure backtracked to the document start, so the gap can
  // be anywhere; scan the whole file in that case rather than trusting the 0.
  const hit = scan(source, from) ?? (from > 0 ? scan(source, 0) : null);
  for (const p of present(source)) presentCount.set(p, (presentCount.get(p) ?? 0) + 1);
  if (hit === null) {
    unattributed++;
    unattributedRows.push({ id: r.id, hrx: r.hrx, section: r.section, verdict: r.verdict, errOffset: r.errOffset, src: source.slice(0, 220) });
    continue;
  }
  primary.set(hit.name, (primary.get(hit.name) ?? 0) + 1);
  if (!examples.has(hit.name)) examples.set(hit.name, { hrx: r.hrx, section: r.section, verdict: r.verdict, text: hit.text, src: source.slice(0, 180) });
}

const byVerdict = (name) => {
  let eo = 0, ee = 0;
  for (const r of fails) {
    const source = readFileSync(resolve(cache, pathById.get(r.id)), 'utf8');
    const from = typeof r.errOffset === 'number' ? r.errOffset : 0;
    const hit = scan(source, from) ?? (from > 0 ? scan(source, 0) : null);
    if (hit?.name !== name) continue;
    if (r.verdict === 'expect-output') eo++; else ee++;
  }
  return { eo, ee };
};

console.log(`failing entries: ${fails.length}`);
console.log(`unattributed:    ${unattributed}\n`);
console.log('rank  primary  present  gap');
let i = 0;
for (const [name, n] of [...primary.entries()].sort((a, b) => b[1] - a[1])) {
  const v = byVerdict(name);
  console.log(`${String(++i).padStart(4)}  ${String(n).padStart(7)}  ${String(presentCount.get(name) ?? 0).padStart(7)}  ${name}`);
  console.log(`                        expect-output=${v.eo} expect-error=${v.ee}`);
  const ex = examples.get(name);
  console.log(`                        e.g. ${ex.hrx} :: ${ex.section}`);
  console.log(`                             ${JSON.stringify(ex.src.split('\n').slice(0, 3).join('\\n'))}`);
}

writeFileSync(resolve(here, 'unattributed.json'), JSON.stringify(unattributedRows, null, 1));
console.log(`\nunattributed sample written to unattributed.json (${unattributedRows.length})`);
