import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * [extend/isolation] Source-frontier gate for ledger X12 / EXTEND-SEMANTICS §1a:
 * extend consumes RESOLVED STATIC SHAPES and never re-drives evaluation. This test
 * fails if the extend engine (or a resurrected extend "preflight" in serialize.ts)
 * names an evaluator entrypoint — the mechanical signature of a cold second pass.
 *
 * The evaluator entrypoints are internal to serialize.ts (not exported), so the
 * extend engine cannot legitimately call them; naming one is the tell that someone
 * re-introduced a mixin/loop/selector re-evaluation to discover extend placements.
 */
const EVALUATOR_ENTRYPOINTS = [
  'expandCall',
  'expandApply',
  'expandReferenceCall',
  'expandFor',
  'expandRule',
  'forItems',
  'bindForEntry',
  'activateVariableDeclaration'
] as const;

const EXTEND_DIR = fileURLToPath(new URL('../', import.meta.url));
const SERIALIZE_PATH = fileURLToPath(new URL('../../serialize.ts', import.meta.url));

function extendEngineSources(): Array<{ name: string; text: string }> {
  return readdirSync(EXTEND_DIR)
    .filter(name => name.endsWith('.ts'))
    .map(name => ({ name, text: readFileSync(new URL(`../${name}`, import.meta.url), 'utf8') }));
}

describe('extend consumes resolved static shapes (evaluator isolation)', () => {
  it('the extend engine never names an evaluator entrypoint', () => {
    const offenders: string[] = [];
    for (const { name, text } of extendEngineSources()) {
      for (const entry of EVALUATOR_ENTRYPOINTS) {
        if (new RegExp(`\\b${entry}\\b`, 'u').test(text)) {
          offenders.push(`${name} → ${entry}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('serialize.ts has no cold extend-placement preflight (collectPlacedExtendFacts deleted)', () => {
    const source = readFileSync(SERIALIZE_PATH, 'utf8');
    // The banned cold twin and any near-clone that re-walks to collect extend facts.
    expect(source).not.toContain('collectPlacedExtendFacts');
    expect(/function\s+\w*[Cc]ollect\w*ExtendFacts\s*\(/u.test(source)).toBe(false);
    expect(/function\s+\w*[Pp]review\w*Extend\w*\s*\(/u.test(source)).toBe(false);
  });
});
