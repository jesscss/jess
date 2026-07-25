#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = resolve(new URL('..', import.meta.url).pathname);
const handoffPath = resolve(root, 'docs/architecture/core/HANDOFF.md');
const cuttingReviewPath = resolve(root, 'docs/architecture/core/AGGRESSIVE-CUTTING-REVIEW.md');
const skipExecutableEvidence = process.argv.includes('--skip-executable-evidence');
const reviewMode = process.argv.includes('--mode=staged')
  ? 'staged'
  : process.argv.includes('--mode=release')
    ? 'release'
    : process.argv.includes('--mode=committed')
      ? 'committed'
      : 'working';
const unsupportedAggregateMode = process.argv.includes('--mode=upstream');
const reviewedSourceRoots = [
  'packages/core/src',
  'packages/jess/src',
  'packages/less-parser/src',
  'packages/css-parser/src'
];
const hotPathRoots = reviewedSourceRoots.map(rootPath => `${rootPath}/`);
const parserRuntimeDebtPath = 'scripts/parser-runtime-boundary-debt.json';
const approvedQualityFixRules = new Set([
  'curly',
  '@stylistic/arrow-parens',
  '@stylistic/comma-dangle',
  '@stylistic/block-spacing',
  '@stylistic/brace-style',
  '@stylistic/indent',
  '@stylistic/no-trailing-spaces'
]);
const qualitySensitivePath = /(^|\/)(?:eslint\.config\.[^/]+|package\.json|pnpm-lock\.yaml)$/u;

function sourceFiles(rootPath) {
  const found = [];
  for (const entry of readdirSync(resolve(root, rootPath), { withFileTypes: true })) {
    const path = `${rootPath}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      found.push(path);
    }
  }
  return found;
}

function publicArtifactReferences(entry, packageManifest, buildConfig) {
  const packageRoot = entry.split('/').slice(0, 2).join('/');
  const fragment = entry.slice(packageRoot.length + 1);
  const strings = [];
  const collectStrings = (value) => {
    if (typeof value === 'string') {
      strings.push(value);
    } else if (Array.isArray(value)) {
      for (const child of value) {
        collectStrings(child);
      }
    } else if (value !== null && typeof value === 'object') {
      for (const child of Object.values(value)) {
        collectStrings(child);
      }
    }
  };
  collectStrings(JSON.parse(packageManifest).exports);
  return {
    publicExports: strings.filter(value => value.includes(fragment)).length,
    buildEntries: buildConfig.split(fragment).length - 1
  };
}

function modulePathWithoutExtension(path) {
  return path.replace(/\\/g, '/').replace(/\.(?:[cm]?[jt]sx?)$/, '');
}

function sourceModuleReferences(sourcePath, source, entry) {
  const entryPath = modulePathWithoutExtension(entry);
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const references = [];
  const patterns = [
    { kind: 'import', expression: /\bimport\s+(?:type\s+)?(?:[\w\s*$,{}]+?\s+from\s+)?(['"])([^'"\n]+)\1/g },
    { kind: 'import', expression: /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g },
    { kind: 're-export', expression: /\bexport\s+(?:type\s+)?(?:[\w\s*$,{}]+?\s+from\s+)(['"])([^'"\n]+)\1/g }
  ];
  for (const { kind, expression } of patterns) {
    for (const match of withoutComments.matchAll(expression)) {
      const specifier = match[2];
      if (!specifier.startsWith('.')) {
        continue;
      }
      const resolved = modulePathWithoutExtension(
        relative(root, resolve(dirname(resolve(root, sourcePath)), specifier))
      );
      if (resolved === entryPath) {
        references.push(kind);
      }
    }
  }
  return references;
}

function grammarSourceReferences(sourcePath, source, entry) {
  return sourceModuleReferences(sourcePath, source, entry).length > 0;
}

function privateGrammarReachability(entry) {
  const packageRoot = entry.split('/').slice(0, 2).join('/');
  const sources = sourceFiles(`${packageRoot}/src`);
  let productionImporters = 0;
  let publicExports = 0;
  for (const path of sources) {
    if (path === entry) {
      continue;
    }
    const source = readFileSync(resolve(root, path), 'utf8');
    const references = sourceModuleReferences(path, source, entry);
    if (references.length > 0) {
      productionImporters += 1;
    }
    if (references.includes('re-export')) {
      publicExports += 1;
    }
  }
  const artifacts = publicArtifactReferences(
    entry,
    readFileSync(resolve(root, `${packageRoot}/package.json`), 'utf8'),
    readFileSync(resolve(root, `${packageRoot}/tsdown.config.ts`), 'utf8')
  );
  publicExports += artifacts.publicExports;
  return { productionImporters, publicExports, buildEntries: artifacts.buildEntries };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function stagedStatusEntries() {
  return git(['diff', '--cached', '--name-status', '--diff-filter=ACDMRTUXB', '--'])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split('\t');
      return { status, paths };
    });
}

function dirtyWorkingPaths() {
  return git(['status', '--porcelain=v1', '--untracked-files=all'])
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const rawPath = line.slice(3);
      const renameParts = rawPath.split(' -> ');
      return renameParts.length === 2 ? renameParts : [rawPath];
    });
}

function qualityOnlyStagedPaths(entries, unstagedPaths, dirtyPaths) {
  if (entries.length === 0) {
    return undefined;
  }
  const paths = [];
  for (const entry of entries) {
    if (entry.status !== 'M' || entry.paths.length !== 1) {
      return undefined;
    }
    const path = entry.paths[0];
    if (
      !reviewedSourceRoots.some(sourceRoot => path.startsWith(`${sourceRoot}/`))
      || !/\.[cm]?[jt]sx?$/u.test(path)
    ) {
      return undefined;
    }
    paths.push(path);
  }
  if (paths.some(path => unstagedPaths.includes(path))) {
    return undefined;
  }
  if (dirtyPaths.some(path => qualitySensitivePath.test(path))) {
    return undefined;
  }
  return paths;
}

async function reproduceApprovedQualityFixes(files, readBefore, readTarget, lintText) {
  let fixed = false;
  for (const file of files) {
    const before = readBefore(file);
    const target = readTarget(file);
    const result = await lintText(before, file);
    const output = result.output ?? before;
    if (
      result.fatalErrorCount !== 0
      || result.errorCount !== 0
      || output !== target
    ) {
      return false;
    }
    fixed ||= output !== before;
  }
  return fixed;
}

async function proveStagedQualityOnlyFix(mode, snapshots, options = {}) {
  if (mode !== 'staged') {
    return false;
  }
  const entries = options.entries ?? stagedStatusEntries();
  const dirtyPaths = options.dirtyPaths ?? dirtyWorkingPaths();
  const unstagedPaths = options.unstagedPaths
    ?? (options.entries
      ? snapshots.unstaged
      : git(['diff', '--name-only', '--']).split('\n').filter(Boolean));
  const files = qualityOnlyStagedPaths(entries, unstagedPaths, dirtyPaths);
  if (!files) {
    return false;
  }
  const eslint = options.eslint ?? new ESLint({
    cwd: root,
    fix: message => approvedQualityFixRules.has(message.ruleId)
  });
  const lintText = options.lintText ?? (async (source, file) => {
    const [result] = await eslint.lintText(source, {
      filePath: resolve(root, file),
      warnIgnored: true
    });
    return result;
  });
  const readBefore = options.readBefore ?? (file => git(['show', `HEAD:${file}`]));
  const readTarget = options.readTarget ?? (file => git(['show', `:${file}`]));
  return reproduceApprovedQualityFixes(files, readBefore, readTarget, lintText);
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

function scopedChangedPaths(mode, snapshots) {
  if (mode === 'release') {
    // An alpha branch is a squash snapshot of the validated dev tree. Its
    // branch-wide diff is historical aggregate, not one bounded optimization
    // patch, so release mode validates the registry/self-prosecution evidence
    // without prosecuting every old hunk again.
    return [];
  }
  if (mode === 'staged') {
    return [...new Set(snapshots.staged)];
  }
  if (mode === 'committed') {
    return [...new Set(snapshots.branch)];
  }
  return [...new Set([
    ...snapshots.unstaged,
    ...snapshots.staged,
    ...snapshots.untracked
  ])];
}

function changedPathSnapshots() {
  const base = reviewBase();
  return {
    branch: base
      ? git(['diff', '--name-only', '--diff-filter=ACMR', `${base}..HEAD`, '--']).split('\n').filter(Boolean)
      : [],
    unstaged: git(['diff', '--name-only', '--diff-filter=ACMR', '--']).split('\n').filter(Boolean),
    staged: git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '--']).split('\n').filter(Boolean),
    untracked: git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)
  };
}

function collectScopedDiff(mode, changedPaths) {
  if (mode === 'release') {
    return '';
  }
  const productionPaths = productionChangedPaths(changedPaths);
  if (productionPaths.length === 0) {
    return '';
  }
  if (mode === 'staged') {
    return git(['diff', '--cached', '--unified=0', '--', ...productionPaths]);
  }
  if (mode === 'committed') {
    const base = reviewBase();
    return base
      ? git(['diff', '--unified=0', `${base}..HEAD`, '--', ...productionPaths])
      : '';
  }
  return [
    git(['diff', '--unified=0', '--', ...productionPaths]),
    git(['diff', '--cached', '--unified=0', '--', ...productionPaths])
  ].join('\n');
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
  'admittedCalls',
  'admissionCalls',
  'admissionItemsVisited',
  'itemsVisited',
  'noFeatureAllocations',
  'noFeatureMisses'
];

const counterRelationPattern = /^([A-Za-z][A-Za-z0-9_]*)\s*(<=|<|===)\s*([A-Za-z][A-Za-z0-9_]*|0)$/;
const necessityFields = ['factSource', 'rediscovery', 'carryForward', 'whyNotCarried'];

function validateNecessityMetadata(metadata, label) {
  const errors = [];
  if (!metadata || typeof metadata !== 'object') {
    return [`${label} must include proof-of-necessity metadata.`];
  }
  for (const field of necessityFields) {
    if (typeof metadata[field] !== 'string' || metadata[field].trim().length < 12) {
      errors.push(`${label} necessity.${field} must contain an evidence-backed explanation.`);
    }
  }
  if (!['audit-required', 'proven'].includes(metadata.status)) {
    errors.push(`${label} necessity.status must be audit-required or proven.`);
  }
  return errors;
}

function parseCounterRelation(relation) {
  if (typeof relation !== 'string') {
    return null;
  }
  const match = relation.match(counterRelationPattern);
  if (!match) {
    return null;
  }
  return { left: match[1], operator: match[2], right: match[3] };
}

function counterValue(record, name) {
  return Number.isInteger(record[name]) && record[name] >= 0 ? record[name] : null;
}

function evaluateCounterRelation(relation, record) {
  const parsed = parseCounterRelation(relation);
  if (!parsed) {
    return { ok: false, reason: 'invalid relation syntax' };
  }
  const left = counterValue(record, parsed.left);
  const right = parsed.right === '0' ? 0 : counterValue(record, parsed.right);
  if (left === null || right === null) {
    return { ok: false, reason: `missing numeric counter (${parsed.left}, ${parsed.right})` };
  }
  const ok = parsed.operator === '<='
    ? left <= right
    : parsed.operator === '<'
      ? left < right
      : left === right;
  return { ok, left, operator: parsed.operator, right };
}

function validateDeclaredCounterRelations(contract) {
  const errors = [];
  const declared = new Set(contract.counters ?? []);
  for (const relation of contract.relations ?? []) {
    const parsed = parseCounterRelation(relation);
    if (!parsed) {
      errors.push(`Cost contract ${contract.id} has invalid counter relation: ${String(relation)}.`);
      continue;
    }
    if (!declared.has(parsed.left) || (parsed.right !== '0' && !declared.has(parsed.right))) {
      errors.push(`Cost contract ${contract.id} relation must use counters declared by the contract: ${relation}.`);
    }
  }
  return errors;
}

/**
 * Conservative-filter registry metadata. Unlike the precise model (which forbids
 * no-feature allocations outright), a conservative filter may allocate to admit a
 * superset of true matches — but ONLY when it is byte-identical AND measurably
 * faster. This block makes both non-negotiable and machine-checkable: it names the
 * governed hot function, requires a positive speedup margin on a real benchmark
 * phase, and forces the contract to acknowledge its no-feature-path allocation is
 * paid for by that net speedup. Removing any of these turns the shape back into an
 * unjustified allocation, so they gate the allocation escape rather than open it.
 */
function validateConservativeFilterMetadata(contract) {
  const errors = [];
  const cf = contract.conservativeFilter;
  if (!cf || typeof cf !== 'object') {
    return [`Conservative-filter cost contract ${contract.id} must include a conservativeFilter block.`];
  }
  if (
    typeof cf.supersetOf !== 'string'
    || !contract.counters?.includes(cf.supersetOf)
    || !/^featureBearing/i.test(cf.supersetOf)
  ) {
    errors.push(`Conservative-filter cost contract ${contract.id} conservativeFilter.supersetOf must name a declared featureBearing counter.`);
  }
  if (typeof cf.governedFunction !== 'string' || cf.governedFunction.length === 0) {
    errors.push(`Conservative-filter cost contract ${contract.id} must name the governed hot function it speeds up.`);
  }
  const speedup = cf.speedup;
  if (
    !speedup
    || typeof speedup !== 'object'
    || !['parse-render', 'render'].includes(speedup.phase)
    || !Number.isFinite(speedup.minPercentFaster)
    || speedup.minPercentFaster <= 0
  ) {
    errors.push(`Conservative-filter cost contract ${contract.id} must require a positive measured speedup on a benchmark phase (speedup.phase + speedup.minPercentFaster > 0).`);
  }
  const allocation = cf.allocation;
  if (
    !allocation
    || typeof allocation !== 'object'
    || allocation.onNoFeaturePath !== true
    || allocation.justifiedBy !== 'net-speedup'
  ) {
    errors.push(`Conservative-filter cost contract ${contract.id} must acknowledge its no-feature-path allocation is justified by net speedup (allocation.onNoFeaturePath: true, justifiedBy: "net-speedup").`);
  }
  return errors;
}

/**
 * Byte-identity + measured-speedup gate for a conservative-filter audit record.
 * Byte-identity is the non-negotiable core: both benchmark phases must render the
 * same output (equal outputSha256), on top of the per-phase byteIdentical A/B the
 * generic validator already enforces. The governed hot function must be measurably
 * faster than before by the contract's declared margin — a filter that isn't faster
 * is rejected (no defensive slowdown). Returns false (and records why) on any gap,
 * which the caller uses to refuse the no-feature allocation escape.
 */
function checkConservativeFilterSpeedup(record, filterMeta, errors) {
  const gov = record.governedFunction;
  if (
    !gov
    || typeof gov !== 'object'
    || gov.name !== filterMeta.governedFunction
    || !Number.isFinite(gov.beforeMs)
    || gov.beforeMs <= 0
    || !Number.isFinite(gov.afterMs)
    || gov.afterMs <= 0
  ) {
    errors.push(`Conservative-filter record ${record.id} must record a governedFunction { name: "${filterMeta.governedFunction}", beforeMs, afterMs } measurement.`);
    return false;
  }
  const margin = Number.isFinite(filterMeta.speedup?.minPercentFaster)
    ? filterMeta.speedup.minPercentFaster
    : 0;
  const required = gov.beforeMs * (1 - margin / 100);
  if (!(gov.afterMs < gov.beforeMs) || gov.afterMs > required) {
    errors.push(`Conservative-filter record ${record.id} governedFunction speedup insufficient: after ${gov.afterMs}ms must be < before ${gov.beforeMs}ms by >= ${margin}% (<= ${required.toFixed(3)}ms).`);
    return false;
  }
  const parseRenderSha = record.benchmark?.['parse-render']?.outputSha256;
  const renderSha = record.benchmark?.render?.outputSha256;
  if (typeof parseRenderSha !== 'string' || parseRenderSha !== renderSha) {
    errors.push(`Conservative-filter record ${record.id} must render byte-identical output across both benchmark phases (equal outputSha256).`);
    return false;
  }
  return true;
}

/**
 * Redundant-call-elimination registry metadata. This kind models a pure work
 * REMOVAL — a call/computation deleted for a subset of inputs — rather than an
 * admission FILTER. It is the third recurring shape the gate kept blocking:
 * byte-identical work removal. Acceptance is deliberately hard and cannot be
 * honestly satisfied by a cost-ADDING or output-CHANGING change:
 *   - governedFunction: the function whose invocations are eliminated.
 *   - eliminatedSite:   the caller/site where the call was removed.
 *   - speedup:          a REQUIRED positive measured speedup on a benchmark phase
 *                       (a removal that is not faster is pointless and rejected).
 *   - redundancyProof:  the correctness argument for WHY the removed work is safe
 *                       to drop — either DEAD (no consumer) or COVERED by a named
 *                       later authoritative check. A genuine cost-add cannot name
 *                       an authority that makes its ADDED work redundant.
 * The net-removal counter delta (callsAfter <= callsBefore) is enforced via the
 * declared relations; the record-side proof lives in checkRedundantCallElimination.
 */
function validateRedundantCallEliminationMetadata(contract) {
  const errors = [];
  const rce = contract.redundantCallElimination;
  if (!rce || typeof rce !== 'object') {
    return [`Redundant-call-elimination cost contract ${contract.id} must include a redundantCallElimination block.`];
  }
  if (typeof rce.governedFunction !== 'string' || rce.governedFunction.length === 0) {
    errors.push(`Redundant-call-elimination cost contract ${contract.id} must name the governedFunction whose calls are eliminated.`);
  }
  if (typeof rce.eliminatedSite !== 'string' || rce.eliminatedSite.length === 0) {
    errors.push(`Redundant-call-elimination cost contract ${contract.id} must name the eliminatedSite (the caller the call was removed from).`);
  }
  const speedup = rce.speedup;
  if (
    !speedup
    || typeof speedup !== 'object'
    || !['parse-render', 'render'].includes(speedup.phase)
    || !Number.isFinite(speedup.minPercentFaster)
    || speedup.minPercentFaster <= 0
  ) {
    errors.push(`Redundant-call-elimination cost contract ${contract.id} must require a positive measured speedup on a benchmark phase (speedup.phase + speedup.minPercentFaster > 0).`);
  }
  const proof = rce.redundancyProof;
  if (
    !proof
    || typeof proof !== 'object'
    || !['dead', 'covered-by-later-check'].includes(proof.basis)
    || typeof proof.authority !== 'string'
    || proof.authority.trim().length < 12
  ) {
    errors.push(`Redundant-call-elimination cost contract ${contract.id} must justify the removal with redundancyProof.basis ("dead" or "covered-by-later-check") and a named authority.`);
  }
  return errors;
}

/**
 * Byte-identity + measured-speedup + net-removal + redundancy gate for a
 * redundant-call-elimination audit record. All four are non-negotiable, and none
 * can be honestly produced by a cost-ADDING or output-CHANGING change:
 *   1. Byte-identity: both benchmark phases render the same output (equal
 *      outputSha256), on top of the per-phase byteIdentical A/B the generic
 *      validator already enforces.
 *   2. Speedup: the governed function must be measurably faster than before by the
 *      contract's declared margin (no defensive slowdown).
 *   3. Net removal: callsAfter <= callsBefore for the eliminated function, and the
 *      change must actually reduce work (callsAfter < callsBefore, OR a positive
 *      deletedLineCount for a fully-dead removal).
 *   4. Redundancy proof: the record restates why the removal is safe (basis +
 *      authority), matching the contract.
 * Returns false (recording why) on any gap so the caller refuses the acceptance.
 */
function checkRedundantCallElimination(record, meta, errors) {
  let ok = true;
  const gov = record.governedFunction;
  if (
    !gov
    || typeof gov !== 'object'
    || gov.name !== meta.governedFunction
    || !Number.isFinite(gov.beforeMs)
    || gov.beforeMs <= 0
    || !Number.isFinite(gov.afterMs)
    || gov.afterMs <= 0
  ) {
    errors.push(`Redundant-call-elimination record ${record.id} must record a governedFunction { name: "${meta.governedFunction}", beforeMs, afterMs } measurement.`);
    ok = false;
  } else {
    const margin = Number.isFinite(meta.speedup?.minPercentFaster) ? meta.speedup.minPercentFaster : 0;
    const required = gov.beforeMs * (1 - margin / 100);
    if (!(gov.afterMs < gov.beforeMs) || gov.afterMs > required) {
      errors.push(`Redundant-call-elimination record ${record.id} governedFunction speedup insufficient: after ${gov.afterMs}ms must be < before ${gov.beforeMs}ms by >= ${margin}% (<= ${required.toFixed(3)}ms).`);
      ok = false;
    }
  }
  const parseRenderSha = record.benchmark?.['parse-render']?.outputSha256;
  const renderSha = record.benchmark?.render?.outputSha256;
  if (typeof parseRenderSha !== 'string' || parseRenderSha !== renderSha) {
    errors.push(`Redundant-call-elimination record ${record.id} must render byte-identical output across both benchmark phases (equal outputSha256).`);
    ok = false;
  }
  const callsBefore = counterValue(record, 'callsBefore');
  const callsAfter = counterValue(record, 'callsAfter');
  const deletedLineCount = Number.isInteger(record.deletedLineCount) && record.deletedLineCount > 0
    ? record.deletedLineCount
    : 0;
  if (callsBefore === null || callsAfter === null) {
    errors.push(`Redundant-call-elimination record ${record.id} must record integer callsBefore and callsAfter for the eliminated function.`);
    ok = false;
  } else if (callsAfter > callsBefore) {
    errors.push(`Redundant-call-elimination record ${record.id} is not a removal: callsAfter ${callsAfter} > callsBefore ${callsBefore}.`);
    ok = false;
  } else if (callsAfter === callsBefore && deletedLineCount === 0) {
    errors.push(`Redundant-call-elimination record ${record.id} removes nothing: callsAfter === callsBefore and no deletedLineCount > 0.`);
    ok = false;
  }
  const proof = record.redundancyProof;
  if (
    !proof
    || typeof proof !== 'object'
    || proof.basis !== meta.redundancyProof?.basis
    || !['dead', 'covered-by-later-check'].includes(proof.basis)
    || typeof proof.authority !== 'string'
    || proof.authority.trim().length < 12
  ) {
    errors.push(`Redundant-call-elimination record ${record.id} must restate the redundancyProof (basis matching the contract + named authority) explaining why the removed work is safe.`);
    ok = false;
  }
  return ok;
}

/**
 * Neutral-or-negative auto-pass registry metadata. This kind is the broad admission
 * for a change that is provably cost-NEUTRAL or cost-NEGATIVE without authoring a
 * bespoke per-container admission contract. It is deliberately NOT a weakening: the
 * three heavy contract kinds (precise / conservative-filter / redundant-call-
 * elimination) and the byte-identity + danger-token requirements are all untouched.
 * The auto-pass only removes the admission-COUNTER ceremony for a change that:
 *   - is byte-identical (declared here; re-verified by the landing's benchmark +
 *     all-less byte-identity gates that already run), and
 *   - introduces zero danger tokens (re-checked against the live diff by the caller;
 *     danger tokens ARE the gate's proxy for new allocation/loop/map/clone cost), and
 *   - declares costDelta "neutral" or "decrease" with a one-paragraph justification.
 * A cost-ADDING change cannot honestly satisfy this: new allocation/traversal/map/
 * clone constructs are danger tokens (fail the token re-check), an output change fails
 * byte-identity, and an admitted cost increase must declare costDelta "increase"
 * (rejected here) and route to a precise / conservative-filter contract instead.
 */
function validateNeutralRefactorMetadata(contract) {
  const errors = [];
  const nr = contract.neutralRefactor;
  if (!nr || typeof nr !== 'object') {
    return [`Neutral-or-negative cost contract ${contract.id} must include a neutralRefactor block.`];
  }
  if (!['neutral', 'decrease'].includes(nr.costDelta)) {
    errors.push(`Neutral-or-negative cost contract ${contract.id} neutralRefactor.costDelta must be "neutral" or "decrease" (a cost-adding change must use a precise or conservative-filter contract).`);
  }
  if (typeof nr.why !== 'string' || nr.why.trim().length < 40) {
    errors.push(`Neutral-or-negative cost contract ${contract.id} must justify cost-neutrality with a neutralRefactor.why paragraph.`);
  }
  const bi = nr.byteIdentity;
  if (
    !bi
    || typeof bi !== 'object'
    || bi.fixture !== 'benchmark.less'
    || bi.collapseNesting !== true
    || typeof bi.outputSha256 !== 'string'
    || !/^[a-f0-9]{16,64}$/.test(bi.outputSha256)
    || /^0+$/.test(bi.outputSha256)
    || !Number.isInteger(bi.outputBytes)
    || bi.outputBytes <= 0
  ) {
    errors.push(`Neutral-or-negative cost contract ${contract.id} must declare neutralRefactor.byteIdentity { fixture: "benchmark.less", collapseNesting: true, outputSha256, outputBytes } for the benchmark oracle.`);
  }
  return errors;
}

function validatePrivateUnreachableMetadata(contract) {
  const errors = [];
  const privateGrammar = contract.privateGrammar;
  if (!privateGrammar || typeof privateGrammar !== 'object') {
    return [`Private-unreachable cost contract ${contract.id} must include a privateGrammar block.`];
  }
  if (privateGrammar.entry !== contract.files[0]) {
    errors.push(`Private-unreachable cost contract ${contract.id} privateGrammar.entry must equal its sole owned file.`);
  }
  if (typeof privateGrammar.why !== 'string' || privateGrammar.why.trim().length < 80) {
    errors.push(`Private-unreachable cost contract ${contract.id} must explain why construction is cold and unreachable from production entries.`);
  }
  if (privateGrammar.coldConstructionOnly !== true) {
    errors.push(`Private-unreachable cost contract ${contract.id} must state coldConstructionOnly: true.`);
  }
  const reachability = privateGrammar.entry === contract.files[0]
    ? privateGrammarReachability(privateGrammar.entry)
    : null;
  if (!reachability || reachability.productionImporters !== 0 || reachability.publicExports !== 0 || reachability.buildEntries !== 0) {
    errors.push(`Private-unreachable cost contract ${contract.id} has a production importer, package export, or build entry for ${privateGrammar.entry}.`);
  }
  return errors;
}

/**
 * Byte-identity + danger-token-free + cost-non-increasing gate for a neutral-or-
 * negative auto-pass audit record. None of the three can be honestly produced by a
 * cost-ADDING or output-CHANGING change:
 *   1. Danger-token-free: the live diff must introduce zero danger tokens (the caller
 *      passes hasDangerTokens from the same scan the rest of the gate runs). New
 *      allocation/loop/map/clone/error-control constructs ARE danger tokens, so a
 *      cost-add that reaches for them is refused here.
 *   2. Cost-non-increasing: costDelta must be "neutral" or "decrease"; an admitted
 *      "increase" is rejected and routes to a precise / conservative-filter contract.
 *   3. Byte-identity: the record restates the benchmark oracle sha/bytes it did not
 *      change; the landing's benchmark + all-less byte-identity gates re-verify it.
 * Returns false (recording why) on any gap so the caller refuses the acceptance.
 */
function checkNeutralRefactor(record, meta, hasDangerTokens, errors) {
  let ok = true;
  if (hasDangerTokens) {
    errors.push(`Neutral-or-negative record ${record.id} cannot auto-pass while the diff introduces danger tokens; account for them via a precise / conservative-filter / redundant-call-elimination contract.`);
    ok = false;
  }
  if (!['neutral', 'decrease'].includes(record.costDelta)) {
    errors.push(`Neutral-or-negative record ${record.id} must declare costDelta "neutral" or "decrease"; a cost increase cannot use the auto-pass.`);
    ok = false;
  }
  if (typeof record.why !== 'string' || record.why.trim().length < 40) {
    errors.push(`Neutral-or-negative record ${record.id} must restate the one-paragraph why the change is cost-neutral or cost-negative.`);
    ok = false;
  }
  const bi = record.byteIdentity;
  const metaBi = meta.byteIdentity;
  if (
    !bi
    || typeof bi !== 'object'
    || bi.fixture !== 'benchmark.less'
    || bi.collapseNesting !== true
    || typeof bi.outputSha256 !== 'string'
    || !/^[a-f0-9]{16,64}$/.test(bi.outputSha256)
    || /^0+$/.test(bi.outputSha256)
    || !Number.isInteger(bi.outputBytes)
    || bi.outputBytes <= 0
  ) {
    errors.push(`Neutral-or-negative record ${record.id} must restate the benchmark oracle byteIdentity { fixture, collapseNesting, outputSha256, outputBytes } proving output is unchanged.`);
    ok = false;
  } else if (metaBi && (bi.outputSha256 !== metaBi.outputSha256 || bi.outputBytes !== metaBi.outputBytes)) {
    errors.push(`Neutral-or-negative record ${record.id} byteIdentity must match the registered contract oracle (sha ${metaBi.outputSha256} / ${metaBi.outputBytes} bytes).`);
    ok = false;
  }
  return ok;
}

/**
 * Off-benchmark call-reduction registry metadata. This kind closes a real blind
 * spot: a correct, byte-identical work REMOVAL whose benefit is OFF the canonical
 * benchmark (benchmark.less does not exercise the eliminated path, so it shows no
 * wall-clock speedup). Instead of a benchmark.less speedup, such a change proves
 * its benefit as a MEASURED CALL-COUNT REDUCTION of a named hot function on a
 * NAMED representative fixture. Acceptance is deliberately hard and CANNOT be
 * honestly satisfied by a benchmark-regressing or output-changing change:
 *   - governedFunction: the hot function whose invocations are eliminated.
 *   - measuredOn:       the NAMED representative fixture the reduction is measured
 *                       on. It must NOT be benchmark.less (that is the wall-clock
 *                       oracle; this kind exists precisely because the benefit is
 *                       off it) — the reduction is proved by callsAfter<callsBefore
 *                       on this fixture (enforced by the declared relation + the
 *                       record check).
 *   - boundedTraversal: a self-prosecution paragraph asserting the ADDED traversal
 *                       is bounded (a walk over the import fallback-frame chain,
 *                       NOT a new whole-tree / per-node scan). Any new loop/map/set
 *                       is ALSO a danger token that the diff must account for by
 *                       label, so an unbounded traversal cannot hide here.
 *   - benchmarkNonRegression: the HARD SAFETY RAIL. benchmark.less must stay
 *                       byte-identical AND non-regressing (its measured median on
 *                       the named phase within a small noise cap, not slower). This
 *                       is what prevents admitting a change that is cost-neutral off
 *                       benchmark but a REGRESSION on benchmark: a benchmark
 *                       slowdown fails this rail.
 * The net-removal counter delta (callsAfter < callsBefore) is enforced via the
 * declared relations; the record-side proof lives in checkOffBenchmarkCallReduction.
 */
function validateOffBenchmarkCallReductionMetadata(contract) {
  const errors = [];
  const ob = contract.offBenchmarkCallReduction;
  if (!ob || typeof ob !== 'object') {
    return [`Off-benchmark call-reduction cost contract ${contract.id} must include an offBenchmarkCallReduction block.`];
  }
  if (typeof ob.governedFunction !== 'string' || ob.governedFunction.length === 0) {
    errors.push(`Off-benchmark call-reduction cost contract ${contract.id} must name the governedFunction whose calls are eliminated.`);
  }
  if (
    typeof ob.measuredOn !== 'string'
    || ob.measuredOn.length === 0
    || /(^|\/)benchmark\.less$/.test(ob.measuredOn)
  ) {
    errors.push(`Off-benchmark call-reduction cost contract ${contract.id} must name a representative measuredOn fixture that is NOT benchmark.less (the benefit is off the wall-clock oracle).`);
  }
  if (typeof ob.boundedTraversal !== 'string' || ob.boundedTraversal.trim().length < 40) {
    errors.push(`Off-benchmark call-reduction cost contract ${contract.id} must self-prosecute the added traversal as bounded (offBenchmarkCallReduction.boundedTraversal paragraph).`);
  }
  const nr = ob.benchmarkNonRegression;
  if (
    !nr
    || typeof nr !== 'object'
    || !['parse-render', 'render'].includes(nr.phase)
    || !Number.isFinite(nr.maxPercentSlower)
    || nr.maxPercentSlower < 0
    || nr.maxPercentSlower > 5
  ) {
    errors.push(`Off-benchmark call-reduction cost contract ${contract.id} must declare a benchmarkNonRegression { phase, maxPercentSlower } rail with a tight noise cap (0..5%).`);
  }
  return errors;
}

/**
 * A semantic preflight is not an optimization claim. It permits a necessary
 * source-order/planning scan whose cost cannot honestly be expressed as the
 * bounded (<= 32 items) admission probe used by `precise`. The contract instead
 * proves two concrete facts: the preflight does no planner/IR work on an
 * exercised false path, and it does the named minimum work on a representative
 * feature path. It records the current canonical benchmark as a baseline only;
 * semantic additions must not invent byte-identity A/B or speedup claims.
 */
function validateSemanticPreflightMetadata(contract) {
  const errors = [];
  const preflight = contract.semanticPreflight;
  if (!preflight || typeof preflight !== 'object') {
    return [`Semantic-preflight cost contract ${contract.id} must include a semanticPreflight block.`];
  }
  if (typeof preflight.trigger !== 'string' || preflight.trigger.trim().length < 12) {
    errors.push(`Semantic-preflight cost contract ${contract.id} must name its trigger.`);
  }
  if (typeof preflight.scope !== 'string' || preflight.scope.trim().length < 40) {
    errors.push(`Semantic-preflight cost contract ${contract.id} must explain the bounded semantic scope of its traversal.`);
  }
  const falsePath = preflight.falsePath;
  if (
    !falsePath
    || typeof falsePath !== 'object'
    || typeof falsePath.fixture !== 'string'
    || falsePath.fixture.length === 0
    || !Array.isArray(falsePath.requiredZeroCounters)
    || falsePath.requiredZeroCounters.length === 0
    || falsePath.requiredZeroCounters.some(counter => typeof counter !== 'string' || counter.length === 0)
  ) {
    errors.push(`Semantic-preflight cost contract ${contract.id} must name a false-path fixture and requiredZeroCounters.`);
  }
  const featurePath = preflight.featurePath;
  if (
    !featurePath
    || typeof featurePath !== 'object'
    || typeof featurePath.fixture !== 'string'
    || featurePath.fixture.length === 0
    || !featurePath.minimumCounters
    || typeof featurePath.minimumCounters !== 'object'
    || Object.keys(featurePath.minimumCounters).length === 0
    || Object.entries(featurePath.minimumCounters).some(([counter, minimum]) =>
      counter.length === 0 || !Number.isInteger(minimum) || minimum <= 0
    )
  ) {
    errors.push(`Semantic-preflight cost contract ${contract.id} must name a feature-path fixture and positive minimumCounters.`);
  }
  const baseline = preflight.baseline;
  if (
    !baseline
    || typeof baseline !== 'object'
    || baseline.fixture !== 'benchmark.less'
    || !['parse-render', 'render'].includes(baseline.phase)
  ) {
    errors.push(`Semantic-preflight cost contract ${contract.id} must name the current benchmark.less parse-render or render baseline.`);
  }
  const command = contract.evidence?.command;
  if (!Array.isArray(command) || command.length === 0 || command.some(part => typeof part !== 'string' || part.length === 0)) {
    errors.push(`Semantic-preflight cost contract ${contract.id} must name executable false/feature-path evidence.`);
  }
  return errors;
}

function checkSemanticPreflight(record, meta, errors) {
  let ok = true;
  if (record.performanceClaim !== 'none') {
    errors.push(`Semantic-preflight record ${record.id} must declare performanceClaim: "none"; it records a baseline, not a speed or neutrality claim.`);
    ok = false;
  }
  if (typeof record.why !== 'string' || record.why.trim().length < 80) {
    errors.push(`Semantic-preflight record ${record.id} must explain why the semantic traversal is necessary and cannot be carried forward.`);
    ok = false;
  }
  if (typeof record.dangerTokensJustification !== 'string' || record.dangerTokensJustification.trim().length < 80) {
    errors.push(`Semantic-preflight record ${record.id} must account for traversal/allocation danger tokens without claiming neutrality.`);
    ok = false;
  }
  const falsePath = record.falsePath;
  if (
    !falsePath
    || typeof falsePath !== 'object'
    || falsePath.fixture !== meta.falsePath?.fixture
    || !falsePath.counters
    || typeof falsePath.counters !== 'object'
    || !Number.isInteger(falsePath.counters.calls)
    || falsePath.counters.calls <= 0
  ) {
    errors.push(`Semantic-preflight record ${record.id} must exercise its false-path fixture with counters.calls > 0.`);
    ok = false;
  } else {
    for (const counter of meta.falsePath.requiredZeroCounters) {
      if (falsePath.counters[counter] !== 0) {
        errors.push(`Semantic-preflight record ${record.id} false path must keep ${counter} === 0.`);
        ok = false;
      }
    }
  }
  const featurePath = record.featurePath;
  if (
    !featurePath
    || typeof featurePath !== 'object'
    || featurePath.fixture !== meta.featurePath?.fixture
    || !featurePath.counters
    || typeof featurePath.counters !== 'object'
  ) {
    errors.push(`Semantic-preflight record ${record.id} must exercise its named feature-path fixture.`);
    ok = false;
  } else {
    for (const [counter, minimum] of Object.entries(meta.featurePath.minimumCounters)) {
      if (!Number.isInteger(featurePath.counters[counter]) || featurePath.counters[counter] < minimum) {
        errors.push(`Semantic-preflight record ${record.id} feature path must record ${counter} >= ${minimum}.`);
        ok = false;
      }
    }
  }
  const baseline = record.baseline;
  if (
    !baseline
    || typeof baseline !== 'object'
    || baseline.fixture !== meta.baseline?.fixture
    || baseline.phase !== meta.baseline?.phase
    || !Number.isFinite(baseline.currentMedianMs)
    || baseline.currentMedianMs <= 0
    || typeof baseline.outputSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(baseline.outputSha256)
    || !Number.isInteger(baseline.outputBytes)
    || baseline.outputBytes <= 0
  ) {
    errors.push(`Semantic-preflight record ${record.id} must record the current benchmark baseline { fixture, phase, currentMedianMs, outputSha256, outputBytes } without a before/after claim.`);
    ok = false;
  }
  return ok;
}

/** Metadata for a call/result policy boundary: no traversal or admission is implied. */
function validateSemanticBoundaryMetadata(contract) {
  const errors = [];
  const boundary = contract.semanticBoundary;
  if (!boundary || typeof boundary !== 'object') {
    return [`Semantic-boundary cost contract ${contract.id} must include a semanticBoundary block.`];
  }
  if (typeof boundary.trigger !== 'string' || boundary.trigger.trim().length < 12) {
    errors.push(`Semantic-boundary cost contract ${contract.id} must name its dispatch/result trigger.`);
  }
  if (typeof boundary.scope !== 'string' || boundary.scope.trim().length < 80) {
    errors.push(`Semantic-boundary cost contract ${contract.id} must explain its exact policy boundary and excluded resolver paths.`);
  }
  if (!Array.isArray(boundary.cases) || boundary.cases.length < 3 || boundary.cases.some(value => typeof value !== 'string' || value.length < 8)) {
    errors.push(`Semantic-boundary cost contract ${contract.id} must name at least three separately tested call-result cases.`);
  }
  const baseline = boundary.baseline;
  if (!baseline || baseline.fixture !== 'benchmark.less' || !['parse-render', 'render'].includes(baseline.phase)) {
    errors.push(`Semantic-boundary cost contract ${contract.id} must name a current benchmark.less parse-render or render baseline.`);
  }
  const command = contract.evidence?.command;
  if (!Array.isArray(command) || command.length === 0 || command.some(part => typeof part !== 'string' || part.length === 0)) {
    errors.push(`Semantic-boundary cost contract ${contract.id} must name focused executable behavior evidence.`);
  }
  return errors;
}

function checkSemanticBoundary(record, meta, errors) {
  let ok = true;
  if (record.performanceClaim !== 'none') {
    errors.push(`Semantic-boundary record ${record.id} must declare performanceClaim: "none"; its benchmark is an output baseline, not a speed claim.`);
    ok = false;
  }
  if (typeof record.why !== 'string' || record.why.trim().length < 80) {
    errors.push(`Semantic-boundary record ${record.id} must explain the resolver/call policy split.`);
    ok = false;
  }
  if (typeof record.dangerTokensJustification !== 'string' || record.dangerTokensJustification.trim().length < 80) {
    errors.push(`Semantic-boundary record ${record.id} must account for call-path allocation and async recovery without claiming neutrality.`);
    ok = false;
  }
  if (!Array.isArray(record.cases) || record.cases.length !== meta.cases.length || record.cases.some((value, index) => value !== meta.cases[index])) {
    errors.push(`Semantic-boundary record ${record.id} must restate the exact tested call-result cases.`);
    ok = false;
  }
  const baseline = record.baseline;
  if (
    !baseline || baseline.fixture !== meta.baseline?.fixture || baseline.phase !== meta.baseline?.phase
    || !Number.isFinite(baseline.currentMedianMs) || baseline.currentMedianMs <= 0
    || typeof baseline.outputSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(baseline.outputSha256)
    || !Number.isInteger(baseline.outputBytes) || baseline.outputBytes <= 0
  ) {
    errors.push(`Semantic-boundary record ${record.id} must record { fixture, phase, currentMedianMs, outputSha256, outputBytes } without a before/after claim.`);
    ok = false;
  }
  return ok;
}

/**
 * A semantic-runtime record covers a real evaluator/value cutover whose output
 * and allocation shape cannot truthfully be reduced to an admission counter or
 * byte-identical A/B.  It is deliberately stronger than a prose exception:
 * the owner, semantic cases, focused behavior/build commands, and a current
 * benchmark/output baseline are all machine-checked.  It never asserts speed,
 * neutrality, or a cost decrease.
 */
function validateSemanticRuntimeMetadata(contract) {
  const errors = [];
  const runtime = contract.semanticRuntime;
  if (!runtime || typeof runtime !== 'object') {
    return [`Semantic-runtime contract ${contract.id} must include a semanticRuntime block.`];
  }
  if (typeof runtime.owner !== 'string' || runtime.owner.trim().length < 12) {
    errors.push(`Semantic-runtime contract ${contract.id} must name its exact owner surface.`);
  }
  if (typeof runtime.scope !== 'string' || runtime.scope.trim().length < 80) {
    errors.push(`Semantic-runtime contract ${contract.id} must explain the semantic scope and why it is not an optimization contract.`);
  }
  if (!Array.isArray(runtime.cases) || runtime.cases.length < 2 || runtime.cases.some(value => typeof value !== 'string' || value.trim().length < 8)) {
    errors.push(`Semantic-runtime contract ${contract.id} must name at least two focused semantic cases.`);
  }
  if (runtime.performanceClaim !== 'none') {
    errors.push(`Semantic-runtime contract ${contract.id} must declare performanceClaim: "none".`);
  }
  const baseline = runtime.baseline;
  if (!baseline || baseline.fixture !== 'benchmark.less' || !['parse-render', 'render'].includes(baseline.phase)) {
    errors.push(`Semantic-runtime contract ${contract.id} must name a current benchmark.less parse-render or render baseline.`);
  }
  const evidence = contract.evidence;
  const validCommand = command => Array.isArray(command)
    && command.length >= 2
    && ['node', 'pnpm'].includes(command[0])
    && command.every(argument => !['-c', '-e', '--eval', '--shell'].includes(argument));
  if (!evidence || typeof evidence !== 'object' || !validCommand(evidence.behaviorCommand) || !validCommand(evidence.buildCommand)) {
    errors.push(`Semantic-runtime contract ${contract.id} must name focused behaviorCommand and buildCommand arrays without shell/eval indirection.`);
  }
  return errors;
}

function checkSemanticRuntime(record, meta, errors) {
  let ok = true;
  if (record.verdict !== 'accepted') {
    errors.push(`Semantic-runtime record ${record.id} must be accepted only after its semantic cases and build pass.`);
    ok = false;
  }
  if (record.performanceClaim !== 'none') {
    errors.push(`Semantic-runtime record ${record.id} must declare performanceClaim: "none"; its benchmark is a current baseline, not a speed or neutrality claim.`);
    ok = false;
  }
  if (record.owner !== meta.owner) {
    errors.push(`Semantic-runtime record ${record.id} must restate owner ${meta.owner}.`);
    ok = false;
  }
  if (!Array.isArray(record.cases) || record.cases.length !== meta.cases.length || record.cases.some((value, index) => value !== meta.cases[index])) {
    errors.push(`Semantic-runtime record ${record.id} must restate the exact tested semantic cases.`);
    ok = false;
  }
  if (typeof record.why !== 'string' || record.why.trim().length < 80) {
    errors.push(`Semantic-runtime record ${record.id} must explain why the changed owner is semantic work rather than a neutral/cost-cutting claim.`);
    ok = false;
  }
  if (typeof record.dangerTokensJustification !== 'string' || record.dangerTokensJustification.trim().length < 80) {
    errors.push(`Semantic-runtime record ${record.id} must account for its danger-token allocation/traversal shape without claiming neutrality.`);
    ok = false;
  }
  if (typeof record.behaviorEvidence !== 'string' || record.behaviorEvidence.trim().length < 24) {
    errors.push(`Semantic-runtime record ${record.id} must record focused behavior evidence.`);
    ok = false;
  }
  if (typeof record.buildEvidence !== 'string' || record.buildEvidence.trim().length < 24) {
    errors.push(`Semantic-runtime record ${record.id} must record build evidence.`);
    ok = false;
  }
  const baseline = record.baseline;
  const metaBaseline = meta.baseline;
  if (
    !baseline
    || baseline.fixture !== metaBaseline?.fixture
    || baseline.phase !== metaBaseline?.phase
    || !Number.isFinite(baseline.currentMedianMs)
    || baseline.currentMedianMs <= 0
    || typeof baseline.outputSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(baseline.outputSha256)
    || !Number.isInteger(baseline.outputBytes)
    || baseline.outputBytes <= 0
  ) {
    errors.push(`Semantic-runtime record ${record.id} must record { fixture, phase, currentMedianMs, outputSha256, outputBytes } as a current baseline only.`);
    ok = false;
  }
  return ok;
}

/**
 * Byte-identity + benchmark-non-regression + net-removal gate for an off-benchmark
 * call-reduction audit record. All are non-negotiable, and none can be honestly
 * produced by a benchmark-regressing or output-changing change:
 *   1. Byte-identity: both benchmark phases render the same output (equal
 *      outputSha256), on top of the per-phase byteIdentical A/B the generic
 *      validator already enforces.
 *   2. Benchmark non-regression (the hard rail): the named benchmark phase's after
 *      median must be within the declared noise cap of the before median (not
 *      slower). A change that regresses benchmark fails here.
 *   3. Net removal on the named fixture: measuredOn matches the contract (and is not
 *      benchmark.less), and callsAfter < callsBefore for the eliminated function on
 *      that fixture (a change that does not actually reduce calls fails).
 *   4. Bounded traversal: the record restates the bounded-walk self-prosecution.
 * Returns false (recording why) on any gap so the caller refuses the acceptance.
 */
function checkOffBenchmarkCallReduction(record, meta, errors) {
  let ok = true;
  if (typeof record.measuredOn !== 'string' || record.measuredOn !== meta.measuredOn) {
    errors.push(`Off-benchmark call-reduction record ${record.id} must restate measuredOn matching the contract fixture (${meta.measuredOn}).`);
    ok = false;
  } else if (/(^|\/)benchmark\.less$/.test(record.measuredOn)) {
    errors.push(`Off-benchmark call-reduction record ${record.id} measuredOn must not be benchmark.less.`);
    ok = false;
  }
  const callsBefore = counterValue(record, 'callsBefore');
  const callsAfter = counterValue(record, 'callsAfter');
  if (callsBefore === null || callsAfter === null) {
    errors.push(`Off-benchmark call-reduction record ${record.id} must record integer callsBefore and callsAfter for the eliminated function on the named fixture.`);
    ok = false;
  } else if (!(callsAfter < callsBefore)) {
    errors.push(`Off-benchmark call-reduction record ${record.id} is not a reduction: callsAfter ${callsAfter} must be < callsBefore ${callsBefore} on ${meta.measuredOn}.`);
    ok = false;
  }
  const parseRenderSha = record.benchmark?.['parse-render']?.outputSha256;
  const renderSha = record.benchmark?.render?.outputSha256;
  if (typeof parseRenderSha !== 'string' || parseRenderSha !== renderSha) {
    errors.push(`Off-benchmark call-reduction record ${record.id} must render byte-identical benchmark output across both phases (equal outputSha256).`);
    ok = false;
  }
  const phase = meta.benchmarkNonRegression?.phase;
  const cap = Number.isFinite(meta.benchmarkNonRegression?.maxPercentSlower)
    ? meta.benchmarkNonRegression.maxPercentSlower
    : 0;
  const phaseResult = phase ? record.benchmark?.[phase] : undefined;
  if (
    !phaseResult
    || typeof phaseResult !== 'object'
    || !Number.isFinite(phaseResult.beforeMedianMs)
    || phaseResult.beforeMedianMs <= 0
    || !Number.isFinite(phaseResult.afterMedianMs)
    || phaseResult.afterMedianMs <= 0
  ) {
    errors.push(`Off-benchmark call-reduction record ${record.id} must record a ${phase} benchmark { beforeMedianMs, afterMedianMs } for the non-regression rail.`);
    ok = false;
  } else {
    const allowed = phaseResult.beforeMedianMs * (1 + cap / 100);
    if (phaseResult.afterMedianMs > allowed) {
      errors.push(`Off-benchmark call-reduction record ${record.id} REGRESSES benchmark ${phase}: after ${phaseResult.afterMedianMs}ms exceeds before ${phaseResult.beforeMedianMs}ms + ${cap}% (<= ${allowed.toFixed(3)}ms). The benchmark-non-regression rail forbids admitting an off-benchmark change that is slower on benchmark.`);
      ok = false;
    }
  }
  if (typeof record.boundedTraversal !== 'string' || record.boundedTraversal.trim().length < 40) {
    errors.push(`Off-benchmark call-reduction record ${record.id} must restate the bounded-traversal self-prosecution (fallback-frame-chain walk, not a whole-tree/per-node scan).`);
    ok = false;
  }
  return ok;
}

function validateCostContractRegistry(registry) {
  const errors = [];
  const ids = new Set();
  for (const contract of registry) {
    if (!contract || typeof contract !== 'object') {
      errors.push('Every cost contract must be an object.');
      continue;
    }
    const contractKind = contract.kind ?? 'precise';
    if (typeof contract.id !== 'string' || contract.id.length === 0 || ids.has(contract.id)) {
      errors.push(`Cost contracts must have unique non-empty ids: ${String(contract.id)}.`);
    }
    ids.add(contract.id);
    if (typeof contract.surface !== 'string' || contract.surface.length === 0) {
      errors.push(`Cost contract ${contract.id} is missing its named surface.`);
    }
    if (!Array.isArray(contract.files) || contract.files.length === 0) {
      errors.push(`Cost contract ${contract.id} must name at least one owning file.`);
    } else if (contractKind !== 'semantic-runtime' && contract.files.length !== 1) {
      errors.push(`Cost contract ${contract.id} must cover exactly one owning file so its source check cannot be bypassed by adding another file.`);
    } else if (contractKind === 'semantic-runtime' && new Set(contract.files).size !== contract.files.length) {
      errors.push(`Semantic-runtime contract ${contract.id} must list each owning file once.`);
    }
    if (contract.supportFiles !== undefined) {
      if (!Array.isArray(contract.supportFiles) || contract.supportFiles.some(file => typeof file !== 'string' || file.length === 0)) {
        errors.push(`Cost contract ${contract.id} supportFiles must be an array of non-empty paths.`);
      }
      if (contract.coverage !== 'owner-plus-named-carry-forward-support') {
        errors.push(`Cost contract ${contract.id} supportFiles require coverage owner-plus-named-carry-forward-support.`);
      }
    }
    // The neutral-or-negative auto-pass skips the admission-counter / benchmark-A/B /
    // executable-evidence / source-guard ceremony entirely: it proves cost-neutrality
    // through the danger-token scan + a byte-identity + costDelta attestation instead
    // (see validateNeutralRefactorMetadata). It carries no necessity/admission block.
    if ((contract.kind ?? 'precise') === 'neutral-or-negative') {
      errors.push(...validateNeutralRefactorMetadata(contract));
      continue;
    }
    if (contract.kind === 'private-unreachable') {
      errors.push(...validatePrivateUnreachableMetadata(contract));
      continue;
    }
    if (contract.kind === 'semantic-preflight') {
      errors.push(...validateNecessityMetadata(contract.necessity, `Cost contract ${contract.id}`));
      errors.push(...validateSemanticPreflightMetadata(contract));
      const sourceCheck = contract.sourceCheck;
      if (!sourceCheck || typeof sourceCheck !== 'object' || sourceCheck.file !== contract.files[0]
        || typeof sourceCheck.caller !== 'string' || typeof sourceCheck.call !== 'string' || typeof sourceCheck.guard !== 'string') {
        errors.push(`Semantic-preflight cost contract ${contract.id} must include a complete owner sourceCheck.`);
      }
      continue;
    }
    if (contract.kind === 'semantic-boundary') {
      errors.push(...validateSemanticBoundaryMetadata(contract));
      const sourceCheck = contract.sourceCheck;
      if (!sourceCheck || typeof sourceCheck !== 'object' || sourceCheck.file !== contract.files[0]
        || typeof sourceCheck.caller !== 'string' || typeof sourceCheck.call !== 'string' || typeof sourceCheck.guard !== 'string') {
        errors.push(`Semantic-boundary cost contract ${contract.id} must include a complete owner sourceCheck.`);
      }
      continue;
    }
    if (contract.kind === 'semantic-runtime') {
      errors.push(...validateSemanticRuntimeMetadata(contract));
      continue;
    }
    errors.push(...validateNecessityMetadata(contract.necessity, `Cost contract ${contract.id}`));
    // A redundant-call-elimination contract models a pure work-REMOVAL, not a
    // per-container admission FILTER, so it carries no admission block and no
    // admission/feature counters. It instead proves byte-identity + a measured
    // speedup + a net-removal counter delta + a redundancy argument (see
    // validateRedundantCallEliminationMetadata). Every OTHER kind keeps the full,
    // unchanged admission requirement below.
    const kind = contract.kind ?? 'precise';
    if (kind === 'redundant-call-elimination') {
      errors.push(...validateRedundantCallEliminationMetadata(contract));
    } else if (kind === 'off-benchmark-call-reduction') {
      // An off-benchmark call-reduction models a byte-identical work REMOVAL whose
      // benefit is off benchmark.less, so it carries no admission block and no
      // admission/feature counters. It proves byte-identity + benchmark
      // non-regression + a net call-count reduction on a NAMED fixture (see
      // validateOffBenchmarkCallReductionMetadata). The heavy admission ceremony
      // below is skipped exactly as it is for redundant-call-elimination.
      errors.push(...validateOffBenchmarkCallReductionMetadata(contract));
    } else {
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
        if (typeof admission.counter !== 'string' || !contract.counters?.includes(admission.counter)) {
          errors.push(`Cost contract ${contract.id} must name a declared admission counter.`);
        }
        if (typeof admission.workCounter !== 'string' || !contract.counters?.includes(admission.workCounter)) {
          errors.push(`Cost contract ${contract.id} must name a declared admission-work counter.`);
        }
        if (
          !Number.isInteger(admission.maxItemsPerContainer)
          || admission.maxItemsPerContainer <= 0
          || admission.maxItemsPerContainer > 32
        ) {
          errors.push(`Cost contract ${contract.id} must cap cheap admission work at 1..32 items per inspected container.`);
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
          `Cost contract ${contract.id} must list calls, admissionCalls, admissionItemsVisited, itemsVisited, noFeatureAllocations, and noFeatureMisses.`
        );
      }
    }
    if (kind === 'redundant-call-elimination') {
      const removalCounters = ['callsBefore', 'callsAfter', 'noFeatureAllocations'];
      if (!Array.isArray(contract.counters) || !removalCounters.every(name => contract.counters.includes(name))) {
        errors.push(
          `Redundant-call-elimination cost contract ${contract.id} must declare callsBefore, callsAfter, and noFeatureAllocations counters.`
        );
      }
    }
    if (kind === 'off-benchmark-call-reduction') {
      const reductionCounters = ['callsBefore', 'callsAfter'];
      if (!Array.isArray(contract.counters) || !reductionCounters.every(name => contract.counters.includes(name))) {
        errors.push(
          `Off-benchmark call-reduction cost contract ${contract.id} must declare callsBefore and callsAfter counters (measured on the named fixture).`
        );
      }
    }
    if (typeof contract.commonCaseProof !== 'string' || !/(benchmark|counter|test)/i.test(contract.commonCaseProof)) {
      errors.push(`Cost contract ${contract.id} must name a common no-feature benchmark or counter test.`);
    }
    const benchmark = contract.benchmark;
    if (
      !benchmark
      || typeof benchmark !== 'object'
      || benchmark.fixture !== 'benchmark.less'
      || !Array.isArray(benchmark.phases)
      || !benchmark.phases.includes('parse-render')
      || !benchmark.phases.includes('render')
      || benchmark.warmup !== 20
      || benchmark.pairs !== 45
    ) {
      errors.push(
        `Cost contract ${contract.id} must require the canonical benchmark.less parse-render/render A/B with 20 warmups and 45 alternating pairs.`
      );
    }
    if (!['precise', 'conservative-filter', 'redundant-call-elimination', 'neutral-or-negative', 'private-unreachable', 'off-benchmark-call-reduction', 'semantic-preflight', 'semantic-boundary', 'semantic-runtime'].includes(kind)) {
      errors.push(`Cost contract ${contract.id} kind must be "precise", "conservative-filter", "redundant-call-elimination", "neutral-or-negative", "private-unreachable", "off-benchmark-call-reduction", "semantic-preflight", "semantic-boundary", or "semantic-runtime".`);
    }
    if (!Array.isArray(contract.relations) || contract.relations.length === 0) {
      errors.push(`Cost contract ${contract.id} must state at least one counter relation.`);
    } else if (kind === 'redundant-call-elimination') {
      // A removal proves NET REMOVAL, not an admission bound: the eliminated
      // function must run no more often after the change than before. It must NOT
      // borrow the admission-filter relations (there is no admittedCalls surface).
      errors.push(...validateDeclaredCounterRelations(contract));
      if (!contract.relations.includes('callsAfter <= callsBefore')) {
        errors.push(`Redundant-call-elimination cost contract ${contract.id} must bind the eliminated work with callsAfter <= callsBefore.`);
      }
      if (contract.relations.includes('calls <= admittedCalls')) {
        errors.push(`Redundant-call-elimination cost contract ${contract.id} must not claim the admission-filter relation calls <= admittedCalls; it removes work, it does not admit it.`);
      }
    } else if (kind === 'off-benchmark-call-reduction') {
      // An off-benchmark reduction proves a STRICT net reduction of the eliminated
      // work on the named fixture (callsAfter < callsBefore). It must NOT borrow the
      // admission-filter relation (there is no admittedCalls surface) — the benefit
      // is a call-count delta, not an admission bound.
      errors.push(...validateDeclaredCounterRelations(contract));
      if (!contract.relations.includes('callsAfter < callsBefore')) {
        errors.push(`Off-benchmark call-reduction cost contract ${contract.id} must bind the eliminated work with callsAfter < callsBefore.`);
      }
      if (contract.relations.includes('calls <= admittedCalls')) {
        errors.push(`Off-benchmark call-reduction cost contract ${contract.id} must not claim the admission-filter relation calls <= admittedCalls; it removes work, it does not admit it.`);
      }
    } else {
      errors.push(...validateDeclaredCounterRelations(contract));
      if (!contract.relations.includes('calls <= admittedCalls')) {
        errors.push(`Cost contract ${contract.id} must bind expensive calls to admitted calls with calls <= admittedCalls.`);
      }
      // Precise admission proves an EXACT feature bit: admittedCalls <= featureBearing*
      // (combined with the audit-record featureBearing <= calls <= admittedCalls this
      // forces equality). A conservative-filter instead admits a SUPERSET of the true
      // matches, so it must state the FLIPPED bound featureBearing* <= admittedCalls and
      // must NOT claim the precise equality bound.
      const preciseBound = contract.relations.some((relation) => {
        const parsed = parseCounterRelation(relation);
        return parsed?.left === 'admittedCalls'
          && parsed.operator === '<='
          && /^featureBearing/i.test(parsed.right);
      });
      const supersetBound = contract.relations.some((relation) => {
        const parsed = parseCounterRelation(relation);
        return parsed?.operator === '<='
          && parsed.right === 'admittedCalls'
          && /^featureBearing/i.test(parsed.left);
      });
      if (kind === 'conservative-filter') {
        if (!supersetBound) {
          errors.push(`Conservative-filter cost contract ${contract.id} must admit a superset: bind featureBearing* <= admittedCalls.`);
        }
        if (preciseBound) {
          errors.push(`Conservative-filter cost contract ${contract.id} must not also claim the precise admittedCalls <= featureBearing* bound; a filter admits a superset, not an exact bit.`);
        }
        errors.push(...validateConservativeFilterMetadata(contract));
      } else if (!preciseBound) {
        errors.push(`Cost contract ${contract.id} must bind admitted calls to a feature-bearing counter.`);
      }
    }
    const evidence = contract.evidence;
    if (
      !evidence
      || typeof evidence !== 'object'
      || !Array.isArray(evidence.command)
      || evidence.command.length < 2
      || !['node', 'pnpm'].includes(evidence.command[0])
      || evidence.command.some(argument => ['-c', '-e', '--eval', '--shell'].includes(argument))
    ) {
      errors.push(`Cost contract ${contract.id} must name a focused executable test command without shell/eval indirection.`);
    }
    const sourceCheck = contract.sourceCheck;
    if (!sourceCheck || typeof sourceCheck !== 'object') {
      errors.push(`Cost contract ${contract.id} must include executable source-check metadata.`);
    } else if (
      typeof sourceCheck.file !== 'string'
      || typeof sourceCheck.caller !== 'string'
      || typeof sourceCheck.call !== 'string'
      || typeof sourceCheck.guard !== 'string'
      || (
        sourceCheck.profile !== undefined
        && typeof sourceCheck.profile !== 'string'
        && !Array.isArray(sourceCheck.profile)
      )
    ) {
      errors.push(`Cost contract ${contract.id} source-check metadata is incomplete.`);
    } else if (!Array.isArray(contract.files) || contract.files[0] !== sourceCheck.file) {
      errors.push(`Cost contract ${contract.id} source-check file must be its sole owning file.`);
    }
  }

  return errors;
}

function validateCostContractOwnership(registry) {
  const errors = [];
  const surfaces = new Map();
  const semanticRuntimeOwners = new Map();
  for (const contract of registry) {
    if (contract.kind === 'semantic-runtime') {
      for (const file of contract.files ?? []) {
        const priorOwner = semanticRuntimeOwners.get(file);
        if (priorOwner) {
          errors.push(`Semantic-runtime owner ${file} is listed by both ${priorOwner} and ${contract.id}; each semantic runtime file must have exactly one owner.`);
        } else {
          semanticRuntimeOwners.set(file, contract.id);
        }
      }
    }
    for (const file of [...(contract.files ?? []), ...(contract.supportFiles ?? [])]) {
      if (!hotPathRoots.some(rootPath => file.startsWith(rootPath))) {
        errors.push(`Cost contract ${contract.id} owns file outside the reviewed production roots: ${file}.`);
      }
      const sourceCheck = contract.sourceCheck;
      const surfaceKey = sourceCheck
        ? [file, sourceCheck.caller, sourceCheck.call].join('\u0000')
        : `${file}\u0000${contract.id}`;
      const priorOwner = surfaces.get(surfaceKey);
      if (priorOwner) {
        errors.push(`Production hot-path surface ${file} / ${sourceCheck?.caller ?? contract.id} / ${sourceCheck?.call ?? 'missing source check'} is owned by both ${priorOwner} and ${contract.id}.`);
      } else {
        surfaces.set(surfaceKey, contract.id);
      }
    }
  }
  return errors;
}

function validateRegisteredSourceMetadata(registry) {
  const errors = [];
  for (const contract of registry) {
    const sourceCheck = contract.sourceCheck;
    if (!sourceCheck) {
      continue;
    }
    let source;
    try {
      source = readFileSync(resolve(root, sourceCheck.file), 'utf8');
    } catch (error) {
      errors.push(`Cost contract ${contract.id} source-check file cannot be read: ${sourceCheck.file}.`);
      continue;
    }
    for (const field of ['caller', 'call', 'guard', 'profile'].filter(name => sourceCheck[name] !== undefined)) {
      const anchors = Array.isArray(sourceCheck[field]) ? sourceCheck[field] : [sourceCheck[field]];
      for (const anchor of anchors) {
        if (!source.includes(anchor)) {
          errors.push(`Cost contract ${contract.id} source-check ${field} is absent from ${sourceCheck.file}: ${anchor}.`);
        }
      }
    }
  }
  return errors;
}

function extractCostAuditRecords(latestPass, registry = []) {
  const match = latestPass.match(/- Hot-path cost contracts:\s*```json\s*([\s\S]*?)\s*```/);
  if (match) {
    try {
      const records = JSON.parse(match[1]);
      return Array.isArray(records) ? records : null;
    } catch {
      return null;
    }
  }
  const ledger = latestPass.match(/- Hot-path cost contracts:\s*ledger IDs:\s*([^\n]+)/);
  if (!ledger) {
    return null;
  }
  const ids = [...ledger[1].split(';', 1)[0].matchAll(/`([^`]+)`/g)].map(([, id]) => id);
  if (ids.length === 0) {
    return null;
  }
  return ids.map((id) => {
    const contract = registry.find(candidate => candidate.id === id);
    if (contract?.kind !== 'neutral-or-negative' || !contract.neutralRefactor) {
      return { id };
    }
    return {
      id,
      verdict: 'accepted',
      costDelta: contract.neutralRefactor.costDelta,
      why: contract.neutralRefactor.why,
      byteIdentity: contract.neutralRefactor.byteIdentity
    };
  });
}

function numberCounter(record, names) {
  for (const name of names) {
    if (Number.isInteger(record[name]) && record[name] >= 0) {
      return record[name];
    }
  }
  return null;
}

function changedHunks(diff) {
  const hunks = [];
  let file = null;
  let lines = null;
  const finish = () => {
    if (file && lines) {
      hunks.push({ file, text: lines.join('\n') });
    }
  };
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      finish();
      file = line.slice('+++ b/'.length);
      lines = null;
      continue;
    }
    if (line.startsWith('@@')) {
      finish();
      lines = [line];
      continue;
    }
    if (lines) {
      lines.push(line);
    }
  }
  finish();
  return hunks;
}

function contractsForChangedHunk(registry, file, hunk) {
  return registry.filter((contract) => {
    if (!contract.files.includes(file) || !contract.sourceCheck) {
      return false;
    }
    const { caller, call, guard, profile } = contract.sourceCheck;
    const profileAnchors = Array.isArray(profile) ? profile : [profile];
    return [caller, call, guard, ...profileAnchors].filter(Boolean).some(anchor => hunk.includes(anchor));
  });
}

function contractsForChangedSurface(registry, path, diff) {
  const matches = new Set();
  for (const hunk of changedHunks(diff).filter(candidate => candidate.file === path)) {
    for (const contract of contractsForChangedHunk(registry, path, hunk.text)) {
      matches.add(contract);
    }
  }
  return [...matches];
}

function validateCostAuditRecords(records, registry, changedPaths, diff, hasDangerTokens = false) {
  const errors = [];
  if (!records) {
    return ['Latest self-prosecution block is missing a valid Hot-path cost contracts JSON record or ledger-ID pointer.'];
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
    const contract = registry.find(candidate => candidate.id === record.id);
    const kind = contract?.kind ?? 'precise';
    // The neutral-or-negative auto-pass record carries no necessity/admission/benchmark
    // ceremony: it proves cost-neutrality with the danger-token scan + a byte-identity +
    // costDelta attestation (checkNeutralRefactor). Validate that and skip the rest.
    if (kind === 'neutral-or-negative') {
      if (record.verdict !== undefined && !['accepted', 'rejected', 'deferred'].includes(record.verdict)) {
        errors.push(`Hot-path cost audit record ${record.id} must use verdict accepted, rejected, or deferred.`);
      }
      if (record.verdict === 'accepted' && contract?.neutralRefactor) {
        checkNeutralRefactor(record, contract.neutralRefactor, hasDangerTokens, errors);
      }
      continue;
    }
    if (kind === 'private-unreachable') {
      if (record.verdict !== 'accepted') {
        errors.push(`Private-unreachable record ${record.id} must be accepted only after current reachability is checked.`);
      }
      const current = contract?.privateGrammar ? privateGrammarReachability(contract.privateGrammar.entry) : null;
      const claimed = record.privateReachability;
      if (!claimed || claimed.productionImporters !== current?.productionImporters || claimed.publicExports !== current?.publicExports || claimed.buildEntries !== current?.buildEntries || claimed.coldConstructionOnly !== true) {
        errors.push(`Private-unreachable record ${record.id} must restate current { productionImporters: 0, publicExports: 0, buildEntries: 0, coldConstructionOnly: true } evidence.`);
      }
      if (typeof record.why !== 'string' || record.why.trim().length < 80) {
        errors.push(`Private-unreachable record ${record.id} must explain why no production parse/render route invokes the private grammar.`);
      }
      continue;
    }
    if (kind === 'semantic-preflight') {
      if (record.verdict !== 'accepted') {
        errors.push(`Semantic-preflight record ${record.id} must be accepted only after its false and feature paths are measured.`);
      } else if (contract?.semanticPreflight) {
        checkSemanticPreflight(record, contract.semanticPreflight, errors);
      }
      continue;
    }
    if (kind === 'semantic-boundary') {
      if (record.verdict !== 'accepted') {
        errors.push(`Semantic-boundary record ${record.id} must be accepted only after its named call-result cases are tested.`);
      } else if (contract?.semanticBoundary) {
        checkSemanticBoundary(record, contract.semanticBoundary, errors);
      }
      continue;
    }
    if (kind === 'semantic-runtime') {
      if (contract?.semanticRuntime) {
        checkSemanticRuntime(record, contract.semanticRuntime, errors);
      }
      continue;
    }
    errors.push(...validateNecessityMetadata(record.necessity, `Hot-path cost audit record ${record.id}`));
    if (contract?.necessity?.status === 'audit-required' && changedPaths.includes(contract.files?.[0])) {
      errors.push(`Hot-path cost audit record ${record.id} cannot change its owner while necessity.status is audit-required; prove the fact flow or remove the action first.`);
    }
    if (kind === 'redundant-call-elimination') {
      // A removal record carries NO admission surface and no admission/feature
      // counters — it proves byte-identity + measured speedup + net removal +
      // redundancy (checkRedundantCallElimination). The allocation rule is NOT
      // relaxed: a pure removal must not allocate on any path, so noFeatureAllocations
      // must be present and zero.
      const noFeatureAllocations = numberCounter(record, ['noFeatureAllocations']);
      if (noFeatureAllocations === null) {
        errors.push(`Redundant-call-elimination record ${record.id} must record integer noFeatureAllocations.`);
      } else if (noFeatureAllocations > 0 && record.verdict === 'accepted') {
        errors.push(`Redundant-call-elimination record ${record.id} accepts a pass with no-feature allocations; a pure removal must not allocate.`);
      }
      if (contract?.redundantCallElimination && record.verdict === 'accepted') {
        checkRedundantCallElimination(record, contract.redundantCallElimination, errors);
      }
    } else if (kind === 'off-benchmark-call-reduction') {
      // An off-benchmark reduction record carries NO admission surface: it proves
      // byte-identity + benchmark non-regression + a net call-count reduction on a
      // NAMED fixture + a bounded-traversal disclosure (checkOffBenchmarkCallReduction).
      // Its added fallback-chain walk MAY allocate (it replaces a heavier descent),
      // so noFeatureAllocations is NOT forced to zero here — the allocation is instead
      // disclosed via the danger-token accounting the rest of the gate enforces.
      if (contract?.offBenchmarkCallReduction && record.verdict === 'accepted') {
        checkOffBenchmarkCallReduction(record, contract.offBenchmarkCallReduction, errors);
      }
    } else {
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
      const admissionCount = contract?.admission?.counter
        ? numberCounter(record, [contract.admission.counter])
        : null;
      const admissionWork = contract?.admission?.workCounter
        ? numberCounter(record, [contract.admission.workCounter])
        : null;
      const itemsVisited = numberCounter(record, ['itemsVisited']);
      const noFeatureAllocations = numberCounter(record, ['noFeatureAllocations']);
      const noFeatureMisses = numberCounter(record, ['noFeatureMisses']);
      if (calls === null || featureBearing === null || admissionCount === null || admissionWork === null || itemsVisited === null || noFeatureAllocations === null || noFeatureMisses === null) {
        errors.push(
          `Hot-path cost audit record ${record.id} must include numeric calls, feature-bearing calls/containers, admission calls/work, itemsVisited, noFeatureAllocations, and noFeatureMisses.`
        );
      } else {
        if (featureBearing > calls) {
          errors.push(`Hot-path cost audit record ${record.id} has more feature-bearing calls than calls.`);
        }
        const filterMeta = kind === 'conservative-filter' ? contract.conservativeFilter : undefined;
        // A conservative filter must ALWAYS prove byte-identity + speedup when accepted;
        // its no-feature allocation is only excused once that proof passes.
        const speedupProven = filterMeta && record.verdict === 'accepted'
          ? checkConservativeFilterSpeedup(record, filterMeta, errors)
          : false;
        if (noFeatureAllocations > 0 && record.verdict === 'accepted') {
          if (kind !== 'conservative-filter') {
            errors.push(`Hot-path cost audit record ${record.id} accepts a pass with no-feature allocations.`);
          } else if (!speedupProven) {
            errors.push(`Conservative-filter record ${record.id} allocates on the no-feature path without a proven byte-identical net speedup.`);
          }
        }
        const maxItemsPerContainer = contract?.admission?.maxItemsPerContainer;
        if (Number.isInteger(maxItemsPerContainer) && admissionWork > admissionCount * maxItemsPerContainer) {
          errors.push(
            `Hot-path cost audit record ${record.id} exceeds its admission-work budget: ${admissionWork} > ${admissionCount} * ${maxItemsPerContainer}.`
          );
        }
      }
    }
    if (typeof record.commonCaseProof !== 'string' || !/(benchmark|counter|test)/i.test(record.commonCaseProof)) {
      errors.push(`Hot-path cost audit record ${record.id} must name a common no-feature benchmark or counter test.`);
    }
    const benchmark = record.benchmark;
    if (
      !benchmark
      || typeof benchmark !== 'object'
      || benchmark.fixture !== 'benchmark.less'
      || benchmark.warmup !== 20
      || benchmark.pairs !== 45
    ) {
      errors.push(`Hot-path cost audit record ${record.id} must include the canonical benchmark.less A/B contract with 20 warmups and 45 pairs.`);
    } else {
      for (const phase of ['parse-render', 'render']) {
        const result = benchmark[phase];
        if (
          !result
          || typeof result !== 'object'
          || !Number.isFinite(result.beforeMedianMs)
          || result.beforeMedianMs <= 0
          || !Number.isFinite(result.afterMedianMs)
          || result.afterMedianMs <= 0
          || !Number.isFinite(result.medianDeltaMs)
          || !Number.isInteger(result.wins)
          || result.wins < 0
          || result.wins > benchmark.pairs
          || result.byteIdentical !== true
          || !Number.isInteger(result.outputBytes)
          || result.outputBytes <= 0
          || typeof result.outputSha256 !== 'string'
          || !/^[a-f0-9]{64}$/.test(result.outputSha256)
          || /^0{64}$/.test(result.outputSha256)
        ) {
          errors.push(`Hot-path cost audit record ${record.id} has incomplete ${phase} benchmark evidence.`);
        }
      }
    }
    if (!['accepted', 'rejected', 'deferred'].includes(record.verdict)) {
      errors.push(`Hot-path cost audit record ${record.id} must use verdict accepted, rejected, or deferred.`);
    }
  }

  for (const contract of registry) {
    // A neutral-or-negative contract has no source-guard surface to match, so it owns a
    // changed file by plain file membership. It still requires an accepted neutral record
    // (checkNeutralRefactor already ran in the per-record loop); it declares no relations.
    if ((contract.kind ?? 'precise') === 'neutral-or-negative' || contract.kind === 'private-unreachable') {
      if (!contract.files.some(file => changedPaths.includes(file))) {
        continue;
      }
      const record = byId.get(contract.id);
      if (!record) {
        errors.push(`Changed files require the ${contract.id} hot-path cost audit record.`);
      } else if (record.verdict !== 'accepted') {
        errors.push(`Changed production hot-path contract ${contract.id} must be accepted only after rejected/deferred code has been reverted.`);
      }
      continue;
    }
    // Semantic preflights deliberately have no arithmetic counter relations:
    // their false/feature-path counters are checked by checkSemanticPreflight.
    // Do not fall through to the ordinary admission/relation loop below.
    if (contract.kind === 'semantic-preflight' || contract.kind === 'semantic-boundary') {
      const ownsChangedFile = contract.files.some(file =>
        changedPaths.includes(file) && contractsForChangedSurface(registry, file, diff).includes(contract)
      );
      if (!ownsChangedFile) {
        continue;
      }
      const record = byId.get(contract.id);
      if (!record) {
        errors.push(`Changed files require the ${contract.id} hot-path cost audit record.`);
      } else if (record.verdict !== 'accepted') {
        errors.push(`Changed production hot-path contract ${contract.id} must be accepted only after rejected/deferred code has been reverted.`);
      }
      continue;
    }
    if (contract.kind === 'semantic-runtime') {
      const ownsChangedFile = contract.files.some(file => changedPaths.includes(file));
      if (!ownsChangedFile) {
        continue;
      }
      const record = byId.get(contract.id);
      if (!record) {
        errors.push(`Changed files require the ${contract.id} semantic-runtime evidence record.`);
      } else if (record.verdict !== 'accepted') {
        errors.push(`Changed semantic-runtime contract ${contract.id} must be accepted only after behavior/build/baseline evidence passes.`);
      }
      continue;
    }
    const ownsChangedFile = contract.files.some(file =>
      changedPaths.includes(file) && contractsForChangedSurface(registry, file, diff).includes(contract)
    );
    if (!ownsChangedFile) {
      continue;
    }
    const record = byId.get(contract.id);
    if (!record) {
      errors.push(`Changed files require the ${contract.id} hot-path cost audit record.`);
      continue;
    }
    if (record.verdict !== 'accepted') {
      errors.push(`Changed production hot-path contract ${contract.id} must be accepted only after rejected/deferred code has been reverted.`);
    }
    for (const relation of contract.relations) {
      const result = evaluateCounterRelation(relation, record);
      if (!result.ok) {
        errors.push(`Cost contract ${contract.id} relation failed: ${relation}${result.reason ? ` (${result.reason})` : ''}.`);
      }
    }
  }

  // A semantic-runtime batch is explicit rather than inferred from danger
  // tokens. Every changed file that opts into that lane must have exactly one
  // semantic-runtime owner and a corresponding accepted record; narrow
  // semantic-preflight/boundary records may still coexist for their separately
  // named sub-surface.
  for (const path of changedPaths) {
    const owners = registry.filter(contract => contract.kind === 'semantic-runtime' && contract.files.includes(path));
    if (owners.length === 0) {
      continue;
    }
    if (owners.length !== 1) {
      errors.push(`Changed semantic-runtime file ${path} must have exactly one semantic-runtime owner.`);
      continue;
    }
    if (!byId.has(owners[0].id)) {
      errors.push(`Changed semantic-runtime file ${path} requires the ${owners[0].id} semantic-runtime evidence record.`);
    }
  }
  return errors;
}

function isTestOnlyPath(path) {
  return /(^|\/)(test|tests|__tests__|fixtures|test-data)(\/|$)|\.(test|spec)\.[^/]+$/.test(path);
}

/**
 * The review keeps a full aggregate inventory for every changed production
 * source file, but only the engine's actual execution surfaces are eligible
 * for a cost-contract.  Treating a grammar reducer, CST declaration, public
 * export, or error/type/config edit as though it were a render-loop change
 * caused people to invent runtime counters and "neutral" claims that did not
 * describe the code at all.
 *
 * This is intentionally path-based and conservative.  A new core runtime
 * owner must be added here before it can avoid the strict gate.  Parser roots
 * are always frontends; their separate parser-runtime-boundary verifier and
 * focused parse/build evidence remain mandatory.
 */
function classifyProductionSurface(path) {
  if (isTestOnlyPath(path) || !hotPathRoots.some(rootPath => path.startsWith(rootPath))) {
    return 'outside-review';
  }
  if (path.startsWith('packages/css-parser/src/') || path.startsWith('packages/less-parser/src/')) {
    return 'frontend';
  }
  if (path.startsWith('packages/jess/src/')) {
    return 'public-plumbing';
  }
  if (!path.startsWith('packages/core/src/')) {
    return 'public-plumbing';
  }
  // Factories/types/errors are construction or public-boundary surfaces, not
  // eval/render loops.  Do not force fabricated runtime accounting for them.
  if (/\/ast\/(?:node|nodes|at-rule|value|selector|declaration|function|types?)\.ts$/.test(path)
    || /\/(?:errors?|types?|config|options)\.ts$/.test(path)) {
    return 'public-plumbing';
  }
  if (/\/ast\/(?:serialize|evaluator|mixin-dispatch|provenance|value-(?:eval|dispatch|guards|operate))\.ts$/.test(path)
    || /\/ast\/extend\//.test(path)
    || /\/tree\//.test(path)
    || /\/(?:context|lookup|output|writer|render|eval)\.ts$/.test(path)) {
    return 'runtime-engine';
  }
  return 'public-plumbing';
}

function isProductionHotPathFile(path) {
  return classifyProductionSurface(path) !== 'outside-review';
}

function isStrictRuntimeSurface(path) {
  return classifyProductionSurface(path) === 'runtime-engine';
}

/**
 * A Context source-identity migration is public plumbing even though Context
 * also owns evaluator state. Keep this hunk-level exception deliberately
 * narrow: an unknown Context edit remains a strict runtime edit. The paired
 * serializer allowance is only the mechanical diagnostic provenance read
 * (`treeContext` -> `sourceContext`), which is inseparable from moving the
 * public source-identity carrier off the legacy tree.
 */
function isDocumentSourcePlumbingHunk(hunk) {
  const changed = hunk.text
    .split('\n')
    .filter(line => /^[+-](?![+-])/.test(line))
    .map(line => line.slice(1).trim())
    .filter(Boolean);
  if (changed.length === 0) {
    return false;
  }

  if (hunk.file === 'packages/core/src/ast/serialize.ts') {
    return changed.every(line => line === 'const file = e.context?.treeContext?.file;'
      || line === 'const file = e.context?.sourceContext?.file;');
  }
  if (hunk.file !== 'packages/core/src/context.ts') {
    return false;
  }

  const anchors = /\b(?:DocumentContext(?:Options)?|TreeContext|SourceContext|_?documentContext|setDocumentContext|sourceContext|documentContexts|documentBodyContexts|currentDocument|currentSourceOwner|withSourceOwner|sourceOwnerForBody|ImportOptions|currentPlugin)\b|(?:document|tree)\.file|transform\.call/;
  const forbidden = /\b(?:treeRoot|allRoots|evaldTrees|rulesContext|selectorBits|SpineVisitor|spine)\b/i;
  if (!anchors.test(hunk.text) || changed.some(line => forbidden.test(line))) {
    return false;
  }

  // Hunk ownership is deliberately by named source-carrier seams, not a
  // generic token presence. Thus a Context hunk mentioning DocumentContext in
  // an evaluator/root/selector method remains strict by default.
  const sourceCarrierSeam = /(?:DocumentContextOptions|class DocumentContext|export (?:class TreeContext|interface TreeContextOptions)|(?:get |private )?(?:documentContext|sourceContext|setDocumentContext)|setOption<|documentContexts = new WeakMap|documentBodyContexts = new WeakMap|ImportOptions|rememberDocumentContext|withDocument<|transformUrl\(|withDocumentBody<|currentSourceOwner\(|withSourceOwner<|sourceOwnerForBody\(|private async _getPath\(|async loadImport\(|(?:document|tree)\.file|transform\.call|currentPlugin)/;
  return sourceCarrierSeam.test(hunk.text);
}

function classifyChangedHunkSurface(hunk) {
  if (isDocumentSourcePlumbingHunk(hunk)) {
    return 'public-plumbing';
  }
  return classifyProductionSurface(hunk.file);
}

function strictRuntimeChangedPaths(paths, diff) {
  return [...new Set(changedHunks(diff)
    .filter(hunk => paths.includes(hunk.file) && classifyChangedHunkSurface(hunk) === 'runtime-engine')
    .map(hunk => hunk.file))];
}

function boundaryChangedPathsForDiff(paths, diff) {
  return [...new Set(changedHunks(diff)
    .filter(hunk => paths.includes(hunk.file) && classifyChangedHunkSurface(hunk) !== 'runtime-engine')
    .map(hunk => hunk.file))];
}

function productionChangedPaths(paths) {
  return paths.filter(isProductionHotPathFile);
}

function runtimeChangedPaths(paths) {
  return paths.filter(isStrictRuntimeSurface);
}

function boundaryChangedPaths(paths) {
  return paths.filter((path) => {
    const surface = classifyProductionSurface(path);
    return surface === 'frontend' || surface === 'public-plumbing';
  });
}

function validateBoundaryEvidence(latestPass, paths) {
  if (paths.length === 0) {
    return [];
  }
  const errors = [];
  const labels = [
    '- Behavior evidence:',
    '- Build evidence:',
    '- Boundary evidence:'
  ];
  for (const label of labels) {
    const line = latestPass.split('\n').find(candidate => candidate.startsWith(label));
    if (!line || line.slice(label.length).trim().length < 24) {
      errors.push(`Changed frontend/public boundary surfaces require ${label} with concrete evidence; runtime cost contracts are not a substitute.`);
    }
  }
  return errors;
}

function hasSelfProsecutionLabel(pass, label) {
  const text = label.replace(/^-\s*|:$/g, '');
  const expression = new RegExp(`^-\\s+(?:\\*\\*)?${escapeRegExp(text)}(?::)?(?:\\*\\*)?(?:\\s|$)`, 'm');
  return expression.test(pass);
}

function selfProsecutionLine(pass, label) {
  const text = label.replace(/^-\s*|:$/g, '');
  const expression = new RegExp(`^-\\s+(?:\\*\\*)?${escapeRegExp(text)}(?::)?(?:\\*\\*)?.*$`, 'm');
  return pass.match(expression)?.[0];
}

/**
 * Placeholder rejection is deliberately field-scoped. A prose-wide word scan
 * cannot distinguish an unfinished assertion from a real identifier such as
 * `Partition.pending`, so it turns valid evidence into a release blocker.
 */
function selfProsecutionPlaceholders(pass, labels) {
  const placeholder = /^(?:TODO|TBD|fill in|pending)[.!]?$/iu;
  return labels.filter((label) => {
    const line = selfProsecutionLine(pass, label);
    if (!line) {
      return false;
    }
    const value = line.slice(line.indexOf(':') + 1).trim();
    return placeholder.test(value);
  });
}

function exactLedgerEntry(entry) {
  return JSON.stringify(entry);
}

/**
 * A parser-runtime debt entry is an exact, shrinking inventory of handwritten
 * recognizers. Removing one is a deletion pass, not a new hot-path design that
 * needs a fabricated cost contract. Keep this exception deliberately narrow:
 * the inventory may only shrink, every changed production file must be one of
 * the removed entries, and the source diff must remove each recorded snippet.
 * The parser-boundary verifier still proves that no recognizer survives.
 */
function debtFingerprint(kind, snippet) {
  return createHash('sha256').update(`${kind}:${snippet}`).digest('hex').slice(0, 16);
}

function debtSourceWasActuallyDeleted(entry, diff, previousSources, nextSources) {
  const previous = previousSources[entry.file];
  const next = nextSources[entry.file];
  if (typeof previous !== 'string' || typeof next !== 'string') {
    return false;
  }
  const source = previous.slice(entry.start, entry.end);
  const snippet = source.replace(/\s+/g, ' ').slice(0, 160);
  const lineStart = previous.lastIndexOf('\n', entry.start - 1) + 1;
  const lineEnd = previous.indexOf('\n', entry.end);
  const oldLine = previous.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  return snippet === entry.snippet
    && debtFingerprint(entry.kind, snippet) === entry.fingerprint
    && !next.includes(source)
    && changedHunks(diff)
      .filter(hunk => hunk.file === entry.file)
      .some(hunk => hunk.text.split('\n').includes(`-${oldLine}`));
}

function isExactParserRuntimeDebtDeletion({ mode, changedPaths, diff, findings, previousDebt, currentDebt, previousSources, nextSources, boundaryClean }) {
  if (mode !== 'staged' || findings.length > 0 || previousDebt.length === 0 || boundaryClean !== true) {
    return false;
  }
  const prior = new Set(previousDebt.map(exactLedgerEntry));
  const current = new Set(currentDebt.map(exactLedgerEntry));
  if ([...current].some(entry => !prior.has(entry))) {
    return false;
  }
  const removed = previousDebt.filter(entry => !current.has(exactLedgerEntry(entry)));
  if (removed.length === 0 || !changedPaths.includes(parserRuntimeDebtPath)) {
    return false;
  }
  const productionPaths = productionChangedPaths(changedPaths);
  const removedFiles = new Set(removed.map(entry => entry.file));
  if (
    productionPaths.length === 0
    || productionPaths.some(path => !removedFiles.has(path))
    || [...removedFiles].some(path => !productionPaths.includes(path))
  ) {
    return false;
  }
  return removed.every(entry => debtSourceWasActuallyDeleted(entry, diff, previousSources, nextSources));
}

function parserRuntimeDebtDeletionForCurrentDiff(mode, changedPaths, diff, findings) {
  if (mode !== 'staged') {
    return false;
  }
  // The staged verifier is a script, not an imported library. Never execute a
  // worktree-modified copy and pretend its answer proves the index: an
  // unstaged edit could simply exit zero. The candidate may stage a verifier
  // update, but its working bytes must still exactly equal the index.
  try {
    git(['diff', '--quiet', '--', 'scripts/verify-parser-runtime-boundary.mjs']);
  } catch {
    return false;
  }
  let previousDebt;
  let currentDebt;
  const previousSources = {};
  const nextSources = {};
  try {
    previousDebt = JSON.parse(git(['show', `HEAD:${parserRuntimeDebtPath}`])).debt;
    currentDebt = JSON.parse(git(['show', `:${parserRuntimeDebtPath}`])).debt;
    for (const entry of previousDebt) {
      previousSources[entry.file] ??= git(['show', `HEAD:${entry.file}`]);
      nextSources[entry.file] ??= git(['show', `:${entry.file}`]);
    }
  } catch {
    return false;
  }
  if (!Array.isArray(previousDebt) || !Array.isArray(currentDebt)) {
    return false;
  }
  let boundaryClean = false;
  try {
    execFileSync(process.execPath, ['scripts/verify-parser-runtime-boundary.mjs', '--staged'], {
      cwd: root,
      stdio: 'ignore'
    });
    boundaryClean = true;
  } catch {
    // A debt cleanup never receives the exemption unless the independent
    // boundary verifier accepts the post-change parser sources.
  }
  return isExactParserRuntimeDebtDeletion({ mode, changedPaths, diff, findings, previousDebt, currentDebt, previousSources, nextSources, boundaryClean });
}

function validateProductionHotPathCoverage(registry, changedPaths) {
  return changedPaths
    .filter(isStrictRuntimeSurface)
    .flatMap((path) => {
      const owners = registry.filter(contract => contract.files.includes(path) || contract.supportFiles?.includes(path));
      if (owners.length === 0) {
        return [`Changed production hot-path file ${path} is not covered by any machine-readable cost-contract registry entry.`];
      }
      return [];
    });
}

function validateSourceChecks(registry, changedPaths) {
  const errors = [];
  for (const contract of registry) {
    const sourceCheck = contract.sourceCheck;
    if (!sourceCheck || !changedPaths.includes(sourceCheck.file)) {
      continue;
    }
    if (contract.kind === 'semantic-runtime') {
      // Semantic-runtime owners are file-level records; their behavior/build
      // evidence and baseline are checked without inventing one guarded-call
      // source anchor for a multi-helper cutover.
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
    if (contract.kind === 'semantic-boundary') {
      // This kind owns a typed dispatch/result policy, not an expensive admission.
      // Its exact source anchors and executable branch tests are checked elsewhere;
      // requiring a fabricated `if (guard) { call }` enclosure would misdescribe it.
      continue;
    }
    if ((contract.kind ?? 'precise') === 'off-benchmark-call-reduction') {
      // The bounded fallback walk is entered under a multiline guard condition
      // (`if ( ... <guard> ... ) { ... <call> ... }`), so the single-line guarded-call
      // regex the other kinds use will not match. Require a guard BLOCK — an `if`
      // whose (possibly multiline) condition contains the guard and whose body still
      // encloses the call — so the reduction's traversal cannot be moved out from
      // under its admission guard without the source check noticing.
      const enclosed = (() => {
        if (callerStart < 0 || callIndex < 0) {
          return false;
        }
        const prefix = callerBody.slice(0, callOffset);
        const ifPattern = /if\s*\(/g;
        let match;
        while ((match = ifPattern.exec(prefix)) !== null) {
          let depth = 0;
          let condEnd = -1;
          for (let i = match.index + match[0].length - 1; i < prefix.length; i++) {
            const character = prefix[i];
            if (character === '(') {
              depth += 1;
            } else if (character === ')') {
              depth -= 1;
              if (depth === 0) {
                condEnd = i;
                break;
              }
            }
          }
          if (condEnd < 0 || !prefix.slice(match.index, condEnd + 1).includes(sourceCheck.guard)) {
            continue;
          }
          let balance = 0;
          let opened = false;
          for (let j = condEnd + 1; j < prefix.length; j++) {
            const character = prefix[j];
            if (character === '{') {
              balance += 1;
              opened = true;
            } else if (character === '}') {
              balance -= 1;
            }
          }
          if (opened && balance > 0) {
            return true;
          }
        }
        return false;
      })();
      if (!enclosed) {
        errors.push(
          `Off-benchmark call-reduction cost contract ${contract.id} changed its owning file without a guard block (if (... ${sourceCheck.guard} ...) { ... }) enclosing ${sourceCheck.call}.`
        );
      }
      continue;
    }
    if ((contract.kind ?? 'precise') === 'redundant-call-elimination') {
      // A removal has no surviving `if (guard) { call }` enclosure; the call is
      // ELIMINATED for a subset of inputs by a boolean short-circuit whose guard
      // operand skips it. Require the guard to short-circuit the SAME expression as
      // the (still-present, now-guarded) call: `<guard> || <call>` or
      // `<guard> && <call>` with no statement boundary between them.
      const shortCircuit = new RegExp(
        `${escapeRegExp(sourceCheck.guard)}\\s*(?:\\|\\||&&)[^;{}]*${escapeRegExp(sourceCheck.call)}`
      );
      if (callerStart < 0 || callIndex < 0 || !shortCircuit.test(callerBody)) {
        errors.push(
          `Redundant-call-elimination cost contract ${contract.id} changed its owning file without a short-circuit guard (${sourceCheck.guard} ||/&& ${sourceCheck.call}) eliminating ${sourceCheck.call}.`
        );
      }
      continue;
    }
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

function validateChangedContractSurface(registry, changedPaths, diff) {
  const errors = [];
  for (const path of changedPaths.filter(isStrictRuntimeSurface)) {
    const owners = registry.filter(contract => contract.files.includes(path));
    const supportOwners = registry.filter(contract => contract.supportFiles?.includes(path));
    if (supportOwners.length > 0 && owners.length === 0) {
      continue;
    }
    // A semantic-runtime owner covers a broad typed cutover whose hunks span
    // several cooperating helpers. Its machine record owns the file-level
    // semantic cases and behavior/build/baseline evidence; forcing every hunk
    // to contain one synthetic source anchor would turn the record into a
    // fabricated optimization contract. Narrow semantic-preflight/boundary
    // records remain independently checked by their own source metadata.
    if (owners.some(owner => owner.kind === 'semantic-runtime')) {
      continue;
    }
    // Neutral-or-negative owners carry no source-guard surface anchors, so their hunks
    // cannot (and need not) match a registered source surface — the byte-identity +
    // danger-token + costDelta attestation covers them instead.
    if (owners.length > 0 && owners.every(owner => (owner.kind ?? 'precise') === 'neutral-or-negative' || owner.kind === 'private-unreachable')) {
      continue;
    }
    const hunks = changedHunks(diff).filter(hunk => hunk.file === path && classifyChangedHunkSurface(hunk) === 'runtime-engine');
    if (owners.length === 0 || hunks.length === 0) {
      continue;
    }
    const unmatched = [];
    const ambiguous = new Map();
    for (const hunk of hunks) {
      const matched = contractsForChangedHunk(registry, path, hunk.text);
      if (matched.length === 0) {
        unmatched.push(hunk);
      } else if (matched.length !== 1) {
        const ids = matched.map(contract => contract.id).join(', ');
        ambiguous.set(ids, (ambiguous.get(ids) ?? 0) + 1);
      }
    }
    if (unmatched.length > 0) {
      errors.push(`Changed production hot-path surface ${path} has ${unmatched.length}/${hunks.length} unmatched hunks; add/update exact runtime contracts rather than hiding the aggregate branch inventory.`);
    }
    for (const [ids, count] of ambiguous) {
      errors.push(`Changed production hot-path surface ${path} has ${count}/${hunks.length} hunks matching multiple cost-contract surfaces: ${ids}.`);
    }
  }
  return errors;
}

function validateExecutableEvidence(registry, changedPaths, diff) {
  const errors = [];
  for (const contract of registry) {
    const semanticRuntime = contract.kind === 'semantic-runtime';
    const ownsChangedSurface = semanticRuntime
      ? contract.files.some(file => changedPaths.includes(file))
      : contract.files.some(file =>
          changedPaths.includes(file) && contractsForChangedSurface(registry, file, diff).includes(contract)
        );
    if (!ownsChangedSurface) {
      continue;
    }
    const commands = semanticRuntime
      ? [contract.evidence?.behaviorCommand, contract.evidence?.buildCommand]
      : [contract.evidence?.command];
    for (const command of commands) {
      if (!Array.isArray(command) || command.length === 0) {
        errors.push(`Executable evidence is missing for ${contract.id}.`);
        continue;
      }
      try {
        execFileSync(command[0], command.slice(1), {
          cwd: root,
          encoding: 'utf8',
          timeout: 120000,
          maxBuffer: 16 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (error) {
        const stderr = error?.stderr?.toString?.().trim() ?? '';
        errors.push(`Executable evidence failed for ${contract.id}: ${command.join(' ')}${stderr ? ` — ${stderr.slice(-500)}` : ''}.`);
      }
    }
  }
  return errors;
}

function collectDangerFindings(diff, dangerPatterns) {
  const additions = diff.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++'));
  const findings = [];
  for (const [label, pattern] of dangerPatterns) {
    const matches = additions.filter(line => pattern.test(line));
    if (matches.length > 0) {
      findings.push({ label, matches: matches.slice(0, 8), count: matches.length });
    }
  }
  return findings;
}

function diffForPaths(diff, predicate) {
  return changedHunks(diff)
    .filter(hunk => predicate(hunk.file))
    .map(hunk => hunk.text)
    .join('\n');
}

function diffForStrictRuntimeHunks(diff) {
  return changedHunks(diff)
    .filter(hunk => classifyChangedHunkSurface(hunk) === 'runtime-engine')
    .map(hunk => hunk.text)
    .join('\n');
}

async function runVerifier() {
  if (unsupportedAggregateMode) {
    console.error('The aggregate --mode=upstream scan was removed: it had no bounded owner, remediation, or release decision. Use the default working patch scope or --mode=staged.');
    process.exitCode = 2;
    return;
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

  const snapshots = changedPathSnapshots();
  const changedPaths = reviewMode === 'release'
    ? []
    : scopedChangedPaths(reviewMode, snapshots);
  const diff = collectScopedDiff(reviewMode, changedPaths);
  const qualityOnlyFix = await proveStagedQualityOnlyFix(reviewMode, snapshots);
  if (reviewMode === 'release') {
    console.log('Release snapshot mode: aggregate changed-path, danger-token, and cost/A-B accounting skipped.');
  }
  // Keep the complete branch aggregate visible. It is historical/audit
  // inventory, not a pretext for forcing parser/frontend/type edits into an
  // eval/render cost contract. Strict contract accounting receives only the
  // runtime-engine subset below.
  const reviewedDiff = qualityOnlyFix ? '' : diff;
  const reviewedChangedPaths = qualityOnlyFix ? [] : changedPaths;
  const findings = collectDangerFindings(reviewedDiff, dangerPatterns);
  const strictRuntimePaths = strictRuntimeChangedPaths(reviewedChangedPaths, reviewedDiff);
  const runtimeDiff = diffForStrictRuntimeHunks(reviewedDiff);
  const runtimeFindings = collectDangerFindings(runtimeDiff, dangerPatterns);

  const handoff = readFileSync(handoffPath, 'utf8');
  const review = readFileSync(cuttingReviewPath, 'utf8');
  const registryErrors = [];
  let registry = [];
  try {
    registry = readCostContractRegistry(review);
    registryErrors.push(...validateCostContractRegistry(registry));
    registryErrors.push(...validateCostContractOwnership(registry));
    registryErrors.push(...validateRegisteredSourceMetadata(registry));
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
  const missingLabels = requiredLabels.filter(label => !hasSelfProsecutionLabel(latestPass, label));
  const stalePlaceholders = selfProsecutionPlaceholders(latestPass, requiredLabels);

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
    console.error('Missing required Aggressive Cutting Self-Prosecution block in docs/architecture/core/HANDOFF.md.');
    if (missingLabels.length > 0) {
      console.error(`Missing labels: ${missingLabels.join(', ')}`);
    }
  }

  if (stalePlaceholders.length > 0) {
    failed = true;
    console.error(`Self-prosecution block has an unresolved required field: ${stalePlaceholders.join(', ')}.`);
  }

  if (findings.length > 0) {
    console.error('\nAggregate danger-token inventory for the current diff (all production surfaces):');
    for (const finding of findings) {
      console.error(`\n[${finding.label}] ${finding.count} match(es)`);
      for (const match of finding.matches) {
        console.error(match.slice(0, 220));
      }
      if (finding.count > finding.matches.length) {
        console.error(`... ${finding.count - finding.matches.length} more`);
      }
    }
    const reviewTokenLine = selfProsecutionLine(latestPass, '- Review-flagged diff tokens:');
    if (runtimeFindings.length > 0 && (!reviewTokenLine || /\b(none|no new|n\/a)\b/i.test(reviewTokenLine))) {
      failed = true;
      console.error(
        '\nDanger tokens require a non-empty "- Review-flagged diff tokens:" accounting line in the latest self-prosecution block.'
      );
    }
    // Hand-authored prose often wraps a bracketed category across lines.
    // Normalize whitespace only for this label-presence check; the raw pass is
    // still retained for every other evidence/source check.
    const normalizedPass = latestPass.replace(/\s+/g, ' ');
    const missingFindingLabels = runtimeFindings
      .map(finding => finding.label)
      .filter(label => !normalizedPass.includes(`[${label}]`));
    if (missingFindingLabels.length > 0) {
      failed = true;
      console.error(
        `\nLatest self-prosecution block must explicitly account for every danger category by label. Missing: ${missingFindingLabels.map(label => `[${label}]`).join(', ')}`
      );
    }
  }

  const nonRuntimePaths = boundaryChangedPathsForDiff(reviewedChangedPaths, reviewedDiff);
  const boundaryEvidenceErrors = validateBoundaryEvidence(latestPass, nonRuntimePaths);
  if (boundaryEvidenceErrors.length > 0) {
    failed = true;
    console.error('\nFrontend/public-boundary evidence review failed:');
    for (const error of boundaryEvidenceErrors) {
      console.error(`- ${error}`);
    }
    console.error(`- Classified non-runtime files: ${nonRuntimePaths.join(', ')}`);
  }

  const parserRuntimeDebtDeletion = parserRuntimeDebtDeletionForCurrentDiff(
    reviewMode,
    reviewedChangedPaths,
    reviewedDiff,
    findings
  );
  if (reviewMode === 'staged' && changedPaths.includes(parserRuntimeDebtPath) && !parserRuntimeDebtDeletion) {
    failed = true;
    console.error('\nParser-runtime debt changes must keep the staged boundary verifier clean and satisfy the exact deletion proof.');
  }
  const hotPathChanged = strictRuntimePaths.length > 0;
  const productionHotPathChanged = strictRuntimePaths.length > 0;
  const requiresCostAudit = (hotPathChanged || runtimeFindings.length > 0) && !parserRuntimeDebtDeletion;
  if (requiresCostAudit && registryErrors.length === 0) {
    const auditRecords = extractCostAuditRecords(latestPass, registry);
    const auditErrors = validateCostAuditRecords(auditRecords, registry, strictRuntimePaths, diff, runtimeFindings.length > 0);
    const sourceCheckErrors = validateSourceChecks(registry, strictRuntimePaths);
    const changedSurfaceErrors = validateChangedContractSurface(registry, strictRuntimePaths, diff);
    const evidenceErrors = productionHotPathChanged && !skipExecutableEvidence
      ? validateExecutableEvidence(registry, strictRuntimePaths, diff)
      : [];
    const coverageErrors = productionHotPathChanged
      ? validateProductionHotPathCoverage(registry, strictRuntimePaths)
      : [];
    if (
      auditErrors.length > 0
      || sourceCheckErrors.length > 0
      || changedSurfaceErrors.length > 0
      || evidenceErrors.length > 0
      || coverageErrors.length > 0
    ) {
      failed = true;
      console.error('\nHot-path cost contract review failed:');
      for (const error of [
        ...auditErrors,
        ...sourceCheckErrors,
        ...changedSurfaceErrors,
        ...evidenceErrors,
        ...coverageErrors
      ]) {
        console.error(`- ${error}`);
      }
    }
  }

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log('Aggressive cutting review block present.');
    if (reviewMode === 'release') {
      console.log('Release snapshot evidence validated: cost-contract registry and self-prosecution block are structurally valid.');
    } else if (findings.length === 0) {
      console.log('No danger tokens found in scoped diff.');
    } else {
      console.log('Danger tokens accounted for in the handoff self-prosecution block.');
    }
    if (parserRuntimeDebtDeletion) {
      console.log('Exact parser-runtime debt deletion: cost-contract review not required.');
    }
    if (qualityOnlyFix) {
      console.log('Exact staged ESLint reproduction proved a quality-only source change; semantic runtime accounting was not required.');
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runVerifier();
}

export {
  boundaryChangedPaths,
  boundaryChangedPathsForDiff,
  classifyChangedHunkSurface,
  classifyProductionSurface,
  evaluateCounterRelation,
  extractCostAuditRecords,
  grammarSourceReferences,
  isProductionHotPathFile,
  isDocumentSourcePlumbingHunk,
  isStrictRuntimeSurface,
  productionChangedPaths,
  runtimeChangedPaths,
  isExactParserRuntimeDebtDeletion,
  publicArtifactReferences,
  privateGrammarReachability,
  proveStagedQualityOnlyFix,
  qualityOnlyStagedPaths,
  reproduceApprovedQualityFixes,
  scopedChangedPaths,
  selfProsecutionPlaceholders,
  strictRuntimeChangedPaths,
  validateCostAuditRecords,
  validateBoundaryEvidence,
  validateCostContractRegistry,
  validateChangedContractSurface
};
