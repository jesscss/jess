import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CodeActionKind, Position, SymbolKind } from 'vscode-languageserver-types';
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

    describe('cross-file navigation', () => {
      let tempDir: string;

      afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      });

      it('finds Less variable definition across files', () => {
        tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-'));
        const varsFile = path.join(tempDir, 'vars.less');
        const mainFile = path.join(tempDir, 'main.less');

        fs.writeFileSync(varsFile, '@primary: red;\n@secondary: blue;');
        fs.writeFileSync(mainFile, '@import "vars";\n.a { color: @primary; }');

        const engine = createEngine();
        const mainUri = String(pathToFileURL(mainFile));
        engine.open(mainUri, 'less', 1, fs.readFileSync(mainFile, 'utf-8'));

        // Position at @primary reference in main.less
        const def = engine.findDefinition(mainUri, Position.create(1, 14));
        expect(def).not.toBeNull();
        expect(def?.uri).toBe(String(pathToFileURL(varsFile)));
        expect(def?.range.start.line).toBe(0);
      });

      it('finds Less variable references across files', () => {
        tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-'));
        const varsFile = path.join(tempDir, 'vars.less');
        const mainFile = path.join(tempDir, 'main.less');

        fs.writeFileSync(varsFile, '@primary: red;');
        fs.writeFileSync(mainFile, '@import "vars";\n.a { color: @primary; }\n.b { background: @primary; }');

        const engine = createEngine();
        const varsUri = String(pathToFileURL(varsFile));
        engine.open(varsUri, 'less', 1, fs.readFileSync(varsFile, 'utf-8'));
        const mainUri = String(pathToFileURL(mainFile));
        engine.open(mainUri, 'less', 1, fs.readFileSync(mainFile, 'utf-8'));

        // Position at @primary declaration in vars.less (on the variable name, not the @)
        const refs = engine.findReferences(varsUri, Position.create(0, 2));
        expect(refs.length).toBeGreaterThanOrEqual(3); // declaration + 2 references in main.less
        const mainRefs = refs.filter(r => r.uri === mainUri);
        expect(mainRefs.length).toBe(2);
      });

      it('finds SCSS variable definition across files', () => {
        tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-'));
        const varsFile = path.join(tempDir, '_vars.scss');
        const mainFile = path.join(tempDir, 'main.scss');

        fs.writeFileSync(varsFile, '$primary: red;\n$secondary: blue;');
        fs.writeFileSync(mainFile, '@import "vars";\n.a { color: $primary; }');

        const engine = createEngine();
        const mainUri = String(pathToFileURL(mainFile));
        engine.open(mainUri, 'scss', 1, fs.readFileSync(mainFile, 'utf-8'));

        // Position at $primary reference in main.scss
        const def = engine.findDefinition(mainUri, Position.create(1, 14));
        expect(def).not.toBeNull();
        expect(def?.uri).toBe(String(pathToFileURL(varsFile)));
        expect(def?.range.start.line).toBe(0);
      });

      it('finds SCSS variable references across files', () => {
        tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-'));
        const varsFile = path.join(tempDir, '_vars.scss');
        const mainFile = path.join(tempDir, 'main.scss');

        fs.writeFileSync(varsFile, '$primary: red;');
        fs.writeFileSync(mainFile, '@import "vars";\n.a { color: $primary; }\n.b { background: $primary; }');

        const engine = createEngine();
        const varsUri = String(pathToFileURL(varsFile));
        engine.open(varsUri, 'scss', 1, fs.readFileSync(varsFile, 'utf-8'));
        const mainUri = String(pathToFileURL(mainFile));
        engine.open(mainUri, 'scss', 1, fs.readFileSync(mainFile, 'utf-8'));

        // Position at $primary declaration in _vars.scss (on the variable name, not the $)
        const refs = engine.findReferences(varsUri, Position.create(0, 2));
        expect(refs.length).toBeGreaterThanOrEqual(3); // declaration + 2 references in main.scss
        const mainRefs = refs.filter(r => r.uri === mainUri);
        expect(mainRefs.length).toBe(2);
      });

      it.skip('finds Less mixin definition across files', () => {
        tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-'));
        const mixinsFile = path.join(tempDir, 'mixins.less');
        const mainFile = path.join(tempDir, 'main.less');

        fs.writeFileSync(mixinsFile, '.button() { color: red; }');
        fs.writeFileSync(mainFile, '@import "mixins";\n.a { .button(); }');

        const engine = createEngine();
        const mixinsUri = String(pathToFileURL(mixinsFile));
        const mainUri = String(pathToFileURL(mainFile));
        // Open both files to ensure import graph is built
        engine.open(mixinsUri, 'less', 1, fs.readFileSync(mixinsFile, 'utf-8'));
        engine.open(mainUri, 'less', 1, fs.readFileSync(mainFile, 'utf-8'));

        // Position at .button() reference in main.less
        // Line 1 is ".a { .button(); }", try position on "button" (column 7)
        const def = engine.findDefinition(mainUri, Position.create(1, 7));
        expect(def).not.toBeNull();
        expect(def?.uri).toBe(mixinsUri);
        expect(def?.range.start.line).toBe(0);
      });
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

    it('reports undefined Less variable references (semantic)', () => {
      const engine = createEngine();
      const doc = createDocument('less', 'a { color: @missing; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
      const diagnostics = engine.getDiagnostics(doc.uri);
      const codes = diagnostics.map(d => d.code);
      expect(codes).toContain('var/undefined');
    });

    it('reports undefined SCSS variable as warning when @use is not present', () => {
      const engine = createEngine();
      const doc = createDocument('scss', 'a { color: $missing; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
      const diagnostics = engine.getDiagnostics(doc.uri);
      const varDiag = diagnostics.find(d => d.code === 'var/undefined');
      expect(varDiag).toBeDefined();
      expect(varDiag?.severity).toBe(2); // DiagnosticSeverity.Warning
    });

    it('reports undefined SCSS variable as error when @use is present', () => {
      const engine = createEngine();
      const doc = createDocument('scss', '@use "sass:math";\na { color: $missing; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
      const diagnostics = engine.getDiagnostics(doc.uri);
      const varDiag = diagnostics.find(d => d.code === 'var/undefined');
      expect(varDiag).toBeDefined();
      expect(varDiag?.severity).toBe(1); // DiagnosticSeverity.Error
    });

    it('reports undefined Less variable as warning when @from/@compose are not present', () => {
      const engine = createEngine();
      const doc = createDocument('less', 'a { color: @missing; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
      const diagnostics = engine.getDiagnostics(doc.uri);
      const varDiag = diagnostics.find(d => d.code === 'var/undefined');
      expect(varDiag).toBeDefined();
      expect(varDiag?.severity).toBe(2); // DiagnosticSeverity.Warning
    });

    it('reports undefined Less variable as error when @from is present', () => {
      const engine = createEngine();
      const doc = createDocument('less', '@from "vars";\na { color: @missing; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
      const diagnostics = engine.getDiagnostics(doc.uri);
      const varDiag = diagnostics.find(d => d.code === 'var/undefined');
      expect(varDiag).toBeDefined();
      expect(varDiag?.severity).toBe(1); // DiagnosticSeverity.Error
    });

    it('reports undefined Less variable as error when @compose is present', () => {
      const engine = createEngine();
      const doc = createDocument('less', '@compose "button";\na { color: @missing; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
      const diagnostics = engine.getDiagnostics(doc.uri);
      const varDiag = diagnostics.find(d => d.code === 'var/undefined');
      expect(varDiag).toBeDefined();
      expect(varDiag?.severity).toBe(1); // DiagnosticSeverity.Error
    });

    it('reports undefined Less mixin calls (semantic)', () => {
      const engine = createEngine();
      const doc = createDocument('less', '.a { .missing(); }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
      const diagnostics = engine.getDiagnostics(doc.uri);
      const codes = diagnostics.map(d => d.code);
      expect(codes).toContain('mixin/undefined');
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

  describe('folding + selection ranges', () => {
    it('provides folding ranges for multi-line blocks', () => {
      const engine = createEngine();
      const doc = createDocument(
        'css',
        `
          @media screen {
            a {
              color: red;
            }
          }
        `
      );
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
      const folds = engine.getFoldingRanges(doc.uri);
      expect(folds.length).toBeGreaterThan(0);
      expect(folds.some(f => f.startLine < f.endLine)).toBe(true);
    });

    it('provides nested selection ranges at a position', () => {
      const engine = createEngine();
      const doc = createDocument('less', '.a { color: red; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const pos = Position.create(0, 5); // inside selector block
      const ranges = engine.getSelectionRanges(doc.uri, [pos]);
      expect(ranges.length).toBe(1);

      // Ensure there is at least one parent range.
      expect(ranges[0]?.parent).toBeDefined();
    });
  });

  describe('code actions', () => {
    it('offers a quick fix to create an undefined Less variable', () => {
      const engine = createEngine();
      const doc = createDocument('less', 'a { color: @missing; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
      const diags = engine.getDiagnostics(doc.uri);
      const target = diags.find(d => d.code === 'var/undefined');
      expect(target).toBeDefined();

      const actions = engine.getCodeActions(doc.uri, target!.range, { diagnostics: [target!] } as any);
      expect(actions.some(a => a.kind === CodeActionKind.QuickFix)).toBe(true);
      expect(actions.some(a => a.title.includes('Create variable'))).toBe(true);
    });

    it('offers a quick fix to create an undefined Less mixin', () => {
      const engine = createEngine();
      const doc = createDocument('less', '.a { .missing(); }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
      const diags = engine.getDiagnostics(doc.uri);
      const target = diags.find(d => d.code === 'mixin/undefined');
      expect(target).toBeDefined();

      const actions = engine.getCodeActions(doc.uri, target!.range, { diagnostics: [target!] } as any);
      expect(actions.some(a => a.kind === CodeActionKind.QuickFix)).toBe(true);
      expect(actions.some(a => a.title.includes('Create mixin'))).toBe(true);
    });
  });

  describe('formatting', () => {
    it('formats a simple CSS snippet deterministically', () => {
      const engine = createEngine();
      const doc = createDocument('css', 'a{color:red;}');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const edits1 = engine.formatDocument(doc.uri);
      const edits2 = engine.formatDocument(doc.uri);

      expect(edits1).toEqual(edits2);
      expect(edits1.length).toBeGreaterThan(0);
      expect(edits1[0]!.newText).toContain('color');
    });
  });

  describe('document links', () => {
    it('finds url() and @import links', () => {
      const engine = createEngine();
      const doc = createDocument('css', '@import "foo.css";\na { background: url("https://example.com/a.png"); }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
      const links = engine.getDocumentLinks(doc.uri);
      const targets = links.map(l => l.target);
      expect(targets.some(t => String(t).includes('foo.css'))).toBe(true);
      expect(targets).toContain('https://example.com/a.png');
    });

    it('handles Less @import options and repeated imports', () => {
      const engine = createEngine();
      const doc = createDocument(
        'less',
        [
          '@import "import/import-once-test-c";',
          '@import "import/import-once-test-c";',
          '@import "import/import-once-test-c.less";',
          '@import "import/deeper/import-once-test-a";',
          '@import (multiple) "import/import-test-f.less";',
          '@import (multiple) "import/import-test-f.less";'
        ].join('\n')
      );
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
      const links = engine.getDocumentLinks(doc.uri);
      const targets = links.map(l => l.target);
      expect(targets.some(t => String(t).includes('import/import-once-test-c'))).toBe(true);
      expect(targets.some(t => String(t).includes('import/import-test-f.less'))).toBe(true);
    });
  });
});
