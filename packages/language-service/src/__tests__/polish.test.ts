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

  it('.jess: custom data applies too', () => {
    const { engine, doc } = engineWith('jess', '.a { -my- }');
    engine.setDataProviders([{ properties: [{ name: '-my-custom-prop', description: 'x' }] }]);
    const labels = engine.getCompletions(doc.uri, doc.positionAt(8)).items.map(i => (typeof i.label === 'string' ? i.label : i.label.label));
    expect(labels).toContain('-my-custom-prop');
  });
});
