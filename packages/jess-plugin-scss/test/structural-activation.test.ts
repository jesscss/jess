import { describe, expect, test, vi } from 'vitest';
import { Node, serializeTypes } from '@jesscss/core';
import { ScssPlugin } from '../src/index.js';

describe('ScssPlugin structural activation', () => {
  test('binds SCSS structure and island providers to the plugin extension', () => {
    const plugin = new ScssPlugin();
    const activation = plugin.structuralActivation();

    expect(activation.profile.name).toBe('scss');
    expect(activation.supportedExtensions).toEqual(['.scss']);

    const document = plugin.structureParse(
      'fixture.scss',
      `@if ${' '.repeat(48)}$enabled == true { .foo { color: $brand; } }`
    );
    expect(document.source.filePath).toBe('fixture.scss');
    expect(document.islands('control-condition')).toHaveLength(1);

    const plan = plugin.islandParsePlan('fixture.scss', document.source.text);
    const id = plan.requestIsland(plan.document.islands('control-condition')[0]!, 'scss-condition');

    const record = plan.execute(id);

    expect(serializeTypes(record.value)).toContainString('(Reference');
    expect(serializeTypes(record.value)).toContainString('key: \'enabled\'');
    expect(record.fallbackFullTree).toBe(false);
    expect(plan.counters.actualParses).toBe(1);
  });

  test('answers structural-only queries without core visitor traversal or materialization', () => {
    const accept = vi.spyOn(Node.prototype, 'accept');
    try {
      const plugin = new ScssPlugin();
      const document = plugin.structureParse(
        'fixture.scss',
        '@if $enabled { .foo { color: $brand; } }'
      );
      const plan = plugin.islandParsePlan('fixture.scss', document.source.text);

      expect(document.foldingRanges().length).toBeGreaterThan(0);
      expect(document.symbols().length).toBeGreaterThan(0);
      expect(document.findNodeAt(document.source.text.indexOf('color'))?.kind).toBe('declaration');
      expect(plan.requestNode(document.root, 'scss-value')).toEqual([]);
      expect(plan.counters).toMatchObject({
        actualParses: 0,
        fallbackFullTreeMaterializations: 0,
        structuralOnlyQueries: 1
      });
      expect(accept).not.toHaveBeenCalled();
    } finally {
      accept.mockRestore();
    }
  });

  test('keeps safeParse canonical unless the scanner-first probe is requested', () => {
    const plugin = new ScssPlugin();
    const result = plugin.safeParse('fixture.scss', '.foo { color: $brand; }');

    expect(result.tree).toBeDefined();
    expect(result.errors).toHaveLength(0);
    expect(plugin.lastScannerFirstProbe).toBeUndefined();
  });

  test('records structural-only scanner-first probe metrics from safeParse', () => {
    const plugin = new ScssPlugin({ scannerFirstProbe: true });
    const result = plugin.safeParse(
      'fixture.scss',
      '$brand: red;\n@if $enabled == true { .foo { color: $brand; } }\n'
    );

    expect(result.tree).toBeDefined();
    expect(result.errors).toHaveLength(0);
    expect(plugin.lastScannerFirstProbe).toMatchObject({
      filePath: 'fixture.scss',
      structuralDiagnostics: 0,
      requestedIslands: 0,
      executedIslands: 0,
      islandDiagnostics: 0,
      actualParses: 0,
      promotedBytes: 0,
      fallbackFullTreeMaterializations: 0,
      requestsByIslandKind: {},
      requestsByOwnerKind: {}
    });
    expect(plugin.scannerFirstProbes).toHaveLength(0);
    const probe = plugin.lastScannerFirstProbe;
    expect(probe?.availableByIslandKind.controlCondition).toBeUndefined();
    expect(probe?.availableByIslandKind['control-condition']).toBe(1);
    expect(probe?.availableByIslandKind['declaration-value']).toEqual(expect.any(Number));
    expect(probe?.availableByIslandKind.selector).toBe(1);
    expect(probe?.availableByIslandKind['variable-reference']).toEqual(expect.any(Number));
    expect(probe?.availableByOwnerKind['at-rule']).toEqual(expect.any(Number));
    expect(probe?.availableByOwnerKind.declaration).toEqual(expect.any(Number));
    expect(probe?.availableByOwnerKind.rule).toBe(1);
    expect(probe?.availableByOwnerKind['variable-declaration']).toBe(1);
    expect(probe?.structuralNodesByKind.document).toBe(1);
    expect(probe?.structuralNodesByKind['at-rule']).toBe(1);
    expect(probe?.structuralNodesByKind.rule).toBe(1);
    expect(probe?.structuralNodesByKind.declaration).toBe(1);
    expect(probe?.structuralNodesByKind['variable-declaration']).toBe(1);
  });

  test('materializes only requested SCSS island kinds in the scanner-first probe', () => {
    const plugin = new ScssPlugin({
      scannerFirstProbe: {
        materializeIslandKinds: ['control-condition']
      }
    });
    const result = plugin.safeParse(
      'fixture.scss',
      '$brand: red;\n@if $enabled == true { .foo { color: $brand; } }\n'
    );

    expect(result.tree).toBeDefined();
    expect(result.errors).toHaveLength(0);
    expect(plugin.lastScannerFirstProbe).toMatchObject({
      requestedIslands: 1,
      executedIslands: 1,
      actualParses: 1,
      fallbackFullTreeMaterializations: 0
    });
    expect(plugin.lastScannerFirstProbe?.requestsByIslandKind['control-condition']).toBe(1);
    expect(plugin.lastScannerFirstProbe?.requestsByOwnerKind['at-rule']).toBe(1);
    expect(plugin.lastScannerFirstProbe?.promotedBytes).toBeGreaterThan(0);
    expect(plugin.lastScannerFirstProbe?.materializationMs).toBeGreaterThanOrEqual(0);
  });
});
