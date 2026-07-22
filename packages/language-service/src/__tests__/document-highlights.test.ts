import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createEngine } from '../engine.js';

function highlightsAt(lang: string, contentWithCaret: string) {
  const ext = lang === 'scss' ? 'scss' : lang === 'less' ? 'less' : 'css';
  const caret = contentWithCaret.indexOf('|');
  const text = contentWithCaret.replace('|', '');
  const doc = TextDocument.create(`file:///h.${ext}`, lang, 1, text);
  const engine = createEngine();
  engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
  return engine.findDocumentHighlights(doc.uri, doc.positionAt(caret));
}

describe('document highlights', () => {
  it('highlights all occurrences of a variable in the document', () => {
    const hls = highlightsAt('less', '@primary: red;\n.a { color: @prim|ary; }\n.b { border-color: @primary; }');
    expect(hls.length).toBeGreaterThanOrEqual(2); // the two usages (+/- the declaration)
  });

  it('returns nothing when the cursor is not on a resolvable symbol', () => {
    const hls = highlightsAt('less', '.a { colo|r: red; }'); // a property name, not a symbol
    expect(hls.length).toBe(0);
  });
});
