import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PROFILE_COUNTERS_KEY = '__JESS_DIRECT_LOOKUP_PROFILE_COUNTERS__';

describe('direct declaration lookup profiling', () => {
  let counters: Record<string, number>;

  beforeEach(() => {
    counters = {};
    Object.defineProperty(globalThis, PROFILE_COUNTERS_KEY, {
      configurable: true,
      value: counters
    });
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[PROFILE_COUNTERS_KEY];
  });

  it('splits cache misses by strategy and records entered child outcomes', async () => {
    const [
      { Context },
      { any, decl, rules, vardecl },
      {
        findAnyDeclarationOccurrence,
        findPropertyDeclarationOccurrence,
        findVariableDeclarationOccurrence
      }
    ] = await Promise.all([
      import('../../../context.js'),
      import('../../index.js'),
      import('../direct-rules-lookup.js')
    ]);
    const makeRoot = async (child: ReturnType<typeof rules>) => {
      const root = rules([child]);
      await root.eval(new Context());
      return root;
    };
    const publicRoot = await makeRoot(rules([
      decl({ name: 'public-hit', value: any('1') })
    ], { rulesVisibility: { Declaration: 'public' } }));
    const optionalRoot = await makeRoot(rules([
      decl({ name: 'optional-hit', value: any('1') })
    ], { rulesVisibility: { Declaration: 'optional' } }));
    const missRoot = await makeRoot(rules([
      decl({ name: 'other', value: any('1') })
    ], { rulesVisibility: { Declaration: 'public' } }));
    const variableRoot = await makeRoot(rules([
      vardecl({ name: 'variable-hit', value: any('1') })
    ], { rulesVisibility: { VarDeclaration: 'public' } }));
    const anyRoot = await makeRoot(rules([
      decl({ name: 'any-hit', value: any('1') })
    ], { rulesVisibility: { Declaration: 'public' } }));

    expect(findPropertyDeclarationOccurrence(publicRoot, 'public-hit', { searchParents: false })).toBeDefined();
    expect(findPropertyDeclarationOccurrence(optionalRoot, 'optional-hit', { searchParents: false })).toBeUndefined();
    expect(findPropertyDeclarationOccurrence(missRoot, 'missing', { searchParents: false })).toBeUndefined();
    expect(findVariableDeclarationOccurrence(variableRoot, 'variable-hit', { searchParents: false })).toBeDefined();
    expect(findAnyDeclarationOccurrence(anyRoot, 'any-hit', { searchParents: false })).toBeDefined();

    for (const event of [
      'declaration.cacheMiss.v',
      'declaration.cacheMiss.p',
      'declaration.cacheMiss.d',
      'declaration.childEntryPublicHit',
      'declaration.childEntryOptionalHit',
      'declaration.childEntryMiss'
    ]) {
      expect(counters[event]).toBeGreaterThan(0);
    }
  });
});
