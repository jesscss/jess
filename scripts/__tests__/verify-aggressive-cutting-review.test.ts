import { describe, expect, it } from 'vitest';
import {
  validateCostAuditRecords,
  validateCostContractRegistry
} from '../verify-aggressive-cutting-review.mjs';

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
