/**
 * How much of the corpus does G1 alone actually hold up?
 *
 * `primary` says which gap the parser stopped ON, not which gaps an entry
 * needs. An entry blocked primarily by G1 may hit a second gap once G1 lands,
 * so the honest answer is a RANGE, and both ends are computed here rather than
 * asserted.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const cache = resolve(repo, 'packages/syntax/scss/scss-parser/.cache/sass-spec');
const rows = JSON.parse(readFileSync(resolve(here, 'classified.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(cache, 'manifest.json'), 'utf8'));
const pathById = new Map(manifest.cases.map(c => [c.id, c.inputRelPath]));

const G1 = /(?<![\w$.-])[a-zA-Z_][\w-]*\.(?:[a-zA-Z_][\w-]*\s*\(|\$)/;
const OTHERS = [
  /@(?:use|forward)\b[^\n;{]*\b(?:with\s*\(|show\b|hide\b|as\s+[\w-]+\*)/,
  /@include\b[^\n;]*?(?:\busing\s*\(|\{)|@include\s+[a-zA-Z_][\w-]*\./,
  /@content\b/,
  /@(?:debug|warn|error)\b/,
  /@while\b/,
  /@extend\b[^\n;}]*!optional/,
  /@import\s+[^;\n]*,[^;\n]*/,
  /@import\s+(?:url\()?["'][^"'\n]*["']\)?[^\n;]*(?:supports\s*\(|\(|\/\*|\/\/)/,
  /@media[^\n{]*\(\s*(?:[\w-]+\s*:[^)\n]*\$|#\{)/,
  /\bif\s*\([^)]*:/,
  /(?:^|[\n{]|\(\s*)\s*[>+~](?:\s|$)/m,
  /@at-root\s+[^({\s][^\n{]*\{/,
  /\([^)\n]*\n[^)]*\)/
];

const fails = rows.filter(r => !r.astOk);
let g1Only = 0;
let g1Any = 0;
let noG1 = 0;
for (const r of fails) {
  const src = readFileSync(resolve(cache, pathById.get(r.id)), 'utf8');
  const hasG1 = G1.test(src);
  if (!hasG1) { noG1++; continue; }
  g1Any++;
  if (!OTHERS.some(re => re.test(src))) g1Only++;
}

const n = rows.length;
const pass = rows.length - fails.length;
console.log(`corpus                       ${n}`);
console.log(`passing today                ${pass}  (${(pass / n * 100).toFixed(1)}%)`);
console.log(`failing today                ${fails.length}`);
console.log(`failing entries with G1      ${g1Any}`);
console.log(`  … whose ONLY known gap is G1  ${g1Only}   -> conservative post-G1 pass ${pass + g1Only} (${((pass + g1Only) / n * 100).toFixed(1)}%)`);
console.log(`  … also needing another gap    ${g1Any - g1Only}   -> optimistic  post-G1 pass ${pass + g1Any} (${((pass + g1Any) / n * 100).toFixed(1)}%)`);
console.log(`failing entries without G1   ${noG1}`);
