/**
 * RUNG 8 SWEEP SINK — differential capture over the WHOLE reachable extend corpus.
 *
 * Installed as a vitest global setup (see sweep vitest config). When installed, the oracle
 * (`extendSelector`) routes every TOP-LEVEL reachable tuple through this sink (the guarded hook in
 * `util/extend.ts`). For each tuple the sink:
 *   1. runs the (pure) own engine `extendByIndexOwn` on the pristine input nodes and captures its
 *      result string EAGERLY;
 *   2. invokes the oracle thunk (real walk, same nodes) and captures its result string;
 *   3. classifies own-PASS / UNSUPPORTED / NOT_FOUND / EXPECTED-DIVERGENCE (MISMATCH → walk-bug
 *      candidate) and accumulates a de-duplicated record.
 * On process exit the accumulated records are written to SWEEP_OUT for offline analysis.
 *
 * This file is test-only; it is NOT exported from index.ts, so the bundle stays clean.
 */
import { extendByIndexOwn, UNSUPPORTED } from '../extend-index.js';
import { appendFileSync } from 'node:fs';
import { expect as vitestExpect } from 'vitest';

type Surface = Parameters<typeof extendByIndexOwn>[0];
type Sel = Parameters<typeof extendByIndexOwn>[1];

interface SweepRecord {
  target: string;
  find: string;
  extendWith: string;
  partial: boolean;
  oracle: string;
  own: string;
  status: 'own-pass' | 'unsupported' | 'not-found-both' | 'divergence';
  count: number;
  /** Best-effort originating test (file basename ± test name) — distinguishes render vs unit-call. */
  origin: string;
}

/** Read the current vitest test context (file + name) without modifying any test file. */
function currentOrigin(): string {
  try {
    const state = vitestExpect.getState();
    if (state) {
      const file = state.testPath ? state.testPath.split('/').pop() : '?';
      return `${file}::${state.currentTestName ?? '?'}`;
    }
  } catch {
    /* ignore */
  }
  return '?';
}

function str(v: unknown): string {
  if (v === UNSUPPORTED) {
    return 'UNSUPPORTED';
  }
  if (typeof v === 'string') {
    return v;
  }
  if (Array.isArray(v)) {
    return v.map(s => String(s)).join(',');
  }
  return String(v);
}

const records = new Map<string, SweepRecord>();

function classify(ownStr: string, oracleStr: string): SweepRecord['status'] {
  if (ownStr === 'UNSUPPORTED') {
    return 'unsupported';
  }
  if (ownStr === oracleStr) {
    return oracleStr === 'NOT_FOUND' ? 'not-found-both' : 'own-pass';
  }
  return 'divergence';
}

interface NodeLike {
  parent: unknown;
}

/** Recursively snapshot every node's `.parent` in an input tree (so the own run can be undone). */
function snapshotParents(v: unknown, out: Array<[NodeLike, unknown]>, seen: Set<unknown>): void {
  if (v === null || typeof v !== 'object' || seen.has(v)) {
    return;
  }
  seen.add(v);
  if (Array.isArray(v)) {
    for (const item of v) {
      snapshotParents(item, out, seen);
    }
    return;
  }
  if ('parent' in v) {
    out.push([v, v.parent]);
  }
  // Follow every object-valued own property (bounded by `seen`) so container references the own
  // engine may reparent through — e.g. an Ampersand's `_selectorContainer.selector` graft parent —
  // are also snapshotted. `parent` itself is skipped to avoid walking back UP the tree.
  for (const key of Object.keys(v)) {
    if (key === 'parent') {
      continue;
    }
    snapshotParents(Reflect.get(v, key), out, seen);
  }
}

const sink = (
  target: Surface,
  find: Sel,
  extendWith: Sel,
  partial: boolean,
  oracleThunk: () => unknown
): unknown => {
  // Own engine runs FIRST on the live pristine nodes. It is STRING-pure but constructs output by
  // reusing/reparenting input atom nodes, which would perturb `.parent` pointers the oracle's
  // node-identity tests assert on. So snapshot every input node's `.parent` before the run and
  // RESTORE after — the own run becomes fully transparent to the oracle. Its output string is
  // captured EAGERLY (immune to the oracle's subsequent mutation of shared nodes anyway).
  const parentSnap: Array<[NodeLike, unknown]> = [];
  const seen = new Set<unknown>();
  snapshotParents(target, parentSnap, seen);
  snapshotParents(find, parentSnap, seen);
  snapshotParents(extendWith, parentSnap, seen);
  let ownStr: string;
  try {
    ownStr = str(extendByIndexOwn(target, find, extendWith, partial));
  } catch (err) {
    ownStr = `THREW:${err instanceof Error ? err.message : String(err)}`;
  } finally {
    for (const [node, parent] of parentSnap) {
      node.parent = parent;
    }
  }
  const oracleResult = oracleThunk();
  const oracleStr = str(oracleResult);

  const targetStr = str(target);
  const findStr = str(find);
  const extendWithStr = str(extendWith);
  const key = `${partial ? 1 : 0}|${targetStr}|${findStr}|${extendWithStr}`;
  const existing = records.get(key);
  if (existing) {
    existing.count += 1;
  } else {
    const rec: SweepRecord = {
      target: targetStr,
      find: findStr,
      extendWith: extendWithStr,
      partial,
      oracle: oracleStr,
      own: ownStr,
      status: classify(ownStr, oracleStr),
      count: 1,
      origin: currentOrigin()
    };
    records.set(key, rec);
    // Append the NEW distinct tuple immediately (JSONL) — vitest fork workers do not reliably fire
    // 'exit'/'beforeExit', so we never rely on a final flush. `count` is 1 here (re-hits skipped).
    appendRecord(rec);
  }
  return oracleResult;
};

Object.assign(globalThis, { ['__EXTEND_INDEX_SWEEP__']: sink });

const outFile = process.env.SWEEP_OUT;
// NOTE: do NOT truncate on module load — vitest reloads setup files per test file, which would
// wipe earlier files' records. The runner truncates SWEEP_OUT once before the run; we only append.
function appendRecord(rec: SweepRecord): void {
  if (outFile) {
    appendFileSync(outFile, JSON.stringify(rec) + '\n');
  }
}
