#!/usr/bin/env node
/** The arity >= 4 sites — every node that pays an AST-only raw/trivia/state capture. */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { static: byDialect } = JSON.parse(readFileSync(resolve(here, 'out/reducer-arity.json'), 'utf8'));

for (const [dialect, rows] of Object.entries(byDialect)) {
  const high = rows.filter(r => r.kind === 'build' && (r.arity === null || r.arity >= 4));
  if (!high.length) {
    console.log(`\n${dialect}: no node pays raw/trivia/state capture.`);
    continue;
  }
  console.log(`\n${dialect}: ${high.length} node(s) at arity >= 4`);
  for (const a of [4, 5, 6]) {
    const rows2 = high.filter(r => r.arity === a);
    if (!rows2.length) {
      continue;
    }
    const pays = a >= 6 ? 'raw+trivia+state' : a >= 5 ? 'raw+trivia' : 'raw';
    console.log(`  arity ${a} (${pays}) — ${rows2.length}:`);
    for (const r of rows2) {
      console.log(`    ${r.file}:${r.line}  ${r.nodeType ?? '(inferred)'}`);
    }
  }
}
