import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractCostAuditRecords,
  isProductionHotPathFile,
  isExactParserRuntimeDebtDeletion,
  productionChangedPaths,
  scopedChangedPaths,
  validateCostAuditRecords,
  validateCostContractRegistry
} from '../verify-aggressive-cutting-review.mjs';

describe('aggressive-cutting review scope', () => {
  const snapshots = {
    branch: ['packages/less-parser/src/grammar.ts'],
    unstaged: ['packages/core/src/tree/rules.ts'],
    staged: ['scripts/__tests__/verify-aggressive-cutting-review.test.ts'],
    untracked: ['packages/core/src/ast/__tests__/scratch.test.ts']
  };

  it('reviews only the staged file set for a pre-commit invocation', () => {
    expect(scopedChangedPaths('staged', snapshots)).toEqual([
      'scripts/__tests__/verify-aggressive-cutting-review.test.ts'
    ]);
  });

  it('keeps branch review for upstream mode and the full local picture for manual review', () => {
    expect(scopedChangedPaths('upstream', snapshots)).toEqual([
      'packages/less-parser/src/grammar.ts'
    ]);
    expect(scopedChangedPaths('working', snapshots)).toEqual([
      'packages/less-parser/src/grammar.ts',
      'packages/core/src/tree/rules.ts',
      'scripts/__tests__/verify-aggressive-cutting-review.test.ts',
      'packages/core/src/ast/__tests__/scratch.test.ts'
    ]);
  });

  it('does not classify test fixtures as production hot-path files', () => {
    expect(isProductionHotPathFile('packages/core/src/ast/__tests__/factory.test.ts')).toBe(false);
    expect(isProductionHotPathFile('packages/core/src/ast/fixtures/large.less')).toBe(false);
    expect(isProductionHotPathFile('packages/core/src/ast/serialize.ts')).toBe(true);
    expect(isProductionHotPathFile('packages/less-parser/src/grammar.ts')).toBe(true);
  });

  it('keeps test-only object-literal diffs out of the danger-token scan input', () => {
    expect(productionChangedPaths([
      'packages/core/src/ast/__tests__/factory-shapes.test.ts',
      'packages/core/src/ast/serialize.ts',
      'packages/css-parser/src/fixtures/recovery.test.ts'
    ])).toEqual(['packages/core/src/ast/serialize.ts']);
  });
});

describe('exact parser-runtime debt deletion', () => {
  const ledgerPath = 'scripts/parser-runtime-boundary-debt.json';
  const sourcePath = 'packages/css-parser/src/cst.ts';
  const snippet = '/(^|[^a-zA-Z0-9]+)([a-zA-Z0-9])/g';
  const oldLine = `    .replace(${snippet}, (_, _sep, char) => char.toUpperCase())`;
  const previousSource = `${oldLine}\n`;
  const removed = {
    file: sourcePath,
    line: 81,
    column: 14,
    start: oldLine.indexOf(snippet),
    end: oldLine.indexOf(snippet) + snippet.length,
    kind: 'regex-literal',
    fingerprint: createHash('sha256').update(`regex-literal:${snippet}`).digest('hex').slice(0, 16),
    snippet,
    retirement: 'Delete with the parser-runtime boundary cleanup.'
  };
  const diff = [
    `diff --git a/${sourcePath} b/${sourcePath}`,
    `+++ b/${sourcePath}`,
    '@@ -81 +81 @@',
    `-${oldLine}`
  ].join('\n');
  const candidate = (overrides: Record<string, unknown> = {}) => ({
    mode: 'staged',
    changedPaths: [sourcePath, ledgerPath],
    diff,
    findings: [],
    previousDebt: [removed],
    currentDebt: [],
    previousSources: { [sourcePath]: previousSource },
    nextSources: { [sourcePath]: '' },
    boundaryClean: true,
    ...overrides
  });

  it('exempts only an exact tracked recognizer deletion with no danger additions', () => {
    expect(isExactParserRuntimeDebtDeletion(candidate())).toBe(true);
  });

  it('rejects a ledger edit that adds or keeps untracked debt', () => {
    expect(isExactParserRuntimeDebtDeletion(candidate({
      currentDebt: [{ ...removed, fingerprint: 'new-debt' }]
    }))).toBe(false);
  });

  it('rejects a production change outside the removed ledger file or any danger token', () => {
    expect(isExactParserRuntimeDebtDeletion(candidate({
      changedPaths: [sourcePath, 'packages/core/src/ast/serialize.ts', ledgerPath],
    }))).toBe(false);
    expect(isExactParserRuntimeDebtDeletion(candidate({
      findings: [{ label: 'allocation' }],
    }))).toBe(false);
    expect(isExactParserRuntimeDebtDeletion(candidate({
      boundaryClean: false
    }))).toBe(false);
  });

  it('rejects a staged-vs-unstaged conflict instead of borrowing worktree proof', () => {
    expect(isExactParserRuntimeDebtDeletion(candidate({ mode: 'working' }))).toBe(false);
  });

  it('rejects a spoofed comment deletion when the recorded old parser line remains', () => {
    const spoofedDiff = diff.replace(`-${oldLine}`, `-// ${snippet}`);
    expect(isExactParserRuntimeDebtDeletion(candidate({
      diff: spoofedDiff,
      nextSources: { [sourcePath]: previousSource }
    }))).toBe(false);
  });

  it('rejects a staged deletion when an unstaged boundary verifier is replaced with exit 0', () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const sandbox = mkdtempSync(resolve(tmpdir(), 'jess-staged-debt-spoof-'));
    try {
      execFileSync('git', ['clone', '--quiet', '--no-hardlinks', repo, sandbox]);
      symlinkSync(resolve(repo, 'node_modules'), resolve(sandbox, 'node_modules'));
      for (const path of [
        'packages/css-parser/src/cst.ts',
        'scripts/parser-runtime-boundary-debt.json',
        'scripts/verify-aggressive-cutting-review.mjs',
        'scripts/verify-parser-runtime-boundary.mjs'
      ]) {
        const staged = execFileSync('git', ['show', `:${path}`], { cwd: repo, encoding: 'utf8' });
        const target = resolve(sandbox, path);
        writeFileSync(target, staged);
      }
      execFileSync('git', ['add',
        'packages/css-parser/src/cst.ts',
        'scripts/parser-runtime-boundary-debt.json',
        'scripts/verify-aggressive-cutting-review.mjs',
        'scripts/verify-parser-runtime-boundary.mjs'
      ], { cwd: sandbox });
      writeFileSync(resolve(sandbox, 'scripts/verify-parser-runtime-boundary.mjs'), 'process.exit(0);\n');
      let output = '';
      let status = 0;
      try {
        execFileSync(process.execPath, [
          'scripts/verify-aggressive-cutting-review.mjs',
          '--mode=staged',
          '--skip-executable-evidence'
        ], { cwd: sandbox, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error: unknown) {
        const failure = error as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
        status = failure.status ?? 1;
        output = `${failure.stdout?.toString() ?? ''}${failure.stderr?.toString() ?? ''}`;
      }
      expect(status).not.toBe(0);
      expect(output).not.toContain('Exact parser-runtime debt deletion: cost-contract review not required.');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe('concise handoff cost-contract ledger pointers', () => {
  const ledger = [{
    id: 'cold-terminal-surface',
    kind: 'neutral-or-negative',
    surface: 'cold terminal surface',
    files: ['packages/core/src/ast/serialize.ts'],
    neutralRefactor: {
      costDelta: 'neutral',
      why: 'The terminal branch is cold and writes its scalar bytes directly, with no normal-path traversal or allocation.',
      byteIdentity: {
        fixture: 'benchmark.less',
        collapseNesting: true,
        outputSha256: 'b'.repeat(64),
        outputBytes: 1,
      },
    },
  }];

  it('resolves a concise ledger pointer into its authoritative neutral audit record', () => {
    expect(extractCostAuditRecords(
      '- Hot-path cost contracts: ledger IDs: `cold-terminal-surface`; see the review ledger.',
      ledger,
    )).toEqual([{
      id: 'cold-terminal-surface',
      verdict: 'accepted',
      costDelta: 'neutral',
      why: ledger[0].neutralRefactor.why,
      byteIdentity: ledger[0].neutralRefactor.byteIdentity,
    }]);
  });

  it('keeps an unknown ledger id visible so the contract validator rejects it', () => {
    const records = extractCostAuditRecords(
      '- Hot-path cost contracts: ledger IDs: `missing-terminal-surface`.',
      ledger,
    );

    expect(validateCostAuditRecords(records, ledger, [], '')).toContain(
      'Hot-path cost audit record missing-terminal-surface is not declared in the machine-readable cost-contract registry.'
    );
  });
});

const sourceFile = 'packages/core/src/tree/rules.ts';
const registry = [{
  id: 'test-admission-contract',
  surface: 'test admission surface',
  files: [sourceFile],
  necessity: {
    status: 'proven',
    factSource: 'declaration assignment metadata is authoritative',
    rediscovery: 'the admission scans child rules to rediscover merge presence',
    carryForward: 'construction can carry a presence bit on each Rules surface',
    whyNotCarried: 'this test contract assumes the fact is already explicit'
  },
  admission: {
    predicate: 'cheap admission',
    cost: 'cheap',
    counter: 'admissionCalls',
    workCounter: 'admissionItemsVisited',
    maxItemsPerContainer: 8,
    before: 'before collection and allocation'
  },
  counters: [
    'calls',
    'admittedCalls',
    'admissionCalls',
    'admissionItemsVisited',
    'featureBearingContainers',
    'itemsVisited',
    'noFeatureAllocations',
    'noFeatureMisses'
  ],
  commonCaseProof: 'focused counter test',
  benchmark: {
    fixture: 'benchmark.less',
    phases: ['parse-render', 'render'],
    warmup: 20,
    pairs: 45
  },
  relations: [
    'calls <= admittedCalls',
    'admittedCalls <= admissionCalls',
    'admittedCalls <= featureBearingContainers'
  ],
  evidence: {
    command: ['node', '--check', 'scripts/verify-aggressive-cutting-review.mjs']
  },
  sourceCheck: {
    file: sourceFile,
    caller: '_finishSourceOrderEvaluation',
    call: '_coalesceMergedDeclarations',
    guard: 'hasMergeOutputSurface'
  }
}];
const diff = [
  `diff --git a/${sourceFile} b/${sourceFile}`,
  `+++ b/${sourceFile}`,
  '@@ -1 +1 @@',
  '+ _finishSourceOrderEvaluation _coalesceMergedDeclarations hasMergeOutputSurface'
].join('\n');

function makeRecord(overrides: Record<string, unknown> = {}) {
  const phase = {
    beforeMedianMs: 1,
    afterMedianMs: 1,
    medianDeltaMs: 0,
    wins: 0,
    byteIdentical: true,
    outputBytes: 1,
    outputSha256: 'a'.repeat(64)
  };
  return {
    id: 'test-admission-contract',
    necessity: registry[0].necessity,
    admission: {
      predicate: 'cheap admission',
      cost: 'cheap',
      before: 'before collection and allocation'
    },
    calls: 15,
    admittedCalls: 15,
    admissionCalls: 15,
    admissionItemsVisited: 15,
    featureBearingContainers: 15,
    itemsVisited: 1,
    noFeatureAllocations: 0,
    noFeatureMisses: 0,
    commonCaseProof: 'focused counter test',
    benchmark: {
      fixture: 'benchmark.less',
      warmup: 20,
      pairs: 45,
      ['parse-render']: phase,
      render: phase
    },
    verdict: 'accepted',
    ...overrides
  };
}

describe('hot-path admission counter relations', () => {
  it('requires a proof-of-necessity record for every contract', () => {
    const withoutNecessity = { ...registry[0], necessity: undefined };
    expect(validateCostContractRegistry([withoutNecessity])).toContain(
      'Cost contract test-admission-contract must include proof-of-necessity metadata.'
    );
  });

  it('requires the expensive-call admission chain in every contract', () => {
    expect(validateCostContractRegistry(registry)).toEqual([]);
    const withoutAdmissionBound = {
      ...registry[0],
      relations: ['admittedCalls <= featureBearingContainers']
    };
    expect(validateCostContractRegistry([withoutAdmissionBound])).toContain(
      'Cost contract test-admission-contract must bind expensive calls to admitted calls with calls <= admittedCalls.'
    );
  });

  it('requires named carry-forward coverage for producer support files', () => {
    const withSupport = {
      ...registry[0],
      coverage: 'owner-plus-named-carry-forward-support',
      supportFiles: ['packages/core/src/tree/apply.ts']
    };
    expect(validateCostContractRegistry([withSupport])).toEqual([]);

    const withoutCoverage = { ...withSupport, coverage: undefined };
    expect(validateCostContractRegistry([withoutCoverage])).toContain(
      'Cost contract test-admission-contract supportFiles require coverage owner-plus-named-carry-forward-support.'
    );
  });

  it('rejects 10,000 expensive calls when the cheap admission found no feature', () => {
    const errors = validateCostAuditRecords(
      [makeRecord({ calls: 10_000, admittedCalls: 0, featureBearingContainers: 0 })],
      registry,
      [sourceFile],
      diff
    );

    expect(errors).toContain('Cost contract test-admission-contract relation failed: calls <= admittedCalls.');
  });

  it('rejects 10,000 admitted calls when only 15 containers bear the feature', () => {
    const errors = validateCostAuditRecords(
      [makeRecord({ calls: 10_000, admittedCalls: 10_000, featureBearingContainers: 15 })],
      registry,
      [sourceFile],
      diff
    );

    expect(errors).toContain(
      'Cost contract test-admission-contract relation failed: admittedCalls <= featureBearingContainers.'
    );
  });

  it('accepts a consistent admitted-call chain', () => {
    expect(validateCostAuditRecords([makeRecord()], registry, [sourceFile], diff)).toEqual([]);
  });

  it('rejects an admission that hides excessive scan work', () => {
    const errors = validateCostAuditRecords(
      [makeRecord({ admissionItemsVisited: 10_000 })],
      registry,
      [sourceFile],
      diff
    );

    expect(errors).toContain(
      'Hot-path cost audit record test-admission-contract exceeds its admission-work budget: 10000 > 15 * 8.'
    );
  });
});

const filterContract = {
  ...registry[0],
  id: 'test-filter-contract',
  kind: 'conservative-filter',
  counters: [
    'calls',
    'admittedCalls',
    'admissionCalls',
    'admissionItemsVisited',
    'featureBearingCalls',
    'itemsVisited',
    'noFeatureAllocations',
    'noFeatureMisses'
  ],
  conservativeFilter: {
    supersetOf: 'featureBearingCalls',
    governedFunction: 'processExtends',
    speedup: { phase: 'render', minPercentFaster: 20 },
    allocation: { onNoFeaturePath: true, justifiedBy: 'net-speedup' }
  },
  relations: ['calls <= admittedCalls', 'featureBearingCalls <= admittedCalls']
};
const filterRegistry = [filterContract];

function makeFilterRecord(overrides: Record<string, unknown> = {}) {
  const phase = {
    beforeMedianMs: 50,
    afterMedianMs: 27,
    medianDeltaMs: 23,
    wins: 45,
    byteIdentical: true,
    outputBytes: 131578,
    outputSha256: 'b'.repeat(64)
  };
  return {
    id: 'test-filter-contract',
    kind: 'conservative-filter',
    necessity: registry[0].necessity,
    admission: { predicate: 'cheap admission', cost: 'cheap', before: 'before collection and allocation' },
    calls: 86,
    admittedCalls: 86,
    admissionCalls: 37_973,
    admissionItemsVisited: 37_973,
    featureBearingCalls: 44,
    itemsVisited: 86,
    noFeatureAllocations: 39_557,
    noFeatureMisses: 37_887,
    governedFunction: { name: 'processExtends', beforeMs: 50, afterMs: 27 },
    commonCaseProof: 'focused counter test',
    benchmark: { fixture: 'benchmark.less', warmup: 20, pairs: 45, ['parse-render']: phase, render: phase },
    verdict: 'accepted',
    ...overrides
  };
}

describe('conservative-filter contract kind', () => {
  it('accepts a byte-identical, faster, superset-admitting filter that allocates', () => {
    expect(validateCostContractRegistry(filterRegistry)).toEqual([]);
    expect(validateCostAuditRecords([makeFilterRecord()], filterRegistry, [sourceFile], diff)).toEqual([]);
  });

  it('requires the flipped superset relation featureBearing* <= admittedCalls', () => {
    const badRegistry = [{ ...filterContract, relations: ['calls <= admittedCalls', 'admittedCalls <= featureBearingCalls'] }];
    expect(validateCostContractRegistry(badRegistry)).toContain(
      'Conservative-filter cost contract test-filter-contract must admit a superset: bind featureBearing* <= admittedCalls.'
    );
  });

  it('refuses the no-feature allocation escape when the filter is not faster', () => {
    const errors = validateCostAuditRecords(
      [makeFilterRecord({ governedFunction: { name: 'processExtends', beforeMs: 50, afterMs: 49 } })],
      filterRegistry,
      [sourceFile],
      diff
    );
    expect(errors.some(e => /speedup insufficient/.test(e))).toBe(true);
    expect(errors.some(e => /allocates on the no-feature path without a proven/.test(e))).toBe(true);
  });

  it('refuses the escape when the benchmark phases are not byte-identical to each other', () => {
    const phaseA = { beforeMedianMs: 50, afterMedianMs: 27, medianDeltaMs: 23, wins: 45, byteIdentical: true, outputBytes: 131578, outputSha256: 'b'.repeat(64) };
    const phaseB = { ...phaseA, outputSha256: 'c'.repeat(64) };
    const errors = validateCostAuditRecords(
      [makeFilterRecord({ benchmark: { fixture: 'benchmark.less', warmup: 20, pairs: 45, ['parse-render']: phaseA, render: phaseB } })],
      filterRegistry,
      [sourceFile],
      diff
    );
    expect(errors.some(e => /byte-identical output across both benchmark phases/.test(e))).toBe(true);
  });

  it('still rejects a precise contract that omits the feature-admission bound', () => {
    const preciseNoBound = { ...registry[0], relations: ['calls <= admittedCalls'] };
    expect(validateCostContractRegistry([preciseNoBound])).toContain(
      'Cost contract test-admission-contract must bind admitted calls to a feature-bearing counter.'
    );
  });
});

const removalContract = {
  id: 'test-removal-contract',
  kind: 'redundant-call-elimination',
  surface: 'test removal surface',
  files: [sourceFile],
  necessity: registry[0].necessity,
  redundantCallElimination: {
    governedFunction: 'isSpineExtendTopology',
    eliminatedSite: 'isSpineEligibleRoot',
    speedup: { phase: 'render', minPercentFaster: 3 },
    redundancyProof: {
      basis: 'covered-by-later-check',
      authority: 'post-wire re-gate is the sole authority and aborts to eval byte-identically'
    }
  },
  counters: ['callsBefore', 'callsAfter', 'noFeatureAllocations'],
  commonCaseProof: 'benchmark counter test',
  benchmark: { fixture: 'benchmark.less', phases: ['parse-render', 'render'], warmup: 20, pairs: 45 },
  relations: ['callsAfter <= callsBefore'],
  evidence: { command: ['node', '--check', 'scripts/verify-aggressive-cutting-review.mjs'] },
  sourceCheck: {
    file: sourceFile,
    caller: 'export function isSpineEligibleRoot',
    call: 'isSpineExtendTopology',
    guard: 'allowImport'
  }
};
const removalRegistry = [removalContract];
const removalDiff = [
  `diff --git a/${sourceFile} b/${sourceFile}`,
  `+++ b/${sourceFile}`,
  '@@ -1 +1 @@',
  '+ export function isSpineEligibleRoot allowImport || isSpineExtendTopology'
].join('\n');

function makeRemovalRecord(overrides: Record<string, unknown> = {}) {
  const phase = {
    beforeMedianMs: 160,
    afterMedianMs: 150,
    medianDeltaMs: -10,
    wins: 35,
    byteIdentical: true,
    outputBytes: 131578,
    outputSha256: 'd'.repeat(64)
  };
  return {
    id: 'test-removal-contract',
    kind: 'redundant-call-elimination',
    necessity: registry[0].necessity,
    callsBefore: 1,
    callsAfter: 0,
    noFeatureAllocations: 0,
    governedFunction: { name: 'isSpineExtendTopology', beforeMs: 160, afterMs: 150 },
    redundancyProof: {
      basis: 'covered-by-later-check',
      authority: 'post-wire re-gate is the sole authority and aborts to eval byte-identically'
    },
    commonCaseProof: 'benchmark counter test',
    benchmark: { fixture: 'benchmark.less', warmup: 20, pairs: 45, ['parse-render']: phase, render: phase },
    verdict: 'accepted',
    ...overrides
  };
}

describe('redundant-call-elimination contract kind', () => {
  it('accepts a byte-identical, faster, net-removal contract with a redundancy proof', () => {
    expect(validateCostContractRegistry(removalRegistry)).toEqual([]);
    expect(validateCostAuditRecords([makeRemovalRecord()], removalRegistry, [sourceFile], removalDiff)).toEqual([]);
  });

  it('rejects a cost-ADD wearing the kind (callsAfter > callsBefore)', () => {
    const errors = validateCostAuditRecords(
      [makeRemovalRecord({ callsBefore: 1, callsAfter: 5 })],
      removalRegistry,
      [sourceFile],
      removalDiff
    );
    expect(errors.some(e => /is not a removal: callsAfter 5 > callsBefore 1/.test(e))).toBe(true);
  });

  it('rejects a removal whose benchmark phases are not byte-identical to each other', () => {
    const phaseA = { beforeMedianMs: 160, afterMedianMs: 150, medianDeltaMs: -10, wins: 35, byteIdentical: true, outputBytes: 131578, outputSha256: 'd'.repeat(64) };
    const phaseB = { ...phaseA, outputSha256: 'e'.repeat(64) };
    const errors = validateCostAuditRecords(
      [makeRemovalRecord({ benchmark: { fixture: 'benchmark.less', warmup: 20, pairs: 45, ['parse-render']: phaseA, render: phaseB } })],
      removalRegistry,
      [sourceFile],
      removalDiff
    );
    expect(errors.some(e => /byte-identical output across both benchmark phases/.test(e))).toBe(true);
  });

  it('rejects a removal that is not measurably faster by the declared margin', () => {
    const errors = validateCostAuditRecords(
      [makeRemovalRecord({ governedFunction: { name: 'isSpineExtendTopology', beforeMs: 160, afterMs: 159 } })],
      removalRegistry,
      [sourceFile],
      removalDiff
    );
    expect(errors.some(e => /speedup insufficient/.test(e))).toBe(true);
  });

  it('rejects a removal that borrows the admission-filter relation calls <= admittedCalls', () => {
    const badRegistry = [{ ...removalContract, relations: ['callsAfter <= callsBefore', 'calls <= admittedCalls'] }];
    expect(validateCostContractRegistry(badRegistry)).toContain(
      'Redundant-call-elimination cost contract test-removal-contract must not claim the admission-filter relation calls <= admittedCalls; it removes work, it does not admit it.'
    );
  });

  it('requires the redundantCallElimination block and net-removal relation in the registry', () => {
    const noBlock = { ...removalContract, redundantCallElimination: undefined };
    expect(validateCostContractRegistry([noBlock])).toContain(
      'Redundant-call-elimination cost contract test-removal-contract must include a redundantCallElimination block.'
    );
    const noRelation = { ...removalContract, relations: ['callsAfter <= 0'] };
    expect(validateCostContractRegistry([noRelation])).toContain(
      'Redundant-call-elimination cost contract test-removal-contract must bind the eliminated work with callsAfter <= callsBefore.'
    );
  });

  it('still validates the precise and conservative-filter kinds unchanged', () => {
    expect(validateCostContractRegistry(registry)).toEqual([]);
    expect(validateCostContractRegistry(filterRegistry)).toEqual([]);
  });
});

const neutralFile = 'packages/core/src/tree/reference.ts';
const neutralOracleSha = '98a0536086c7e555b1a98e2372ad4000d51e25f1418c6345b6b8a9a97d80972f';
const neutralContract = {
  id: 'test-neutral-contract',
  kind: 'neutral-or-negative',
  surface: 'neutral route split surface',
  files: [neutralFile],
  neutralRefactor: {
    costDelta: 'neutral',
    why: 'Pure route split: exactly one call runs per invocation with identical options depending only on readMode, so no new allocation or traversal is introduced.',
    byteIdentity: {
      fixture: 'benchmark.less',
      collapseNesting: true,
      outputSha256: neutralOracleSha,
      outputBytes: 131578
    }
  }
};
const neutralRegistry = [neutralContract];
const neutralDiff = [
  `diff --git a/${neutralFile} b/${neutralFile}`,
  `+++ b/${neutralFile}`,
  '@@ -1 +1 @@',
  '+  const isOrdinaryVariableRead = typeof valueKey === \'string\''
].join('\n');

function makeNeutralRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-neutral-contract',
    kind: 'neutral-or-negative',
    costDelta: 'neutral',
    why: neutralContract.neutralRefactor.why,
    byteIdentity: { ...neutralContract.neutralRefactor.byteIdentity },
    verdict: 'accepted',
    ...overrides
  };
}

describe('neutral-or-negative auto-pass contract kind', () => {
  it('accepts a byte-identical, token-free, cost-neutral change without an admission contract', () => {
    expect(validateCostContractRegistry(neutralRegistry)).toEqual([]);
    expect(
      validateCostAuditRecords([makeNeutralRecord()], neutralRegistry, [neutralFile], neutralDiff, false)
    ).toEqual([]);
  });

  it('rejects a neutral auto-pass when the diff introduces danger tokens', () => {
    const errors = validateCostAuditRecords(
      [makeNeutralRecord()],
      neutralRegistry,
      [neutralFile],
      neutralDiff,
      true
    );
    expect(errors.some(e => /cannot auto-pass while the diff introduces danger tokens/.test(e))).toBe(true);
  });

  it('rejects a neutral auto-pass that declares costDelta increase', () => {
    const errors = validateCostAuditRecords(
      [makeNeutralRecord({ costDelta: 'increase' })],
      neutralRegistry,
      [neutralFile],
      neutralDiff,
      false
    );
    expect(errors.some(e => /must declare costDelta "neutral" or "decrease"; a cost increase cannot use the auto-pass/.test(e))).toBe(true);
  });

  it('rejects a neutral auto-pass whose byteIdentity does not match the registered oracle', () => {
    const errors = validateCostAuditRecords(
      [makeNeutralRecord({ byteIdentity: { fixture: 'benchmark.less', collapseNesting: true, outputSha256: 'f'.repeat(64), outputBytes: 999 } })],
      neutralRegistry,
      [neutralFile],
      neutralDiff,
      false
    );
    expect(errors.some(e => /byteIdentity must match the registered contract oracle/.test(e))).toBe(true);
  });

  it('rejects a neutral contract missing its neutralRefactor block or byte-identity', () => {
    expect(validateCostContractRegistry([{ ...neutralContract, neutralRefactor: undefined }])).toContain(
      'Neutral-or-negative cost contract test-neutral-contract must include a neutralRefactor block.'
    );
    const noByteIdentity = {
      ...neutralContract,
      neutralRefactor: { ...neutralContract.neutralRefactor, byteIdentity: undefined }
    };
    expect(validateCostContractRegistry([noByteIdentity]).some(e => /must declare neutralRefactor\.byteIdentity/.test(e))).toBe(true);
  });

  it('requires an accepted neutral record when the owning file changed', () => {
    const errors = validateCostAuditRecords([], neutralRegistry, [neutralFile], neutralDiff, false);
    expect(errors).toContain('Changed files require the test-neutral-contract hot-path cost audit record.');
  });

  it('leaves the precise, conservative-filter, and redundant-call-elimination kinds validating unchanged', () => {
    expect(validateCostContractRegistry(registry)).toEqual([]);
    expect(validateCostContractRegistry(filterRegistry)).toEqual([]);
    expect(validateCostAuditRecords([makeRecord()], registry, [sourceFile], diff)).toEqual([]);
  });
});

const scopeFile = 'packages/core/src/tree/scope-frame.ts';
const offBenchContract = {
  id: 'test-off-bench-contract',
  kind: 'off-benchmark-call-reduction',
  surface: 'lookupScopeFrameCallable import fallback-chain traversal',
  files: [scopeFile],
  necessity: {
    status: 'proven',
    factSource: 'imported guarded mixins resolve on the frame fallbackFrame chain once coverage is prepared',
    rediscovery: 'the lookup re-descended child rulesets via findMixinsFastForUncoveredCallable',
    carryForward: 'the existing fallbackFrame links are walked under the same visibility rules',
    whyNotCarried: 'the import origin frames already exist; walking them is leaner than rescanning children'
  },
  offBenchmarkCallReduction: {
    governedFunction: 'findMixinsFastForUncoveredCallable',
    measuredOn: 'packages/jess/benchmark/callable-fallback/main.less',
    boundedTraversal: 'a single acyclic walk over the import fallbackFrame chain, bounded by import depth, not a whole-tree scan',
    benchmarkNonRegression: { phase: 'render', maxPercentSlower: 3 }
  },
  counters: ['callsBefore', 'callsAfter'],
  commonCaseProof: 'callable-fallback fixture counter test',
  benchmark: {
    fixture: 'benchmark.less',
    phases: ['parse-render', 'render'],
    warmup: 20,
    pairs: 45
  },
  relations: ['callsAfter < callsBefore'],
  evidence: {
    command: ['node', '--check', 'scripts/verify-aggressive-cutting-review.mjs']
  },
  sourceCheck: {
    file: scopeFile,
    caller: 'export function lookupScopeFrameCallable',
    call: 'walkFallbackCallable',
    guard: "result.reason === 'child-surface'"
  }
};
const offBenchRegistry = [offBenchContract];

function makeOffBenchRecord(overrides: Record<string, unknown> = {}) {
  const okPhase = (sha = 'a'.repeat(64)) => ({
    beforeMedianMs: 100,
    afterMedianMs: 100,
    medianDeltaMs: 0,
    wins: 20,
    byteIdentical: true,
    outputBytes: 100,
    outputSha256: sha
  });
  return {
    id: 'test-off-bench-contract',
    necessity: offBenchContract.necessity,
    measuredOn: 'packages/jess/benchmark/callable-fallback/main.less',
    callsBefore: 6,
    callsAfter: 0,
    boundedTraversal: 'a single acyclic walk over the import fallbackFrame chain, bounded by import depth, not a whole-tree scan',
    commonCaseProof: 'callable-fallback fixture counter test',
    benchmark: {
      fixture: 'benchmark.less',
      warmup: 20,
      pairs: 45,
      ['parse-render']: okPhase(),
      render: okPhase()
    },
    verdict: 'accepted',
    ...overrides
  };
}

describe('off-benchmark call-reduction cost-contract kind', () => {
  it('accepts a valid off-benchmark call-count reduction contract and record', () => {
    expect(validateCostContractRegistry(offBenchRegistry)).toEqual([]);
    expect(validateCostAuditRecords([makeOffBenchRecord()], offBenchRegistry, [], '')).toEqual([]);
  });

  it('rejects a record that REGRESSES benchmark on the non-regression rail', () => {
    const regressing = makeOffBenchRecord({
      benchmark: {
        fixture: 'benchmark.less',
        warmup: 20,
        pairs: 45,
        ['parse-render']: {
          beforeMedianMs: 100, afterMedianMs: 100, medianDeltaMs: 0,
          wins: 20, byteIdentical: true, outputBytes: 100, outputSha256: 'a'.repeat(64)
        },
        // render after-median 200ms is far beyond the 3% noise cap over 100ms before.
        render: {
          beforeMedianMs: 100, afterMedianMs: 200, medianDeltaMs: 100,
          wins: 0, byteIdentical: true, outputBytes: 100, outputSha256: 'a'.repeat(64)
        }
      }
    });
    const errors = validateCostAuditRecords([regressing], offBenchRegistry, [], '');
    expect(errors.some(error => error.includes('REGRESSES benchmark render'))).toBe(true);
  });

  it('rejects a record whose callsAfter is not below callsBefore (inert removal)', () => {
    const inert = makeOffBenchRecord({ callsBefore: 6, callsAfter: 6 });
    const errors = validateCostAuditRecords([inert], offBenchRegistry, [], '');
    expect(errors.some(error => error.includes('is not a reduction: callsAfter 6 must be < callsBefore 6'))).toBe(true);
  });

  it('rejects an output-changing record (benchmark phases render different bytes)', () => {
    const outputChanging = makeOffBenchRecord({
      benchmark: {
        fixture: 'benchmark.less',
        warmup: 20,
        pairs: 45,
        ['parse-render']: {
          beforeMedianMs: 100, afterMedianMs: 100, medianDeltaMs: 0,
          wins: 20, byteIdentical: true, outputBytes: 100, outputSha256: 'a'.repeat(64)
        },
        render: {
          beforeMedianMs: 100, afterMedianMs: 100, medianDeltaMs: 0,
          wins: 20, byteIdentical: true, outputBytes: 100, outputSha256: 'b'.repeat(64)
        }
      }
    });
    const errors = validateCostAuditRecords([outputChanging], offBenchRegistry, [], '');
    expect(errors.some(error => error.includes('byte-identical benchmark output across both phases'))).toBe(true);
  });

  it('rejects a contract whose measuredOn is benchmark.less (benefit must be off the oracle)', () => {
    const onBenchmark = {
      ...offBenchContract,
      offBenchmarkCallReduction: {
        ...offBenchContract.offBenchmarkCallReduction,
        measuredOn: 'packages/jess/benchmark/benchmark.less'
      }
    };
    expect(validateCostContractRegistry([onBenchmark])).toContain(
      'Off-benchmark call-reduction cost contract test-off-bench-contract must name a representative measuredOn fixture that is NOT benchmark.less (the benefit is off the wall-clock oracle).'
    );
  });

  it('rejects a contract that borrows the admission-filter relation', () => {
    const borrowed = {
      ...offBenchContract,
      relations: ['callsAfter < callsBefore', 'calls <= admittedCalls']
    };
    expect(validateCostContractRegistry([borrowed])).toContain(
      'Off-benchmark call-reduction cost contract test-off-bench-contract must not claim the admission-filter relation calls <= admittedCalls; it removes work, it does not admit it.'
    );
  });

  it('leaves the existing precise / conservative-filter kinds validating unchanged', () => {
    expect(validateCostContractRegistry(registry)).toEqual([]);
    expect(validateCostContractRegistry(filterRegistry)).toEqual([]);
    expect(validateCostAuditRecords([makeRecord()], registry, [sourceFile], diff)).toEqual([]);
  });
});
