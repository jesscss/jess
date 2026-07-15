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
    errors.push(...validateNecessityMetadata(contract.necessity, `Cost contract ${contract.id}`));
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
    if (!Array.isArray(contract.relations) || contract.relations.length === 0) {
      errors.push(`Cost contract ${contract.id} must state at least one counter relation.`);
    } else {
      errors.push(...validateDeclaredCounterRelations(contract));
      if (!contract.relations.includes('calls <= admittedCalls')) {
        errors.push(`Cost contract ${contract.id} must bind expensive calls to admitted calls with calls <= admittedCalls.`);
      }
      const hasFeatureAdmissionBound = contract.relations.some((relation) => {
        const parsed = parseCounterRelation(relation);
        return parsed?.left === 'admittedCalls'
          && parsed.operator === '<='
          && /^featureBearing/i.test(parsed.right);
      });
      if (!hasFeatureAdmissionBound) {
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
    for (const file of contract.files ?? []) {
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

function validateCostAuditRecords(records, registry, changedPaths, diff) {
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
    const contract = registry.find(candidate => candidate.id === record.id);
    const admissionCount = contract?.admission?.counter
      ? numberCounter(record, [contract.admission.counter])
      : null;
    const admissionWork = contract?.admission?.workCounter
      ? numberCounter(record, [contract.admission.workCounter])
      : null;
    const itemsVisited = numberCounter(record, ['itemsVisited']);
    const noFeatureAllocations = numberCounter(record, ['noFeatureAllocations']);
    const noFeatureMisses = numberCounter(record, ['noFeatureMisses']);
    errors.push(...validateNecessityMetadata(record.necessity, `Hot-path cost audit record ${record.id}`));
    if (contract?.necessity?.status === 'audit-required' && changedPaths.includes(contract.files?.[0])) {
      errors.push(`Hot-path cost audit record ${record.id} cannot change its owner while necessity.status is audit-required; prove the fact flow or remove the action first.`);
    }
    if (calls === null || featureBearing === null || admissionCount === null || admissionWork === null || itemsVisited === null || noFeatureAllocations === null || noFeatureMisses === null) {
      errors.push(
        `Hot-path cost audit record ${record.id} must include numeric calls, feature-bearing calls/containers, admission calls/work, itemsVisited, noFeatureAllocations, and noFeatureMisses.`
      );
    } else {
      if (featureBearing > calls) {
        errors.push(`Hot-path cost audit record ${record.id} has more feature-bearing calls than calls.`);
      }
      if (noFeatureAllocations > 0 && record.verdict === 'accepted') {
        errors.push(`Hot-path cost audit record ${record.id} accepts a pass with no-feature allocations.`);
      }
      const maxItemsPerContainer = contract?.admission?.maxItemsPerContainer;
      if (Number.isInteger(maxItemsPerContainer) && admissionWork > admissionCount * maxItemsPerContainer) {
        errors.push(
          `Hot-path cost audit record ${record.id} exceeds its admission-work budget: ${admissionWork} > ${admissionCount} * ${maxItemsPerContainer}.`
        );
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
      const owners = registry.filter(contract => contract.files.includes(path));
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
    const auditErrors = validateCostAuditRecords(auditRecords, registry, changedPaths, diff);
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
