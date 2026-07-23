#!/usr/bin/env node
/**
 * Cross-tool surface parity gate.
 *
 * Different agent tools read different entry files: Codex reads `AGENTS.md`,
 * Cursor reads `.cursor/rules/*`, Claude reads `CLAUDE.md`. If those surfaces
 * point at different canonical perf docs (or none), agents get inconsistent
 * guidance and the enforcement layer drifts.
 *
 * This gate FAILS if any of the three surfaces does not reference the full
 * canonical perf-doc set. It is wired into `.github/workflows/pr-quality-gate.yml`
 * as a reports-only step, and can be run locally with
 * `pnpm run verify:surface-parity`.
 *
 * Design: docs/future/llm-quality-enforcement-design.md (Cross-tool parity).
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);

// The canonical perf-doc set every agent surface must point at.
const CANONICAL_DOCS = [
  'docs/perf/V8-ARCHITECTURE.md',
  'docs/future/llm-quality-enforcement-design.md'
];

/** Recursively collect files under a dir matching a predicate. */
function walk(dir, matchExt) {
  if (!existsSync(dir)) {
    return [];
  }
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, matchExt));
    } else if (entry.isFile() && entry.name.endsWith(matchExt)) {
      out.push(full);
    }
  }
  return out;
}

/** A surface = a named group of files whose combined text is searched. */
const surfaces = [
  { name: 'AGENTS.md', files: ['AGENTS.md'] },
  { name: 'CLAUDE.md', files: ['CLAUDE.md'] },
  {
    name: '.cursor/rules/*',
    files: walk(path.join(root, '.cursor/rules'), '.mdc').map(f => path.relative(root, f))
  }
];

// First: the canonical docs themselves must exist. A dangling reference set is
// worse than none.
const missingDocs = CANONICAL_DOCS.filter(doc => !existsSync(path.join(root, doc)));

let failed = missingDocs.length > 0;
const report = [];

for (const surface of surfaces) {
  const existingFiles = surface.files.filter(f => existsSync(path.join(root, f)));
  const text = existingFiles.map(f => readFileSync(path.join(root, f), 'utf8')).join('\n');
  const missing = CANONICAL_DOCS.filter(doc => !text.includes(doc));
  if (existingFiles.length === 0) {
    failed = true;
    report.push({ surface: surface.name, status: 'NO FILES', missing: CANONICAL_DOCS });
  } else if (missing.length > 0) {
    failed = true;
    report.push({ surface: surface.name, status: 'DRIFT', missing });
  } else {
    report.push({ surface: surface.name, status: 'OK', missing: [] });
  }
}

console.log('Surface parity — canonical perf-doc set:');
for (const doc of CANONICAL_DOCS) {
  console.log(`  - ${doc}${missingDocs.includes(doc) ? '   [MISSING FILE]' : ''}`);
}
console.log('');
for (const row of report) {
  const mark = row.status === 'OK' ? 'OK  ' : 'FAIL';
  console.log(`  ${mark}  ${row.surface} — ${row.status}`);
  for (const doc of row.missing) {
    console.log(`         missing reference: ${doc}`);
  }
}

if (missingDocs.length > 0) {
  console.log('');
  console.log('Canonical doc file(s) missing from the repo:');
  for (const doc of missingDocs) {
    console.log(`  - ${doc}`);
  }
}

console.log('');
if (failed) {
  console.error('verify:surface-parity FAILED — the three agent surfaces (AGENTS.md, '
    + 'CLAUDE.md, .cursor/rules/*) must each reference the same canonical perf-doc set.');
  process.exit(1);
}
console.log('verify:surface-parity OK — all surfaces reference the canonical perf-doc set.');
