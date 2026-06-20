import type { IslandParsePlan } from './island-parse-plan.js';
import type { RawIslandNode, StructuralDocument, StructuralNode } from '../structure/index.js';

/**
 * Structural availability counters captured before any island materialization.
 *
 * @experimental Probe instrumentation shape for first-party parser/plugin
 * experiments. Do not treat as stable parser API while scanner-first work is
 * still being proven against the Less corpus and benchmarks.
 */
export type StructuralProbeSnapshot = {
  filePath: string;
  sourceBytes: number;
  structuralDiagnostics: number;
  islands: number;
  availableByIslandKind: Record<string, number>;
  availableByOwnerKind: Record<string, number>;
  structuralNodesByKind: Record<string, number>;
};

/**
 * Captures structural shape and available island counts without executing
 * providers. Compiler/plugin probes use this as a DRY, parser-owned guard so
 * each language package does not grow its own subtly different counters.
 *
 * @experimental Probe instrumentation helper for first-party parser/plugin
 * experiments. Do not treat as stable parser API while scanner-first work is
 * still being proven against the Less corpus and benchmarks.
 */
export function createStructuralProbeSnapshot(
  filePath: string,
  sourceBytes: number,
  plan: IslandParsePlan
): StructuralProbeSnapshot {
  const availableByIslandKind: Record<string, number> = {};
  const availableByOwnerKind: Record<string, number> = {};
  const structuralNodesByKind: Record<string, number> = {};

  collectStructuralNodeKinds(plan.document.root, structuralNodesByKind);
  for (const island of plan.document.islands()) {
    incrementCounter(availableByIslandKind, island.islandKind);
    incrementCounter(availableByOwnerKind, island.owner.kind);
  }

  return {
    filePath,
    sourceBytes,
    structuralDiagnostics: plan.document.diagnostics.length,
    islands: plan.document.islands().length,
    availableByIslandKind,
    availableByOwnerKind,
    structuralNodesByKind
  };
}

/**
 * Counts requested raw island kinds without triggering provider execution.
 *
 * @experimental Probe instrumentation helper for first-party parser/plugin
 * experiments. Do not treat as stable parser API while scanner-first work is
 * still being proven against the Less corpus and benchmarks.
 */
export function countRequestedIslandKinds(plan: IslandParsePlan): Record<string, number> {
  const counts: Record<string, number> = {};
  for (let id = 0; id < plan.counters.requestIds; id++) {
    incrementCounter(counts, plan.requestView(id).islandKind);
  }
  return counts;
}

/**
 * Counts requested raw island owner node kinds without triggering providers.
 *
 * @experimental Probe instrumentation helper for first-party parser/plugin
 * experiments. Do not treat as stable parser API while scanner-first work is
 * still being proven against the Less corpus and benchmarks.
 */
export function countRequestedOwnerKinds(plan: IslandParsePlan): Record<string, number> {
  const counts: Record<string, number> = {};
  const requestOwners = new Map<string, string>();
  for (const island of plan.document.islands()) {
    requestOwners.set(islandKey(island), island.owner.kind);
  }
  for (let id = 0; id < plan.counters.requestIds; id++) {
    const request = plan.requestView(id);
    const ownerKind = requestOwners.get(`${request.start}:${request.end}:${request.islandKind}`);
    if (ownerKind) {
      incrementCounter(counts, ownerKind);
    }
  }
  return counts;
}

/**
 * Converts structural diagnostics to line/column ranges only when probe output
 * needs human-facing reporting. Normal parser structures stay offset-first.
 *
 * @experimental Probe instrumentation helper for first-party parser/plugin
 * experiments. Do not treat as stable parser API while scanner-first work is
 * still being proven against the Less corpus and benchmarks.
 */
export function structuralDiagnosticRanges(document: StructuralDocument): Array<{
  code: string;
  start: number;
  end: number;
  line: number;
  column: number;
}> | undefined {
  if (document.diagnostics.length === 0) {
    return undefined;
  }
  return document.diagnostics.map((diagnostic) => {
    const position = document.source.offsetToLineColumn(diagnostic.start);
    return {
      code: diagnostic.code,
      start: diagnostic.start,
      end: diagnostic.end,
      line: position.line,
      column: position.column
    };
  });
}

function collectStructuralNodeKinds(
  node: StructuralNode,
  counter: Record<string, number>
): void {
  incrementCounter(counter, node.kind);
  if ('children' in node) {
    for (const child of node.children) {
      collectStructuralNodeKinds(child, counter);
    }
  }
}

function incrementCounter(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

function islandKey(island: RawIslandNode): string {
  return `${island.start}:${island.end}:${island.islandKind}`;
}
