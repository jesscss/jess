import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { DocumentSymbol } from 'vscode-languageserver-types';
import { createEngine } from '../engine.js';

// Every language-service feature must work on .jess, not just css/less/scss.
function engineWith(text: string) {
  const doc = TextDocument.create('file:///t.jess', 'jess', 1, text);
  const engine = createEngine();
  engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
  return { engine, doc };
}

function completeAt(textWithCaret: string): string[] {
  const caret = textWithCaret.indexOf('|');
  const { engine, doc } = engineWith(textWithCaret.replace('|', ''));
  return engine.getCompletions(doc.uri, doc.positionAt(caret)).items.map(i => (typeof i.label === 'string' ? i.label : i.label.label));
}

function flatSymbolNames(syms: DocumentSymbol[]): string[] {
  const out: string[] = [];
  const walk = (s: DocumentSymbol) => {
    out.push(s.name);
    for (const c of s.children ?? []) {
      walk(c);
    }
  };
  for (const s of syms) {
    walk(s);
  }
  return out;
}

describe('.jess dialect parity (LS features on jess stylesheets)', () => {
  it('variable completion uses the $-sigil (jess is scss-like)', () => {
    const labels = completeAt('$primary: red;\n.a { color: $pri| }');
    expect(labels).toContain('$primary');
  });

  it('restriction-driven value completion (colors + keywords + var)', () => {
    const labels = completeAt('.a { color: | }');
    expect(labels).toContain('rgb()');
    expect(labels).toContain('inherit');
    expect(labels).toContain('red'); // named color
  });

  it('pseudo-class completion', () => {
    const labels = completeAt('.a:|');
    expect(labels).toContain(':hover');
  });

  it('document symbols', () => {
    const { engine, doc } = engineWith('$primary: red;\n@media screen { .a { x: 1 } }');
    const names = flatSymbolNames(engine.getDocumentSymbols(doc.uri));
    expect(names.some(n => n.includes('$primary'))).toBe(true);
    expect(names.some(n => n.includes('.a'))).toBe(true);
  });

  it('document highlights on a $-variable', () => {
    const { engine, doc } = engineWith('$primary: red;\n.a { color: $primary; }\n.b { border-color: $primary; }');
    const text = doc.getText();
    const at = text.indexOf('$primary', text.indexOf('.a'));
    const hls = engine.findDocumentHighlights(doc.uri, doc.positionAt(at + 2));
    expect(hls.length).toBeGreaterThanOrEqual(2);
  });

  it('lint rules fire (empty-rules) on jess', () => {
    const { engine, doc } = engineWith('.a {}');
    const diags = engine.getDiagnostics(doc.uri);
    expect(diags.some(d => String(d.code).includes('empty'))).toBe(true);
  });
});
