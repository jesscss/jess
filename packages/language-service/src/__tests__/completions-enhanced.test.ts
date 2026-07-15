import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createEngine } from '../engine.js';

// `|` marks the caret; it's stripped before parsing and its index is the position.
function completeAt(lang: string, contentWithCaret: string): string[] {
  const ext = lang === 'scss' ? 'scss' : lang === 'less' ? 'less' : 'css';
  const caret = contentWithCaret.indexOf('|');
  const text = contentWithCaret.replace('|', '');
  const doc = TextDocument.create(`file:///t.${ext}`, lang, 1, text);
  const engine = createEngine();
  engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
  const list = engine.getCompletions(doc.uri, doc.positionAt(caret));
  return list.items.map(i => (typeof i.label === 'string' ? i.label : i.label.label));
}

describe('enhanced completions (MS-parity: values / pseudo / mixin / !important)', () => {
  it('value context: property enum values + color functions (color restriction)', () => {
    const labels = completeAt('css', '.a { color: | }');
    expect(labels).toContain('rgb()'); // color restriction → color functions
    expect(labels).toContain('inherit'); // CSS-wide keyword (always)
    expect(labels).toContain('var()'); // universal
    expect(labels).toContain('calc()');
  });

  it('value context offers CSS-wide keywords + var()/calc() even without enum values', () => {
    const labels = completeAt('css', '.a { width: | }');
    expect(labels).toContain('inherit');
    expect(labels).toContain('var()');
  });

  it('!important is offered at the end of a value', () => {
    const labels = completeAt('css', '.a { color: red !| }');
    expect(labels).toContain('!important');
  });

  it('pseudo-classes complete after a selector `:`', () => {
    const labels = completeAt('css', '.a:|');
    expect(labels).toContain(':hover');
  });

  it('pseudo-elements complete after `::`', () => {
    const labels = completeAt('css', '.a::|');
    expect(labels.some(l => l.startsWith('::'))).toBe(true); // e.g. ::before
  });

  it('does NOT offer pseudo inside a declaration value colon (value context wins)', () => {
    const labels = completeAt('css', '.a { color:r| }');
    expect(labels).not.toContain(':hover'); // the `:` is a value colon, not a selector pseudo
    expect(labels).toContain('rgb()'); // value context is active (color function, `r` prefix)
  });

  it('SCSS @include completes declared mixin names', () => {
    const labels = completeAt('scss', '@mixin brand { color: red; }\n.x { @include | }');
    expect(labels).toContain('brand');
  });

  it('existing variable completion still works (regression)', () => {
    const labels = completeAt('less', '@primary: red;\n.a { color: @|; }');
    expect(labels).toContain('@primary');
  });
});
