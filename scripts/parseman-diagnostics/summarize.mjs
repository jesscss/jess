#!/usr/bin/env node
/** Per-rule roll-up of `run.mjs`'s report.json. */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(readFileSync(resolve(here, 'out/report.json'), 'utf8'));

console.log(`parseman ${report.parseman.version} @ ${report.parseman.resolved}\n`);

const ruleOf = id => String(id).split('#')[0];

for (const g of report.grammars) {
  const gate = g.gatingPreCompose;
  const dup = g.duplicationPreCompose;
  console.log(`\n${'='.repeat(78)}\n${g.dialect}/${g.surface}  (${g.exportName})`);
  console.log(`pieces: ${g.pieces.map(p => `#${p.index}=${p.ruleCount}`).join(' ')}  total rule entries=${g.pieces.reduce((a, p) => a + p.ruleCount, 0)}`);

  if (gate.threw) {
    console.log(`GATING: THREW ${gate.threw}`);
  } else {
    console.log(`GATING (pre-compose): ${gate.totalChoices} choices | gated=${gate.gated} ungated=${gate.ungatedCount} deferred=${gate.deferredCount} recoverable=${gate.recoverable} unanalysable=${gate.unanalysable.length}`);
    const byRule = new Map();
    for (const c of gate.ungated) {
      const r = c.rule ?? ruleOf(c.id);
      byRule.set(r, (byRule.get(r) ?? 0) + 1);
    }
    console.log(`  ungated rules (${byRule.size}): ${[...byRule].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}${n > 1 ? `×${n}` : ''}`).join(', ')}`);
    const causes = new Map();
    for (const c of gate.ungated) {
      for (const a of c.anyArms) {
        causes.set(a.cause, (causes.get(a.cause) ?? 0) + 1);
      }
    }
    if (causes.size) {
      console.log(`  any-arm causes: ${[...causes].map(([k, v]) => `${k}=${v}`).join(' ')}`);
    }
    if (gate.antiPatterns.length) {
      console.log(`  antiPatterns: ${gate.antiPatterns.length}`);
    }
  }

  console.log(`GATING (composed): ${JSON.stringify(g.gatingComposed)}`);
  console.log(`GATING (macro artifact): ${JSON.stringify(g.gatingMacro)}`);

  if (dup.threw) {
    console.log(`DUPLICATION: THREW ${dup.threw}`);
  } else {
    console.log(`DUPLICATION: rules=${dup.stats.rules} nodes=${dup.stats.nodes} shapes=${dup.stats.shapes} | total findings=${dup.total}`);
    console.log(`  ${Object.entries(dup.counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    for (const kind of ['duplicates', 'nearDuplicates', 'keywordRegexes', 'regexClasses', 'regexFragments', 'structureLoss', 'divergentNodes']) {
      const findings = dup.report[kind] ?? [];
      if (!findings.length) {
        continue;
      }
      const rules = new Map();
      for (const f of findings) {
        for (const s of (f.sites ?? f.occurrences ?? [])) {
          const r = typeof s === 'string' ? ruleOf(s) : (s.rule ?? ruleOf(s.id ?? ''));
          if (r) {
            rules.set(r, (rules.get(r) ?? 0) + 1);
          }
        }
      }
      console.log(`  ${kind}: top rules → ${[...rules].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([r, n]) => `${r}(${n})`).join(', ') || '(no site attribution)'}`);
    }
  }

  console.log(`COVERAGE: ${Object.entries(g.coverage).map(([k, v]) => `${k}=${v.ok ? v.value : `THREW(${v.error})`}`).join(' | ')}`);
}

/* --- cross-dialect duplication: rules with the same name in >1 dialect --- */
console.log(`\n${'='.repeat(78)}\nCROSS-DIALECT RULE NAME OVERLAP (ast surface)`);
const ast = report.grammars.filter(g => g.surface === 'ast');
const owners = new Map();
for (const g of ast) {
  for (const p of g.pieces) {
    for (const r of p.rules) {
      if (!owners.has(r)) {
        owners.set(r, new Set());
      }
      owners.get(r).add(g.dialect);
    }
  }
}
const buckets = new Map();
for (const [rule, set] of owners) {
  const key = [...set].sort().join('+');
  if (!buckets.has(key)) {
    buckets.set(key, []);
  }
  buckets.get(key).push(rule);
}
for (const [key, rules] of [...buckets].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${key} (${rules.length}): ${rules.sort().join(', ')}`);
}
