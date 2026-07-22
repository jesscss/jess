import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createEngine } from '../engine.js';

function completeAt(lang: string, contentWithCaret: string): string[] {
  const ext = lang === 'scss' ? 'scss' : lang === 'less' ? 'less' : lang === 'jess' ? 'jess' : 'css';
  const caret = contentWithCaret.indexOf('|');
  const doc = TextDocument.create(`file:///t.${ext}`, lang, 1, contentWithCaret.replace('|', ''));
  const engine = createEngine();
  engine.open(doc.uri, lang, 1, doc.getText());
  return engine.getCompletions(doc.uri, doc.positionAt(caret)).items.map(i => (typeof i.label === 'string' ? i.label : i.label.label));
}

describe('var() custom-property completion', () => {
  it('completes local custom properties inside var()', () => {
    const labels = completeAt('css', ':root { --brand: red; --bg: white; }\n.a { color: var(--br| ); }');
    expect(labels).toContain('--brand');
    expect(labels).not.toContain('--bg'); // prefix filter
  });

  it('offers all custom properties on an empty var()', () => {
    const labels = completeAt('css', ':root { --brand: red; --bg: white; }\n.a { color: var(| ); }');
    expect(labels).toContain('--brand');
    expect(labels).toContain('--bg');
  });

  it('.jess: var() custom-property completion works', () => {
    const labels = completeAt('jess', ':root { --brand: red; }\n.a { color: var(--br| ); }');
    expect(labels).toContain('--brand');
  });

  describe('cross-import', () => {
    let dir: string;
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jessls-var-'));
      fs.writeFileSync(path.join(dir, 'tokens.css'), ':root { --imported-color: blue; }');
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('mines custom properties from imported files', () => {
      const uri = pathToFileURL(path.join(dir, 'main.css')).toString();
      const src = '@import "tokens.css";\n.a { color: var(--imp|); }';
      const caret = src.indexOf('|');
      const doc = TextDocument.create(uri, 'css', 1, src.replace('|', ''));
      const engine = createEngine();
      engine.open(doc.uri, 'css', 1, doc.getText());
      const labels = engine.getCompletions(doc.uri, doc.positionAt(caret)).items.map(i => (typeof i.label === 'string' ? i.label : i.label.label));
      expect(labels).toContain('--imported-color');
    });
  });
});
