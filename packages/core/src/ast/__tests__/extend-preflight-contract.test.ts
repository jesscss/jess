import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PROFILE_KEY = '__JESS_EXTEND_PROFILE_COUNTERS__';

type CoreAst = typeof import('../nodes.js');
type Serialize = typeof import('../serialize.js')['serialize'];

let ast: CoreAst;
let serialize: Serialize;
let counters: Record<string, number>;

/*
 * Install the profile bag and import core ONCE (see extend-op-budget.test.ts for
 * why): the recorder captures the bag by reference at import time, so per-test
 * we only clear the same object in place — no per-test graph re-import.
 */
beforeAll(async () => {
  vi.resetModules();
  counters = {};
  (globalThis as typeof globalThis & { [PROFILE_KEY]?: Record<string, number> })[PROFILE_KEY] = counters;
  ast = await import('../nodes.js');
  ({ serialize } = await import('../serialize.js'));
});

beforeEach(() => {
  for (const key of Object.keys(counters)) {
    delete counters[key];
  }
});

afterAll(() => {
  delete (globalThis as typeof globalThis & { [PROFILE_KEY]?: Record<string, number> })[PROFILE_KEY];
});

describe('AST extend preflight cost contract', () => {
  it('bypasses all selector-plan and overlay allocation on a no-extend document', () => {
    const document = ast.stylesheet([
      ast.rule('.plain', [ast.decl('color', ast.color('red'))])
    ]);

    expect(serialize(document)).toEqual({ css: '.plain {\n  color: red;\n}\n' });
    expect(counters['astExtend.preflight.calls']).toBe(1);
    expect(counters['astExtend.documentHasExtend.noFeatureMisses']).toBeGreaterThan(0);
    expect(counters['astExtend.preflight.noFeatureBypasses']).toBe(1);
    expect(counters['astExtend.plan.calls'] ?? 0).toBe(0);
    expect(counters['astExtend.plan.subjects'] ?? 0).toBe(0);
    expect(counters['astExtend.plan.instructions'] ?? 0).toBe(0);
    expect(counters['astExtend.preflight.collectCalls'] ?? 0).toBe(0);
    expect(counters['astExtend.preflight.overlaySubjects'] ?? 0).toBe(0);
    expect(counters['astExtend.preflight.overlayInstructions'] ?? 0).toBe(0);
    expect(counters['astExtend.preflight.loopPlacements'] ?? 0).toBe(0);
  });

  it('records only concrete imported-loop placements and their typed IR facts', async () => {
    const loopSelector = ast.complexSelector([{
      term: ast.compoundSelectorOf([ast.interpolatedSimpleSelector(ast.interpolation([
        { lit: '.from-' }, { ref: ast.variableReference('name', 'scoped'), unquote: true }
      ]))])
    }]);
    const imported = ast.stylesheet([
      ast.forNode(
        ast.spaced([ast.keyword('one'), ast.keyword('two')]),
        [ast.rule(loopSelector, [], [{ target: ast.selist(ast.sel('.target')), partial: true }])],
        { kind: 'single', name: 'name' }
      )
    ]);
    const document = ast.stylesheet([
      ast.styleImport('@import', ast.quoted('"loop.less"', 'loop.less', '"', false), { mode: 'import' }),
      ast.rule('.target', [ast.decl('color', ast.color('red'))], [{ target: ast.selist(ast.sel('.does-not-match')), partial: true }])
    ]);

    await expect(serialize(document, {
      importDocument: ({ specifier }) => specifier === 'loop.less' ? { document: imported, key: 'loop.less' } : undefined
    })).resolves.toEqual({ css: '.target,\n.from-one,\n.from-two {\n  color: red;\n}\n' });

    expect(counters['astExtend.preflight.importsVisited']).toBe(1);
    expect(counters['astExtend.preflight.importsFeatureBearing']).toBe(1);
    expect(counters['astExtend.preflight.loopBodies']).toBe(1);
    expect(counters['astExtend.preflight.loopPlacements']).toBe(2);
    expect(counters['astExtend.preflight.overlaySubjects']).toBe(2);
    expect(counters['astExtend.preflight.overlayInstructions']).toBe(2);
    expect(counters['astExtend.plan.overlaySubjects']).toBe(2);
    expect(counters['astExtend.plan.overlayInstructions']).toBe(2);
  });
});
