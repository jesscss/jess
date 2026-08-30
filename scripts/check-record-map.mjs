#!/usr/bin/env node
/**
 * Keeps docs/RECORD-MAP.md honest.
 *
 * HARD FAIL: any markdown link in the Record Map (or a *RECORD-MAP.md sub-map it
 * links to) that does not resolve to an existing file — a broken routing entry
 * is worse than none, because it sends an agent to a dead end.
 *
 * WARN: a method-of-record doc (a `*-SPEC.md` / `*-STANDARD.md` / `*-INVARIANTS.md`
 * in a curated area) that no map links to — it may need indexing. A warning, not
 * a failure: not every SPEC-named file is a live method of record.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const TOP = path.join(root, 'docs/RECORD-MAP.md');

/* Directories whose method-of-record docs the map is expected to cover. */
const CURATED_DIRS = [
  'docs/design',
  'docs/architecture',
  'docs/architecture/parser',
  'docs/perf',
  'docs/process'
].map(d => path.join(root, d));

const RECORD_DOC = /-(SPEC|STANDARD|INVARIANTS)\.md$/;
const LINK = /\[[^\]]+\]\(([^)]+)\)/g;

function linkedTargets(file, seen, linked) {
  if (seen.has(file)) {
    return;
  }
  seen.add(file);
  const dir = path.dirname(file);
  const text = readFileSync(file, 'utf8');
  let m;
  while ((m = LINK.exec(text)) !== null) {
    const href = m[1].split('#')[0].trim();
    if (!href || /^https?:/.test(href) || href.startsWith('mailto:')) {
      continue;
    }
    const target = path.resolve(dir, href);
    linked.add(target);
    if (!existsSync(target)) {
      broken.push({ from: path.relative(root, file), href });
      continue;
    }
    if (target.endsWith('RECORD-MAP.md')) {
      linkedTargets(target, seen, linked);
    }
  }
}

function walk(dir, out) {
  if (!existsSync(dir)) {
    return;
  }
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      continue; // curated dirs are listed explicitly, incl. subdirs
    }
    if (RECORD_DOC.test(entry)) {
      out.push(full);
    }
  }
}

const broken = [];
const linked = new Set();
if (!existsSync(TOP)) {
  console.error(`check:record-map — missing ${path.relative(root, TOP)}`);
  process.exit(1);
}
linkedTargets(TOP, new Set(), linked);

if (broken.length > 0) {
  console.error('check:record-map — BROKEN LINKS:');
  for (const b of broken) {
    console.error(`  ${b.from} -> ${b.href}`);
  }
  process.exit(1);
}

const recordDocs = [];
for (const dir of CURATED_DIRS) {
  walk(dir, recordDocs);
}
const unindexed = recordDocs.filter(d => !linked.has(d));

console.log(`check:record-map — ${linked.size} links resolve; ${recordDocs.length} record docs in curated dirs.`);
if (unindexed.length > 0) {
  console.log('WARN — method-of-record docs not indexed in the Record Map (review whether they belong):');
  for (const d of unindexed) {
    console.log(`  ${path.relative(root, d)}`);
  }
}
