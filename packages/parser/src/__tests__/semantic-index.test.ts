import { describe, expect, test } from 'vitest';
import {
  IslandParsePlan,
  SemanticIndexBuilder,
  SourceText,
  parseStructure
} from '../index.js';
import { fixtureLessProfile, fixtureScssProfile } from './fixtures.js';

describe('SemanticIndexBuilder', () => {
  test('indexes imports and variables structurally without materialization', () => {
    const document = parseStructure(
      new SourceText('@import "theme.css"; @brand: #f00; .foo { color: @brand; }', {
        version: 1
      }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);
    const index = new SemanticIndexBuilder(document, plan);

    expect(index.imports()).toEqual([
      expect.objectContaining({ specifier: 'theme.css' })
    ]);
    // AUDIT: this is fine as Less structure. Note that in the Jess AST, variables are not represented with the preceding `@`,
    // nor are Sass variables represented with the preceding `$`.
    // That doesn't mean this needs to change, I just wanted to note it as cautionary.
    expect(index.variables()).toEqual([
      expect.objectContaining({ name: '@brand' })
    ]);
    expect(plan.counters.actualParses).toBe(0);
    expect(index.counters).toMatchObject({
      structuralIndexBuilds: 2,
      importCount: 1,
      variableCount: 1
    });
  });

  test('indexes mixins structurally and issues lazy signature requests only for mixin nodes', () => {
    const document = parseStructure('.mixin(@x) { color: @x; } .foo { .mixin(red); }', fixtureLessProfile);
    const plan = new IslandParsePlan(document);
    const index = new SemanticIndexBuilder(document, plan);
    const mixins = index.mixins();

    expect(mixins.map(mixin => mixin.name)).toEqual([
      '.mixin(@x)',
      '.mixin(red)'
    ]);
    expect(mixins.every(mixin => mixin.requestIds.length >= 1)).toBe(true);
    expect(plan.counters.requestIds).toBeGreaterThan(0);
    expect(plan.counters.actualParses).toBe(0);
  });

  test('keeps lazy index caches separated by target shape', () => {
    const document = parseStructure(
      '.mixin(@x) { color: @x; } .foo:extend(.bar) { color: @brand; .mixin(red); }',
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);
    const index = new SemanticIndexBuilder(document, plan);

    const mixinCore = index.mixins('core-mixin');
    const mixinAdapter = index.mixins('adapter-mixin');
    const extendCore = index.extendCandidates('core-selector');
    const extendAdapter = index.extendCandidates('adapter-selector');
    const referenceCore = index.references('core-value');
    const referenceAdapter = index.references('adapter-value');

    expect(mixinAdapter).not.toBe(mixinCore);
    expect(extendAdapter).not.toBe(extendCore);
    expect(referenceAdapter).not.toBe(referenceCore);
    expect(plan.requestView(mixinCore[0]!.requestIds[0]!)).toMatchObject({ targetShape: 'core-mixin' });
    expect(plan.requestView(mixinAdapter[0]!.requestIds[0]!)).toMatchObject({ targetShape: 'adapter-mixin' });
    expect(plan.requestView(extendCore[0]!.requestId)).toMatchObject({ targetShape: 'core-selector' });
    expect(plan.requestView(extendAdapter[0]!.requestId)).toMatchObject({ targetShape: 'adapter-selector' });
    expect(plan.requestView(referenceCore[0]!.requestId)).toMatchObject({ targetShape: 'core-value' });
    expect(plan.requestView(referenceAdapter[0]!.requestId)).toMatchObject({ targetShape: 'adapter-value' });
    expect(plan.counters.actualParses).toBe(0);
  });

  test('indexes Less extend candidates from selector/header islands lazily', () => {
    const document = parseStructure('.foo:extend(.bar) { color: red; }', fixtureLessProfile);
    const plan = new IslandParsePlan(document);
    const index = new SemanticIndexBuilder(document, plan);
    const extendCandidates = index.extendCandidates();

    expect(extendCandidates).toEqual([
      expect.objectContaining({
        island: expect.objectContaining({
          islandKind: 'extend-candidate',
          start: 0,
          end: 17
        }),
        requestId: 0
      })
    ]);
    expect(plan.counters.actualParses).toBe(0);
    expect(index.counters).toMatchObject({
      lazyIndexFills: 1,
      extendCandidateCount: 1
    });
  });

  test('indexes references by requesting value islands only when reference-like syntax exists', () => {
    const document = parseStructure('.foo { color: @brand; width: 1px; }', fixtureLessProfile);
    const plan = new IslandParsePlan(document);
    const index = new SemanticIndexBuilder(document, plan);

    expect(index.references()).toEqual([
      expect.objectContaining({
        island: expect.objectContaining({
          islandKind: 'variable-reference',
          start: 14,
          end: 20
        }),
        requestId: expect.any(Number)
      })
    ]);
    expect(plan.counters.requestIds).toBe(1);
    expect(plan.counters.actualParses).toBe(0);
  });

  test('keeps SCSS include/reference indexing demand-driven', () => {
    const document = parseStructure('$color: red; .foo { @include reset; color: #{$color}; }', fixtureScssProfile);
    const plan = new IslandParsePlan(document);
    const index = new SemanticIndexBuilder(document, plan);

    expect(index.variables()).toEqual([
      expect.objectContaining({ name: '$color' })
    ]);
    expect(index.mixins().map(mixin => mixin.name)).toEqual(['@include']);
    expect(index.references()).toEqual([
      expect.objectContaining({
        island: expect.objectContaining({ islandKind: 'variable-reference' })
      })
    ]);
    expect(plan.counters.actualParses).toBe(0);
  });
});
