import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Compiler } from '../src/index.js';
import lessPlugin from '../../jess-plugin-less/src/index.js';
import {
  Declaration,
  AssignmentType,
  Extend,
  ExtendFlag,
  Node,
  Ruleset,
  serializeTypes as serializeRuntimeTypes,
  TreeContext
} from '@jesscss/core';
import { progressivedecl, progressiveruleset, serializeTypes } from '../../core/src/index.js';
import {
  createLanguageProfile,
  parseStructure,
  type FieldRangeKind,
  type FieldRangeName,
  type StructuralContainerNode,
  type StructuralDocument,
  type StructuralNode,
  type StructuralNodeKind
} from '../../parser/src/index.js';

const tempDirs: string[] = [];

function canonicalSelectorText(text: string): string {
  let out = '';
  let quoteCode = 0;
  let bracketDepth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    const code = char.charCodeAt(0);
    if (quoteCode !== 0) {
      out += char;
      if (char === '\\') {
        index++;
        out += text[index] ?? '';
      } else if (code === quoteCode) {
        quoteCode = 0;
      }
      continue;
    }
    if (code === 34 || code === 39) {
      quoteCode = code;
      out += char;
      continue;
    }
    if (char === '[') {
      bracketDepth++;
      out += char;
      continue;
    }
    if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      out += char;
      continue;
    }
    if (bracketDepth === 0 && (char === ',' || char === '>' || char === '+' || char === '~')) {
      out = out.replace(/[ \t]+$/u, '');
      out += char;
      while (text[index + 1] === ' ' || text[index + 1] === '\t') {
        index++;
      }
      continue;
    }
    out += char;
  }
  return out;
}

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

type ThinStructureTarget = {
  name: string;
  source: string;
  renderedSnippets: string[];
  thinTypeSnippets: string[];
  forbiddenTypeSnippets: string[];
  fieldRangeFacts: ThinFieldRangeFact[];
  progressiveNodes: number;
};

type ThinFieldRangeFact = {
  nodeKind: StructuralNodeKind;
  field: FieldRangeName;
  kind: FieldRangeKind;
  text: string;
};

function counter(
  entries: Array<readonly [string, number | ReturnType<typeof expect.any>]>
): Record<string, number | ReturnType<typeof expect.any>> {
  return Object.fromEntries(entries);
}

function collectFieldRangeFacts(document: StructuralDocument): ThinFieldRangeFact[] {
  const facts: ThinFieldRangeFact[] = [];
  const visit = (node: StructuralNode) => {
    for (const range of document.fieldRanges.rangesFor(node)) {
      facts.push({
        nodeKind: node.kind,
        field: range.field,
        kind: range.kind,
        text: document.source.slice(range.start, range.end)
      });
    }
    if ('children' in node) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  visit(document.root);
  return facts;
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
      '        value:',
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

  it('keeps structural-fed rulesets and declarations as string-backed core nodes before semantic materialization', () => {
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
    expect(types).toContain('selector: \'.a\'');
    expect(types).toContain('(Declaration');
    expect(types).toContain('name: \'color\'');
    expect(types).toContain('value:\n          [\'blue\']');
    expect(types).not.toContain('(BasicSelector');
    expect(types).not.toContain('(ProgressiveDeclaration');
    expect(types).not.toContain('name: (Any \'color\')');
    expect(types).not.toContain('value: (Any \'blue\')');
  });

  it('parses thin structure targets into string-backed core nodes that render and serialize without eager field materialization', async () => {
    const targets: ThinStructureTarget[] = [
      {
        name: 'plain literal rule',
        source: '.a { color: blue; }\n',
        renderedSnippets: ['.a', 'color: blue'],
        thinTypeSnippets: [
          'selector: \'.a\'',
          'name: \'color\'',
          'value:',
          '[\'blue\']'
        ],
        forbiddenTypeSnippets: [
          '(BasicSelector',
          'name: (Any \'color\')',
          'value: (Any \'blue\')'
        ],
        fieldRangeFacts: [
          { nodeKind: 'rule', field: 'selector', kind: 'selector', text: '.a' },
          { nodeKind: 'declaration', field: 'name', kind: 'declaration-name', text: 'color' },
          { nodeKind: 'declaration', field: 'value', kind: 'value', text: 'blue' }
        ],
        progressiveNodes: 2
      },
      {
        name: 'ordered literal declarations',
        source: '.a { width: 1px; color: blue; }\n',
        renderedSnippets: ['width: 1px', 'color: blue'],
        thinTypeSnippets: [
          'selector: \'.a\'',
          'name: \'width\'',
          'value:',
          '[\'1px\']',
          'name: \'color\'',
          '[\'blue\']'
        ],
        forbiddenTypeSnippets: [
          '(BasicSelector',
          'value: (Any \'1px\')',
          'value: (Any \'blue\')'
        ],
        fieldRangeFacts: [
          { nodeKind: 'rule', field: 'selector', kind: 'selector', text: '.a' },
          { nodeKind: 'declaration', field: 'name', kind: 'declaration-name', text: 'width' },
          { nodeKind: 'declaration', field: 'value', kind: 'value', text: '1px' },
          { nodeKind: 'declaration', field: 'name', kind: 'declaration-name', text: 'color' },
          { nodeKind: 'declaration', field: 'value', kind: 'value', text: 'blue' }
        ],
        progressiveNodes: 3
      },
      {
        name: 'nested ordinary rule',
        source: '.a { color: blue; .b { width: 1px; } }\n',
        renderedSnippets: ['.a', '.b', 'color: blue', 'width: 1px'],
        thinTypeSnippets: [
          'selector: \'.a\'',
          'selector: \'.b\'',
          'name: \'color\'',
          'name: \'width\''
        ],
        forbiddenTypeSnippets: [
          '(BasicSelector',
          'value: (Any \'blue\')',
          'value: (Any \'1px\')'
        ],
        fieldRangeFacts: [
          { nodeKind: 'rule', field: 'selector', kind: 'selector', text: '.a' },
          { nodeKind: 'declaration', field: 'name', kind: 'declaration-name', text: 'color' },
          { nodeKind: 'declaration', field: 'value', kind: 'value', text: 'blue' },
          { nodeKind: 'rule', field: 'selector', kind: 'selector', text: '.b' },
          { nodeKind: 'declaration', field: 'name', kind: 'declaration-name', text: 'width' },
          { nodeKind: 'declaration', field: 'value', kind: 'value', text: '1px' }
        ],
        progressiveNodes: 4
      },
      {
        name: 'custom property string value',
        source: '.a { --raw: { token: "}"; }; color: blue; }\n',
        renderedSnippets: ['--raw: { token: "}"; }', 'color: blue'],
        thinTypeSnippets: [
          'selector: \'.a\'',
          'name: \'--raw\'',
          'value:',
          '[\'{ token: "}"; }\']',
          'name: \'color\''
        ],
        forbiddenTypeSnippets: [
          '(BasicSelector',
          'name: (Any \'--raw\')',
          'value: (Any \'{ token: "}"; }\')'
        ],
        fieldRangeFacts: [
          { nodeKind: 'rule', field: 'selector', kind: 'selector', text: '.a' },
          { nodeKind: 'declaration', field: 'name', kind: 'declaration-name', text: '--raw' },
          { nodeKind: 'declaration', field: 'value', kind: 'value', text: '{ token: "}"; }' },
          { nodeKind: 'declaration', field: 'name', kind: 'declaration-name', text: 'color' },
          { nodeKind: 'declaration', field: 'value', kind: 'value', text: 'blue' }
        ],
        progressiveNodes: 3
      },
      {
        name: 'at-rule with raw prelude',
        source: '@media screen { .a { color: blue; } }\n',
        renderedSnippets: ['@media screen', '.a', 'color: blue'],
        thinTypeSnippets: [
          'name: \'@media\'',
          'prelude: \'screen\'',
          'selector: \'.a\'',
          'name: \'color\'',
          'value:',
          '[\'blue\']'
        ],
        forbiddenTypeSnippets: [
          '(BasicSelector',
          'name: (Any [role=atkeyword] \'@media\')',
          'prelude: (Any \'screen\')',
          'value: (Any \'blue\')'
        ],
        fieldRangeFacts: [
          { nodeKind: 'at-rule', field: 'name', kind: 'at-rule-name', text: '@media' },
          { nodeKind: 'at-rule', field: 'prelude', kind: 'prelude', text: 'screen' },
          { nodeKind: 'rule', field: 'selector', kind: 'selector', text: '.a' },
          { nodeKind: 'declaration', field: 'name', kind: 'declaration-name', text: 'color' },
          { nodeKind: 'declaration', field: 'value', kind: 'value', text: 'blue' }
        ],
        progressiveNodes: 3
      }
    ];

    for (const target of targets) {
      const baseline = await new Compiler().renderString(target.source, { language: 'less' });
      const probePlugin = lessPlugin({
        scannerFirstProbe: {
          structuralFedPrototype: true
        }
      });
      const rendered = await new Compiler({
        compile: { plugins: [probePlugin] }
      }).renderString(target.source, { language: 'less' });

      expect(rendered, target.name).toBe(baseline);
      for (const snippet of target.renderedSnippets) {
        expect(rendered, target.name).toContain(snippet);
      }
      expect(probePlugin.lastScannerFirstPrototype, target.name).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes: target.progressiveNodes,
        actualParses: 0,
        requestedIslands: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind, target.name).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind, target.name).toEqual({});

      const parseResult = probePlugin.safeParse(`/virtual/thin-${target.name}.less`, target.source);
      expect(parseResult.errors, target.name).toEqual([]);
      const types = serializeRuntimeTypes(parseResult.tree!);
      for (const snippet of target.thinTypeSnippets) {
        expect(types, target.name).toContain(snippet);
      }
      for (const snippet of target.forbiddenTypeSnippets) {
        expect(types, target.name).not.toContain(snippet);
      }

      const structuralDocument = probePlugin.structureParse(`/virtual/thin-${target.name}.less`, target.source);
      expect(collectFieldRangeFacts(structuralDocument), target.name)
        .toEqual(expect.arrayContaining(target.fieldRangeFacts));
    }
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

  it('feeds parent-scope blocks through structural parse as string Rules containers', () => {
    const source = '.a { & { color: blue; } }\n';
    const probePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const parseResult = probePlugin.safeParse('/virtual/parent-scope.less', source);

    expect(parseResult.errors).toEqual([]);
    expect(parseResult.tree!.toTrimmedString()).toBe('.a {\n  color: blue;\n}\n');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 3,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const types = serializeRuntimeTypes(parseResult.tree!);
    expect(types).toContain('(Ruleset');
    expect(types).toContain('selector: \'.a\'');
    expect(types).toContain('(Rules');
    expect(types).toContain('name: \'color\'');
    expect(types).toContain('value:');
    expect(types).toContain('[\'blue\']');
    expect(types).not.toContain('selector: \'&\'');
    expect(types).not.toContain('(BasicSelector');
    expect(types).not.toContain('value: (Any \'blue\')');
  });

  it('feeds bare scope blocks through structural parse as string Rules containers', () => {
    const source = '{ @brand: blue; .a { color: @brand; } }\n';
    const probePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const parseResult = probePlugin.safeParse('/virtual/bare-scope.less', source);

    expect(parseResult.errors).toEqual([]);
    expect(parseResult.tree!.toTrimmedString()).toBe('.a {\n  color: blue;\n}\n');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 4,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const types = serializeRuntimeTypes(parseResult.tree!);
    expect(types).toContain('(Rules');
    expect(types).toContain('(ProgressiveVariableDeclaration');
    expect(types).toContain('selector: \'.a\'');
    expect(types).toContain('name: \'color\'');
    expect(types).not.toContain('selector: \'\'');
    expect(types).not.toContain('(BasicSelector');
    expect(types).not.toContain('value: (Any \'blue\')');
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
      expect(types).toContain('selector: \'.a\'');
      expect(types).toContain(`name: '${property}'`);
      expect(types).toContain(`['${value}']`);
      expect(types).not.toContain('value: (Sequence');
      expect(types).not.toContain('value: (List');
      expect(types).not.toContain('value: (Any');
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
      expect(types).toContain(`name: '${name}'`);
      expect(types).toContain('value:');
      expect(types).toContain(`['${value}']`);
      expect(types).not.toContain(`name: (Any '${name}')`);
      expect(types).not.toContain('value: (');
    }
  });

  it('feeds quoted and url declaration values through structural parse without value materialization', async () => {
    const cases = [
      { property: 'content', value: '"hello } world"' },
      { property: 'background', value: 'url(/assets/a}/b.png)' },
      { property: 'background', value: 'url(/assets/a,b.png)' },
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
      expect(types).toContain(`name: '${property}'`);
      expect(types).toContain('value:');
      expect(types).toContain(`['${value}']`);
      expect(types).not.toContain('value: (');
    }
  });

  it('feeds comma-separated flat declaration values through structural parse without value materialization', async () => {
    const source = '.a { text-shadow: -1px -1px 1px red, 6px 5px 5px yellow; box-shadow: 0 0 1px red, 0 0 2px blue; }\n';
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
    expect(rendered).toContain('text-shadow: -1px -1px 1px red, 6px 5px 5px yellow');
    expect(rendered).toContain('box-shadow: 0 0 1px red, 0 0 2px blue');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 3,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/comma-values.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
    expect(types).toContain('name: \'text-shadow\'');
    expect(types).toContain('[\'-1px -1px 1px red, 6px 5px 5px yellow\']');
    expect(types).toContain('name: \'box-shadow\'');
    expect(types).toContain('[\'0 0 1px red, 0 0 2px blue\']');
    expect(types).not.toContain('value: (');
  });

  it('feeds CSS grid declaration values through structural parse without value materialization', async () => {
    const source = [
      '.wrapper {',
      '  display: grid;',
      '  grid-column: container-left / span 1;',
      '  grid-template-columns: [col1-start] 9fr [col1-end] 10px [col2-start] 3fr [col2-end];',
      '  grid-template-rows: repeat(14, [gutter] 10px [row] 60px);',
      '}',
      ''
    ].join('\n');
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
    expect(rendered).toContain('grid-column: container-left / span 1');
    expect(rendered).toContain('grid-template-columns: [col1-start] 9fr [col1-end] 10px [col2-start] 3fr [col2-end]');
    expect(rendered).toContain('grid-template-rows: repeat(14, [gutter] 10px [row] 60px)');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 5,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/css-grid-values.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
    expect(types).toContain('name: \'grid-column\'');
    expect(types).toContain('[\'container-left / span 1\']');
    expect(types).toContain('name: \'grid-template-columns\'');
    expect(types).toContain('[\'[col1-start] 9fr [col1-end] 10px [col2-');
    expect(types).toContain('name: \'grid-template-rows\'');
    expect(types).toContain('[\'repeat(14, [gutter] 10px [row] 60px)\']');
    expect(types).toContain('value:');
    expect(types).not.toContain('value: (');
  });

  it('falls back for CSS grid declaration values with Less variable-like tokens', async () => {
    const source = '@cols: 1fr;\n.wrapper { grid-template-columns: repeat(2, @cols); }\n';
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
      fallbackReason: 'string declaration values with Less variable-like tokens are not in the scanner-native structural-fed subset',
      fallbackFullTreeMaterializations: 1,
      progressiveNodes: 0,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
  });

  it('falls back for CSS grid declaration values with unproven functions', async () => {
    const source = '.wrapper { grid-template-columns: minmax(10px, 1fr) 2fr; }\n';
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
      fallbackReason: 'declaration value is outside the scanner-native structural-fed subset',
      fallbackFullTreeMaterializations: 1,
      progressiveNodes: 0,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
  });

  it('feeds single-line CSS grid template areas through structural parse without value materialization', async () => {
    const source = '.wrapper { display: grid; grid-template-areas: "head head" "nav main"; }\n';
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
    expect(rendered).toContain('grid-template-areas: "head head" "nav main"');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 3,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/css-grid-template-areas.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
    expect(types).toContain('name: \'grid-template-areas\'');
    expect(types).toContain('[\'"head head" "nav main"\']');
    expect(types).toContain('value:');
    expect(types).not.toContain('value: (');
  });

  it('feeds multiline CSS grid template areas through structural parse without value materialization', async () => {
    const source = [
      '.wrapper {',
      '  display: grid;',
      '  grid-template-areas:',
      '    "header header header"',
      '    "content . sidebar"',
      '    "footer footer footer";',
      '}',
      ''
    ].join('\n');
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
    expect(rendered).toContain(baseline.match(/grid-template-areas:\n[ \t]+"header header header"/u)?.[0]);
    expect(probePlugin.lastScannerFirstPrototype?.fallbackReason).toBeUndefined();
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 3,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/css-grid-template-areas-multiline.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
    expect(types).toContain('name: \'grid-template-areas\'');
    expect(types).toContain('value:');
    expect(types).not.toContain('value: (');
  });

  it('feeds simple Less function values through progressive declaration segments', async () => {
    const cases = [
      {
        source: '.a { color: lighten(#000, 10%); }\n',
        renderedSnippet: 'color: #1a1a1a',
        typeSnippets: [
          'selector: \'.a\'',
          'name: \'color\'',
          'value:',
          '(Call',
          'key: \'lighten\'',
          '(Color',
          'node: \'#000\'',
          '(Dimension',
          'number: 10',
          'unit: \'%\''
        ],
        forbiddenTypeSnippets: [
          '(BasicSelector',
          'name: (Any [role=property] \'color\')',
          'value: (Any'
        ]
      },
      {
        source: '.a { color: rgb(10, 20, 30); }\n',
        renderedSnippet: 'color: rgb(10, 20, 30)',
        typeSnippets: [
          'selector: \'.a\'',
          'name: \'color\'',
          'value:',
          '(Call',
          'key: \'rgb\'',
          '(Num 10)',
          '(Num 20)',
          '(Num 30)'
        ],
        forbiddenTypeSnippets: [
          '(BasicSelector',
          'name: (Any [role=property] \'color\')',
          'value: (Any'
        ]
      },
      {
        source: '.a { color: darken(#fff, 10%); }\n',
        renderedSnippet: 'color: #e6e6e6',
        typeSnippets: [
          'selector: \'.a\'',
          'name: \'color\'',
          'value:',
          '(Call',
          'key: \'darken\'',
          '(Color',
          'node: \'#fff\'',
          '(Dimension',
          'number: 10',
          'unit: \'%\''
        ],
        forbiddenTypeSnippets: [
          '(BasicSelector',
          'name: (Any [role=property] \'color\')',
          'value: (Any'
        ]
      },
      {
        source: '.a { color: rgba(10, 20, 30, 50%); }\n',
        renderedSnippet: 'color: rgba(10, 20, 30, 50%)',
        typeSnippets: [
          'selector: \'.a\'',
          'name: \'color\'',
          'value:',
          '(Call',
          'key: \'rgba\'',
          '(Num 10)',
          '(Num 20)',
          '(Num 30)',
          '(Dimension',
          'number: 50',
          'unit: \'%\''
        ],
        forbiddenTypeSnippets: [
          '(BasicSelector',
          'name: (Any [role=property] \'color\')',
          'value: (Any'
        ]
      },
      {
        source: '.a { transform: scaleX(1); }\n',
        renderedSnippet: 'transform: scaleX(1)',
        typeSnippets: [
          'selector: \'.a\'',
          'name: \'transform\'',
          'value:',
          '(Call',
          'key: \'scaleX\'',
          '(Num 1)'
        ],
        forbiddenTypeSnippets: [
          '(BasicSelector',
          'name: (Any [role=property] \'transform\')',
          'value: (Any'
        ]
      }
    ];

    for (const { source, renderedSnippet, typeSnippets, forbiddenTypeSnippets } of cases) {
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
      expect(rendered).toContain(renderedSnippet);
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes: 2,
        actualParses: 0,
        requestedIslands: 0,
        promotedBytes: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parseResult = probePlugin.safeParse('/virtual/function-value.less', source);
      expect(parseResult.errors).toEqual([]);
      const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
      for (const snippet of typeSnippets) {
        expect(types).toContain(snippet);
      }
      for (const snippet of forbiddenTypeSnippets) {
        expect(types).not.toContain(snippet);
      }
    }
  });

  it('falls back for function values outside the scanner-native boundary', async () => {
    const cases = [
      '.a { transform: scaleX(1, 2); }\n',
      '.a { transform: scaleX(1px); }\n',
      '.a { transform: scaleX(#fff); }\n',
      '@x: 1;\n.a { transform: scaleX(@x); }\n',
      '.a { transform: scaleX(calc(1)); }\n',
      '.a { transform: scaleX("1"); }\n',
      '.a { transform: scaleX(/* nope */ 1); }\n',
      '.a { color: rgb(1); }\n',
      '.a { color: rgba(10, 20, 30, 0.5); }\n',
      '.a { color: lighten(1); }\n',
      '.a { color: darken(#fff); }\n'
    ];

    for (const source of cases) {
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
        fallbackFullTreeMaterializations: 1,
        progressiveNodes: 0,
        actualParses: 0,
        requestedIslands: 0,
        promotedBytes: 0
      });
    }
  });

  it('feeds mixed string and function declaration values through progressive segments', async () => {
    const source = '.a { box-shadow: 0 0 2px lighten(#000, 10%); }\n';
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
    expect(rendered).toContain('box-shadow: 0 0 2px #1a1a1a');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 2,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/mixed-function-value.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
    expect(types).toContain('selector: \'.a\'');
    expect(types).toContain('name: \'box-shadow\'');
    expect(types).toContain('value:');
    expect(types).toContain('\'0 0 2px \'');
    expect(types).toContain('Call]');
    expect(types).not.toContain('(BasicSelector');
    expect(types).not.toContain('value: (Any');
    expect(types).not.toContain('name: (Any [role=property] \'box-shadow\')');

    const ruleset = parseResult.tree!.rules[0];
    expect(ruleset).toBeInstanceOf(Ruleset);
    if (!(ruleset instanceof Ruleset)) {
      throw new Error('Expected structural-fed root child to be a Ruleset.');
    }
    const declaration = ruleset.rules[0];
    expect(declaration).toBeInstanceOf(Declaration);
    if (!(declaration instanceof Declaration)) {
      throw new Error('Expected structural-fed ruleset child to be a Declaration.');
    }
    const segments = declaration.value;
    expect(segments?.[0]).toBe('0 0 2px ');
    expect(segments?.[1]).toBeInstanceOf(Node);
    const callSegment = segments?.[1];
    if (!(callSegment instanceof Node)) {
      throw new Error('Expected mixed string value segment to contain a Call node.');
    }
    const callTypes = serializeRuntimeTypes(callSegment);
    expect(callTypes).toContain('(Call');
    expect(callTypes).toContain('key: \'lighten\'');
    expect(callTypes).toContain('(Color');
    expect(callTypes).toContain('node: \'#000\'');
    expect(callTypes).toContain('(Dimension');
    expect(callTypes).toContain('number: 10');
    expect(callTypes).toContain('unit: \'%\'');
  });

  it('drops Less line-comment trivia on the structural-fed path without materializing islands', async () => {
    const cases = [
      '// root note\n.a { color: blue; }\n',
      '.a { // body note\n  color: blue;\n}\n',
      '.a { color: blue; // trailing note\n  width: 1px; }\n'
    ];

    for (const source of cases) {
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
      expect(rendered).not.toContain('//');
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        actualParses: 0,
        requestedIslands: 0,
        promotedBytes: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});
    }
  });

  it('feeds standalone block comments through structural parse as comment nodes', async () => {
    const cases = [
      {
        source: '/* keep */\n.a { color: blue; }\n',
        progressiveNodes: 3
      },
      {
        source: '.a {\n  /* keep */\n  color: blue;\n}\n',
        progressiveNodes: 3
      },
      {
        source: '@media screen {\n  /* keep */\n  .a { color: blue; }\n}\n',
        progressiveNodes: 4
      }
    ];

    for (const { source, progressiveNodes } of cases) {
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
      expect(rendered).toContain('/* keep */');
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes,
        actualParses: 0,
        requestedIslands: 0,
        promotedBytes: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parseResult = probePlugin.safeParse('/virtual/block-comment.less', source);
      expect(parseResult.errors).toEqual([]);
      const types = serializeRuntimeTypes(parseResult.tree!);
      expect(types).toContain('(Comment \'/* keep */\')');
      expect(types).not.toContain('(BasicSelector');
      expect(types).not.toContain('value: (Any \'blue\')');
    }
  });

  it('falls back for inline block comments until exact placement is proven', async () => {
    const source = '/* keep */ .a { color: blue; }\n';
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
    expect(rendered).toContain('/* keep */');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'canonical-fallback',
      fallbackReason: 'inline block comments require canonical trivia preservation',
      fallbackFullTreeMaterializations: 1,
      progressiveNodes: 0,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
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
      expect(types).toContain('selector: \'.a\'');
      expect(types).toContain(`name: '${property}'`);
      expect(types).toContain(`['${value}']`);
      expect(types).toContain('important: \'!important\'');
      expect(types).not.toContain('value: (Sequence');
      expect(types).not.toContain('value: (List');
      expect(types).not.toContain('value: (Any');
      expect(types).not.toContain('important: (Any');
    }
  });

  it('feeds spaced and case-variant important declarations through structural parse without value materialization', async () => {
    const cases = [
      '! important',
      '!IMPORTANT'
    ];

    for (const sourceImportant of cases) {
      const source = `.a { color: blue ${sourceImportant}; }\n`;
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
      expect(rendered).toContain(`color: blue ${sourceImportant}`);
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes: 2,
        actualParses: 0,
        requestedIslands: 0,
        promotedBytes: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parseResult = probePlugin.safeParse('/virtual/raw-important-spelling-declaration.less', source);
      expect(parseResult.errors).toEqual([]);
      const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
      expect(types).toContain('(Ruleset');
      expect(types).toContain('selector: \'.a\'');
      expect(types).toContain('name: \'color\'');
      expect(types).toContain('[\'blue\']');
      expect(types).toContain(`important: '${sourceImportant}'`);
      expect(types).not.toContain('value: (Any');
      expect(types).not.toContain('important: (Any');
    }
  });

  it('feeds Less merge declarations through structural parse', async () => {
    const source = '.a { padding+_: 10px; padding+_: 8px; margin+: 1px; margin+: 2px; }\n';
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
    expect(rendered).toContain('padding: 10px 8px');
    expect(rendered).toContain('margin: 1px, 2px');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 5,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/merge-declarations.less', source);
    expect(parseResult.errors).toEqual([]);
    const ruleset = parseResult.tree!.rules[0];
    expect(ruleset).toBeInstanceOf(Ruleset);
    if (!(ruleset instanceof Ruleset)) {
      throw new Error('Expected structural-fed root child to be a Ruleset.');
    }
    const [paddingA, paddingB, marginA, marginB] = ruleset.rules;
    for (const declaration of [paddingA, paddingB, marginA, marginB]) {
      expect(declaration).toBeInstanceOf(Declaration);
      if (!(declaration instanceof Declaration)) {
        throw new Error('Expected merge declaration to stay a Declaration.');
      }
    }
    expect(paddingA.options.assign).toBe(AssignmentType.MergeSequence);
    expect(paddingB.options.assign).toBe(AssignmentType.MergeSequence);
    expect(marginA.options.assign).toBe(AssignmentType.MergeList);
    expect(marginB.options.assign).toBe(AssignmentType.MergeList);
    const types = serializeRuntimeTypes(ruleset);
    expect(types).toContain('name: \'padding\'');
    expect(types).toContain('name: \'margin\'');
    expect(types).not.toContain('name: \'padding+_\'');
    expect(types).not.toContain('name: \'margin+\'');
    expect(types).not.toContain('(BasicSelector');
    expect(types).not.toContain('value: (Any');
  });

  it('feeds adjacent compound selectors through structural parse', async () => {
    const cases = [
      '.a.b',
      'button.primary',
      '.-utility.active',
      ':root',
      'button:hover',
      'button:hover.active',
      '[data-kind]',
      'button[data-kind="primary"].active',
      'button[data-label="hello, world"].active'
    ];

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
      const parsedRule = parseResult.tree!.rules[0];
      if (!(parsedRule instanceof Ruleset)) {
        throw new Error('Expected structural-fed selector proof to produce a string Ruleset.');
      }
      expect(parsedRule.valueOf()).toBe(canonicalSelectorText(selector));
      const types = serializeRuntimeTypes(parsedRule);
      expect(types).toContain('(Ruleset');
      expect(types).not.toContain('(BasicSelector');
      expect(types).not.toContain('(PseudoSelector');
      expect(types).not.toContain('(AttributeSelector');
    }
  });

  it('feeds simple selector lists through structural parse', async () => {
    const cases = ['.a, .b', '.a, button.primary', '.a, button:hover', '.a, button[data-kind]', '.a, button[data-label="hello, world"]'];

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
      expect(rendered).toContain('color: blue');
      expect(probePlugin.lastScannerFirstPrototype?.fallbackReason).toBeUndefined();
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes: 2,
        actualParses: 0,
        requestedIslands: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parseResult = probePlugin.safeParse('/virtual/selector-list.less', source);
      expect(parseResult.errors).toEqual([]);
      const parsedRule = parseResult.tree!.rules[0];
      if (!(parsedRule instanceof Ruleset)) {
        throw new Error('Expected structural-fed selector-list proof to produce a string Ruleset.');
      }
      expect(parsedRule.valueOf()).toBe(canonicalSelectorText(selector));
      const types = serializeRuntimeTypes(parsedRule);
      expect(types).toContain('(Ruleset');
      expect(types).not.toContain('(BasicSelector');
      expect(types).not.toContain('(PseudoSelector');
      expect(types).not.toContain('(AttributeSelector');
    }
  });

  it('feeds cheap complex selectors through structural parse', async () => {
    const cases = [
      '.a .b',
      'button > .icon.active',
      '.a:hover > button.primary',
      '.a[data-kind] > button.primary',
      '.a[data-label="hello world"] > button.primary',
      '.a + .b',
      '.a ~ .b',
      '.a > .b, .c[data-kind] + .d'
    ];

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
      expect(rendered).toContain('color: blue');
      expect(probePlugin.lastScannerFirstPrototype?.fallbackReason).toBeUndefined();
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes: 2,
        actualParses: 0,
        requestedIslands: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parseResult = probePlugin.safeParse('/virtual/complex-selector.less', source);
      expect(parseResult.errors).toEqual([]);
      const parsedRule = parseResult.tree!.rules[0];
      if (!(parsedRule instanceof Ruleset)) {
        throw new Error('Expected structural-fed complex-selector proof to produce a string Ruleset.');
      }
      expect(parsedRule.valueOf()).toBe(canonicalSelectorText(selector));
      const types = serializeRuntimeTypes(parsedRule);
      expect(types).toContain('(Ruleset');
      expect(types).not.toContain('(BasicSelector');
      expect(types).not.toContain('(AttributeSelector');
    }
  });

  it('feeds simple exact Less extends through structural parse without parsing unrelated fields', async () => {
    const source = '.base { color: blue; }\n.button:extend(.base) { width: 1px; }\n';
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
    expect(rendered).toContain('.base,\n.button');
    expect(rendered).toContain('color: blue');
    expect(rendered).toContain('width: 1px');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 5,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/simple-extend.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!);
    expect(types).toContain('selector: \'.base\'');
    expect(types).toContain('selector: \'.button\'');
    expect(types).toContain('(Extend');
    expect(types).toContain('(BasicSelector \'.base\')');
    expect(types).toContain('name: \'color\'');
    expect(types).toContain('name: \'width\'');
    expect(types).toContain('[\'blue\']');
    expect(types).toContain('[\'1px\']');
    expect(types).not.toContain('selector: \'.button:extend(.base)\'');
    expect(types).not.toContain('value: (Any');
  });

  it('feeds simple all Less extends through structural parse without parsing unrelated fields', async () => {
    const source = '.base { color: blue; }\n.button:extend(.base all) { width: 1px; }\n';
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
    expect(rendered).toContain('.base,\n.button');
    expect(rendered).toContain('color: blue');
    expect(rendered).toContain('width: 1px');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 5,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/all-extend.less', source);
    expect(parseResult.errors).toEqual([]);
    const ruleset = parseResult.tree!.rules[1];
    if (!(ruleset instanceof Ruleset)) {
      throw new Error('Expected structural-fed all extend source to produce a Ruleset.');
    }
    const extendNode = ruleset.rules[0];
    if (!(extendNode instanceof Extend)) {
      throw new Error('Expected structural-fed all extend source to produce an Extend node.');
    }
    expect(extendNode.flag).toBe(ExtendFlag.All);
    const types = serializeRuntimeTypes(parseResult.tree!);
    expect(types).toContain('selector: \'.base\'');
    expect(types).toContain('selector: \'.button\'');
    expect(types).toContain('(Extend');
    expect(types).toContain('(BasicSelector \'.base\')');
    expect(types).toContain('name: \'color\'');
    expect(types).toContain('name: \'width\'');
    expect(types).toContain('[\'blue\']');
    expect(types).toContain('[\'1px\']');
    expect(types).not.toContain('selector: \'.button:extend(.base all)\'');
    expect(types).not.toContain('value: (Any');
  });

  it('feeds complex-target Less extends through structural parse without parsing unrelated fields', async () => {
    const source = '.base .child { color: blue; }\n.button:extend(.base .child) { width: 1px; }\n';
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
    expect(rendered).toContain('.base .child,\n.button');
    expect(rendered).toContain('color: blue');
    expect(rendered).toContain('width: 1px');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 5,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/complex-target-extend.less', source);
    expect(parseResult.errors).toEqual([]);
    const ruleset = parseResult.tree!.rules[1];
    if (!(ruleset instanceof Ruleset)) {
      throw new Error('Expected structural-fed complex-target extend source to produce a Ruleset.');
    }
    const extendNode = ruleset.rules[0];
    if (!(extendNode instanceof Extend)) {
      throw new Error('Expected structural-fed complex-target extend source to produce an Extend node.');
    }
    expect(extendNode.target.type).toBe('ComplexSelector');
    const types = serializeRuntimeTypes(parseResult.tree!);
    expect(types).toContain('(ComplexSelector');
    expect(types).toContain('[\'.base\']');
    expect(types).toContain('[\'.child\']');
    expect(types).toContain('selector: \'.button\'');
    expect(types).toContain('(Extend');
    expect(types).toContain('(ComplexSelector');
    expect(types).toContain('(BasicSelector \'.base\')');
    expect(types).toContain('(Combinator \' \')');
    expect(types).toContain('(BasicSelector \'.child\')');
    expect(types).toContain('name: \'color\'');
    expect(types).toContain('name: \'width\'');
    expect(types).not.toContain('selector: \'.button:extend(.base .child)\'');
    expect(types).not.toContain('value: (Any');
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

  it('feeds conservative string Less variable values through structural parse', async () => {
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
      expect(treeTypes).toContain(`['${value}']`);
      expect(treeTypes).not.toContain('value: (');

      const ruleTypes = serializeRuntimeTypes(parseResult.tree!.rules[declarationRuleIndex]);
      expect(ruleTypes).toContain('value:');
      expect(ruleTypes).toContain(`['${value}']`);
      expect(ruleTypes).not.toContain('value: (');
    }
  });

  it('feeds simple Less arithmetic through structural parse without value materialization', async () => {
    const cases = [
      {
        source: '@gap: 4px;\n.a { width: @gap + 2px; }\n',
        expected: 'width: 6px'
      },
      {
        source: '@gap: 4px;\n.a { width: 2px + @gap; }\n',
        expected: 'width: 6px'
      },
      {
        source: '@gap: 4px;\n.a { width: @gap - 2px; }\n',
        expected: 'width: 2px'
      },
      {
        source: '@n: 4;\n.a { z-index: @n + 2; }\n',
        expected: 'z-index: 6'
      },
      {
        source: '@gap: 4px;\n.a { width: @gap + 2px !important; }\n',
        expected: 'width: 6px !important'
      }
    ];

    for (const { source, expected } of cases) {
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
      expect(rendered).toContain(expected);
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes: 3,
        actualParses: 0,
        requestedIslands: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parseResult = probePlugin.safeParse('/virtual/simple-arithmetic.less', source);
      expect(parseResult.errors).toEqual([]);
      const types = serializeRuntimeTypes(parseResult.tree!.rules[1]);
      expect(types).toContain('value:');
      expect(types).not.toContain('value: (Operation');
      expect(types).not.toContain('value: (Reference');
      expect(types).not.toContain('value: (Dimension');
    }
  });

  it('falls back for richer Less arithmetic so canonical math behavior stays intact', async () => {
    const cases = [
      {
        source: '@gap: 4px;\n.a { width: @gap + 2em; }\n',
        expected: 'calc(1px + 1em)'
      },
      {
        source: '@gap: 4px;\n.a { width: @gap + 2px + 1px; }\n',
        expected: 'width: 7px'
      },
      {
        source: '@gap: 4px;\n.a { width: (@gap + 2px); }\n',
        expected: 'width: 6px'
      },
      {
        source: '@gap: 4px;\n.a { width: @gap * 2; }\n',
        expected: 'width: 8px'
      }
    ];

    for (const { source, expected } of cases) {
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
      expect(rendered).toContain(expected);
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'canonical-fallback',
        fallbackReason: 'string declaration values with Less variable-like tokens are not in the scanner-native structural-fed subset',
        fallbackFullTreeMaterializations: 1,
        progressiveNodes: 0,
        actualParses: 0,
        requestedIslands: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});
    }
  });

  it('falls back for scanner-native arithmetic when Less math mode requires parens', async () => {
    const source = '@gap: 4px;\n.a { width: @gap + 2px; }\n';
    const baseline = await new Compiler({
      compile: {
        plugins: [lessPlugin({ mathMode: 'parens' })]
      }
    }).renderString(source, { language: 'less' });
    const probePlugin = lessPlugin({
      mathMode: 'parens',
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const rendered = await new Compiler({
      compile: { plugins: [probePlugin] }
    }).renderString(source, { language: 'less' });

    expect(rendered).toBe(baseline);
    expect(rendered).toContain('width: 4px + 2px');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'canonical-fallback',
      fallbackReason: 'string declaration values with Less variable-like tokens are not in the scanner-native structural-fed subset',
      fallbackFullTreeMaterializations: 1,
      progressiveNodes: 0,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});
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

  it('feeds hoisted Less variable references through structural parse', async () => {
    const cases = [
      {
        source: '.a { color: @brand; .b { border-color: @brand; } @brand: blue; }\n',
        expected: ['color: blue', 'border-color: blue'],
        progressiveNodes: 5
      },
      {
        source: '.a { color: @brand; @brand: blue; @brand: red; }\n',
        expected: ['color: red'],
        progressiveNodes: 4
      },
      {
        source: '@brand: blue; .a { color: @brand; @brand: red; .b { color: @brand; } }\n',
        expected: ['color: red'],
        progressiveNodes: 6
      }
    ];

    for (const { source, expected, progressiveNodes } of cases) {
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
      for (const expectedText of expected) {
        expect(rendered).toContain(expectedText);
      }
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes,
        actualParses: 0,
        requestedIslands: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});
    }
  });

  it('feeds root-level hoisted Less variable references through structural parse', async () => {
    const source = '.a { color: @brand; }\n@brand: blue;\n';
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

  it('feeds nested ampersand pseudo selectors through structural parse', async () => {
    const source = '.a { &:focus { color: blue; } }\n';
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
    expect(rendered).toContain('&:focus');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 3,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/nested-ampersand-pseudo.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
    expect(types).toContain('(Ruleset');
    expect(types).toContain('selector: \'.a\'');
    expect(types).toContain('selector: \'&:focus\'');
    expect(types).toContain('name: \'color\'');
    expect(types).not.toContain('(Ampersand');
    expect(types).not.toContain('(PseudoSelector');
    expect(types).not.toContain('value: (Any \'blue\')');
  });

  it('feeds nested leading-combinator selectors through structural parse', async () => {
    const source = [
      '#first {',
      '  > #second .two {',
      '    width: 50px;',
      '    + #third {',
      '      color: purple;',
      '    }',
      '  }',
      '}',
      ''
    ].join('\n');
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
    expect(rendered).toContain('> #second .two');
    expect(rendered).toContain('+ #third');
    expect(probePlugin.lastScannerFirstPrototype?.fallbackReason).toBeUndefined();
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/nested-leading-combinator.less', source);
    expect(parseResult.errors).toEqual([]);
    const rootRule = parseResult.tree!.rules[0];
    if (!(rootRule instanceof Ruleset)) {
      throw new Error('Expected structural-fed root selector proof to produce a string Ruleset.');
    }
    const childRule = rootRule.rules[0];
    if (!(childRule instanceof Ruleset)) {
      throw new Error('Expected structural-fed leading-combinator proof to produce a string Ruleset.');
    }
    expect(childRule.valueOf()).toBe(canonicalSelectorText('> #second .two'));
    const nestedRule = childRule.rules[1];
    if (!(nestedRule instanceof Ruleset)) {
      throw new Error('Expected structural-fed nested leading-combinator proof to produce a string Ruleset.');
    }
    expect(nestedRule.valueOf()).toBe(canonicalSelectorText('+ #third'));
    const types = serializeRuntimeTypes(parseResult.tree!);
    expect(types).toContain('(Combinator \'>\')');
    expect(types).toContain('(Combinator \'+\')');
    expect(types).toContain('[\'#second\']');
    expect(types).toContain('[\'.two\']');
    expect(types).toContain('[\'#third\']');
  });

  it('skips structural-fed prototype work for import-scoped parse options', () => {
    const source = '.a { color: blue; }\n';
    const cases = [
      { once: true },
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

  it('feeds @charset statement at-rules through structural parse', async () => {
    const source = '@charset "UTF-8";\n.a { color: blue; }\n';
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
    expect(rendered).toContain('@charset "UTF-8"');
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

    const parseResult = probePlugin.safeParse('/virtual/charset.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
    expect(types).toContain('(AtRuleStatement');
    expect(types).toContain('name: \'@charset\'');
    expect(types).toContain('prelude: \'"UTF-8"\'');
    expect(types).not.toContain('name: (Any \'@charset\')');
    expect(types).not.toContain('prelude: (Any \'"UTF-8"\')');
  });

  it('feeds root unknown statement at-rules through structural parse without import or plugin semantics', async () => {
    const source = '@impor "impor-typo-dont-parse-as-@import.less";\n@plugi "plugi-typo-dont-parse-as-@plugin";\n';
    const probePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const rendered = await new Compiler({
      compile: { plugins: [probePlugin] }
    }).renderString(source, { language: 'less' });

    expect(rendered).toBe(source);
    expect(rendered).toContain('@impor "impor-typo-dont-parse-as-@import.less"');
    expect(rendered).toContain('@plugi "plugi-typo-dont-parse-as-@plugin"');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/unknown-statements.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!);
    expect(types).toContain('name: \'@impor\'');
    expect(types).toContain('prelude: \'"impor-typo-dont-parse-as-@import.less"\'');
    expect(types).toContain('name: \'@plugi\'');
    expect(types).toContain('prelude: \'"plugi-typo-dont-parse-as-@plugin"\'');
    expect(types).not.toContain('name: (Any \'@impor\')');
    expect(types).not.toContain('prelude: (Any');
  });

  it('feeds root CSS @import statements through structural parse', async () => {
    const cases = [
      {
        source: '@import "theme.css" screen;\n.a { color: blue; }\n',
        prelude: '"theme.css" screen'
      },
      {
        source: '@import url("https://cdn.example.com/theme.css") screen;\n.a { color: blue; }\n',
        prelude: 'url("https://cdn.example.com/theme.css") screen'
      },
      {
        source: '@import "//cdn.example.com/theme.css";\n.a { color: blue; }\n',
        prelude: '"//cdn.example.com/theme.css"'
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
      expect(rendered).toContain('@import');
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

      const parseResult = probePlugin.safeParse('/virtual/css-import.less', source);
      expect(parseResult.errors).toEqual([]);
      const statement = parseResult.tree!.rules[0];
      const types = serializeRuntimeTypes(statement);
      expect(types).toContain('(AtRuleStatement');
      expect(types).toContain('name: \'@import\'');
      expect(statement.prelude).toBe(prelude);
      expect(types).toContain('prelude: ');
      expect(types).not.toContain('name: (Any \'@import\')');
      expect(types).not.toContain('prelude: (Any');
    }
  });

  it('feeds rule-local Tailwind @apply statements through structural parse', async () => {
    const source = '.box { @apply h-64 w-64; }\n';
    const probePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const rendered = await new Compiler({
      compile: { plugins: [probePlugin] }
    }).renderString(source, { language: 'less' });

    expect(rendered).toBe('.box {\n  @apply h-64 w-64;\n}\n');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parsePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const parseResult = parsePlugin.safeParse('/virtual/tailwind-apply.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!);
    expect(types).toContain('(AtRuleStatement');
    expect(types).toContain('name: \'@apply\'');
    expect(types).toContain('prelude: \'h-64 w-64\'');
    expect(types).toContain('selector: \'.box\'');
    expect(types).not.toContain('prelude: (Any');
    expect(types).not.toContain('(BasicSelector');
  });

  it('keeps duplicate @charset suppression on the structural-fed statement path', async () => {
    const source = '@charset "UTF-8";\n@charset "ISO-8859-1";\n.a { color: blue; }\n';
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
    expect(rendered).toContain('@charset "UTF-8"');
    expect(rendered).not.toContain('ISO-8859-1');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 4,
      actualParses: 0,
      requestedIslands: 0
    });
  });

  it('falls back for import statements with Less import options', async () => {
    const source = '@import (css) "theme.less";\n.a { color: blue; }\n';
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
      fallbackReason: 'import statement prelude is outside the scanner-native structural-fed subset',
      fallbackFullTreeMaterializations: 1,
      progressiveNodes: 0,
      actualParses: 0,
      requestedIslands: 0
    });
  });

  it('falls back for source HTTP url imports until url boundary scanning is proven', async () => {
    const source = '@import url(https://cdn.example.com/theme.css) screen;\n.a { color: blue; }\n';
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
      fallbackReason: 'structural diagnostics are present',
      fallbackFullTreeMaterializations: 1,
      progressiveNodes: 0,
      actualParses: 0,
      requestedIslands: 0
    });
  });

  it('falls back for source url imports outside the quoted CSS-preserved subset', async () => {
    const source = '@import url(theme.css) screen;\n.a { color: blue; }\n';
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
      fallbackReason: 'import statement prelude is outside the scanner-native structural-fed subset',
      fallbackFullTreeMaterializations: 1,
      progressiveNodes: 0,
      actualParses: 0,
      requestedIslands: 0
    });
  });

  it('feeds simple Less imports through structural parse without canonical fallback', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-scanner-first-import-'));
    tempDirs.push(dir);
    const imported = path.join(dir, 'tokens.less');
    const entry = path.join(dir, 'entry.less');
    fs.writeFileSync(imported, '@brand: blue;\n.utility { display: block; }\n');
    fs.writeFileSync(entry, '@import "tokens.less";\n.card { color: @brand; }\n');

    const baseline = await new Compiler().render(entry);
    const probePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const rendered = await new Compiler({
      compile: { plugins: [probePlugin] }
    }).render(entry);

    expect(rendered).toBe(baseline);
    expect(rendered).toContain('.utility');
    expect(rendered).toContain('.card');
    expect(rendered).toContain('color: blue');
    const importedPrototype = probePlugin.scannerFirstPrototypeResults.find(
      result => result.filePath === fs.realpathSync.native(imported)
    );
    const entryPrototype = probePlugin.scannerFirstPrototypeResults.find(
      result => result.filePath === entry
    );
    expect(importedPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 3,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(entryPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 5,
      actualParses: 0,
      requestedIslands: 0
    });
    expect(entryPrototype?.requestsByIslandKind).toEqual({});
    expect(entryPrototype?.requestsByOwnerKind).toEqual({});

    const parsePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const parseResult = parsePlugin.safeParse(entry, fs.readFileSync(entry, 'utf8'));
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!);
    expect(types).toContain('(ProgressiveVariableDeclaration');
    expect(types).toContain('selector: \'.utility\'');
    expect(types).toContain('selector: \'.card\'');
    expect(types).toContain('name: \'color\'');
    expect(types).not.toContain('name: \'@import\'');
    expect(types).not.toContain('(BasicSelector');
    expect(types).not.toContain('value: (Any \'blue\')');
  });

  it('falls back for repeated Less imports until de-dupe semantics are proven', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-scanner-first-import-repeat-'));
    tempDirs.push(dir);
    const imported = path.join(dir, 'tokens.less');
    const entry = path.join(dir, 'entry.less');
    fs.writeFileSync(imported, '.utility { display: block; }\n');
    fs.writeFileSync(entry, '@import "tokens.less";\n@import "tokens.less";\n.card { color: blue; }\n');

    const baseline = await new Compiler().render(entry);
    const probePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const rendered = await new Compiler({
      compile: { plugins: [probePlugin] }
    }).render(entry);

    expect(rendered).toBe(baseline);
    const entryPrototype = probePlugin.scannerFirstPrototypeResults.find(result => result.filePath === entry);
    expect(entryPrototype).toMatchObject({
      runtimeTreeSource: 'canonical-fallback',
      fallbackReason: 'multiple import statements require canonical import ordering and de-dupe semantics',
      fallbackFullTreeMaterializations: 1,
      progressiveNodes: 0,
      actualParses: 0,
      requestedIslands: 0
    });
  });

  it('falls back for Less import cycles instead of recursing through structural parse', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-scanner-first-import-cycle-'));
    tempDirs.push(dir);
    const a = path.join(dir, 'a.less');
    const b = path.join(dir, 'b.less');
    fs.writeFileSync(a, '@import "b.less";\n.a { color: blue; }\n');
    fs.writeFileSync(b, '@import "a.less";\n.b { color: red; }\n');

    const probePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const source = fs.readFileSync(a, 'utf8');
    const result = probePlugin.runScannerFirstPrototype(
      a,
      source,
      new TreeContext({
        file: {
          name: path.basename(a),
          path: path.dirname(a),
          fullPath: a,
          source
        },
        plugin: probePlugin
      })
    );

    expect(result.tree).toBeUndefined();
    expect(probePlugin.scannerFirstPrototypeResults.some(result =>
      result.runtimeTreeSource === 'canonical-fallback'
      && result.fallbackReason === 'repeated Less imports require canonical import de-dupe semantics'
    )).toBe(true);
  });

  it('feeds root @namespace statement at-rules through structural parse', async () => {
    const cases = [
      {
        source: '@namespace "http://www.w3.org/1999/xhtml";\n.a { color: blue; }\n',
        prelude: '"http://www.w3.org/1999/xhtml"'
      },
      {
        source: '@namespace svg url("http://www.w3.org/2000/svg");\n.a { color: blue; }\n',
        prelude: 'svg url("http://www.w3.org/2000/svg")'
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
      expect(rendered).toContain('@namespace');
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes: 3,
        actualParses: 0,
        requestedIslands: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parseResult = probePlugin.safeParse('/virtual/namespace.less', source);
      expect(parseResult.errors).toEqual([]);
      const statement = parseResult.tree!.rules[0];
      const types = serializeRuntimeTypes(statement);
      expect(types).toContain('(AtRuleStatement');
      expect(types).toContain('name: \'@namespace\'');
      expect(statement.prelude).toBe(prelude);
      expect(types).not.toContain('name: (Any \'@namespace\')');
      expect(types).not.toContain('prelude: (Any');
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
    expect(types).toContain('name: \'@media\'');
    expect(types).toContain('prelude: \'screen\'');
    expect(types).toContain('(Ruleset');
    expect(types).toContain('selector: \'.a\'');
    expect(types).not.toContain('(ProgressiveAtRule');
    expect(types).not.toContain('name: (Any \'@media\')');
    expect(types).not.toContain('prelude: (Any \'screen\')');
  });

  it('feeds root unknown block at-rules with ordinary rules through structural parse', async () => {
    const source = '@unknown-block card { .a { color: blue; } }\n';
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
    expect(rendered).toContain('@unknown-block card');
    expect(rendered).toContain('color: blue');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 3,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/root-unknown-block.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
    expect(types).toContain('(AtRule');
    expect(types).toContain('name: \'@unknown-block\'');
    expect(types).toContain('prelude: \'card\'');
    expect(types).toContain('(Ruleset');
    expect(types).toContain('selector: \'.a\'');
    expect(types).toContain('name: \'color\'');
    expect(types).not.toContain('(ProgressiveAtRule');
    expect(types).not.toContain('name: (Any \'@unknown-block\')');
    expect(types).not.toContain('prelude: (Any \'card\')');
  });

  it('falls back for nested unknown block at-rules until those shapes are proven', async () => {
    const source = '.a { @unknown-block card { .b { color: blue; } } }\n';
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
      fallbackReason: 'only @media, @supports, @starting-style, root @layer, root @font-face, root @page, and root @counter-style block at-rules are in the progressive structural-fed subset',
      fallbackFullTreeMaterializations: 1,
      progressiveNodes: 0,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
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
      expect(types).toContain('name: \'@layer\'');
      if (prelude) {
        expect(types).toContain(`prelude: '${prelude}'`);
        expect(types).not.toContain(`prelude: (Any '${prelude}')`);
      } else {
        expect(types).not.toContain('prelude: (Any');
        expect(types).not.toContain('prelude: (');
      }
      expect(types).toContain('selector: \'.a\'');
      expect(types).toContain('name: \'color\'');
      expect(types).not.toContain('(ProgressiveAtRule');
      expect(types).not.toContain('name: (Any \'@layer\')');
    }
  });

  it('feeds root @supports blocks with a scanner-native declaration condition through structural parse', async () => {
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
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/root-supports.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
    expect(types).toContain('(AtRule');
    expect(types).toContain('name: \'@supports\'');
    expect(types).toContain('(Paren');
    expect(types).toContain('(QueryCondition');
    expect(types).toContain('(Any [role=property] \'display:\'');
    expect(types).toContain('(Any [role=keyword] \'grid\'');
    expect(types).not.toContain('prelude: (Any');
    expect(types).not.toContain('(ProgressiveAtRule');
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

  it('feeds nested @supports declaration blocks through structural parse', async () => {
    const source = '.a { @supports (display: grid) { display: grid; } }\n';
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
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/nested-supports-declarations.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
    expect(types).toContain('selector: \'.a\'');
    expect(types).toContain('name: \'@supports\'');
    expect(types).toContain('(Paren');
    expect(types).toContain('(QueryCondition');
    expect(types).toContain('name: \'display\'');
    expect(types).not.toContain('prelude: (Any');
  });

  it('feeds nested @supports rule blocks through structural parse', async () => {
    const source = '.a { @supports (display: grid) { .b { display: grid; } } }\n';
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
    expect(rendered).toContain('.b');
    expect(rendered).toContain('display: grid');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/nested-supports-rule.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
    expect(types).toContain('selector: \'.a\'');
    expect(types).toContain('name: \'@supports\'');
    expect(types).toContain('(Paren');
    expect(types).toContain('(QueryCondition');
    expect(types).toContain('selector: \'.b\'');
    expect(types).not.toContain('prelude: (Any');
  });

  it('feeds CSS @starting-style blocks through structural parse', async () => {
    const cases = [
      {
        name: 'root',
        source: '@starting-style { .a { opacity: 0; } }\n',
        expectedProgressiveNodes: 3,
        filePath: '/virtual/root-starting-style.less'
      },
      {
        name: 'rule-local',
        source: '.a { opacity: 1; @starting-style { opacity: 0; } }\n',
        expectedProgressiveNodes: 4,
        filePath: '/virtual/nested-starting-style.less'
      }
    ];

    for (const target of cases) {
      const baseline = await new Compiler().renderString(target.source, { language: 'less' });
      const probePlugin = lessPlugin({
        scannerFirstProbe: {
          structuralFedPrototype: true
        }
      });
      const rendered = await new Compiler({
        compile: { plugins: [probePlugin] }
      }).renderString(target.source, { language: 'less' });

      expect(rendered, target.name).toBe(baseline);
      expect(rendered, target.name).toContain('@starting-style');
      expect(rendered, target.name).toContain('opacity: 0');
      expect(probePlugin.lastScannerFirstPrototype, target.name).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes: target.expectedProgressiveNodes,
        actualParses: 0,
        requestedIslands: 0,
        promotedBytes: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind, target.name).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind, target.name).toEqual({});

      const parseResult = probePlugin.safeParse(target.filePath, target.source);
      expect(parseResult.errors, target.name).toEqual([]);
      const types = serializeRuntimeTypes(parseResult.tree!);
      expect(types, target.name).toContain('(AtRule');
      expect(types, target.name).toContain('name: \'@starting-style\'');
      expect(types, target.name).toContain('name: \'opacity\'');
      expect(types, target.name).not.toContain('prelude');
      expect(types, target.name).not.toContain('name: (Any \'@starting-style\')');
      expect(types, target.name).not.toContain('value: (Any \'0\')');
    }
  });

  it('falls back for @starting-style preludes because only the no-prelude block form is proven', async () => {
    const cases = [
      {
        name: 'prelude',
        source: '@starting-style initial { .a { opacity: 0; } }\n',
        reason: '@starting-style preludes are outside the scanner-native structural-fed subset'
      },
      {
        name: 'rule-local nested rule',
        source: '.a { @starting-style { .b { opacity: 0; } } }\n',
        reason: 'unsupported at-rule child rule'
      },
      {
        name: 'rule-local nested at-rule',
        source: '.a { @starting-style { @media screen { opacity: 0; } } }\n',
        reason: 'unsupported at-rule child at-rule'
      },
      {
        name: 'mixin body',
        source: '.m() { @starting-style { opacity: 0; } }\n.a { .m(); }\n',
        reason: 'only @media, @supports, @starting-style, root @layer, root @font-face, root @page, and root @counter-style block at-rules are in the progressive structural-fed subset'
      }
    ];

    for (const { name, source, reason } of cases) {
      const baseline = await new Compiler().renderString(source, { language: 'less' });
      const probePlugin = lessPlugin({
        scannerFirstProbe: {
          structuralFedPrototype: true
        }
      });
      const rendered = await new Compiler({
        compile: { plugins: [probePlugin] }
      }).renderString(source, { language: 'less' });

      expect(rendered, name).toBe(baseline);
      expect(probePlugin.lastScannerFirstPrototype, name).toMatchObject({
        runtimeTreeSource: 'canonical-fallback',
        fallbackReason: reason,
        fallbackFullTreeMaterializations: 1,
        progressiveNodes: 0,
        actualParses: 0,
        requestedIslands: 0,
        promotedBytes: 0
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
    expect(types).toContain('selector: \'.a\'');
    expect(types).toContain('(AtRule');
    expect(types).toContain('name: \'@media\'');
    expect(types).toContain('prelude: \'screen\'');
    expect(types).toContain('name: \'color\'');
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
    expect(types).toContain('selector: \'.a\'');
    expect(types).toContain('(AtRule');
    expect(types).toContain('name: \'@media\'');
    expect(types).toContain('prelude: \'screen\'');
    expect(types).toContain('selector: \'.b\'');
    expect(types).toContain('name: \'color\'');
    expect(types).not.toContain('(ProgressiveAtRule');
    expect(types).not.toContain('name: (Any \'@media\')');
    expect(types).not.toContain('prelude: (Any \'screen\')');
  });

  it('feeds direct nested @media at-rules through structural parse', async () => {
    const source = '.a { @media screen { @media print { color: blue; } } }\n';
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
    expect(rendered).toContain('@media print');
    expect(rendered).toContain('color: blue');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 4,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parsePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const parseResult = parsePlugin.safeParse('/virtual/direct-nested-media.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
    expect(types).toContain('(Ruleset');
    expect(types).toContain('selector: \'.a\'');
    expect(types).toContain('name: \'@media\'');
    expect(types).toContain('prelude: \'print\'');
    expect(types).toContain('name: \'color\'');
    expect(types).not.toContain('(BasicSelector');
    expect(types).not.toContain('value: (Any \'blue\')');
  });

  it('feeds direct nested @supports at-rules through structural parse', async () => {
    const cases = [
      {
        source: '.a { @media screen { @supports (display: grid) { color: blue; } } }\n',
        expectedRender: '@supports (display: grid)',
        expectedSibling: '@media screen'
      },
      {
        source: '.a { @supports (display: grid) { @media screen { color: blue; } } }\n',
        expectedRender: '@media screen',
        expectedSibling: '@supports (display: grid)'
      }
    ];

    for (const { source, expectedRender, expectedSibling } of cases) {
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
      expect(rendered).toContain(expectedRender);
      expect(rendered).toContain(expectedSibling);
      expect(rendered).toContain('color: blue');
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        actualParses: 0,
        requestedIslands: 0,
        promotedBytes: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parseResult = probePlugin.safeParse('/virtual/direct-nested-supports.less', source);
      expect(parseResult.errors).toEqual([]);
      const types = serializeRuntimeTypes(parseResult.tree!.rules[0]);
      expect(types).toContain('selector: \'.a\'');
      expect(types).toContain('name: \'@media\'');
      expect(types).toContain('name: \'@supports\'');
      expect(types).toContain('(Paren');
      expect(types).toContain('(QueryCondition');
      expect(types).toContain('name: \'color\'');
      expect(types).not.toContain('prelude: \'(display: grid)\'');
    }
  });

  it('feeds Less variable declarations inside supported at-rules through structural parse', async () => {
    const cases = [
      {
        source: '@media screen { @brand: blue; .a { color: @brand; } }\n',
        expectedAtRule: '@media screen',
        expectedSelector: '.a'
      },
      {
        source: '.a { @media screen { @brand: blue; color: @brand; } }\n',
        expectedAtRule: '@media screen',
        expectedSelector: '.a'
      },
      {
        source: '.a { @media screen { @brand: blue; .b { color: @brand; } } }\n',
        expectedAtRule: '@media screen',
        expectedSelector: '.b'
      }
    ];

    for (const { source, expectedAtRule, expectedSelector } of cases) {
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
      expect(rendered).toContain(expectedAtRule);
      expect(rendered).toContain(`${expectedSelector} {`);
      expect(rendered).toContain('color: blue');
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        actualParses: 0,
        requestedIslands: 0,
        promotedBytes: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parsePlugin = lessPlugin({
        scannerFirstProbe: {
          structuralFedPrototype: true
        }
      });
      const parseResult = parsePlugin.safeParse('/virtual/at-rule-vars.less', source);
      expect(parseResult.errors).toEqual([]);
      const types = serializeRuntimeTypes(parseResult.tree!);
      expect(types).toContain('(ProgressiveVariableDeclaration');
      expect(types).toContain('name: \'@brand\'');
      expect(types).toContain('[\'blue\']');
      expect(types).toContain('name: \'color\'');
      expect(types).not.toContain('(VarDeclaration');
      expect(types).not.toContain('(Reference [role=value]');
      expect(types).not.toContain('value: (Any \'blue\')');
    }
  });

  it('feeds supported at-rules nested inside at-rule child rules through structural parse', async () => {
    const source = '.a { @media screen { .b { @media print { .c { color: blue; } } } } }\n';
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
    expect(rendered).toContain('@media print');
    expect(rendered).toContain('.c {');
    expect(rendered).toContain('color: blue');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parsePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const parseResult = parsePlugin.safeParse('/virtual/recursive-nested-at-rule.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!);
    expect(types).toContain('name: \'@media\'');
    expect(types).toContain('prelude: \'screen\'');
    expect(types).toContain('prelude: \'print\'');
    expect(types).toContain('selector: \'.c\'');
    expect(types).toContain('name: \'color\'');
    expect(types).not.toContain('(BasicSelector');
    expect(types).not.toContain('value: (Any \'blue\')');
  });

  it('feeds root @font-face declaration blocks through structural parse', async () => {
    const source = '@font-face { font-family: demo; font-weight: 400; font-style: normal; }\n.a { font-family: demo; }\n';
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
    expect(rendered).toContain('@font-face');
    expect(rendered).toContain('font-family: demo');
    expect(rendered).toContain('font-weight: 400');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 6,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parsePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const parseResult = parsePlugin.safeParse('/virtual/font-face.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!);
    expect(types).toContain('(AtRule');
    expect(types).toContain('name: \'@font-face\'');
    expect(types).toContain('name: \'font-family\'');
    expect(types).toContain('name: \'font-weight\'');
    expect(types).toContain('name: \'font-style\'');
    expect(types).toContain('(Ruleset');
    expect(types).toContain('selector: \'.a\'');
    expect(types).not.toContain('prelude: (Any');
    expect(types).not.toContain('value: (Any');
  });

  it('falls back for Less variable references inside root declaration-block at-rules until proven', async () => {
    const source = '@family: demo;\n@font-face { font-family: @family; }\n';
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
      fallbackReason: 'Less variable references are not in this structural-fed subset',
      fallbackFullTreeMaterializations: 1,
      progressiveNodes: 0,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
  });

  it('feeds root CSS declaration-block at-rules through structural parse', async () => {
    const source = [
      '// @page with declarations',
      '@page {',
      '  margin: 2cm;',
      '  size: A4;',
      '  marks: crop cross;',
      '}',
      '',
      '// @font-face with declarations',
      '@font-face {',
      '  font-family: "MyFont";',
      '  src: url("myfont.woff2");',
      '  font-weight: 400;',
      '  font-style: normal;',
      '}',
      '',
      '// @counter-style with declarations',
      '@counter-style my-counter {',
      '  system: fixed;',
      '  symbols: "A" "B" "C";',
      '  suffix: ". ";',
      '}',
      ''
    ].join('\n');
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
    expect(rendered).toContain('@page');
    expect(rendered).toContain('src: url("myfont.woff2")');
    expect(rendered).toContain('@counter-style my-counter');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 13,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parsePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const parseResult = parsePlugin.safeParse('/virtual/declaration-block-at-rules.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!);
    expect(types).toContain('name: \'@page\'');
    expect(types).toContain('name: \'@font-face\'');
    expect(types).toContain('name: \'@counter-style\'');
    expect(types).toContain('prelude: \'my-counter\'');
    expect(types).toContain('name: \'src\'');
    expect(types).toContain('[\'url("myfont.woff2")\']');
    expect(types).not.toContain('value: (Any');
  });

  it('falls back for nested @font-face blocks until those shapes are proven', async () => {
    const source = '.a { @font-face { font-family: demo; } }\n';
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
      fallbackReason: 'only @media, @supports, @starting-style, root @layer, root @font-face, root @page, and root @counter-style block at-rules are in the progressive structural-fed subset',
      fallbackFullTreeMaterializations: 1,
      progressiveNodes: 0,
      actualParses: 0,
      requestedIslands: 0
    });
  });

  it('falls back for root @font-face preludes until those shapes are proven', async () => {
    const source = '@font-face demo { font-family: demo; }\n';
    const probePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const result = probePlugin.runScannerFirstPrototype(
      '/virtual/font-face-prelude.less',
      source,
      new TreeContext({
        file: {
          name: 'font-face-prelude.less',
          path: '/virtual',
          fullPath: '/virtual/font-face-prelude.less',
          source
        },
        plugin: probePlugin
      })
    );

    expect(result.tree).toBeUndefined();
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'canonical-fallback',
      fallbackReason: '@font-face preludes are outside the scanner-native structural-fed subset',
      fallbackFullTreeMaterializations: 1,
      progressiveNodes: 0,
      actualParses: 0,
      requestedIslands: 0
    });
  });

  it('falls back for root @page preludes until those shapes are proven', async () => {
    const source = '@page demo { margin: 2cm; }\n';
    const probePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const result = probePlugin.runScannerFirstPrototype(
      '/virtual/page-prelude.less',
      source,
      new TreeContext({
        file: {
          name: 'page-prelude.less',
          path: '/virtual',
          fullPath: '/virtual/page-prelude.less',
          source
        },
        plugin: probePlugin
      })
    );

    expect(result.tree).toBeUndefined();
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'canonical-fallback',
      fallbackReason: '@page preludes are outside the scanner-native structural-fed subset',
      fallbackFullTreeMaterializations: 1,
      progressiveNodes: 0,
      actualParses: 0,
      requestedIslands: 0
    });
  });

  it('falls back for root @counter-style without a prelude until those shapes are proven', async () => {
    const source = '@counter-style { system: fixed; }\n';
    const probePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const result = probePlugin.runScannerFirstPrototype(
      '/virtual/counter-style-no-prelude.less',
      source,
      new TreeContext({
        file: {
          name: 'counter-style-no-prelude.less',
          path: '/virtual',
          fullPath: '/virtual/counter-style-no-prelude.less',
          source
        },
        plugin: probePlugin
      })
    );

    expect(result.tree).toBeUndefined();
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'canonical-fallback',
      fallbackReason: '@counter-style prelude is outside the scanner-native structural-fed subset',
      fallbackFullTreeMaterializations: 1,
      progressiveNodes: 0,
      actualParses: 0,
      requestedIslands: 0
    });
  });

  it('feeds simple no-arg Less mixin definitions and calls through structural parse', async () => {
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
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      progressiveNodes: 4,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parsePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const parseResult = parsePlugin.safeParse('/virtual/mixin.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!);
    expect(types).toContain('(Mixin');
    expect(types).toContain('Any [role=name] \'.rounded\'');
    expect(types).toContain('(Call');
    expect(types).toContain('(Reference [role=name]');
    expect(types).toContain('key: \'.rounded\'');
    expect(types).toContain('name: \'color\'');
    expect(types).not.toContain('(BasicSelector');
    expect(types).not.toContain('value: (Any \'blue\')');
  });

  it('feeds simple positional Less mixin parameters and literal args through structural parse', async () => {
    const cases = [
      {
        source: '.paint(@color) { color: @color; }\n.a { .paint(blue); }\n',
        progressiveNodes: 6,
        expectedRender: ['color: blue'],
        serializedFragments: [
          'Any [role=name] \'.paint\'',
          'Any [role=property] \'color\'',
          'key: \'color\'',
          '(Any [role=keyword] \'blue\'',
          'name: \'color\''
        ]
      },
      {
        source: '.paint(@color, @width) { color: @color; width: @width; }\n.a { .paint(blue, 1px); }\n',
        progressiveNodes: 9,
        expectedRender: ['color: blue', 'width: 1px'],
        serializedFragments: [
          'Any [role=name] \'.paint\'',
          'Any [role=property] \'color\'',
          'Any [role=property] \'width\'',
          'key: \'color\'',
          'key: \'width\'',
          '(Any [role=keyword] \'blue\'',
          '(Dimension',
          'number: 1',
          'unit: \'px\'',
          'name: \'width\''
        ]
      },
      {
        source: '.a { .paint(@color) { color: @color; } .paint(blue); }\n',
        progressiveNodes: 6,
        expectedRender: ['.a {', 'color: blue'],
        serializedFragments: [
          'selector: \'.a\'',
          'Any [role=name] \'.paint\'',
          'Any [role=property] \'color\'',
          'key: \'color\'',
          '(Any [role=keyword] \'blue\'',
          'name: \'color\''
        ]
      }
    ];

    for (const { source, progressiveNodes, expectedRender, serializedFragments } of cases) {
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
      for (const fragment of expectedRender) {
        expect(rendered).toContain(fragment);
      }
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes,
        actualParses: 0,
        requestedIslands: 0,
        promotedBytes: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parsePlugin = lessPlugin({
        scannerFirstProbe: {
          structuralFedPrototype: true
        }
      });
      const parseResult = parsePlugin.safeParse('/virtual/param-mixin.less', source);
      expect(parseResult.errors).toEqual([]);
      const types = serializeRuntimeTypes(parseResult.tree!);
      expect(types).toContain('(Mixin');
      expect(types).toContain('(List');
      expect(types).toContain('(Reference [role=value]');
      expect(types).toContain('(Call');
      for (const fragment of serializedFragments) {
        expect(types).toContain(fragment);
      }
      expect(types).not.toContain('(BasicSelector');
      expect(types).not.toContain('value: (Any \'blue\')');
    }
  });

  it('feeds deprecated no-parens Less mixin calls through structural parse', async () => {
    const source = '.rounded() { color: blue; }\n.a { .rounded; }\n';
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
      progressiveNodes: 4,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parsePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const parseResult = parsePlugin.safeParse('/virtual/mixin-no-parens.less', source);
    expect(parseResult.errors).toEqual([]);
    expect(parseResult.warnings).toHaveLength(1);
    expect(parseResult.warnings[0]).toMatchObject({
      code: 'parse/deprecated',
      message: 'Calling a mixin without parentheses is deprecated'
    });
    const types = serializeRuntimeTypes(parseResult.tree!);
    expect(types).toContain('(Mixin');
    expect(types).toContain('Any [role=name] \'.rounded\'');
    expect(types).toContain('(Call');
    expect(types).toContain('(Reference [role=name]');
    expect(types).toContain('key: \'.rounded\'');
    expect(types).toContain('name: \'color\'');
    expect(types).not.toContain('(BasicSelector');
    expect(types).not.toContain('value: (Any \'blue\')');
  });

  it('feeds namespaced no-parens Less mixin calls through structural parse', async () => {
    const source = [
      '#theme {',
      '  > .mixin {',
      '    background-color: grey;',
      '  }',
      '}',
      '#container {',
      '  color: black;',
      '  #theme > .mixin;',
      '}',
      ''
    ].join('\n');
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
    expect(rendered).toContain('background-color: grey');
    expect(probePlugin.lastScannerFirstPrototype?.fallbackReason).toBeUndefined();
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parsePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const parseResult = parsePlugin.safeParse('/virtual/namespaced-mixin-no-parens.less', source);
    expect(parseResult.errors).toEqual([]);
    expect(parseResult.warnings.some(warning => warning.code === 'parse/deprecated')).toBe(true);
    const types = serializeRuntimeTypes(parseResult.tree!);
    expect(types).toContain('(Call');
    expect(types).toContain('[\'#theme\', \'.mixin\']');
    expect(types).toContain('(ComplexSelector');
    expect(types).toContain('(Combinator \'>\')');
    expect(types).toContain('[\'.mixin\']');
    expect(types).not.toContain('value: (Any \'grey\')');
  });

  it('feeds root no-arg Less mixin calls through structural parse', async () => {
    const source = '.m() { .a { color: blue; } }\n.m();\n';
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
    expect(rendered).toContain('.a {');
    expect(rendered).toContain('color: blue');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parsePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const parseResult = parsePlugin.safeParse('/virtual/root-mixin-call.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!);
    expect(types).toContain('(Mixin');
    expect(types).toContain('(Call');
    expect(types).toContain('selector: \'.a\'');
    expect(types).toContain('name: \'color\'');
    expect(types).not.toContain('(BasicSelector');
    expect(types).not.toContain('value: (Any \'blue\')');
  });

  it('feeds simple Less mixin bodies with multiple declarations and nested rules through structural parse', async () => {
    const cases = [
      {
        source: '.m() { color: blue; width: 1px; }\n.a { .m(); }\n',
        progressiveNodes: 5,
        expectedFragments: ['color: blue', 'width: 1px'],
        serializedFragments: ['name: \'color\'', '\'blue\'', 'name: \'width\'', '\'1px\'']
      },
      {
        source: '.m() { .b { color: blue; } }\n.a { .m(); }\n',
        progressiveNodes: 5,
        expectedFragments: ['.b', 'color: blue'],
        serializedFragments: ['selector: \'.b\'', 'name: \'color\'']
      }
    ];

    for (const { source, progressiveNodes, expectedFragments, serializedFragments } of cases) {
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
      for (const fragment of expectedFragments) {
        expect(rendered).toContain(fragment);
      }
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        progressiveNodes,
        actualParses: 0,
        requestedIslands: 0,
        promotedBytes: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parsePlugin = lessPlugin({
        scannerFirstProbe: {
          structuralFedPrototype: true
        }
      });
      const parseResult = parsePlugin.safeParse('/virtual/mixin-body.less', source);
      expect(parseResult.errors).toEqual([]);
      const types = serializeRuntimeTypes(parseResult.tree!);
      expect(types).toContain('(Mixin');
      expect(types).toContain('(Call');
      for (const fragment of serializedFragments) {
        expect(types).toContain(fragment);
      }
      expect(types).not.toContain('(BasicSelector');
      expect(types).not.toContain('value: (Any \'blue\')');
      expect(types).not.toContain('value: (Any \'1px\')');
    }
  });

  it('feeds ruleset-local no-arg Less mixin definitions through structural parse', async () => {
    const cases = [
      {
        source: '.a { .m() { color: blue; } .m(); }\n',
        expectedFragments: ['.a {', 'color: blue'],
        serializedFragments: ['selector: \'.a\'', '(Mixin', 'name: \'color\'']
      },
      {
        source: '.a { .m() { .b { color: blue; } } .m(); }\n',
        expectedFragments: ['.b {', 'color: blue'],
        serializedFragments: ['selector: \'.a\'', '(Mixin', 'selector: \'.b\'', 'name: \'color\'']
      }
    ];

    for (const { source, expectedFragments, serializedFragments } of cases) {
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
      for (const fragment of expectedFragments) {
        expect(rendered).toContain(fragment);
      }
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        actualParses: 0,
        requestedIslands: 0,
        promotedBytes: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parsePlugin = lessPlugin({
        scannerFirstProbe: {
          structuralFedPrototype: true
        }
      });
      const parseResult = parsePlugin.safeParse('/virtual/ruleset-local-mixin.less', source);
      expect(parseResult.errors).toEqual([]);
      const types = serializeRuntimeTypes(parseResult.tree!);
      for (const fragment of serializedFragments) {
        expect(types).toContain(fragment);
      }
      expect(types).toContain('(Call');
      expect(types).not.toContain('(BasicSelector');
      expect(types).not.toContain('value: (Any \'blue\')');
    }
  });

  it('feeds no-arg Less mixin body variables through structural parse', async () => {
    const cases = [
      {
        source: '.m() { @brand: blue; color: @brand; }\n.a { .m(); }\n',
        expectedFragments: ['.a {', 'color: blue'],
        serializedFragments: ['(Mixin', '(ProgressiveVariableDeclaration', 'name: \'@brand\'', 'name: \'color\'']
      },
      {
        source: '.m() { @brand: blue; .b { color: @brand; } }\n.a { .m(); }\n',
        expectedFragments: ['.b {', 'color: blue'],
        serializedFragments: ['(Mixin', '(ProgressiveVariableDeclaration', 'selector: \'.b\'', 'name: \'color\'']
      },
      {
        source: '.a { .m() { @brand: blue; color: @brand; } .m(); }\n',
        expectedFragments: ['.a {', 'color: blue'],
        serializedFragments: ['selector: \'.a\'', '(Mixin', '(ProgressiveVariableDeclaration', 'name: \'color\'']
      }
    ];

    for (const { source, expectedFragments, serializedFragments } of cases) {
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
      for (const fragment of expectedFragments) {
        expect(rendered).toContain(fragment);
      }
      expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
        runtimeTreeSource: 'structural-fed',
        fallbackFullTreeMaterializations: 0,
        actualParses: 0,
        requestedIslands: 0,
        promotedBytes: 0
      });
      expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
      expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

      const parsePlugin = lessPlugin({
        scannerFirstProbe: {
          structuralFedPrototype: true
        }
      });
      const parseResult = parsePlugin.safeParse('/virtual/mixin-body-vars.less', source);
      expect(parseResult.errors).toEqual([]);
      const types = serializeRuntimeTypes(parseResult.tree!);
      for (const fragment of serializedFragments) {
        expect(types).toContain(fragment);
      }
      expect(types).toContain('(Call');
      expect(types).not.toContain('(VarDeclaration');
      expect(types).not.toContain('(Reference [role=value]');
      expect(types).not.toContain('value: (Any \'blue\')');
    }
  });

  it('falls back when a ruleset reads a variable declared only inside a no-arg mixin body', async () => {
    const source = '.a { .m() { @brand: blue; } .m(); color: @brand; }\n';
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
      fallbackReason: 'Less variable reference is outside the scanner-native structural-fed subset',
      fallbackFullTreeMaterializations: 1,
      actualParses: 0,
      requestedIslands: 0
    });
  });

  it('feeds @media inside Less mixin definitions through structural parse', async () => {
    const source = '.m() { @media screen { color: blue; } }\n.a { .m(); }\n';
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
      progressiveNodes: 5,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parsePlugin = lessPlugin({
      scannerFirstProbe: {
        structuralFedPrototype: true
      }
    });
    const parseResult = parsePlugin.safeParse('/virtual/mixin-media.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!);
    expect(types).toContain('(Mixin');
    expect(types).toContain('(AtRule');
    expect(types).toContain('name: \'@media\'');
    expect(types).toContain('prelude: \'screen\'');
    expect(types).toContain('(Call');
    expect(types).toContain('name: \'color\'');
    expect(types).not.toContain('(BasicSelector');
    expect(types).not.toContain('value: (Any \'blue\')');
  });

  it('feeds @supports inside Less mixin definitions through structural parse', async () => {
    const source = '.m() { @supports (display: grid) { color: blue; } }\n.a { .m(); }\n';
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
    expect(rendered).toContain('color: blue');
    expect(probePlugin.lastScannerFirstPrototype).toMatchObject({
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
      actualParses: 0,
      requestedIslands: 0,
      promotedBytes: 0
    });
    expect(probePlugin.lastScannerFirstPrototype?.requestsByIslandKind).toEqual({});
    expect(probePlugin.lastScannerFirstPrototype?.requestsByOwnerKind).toEqual({});

    const parseResult = probePlugin.safeParse('/virtual/mixin-supports.less', source);
    expect(parseResult.errors).toEqual([]);
    const types = serializeRuntimeTypes(parseResult.tree!);
    expect(types).toContain('(Mixin');
    expect(types).toContain('(AtRule');
    expect(types).toContain('name: \'@supports\'');
    expect(types).toContain('(Paren');
    expect(types).toContain('(QueryCondition');
    expect(types).toContain('(Call');
    expect(types).toContain('name: \'color\'');
    expect(types).not.toContain('prelude: \'(display: grid)\'');
  });

  it('falls back canonically for declaration syntax the structural-fed subset cannot preserve', async () => {
    const cases = [
      {
        source: '@prop: color;\n.a { @{prop}: blue; }\n',
        reason: 'mixin call signature is outside the scanner-native structural-fed subset'
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
        reason: 'string declaration values with Less variable-like tokens are not in the scanner-native structural-fed subset'
      },
      {
        source: '@brand: hero;\n.a { background: url(/@{brand}.png); }\n',
        reason: 'string declaration values with Less variable-like tokens are not in the scanner-native structural-fed subset'
      },
      {
        source: '@brand: #000;\n.a { color: lighten(@brand, 10%); }\n',
        reason: 'string declaration values with Less variable-like tokens are not in the scanner-native structural-fed subset'
      },
      {
        source: '@amount: 10%;\n.a { color: lighten(#000, @amount); }\n',
        reason: 'string declaration values with Less variable-like tokens are not in the scanner-native structural-fed subset'
      },
      {
        source: '.a { color: lighten(rgb(0, 0, 0), 10%); }\n',
        reason: 'declaration value is outside the scanner-native structural-fed subset'
      },
      {
        source: '.a { color: color("red"); }\n',
        reason: 'declaration value is outside the scanner-native structural-fed subset'
      },
      {
        source: '.a { color: lighten(#00000, 10%); }\n',
        reason: 'declaration value is outside the scanner-native structural-fed subset'
      },
      {
        source: '.a { color: lighten(#0000000, 10%); }\n',
        reason: 'declaration value is outside the scanner-native structural-fed subset'
      },
      {
        source: '.base { color: blue; }\n.button:hover:extend(.base) { width: 1px; }\n',
        reason: 'selector is outside the scanner-native structural-fed subset'
      },
      {
        source: '&:focus { color: blue; }\n',
        reason: 'selector is outside the scanner-native structural-fed subset'
      },
      {
        source: '&:focus, .b { color: blue; }\n',
        reason: 'selector is outside the scanner-native structural-fed subset'
      },
      {
        source: '.a &:focus { color: blue; }\n',
        reason: 'selector is outside the scanner-native structural-fed subset'
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

  it('preflights nested declarations without materializing supported important syntax', async () => {
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
      runtimeTreeSource: 'structural-fed',
      fallbackFullTreeMaterializations: 0,
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
