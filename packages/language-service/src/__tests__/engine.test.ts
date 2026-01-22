import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position, SymbolKind } from 'vscode-languageserver-types';
import { createEngine } from '../engine.js';

function createDocument(languageId: string, content: string): TextDocument {
  return TextDocument.create(`file:///test.${languageId}`, languageId, 1, content);
}

describe('JessLanguageServiceEngine', () => {
  describe('completions', () => {
    it('suggests CSS property names inside a block', () => {
      const engine = createEngine();
      const doc = createDocument('css', 'a { col }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const completions = engine.getCompletions(doc.uri, Position.create(0, 5));
      const labels = completions.items.map(i => i.label);
      expect(labels).toContain('color');
    });

    it('suggests at-rules when typing @', () => {
      const engine = createEngine();
      const doc = createDocument('css', '@med');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const completions = engine.getCompletions(doc.uri, Position.create(0, 4));
      const labels = completions.items.map(i => i.label);
      expect(labels).toContain('@media');
    });

    it('suggests property values after colon', () => {
      const engine = createEngine();
      const doc = createDocument('css', 'a { display: bl }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const completions = engine.getCompletions(doc.uri, Position.create(0, 16));
      const labels = completions.items.map(i => i.label);
      expect(labels).toContain('block');
    });

    it('suggests Less variables', () => {
      const engine = createEngine();
      const doc = createDocument('less', '@primary: red;\na { color: @pr }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const completions = engine.getCompletions(doc.uri, Position.create(1, 14));
      const labels = completions.items.map(i => i.label);
      expect(labels).toContain('@primary');
    });

    it('suggests SCSS variables', () => {
      const engine = createEngine();
      const doc = createDocument('scss', '$primary: red;\na { color: $pr }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const completions = engine.getCompletions(doc.uri, Position.create(1, 14));
      const labels = completions.items.map(i => i.label);
      expect(labels).toContain('$primary');
    });
  });

  describe('hover', () => {
    it('shows hover for property names', () => {
      const engine = createEngine();
      const doc = createDocument('css', 'a { color: red; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const hover = engine.getHover(doc.uri, Position.create(0, 5));
      expect(hover).not.toBeNull();
      expect(hover?.contents).toBeDefined();
      if (hover && 'value' in hover.contents) {
        expect(hover.contents.value).toContain('color');
      }
    });

    it('shows hover for at-rules', () => {
      const engine = createEngine();
      const doc = createDocument('css', '@media screen {}');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const hover = engine.getHover(doc.uri, Position.create(0, 1));
      expect(hover).not.toBeNull();
      if (hover && 'value' in hover.contents) {
        expect(hover.contents.value).toContain('@media');
      }
    });

    it('shows hover for property values', () => {
      const engine = createEngine();
      const doc = createDocument('css', 'a { display: block; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      // Position at "block" value (after the colon and space)
      const hover = engine.getHover(doc.uri, Position.create(0, 18));
      expect(hover).not.toBeNull();
      if (hover && 'value' in hover.contents) {
        expect(hover.contents.value).toContain('block');
      }
    });
  });

  describe('navigation', () => {
    it('finds definition of Less variable', () => {
      const engine = createEngine();
      const doc = createDocument('less', '@primary: red;\na { color: @primary; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const def = engine.findDefinition(doc.uri, Position.create(1, 14));
      expect(def).not.toBeNull();
      expect(def?.uri).toBe(doc.uri);
    });

    it('finds references of Less variable', () => {
      const engine = createEngine();
      const doc = createDocument('less', '@primary: red;\na { color: @primary; }\nb { background: @primary; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      // Position on a reference, not the declaration
      const refs = engine.findReferences(doc.uri, Position.create(1, 14));
      expect(refs.length).toBeGreaterThan(0);
    });

    it('finds definition of SCSS variable', () => {
      const engine = createEngine();
      const doc = createDocument('scss', '$primary: red;\na { color: $primary; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const def = engine.findDefinition(doc.uri, Position.create(1, 14));
      expect(def).not.toBeNull();
      expect(def?.uri).toBe(doc.uri);
    });
  });

  describe('diagnostics', () => {
    it('reports parse errors', () => {
      const engine = createEngine();
      const doc = createDocument('css', 'a { color: }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const diagnostics = engine.getDiagnostics(doc.uri);
      expect(diagnostics.length).toBeGreaterThan(0);
    });

    it('reports multiple parser errors (css/less/scss)', () => {
      // Force multiple *parser* errors by inserting tokens that are structurally invalid as values.
      const inputByLang: Record<'css' | 'less' | 'scss', string> = {
        // CSS: this parser reports multiple errors for an unterminated comment.
        css: 'a { /*',
        // Less/SCSS: this reliably produces multiple recovery errors.
        less: 'a { color: ) ; background: ) ; }',
        scss: 'a { color: ) ; background: ) ; }'
      };
      for (const languageId of ['css', 'less', 'scss'] as const) {
        const engine = createEngine();
        const doc = createDocument(languageId, inputByLang[languageId]);
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const diagnostics = engine.getDiagnostics(doc.uri);
        const parserCount = diagnostics.filter(d => d.code === 'parse/parser').length;
        expect(parserCount).toBeGreaterThan(1);
      }
    });

    it('reports multiple diagnostics (recovery-friendly) on very broken input (css/less/scss)', () => {
      // Some grammars may surface these as parser errors rather than lexer errors.
      const input = 'a { /*';
      for (const languageId of ['css', 'less', 'scss'] as const) {
        const engine = createEngine();
        const doc = createDocument(languageId, input);
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const diagnostics = engine.getDiagnostics(doc.uri);
        expect(diagnostics.length).toBeGreaterThan(1);
        // Ensure ranges are not all identical (basic sanity).
        const keys = new Set(diagnostics.map(d => `${d.range.start.line}:${d.range.start.character}:${d.range.end.line}:${d.range.end.character}`));
        expect(keys.size).toBeGreaterThan(1);
      }
    });

    it('returns no diagnostics for valid input (css/less/scss)', () => {
      const input = '@breakpoint: 1024px;\n@media (min-width: @breakpoint) { .a { display: block; } }';
      for (const languageId of ['less'] as const) {
        const engine = createEngine();
        const doc = createDocument(languageId, input);
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const diagnostics = engine.getDiagnostics(doc.uri);
        expect(diagnostics).toEqual([]);
      }

      const cssOk = 'a { display: block; }';
      for (const languageId of ['css', 'scss'] as const) {
        const engine = createEngine();
        const doc = createDocument(languageId, cssOk);
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const diagnostics = engine.getDiagnostics(doc.uri);
        expect(diagnostics).toEqual([]);
      }
    });
  });

  describe('document symbols', () => {
    it('returns symbols for at-rules, rulesets, and vars', () => {
      const engine = createEngine();
      const doc = createDocument(
        'scss',
        `
          $primary: red;
          @media screen { .a { color: $primary; } }
        `
      );
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const syms = engine.getDocumentSymbols(doc.uri);
      const names = syms.map(s => s.name);
      const kinds = syms.map(s => s.kind);

      expect(kinds).toContain(SymbolKind.Variable);
      expect(kinds).toContain(SymbolKind.Namespace);
      expect(kinds).toContain(SymbolKind.Class);

      expect(names.some(n => n.includes('@media'))).toBe(true);
      expect(names.some(n => n.includes('.a'))).toBe(true);
      expect(names.some(n => n.includes('$primary'))).toBe(true);
    });
  });
});
