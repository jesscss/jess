import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Compiler } from '../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { serializeTypes as serializeRuntimeTypes } from '@jesscss/core';
import { progressivedecl, progressiveruleset, serializeTypes } from '../../core/src/index.js';
import { createLanguageProfile, parseStructure, type StructuralContainerNode } from '../../parser/src/index.js';

const tempDirs: string[] = [];

const cssStructureProfile = createLanguageProfile({
  name: 'css',
  variablePrefixes: [],
  interpolationStarts: [],
  atRuleClassifiers: {
    import: 'import'
  },
  statementStarters: [
    { text: '@', kind: 'at-rule' },
    { text: '--', kind: 'declaration' },
    { text: '.', kind: 'rule' },
    { text: '#', kind: 'rule' },
    { text: '[', kind: 'rule' },
    { text: ':', kind: 'rule' }
  ],
  classifyDeclarationName(text) {
    return text.startsWith('--') ? 'custom-property' : 'property';
  },
  classifyRuleHeader(text) {
    return text.length > 0 ? 'selector' : 'unknown';
  },
  classifyIsland(_text, _source, _range, context) {
    if (context?.parentKind === 'declaration') {
      return ['declaration-value'];
    }
    if (context?.statementKind === 'rule') {
      return ['selector'];
    }
    return [];
  }
});

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

type StructuralFieldNode = StructuralContainerNode | StructuralContainerNode['children'][number];

function structuralFieldText(
  document: ReturnType<typeof parseStructure>,
  node: StructuralFieldNode,
  field: 'name' | 'selector' | 'value'
): string {
  const range = document.fieldRanges.get(node, field);
  if (!range) {
    throw new Error(`Missing ${field} field range for ${node.kind}.`);
  }
  return document.source.text.slice(range.start, range.end);
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
  it('builds progressive proof nodes from structural field metadata', () => {
    const source = '.a { color: blue; }';
    const document = parseStructure(source, cssStructureProfile);
    const rule = document.root.children[0];
    if (!rule || rule.kind !== 'rule') {
      throw new Error('Expected one structural rule.');
    }
    const declaration = rule.children[0];
    if (!declaration || declaration.kind !== 'declaration') {
      throw new Error('Expected one structural declaration.');
    }

    const progressive = progressiveruleset({
      selector: structuralFieldText(document, rule, 'selector'),
      rules: [
        progressivedecl({
          name: structuralFieldText(document, declaration, 'name'),
          value: [structuralFieldText(document, declaration, 'value')]
        })
      ]
    });

    expect(document.fieldRanges.size).toBeGreaterThan(0);
    expect(progressive.toTrimmedString()).toBe('.a {\n  color: blue;\n}\n');
    expect(serializeTypes(progressive)).toBe([
      '(ProgressiveRuleset',
      '  selector: \'.a\'',
      '  rules:',
      '    [',
      '      (ProgressiveDeclaration',
      '        name: \'color\'',
      '        valueSegments:',
      '          [\'blue\']',
      '      )',
      '    ]',
      ')'
    ].join('\n'));
  });

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
      ]),
      requestedIslands: 0,
      actualParses: 0,
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

  it('feeds a bounded plain rule through structural parse and scanner-native materialization', async () => {
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
      progressiveNodes: 5,
      actualParses: 0,
      requestedIslands: 0,
      executedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});
    expect(probePlugin.lastScannerFirstProbe?.requestedIslands).toBe(0);
  });

  it('keeps structural-fed rulesets and declarations as raw-field core nodes before semantic materialization', () => {
    const probePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const result = probePlugin.safeParse('/virtual/raw-declaration.less', '.a { color: blue; }\n');

    expect(result.errors).toEqual([]);
    expect(result.tree).toBeDefined();
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 2,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const firstRule = result.tree!.rules[0];
    expect(firstRule).toBeDefined();

    const types = serializeRuntimeTypes(firstRule);
    expect(types).toContain('(Ruleset');
    expect(types).toContain('rawSelector: \'.a\'');
    expect(types).toContain('(Declaration');
    expect(types).toContain('rawName: \'color\'');
    expect(types).toContain('rawValueSegments:\n          [\'blue\']');
    expect(types).not.toContain('(BasicSelector');
    expect(types).not.toContain('(ProgressiveDeclaration');
    expect(types).not.toContain('name: (Any \'color\')');
    expect(types).not.toContain('valueNode: (Any \'blue\')');
  });

  it('feeds nested ordinary rules through structural parse and scanner-native materialization', async () => {
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
      progressiveNodes: 4,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});
  });

  it('feeds simple root Less variable declarations and reads through structural parse', async () => {
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
      progressiveNodes: 3,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});
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
      progressiveNodes: 3,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});
  });

  it('feeds flat literal declaration values through structural parse without value materialization', async () => {
    const cases = [
      { property: 'border', value: '1px solid red' },
      { property: 'box-shadow', value: '0 1px #000' },
      { property: 'font', value: '16px serif' }
    ];

    for (const { property, value } of cases) {
      const source = `.a { ${property}: ${value}; }\n`;
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
      expect(rendered).toContain(`${property}: ${value}`);
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes: 2,
        actualParses: 0,
        requestedIslands: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parseResult = probePlugin.safeParse('/virtual/flat-value.less', source);
      expect(parseResult.errors).toEqual([]);
      const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
      expect(types).toContain('(Ruleset');
      expect(types).toContain('rawSelector: \'.a\'');
      expect(types).toContain(`rawName: '${property}'`);
      expect(types).toContain(`['${value}']`);
      expect(types).not.toContain('valueNode: (Sequence');
      expect(types).not.toContain('valueNode: (List');
      expect(types).not.toContain('valueNode: (Any');
    }
  });

  it('feeds custom property declarations through structural parse without value materialization', async () => {
    const cases = [
      {
        source: '.a { --brand: #06c; }\n',
        name: '--brand',
        value: '#06c',
        progressiveNodes: 2
      },
      {
        source: '.a { --raw: { token: "}"; }; color: blue; }\n',
        name: '--raw',
        value: '{ token: "}"; }',
        progressiveNodes: 3
      }
    ];

    for (const { source, name, value, progressiveNodes } of cases) {
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
      expect(rendered).toContain(name);
      expect(rendered).toContain(value);
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes,
        actualParses: 0,
        requestedIslands: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parseResult = probePlugin.safeParse('/virtual/custom-property.less', source);
      expect(parseResult.errors).toEqual([]);
      const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
      expect(types).toContain(`rawName: '${name}'`);
      expect(types).toContain('rawValueSegments:');
      expect(types).toContain(`['${value}']`);
      expect(types).not.toContain(`name: (Any '${name}')`);
      expect(types).not.toContain('valueNode: (');
    }
  });

  it('feeds quoted and url declaration values through structural parse without value materialization', async () => {
    const cases = [
      { property: 'content', value: '"hello } world"' },
      { property: 'background', value: 'url(/assets/a}/b.png)' },
      { property: 'font-family', value: '"Open Sans", sans-serif' }
    ];

    for (const { property, value } of cases) {
      const source = `.a { ${property}: ${value}; }\n`;
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
      expect(rendered).toContain(`${property}: ${value}`);
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes: 2,
        actualParses: 0,
        requestedIslands: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parseResult = probePlugin.safeParse('/virtual/raw-value.less', source);
      expect(parseResult.errors).toEqual([]);
      const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
      expect(types).toContain(`rawName: '${property}'`);
      expect(types).toContain('rawValueSegments:');
      expect(types).toContain(`['${value}']`);
      expect(types).not.toContain('valueNode: (');
    }
  });

  it('feeds exact important declarations through structural parse without value materialization', async () => {
    const cases = [
      { property: 'color', value: 'blue' },
      { property: 'border', value: '1px solid red' }
    ];

    for (const { property, value } of cases) {
      const source = `.a { ${property}: ${value} !important; }\n`;
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
      expect(rendered).toContain(`${property}: ${value} !important`);
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes: 2,
        actualParses: 0,
        requestedIslands: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parseResult = probePlugin.safeParse('/virtual/important-declaration.less', source);
      expect(parseResult.errors).toEqual([]);
      const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
      expect(types).toContain('(Ruleset');
      expect(types).toContain('rawSelector: \'.a\'');
      expect(types).toContain(`rawName: '${property}'`);
      expect(types).toContain(`['${value}']`);
      expect(types).toContain('rawImportant: \'!important\'');
      expect(types).not.toContain('valueNode: (Sequence');
      expect(types).not.toContain('valueNode: (List');
      expect(types).not.toContain('valueNode: (Any');
      expect(types).not.toContain('important: (Any');
    }
  });

  it('feeds adjacent compound selectors through structural parse', async () => {
    const cases = ['.a.b', 'button.primary', '.-utility.active'];

    for (const selector of cases) {
      const source = `${selector} { color: blue; }\n`;
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
      expect(rendered).toContain(selector);
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes: 2,
        actualParses: 0,
        requestedIslands: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parseResult = probePlugin.safeParse('/virtual/compound-selector.less', source);
      expect(parseResult.errors).toEqual([]);
      const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
      expect(types).toContain('(Ruleset');
      expect(types).toContain(`rawSelector: '${selector}'`);
      expect(types).not.toContain('(CompoundSelector');
      expect(types).not.toContain('(BasicSelector');
    }
  });

  it('feeds ruleset-local Less variable declarations and later reads through structural parse', async () => {
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
      progressiveNodes: 3,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});
  });

  it('feeds nested Less variable references to already-seen variables through structural parse', async () => {
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
      progressiveNodes: 5,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});
  });

  it('feeds conservative raw Less variable values through structural parse', async () => {
    const cases = [
      {
        source: '@font: "Open Sans";\n.a { font-family: @font; }\n',
        value: '"Open Sans"',
        property: 'font-family',
        declarationRuleIndex: 1,
        progressiveNodes: 3
      },
      {
        source: '@image: url(/assets/a}/b.png);\n.a { background: @image; }\n',
        value: 'url(/assets/a}/b.png)',
        property: 'background',
        declarationRuleIndex: 1,
        progressiveNodes: 3
      },
      {
        source: '.a { @font: "Open Sans"; font-family: @font; .b { font-family: @font; } }\n',
        value: '"Open Sans"',
        property: 'font-family',
        declarationRuleIndex: 0,
        progressiveNodes: 5
      }
    ];

    for (const { source, value, property, declarationRuleIndex, progressiveNodes } of cases) {
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
      expect(rendered).toContain(`${property}: ${value}`);
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes,
        actualParses: 0,
        requestedIslands: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parseResult = probePlugin.safeParse('/virtual/raw-variable-value.less', source);
      expect(parseResult.errors).toEqual([]);
      const treeTypes = serializeRuntimeTypes(parseResult.tree!);
      expect(treeTypes).toContain('valueSegments:');
      expect(treeTypes).toContain(`['${value}']`);
      expect(treeTypes).not.toContain('valueNode: (');

      const ruleTypes = serializeRuntimeTypes(parseResult.tree!.rules[declarationRuleIndex]);
      expect(ruleTypes).toContain('rawValueSegments:');
      expect(ruleTypes).toContain(`['${value}']`);
      expect(ruleTypes).not.toContain('valueNode: (');
    }
  });

  it('falls back for Less variable aliases so lazy variable semantics stay canonical', async () => {
    const source = '@a: blue;\n@b: @a;\n@a: red;\n.x { color: @b; }\n';
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
    expect(rendered).toContain('color: red');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'canonical-fallback',
      fallbackReason: 'Less variable declaration reference is outside the scanner-native structural-fed subset',
      fallbackFullTreeMaterializations: 1,
      progressiveNodes: 0,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});
  });

  it('omits variable-only structural-fed rulesets while preserving scoped variable state', async () => {
    const source = '@a: blue;\n.x { @a: red; }\n.y { color: @a; }\n';
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
    expect(rendered).not.toContain('.x');
    expect(rendered).toContain('.y');
    expect(rendered).toContain('color: blue');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 5,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});
  });

  it('falls back for hoisted Less variable references until reference materialization is scanner-native', async () => {
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
      runtimeTreeSource: 'canonical-fallback',
      fallbackReason: 'Less variable reference is outside the scanner-native structural-fed subset',
      fallbackFullTreeMaterializations: 1,
      progressiveNodes: 0,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});
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
      progressiveNodes: 5,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});
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
      progressiveNodes: 6,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});
  });

  it('skips structural-fed prototype work for import-scoped parse options', () => {
    const source = '.a { color: blue; }\n';
    const cases = [
      { reference: true },
      { multiple: true }
    ];

    for (const importOptions of cases) {
      const probePlugin = lessPlugin({
        scannerFirstProbe: {
          structuralFedPrototype: true
        }
      });
      const result = probePlugin.safeParse('/virtual/imported.less', source, { importOptions });

      expect(result.errors).toEqual([]);
      expect(probePlugin.lastScannerFirstPrototype).toBeUndefined();
      expect(probePlugin.lastScannerFirstProbe).toMatchObject({
        actualParses: 0,
        requestedIslands: 0,
        promotedBytes: 0
      });
    }
  });

  it('feeds root @media blocks with ordinary rules through structural parse', async () => {
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
      progressiveNodes: 3,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/media.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
    expect(types).toContain('(AtRule');
    expect(types).toContain('rawName: \'@media\'');
    expect(types).toContain('rawPrelude: \'screen\'');
    expect(types).toContain('(Ruleset');
    expect(types).toContain('rawSelector: \'.a\'');
    expect(types).not.toContain('(ProgressiveAtRule');
    expect(types).not.toContain('name: (Any \'@media\')');
    expect(types).not.toContain('prelude: (Any \'screen\')');
  });

  it('feeds root @layer blocks with ordinary rules through structural parse', async () => {
    const cases = [
      {
        source: '@layer utilities { .a { color: blue; } }\n',
        prelude: 'utilities'
      },
      {
        source: '@layer { .a { color: blue; } }\n',
        prelude: undefined
      }
    ];

    for (const { source, prelude } of cases) {
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
      expect(rendered).toContain('@layer');
      expect(rendered).toContain('.a');
      expect(rendered).toContain('color: blue');
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes: 3,
        actualParses: 0,
        requestedIslands: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parseResult = probePlugin.safeParse('/virtual/root-layer.less', source);
      expect(parseResult.errors).toEqual([]);
      const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
      expect(types).toContain('(AtRule');
      expect(types).toContain('rawName: \'@layer\'');
      if (prelude) {
        expect(types).toContain(`rawPrelude: '${prelude}'`);
        expect(types).not.toContain(`prelude: (Any '${prelude}')`);
      } else {
        expect(types).not.toContain('rawPrelude');
        expect(types).not.toContain('prelude: (');
      }
      expect(types).toContain('rawSelector: \'.a\'');
      expect(types).toContain('rawName: \'color\'');
      expect(types).not.toContain('(ProgressiveAtRule');
      expect(types).not.toContain('name: (Any \'@layer\')');
    }
  });

  it('feeds root @supports blocks with ordinary rules through structural parse', async () => {
    const source = '@supports (display: grid) { .a { display: grid; } }\n';
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
    expect(rendered).toContain('@supports (display: grid)');
    expect(rendered).toContain('display: grid');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 3,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/root-supports.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
    expect(types).toContain('(AtRule');
    expect(types).toContain('rawName: \'@supports\'');
    expect(types).toContain('rawPrelude: \'(display: grid)\'');
    expect(types).toContain('rawSelector: \'.a\'');
    expect(types).toContain('rawName: \'display\'');
    expect(types).not.toContain('(ProgressiveAtRule');
    expect(types).not.toContain('name: (Any \'@supports\')');
    expect(types).not.toContain('prelude: (Any \'(display: grid)\')');
  });

  it('falls back for root @layer shapes outside the structural-fed subset', async () => {
    const cases = [
      {
        source: '@layer theme.utilities { .a { color: blue; } }\n',
        reason: 'at-rule prelude is outside the scanner-native structural-fed subset'
      },
      {
        source: '@layer utilities { .a { @brand: blue; color: @brand; } }\n',
        reason: 'Less variable declarations are not in this structural-fed subset'
      },
      {
        source: '@brand: blue;\n@layer utilities { .a { color: @brand; } }\n',
        reason: 'Less variable references are not in this structural-fed subset'
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
        fallbackFullTreeMaterializations: 1,
        progressiveNodes: 0,
        actualParses: 0,
        requestedIslands: 0
      });
    }
  });

  it('falls back for @supports shapes outside the structural-fed subset', async () => {
    const cases = [
      {
        source: '@supports not (display: grid) { .a { display: grid; } }\n',
        reason: 'at-rule prelude is outside the scanner-native structural-fed subset'
      },
      {
        source: '@brand: grid;\n@supports (display: @brand) { .a { display: grid; } }\n',
        reason: 'at-rule prelude is outside the scanner-native structural-fed subset'
      },
      {
        source: '.a { @supports (display: grid) { display: grid; } }\n',
        reason: 'only root @layer and @supports block at-rules are in the progressive structural-fed subset'
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
        fallbackFullTreeMaterializations: 1,
        progressiveNodes: 0,
        actualParses: 0,
        requestedIslands: 0
      });
    }
  });

  it('feeds nested @media blocks with ordinary declarations through structural parse', async () => {
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
    expect(rendered).toContain('.a');
    expect(rendered).toContain('color: blue');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 3,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/nested-media.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
    expect(types).toContain('(Ruleset');
    expect(types).toContain('rawSelector: \'.a\'');
    expect(types).toContain('(AtRule');
    expect(types).toContain('rawName: \'@media\'');
    expect(types).toContain('rawPrelude: \'screen\'');
    expect(types).toContain('rawName: \'color\'');
    expect(types).not.toContain('(ProgressiveAtRule');
    expect(types).not.toContain('name: (Any \'@media\')');
    expect(types).not.toContain('prelude: (Any \'screen\')');
  });

  it('feeds nested @media blocks with ordinary nested rules through structural parse', async () => {
    const source = '.a { @media screen { .b { color: blue; } } }\n';
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
    expect(rendered).toContain('.b');
    expect(rendered).toContain('color: blue');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 4,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/nested-media-rule.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
    expect(types).toContain('(Ruleset');
    expect(types).toContain('rawSelector: \'.a\'');
    expect(types).toContain('(AtRule');
    expect(types).toContain('rawName: \'@media\'');
    expect(types).toContain('rawPrelude: \'screen\'');
    expect(types).toContain('rawSelector: \'.b\'');
    expect(types).toContain('rawName: \'color\'');
    expect(types).not.toContain('(ProgressiveAtRule');
    expect(types).not.toContain('name: (Any \'@media\')');
    expect(types).not.toContain('prelude: (Any \'screen\')');
  });

  it('falls back for richer nested @media bodies until those shapes are proven', async () => {
    const cases = [
      {
        source: '.a { @media screen { @media print { color: blue; } } }\n',
        reason: 'unsupported at-rule child at-rule'
      },
      {
        source: '.a { @media screen { @brand: blue; color: @brand; } }\n',
        reason: 'unsupported at-rule child variable-declaration'
      },
      {
        source: '.a { @media screen { .b { @brand: blue; color: @brand; } } }\n',
        reason: 'Less variable declarations are not in this structural-fed subset'
      },
      {
        source: '.a { @media screen { .b { @media print { .c { color: blue; } } } } }\n',
        reason: 'unsupported rule child at-rule'
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
        fallbackFullTreeMaterializations: 1,
        progressiveNodes: 0,
        actualParses: 0,
        requestedIslands: 0
      });
    }
  });

  it('falls back canonically for unproven block at-rule families', async () => {
    const source = '@font-face { font-family: demo; src: url(/demo.woff); }\n';
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
      fallbackReason: 'only @media, @supports, and root @layer block at-rules are in the progressive structural-fed subset',
      fallbackFullTreeMaterializations: 1,
      progressiveNodes: 0,
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
        source: '.a { color: blue !IMPORTANT; }\n',
        reason: 'important declarations are not in the first structural-fed subset'
      },
      {
        source: '@prop: color;\n.a { @{prop}: blue; }\n',
        reason: 'unsupported rule child mixin-call'
      },
      {
        source: '@brand: blue ! important;\n.a { color: @brand; }\n',
        reason: 'important variable declarations are not in the scanner-native structural-fed subset'
      },
      {
        source: '@brand: hero;\n@path: "assets/@{brand}.png";\n.a { background: @path; }\n',
        reason: 'variable declaration value is outside the scanner-native structural-fed subset'
      },
      {
        source: '@brand: blue;\n.a { --brand: @brand; }\n',
        reason: 'custom property values with Less variable-like tokens are not in the scanner-native structural-fed subset'
      },
      {
        source: '@brand: blue;\n.a { --brand: @{brand}; }\n',
        reason: 'custom property values with Less variable-like tokens are not in the scanner-native structural-fed subset'
      },
      {
        source: '.a { color: blue; --brand: ${color}; }\n',
        reason: 'custom property values with Less variable-like tokens are not in the scanner-native structural-fed subset'
      },
      {
        source: '@brand: hero;\n.a { content: "@{brand}"; }\n',
        reason: 'raw declaration values with Less variable-like tokens are not in the scanner-native structural-fed subset'
      },
      {
        source: '@brand: hero;\n.a { background: url(/@{brand}.png); }\n',
        reason: 'raw declaration values with Less variable-like tokens are not in the scanner-native structural-fed subset'
      },
      {
        source: '.a { background: url(/assets/a,b.png); }\n',
        reason: 'declaration value is outside the scanner-native structural-fed subset'
      },
      {
        source: '.a { box-shadow: 0 0 1px red, 0 0 2px blue; }\n',
        reason: 'declaration value is outside the scanner-native structural-fed subset'
      },
      {
        source: '.a { content: "hello" /* comment */; }\n',
        reason: 'declaration value is outside the scanner-native structural-fed subset'
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
