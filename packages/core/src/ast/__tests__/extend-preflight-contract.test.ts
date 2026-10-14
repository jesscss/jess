import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PROFILE_KEY = '__JESS_EXTEND_PROFILE_COUNTERS__';

type CoreAst = typeof import('../nodes.js');
type Serialize = typeof import('../serialize.js')['serialize'];
type PrepareStaticImports = typeof import('../serialize.js')['prepareStaticImports'];

let ast: CoreAst;
let serialize: Serialize;
let prepareStaticImports: PrepareStaticImports;
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
  ({ serialize, prepareStaticImports } = await import('../serialize.js'));
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

  it('plans no imported document when the import graph has no extend', async () => {
    const imported = ast.stylesheet([ast.rule('.sm', [ast.decl('b', ast.color('red'))])]);
    const document = ast.stylesheet([
      ast.styleImport('@import', ast.quoted('"t.less"', 't.less', '"', false), { mode: 'import' }),
      ast.styleImport('@import', ast.quoted('"r.less"', 'r.less', '"', false), { mode: 'import', options: ast.list([ast.keyword('reference')], ',') }),
      ast.rule('.plain', [ast.decl('color', ast.color('red'))])
    ]);

    await expect(serialize(document, {
      importDocument: ({ specifier }) => ({ document: imported, key: specifier })
    })).resolves.toEqual({ css: '.sm {\n  b: red;\n}\n.plain {\n  color: red;\n}\n' });
    expect(counters['astExtend.preflight.importsVisited']).toBe(2);
    expect(counters['astExtend.preflight.importsFeatureBearing'] ?? 0).toBe(0);
    expect(counters['astExtend.plan.calls'] ?? 0).toBe(0);
  });

  it('plans and records nothing for an import inside a ruleset when the graph has no extend', async () => {
    /*
     * An `@import` inside a ruleset is a placement the walk owns, not an extend: a
     * graph with no `:extend()` plans no imported sheet and arms no walk recorder.
     */
    const big = ast.stylesheet(Array.from({ length: 50 }, (_, index) =>
      ast.rule(`.r${index}`, [ast.decl('a', ast.color('red'))])));
    const small = ast.stylesheet([ast.rule('.sm', [ast.decl('b', ast.color('red'))])]);
    const document = ast.stylesheet([
      ast.styleImport('@import', ast.quoted('"big.less"', 'big.less', '"', false), { mode: 'import' }),
      ast.rule('.wrap', [ast.styleImport('@import', ast.quoted('"t.less"', 't.less', '"', false), { mode: 'import' })])
    ]);

    const { css } = await serialize(document, {
      importDocument: ({ specifier }) => ({ document: specifier === 'big.less' ? big : small, key: specifier })
    });
    expect(css.endsWith('.wrap .sm {\n  b: red;\n}\n')).toBe(true);
    expect(counters['astExtend.preflight.importsFeatureBearing'] ?? 0).toBe(0);
    expect(counters['astExtend.plan.calls'] ?? 0).toBe(0);
    expect(counters['astExtend.documentHasExtend.calls']).toBe(1);
    expect(counters['astExtend.fold.recordedSubjects']).toBeUndefined();
  });

  /*
   * An extend-free document whose only import sits inside a ruleset: the sheet may hold
   * the graph's only extend, so the planner loads it before the walk and scans it once
   * (the walk reuses the loaded document). That one admission scan is the whole cost:
   * nothing is planned, the walk records nothing, and the import loads once.
   */
  it('scans a ruleset-placed sheet once, and plans and records nothing, when no sheet extends', async () => {
    const small = ast.stylesheet([ast.rule('.sm', [ast.decl('b', ast.color('red'))])]);
    const document = ast.stylesheet([
      ast.rule('.wrap', [ast.styleImport('@import', ast.quoted('"t.less"', 't.less', '"', false), { mode: 'import' })]),
      ast.rule('.a', [ast.decl('c', ast.color('red'))])
    ]);
    let loads = 0;

    const { css } = await serialize(document, {
      importDocument: ({ specifier }) => {
        loads++;
        return { document: small, key: specifier };
      }
    });
    expect(css).toBe('.wrap .sm {\n  b: red;\n}\n.a {\n  c: red;\n}\n');
    expect(loads).toBe(1);
    expect(counters['astExtend.preflight.noFeatureBypasses'] ?? 0).toBe(0);
    expect(counters['astExtend.preflight.bodyAdmissions']).toBe(1);
    expect(counters['astExtend.preflight.bodyNoFeatureMisses']).toBe(1);
    expect(counters['astExtend.preflight.importsFeatureBearing'] ?? 0).toBe(0);
    expect(counters['astExtend.plan.calls'] ?? 0).toBe(0);
    expect(counters['astExtend.fold.recordedSubjects']).toBeUndefined();
  });

  it('re-solves nothing when no rule a mixin call places can meet an extend target', () => {
    /*
     * The call arms the walk recorder (a placed rule could be a target), but `.p`
     * shares no atom with `.r1`, so the deferred fold keeps the static results.
     */
    const document = ast.stylesheet([
      ast.mixinDef('.m', [], [ast.rule('.p', [ast.decl('a', ast.color('red'))])]),
      ast.rule('.b', [ast.mixinCall('.m')]),
      ast.rule('.r1', [ast.decl('c', ast.color('red'))]),
      ast.rule('.x', [], [{ target: ast.selist(ast.sel('.r1')), partial: false }])
    ]);

    expect(serialize(document)).toEqual({ css: '.b .p {\n  a: red;\n}\n.r1,\n.x {\n  c: red;\n}\n' });
    expect(counters['astExtend.plan.calls']).toBe(1);
    expect(counters['astExtend.fold.recordedSubjects']).toBe(1);
    expect(counters['astExtend.fold.keptSubjects']).toBe(0);
  });

  it('reserves no hidden reference rule when no walk-recorded extend can reveal it', async () => {
    /*
     * A static extend's effect on `(reference)` rules is known before the walk, so a
     * mixin that arms the recorder without an extend of its own reveals nothing.
     */
    const referenced = ast.stylesheet(Array.from({ length: 50 }, (_, index) =>
      ast.rule(`.v${index}`, [ast.decl('a', ast.color('red'))])));
    const document = ast.stylesheet([
      ast.styleImport('@import', ast.quoted('"r.less"', 'r.less', '"', false), {
        mode: 'import', options: ast.list([ast.keyword('reference')], ',')
      }),
      ast.rule('.x', [], [{ target: ast.selist(ast.sel('.v5')), partial: false }]),
      ast.mixinDef('.m', [], [ast.rule('.q', [ast.decl('b', ast.color('red'))])]),
      ast.mixinCall('.m')
    ]);

    await expect(serialize(document, {
      importDocument: ({ specifier }) => ({ document: referenced, key: specifier })
    })).resolves.toEqual({ css: '.x {\n  a: red;\n}\n.q {\n  b: red;\n}\n' });
    expect(counters['astExtend.preflight.revealRules'] ?? 0).toBe(0);
    expect(counters['astExtend.plan.calls']).toBe(1);
  });

  it('plans no extend facts while only preparing imports', async () => {
    /*
     * The prepare pass loads the import graph for a later render and discards its
     * own overlay; the render plans the extend facts once.
     */
    const imported = ast.stylesheet([ast.rule('.sm', [ast.decl('b', ast.color('red'))])]);
    const document = ast.stylesheet([
      ast.styleImport('@import', ast.quoted('"t.less"', 't.less', '"', false), { mode: 'import' }),
      ast.rule('.x', [], [{ target: ast.selist(ast.sel('.sm')), partial: false }])
    ]);

    await prepareStaticImports(document, {
      importDocument: ({ specifier }) => ({ document: imported, key: specifier })
    });
    expect(counters['astExtend.preflight.importsVisited']).toBe(1);
    expect(counters['astExtend.preflight.importsFeatureBearing'] ?? 0).toBe(0);
    expect(counters['astExtend.plan.subjects'] ?? 0).toBe(0);
  });

  it('folds an imported-loop extend through the one render walk (no cold preflight)', async () => {
    /*
     * An imported `$for`/`each()` loop body is a DYNAMIC placement: the static import
     * preflight cannot resolve its iterations, so its `:extend()` facts are recorded by
     * the ONE render walk and folded into the target header by the deferred rewrite
     * (ledger X12 / EXTEND-SEMANTICS §1a). This SUPERSEDES the reverted cold-twin
     * preflight that re-evaluated the loop to pre-collect an overlay.
     */
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

    // The extenders `.from-one` / `.from-two` fold onto `.target` via the deferred rewrite.
    await expect(serialize(document, {
      importDocument: ({ specifier }) => specifier === 'loop.less' ? { document: imported, key: 'loop.less' } : undefined
    })).resolves.toEqual({ css: '.target,\n.from-one,\n.from-two {\n  color: red;\n}\n' });

    // The static import preflight still runs and admits the feature-bearing import…
    expect(counters['astExtend.preflight.importsVisited']).toBe(1);
    expect(counters['astExtend.preflight.importsFeatureBearing']).toBe(1);

    // …but the cold re-evaluating loop preflight is GONE — no loop-placement overlay is
    // pre-collected (the tell of a second evaluation pass).
    expect(counters['astExtend.preflight.collectCalls'] ?? 0).toBe(0);
    expect(counters['astExtend.preflight.loopBodies'] ?? 0).toBe(0);
    expect(counters['astExtend.preflight.loopPlacements'] ?? 0).toBe(0);
    expect(counters['astExtend.preflight.overlaySubjects'] ?? 0).toBe(0);
    expect(counters['astExtend.preflight.overlayInstructions'] ?? 0).toBe(0);
  });
});
