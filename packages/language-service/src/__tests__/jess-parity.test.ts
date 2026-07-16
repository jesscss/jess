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

  it('Less-style `.card()` mixin-call completion', () => {
    const labels = completeAt('.card() { color: red; }\n.a { .| }');
    expect(labels).toContain('.card()');
  });

  it('@media prelude completion', () => {
    expect(completeAt('@media (min-w|')).toContain('min-width');
  });

  it('@keyframes body completion (from/to)', () => {
    expect(completeAt('@keyframes spin { fr| }')).toContain('from');
  });

  it('named-color value completion', () => {
    const labels = completeAt('.a { color: | }');
    expect(labels).toContain('rebeccapurple');
  });

  it('!important completion', () => {
    expect(completeAt('.a { color: red !| }')).toContain('!important');
  });

  it('units complete on a numeric prefix', () => {
    expect(completeAt('.a { width: 10| }')).toContain('10px');
  });

  it('pseudo-element completion after `::`', () => {
    expect(completeAt('.a::be|').some(l => l.startsWith('::'))).toBe(true);
  });

  it('function value completions insert as snippets', () => {
    const { engine, doc } = engineWith('.a { color: rgb }');
    const at = doc.getText().indexOf('rgb') + 3;
    const rgb = engine.getCompletions(doc.uri, doc.positionAt(at)).items.find(i => (typeof i.label === 'string' ? i.label : i.label.label) === 'rgb()');
    expect(rgb).toBeDefined();
    expect(rgb!.insertTextFormat).toBe(2); // InsertTextFormat.Snippet
  });

  it('sass module member completion (math.)', () => {
    expect(completeAt('.a { width: math.| }').some(l => l.startsWith('math.'))).toBe(true);
  });

  it('at-rule completion is context-filtered (no @import inside a style rule)', () => {
    const labels = completeAt('.a { @| }');
    expect(labels).not.toContain('@import');
    expect(labels).toContain('@media');
  });

  it('`$[…]` interpolation completes bare variable names', () => {
    const labels = completeAt('$primary: red;\n.a-$[pri| ] { x: 1 }');
    expect(labels).toContain('primary');
  });

  it('colors the `$` sigil and the variable name as SEPARATE tokens (not one blob)', () => {
    const { engine, doc } = engineWith('$foo: red;\n.a { color: $foo; }');
    const data = engine.getSemanticTokens(doc.uri).data;
    // decode delta-encoded 5-tuples
    let line = 0, ch = 0;
    const toks: Array<{ line: number; ch: number; len: number; type: number }> = [];
    for (let i = 0; i < data.length; i += 5) {
      line += data[i]!;
      if (data[i]) {
        ch = 0;
      }
      ch += data[i + 1]!;
      toks.push({ line, ch, len: data[i + 2]!, type: data[i + 3]! });
    }
    // Legend: operator=5, variable=7. The `$foo` reference on line 1 must be TWO
    // tokens: a 1-char operator (`$`) then a 3-char variable (`foo`).
    const ref = toks.filter(t => t.line === 1);
    const dollar = ref.find(t => t.len === 1 && t.type === 5);
    const name = ref.find(t => t.len === 3 && t.type === 7);
    expect(dollar).toBeDefined();
    expect(name).toBeDefined();
    expect(name!.ch).toBe(dollar!.ch + 1);
  });
});
