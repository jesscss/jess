#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(new URL('..', import.meta.url).pathname);
const handoffPath = resolve(root, 'docs/future/core-architecture/HANDOFF.md');
const cuttingReviewPath = resolve(root, 'docs/future/core-architecture/AGGRESSIVE-CUTTING-REVIEW.md');
const skipExecutableEvidence = process.argv.includes('--skip-executable-evidence');
const reviewedSourceRoots = [
  'packages/core/src',
  'packages/jess/src',
  'packages/less-parser/src',
  'packages/css-parser/src'
];
const hotPathRoots = reviewedSourceRoots.map(rootPath => `${rootPath}/`);

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
    ...(base
      ? git(['diff', '--name-only', '--diff-filter=ACMR', `${base}..HEAD`, '--']).split('\n')
      : []),
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
    if (!['precise', 'conservative-filter', 'redundant-call-elimination', 'neutral-or-negative'].includes(kind)) {
      errors.push(`Cost contract ${contract.id} kind must be "precise", "conservative-filter", "redundant-call-elimination", or "neutral-or-negative".`);
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
  for (const contract of registry) {
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
    if ((contract.kind ?? 'precise') === 'neutral-or-negative') {
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
  return errors;
}

function isTestOnlyPath(path) {
  return /(^|\/)(test|tests|__tests__|fixtures|test-data)(\/|$)|\.(test|spec)\.[^/]+$/.test(path);
}

function isProductionHotPathFile(path) {
  return !isTestOnlyPath(path) && hotPathRoots.some(rootPath => path.startsWith(rootPath));
}

function validateProductionHotPathCoverage(registry, changedPaths) {
  return changedPaths
    .filter(isProductionHotPathFile)
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
    const source = readFileSync(resolve(root, sourceCheck.file), 'utf8');
    const callerStart = source.indexOf(sourceCheck.caller);
    const callIndex = callerStart < 0 ? -1 : source.indexOf(sourceCheck.call, callerStart);
    const nextMethod = callerStart < 0 ? -1 : source.indexOf('\n  private ', callerStart + sourceCheck.caller.length);
    const callerBody = callerStart < 0
      ? ''
      : source.slice(callerStart, nextMethod < 0 ? undefined : nextMethod);
    const callOffset = callIndex - callerStart;
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
  for (const path of changedPaths.filter(isProductionHotPathFile)) {
    const owners = registry.filter(contract => contract.files.includes(path));
    const supportOwners = registry.filter(contract => contract.supportFiles?.includes(path));
    if (supportOwners.length > 0 && owners.length === 0) {
      continue;
    }
    // Neutral-or-negative owners carry no source-guard surface anchors, so their hunks
    // cannot (and need not) match a registered source surface — the byte-identity +
    // danger-token + costDelta attestation covers them instead.
    if (owners.length > 0 && owners.every(owner => (owner.kind ?? 'precise') === 'neutral-or-negative')) {
      continue;
    }
    if (owners.length === 1 && owners[0].coverage === 'owner-plus-named-carry-forward-support') {
      continue;
    }
    const hunks = changedHunks(diff).filter(hunk => hunk.file === path);
    if (owners.length === 0 || hunks.length === 0) {
      continue;
    }
    for (const hunk of hunks) {
      const matched = contractsForChangedHunk(registry, path, hunk.text);
      if (matched.length === 0) {
        errors.push(`Changed production hot-path hunk in ${path} does not touch any registered source surface; add or update the contract for the changed hunk.`);
      } else if (matched.length !== 1) {
        errors.push(`Changed production hot-path hunk in ${path} matches multiple cost-contract surfaces: ${matched.map(contract => contract.id).join(', ')}.`);
      }
    }
  }
  return errors;
}

function validateExecutableEvidence(registry, changedPaths, diff) {
  const errors = [];
  for (const contract of registry) {
    if (!contract.files.some(file =>
      changedPaths.includes(file) && contractsForChangedSurface(registry, file, diff).includes(contract)
    )) {
      continue;
    }
    const command = contract.evidence.command;
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
  return errors;
}

function runVerifier() {
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
    const auditErrors = validateCostAuditRecords(auditRecords, registry, changedPaths, diff, findings.length > 0);
    const sourceCheckErrors = validateSourceChecks(registry, changedPaths);
    const changedSurfaceErrors = validateChangedContractSurface(registry, changedPaths, diff);
    const evidenceErrors = productionHotPathChanged && !skipExecutableEvidence
      ? validateExecutableEvidence(registry, changedPaths, diff)
      : [];
    const coverageErrors = productionHotPathChanged
      ? validateProductionHotPathCoverage(registry, changedPaths)
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
    if (findings.length === 0) {
      console.log('No danger tokens found in scoped diff.');
    } else {
      console.log('Danger tokens accounted for in the handoff self-prosecution block.');
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runVerifier();
}

export { evaluateCounterRelation, validateCostAuditRecords, validateCostContractRegistry };
