#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const handoffPath = resolve(root, 'docs/future/core-architecture/HANDOFF.md');

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    const stderr = error?.stderr?.toString?.() ?? '';
    throw new Error(stderr || `git ${args.join(' ')} failed`);
  }
}

function collectDiff() {
  return [
    git(['diff', '--unified=0', '--', 'packages/core/src', 'docs/future/core-architecture', 'scripts', 'package.json', 'AGENTS.md']),
    git(['diff', '--cached', '--unified=0', '--', 'packages/core/src', 'docs/future/core-architecture', 'scripts', 'package.json', 'AGENTS.md'])
  ].join('\n');
}

const requiredLabels = [
  '- New traversal:',
  '- New node/materialization:',
  '- Render path:',
  '- Helper/API surface:',
  '- Metadata mutations:',
  '- Evidence:',
  '- Verdict:'
];

const dangerPatterns = [
  ['loop/traversal', /\+\s*(for|while)\s*\(/],
  ['array helper', /\+\s*.*\.(map|filter|reduce|sort|flatMap|slice|join)\s*\(/],
  ['generator', /\+\s*.*function\s*\*|\+\s*.*yield\b/],
  ['node construction', /\+\s*.*\bnew\s+[A-Z][A-Za-z0-9_]*\s*\(/],
  ['copy helper', /\+\s*.*\b(copyWithReusableLeaves|copyChild|constructCopy|\.copy|\.clone)\b/],
  ['inherit/adopt/frozen', /\+\s*.*(\.inherit\s*\(|\.adopt\s*\(|\.frozen\b|frozen\s*=)/],
  ['parent/source mutation', /\+\s*.*(\.parent\s*=|sourceNode|sourceRoot|_sourceRoot|location\s*=|_location)/],
  ['generic defensive read', /\+\s*.*(Reflect\.|Object\.hasOwn|hasOwnProperty)/],
  ['side map/set', /\+\s*.*\b(new\s+)?(WeakMap|Map|Set)\b/],
  ['routine error control', /\+\s*.*(try\s*\{|catch\s*\(|new\s+Error\b)/],
  ['materialized array/object', /\+\s*.*(new Array<|new Array\(|\[\]|=\s*\{)/]
];

const diff = collectDiff();
const additions = diff.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++'));
const findings = [];

for (const [label, pattern] of dangerPatterns) {
  const matches = additions.filter(line => pattern.test(line));
  if (matches.length > 0) {
    findings.push({ label, matches: matches.slice(0, 8), count: matches.length });
  }
}

const handoff = readFileSync(handoffPath, 'utf8');
const sectionIndex = handoff.lastIndexOf('## Aggressive Cutting Self-Prosecution');
const section = sectionIndex === -1 ? '' : handoff.slice(sectionIndex);
const missingLabels = requiredLabels.filter(label => !section.includes(label));
const stalePlaceholders = /\b(TODO|TBD|fill in|pending)\b/i.test(section);

let failed = false;

if (sectionIndex === -1 || missingLabels.length > 0) {
  failed = true;
  console.error('Missing required Aggressive Cutting Self-Prosecution block in docs/future/core-architecture/HANDOFF.md.');
  if (missingLabels.length > 0) {
    console.error(`Missing labels: ${missingLabels.join(', ')}`);
  }
}

if (stalePlaceholders) {
  failed = true;
  console.error('Self-prosecution block still contains a placeholder word: TODO/TBD/fill in/pending.');
}

if (findings.length > 0) {
  console.error('\nDanger tokens found in the current diff. Each must be prosecuted in the handoff block:');
  for (const finding of findings) {
    console.error(`\n[${finding.label}] ${finding.count} match(es)`);
    for (const match of finding.matches) {
      console.error(match.slice(0, 220));
    }
    if (finding.count > finding.matches.length) {
      console.error(`... ${finding.count - finding.matches.length} more`);
    }
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log('Aggressive cutting review block present.');
  if (findings.length === 0) {
    console.log('No danger tokens found in scoped diff.');
  } else {
    console.log('Danger tokens require human/agent review; see handoff self-prosecution block.');
  }
}
