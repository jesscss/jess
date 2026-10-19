import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
const AST_DIR = fileURLToPath(new URL('../../', import.meta.url));

/* Every source file under `dir`, at any depth, tests excluded. */
function sourcesUnder(dir: string): Array<{ name: string; text: string }> {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter(name => name.endsWith('.ts') && !name.includes('__tests__'))
    .map(name => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
}

/* The serializer: `serialize.ts` and, once it is split, every module under `serialize/`. */
function serializerSource(): string {
  return [readFileSync(join(AST_DIR, 'serialize.ts'), 'utf8'), ...sourcesUnder(join(AST_DIR, 'serialize')).map(s => s.text)].join('\n');
}

describe('extend consumes resolved static shapes (evaluator isolation)', () => {
  it('the extend engine never names an evaluator entrypoint', () => {
    expect(sourcesUnder(EXTEND_DIR).map(s => s.name)).toEqual(expect.arrayContaining(['emit.ts', 'match.ts']));
    const offenders: string[] = [];
    for (const { name, text } of sourcesUnder(EXTEND_DIR)) {
      for (const entry of EVALUATOR_ENTRYPOINTS) {
        if (new RegExp(`\\b${entry}\\b`, 'u').test(text)) {
          offenders.push(`${name} → ${entry}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the serializer has no cold extend-placement preflight (collectPlacedExtendFacts deleted)', () => {
    const source = serializerSource();

    // The banned cold twin and any near-clone that re-walks to collect extend facts.
    expect(source).not.toContain('collectPlacedExtendFacts');
    expect(/function\s+\w*[Cc]ollect\w*ExtendFacts\s*\(/u.test(source)).toBe(false);
    expect(/function\s+\w*[Pp]review\w*Extend\w*\s*\(/u.test(source)).toBe(false);
  });
});
