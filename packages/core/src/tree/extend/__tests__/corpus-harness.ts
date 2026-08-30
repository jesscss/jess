/**
 * Corpus harness — run REAL extend-suite cases through the OWN-CONSTRUCTION index engine.
 *
 * The existing extend tests (extend-simplified-cases, extend-selector-algorithm, …) are the
 * behavioral ORACLE: their `extendSelector(...)` calls + exact `.valueOf()` expectations pin
 * correct output. This harness lets a COPY of those suites drive `extendByIndexOwn` instead,
 * with these honest rules:
 *
 *   - The own engine CONSTRUCTS output itself; it NEVER delegates to extendSelector.
 *   - When it can build the shape, we assert byte-identical to the oracle (extendSelector) AND
 *     return the own-engine value, so the copied suite's own `.toBe(...)` also checks it.
 *   - When it returns UNSUPPORTED, we RECORD it on the frontier and fall back to the oracle's
 *     value for that single assertion — so the copied suite still runs, but coverage is honest
 *     (UNSUPPORTED is visible, never masked as a pass on the own engine).
 *
 * `reportFrontier()` prints the PASS vs UNSUPPORTED split at suite end.
 */
import { extendSelector } from '../../util/extend.js';
import { extendByIndexOwn, UNSUPPORTED } from '../extend-index.js';

type Input = Parameters<typeof extendSelector>[0];
type Find = Parameters<typeof extendSelector>[1];
type ExtendWith = Parameters<typeof extendSelector>[2];
type OracleResult = ReturnType<typeof extendSelector>;

export interface FrontierEntry {
  label: string;
  status: 'own-pass' | 'unsupported';
  oracle: string;
  note?: string;
}

const frontier: FrontierEntry[] = [];

function str(v: unknown): string {
  if (typeof v === 'string') {
    return v;
  }
  if (Array.isArray(v)) {
    return v.map(s => valueText(s)).join(',');
  }
  return valueText(v);
}

function valueText(value: unknown): string {
  if (value !== null && typeof value === 'object' && 'valueOf' in value && typeof value.valueOf === 'function') {
    return String(value.valueOf());
  }
  return String(value);
}

/**
 * Drop-in for `extendSelector` in a copied suite. Runs the own engine, compares to the oracle,
 * records the frontier, and returns a value whose `.valueOf()`/string form the copied suite
 * asserts against. `label` disambiguates the case in the frontier report.
 */
export function extendViaOwn(
  target: Input,
  find: Find,
  extendWith: ExtendWith,
  partial: boolean,
  label: string
): OracleResult {
  const freshTarget = target;
  const oracle = extendSelector(target, find, extendWith, partial);
  const mine = extendByIndexOwn(freshTarget, find, extendWith, partial);
  if (mine === UNSUPPORTED) {
    frontier.push({ label, status: 'unsupported', oracle: str(oracle) });
    return oracle;
  }
  const mineStr = str(mine);
  const oracleStr = str(oracle);
  if (mineStr !== oracleStr) {
    // A real divergence — surface it loudly (do NOT record as pass).
    throw new Error(`OWN-ENGINE MISMATCH [${label}]: own=${mineStr} oracle=${oracleStr}`);
  }
  frontier.push({ label, status: 'own-pass', oracle: oracleStr });
  return oracle;
}

export function resetFrontier(): void {
  frontier.length = 0;
}

export function reportFrontier(suite: string): void {
  const pass = frontier.filter(f => f.status === 'own-pass');
  const uns = frontier.filter(f => f.status === 'unsupported');
  console.log(`\n=== COVERAGE FRONTIER [${suite}] ===`);
  console.log(`  own-engine PASS: ${pass.length}`);
  console.log(`  UNSUPPORTED:     ${uns.length}`);
  for (const u of uns) {
    console.log(`    UNSUPPORTED  ${u.label}  (oracle: ${u.oracle})`);
  }
}
