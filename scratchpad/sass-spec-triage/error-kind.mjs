/**
 * Of the 476 `expect-error` corpus entries, how many require a SYNTAX rejection
 * (a parser must reject) versus a SEMANTIC one (a parser must ACCEPT, and the
 * evaluator must then fail)?
 *
 * This decides whether `expect-error` may be subtracted from the denominator.
 * It may not be subtracted wholesale: dart-sass reports most sass-spec errors
 * from evaluation, and a parser that rejects those is wrong for the same reason
 * a parser that accepts a syntax error is.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const cache = resolve(repo, 'packages/syntax/scss/scss-parser/.cache/sass-spec');
const manifest = JSON.parse(readFileSync(resolve(cache, 'manifest.json'), 'utf8'));
const rows = JSON.parse(readFileSync(resolve(here, 'classified.json'), 'utf8'));
const byId = new Map(rows.map(r => [r.id, r]));

function parseHrxSections(text) {
  const out = [];
  let cur; let buf = [];
  const flush = () => { if (cur) out.push({ path: cur, contents: buf.join('\n') }); };
  for (const line of text.split(/\r?\n/)) {
    const s = /^<===>\s+(.+?)\s*$/.exec(line);
    if (s) { flush(); cur = s[1]; buf = []; continue; }
    if (/^<===+>\s*$/.test(line)) { flush(); cur = undefined; buf = []; continue; }
    if (/^=+$/.test(line)) continue;
    if (cur) buf.push(line);
  }
  flush();
  return out;
}

const hrxCache = new Map();
const sectionsFor = rel => {
  if (!hrxCache.has(rel)) {
    const p = resolve(manifest.specRoot, rel);
    hrxCache.set(rel, existsSync(p) ? parseHrxSections(readFileSync(p, 'utf8')) : []);
  }
  return hrxCache.get(rel);
};

/** dart-sass phrases parse failures with `expected`/`Expected` or "Invalid CSS". */
const SYNTAX = /expected |Expected |Invalid CSS|was not closed|isn't allowed here|Semicolon or newline expected/;

let syntax = 0; let semantic = 0; let none = 0;
const tallies = { syntaxRejected: 0, syntaxAccepted: 0, semanticRejected: 0, semanticAccepted: 0 };

for (const c of manifest.cases) {
  const r = byId.get(c.id);
  if (r.verdict !== 'expect-error') continue;
  const dir = posix.dirname(c.sectionPath);
  const errSec = sectionsFor(c.hrxRelPath)
    .find(s => posix.dirname(s.path) === dir && posix.basename(s.path).startsWith('error'));
  if (!errSec) { none++; continue; }
  const isSyntax = SYNTAX.test(errSec.contents);
  if (isSyntax) { syntax++; tallies[r.astOk ? 'syntaxAccepted' : 'syntaxRejected']++; }
  else { semantic++; tallies[r.astOk ? 'semanticAccepted' : 'semanticRejected']++; }
}

console.log(`expect-error entries with an error body: ${syntax + semantic} (unmatched: ${none})`);
console.log(`  dart-sass SYNTAX error   ${syntax}`);
console.log(`     jess rejects (agree)  ${tallies.syntaxRejected}`);
console.log(`     jess accepts (WRONG)  ${tallies.syntaxAccepted}`);
console.log(`  dart-sass SEMANTIC error ${semantic}   <- a parser MUST accept these`);
console.log(`     jess accepts (agree)  ${tallies.semanticAccepted}`);
console.log(`     jess rejects (GAP)    ${tallies.semanticRejected}`);
