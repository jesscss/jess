import { afterEach, describe, expect, it, vi } from 'vitest';
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

type CapturedProfile = {
  label: string;
  metadata: Record<string, unknown>;
  totalDurationMs: number;
  phases: Array<{
    phase: string;
    durationMs: number;
    memoryDelta: Record<string, number>;
  }>;
};

type ProfiledRender = {
  profile: CapturedProfile;
  result: string;
};

type ProfileModeResults = {
  results: Map<string, ProfiledRender>;
  structuralOnlyPlugin: ReturnType<typeof lessPlugin>;
  selectedMaterializationPlugin: ReturnType<typeof lessPlugin>;
  structuralFedPlugin: ReturnType<typeof lessPlugin>;
};

function counter(
  entries: Array<readonly [string, number | ReturnType<typeof expect.any>]>
): Record<string, number | ReturnType<typeof expect.any>> {
  return Object.fromEntries(entries);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCapturedProfile(value: unknown): value is CapturedProfile {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.label === 'string'
    && typeof value.metadata === 'object'
    && typeof value.totalDurationMs === 'number'
    && Array.isArray(value.phases)
  );
}

async function captureProfile<T>(render: () => Promise<T>): Promise<{
  profile: CapturedProfile;
  result: T;
}> {
  const previousProfileFlag = process.env.JESS_PROFILE;
  const profileLines: string[] = [];
  const originalError = console.error;
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const line = args.map(String).join(' ');
    if (line.startsWith('[jess-profile] ')) {
      profileLines.push(line.slice('[jess-profile] '.length));
      return;
    }
    originalError(...args);
  });

  try {
    process.env.JESS_PROFILE = '1';
    const result = await render();
    expect(profileLines).toHaveLength(1);
    const profile: unknown = JSON.parse(profileLines[0]!);
    if (!isCapturedProfile(profile)) {
      throw new Error('Jess profile output did not match the expected shape.');
    }
    return {
      profile,
      result
    };
  } finally {
    if (previousProfileFlag === undefined) {
      delete process.env.JESS_PROFILE;
    } else {
      process.env.JESS_PROFILE = previousProfileFlag;
    }
    errorSpy.mockRestore();
  }
}

function expectParseEvalRenderPhases(profile: CapturedProfile): void {
  expect(profile.label).toBe('prepareRender');
  expect(profile.totalDurationMs).toBeGreaterThanOrEqual(0);

  const phases = new Map(profile.phases.map(phase => [phase.phase, phase]));
  for (const phaseName of ['parseString', 'eval', 'render']) {
    const phase = phases.get(phaseName);
    expect(phase, `missing ${phaseName} phase`).toBeDefined();
    expect(phase?.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(phase?.durationMs)).toBe(true);
    expect(phase?.memoryDelta).toEqual(
      expect.objectContaining({
        rss: expect.any(Number),
        heapTotal: expect.any(Number),
        heapUsed: expect.any(Number),
        external: expect.any(Number),
        arrayBuffers: expect.any(Number)
      })
    );
  }
}

function findRepoRoot(start = process.cwd()): string {
  let current = start;

  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    current = path.dirname(current);
  }

  throw new Error(`Could not find Jess repo root from ${start}.`);
}

async function renderProfileModes(source: string): Promise<ProfileModeResults> {
  const structuralOnlyPlugin = lessPlugin({ scannerFirstProbe: true });
  const selectedMaterializationPlugin = lessPlugin({
    scannerFirstProbe: {
      materializeIslandKinds: ['declaration-value']
    }
  });
  const structuralFedPlugin = lessPlugin({
    scannerFirstProbe: {
      structuralFedPrototype: true
    }
  });
  const cases = [
    {
      name: 'current',
      render: () => new Compiler().renderString(source, { language: 'less' })
    },
    {
      name: 'structural-only',
      render: () =>
        new Compiler({
          compile: { plugins: [structuralOnlyPlugin] }
        }).renderString(source, { language: 'less' })
    },
    {
      name: 'selected-materialization',
      render: () =>
        new Compiler({
          compile: { plugins: [selectedMaterializationPlugin] }
        }).renderString(source, { language: 'less' })
    },
    {
      name: 'structural-fed',
      render: () =>
        new Compiler({
          compile: { plugins: [structuralFedPlugin] }
        }).renderString(source, { language: 'less' })
    }
  ];
  const results = new Map<string, ProfiledRender>();

  for (const testCase of cases) {
    results.set(testCase.name, await captureProfile(testCase.render));
  }

  return {
    results,
    structuralOnlyPlugin,
    selectedMaterializationPlugin,
    structuralFedPlugin
  };
}

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
    const probePlugin = lessPlugin({ scannerFirstProbe: true });
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
    expect(probePlugin.lastScannerFirstProbe?.requestsByIslandKind).toMatchObject(counter([
      ['variable-reference', expect.any(Number)],
      ['declaration-value', expect.any(Number)],
      ['mixin-call', expect.any(Number)],
      ['extend-candidate', expect.any(Number)]
    ]));
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

  it('reports parse/eval/render phase timings across current and scanner-first paths', async () => {
    const source = '.a {\n  color: blue;\n}\n.b { width: 1px; }\n';
    const {
      results,
      structuralOnlyPlugin,
      selectedMaterializationPlugin,
      structuralFedPlugin
    } = await renderProfileModes(source);
    const baseline = results.get('current')!;

    for (const rendered of [
      results.get('structural-only')!.result,
      results.get('selected-materialization')!.result,
      results.get('structural-fed')!.result
    ]) {
      expect(rendered).toBe(baseline.result);
    }
    for (const { profile } of results.values()) {
      expectParseEvalRenderPhases(profile);
    }

    expect(structuralOnlyPlugin.lastScannerFirstProbe).toMatchObject({
      requestedIslands: 0,
      actualParses: 0,
      promotedBytes: 0,
      fallbackFullTreeMaterializations: 0
    });
    expect(selectedMaterializationPlugin.lastScannerFirstProbe).toMatchObject({
      requestsByIslandKind: counter([
        ['declaration-value', 2]
      ]),
      requestedIslands: 2,
      actualParses: 2,
      fallbackFullTreeMaterializations: 0
    });
    expect(
      selectedMaterializationPlugin.lastScannerFirstProbe?.promotedBytes
    ).toBeGreaterThan(0);
    expect(structuralFedPlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      requestsByIslandKind: counter([
        ['selector', 2],
        ['declaration-value', 2]
      ]),
      requestedIslands: 4,
      actualParses: 4,
      fallbackFullTreeMaterializations: 0
    });

    const repoRoot = findRepoRoot();
    const fixturePaths = [
      'packages/css-parser/test/css/decls.css',
      'packages/css-parser/test/css/nesting.css',
      'packages/jess/test/less/test.less'
    ];

    for (const fixturePath of fixturePaths) {
      const fixtureSource = fs.readFileSync(path.join(repoRoot, fixturePath), 'utf8');
      const {
        results: fixtureResults,
        structuralOnlyPlugin: fixtureStructuralOnlyPlugin,
        selectedMaterializationPlugin: fixtureSelectedMaterializationPlugin,
        structuralFedPlugin: fixtureStructuralFedPlugin
      } = await renderProfileModes(fixtureSource);
      const fixtureBaseline = fixtureResults.get('current')!;

      for (const [name, rendered] of fixtureResults) {
        expectParseEvalRenderPhases(rendered.profile);
        if (name !== 'current') {
          expect(rendered.result, fixturePath).toBe(fixtureBaseline.result);
        }
      }
      expect(fixtureStructuralOnlyPlugin.lastScannerFirstProbe).toMatchObject({
        actualParses: 0,
        fallbackFullTreeMaterializations: 0
      });
      expect(fixtureSelectedMaterializationPlugin.lastScannerFirstProbe).toMatchObject({
        fallbackFullTreeMaterializations: 0
      });
      expect(fixtureStructuralFedPlugin.lastScannerFirstPrototype).toEqual(
        expect.objectContaining({
          runtimeTreeSource: expect.stringMatching(/^(structural-fed|canonical-fallback)$/),
          fallbackFullTreeMaterializations: expect.any(Number)
        })
      );
    }
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
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual(counter([
      ['selector', 2],
      ['declaration-value', 3]
    ]));
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
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual(counter([
      ['selector', 2],
      ['declaration-value', 2]
    ]));
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({
      rule: 2,
      declaration: 2
    });
  });

  it('feeds Less variable declarations through structural parse and materialized value islands', async () => {
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
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      actualParses: 3,
      requestedIslands: 3
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual(counter([
      ['declaration-value', 2],
      ['selector', 1]
    ]));
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual(counter([
      ['variable-declaration', 1],
      ['rule', 1],
      ['declaration', 1]
    ]));
  });

  it('feeds reordered declarations in one ruleset through structural parse', async () => {
    const source = '.a { width: 1px; color: blue; }\n';
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
    expect(rendered).toContain('width: 1px');
    expect(rendered).toContain('color: blue');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      actualParses: 3,
      requestedIslands: 3
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual(counter([
      ['selector', 1],
      ['declaration-value', 2]
    ]));
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual(counter([
      ['rule', 1],
      ['declaration', 2]
    ]));
  });

  it('feeds a ruleset-local Less variable and sibling declaration through structural parse', async () => {
    const source = '.a { @brand: blue; color: @brand; }\n';
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
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      actualParses: 3,
      requestedIslands: 3
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual(counter([
      ['selector', 1],
      ['declaration-value', 2]
    ]));
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual(counter([
      ['rule', 1],
      ['variable-declaration', 1],
      ['declaration', 1]
    ]));
  });

  it('feeds nested Less variable declarations through structural parse', async () => {
    const source = '.a { @brand: blue; color: @brand; .b { border-color: @brand; } }\n';
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
    expect(rendered).toContain('border-color: blue');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      actualParses: 5,
      requestedIslands: 5
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual(counter([
      ['selector', 2],
      ['declaration-value', 3]
    ]));
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual(counter([
      ['rule', 2],
      ['variable-declaration', 1],
      ['declaration', 2]
    ]));
  });

  it('feeds a hoisted nested Less variable declaration through structural parse', async () => {
    const source = '.a { color: @brand; .b { border-color: @brand; } @brand: blue; }\n';
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
    expect(rendered).toContain('border-color: blue');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      actualParses: 5,
      requestedIslands: 5
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual(counter([
      ['selector', 2],
      ['declaration-value', 3]
    ]));
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual(counter([
      ['rule', 2],
      ['declaration', 2],
      ['variable-declaration', 1]
    ]));
  });

  it('feeds reordered declarations and nested ordinary rules through structural parse', async () => {
    const source = '.a { width: 1px; .b { margin: 0; } color: blue; }\n';
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
    expect(rendered).toContain('width: 1px');
    expect(rendered).toContain('margin: 0');
    expect(rendered).toContain('color: blue');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      actualParses: 5,
      requestedIslands: 5
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual(counter([
      ['selector', 2],
      ['declaration-value', 3]
    ]));
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual(counter([
      ['rule', 2],
      ['declaration', 3]
    ]));
  });

  it('feeds multi-level nested ordinary rules through structural parse', async () => {
    const source = '.a { width: 1px; .b { margin: 0; .c { color: blue; } } }\n';
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
    expect(rendered).toContain('width: 1px');
    expect(rendered).toContain('margin: 0');
    expect(rendered).toContain('color: blue');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      actualParses: 6,
      requestedIslands: 6
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual(counter([
      ['selector', 3],
      ['declaration-value', 3]
    ]));
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual(counter([
      ['rule', 3],
      ['declaration', 3]
    ]));
  });

  it('feeds a block at-rule containing an ordinary ruleset through structural parse', async () => {
    const source = '@media screen { .a { color: blue; } }\n';
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
    expect(rendered).toContain('@media screen');
    expect(rendered).toContain('color: blue');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      actualParses: 3,
      requestedIslands: 3
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual(counter([
      ['at-rule-prelude', 1],
      ['selector', 1],
      ['declaration-value', 1]
    ]));
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual(counter([
      ['at-rule', 1],
      ['rule', 1],
      ['declaration', 1]
    ]));
  });

  it('feeds nested media declarations inside an ordinary ruleset through structural parse', async () => {
    const source = '.a { @media screen { color: blue; } }\n';
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
    expect(rendered).toContain('@media screen');
    expect(rendered).toContain('color: blue');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      actualParses: 3,
      requestedIslands: 3
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual(counter([
      ['selector', 1],
      ['at-rule-prelude', 1],
      ['declaration-value', 1]
    ]));
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual(counter([
      ['rule', 1],
      ['at-rule', 1],
      ['declaration', 1]
    ]));
  });

  it('falls back canonically for unproven block at-rule families', async () => {
    const source = '@supports (display: grid) { .a { color: blue; } }\n';
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
      fallbackReason: 'unsupported block at-rule in the first structural-fed subset',
      fallbackFullTreeMaterializations: 1,
      actualParses: 0,
      requestedIslands: 0
    });
  });

  it('falls back canonically for Less features outside the first structural-fed subset', async () => {
    const source = '.rounded() { color: blue; }\n.a { .rounded(); }\n';
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
      fallbackReason: 'unsupported root node mixin-definition',
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
        reason: 'unsupported rule child mixin-call'
      },
      {
        source: '@brand: blue ! important;\n.a { color: @brand; }\n',
        reason: 'important variable declarations are not in the first structural-fed subset'
      },
      {
        source: '.wrapper { grid-template-areas:\n  "header header"\n  "content sidebar"; }\n',
        reason: 'multiline declaration values are not in the first structural-fed subset'
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

  it('records structural diagnostic ranges and finite canonical fallback diagnostics', async () => {
    const source = '.a {\n  color: blue;\n';
    const probePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const result = await new Compiler({
      compile: { plugins: [probePlugin] }
    }).renderToResult({
      source,
      filePath: 'virtual.jess',
      language: 'less',
      extension: '.less'
    });

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatchObject({
      phase: 'parse',
      filePath: 'virtual.jess',
      line: 1,
      column: 1
    });
    expect(Number.isFinite(result.errors[0]?.line)).toBe(true);
    expect(Number.isFinite(result.errors[0]?.column)).toBe(true);
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'canonical-fallback',
      fallbackReason: 'structural diagnostics are present',
      structuralDiagnostics: 1,
      requestedIslands: 0,
      actualParses: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.structuralDiagnosticRanges).toEqual([
      expect.objectContaining({
        code: 'unclosed-block',
        start: 0,
        end: source.length,
        line: 1,
        column: 1
      })
    ]);
  });
});
