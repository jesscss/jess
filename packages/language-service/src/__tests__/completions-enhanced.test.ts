import { describe, expect, it } from 'vitest';
import { CompletionItemKind, InsertTextFormat } from 'vscode-languageserver-types';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createEngine } from '../engine.js';

// `|` marks the caret; it's stripped before parsing and its index is the position.
function completeAt(lang: string, contentWithCaret: string): string[] {
  const ext = lang === 'scss' ? 'scss' : lang === 'less' ? 'less' : lang === 'jess' ? 'jess' : 'css';
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

  it('named CSS colors are offered for color properties', () => {
    const labels = completeAt('css', '.a { color: | }');
    expect(labels).toContain('red');
    expect(labels).toContain('rebeccapurple');
  });

  it('a named color completion carries a Color kind + hex swatch documentation', () => {
    const ext = 'css';
    const caret = '.a { color: re| }'.indexOf('|');
    const text = '.a { color: re| }'.replace('|', '');
    const doc = TextDocument.create(`file:///t.${ext}`, ext, 1, text);
    const engine = createEngine();
    engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
    const items = engine.getCompletions(doc.uri, doc.positionAt(caret)).items;
    const red = items.find(i => (typeof i.label === 'string' ? i.label : i.label.label) === 'red');
    expect(red).toBeDefined();
    expect(red!.kind).toBe(CompletionItemKind.Color);
    expect(String(red!.documentation)).toMatch(/^#/); // hex → VS Code renders a swatch
  });

  it('units complete on a numeric prefix (length restriction)', () => {
    const labels = completeAt('css', '.a { width: 10| }');
    expect(labels).toContain('10px');
    expect(labels).toContain('10%');
  });

  it('Less `.foo()` mixin-call completions inside a block', () => {
    const labels = completeAt('less', '.card() { color: red; }\n.a { .| }');
    expect(labels).toContain('.card()');
  });

  it('@media prelude completes feature names + types + operators', () => {
    const labels = completeAt('css', '@media (min-w|');
    expect(labels).toContain('min-width');
  });

  it('@keyframes body completes from / to', () => {
    const labels = completeAt('css', '@keyframes spin { fr| }');
    expect(labels).toContain('from');
  });

  it('function value completions insert as snippets (cursor inside parens)', () => {
    const caret = '.a { color: rgb| }'.indexOf('|');
    const text = '.a { color: rgb| }'.replace('|', '');
    const doc = TextDocument.create('file:///t.css', 'css', 1, text);
    const engine = createEngine();
    engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
    const rgb = engine.getCompletions(doc.uri, doc.positionAt(caret)).items.find(i => (typeof i.label === 'string' ? i.label : i.label.label) === 'rgb()');
    expect(rgb).toBeDefined();
    expect(rgb!.insertTextFormat).toBe(InsertTextFormat.Snippet);
    expect(String(rgb!.textEdit && 'newText' in rgb!.textEdit ? rgb!.textEdit.newText : '')).toBe('rgb($1)');
  });

  it('SCSS sass module members complete after `math.`', () => {
    const labels = completeAt('scss', '.a { width: math.di| }');
    expect(labels).toContain('math.div()');
  });

  it('.jess also gets sass module member completions', () => {
    const labels = completeAt('jess', '.a { width: math.| }');
    expect(labels.some(l => l.startsWith('math.'))).toBe(true);
  });

  it('at-rules: top level offers @import + @media + @font-face', () => {
    const labels = completeAt('css', '@|');
    expect(labels).toContain('@import');
    expect(labels).toContain('@media');
    expect(labels).toContain('@font-face');
  });

  it('at-rules: inside a style rule hides root-only/top-level-only, keeps @media', () => {
    const labels = completeAt('css', '.a { @| }');
    expect(labels).not.toContain('@import');
    expect(labels).not.toContain('@font-face');
    expect(labels).toContain('@media'); // conditional-group nests inside style rules
  });

  it('at-rules: inside @media, @font-face is valid but @import is not', () => {
    const labels = completeAt('css', '@media screen { @| }');
    expect(labels).toContain('@font-face');
    expect(labels).not.toContain('@import'); // root-only everywhere
  });

  it('SCSS %placeholder completes after @extend %', () => {
    const labels = completeAt('scss', '%button { color: red; }\n.a { @extend %| }');
    expect(labels).toContain('%button');
  });

  it('SCSS %placeholder filters by prefix and excludes the partial typed', () => {
    const labels = completeAt('scss', '%button {} %card {}\n.a { @extend %bu| }');
    expect(labels).toContain('%button');
    expect(labels).not.toContain('%card');
    expect(labels).not.toContain('%bu');
  });

  it('Less `@{…}` interpolation completes bare variable names', () => {
    const labels = completeAt('less', '@primary: red;\n.a-@{pri| } { x: 1 }');
    expect(labels).toContain('primary');
  });

  it('SCSS `#{$…}` interpolation still completes variables', () => {
    const labels = completeAt('scss', '$primary: red;\n.a { width: #{$pri| }; }');
    expect(labels).toContain('$primary');
  });
});
