import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const cache = resolve(repo, 'packages/syntax/scss/scss-parser/.cache/sass-spec');
const rows = JSON.parse(readFileSync(resolve(repo, 'scratchpad/sass-spec-triage/rows.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(cache, 'manifest.json'), 'utf8'));
const pathById = new Map(manifest.cases.map(c => [c.id, c.inputRelPath]));

for (const r of rows) {
  if (r.astOk === r.verdictOk) continue;
  console.log('---', r.hrx, '::', r.section);
  console.log('  rawOk', r.rawOk, 'unconsumedFrom', r.unconsumedFrom, 'astOk', r.astOk, 'err', r.errName, r.errMessage?.slice(0, 160));
  console.log('  src:', JSON.stringify(readFileSync(resolve(cache, pathById.get(r.id)), 'utf8').slice(0, 260)));
}
