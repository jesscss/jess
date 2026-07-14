#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const handoffPath = resolve(root, 'docs/future/core-architecture/HANDOFF.md');
const cuttingReviewPath = resolve(root, 'docs/future/core-architecture/AGGRESSIVE-CUTTING-REVIEW.md');
const reviewedSourceRoots = [
  'packages/core/src',
  'packages/jess/src',
  'packages/less-parser/src',
  'packages/css-parser/src'
];

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    const stderr = error?.stderr?.toString?.() ?? '';
    throw new Error(stderr || `git ${args.join(' ')} failed`);
  }
}

function reviewBase() {
  for (const ref of ['@{upstream}', 'origin/dev', 'origin/main', 'origin/master']) {
    try {
      const base = git(['merge-base', 'HEAD', ref]).trim();
      if (base) {
        return base;
      }
    } catch {
      // Try the next available branch reference.
    }
  }
  return null;
}

function collectDiff() {
  return [
    git(['diff', '--unified=0', '--', ...reviewedSourceRoots]),
    git(['diff', '--cached', '--unified=0', '--', ...reviewedSourceRoots])
  ].join('\n');
}

function collectBranchDiff() {
  const base = reviewBase();
  if (!base) {
    return '';
  }
  return git([
    'diff',
    '--unified=0',
    `${base}..HEAD`,
    '--',
    ...reviewedSourceRoots
  ]);
}

function collectChangedPaths() {
  const base = reviewBase();
  return [...new Set([
    base
      ? git(['diff', '--name-only', '--diff-filter=ACMR', `${base}..HEAD`, '--'])
      : '',
    ...git(['diff', '--name-only']).split('\n'),
    ...git(['diff', '--cached', '--name-only']).split('\n'),
    ...git(['ls-files', '--others', '--exclude-standard']).split('\n')
  ].filter(Boolean))];
}

function readCostContractRegistry(review) {
  const match = review.match(
    /<!-- BEGIN AGGRESSIVE-CUTTING-COST-CONTRACTS -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- END AGGRESSIVE-CUTTING-COST-CONTRACTS -->/
  );
  if (!match) {
    throw new Error(
      'AGGRESSIVE-CUTTING-REVIEW.md is missing the machine-readable cost-contract registry.'
    );
  }
  let registry;
  try {
    registry = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`Cost-contract registry is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(registry) || registry.length === 0) {
    throw new Error('Cost-contract registry must be a non-empty JSON array.');
  }
  return registry;
}

const requiredCounterNames = [
  'calls',
  'itemsVisited',
  'noFeatureAllocations',
  'noFeatureMisses'
];

function validateCostContractRegistry(registry) {
  const errors = [];
  const ids = new Set();
  for (const contract of registry) {
    if (!contract || typeof contract !== 'object') {
      errors.push('Every cost contract must be an object.');
      continue;
    }
    if (typeof contract.id !== 'string' || contract.id.length === 0 || ids.has(contract.id)) {
      errors.push(`Cost contracts must have unique non-empty ids: ${String(contract.id)}.`);
    }
    ids.add(contract.id);
    if (typeof contract.surface !== 'string' || contract.surface.length === 0) {
      errors.push(`Cost contract ${contract.id} is missing its named surface.`);
    }
    if (!Array.isArray(contract.files) || contract.files.length === 0) {
      errors.push(`Cost contract ${contract.id} must name at least one owning file.`);
    } else if (contract.files.length !== 1) {
      errors.push(`Cost contract ${contract.id} must cover exactly one owning file so its source check cannot be bypassed by adding another file.`);
    }
    const admission = contract.admission;
    if (!admission || typeof admission !== 'object') {
      errors.push(`Cost contract ${contract.id} is missing admission metadata.`);
    } else {
      if (typeof admission.predicate !== 'string' || admission.predicate.length === 0) {
        errors.push(`Cost contract ${contract.id} must name an admission predicate.`);
      }
      if (admission.cost !== 'cheap') {
        errors.push(`Cost contract ${contract.id} admission cost must be cheap.`);
      }
      if (
        typeof admission.before !== 'string'
        || !/collection/i.test(admission.before)
        || !/allocation/i.test(admission.before)
      ) {
        errors.push(
          `Cost contract ${contract.id} must put admission before collection and allocation.`
        );
      }
    }
    if (!Array.isArray(contract.counters) || !requiredCounterNames.every(name => contract.counters.includes(name))) {
      errors.push(
        `Cost contract ${contract.id} must list calls, itemsVisited, noFeatureAllocations, and noFeatureMisses.`
      );
    }
    if (typeof contract.commonCaseProof !== 'string' || !/(benchmark|counter|test)/i.test(contract.commonCaseProof)) {
      errors.push(`Cost contract ${contract.id} must name a common no-feature benchmark or counter test.`);
    }
    if (!Array.isArray(contract.relations) || contract.relations.length === 0) {
      errors.push(`Cost contract ${contract.id} must state at least one counter relation.`);
    }
    const sourceCheck = contract.sourceCheck;
    if (!sourceCheck || typeof sourceCheck !== 'object') {
      errors.push(`Cost contract ${contract.id} must include executable source-check metadata.`);
    } else if (
      typeof sourceCheck.file !== 'string'
      || typeof sourceCheck.caller !== 'string'
      || typeof sourceCheck.call !== 'string'
      || typeof sourceCheck.guard !== 'string'
    ) {
      errors.push(`Cost contract ${contract.id} source-check metadata is incomplete.`);
    } else if (!Array.isArray(contract.files) || contract.files[0] !== sourceCheck.file) {
      errors.push(`Cost contract ${contract.id} source-check file must be its sole owning file.`);
    }
  }
  return errors;
}

function extractCostAuditRecords(latestPass) {
  const match = latestPass.match(/- Hot-path cost contracts:\s*```json\s*([\s\S]*?)\s*```/);
  if (!match) {
    return null;
  }
  try {
    const records = JSON.parse(match[1]);
    return Array.isArray(records) ? records : null;
  } catch {
    return null;
  }
}

function numberCounter(record, names) {
  for (const name of names) {
    if (Number.isInteger(record[name]) && record[name] >= 0) {
      return record[name];
    }
  }
  return null;
}

function validateCostAuditRecords(records, registry, changedPaths) {
  const errors = [];
  if (!records) {
    return ['Latest self-prosecution block is missing a valid Hot-path cost contracts JSON record.'];
  }
  const registryIds = new Set(registry.map(contract => contract.id));
  const byId = new Map();
  for (const record of records) {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string') {
      errors.push('Every hot-path cost audit record must have a string id.');
      continue;
    }
    if (byId.has(record.id)) {
      errors.push(`Hot-path cost audit record ${record.id} is duplicated.`);
    }
    if (!registryIds.has(record.id)) {
      errors.push(`Hot-path cost audit record ${record.id} is not declared in the machine-readable cost-contract registry.`);
    }
    byId.set(record.id, record);
    const admission = record.admission;
    if (
      !admission
      || typeof admission.predicate !== 'string'
      || admission.predicate.length === 0
      || admission.cost !== 'cheap'
      || typeof admission.before !== 'string'
      || !/collection/i.test(admission.before)
      || !/allocation/i.test(admission.before)
    ) {
      errors.push(`Hot-path cost audit record ${record.id} lacks a cheap pre-collection/allocation admission.`);
    }
    const calls = numberCounter(record, ['calls']);
    const featureBearing = numberCounter(record, ['featureBearingCalls', 'featureBearingContainers']);
    const itemsVisited = numberCounter(record, ['itemsVisited']);
    const noFeatureAllocations = numberCounter(record, ['noFeatureAllocations']);
    const noFeatureMisses = numberCounter(record, ['noFeatureMisses']);
    if (calls === null || featureBearing === null || itemsVisited === null || noFeatureAllocations === null || noFeatureMisses === null) {
      errors.push(
        `Hot-path cost audit record ${record.id} must include numeric calls, feature-bearing calls/containers, itemsVisited, noFeatureAllocations, and noFeatureMisses.`
      );
    } else {
      if (featureBearing > calls) {
        errors.push(`Hot-path cost audit record ${record.id} has more feature-bearing calls than calls.`);
      }
      if (noFeatureAllocations > 0 && record.verdict === 'accepted') {
        errors.push(`Hot-path cost audit record ${record.id} accepts a pass with no-feature allocations.`);
      }
    }
    if (typeof record.commonCaseProof !== 'string' || !/(benchmark|counter|test)/i.test(record.commonCaseProof)) {
      errors.push(`Hot-path cost audit record ${record.id} must name a common no-feature benchmark or counter test.`);
    }
    if (!['accepted', 'rejected', 'deferred'].includes(record.verdict)) {
      errors.push(`Hot-path cost audit record ${record.id} must use verdict accepted, rejected, or deferred.`);
    }
  }

  for (const contract of registry) {
    const ownsChangedFile = contract.files.some(file => changedPaths.includes(file));
    if (!ownsChangedFile) {
      continue;
    }
    const record = byId.get(contract.id);
    if (!record) {
      errors.push(`Changed files require the ${contract.id} hot-path cost audit record.`);
      continue;
    }
    const calls = numberCounter(record, ['calls']);
    const containers = numberCounter(record, ['containers']);
    const featureBearing = numberCounter(record, ['featureBearingCalls', 'featureBearingContainers']);
    const noFeatureAllocations = numberCounter(record, ['noFeatureAllocations']);
    if (record.verdict !== 'accepted') {
      errors.push(`Changed production hot-path contract ${contract.id} must be accepted only after rejected/deferred code has been reverted.`);
    }
    for (const relation of contract.relations) {
      if (relation === 'featureBearingContainers < containers' && !(featureBearing !== null && containers !== null && featureBearing < containers)) {
        errors.push(`Cost contract ${contract.id} relation failed: ${relation}.`);
      }
      if (relation === 'featureBearingCalls <= calls' && !(featureBearing !== null && calls !== null && featureBearing <= calls)) {
        errors.push(`Cost contract ${contract.id} relation failed: ${relation}.`);
      }
      if (relation === 'noFeatureAllocations === 0' && noFeatureAllocations !== 0) {
        errors.push(`Cost contract ${contract.id} relation failed: ${relation}.`);
      }
    }
  }
  return errors;
}

const hotPathRoots = [
  'packages/core/src/',
  'packages/jess/src/',
  'packages/less-parser/src/',
  'packages/css-parser/src/'
];

function isTestOnlyPath(path) {
  return /(^|\/)(test|tests|__tests__|fixtures|test-data)(\/|$)|\.(test|spec)\.[^/]+$/.test(path);
}

function isProductionHotPathFile(path) {
  return !isTestOnlyPath(path) && hotPathRoots.some(rootPath => path.startsWith(rootPath));
}

function validateProductionHotPathCoverage(registry, changedPaths) {
  const coveredFiles = new Set();
  for (const contract of registry) {
    for (const file of contract.files) {
      coveredFiles.add(file);
    }
  }
  return changedPaths
    .filter(isProductionHotPathFile)
    .filter(path => !coveredFiles.has(path))
    .map(path => `Changed production hot-path file ${path} is not covered by any machine-readable cost-contract registry entry.`);
}

function validateSourceChecks(registry, changedPaths) {
  const errors = [];
  for (const contract of registry) {
    const sourceCheck = contract.sourceCheck;
    if (!sourceCheck || !changedPaths.includes(sourceCheck.file)) {
      continue;
    }
    const source = readFileSync(resolve(root, sourceCheck.file), 'utf8');
    const callerStart = source.indexOf(sourceCheck.caller);
    const callIndex = callerStart < 0 ? -1 : source.indexOf(sourceCheck.call, callerStart);
    const nextMethod = callerStart < 0 ? -1 : source.indexOf('\n  private ', callerStart + sourceCheck.caller.length);
    const callerBody = callerStart < 0
      ? ''
      : source.slice(callerStart, nextMethod < 0 ? undefined : nextMethod);
    const callOffset = callIndex - callerStart;
    const guardedCall = (() => {
      if (callerStart < 0 || callIndex < 0) {
        return false;
      }
      const prefix = callerBody.slice(0, callOffset);
      const guardPattern = new RegExp(`if\\s*\\([^\\n]*${sourceCheck.guard}[^\\n]*\\)\\s*\\{`, 'g');
      let match;
      while ((match = guardPattern.exec(prefix)) !== null) {
        let balance = 0;
        for (const character of prefix.slice(match.index)) {
          if (character === '{') {
            balance += 1;
          } else if (character === '}') {
            balance -= 1;
          }
        }
        if (balance > 0) {
          return true;
        }
      }
      return false;
    })();
    if (!guardedCall) {
      errors.push(
        `Cost contract ${contract.id} changed its owning file without a conditional admission guard enclosing ${sourceCheck.call}.`
      );
    }
  }
  return errors;
}

const requiredLabels = [
  '- Architecture surface:',
  '- Separation/duplication:',
  '- Cumulative node weight:',
  '- New traversal:',
  '- New node/materialization:',
  '- Render path:',
  '- Helper/API surface:',
  '- Metadata mutations:',
  '- Review-flagged diff tokens:',
  '- Evidence:',
  '- Verdict:'
];

const dangerPatterns = [
  ['loop/traversal', /\+\s*(for|while)\s*\(/],
  ['array helper', /\+\s*.*(?:Array\.(from|of)|Object\.(values|entries|keys)|\.(map|filter|reduce|sort|flatMap|slice|join|forEach))\s*\(/],
  ['array spread/materialization', /\+\s*.*\[\.\.\.|\+\s*.*\.\.\.\w/],
  ['generator', /\+\s*.*function\s*\*|\+\s*.*yield\b/],
  ['node construction', /\+\s*.*\bnew\s+[A-Z][A-Za-z0-9_]*\s*\(/],
  ['copy helper', /\+\s*.*\b(copyWithReusableLeaves|copyChild|constructCopy|\.copy|\.clone)\b/],
  ['inherit/adopt/frozen', /\+\s*.*(\.inherit\s*\(|\.adopt\s*\(|\.frozen\b|frozen\s*=)/],
  ['parent/source mutation', /\+\s*.*(\.parent\s*=|sourceNode|sourceRoot|_sourceRoot|location\s*=|_location)/],
  ['generic defensive read', /\+\s*.*(Reflect\.|Object\.hasOwn|hasOwnProperty)/],
  ['side map/set', /\+\s*.*\b(new\s+)?(?:WeakMap|Map|Set)\b|\+\s*.*globalThis\.(?:WeakMap|Map|Set)\b/],
  ['routine error control', /\+\s*.*(try\s*\{|catch\s*\(|new\s+Error\b)/],
  ['materialized array/object', /\+\s*.*(new Array<|new Array\(|\[\]|=\s*\{)/]
];

const diff = [collectBranchDiff(), collectDiff()].join('\n');
const changedPaths = collectChangedPaths();
const additions = diff.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++'));
const findings = [];

for (const [label, pattern] of dangerPatterns) {
  const matches = additions.filter(line => pattern.test(line));
  if (matches.length > 0) {
    findings.push({ label, matches: matches.slice(0, 8), count: matches.length });
  }
}

const handoff = readFileSync(handoffPath, 'utf8');
const review = readFileSync(cuttingReviewPath, 'utf8');
const registryErrors = [];
let registry = [];
try {
  registry = readCostContractRegistry(review);
  registryErrors.push(...validateCostContractRegistry(registry));
} catch (error) {
  registryErrors.push(error.message);
}
const sectionIndex = handoff.lastIndexOf('## Aggressive Cutting Self-Prosecution');
const section = sectionIndex === -1 ? '' : handoff.slice(sectionIndex);
const latestPassIndex = section.indexOf('- Latest pass:');
const nextPassIndex = latestPassIndex === -1
  ? -1
  : section.indexOf('\n- Latest pass:', latestPassIndex + 1);
const latestPass = latestPassIndex === -1
  ? section
  : section.slice(latestPassIndex, nextPassIndex === -1 ? undefined : nextPassIndex);
const missingLabels = requiredLabels.filter(label => !latestPass.includes(label));
const stalePlaceholders = /\b(TODO|TBD|fill in|pending)\b/i.test(latestPass);

let failed = false;

if (registryErrors.length > 0) {
  failed = true;
  console.error('\nInvalid aggressive-cutting cost-contract registry:');
  for (const error of registryErrors) {
    console.error(`- ${error}`);
  }
}

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
  const reviewTokenLine = latestPass
    .split('\n')
    .find(line => line.startsWith('- Review-flagged diff tokens:'));
  if (!reviewTokenLine || /\b(none|no new|n\/a)\b/i.test(reviewTokenLine)) {
    failed = true;
    console.error(
      '\nDanger tokens require a non-empty "- Review-flagged diff tokens:" accounting line in the latest self-prosecution block.'
    );
  }
  const missingFindingLabels = findings
    .map(finding => finding.label)
    .filter(label => !latestPass.includes(`[${label}]`));
  if (missingFindingLabels.length > 0) {
    failed = true;
    console.error(
      `\nLatest self-prosecution block must explicitly account for every danger category by label. Missing: ${missingFindingLabels.map(label => `[${label}]`).join(', ')}`
    );
  }
}

const hotPathChanged = changedPaths.some(path => hotPathRoots.some(rootPath => path.startsWith(rootPath)));
const productionHotPathChanged = changedPaths.some(isProductionHotPathFile);
const requiresCostAudit = hotPathChanged || findings.length > 0;
if (requiresCostAudit && registryErrors.length === 0) {
  const auditRecords = extractCostAuditRecords(latestPass);
  const auditErrors = validateCostAuditRecords(auditRecords, registry, changedPaths);
  const sourceCheckErrors = validateSourceChecks(registry, changedPaths);
  const coverageErrors = productionHotPathChanged
    ? validateProductionHotPathCoverage(registry, changedPaths)
    : [];
  if (auditErrors.length > 0 || sourceCheckErrors.length > 0 || coverageErrors.length > 0) {
    failed = true;
    console.error('\nHot-path cost contract review failed:');
    for (const error of [...auditErrors, ...sourceCheckErrors, ...coverageErrors]) {
      console.error(`- ${error}`);
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
    console.log('Danger tokens accounted for in the handoff self-prosecution block.');
  }
}
