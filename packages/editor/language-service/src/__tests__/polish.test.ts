import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createEngine } from '../engine.js';

function engineWith(lang: string, text: string) {
  const ext = lang === 'scss' ? 'scss' : lang === 'less' ? 'less' : lang === 'jess' ? 'jess' : 'css';
  const doc = TextDocument.create(`file:///t.${ext}`, lang, 1, text);
  const engine = createEngine();
  engine.open(doc.uri, lang, 1, text);
  return { engine, doc };
}

describe('region-comment folding', () => {
  it('folds `/* #region */` … `/* #endregion */`', () => {
    const { engine, doc } = engineWith('css', '/* #region Colors */\n.a { color: red; }\n.b { x: 1; }\n/* #endregion */');
    const region = engine.getFoldingRanges(doc.uri).filter(f => f.kind === 'region');
    expect(region).toEqual([{ startLine: 0, endLine: 3, kind: 'region' }]);
  });

  it('.jess: region folding works', () => {
    const { engine, doc } = engineWith('jess', '/* #region */\n.a { color: red; }\n/* #endregion */');
    expect(engine.getFoldingRanges(doc.uri).some(f => f.kind === 'region')).toBe(true);
  });
});

describe('range formatting', () => {
  it('formats only the top-level rules the range intersects', () => {
    const { engine, doc } = engineWith('css', '.a{color:red}\n.b{color:blue}\n.c{x:1}');
    const range = { start: doc.positionAt(0), end: doc.positionAt(13) }; // just `.a{...}`
    const edits = engine.formatRange(doc.uri, range);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.newText).toBe('.a {\n  color: red;\n}');

    // Untouched rules stay outside the replaced span.
    expect(edits[0]!.range.end.line).toBe(0);
  });
});

describe('setDataProviders (custom CSS data)', () => {
  it('custom property name completes and hovers', () => {
    const { engine, doc } = engineWith('css', '.a { -my- }');
    engine.setDataProviders([{ properties: [{ name: '-my-custom-prop', description: 'A custom property.' }] }]);
    const labels = engine.getCompletions(doc.uri, doc.positionAt(8)).items.map(i => (typeof i.label === 'string' ? i.label : i.label.label));
    expect(labels).toContain('-my-custom-prop');

    const { engine: e2, doc: d2 } = engineWith('css', '.a { -my-custom-prop: 1 }');
    e2.setDataProviders([{ properties: [{ name: '-my-custom-prop', description: 'A custom property.' }] }]);
    const h = e2.getHover(d2.uri, d2.positionAt(10));
    expect(h && typeof h.contents === 'object' && 'value' in h.contents ? String(h.contents.value) : '').toContain('-my-custom-prop');
  });

  it('custom at-rule completes and hovers', () => {
    const { engine, doc } = engineWith('css', '@tail ');
    engine.setDataProviders([{ atDirectives: [{ name: '@tailwind', description: 'Tailwind directive.' }] }]);
    const labels = engine.getCompletions(doc.uri, doc.positionAt(5)).items.map(i => (typeof i.label === 'string' ? i.label : i.label.label));
    expect(labels).toContain('@tailwind');

    const { engine: e2, doc: d2 } = engineWith('css', '@tailwind base;');
    e2.setDataProviders([{ atDirectives: [{ name: '@tailwind', description: 'Tailwind directive.' }] }]);
    const h = e2.getHover(d2.uri, d2.positionAt(4));
    expect(h && typeof h.contents === 'object' && 'value' in h.contents ? String(h.contents.value) : '').toContain('@tailwind');
  });

  it('custom data participates in diagnostics', () => {
    const { engine, doc } = engineWith('css', [
      '@tailwind base;',
      '.a { -my-custom-prop: project-layout; }',
      '.a:--project-state::--project-part { color: red; }'
    ].join('\n'));
    engine.setDataProviders([{
      atDirectives: [{ name: '@tailwind', description: 'Tailwind directive.' }],
      properties: [{
        name: '-my-custom-prop',
        description: 'A custom property.',
        values: [{ name: 'project-layout' }]
      }],
      pseudoClasses: [{ name: ':--project-state', description: 'A project pseudo-class.' }],
      pseudoElements: [{ name: '::--project-part', description: 'A project pseudo-element.' }]
    }]);

    const codes = engine.getDiagnostics(doc.uri).map(diagnostic => diagnostic.code);
    expect(codes).not.toContain('lint/unknown-at-rule');
    expect(codes).not.toContain('lint/unknown-property');
    expect(codes).not.toContain('lint/unknown-property-value');
    expect(codes).not.toContain('lint/selector-pseudo-class-no-unknown');
    expect(codes).not.toContain('lint/selector-pseudo-element-no-unknown');
  });

  it('custom property value metadata still reports definite invalid values', () => {
    const { engine, doc } = engineWith('css', '.a { -my-custom-prop: wrong; }');
    engine.setDataProviders([{
      properties: [{
        name: '-my-custom-prop',
        description: 'A custom property.',
        values: [{ name: 'project-layout' }]
      }]
    }]);

    const diagnostic = engine.getDiagnostics(doc.uri).find(item => item.code === 'lint/unknown-property-value');
    expect(diagnostic?.message).toContain('wrong');
  });

  it('custom descriptor data participates in diagnostics for CSS descriptor blocks', () => {
    const { engine, doc } = engineWith('css', '@font-face { project-mode: compact; project-tone: loud; }');
    engine.setDataProviders([{
      properties: [
        {
          name: 'project-mode',
          atRule: '@font-face',
          description: 'Project mode.',
          values: [{ name: 'compact' }]
        },
        {
          name: 'project-tone',
          atRule: '@font-face',
          description: 'Project tone.',
          values: [{ name: 'quiet' }]
        }
      ]
    }]);

    const diagnostics = engine.getDiagnostics(doc.uri);
    const codes = diagnostics.map(diagnostic => diagnostic.code);
    expect(codes).not.toContain('lint/at-rule-descriptor-no-unknown');
    expect(diagnostics
      .filter(diagnostic => diagnostic.code === 'lint/at-rule-descriptor-value-no-unknown')
      .map(diagnostic => diagnostic.message)).toEqual([
      'Unknown value "loud" for descriptor "project-tone" in @font-face'
    ]);
  });

  it('.jess: custom data applies too', () => {
    const { engine, doc } = engineWith('jess', '.a { -my- }');
    engine.setDataProviders([{ properties: [{ name: '-my-custom-prop', description: 'x' }] }]);
    const labels = engine.getCompletions(doc.uri, doc.positionAt(8)).items.map(i => (typeof i.label === 'string' ? i.label : i.label.label));
    expect(labels).toContain('-my-custom-prop');
  });
});
