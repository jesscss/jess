import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Compiler } from '../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe('scanner-first CSS/Less e2e probe', () => {
  it('keeps a plain rule and declaration structural-only', async () => {
    const source = '.a {\n  color: blue;\n}\n';
    const baseline = await new Compiler().renderString(source, { language: 'less' });
    const probePlugin = lessPlugin({ scannerFirstProbe: true });
    const probed = await new Compiler({
      compile: { plugins: [probePlugin] }
    }).renderString(source, { language: 'less' });

    expect(probed).toBe(baseline);
    expect(probed).toContain('color: blue');
    expect(probePlugin.lastScannerFirstProbe).toMatchObject({
      structuralDiagnostics: 0,
      requestedIslands: 0,
      executedIslands: 0,
      actualParses: 0,
      promotedBytes: 0,
      fallbackFullTreeMaterializations: 0
    });
    expect(probePlugin.lastScannerFirstProbe?.structuralNodesByKind.rule).toBe(1);
    expect(probePlugin.lastScannerFirstProbe?.structuralNodesByKind.declaration).toBe(1);
    expect(probePlugin.lastScannerFirstProbe?.availableByIslandKind.selector).toBe(1);
    expect(probePlugin.lastScannerFirstProbe?.availableByIslandKind['declaration-value']).toBe(1);
    expect(probePlugin.lastScannerFirstProbe?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstProbe?.structuralScanMs).toBeGreaterThanOrEqual(0);
    expect(probePlugin.lastScannerFirstProbe?.materializationMs).toBe(0);
    expect(probePlugin.lastScannerFirstProbe?.totalProbeMs).toBeGreaterThanOrEqual(0);
  });

  it('renders CSS-equivalent input without materializing structural-only islands', async () => {
    const source = `
      .foo {
        color: red;
        --raw: { token: "}"; };
      }
      @media screen {
        .foo { width: 1px; }
      }
    `;
    const baseline = await new Compiler().renderString(source, { language: 'less' });
    const probePlugin = lessPlugin({ scannerFirstProbe: true } as any);
    const probed = await new Compiler({
      compile: { plugins: [probePlugin] }
    }).renderString(source, { language: 'less' });

    expect(probed).toBe(baseline);
    expect(probePlugin.lastScannerFirstProbe).toMatchObject({
      structuralDiagnostics: 0,
      requestedIslands: 0,
      executedIslands: 0,
      actualParses: 0,
      fallbackFullTreeMaterializations: 0
    });
    expect(probePlugin.lastScannerFirstProbe?.availableByIslandKind.selector).toBeGreaterThan(0);
    expect(probePlugin.lastScannerFirstProbe?.availableByIslandKind['declaration-value']).toBeGreaterThan(0);
    expect(probePlugin.lastScannerFirstProbe?.requestsByIslandKind).toEqual({});
  });

  it('renders Less variables, arithmetic, mixins, nesting, and extend with selected materialization only', async () => {
    const source = `
      @brand: #336699;
      @gap: 4px;
      .rounded() {
        border-radius: @gap + 2px;
      }
      .base {
        color: @brand;
      }
      .button:extend(.base) {
        .rounded();
        &:hover {
          color: lighten(@brand, 10%);
        }
      }
    `;
    const baseline = await new Compiler().renderString(source, { language: 'less' });
    const probePlugin = lessPlugin({
      scannerFirstProbe: {
        materializeIslandKinds: ['declaration-value', 'variable-reference', 'mixin-call', 'extend-candidate']
      }
    });
    const probed = await new Compiler({
      compile: { plugins: [probePlugin] }
    }).renderString(source, { language: 'less' });

    expect(probed).toBe(baseline);
    expect(probed).toContain('.button');
    expect(probed).toContain('border-radius: 6px');
    expect(probePlugin.lastScannerFirstProbe).toMatchObject({
      structuralDiagnostics: 0,
      fallbackFullTreeMaterializations: 0
    });
    expect(probePlugin.lastScannerFirstProbe?.requestsByIslandKind).toMatchObject({
      'variable-reference': expect.any(Number),
      'declaration-value': expect.any(Number),
      'mixin-call': expect.any(Number),
      'extend-candidate': expect.any(Number)
    });
    expect(probePlugin.lastScannerFirstProbe?.requestsByIslandKind.selector ?? 0).toBe(0);
    expect(probePlugin.lastScannerFirstProbe?.actualParses).toBe(
      probePlugin.lastScannerFirstProbe?.requestedIslands
    );
  });

  it('renders imported Less while proving import structure does not force materialization', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-scanner-first-'));
    tempDirs.push(dir);
    const imported = path.join(dir, 'tokens.less');
    const entry = path.join(dir, 'entry.less');
    fs.writeFileSync(imported, '@color: blue;\n.utility { display: block; }\n');
    fs.writeFileSync(entry, '@import "tokens.less";\n.card { color: @color; }\n');

    const baseline = await new Compiler().render(entry);
    const probePlugin = lessPlugin({
      scannerFirstProbe: {
        materializeIslandKinds: ['variable-reference']
      }
    });
    const probed = await new Compiler({
      compile: { plugins: [probePlugin] }
    }).render(entry);

    expect(probed).toBe(baseline);
    expect(probed).toContain('color: blue');
    const entryProbe = probePlugin.scannerFirstProbes.find(probe => probe.filePath === entry);
    expect(entryProbe).toBeDefined();
    expect(entryProbe).toMatchObject({
      structuralDiagnostics: 0,
      fallbackFullTreeMaterializations: 0
    });
    expect(entryProbe?.structuralNodesByKind.import).toBe(1);
    expect(entryProbe?.requestsByOwnerKind.import ?? 0).toBe(0);
  });

  it('feeds a bounded plain rule through structural parse and materialized islands', async () => {
    const source = '.a {\n  color: blue;\n  width: 1px;\n}\n.b { margin: 0; }\n';
    const baseline = await new Compiler().renderString(source, { language: 'less' });
    const probePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const rendered = await new Compiler({
      compile: { plugins: [probePlugin] }
    }).renderString(source, { language: 'less' });

    expect(rendered).toBe(baseline);
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      structuralDiagnostics: 0,
      fallbackFullTreeMaterializations: 0,
      actualParses: 5,
      requestedIslands: 5,
      executedIslands: 5
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({
      selector: 2,
      'declaration-value': 3
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({
      rule: 2,
      declaration: 3
    });
    expect(probePlugin.lastScannerFirstProbe?.requestedIslands).toBe(0);
  });

  it('feeds nested ordinary rules through structural parse and canonical rendering', async () => {
    const source = '.a {\n  color: blue;\n  .b { width: 1px; }\n}\n';
    const baseline = await new Compiler().renderString(source, { language: 'less' });
    const probePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const rendered = await new Compiler({
      compile: { plugins: [probePlugin] }
    }).renderString(source, { language: 'less' });

    expect(rendered).toBe(baseline);
    expect(rendered).toContain('.b');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      actualParses: 4,
      requestedIslands: 4
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({
      selector: 2,
      'declaration-value': 2
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({
      rule: 2,
      declaration: 2
    });
  });

  it('falls back canonically for Less features outside the first structural-fed subset', async () => {
    const source = '@brand: blue;\n.a { color: @brand; }\n';
    const baseline = await new Compiler().renderString(source, { language: 'less' });
    const probePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const rendered = await new Compiler({
      compile: { plugins: [probePlugin] }
    }).renderString(source, { language: 'less' });

    expect(rendered).toBe(baseline);
    expect(rendered).toContain('color: blue');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'canonical-fallback',
      fallbackReason: 'unsupported root node variable-declaration',
      fallbackFullTreeMaterializations: 1,
      actualParses: 0,
      promotedBytes: 0
    });
  });

  it('falls back canonically for declaration syntax the structural-fed subset cannot preserve', async () => {
    const cases = [
      {
        source: '.a { width+: 1px; }\n',
        reason: 'declaration name is outside the first structural-fed subset'
      },
      {
        source: '.a { color: blue ! important; }\n',
        reason: 'important declarations are not in the first structural-fed subset'
      },
      {
        source: '@prop: color;\n.a { @{prop}: blue; }\n',
        reason: 'unsupported root node variable-declaration'
      }
    ];

    for (const { source, reason } of cases) {
      const baseline = await new Compiler().renderString(source, { language: 'less' });
      const probePlugin = lessPlugin({
        scannerFirstProbe: {
          structuralFedPrototype: true
        }
      });
      const rendered = await new Compiler({
        compile: { plugins: [probePlugin] }
      }).renderString(source, { language: 'less' });

      expect(rendered).toBe(baseline);
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'canonical-fallback',
        fallbackReason: reason,
        fallbackFullTreeMaterializations: 1
      });
    }
  });

  it('preflights nested unsupported syntax before materializing islands', async () => {
    const source = '.a { color: blue; .b { width: 1px ! important; } }\n';
    const baseline = await new Compiler().renderString(source, { language: 'less' });
    const probePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const rendered = await new Compiler({
      compile: { plugins: [probePlugin] }
    }).renderString(source, { language: 'less' });

    expect(rendered).toBe(baseline);
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'canonical-fallback',
      fallbackReason: 'important declarations are not in the first structural-fed subset',
      fallbackFullTreeMaterializations: 1,
      requestedIslands: 0,
      actualParses: 0,
      promotedBytes: 0
    });
  });
});
