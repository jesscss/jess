import { describe, expect, test } from 'vitest';
import {
  SourceText,
  createParserDiagnostic,
  parseStructure
} from '../index.js';
import {
  IslandParsePlan,
  IslandParserRegistry,
  LanguageActivationRegistry,
  VisitorMethodTableCache,
  countRequestedIslandKinds,
  countRequestedOwnerKinds,
  createStructuralProbeSnapshot,
  providerKey,
  stableConfigKey,
  structuralDiagnosticRanges,
  visitorShapeFromMethods
} from '../services/index.js';
import { fixtureLessProfile, fixtureProfile } from './fixtures.js';

describe('IslandParsePlan', () => {
  test('returns stable request ids and exposes request views lazily', () => {
    const document = parseStructure(
      new SourceText('.foo { color: @brand; }', { version: 3 }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);
    const island = document.islands('variable-reference')[0]!;

    const first = plan.requestIsland(island, 'core-value', { mathMode: 'always' });
    const second = plan.requestIsland(island, 'core-value', { mathMode: 'always' });

    expect(second).toBe(first);
    expect(plan.counters.requestIds).toBe(1);
    expect(plan.counters.requestViews).toBe(0);
    expect(plan.requestView(first)).toMatchObject({
      id: first,
      language: 'fixture-less',
      islandKind: 'variable-reference',
      targetShape: 'core-value',
      sourceVersion: '3',
      start: island.start,
      end: island.end
    });
    expect(plan.counters.requestViews).toBe(1);
  });

  test('request views round-trip delimiter-looking cache fields', () => {
    const document = parseStructure(
      // AUDIT: version? Needed because?
      new SourceText('.foo { color: @brand; }', { version: 'draft|7' }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);
    const island = document.islands('variable-reference')[0]!;
    const id = plan.requestIsland(island, 'core|value', { mode: 'a|b' });

    expect(plan.requestView(id)).toMatchObject({
      id,
      language: 'fixture-less',
      islandKind: 'variable-reference',
      targetShape: 'core|value',
      parserConfigKey: { mode: 'a|b' },
      sourceVersion: 'draft|7',
      start: island.start,
      end: island.end
    });
  });

  test('executes providers once and then serves cached records', () => {
    const document = parseStructure(
      new SourceText('.foo { color: @brand; }', { version: 1 }),
      fixtureLessProfile
    );
    const registry = new IslandParserRegistry();
    let calls = 0;
    registry.register(
      providerKey('fixture-less', 'variable-reference', 'core-value', {
        mathMode: 'always'
      }),
      (context) => {
        calls++;
        return {
          value: context.document.source.slice(context.island.start, context.island.end)
        };
      }
    );
    const plan = new IslandParsePlan(document, registry);
    const island = document.islands('variable-reference')[0]!;
    const id = plan.requestIsland(island, 'core-value', { mathMode: 'always' });

    expect(plan.execute(id)).toMatchObject({
      requestId: id,
      value: '@brand',
      diagnostics: [],
      fallbackFullTree: false
    });
    expect(plan.execute(id).value).toBe('@brand');
    expect(calls).toBe(1);
    expect(plan.counters).toMatchObject({
      cacheHits: 1,
      cacheMisses: 1,
      actualParses: 1,
      promotedBytes: 6
    });
  });

  test('caches execution diagnostics separately from thrown exceptional failures', () => {
    const document = parseStructure(
      new SourceText('.foo { color: @brand; }', { version: 1 }),
      fixtureLessProfile
    );
    const registry = new IslandParserRegistry();
    registry.register(providerKey('fixture-less', 'variable-reference', 'core-value'), () => ({
      diagnostics: [
        createParserDiagnostic({
          code: 'mock-diagnostic',
          message: 'Mock diagnostic.',
          start: 14,
          end: 20,
          context: 'test'
        })
      ]
    }));
    const plan = new IslandParsePlan(document, registry);
    const id = plan.requestIsland(document.islands('variable-reference')[0]!, 'core-value');

    const record = plan.execute(id);

    expect(record.diagnostics).toEqual([
      expect.objectContaining({ code: 'mock-diagnostic' })
    ]);
    expect(plan.diagnosticsFor(id)).toEqual(record.diagnostics);
  });

  test('records fallback full-tree materialization when no provider is registered', () => {
    const document = parseStructure(
      new SourceText('.foo { color: @brand; }', { version: 1 }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);
    const id = plan.requestIsland(document.islands('variable-reference')[0]!, 'core-value');

    expect(plan.execute(id)).toMatchObject({
      requestId: id,
      diagnostics: [],
      fallbackFullTree: true
    });
    expect(plan.counters).toMatchObject({
      fallbackFullTreeMaterializations: 1,
      actualParses: 0
    });
  });

  test('requestNode returns island request ids without parsing siblings', () => {
    const document = parseStructure(
      new SourceText('.foo { color: @brand; width: 1px; }', { version: 1 }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);
    const variableIsland = document.islands('variable-reference')[0]!;

    const ids = plan.requestNode(variableIsland.owner, 'core-value');

    expect(ids).toContain(plan.requestIsland(variableIsland, 'core-value'));
    expect(ids).toHaveLength(2);
    expect(plan.counters.actualParses).toBe(0);
  });

  test('summarizes structural probe availability and requests without executing providers', () => {
    const document = parseStructure(
      new SourceText('.foo { color: @brand; width: 1px; }', { filePath: 'fixture.less', version: 1 }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);

    const snapshot = createStructuralProbeSnapshot('fixture.less', document.source.length, plan);
    expect(snapshot).toMatchObject({
      filePath: 'fixture.less',
      sourceBytes: document.source.length,
      structuralDiagnostics: 0,
      islands: 4,
      availableByOwnerKind: {
        rule: 1,
        declaration: 3
      },
      structuralNodesByKind: {
        document: 1,
        rule: 1,
        declaration: 2
      }
    });
    expect(snapshot.availableByIslandKind.selector).toBe(1);
    expect(snapshot.availableByIslandKind['declaration-value']).toBe(2);
    expect(snapshot.availableByIslandKind['variable-reference']).toBe(1);

    const variableIsland = document.islands('variable-reference')[0]!;
    plan.requestIsland(variableIsland, 'core-value');

    const requestedIslandKinds = countRequestedIslandKinds(plan);
    expect(requestedIslandKinds['variable-reference']).toBe(1);
    expect(countRequestedOwnerKinds(plan)).toEqual({
      declaration: 1
    });
    expect(plan.counters.actualParses).toBe(0);
    expect(structuralDiagnosticRanges(document)).toBeUndefined();
  });

  test('visitor planning does not promote the whole tree', () => {
    const document = parseStructure(
      new SourceText('.foo { color: @brand; }', { version: 1 }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);

    expect(
      plan.planVisitor({
        nodeKinds: ['declaration'],
        islandKinds: ['variable-reference'],
        targetShape: 'visitor-node'
      })
    ).toEqual([
      {
        nodeKind: 'declaration',
        islandKinds: ['variable-reference'],
        targetShape: 'visitor-node'
      }
    ]);
    expect(plan.counters).toMatchObject({
      visitorPlans: 1,
      visitorPlanCacheMisses: 1,
      actualParses: 0,
      fallbackFullTreeMaterializations: 0
    });
  });

  test('visitor method analysis narrows typed visitors without materialization', () => {
    const document = parseStructure(
      new SourceText('.foo { color: @brand; }', { version: 1 }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);
    const visitor = {
      ruleset() {},
      declaration() {},
      reference() {}
    };
    const shape = visitorShapeFromMethods(visitor, 'less-adapter-node');
    const rules = plan.planVisitor(shape);

    expect(shape).toMatchObject({
      nodeKinds: expect.arrayContaining(['rule', 'declaration', 'variable-declaration']),
      islandKinds: expect.arrayContaining(['selector', 'declaration-value', 'variable-reference']),
      targetShape: 'less-adapter-node'
    });
    expect(rules.length).toBeGreaterThan(0);
    expect(plan.counters).toMatchObject({
      visitorPlans: 1,
      visitorPlanCacheMisses: 1,
      actualParses: 0,
      fallbackFullTreeMaterializations: 0
    });
  });

  test('Less-compatible visitor method names map to structural requests', () => {
    const document = parseStructure(
      new SourceText('@media screen { .foo { color: @brand; } }', { version: 1 }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);
    class LessStyleVisitor {
      visitRuleset() {}
      visitDeclaration() {}
      visitVariable() {}
      visitDirective() {}
    }

    const shape = visitorShapeFromMethods(new LessStyleVisitor(), 'less-adapter-node');
    const rules = plan.planVisitor(shape);

    expect(shape).toMatchObject({
      nodeKinds: expect.arrayContaining(['rule', 'declaration', 'variable-declaration', 'at-rule', 'import']),
      islandKinds: expect.arrayContaining(['selector', 'declaration-value', 'variable-reference', 'at-rule-prelude']),
      targetShape: 'less-adapter-node'
    });
    expect(rules).toEqual(expect.arrayContaining([
      {
        nodeKind: 'rule',
        islandKinds: ['selector'],
        targetShape: 'less-adapter-node'
      },
      {
        nodeKind: 'declaration',
        islandKinds: ['declaration-value'],
        targetShape: 'less-adapter-node'
      },
      {
        nodeKind: 'declaration',
        islandKinds: ['variable-reference'],
        targetShape: 'less-adapter-node'
      },
      {
        nodeKind: 'variable-declaration',
        islandKinds: ['variable-reference'],
        targetShape: 'less-adapter-node'
      }
    ]));
    expect(plan.counters).toMatchObject({
      visitorPlans: 1,
      visitorPlanCacheMisses: 1,
      actualParses: 0,
      fallbackFullTreeMaterializations: 0
    });
  });

  test('visitor traversal requests only materialize islands owned by the reached node', () => {
    const document = parseStructure(
      new SourceText('@media screen { .foo { color: @brand; } }', { version: 1 }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);
    const shape = visitorShapeFromMethods({
      visitRuleset() {},
      visitDeclaration() {},
      visitVariable() {},
      visitDirective() {}
    }, 'less-adapter-node');
    const rules = plan.planVisitor(shape);
    const mediaRule = document.root.children[0]!;
    if (!('children' in mediaRule)) {
      throw new Error('Expected @media to own a rule body.');
    }
    const rulesetNode = mediaRule.children.find(child => child.kind === 'rule')!;
    if (!('children' in rulesetNode)) {
      throw new Error('Expected nested ruleset to own declarations.');
    }
    const declarationNode = rulesetNode.children.find(child => child.kind === 'declaration')!;

    expect(plan.requestVisitorNode(mediaRule, rules)).toHaveLength(1);
    expect(plan.requestVisitorNode(rulesetNode, rules)).toHaveLength(1);
    expect(plan.requestVisitorNode(declarationNode, rules)).toHaveLength(2);
    expect(plan.requestVisitorNode(document.root, rules)).toEqual([]);
    expect(plan.counters).toMatchObject({
      visitorPlans: 1,
      visitorTraversalRequests: 4,
      visitorMaterializedNodeRequests: 3,
      visitorPromotedIslandRequests: 4,
      visitorAdapterNodeRequests: 3,
      actualParses: 0,
      fallbackFullTreeMaterializations: 0
    });
  });

  test('generic visitor traversal remains demand-driven at the reached node', () => {
    const document = parseStructure(
      new SourceText('.foo:extend(.bar) { color: @brand; } .unused { width: 1px; }', { version: 1 }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);
    const rules = plan.planVisitor(visitorShapeFromMethods({ visit() {} }, 'less-adapter-node'));
    const firstRule = document.root.children[0]!;
    const secondRule = document.root.children[1]!;
    if (!('children' in firstRule) || !('children' in secondRule)) {
      throw new Error('Expected both rulesets to own declarations.');
    }
    const firstDeclaration = firstRule.children.find(child => child.kind === 'declaration')!;
    const secondDeclaration = secondRule.children.find(child => child.kind === 'declaration')!;

    const firstRuleIds = plan.requestVisitorNode(firstRule, rules);
    const firstDeclarationIds = plan.requestVisitorNode(firstDeclaration, rules);

    expect(firstRuleIds).toHaveLength(2);
    expect(firstDeclarationIds).toHaveLength(2);
    expect(plan.counters.requestIds).toBe(4);
    expect(plan.counters.actualParses).toBe(0);

    plan.requestVisitorNode(secondRule, rules);
    plan.requestVisitorNode(secondDeclaration, rules);

    expect(plan.counters).toMatchObject({
      visitorTraversalRequests: 4,
      visitorMaterializedNodeRequests: 4,
      visitorPromotedIslandRequests: 6,
      fallbackFullTreeMaterializations: 0
    });
  });

  test('Less legacy visitor aliases do not widen beyond their requested islands', () => {
    const document = parseStructure(
      new SourceText('.foo { width: 1px; }', { version: 1 }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);
    const shape = visitorShapeFromMethods({
      visitElement() {},
      visitRule() {}
    }, 'less-adapter-node');

    expect(shape.nodeKinds).toEqual(expect.arrayContaining(['rule', 'declaration']));
    expect(shape.islandKinds).toEqual(expect.arrayContaining(['selector', 'declaration-value']));
    expect(shape.islandKinds).not.toContain('at-rule-prelude');
    expect(shape.islandKinds).not.toContain('mixin-call');
    expect(plan.planVisitor(shape)).toEqual(expect.arrayContaining([
      {
        nodeKind: 'rule',
        islandKinds: ['selector'],
        targetShape: 'less-adapter-node'
      },
      {
        nodeKind: 'declaration',
        islandKinds: ['declaration-value'],
        targetShape: 'less-adapter-node'
      }
    ]));
    expect(plan.counters.actualParses).toBe(0);
  });

  test('replacing visitors still plan from typed methods instead of broad fallback', () => {
    const document = parseStructure(
      new SourceText('.foo { color: red; }', { version: 1 }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);
    const shape = visitorShapeFromMethods({
      isReplacing: true,
      visitDeclaration() {}
    }, 'less-adapter-node');

    expect(shape.nodeKinds).toEqual(['declaration']);
    expect(shape.islandKinds).toEqual(['declaration-value']);
    expect(plan.planVisitor(shape)).toEqual([
      {
        nodeKind: 'declaration',
        islandKinds: ['declaration-value'],
        targetShape: 'less-adapter-node'
      }
    ]);
    expect(plan.counters).toMatchObject({
      visitorPlans: 1,
      actualParses: 0,
      fallbackFullTreeMaterializations: 0
    });
  });

  test('visitorShapeFromMethods reuses cached method-table arrays for repeated visitors', () => {
    const visitor = {
      visitRuleset() {},
      visitDeclaration() {}
    };

    const first = visitorShapeFromMethods(visitor, 'less-adapter-node');
    const second = visitorShapeFromMethods(visitor, 'less-adapter-node');

    expect(second.nodeKinds).toBe(first.nodeKinds);
    expect(second.islandKinds).toBe(first.islandKinds);
    expect(second.materializationRules).toBe(first.materializationRules);
  });

  test('visitor planning reuses cached rule arrays for equivalent shapes', () => {
    const document = parseStructure(
      new SourceText('.foo { color: @brand; }', { version: 1 }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);
    const first = plan.planVisitor({
      nodeKinds: ['declaration', 'rule'],
      islandKinds: ['variable-reference', 'selector'],
      targetShape: 'less-adapter-node'
    });
    const second = plan.planVisitor({
      nodeKinds: ['rule', 'declaration'],
      islandKinds: ['selector', 'variable-reference'],
      targetShape: 'less-adapter-node'
    });

    expect(second).toBe(first);
    expect(plan.counters).toMatchObject({
      visitorPlans: 2,
      visitorPlanCacheHits: 1,
      visitorPlanCacheMisses: 1,
      actualParses: 0
    });
  });

  test('visitor planning cache canonicalizes reordered materialization rules', () => {
    const document = parseStructure(
      new SourceText('.foo { color: @brand; }', { version: 1 }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);
    const declarationRule = {
      nodeKind: 'declaration' as const,
      islandKinds: ['declaration-value'] as const,
      targetShape: 'less-adapter-node'
    };
    const referenceRule = {
      nodeKind: 'declaration' as const,
      islandKinds: ['variable-reference'] as const,
      targetShape: 'less-adapter-node'
    };
    const first = plan.planVisitor({
      materializationRules: [declarationRule, referenceRule],
      targetShape: 'less-adapter-node'
    });
    const second = plan.planVisitor({
      materializationRules: [referenceRule, declarationRule],
      targetShape: 'less-adapter-node'
    });

    expect(second).toBe(first);
    expect(plan.counters).toMatchObject({
      visitorPlans: 2,
      visitorPlanCacheHits: 1,
      visitorPlanCacheMisses: 1,
      actualParses: 0
    });
  });

  test('generic visit method plans broad observation but still does not execute providers', () => {
    const document = parseStructure(
      new SourceText('.foo:extend(.bar) { color: @brand; }', { version: 1 }),
      fixtureLessProfile
    );
    const plan = new IslandParsePlan(document);
    const shape = visitorShapeFromMethods({ visit() {} }, 'less-adapter-node');

    expect(shape.islandKinds).toEqual(expect.arrayContaining([
      'selector',
      'declaration-value',
      'extend-candidate',
      'variable-reference'
    ]));
    expect(plan.planVisitor(shape)).not.toEqual([]);
    expect(plan.counters.actualParses).toBe(0);
  });

  test('visitor method table cache avoids repeated method scans', () => {
    class TypedVisitor {
      ruleset() {}
      declaration() {}
    }
    const visitor = new TypedVisitor();
    const cache = new VisitorMethodTableCache();

    const first = cache.get(visitor, 'less-adapter-node');
    const second = cache.get(visitor, 'less-adapter-node');

    expect(second).toBe(first);
    expect(first.methodNames).toEqual(['declaration', 'ruleset']);
    expect(cache.stats()).toEqual({ hits: 1, misses: 1 });
  });

  test('visitor method table cache separates target shapes for one visitor', () => {
    const visitor = { declaration() {} };
    const cache = new VisitorMethodTableCache();

    const lessTable = cache.get(visitor, 'less-adapter-node');
    const scssTable = cache.get(visitor, 'scss-adapter-node');

    expect(lessTable.targetShape).toBe('less-adapter-node');
    expect(scssTable.targetShape).toBe('scss-adapter-node');
    expect(scssTable).not.toBe(lessTable);
    expect(cache.stats()).toEqual({ hits: 0, misses: 2 });
  });

  test('structural-only requestNode queries report zero materialization', () => {
    const document = parseStructure('.foo { color: red; }', fixtureProfile);
    const plan = new IslandParsePlan(document);
    const root = document.root;

    expect(plan.requestNode(root, 'core-selector')).toEqual([]);
    expect(plan.counters).toMatchObject({
      structuralOnlyQueries: 1,
      actualParses: 0
    });
  });

  test('stable config keys are order-insensitive', () => {
    expect(stableConfigKey({ b: true, a: ['x', 1] })).toBe(
      stableConfigKey({ a: ['x', 1], b: true })
    );
  });
});

describe('LanguageActivationRegistry', () => {
  test('lets plugins bind custom profiles and island providers to extensions', () => {
    const registry = new LanguageActivationRegistry();
    const tailwindProfile = {
      ...fixtureLessProfile,
      name: 'tailwind-utility-css'
    };
    let providerConfigurations = 0;

    registry.register({
      name: 'tailwind-plugin',
      profile: tailwindProfile,
      supportedExtensions: ['pcss'],
      configureIslandProviders(islandRegistry) {
        providerConfigurations++;
        islandRegistry.register(providerKey('tailwind-utility-css', 'declaration-value', 'tailwind-value'), context => ({
          value: context.document.source.slice(context.island.start, context.island.end)
        }));
      }
    });

    const document = registry.parseStructureForExtension('.pcss', '.btn { color: theme(colors.red.500); }');
    expect(document?.profile.name).toBe('tailwind-utility-css');
    expect(providerConfigurations).toBe(0);

    const plan = registry.createIslandParsePlanForExtension('pcss', document!);
    expect(providerConfigurations).toBe(1);
    const rule = document!.root.children[0]!;
    if (!('children' in rule)) {
      throw new Error('Expected custom profile document to contain a rule.');
    }
    const [requestId] = plan!.requestNode(rule.children[0]!, 'tailwind-value');

    expect(plan!.execute(requestId!).value).toBe('theme(colors.red.500)');
  });
});
