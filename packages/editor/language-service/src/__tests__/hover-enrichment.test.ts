import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createEngine } from '../engine.js';

// `|` marks the caret.
function hoverAt(lang: string, contentWithCaret: string): string {
  const ext = lang === 'scss' ? 'scss' : lang === 'less' ? 'less' : lang === 'jess' ? 'jess' : 'css';
  const caret = contentWithCaret.indexOf('|');
  const doc = TextDocument.create(`file:///t.${ext}`, lang, 1, contentWithCaret.replace('|', ''));
  const engine = createEngine();
  engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
  const h = engine.getHover(doc.uri, doc.positionAt(caret));
  return h && typeof h.contents === 'object' && 'value' in h.contents ? String(h.contents.value) : '';
}

describe('hover enrichment (MS-parity: MDN links, Baseline, syntax, pseudo hover)', () => {
  it('property hover appends formal syntax + Baseline + MDN link', () => {
    const v = hoverAt('css', '.a { ga|p: 1px; }');
    expect(v).toContain('```css\ngap\n```');
    expect(v).toContain('**CSS property** gap');
    expect(v).toContain('**Syntax:**');
    expect(v).toContain('Baseline');
    expect(v).toContain('**Browser support:**');
    expect(v).toContain('Chrome');
    expect(v).toMatch(/\[MDN Reference\]\(https:\/\/developer\.mozilla\.org/);
  });

  it('pseudo-class hover (`:hover`) shows a description + MDN link', () => {
    const v = hoverAt('css', '.a:ho|ver {}');
    expect(v).toContain('```css\n:hover\n```');
    expect(v).toContain('**CSS selector** :hover');
    expect(v).toContain('**Browser support:**');
    expect(v).toMatch(/\[MDN Reference\]/);
  });

  it('property value hover includes browser support when web custom data has it', () => {
    const v = hoverAt('css', '.a { display: fl|ex; }');
    expect(v).toContain('```css\nflex\n```');
    expect(v).toContain('**CSS value** flex');
    expect(v).toContain('Baseline');
    expect(v).toContain('**Browser support:**');
  });

  it('pseudo-element hover (`::before`) shows a description', () => {
    const v = hoverAt('css', '.a::bef|ore {}');
    expect(v).toContain('```css\n::before\n```');
    expect(v).toContain('**CSS selector** ::before');
  });

  it('selector hover shows specificity for the selector branch under the cursor', () => {
    const v = hoverAt('css', '.a #ident:hover, button > .b|eta { color: red; }');
    expect(v).toContain('**Selector specificity**');
    expect(v).toContain('button > .beta');
    expect(v).toContain('`(0, 1, 1)`');
  });

  it('selector specificity does not replace property hover inside declaration blocks', () => {
    const v = hoverAt('css', '.a { ga|p: 1px; }');
    expect(v).toContain('**CSS property** gap');
    expect(v).not.toContain('Selector specificity');
  });

  it('at-rule hover appends Baseline + MDN link', () => {
    const v = hoverAt('css', '@med|ia screen {}');
    expect(v).toContain('```css\n@media\n```');
    expect(v).toContain('**CSS at-rule** @media');
    expect(v).toMatch(/\[MDN Reference\]/);
  });

  it('.jess: property + pseudo hover are enriched too', () => {
    expect(hoverAt('jess', '.a { ga|p: 1px; }')).toMatch(/\[MDN Reference\]/);
    expect(hoverAt('jess', '.a:ho|ver {}')).toContain('**CSS selector** :hover');
  });
});
