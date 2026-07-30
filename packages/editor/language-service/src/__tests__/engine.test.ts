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

        /*
         * Position at .button() reference in main.less
         * Line 1 is ".a { .button(); }", try position on "button" (column 7)
         */
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

    it('uses the full saved span for unsupported SCSS @forward diagnostics', () => {
      const engine = createEngine();
      const input = '@forward "foo" as bar-*;';
      const doc = createDocument('scss', input);
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const diagnostics = engine.getDiagnostics(doc.uri);

      /*
       * `@forward … as <prefix>-*` PARSES (a converted file still yields a tree);
       * it is the evaluation that will never be supported. So this is an
       * unsupported-form diagnostic over the whole at-rule, not a parse error.
       */
      const diag = diagnostics.find(d =>
        d.code === 'unsupported/sass-form'
        && d.message.includes('@forward with "as <prefix>-*" prefixing is not supported')
      );

      expect(diag).toBeDefined();
      expect(diag?.range.start.line).toBe(0);
      expect(diag?.range.start.character).toBe(0);

      const lastChar = doc.positionAt(input.length - 1);
      expect(diag?.range.end.line).toBe(lastChar.line);
      expect((diag?.range.end.character ?? -1)).toBeGreaterThanOrEqual(lastChar.character);
    });

    it('uses the full saved span for unsupported SCSS @at-root filter diagnostics', () => {
      const engine = createEngine();
      const input = `@at-root (without: media) {
  .a { color: red; }
}`;
      const doc = createDocument('scss', input);
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const diagnostics = engine.getDiagnostics(doc.uri);

      // Same as @forward: the filter form parses, but is never evaluated.
      const diag = diagnostics.find(d =>
        d.code === 'unsupported/sass-form'
        && d.message.includes('@at-root prelude/filter forms are not yet supported in Jess')
      );

      expect(diag).toBeDefined();
      expect(diag?.range.start.line).toBe(0);
      expect(diag?.range.start.character).toBe(0);

      const lastChar = doc.positionAt(input.length - 1);
      expect(diag?.range.end.line).toBe(lastChar.line);
      expect((diag?.range.end.character ?? -1)).toBeGreaterThanOrEqual(lastChar.character);
    });

    it('flags @forward show/hide, and leaves the SUPPORTED SCSS forms alone', () => {
      const unsupportedIn = (input: string) => {
        const engine = createEngine();
        const doc = createDocument('scss', input);
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        return engine.getDiagnostics(doc.uri).filter(d => d.code === 'unsupported/sass-form');
      };

      expect(unsupportedIn('@forward "foo" show $a, b;')[0]?.message)
        .toContain('@forward with "show"/"hide" lists is not supported');
      expect(unsupportedIn('@forward "foo" hide $a;')[0]?.message)
        .toContain('@forward with "show"/"hide" lists is not supported');

      /*
       * Supported forms must stay silent: a bare/configured `@forward`, and the
       * `@at-root` forms that carry no prelude filter.
       */
      expect(unsupportedIn('@forward "foo";')).toHaveLength(0);
      expect(unsupportedIn('@forward "foo" with ($a: 1);')).toHaveLength(0);
      expect(unsupportedIn('@at-root { .a { color: red; } }')).toHaveLength(0);
      expect(unsupportedIn('@at-root .b { color: red; }')).toHaveLength(0);
    });

    it('reports the single earliest parser error (1-error-stop contract)', () => {
      /*
       * The functional parsers implement a deliberate "one error and stop" contract:
       * every diagnostic source is collected, then collapsed to the EARLIEST by
       * position. So even input with several structurally-invalid spots yields
       * exactly one parser diagnostic, anchored at the first failure — not a
       * recovery cascade. These inputs each have two bad `)` value tokens; only the
       * first failure is reported (the CSS grammar rejects the whole declaration a
       * little earlier than the Less/SCSS value grammars, hence a distinct anchor).
       */
      const cases: Array<{ languageId: 'css' | 'less' | 'scss'; input: string; start: { line: number; character: number } }> = [
        { languageId: 'css', input: 'a { color: ) ; background: ) ; }', start: { line: 0, character: 4 } },
        { languageId: 'less', input: 'a { color: ) ; background: ) ; }', start: { line: 0, character: 11 } },
        { languageId: 'scss', input: 'a { color: ) ; background: ) ; }', start: { line: 0, character: 11 } }
      ];
      for (const { languageId, input, start } of cases) {
        const engine = createEngine();
        const doc = createDocument(languageId, input);
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const diagnostics = engine.getDiagnostics(doc.uri);
        const parserDiags = diagnostics.filter(d => d.code === 'parse/parser');

        // Exactly one parser error (1-error-stop), no recovery cascade.
        expect(parserDiags).toHaveLength(1);
        expect(diagnostics).toHaveLength(1);
        const diag = parserDiags[0]!;
        expect(diag.source).toBe('jess');

        // Anchored at the earliest failure position (the first bad `)`).
        expect(diag.range.start).toEqual(start);

        // Well-formed, non-degenerate range.
        expect(diag.range.end.line).toBeGreaterThanOrEqual(diag.range.start.line);
        const doc2 = createDocument(languageId, input);
        expect(doc2.offsetAt(diag.range.end)).toBeGreaterThanOrEqual(doc2.offsetAt(diag.range.start));
      }
    });

    it('reports one earliest diagnostic on very broken input (1-error-stop, css/less/scss)', () => {
      /*
       * An unterminated block/comment: the parser stops at the first failure
       * (the point it needed a closing `}`) rather than emitting a cascade. This
       * asserts the single-error contract precisely, including the anchor position.
       */
      const input = 'a { /*';
      for (const languageId of ['css', 'less', 'scss'] as const) {
        const engine = createEngine();
        const doc = createDocument(languageId, input);
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const diagnostics = engine.getDiagnostics(doc.uri);

        // Exactly one diagnostic — the earliest error, not a recovery cascade.
        expect(diagnostics).toHaveLength(1);
        const diag = diagnostics[0]!;
        expect(diag.code).toBe('parse/parser');
        expect(diag.source).toBe('jess');

        // Anchored just after the opening `a { ` where the closer was expected.
        expect(diag.range.start).toEqual({ line: 0, character: 4 });
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

  describe('lint rules (MS css-languageservice parity)', () => {
    const codesOf = (engine: ReturnType<typeof createEngine>, uri: string): string[] =>
      engine.getDiagnostics(uri).map(d => String(d.code));

    /*
     * Build a `configure()` severity payload with a computed key, so the
     * slash-bearing lint codes are not written as object-literal property names.
     */
    const sevCfg = (code: string, severity: string): unknown =>
      ({ diagnostics: { severity: { [code]: severity } } });

    describe('emptyRules (lint/empty-rules)', () => {
      it('fires on an empty ruleset', () => {
        const engine = createEngine();
        const doc = createDocument('css', '.a {}');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const diag = engine.getDiagnostics(doc.uri).find(d => d.code === 'lint/empty-rules');
        expect(diag).toBeDefined();
        expect(diag?.severity).toBe(2); // Warning
      });

      it('fires on a whitespace-only body and a nested empty ruleset', () => {
        const engine = createEngine();
        const doc = createDocument('scss', '.a {   \n  .b {}\n}');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

        // `.a` is NOT empty (contains `.b`); only `.b` is flagged.
        const diags = engine.getDiagnostics(doc.uri).filter(d => d.code === 'lint/empty-rules');
        expect(diags).toHaveLength(1);
      });

      it('does not fire on a non-empty ruleset', () => {
        const engine = createEngine();
        const doc = createDocument('css', '.a { color: red; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/empty-rules');
      });

      it('respects configure() disable', () => {
        const engine = createEngine();
        engine.configure(sevCfg('lint/empty-rules', 'ignore'));
        const doc = createDocument('css', '.a {}');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/empty-rules');
      });
    });

    describe('unknownProperties (lint/unknown-property)', () => {
      it('fires on an unknown property name', () => {
        const engine = createEngine();
        const doc = createDocument('css', '.a { colr: red; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const diag = engine.getDiagnostics(doc.uri).find(d => d.code === 'lint/unknown-property');
        expect(diag).toBeDefined();
        expect(diag?.severity).toBe(2); // Warning
        // Range covers just the property name.
        const slice = doc.getText().slice(doc.offsetAt(diag!.range.start), doc.offsetAt(diag!.range.end));
        expect(slice).toBe('colr');
      });

      it('does not fire on a known property, custom prop, or vendor prefix', () => {
        const engine = createEngine();
        const doc = createDocument('css', '.a { color: red; --my-var: 1; -webkit-mask: none; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/unknown-property');
      });

      it('does not fire on SCSS/Less variable declarations or interpolated names', () => {
        const scss = createEngine();
        const sdoc = createDocument('scss', '$brand: red;\n.a { #{$prop}: red; }');
        scss.open(sdoc.uri, sdoc.languageId, sdoc.version, sdoc.getText());
        expect(codesOf(scss, sdoc.uri)).not.toContain('lint/unknown-property');
      });

      it('respects configure() disable', () => {
        const engine = createEngine();
        engine.configure(sevCfg('lint/unknown-property', 'ignore'));
        const doc = createDocument('css', '.a { colr: red; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/unknown-property');
      });
    });

    describe('unknownPropertyValues (lint/unknown-property-value)', () => {
      it('fires on a definite unknown CSS property keyword value', () => {
        const engine = createEngine();
        const doc = createDocument('css', '.a { display: flxe; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const diag = engine.getDiagnostics(doc.uri).find(d => d.code === 'lint/unknown-property-value');

        expect(diag).toBeDefined();
        expect(diag?.severity).toBe(2); // Warning
        const slice = doc.getText().slice(doc.offsetAt(diag!.range.start), doc.offsetAt(diag!.range.end));
        expect(slice).toBe('flxe');
      });

      it('does not fire on dynamic values, color names, or dialect files before value facts exist', () => {
        const css = createEngine();
        const cssDoc = createDocument('css', '.a { display: var(--kind); color: grue; }');
        css.open(cssDoc.uri, cssDoc.languageId, cssDoc.version, cssDoc.getText());
        expect(codesOf(css, cssDoc.uri)).not.toContain('lint/unknown-property-value');

        const less = createEngine();
        const lessDoc = createDocument('less', '.a { display: flxe; }');
        less.open(lessDoc.uri, lessDoc.languageId, lessDoc.version, lessDoc.getText());
        expect(codesOf(less, lessDoc.uri)).not.toContain('lint/unknown-property-value');
      });

      it('respects configure() disable', () => {
        const engine = createEngine();
        engine.configure(sevCfg('lint/unknown-property-value', 'ignore'));
        const doc = createDocument('css', '.a { display: flxe; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/unknown-property-value');
      });
    });

    describe('unknownAtRules (lint/unknown-at-rule)', () => {
      it('fires on an unknown at-rule', () => {
        const engine = createEngine();
        const doc = createDocument('css', '@foobar x { }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const diag = engine.getDiagnostics(doc.uri).find(d => d.code === 'lint/unknown-at-rule');
        expect(diag).toBeDefined();
        expect(diag?.severity).toBe(2); // Warning
      });

      it('does not fire on known CSS at-rules', () => {
        const engine = createEngine();
        const doc = createDocument('css', '@media screen { .a { color: red; } }\n@font-face { font-family: x; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/unknown-at-rule');
      });

      it('does not false-flag SCSS dialect at-rules', () => {
        const engine = createEngine();
        const doc = createDocument('scss', '@mixin foo { color: red; }\n@include foo;\n@if true { .a { color: red; } }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/unknown-at-rule');
      });

      it('respects configure() disable', () => {
        const engine = createEngine();
        engine.configure(sevCfg('lint/unknown-at-rule', 'ignore'));
        const doc = createDocument('css', '@foobar x { }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/unknown-at-rule');
      });
    });

    describe('fontFaceMissingRequiredProperties (lint/font-face-missing-required-properties)', () => {
      it('fires on a CSS @font-face block missing required descriptors', () => {
        const engine = createEngine();
        const doc = createDocument('css', '@font-face { font-family: Inter; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const diag = engine.getDiagnostics(doc.uri).find(d => d.code === 'lint/font-face-missing-required-properties');

        expect(diag).toBeDefined();
        expect(diag?.severity).toBe(2); // Warning
        const slice = doc.getText().slice(doc.offsetAt(diag!.range.start), doc.offsetAt(diag!.range.end));
        expect(slice).toBe('@font-face');
      });

      it('does not fire on complete CSS @font-face blocks or dialect files before semantic facts exist', () => {
        const css = createEngine();
        const cssDoc = createDocument('css', '@font-face { font-family: Inter; src: url(inter.woff2); }');
        css.open(cssDoc.uri, cssDoc.languageId, cssDoc.version, cssDoc.getText());
        expect(codesOf(css, cssDoc.uri)).not.toContain('lint/font-face-missing-required-properties');

        const scss = createEngine();
        const scssDoc = createDocument('scss', '@font-face { font-family: Inter; }');
        scss.open(scssDoc.uri, scssDoc.languageId, scssDoc.version, scssDoc.getText());
        expect(codesOf(scss, scssDoc.uri)).not.toContain('lint/font-face-missing-required-properties');
      });

      it('respects configure() disable', () => {
        const engine = createEngine();
        engine.configure(sevCfg('lint/font-face-missing-required-properties', 'ignore'));
        const doc = createDocument('css', '@font-face { font-family: Inter; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/font-face-missing-required-properties');
      });
    });

    describe('propertyIgnoredDueToDisplay (lint/property-ignored-due-to-display)', () => {
      it('fires on CSS properties that display mode ignores', () => {
        const engine = createEngine();
        const doc = createDocument('css', '.a { display: block; vertical-align: middle; }\n.b { display: inline-block; float: left; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const diags = engine.getDiagnostics(doc.uri).filter(d => d.code === 'lint/property-ignored-due-to-display');

        expect(diags).toHaveLength(2);
        expect(diags.map(d => d.severity)).toEqual([2, 2]); // Warning
        const slices = diags.map(d => doc.getText().slice(doc.offsetAt(d.range.start), doc.offsetAt(d.range.end)));
        expect(slices).toEqual(['vertical-align: middle', 'float: left']);
      });

      it('does not fire in dialect files before value facts exist', () => {
        const engine = createEngine();
        const doc = createDocument('less', '.a { display: block; vertical-align: middle; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/property-ignored-due-to-display');
      });

      it('respects configure() disable', () => {
        const engine = createEngine();
        engine.configure(sevCfg('lint/property-ignored-due-to-display', 'ignore'));
        const doc = createDocument('css', '.a { display: block; vertical-align: middle; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/property-ignored-due-to-display');
      });
    });

    describe('boxModel (lint/box-model)', () => {
      it('stays quiet by default because VSCode marks boxModel opt-in', () => {
        const engine = createEngine();
        const doc = createDocument('css', '.a { width: 100px; padding-left: 1px; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/box-model');
      });

      it('fires when configured as a warning', () => {
        const engine = createEngine();
        engine.configure(sevCfg('lint/box-model', 'warning'));
        const doc = createDocument('css', '.a { width: 100px; padding-left: 1px; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const diags = engine.getDiagnostics(doc.uri).filter(d => d.code === 'lint/box-model');

        expect(diags).toHaveLength(2);
        expect(diags.map(d => d.severity)).toEqual([2, 2]); // Warning
        const slices = diags.map(d => doc.getText().slice(doc.offsetAt(d.range.start), doc.offsetAt(d.range.end)));
        expect(slices).toEqual(['width: 100px', 'padding-left: 1px']);
      });

      it('does not fire in dialect files before value facts exist', () => {
        const engine = createEngine();
        engine.configure(sevCfg('lint/box-model', 'warning'));
        const doc = createDocument('scss', '.a { width: 100px; padding-left: 1px; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/box-model');
      });
    });

    describe('recommended shared diagnostics', () => {
      it('surfaces stable diagnostics in the editor by default', () => {
        const engine = createEngine();
        const source = [
          '@property --gap { syntax: "<length>"; inherits: yes; initial-value: red; }',
          '.a:nonsense { color: --brand; animation: missing 1s; grid-template-areas: "a" "a b"; }',
          '.a:nonsense { color: red; }'
        ].join('\n');
        const doc = createDocument('css', source);
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const codes = codesOf(engine, doc.uri);

        expect(codes).toContain('lint/at-rule-descriptor-value-no-unknown');
        expect(codes).toContain('lint/invalid-typed-custom-property-value');
        expect(codes).toContain('lint/custom-property-no-missing-var-function');
        expect(codes).toContain('lint/no-unknown-animations');
        expect(codes).toContain('lint/named-grid-areas-no-invalid');
        expect(codes).toContain('lint/selector-pseudo-class-no-unknown');
        expect(codes).toContain('lint/no-duplicate-selectors');
      });

      it('respects configure() disable for recommended shared diagnostics', () => {
        const engine = createEngine();
        engine.configure(sevCfg('lint/no-unknown-animations', 'ignore'));
        const doc = createDocument('css', '.a { animation: missing 1s; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/no-unknown-animations');
      });
    });

    describe('duplicateProperties (lint/duplicate-property)', () => {
      it('fires when a property is declared twice in one block', () => {
        const engine = createEngine();
        const doc = createDocument('css', '.a { color: red; color: blue; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const diags = engine.getDiagnostics(doc.uri).filter(d => d.code === 'lint/duplicate-property');
        expect(diags).toHaveLength(1);
        expect(diags[0]?.severity).toBe(2); // Warning
      });

      it('does not fire when the same property appears in different blocks', () => {
        const engine = createEngine();
        const doc = createDocument('css', '.a { color: red; }\n.b { color: blue; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/duplicate-property');
      });

      it('respects configure() disable', () => {
        const engine = createEngine();
        engine.configure(sevCfg('lint/duplicate-property', 'ignore'));
        const doc = createDocument('css', '.a { color: red; color: blue; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/duplicate-property');
      });
    });

    describe('hexColorLength (lint/hex-color-length)', () => {
      it('fires on a hex color without 3/4/6/8 digits (as an error)', () => {
        const engine = createEngine();
        const doc = createDocument('css', '.a { color: #12345; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const diag = engine.getDiagnostics(doc.uri).find(d => d.code === 'lint/hex-color-length');
        expect(diag).toBeDefined();
        expect(diag?.severity).toBe(1); // Error
      });

      it('does not fire on valid 3/6-digit hex colors', () => {
        const engine = createEngine();
        const doc = createDocument('css', '.a { color: #fff; background: #ff0000; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/hex-color-length');
      });

      it('does not fire on a hex-like sequence inside a string', () => {
        const engine = createEngine();
        const doc = createDocument('css', '.a { content: "#ff"; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/hex-color-length');
      });

      it('respects configure() disable', () => {
        const engine = createEngine();
        engine.configure(sevCfg('lint/hex-color-length', 'ignore'));
        const doc = createDocument('css', '.a { color: #12345; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/hex-color-length');
      });

      it('is configurable to a different severity', () => {
        const engine = createEngine();
        engine.configure(sevCfg('lint/hex-color-length', 'warning'));
        const doc = createDocument('css', '.a { color: #12345; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const diag = engine.getDiagnostics(doc.uri).find(d => d.code === 'lint/hex-color-length');
        expect(diag?.severity).toBe(2); // Warning
      });
    });

    describe('zeroUnits (lint/zero-units)', () => {
      it('fires on a zero value with a length unit (as a hint)', () => {
        const engine = createEngine();
        const doc = createDocument('css', '.a { margin: 0px; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const diag = engine.getDiagnostics(doc.uri).find(d => d.code === 'lint/zero-units');
        expect(diag).toBeDefined();
        expect(diag?.severity).toBe(4); // Hint
      });

      it('does not fire on bare 0, or on non-length units (0%, 0s)', () => {
        const engine = createEngine();
        const doc = createDocument('css', '.a { padding: 0; opacity: 0; width: 0%; transition-delay: 0s; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/zero-units');
      });

      it('respects configure() disable', () => {
        const engine = createEngine();
        engine.configure(sevCfg('lint/zero-units', 'ignore'));
        const doc = createDocument('css', '.a { margin: 0px; }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/zero-units');
      });
    });

    describe('invalidColorFunctionChannels (lint/invalid-color-function-channels)', () => {
      it('fires on invalid CSS color function arguments as an error', () => {
        const engine = createEngine();
        const doc = createDocument('css', '.a { color: hsl(120 50 50%); }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        const diag = engine.getDiagnostics(doc.uri).find(d => d.code === 'lint/invalid-color-function-channels');

        expect(diag).toBeDefined();
        expect(diag?.severity).toBe(1); // Error
      });

      it('does not fire in dialect files before value facts exist', () => {
        const engine = createEngine();
        const doc = createDocument('less', '.a { color: hsl(120 50 50%); }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/invalid-color-function-channels');
      });

      it('respects configure() disable', () => {
        const engine = createEngine();
        engine.configure(sevCfg('lint/invalid-color-function-channels', 'ignore'));
        const doc = createDocument('css', '.a { color: hsl(120 50 50%); }');
        engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
        expect(codesOf(engine, doc.uri)).not.toContain('lint/invalid-color-function-channels');
      });
    });

    it('lint rules stay tolerant: they fire despite a syntax error elsewhere', () => {
      const engine = createEngine();

      /*
       * The trailing `.bad { color: ) ;` region is malformed, but the earlier
       * empty ruleset and unknown property are still flagged off the tolerant
       * CST (the AST-based semantic path would yield nothing on invalid input).
       */
      const doc = createDocument('css', '.empty {}\n.a { color: red; colr: red; }\n.bad { color: ) ;');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
      const codes = codesOf(engine, doc.uri);
      expect(codes).toContain('lint/empty-rules');
      expect(codes).toContain('lint/unknown-property');
    });
  });

  describe('semantic tokens', () => {
    /*
     * Helper to decode semantic tokens data array
     * Format: [deltaLine, deltaStartChar, length, tokenType, tokenModifiers]
     */
    function decodeSemanticTokens(data: number[], types: string[], modifiers: string[]): Array<{
      line: number;
      char: number;
      length: number;
      type: string;
      modifiers: number;
    }> {
      const tokens: Array<{ line: number; char: number; length: number; type: string; modifiers: number }> = [];
      let currentLine = 0;
      let currentChar = 0;

      for (let i = 0; i < data.length; i += 5) {
        const deltaLine = data[i]!;
        const deltaStartChar = data[i + 1]!;
        const length = data[i + 2]!;
        const typeIdx = data[i + 3]!;
        const tokenModifiers = data[i + 4]!;

        if (deltaLine === 0) {
          currentChar += deltaStartChar;
        } else {
          currentLine += deltaLine;
          currentChar = deltaStartChar;
        }

        const type = types[typeIdx] || 'unknown';
        tokens.push({
          line: currentLine,
          char: currentChar,
          length,
          type,
          modifiers: tokenModifiers
        });
      }

      return tokens;
    }

    it('splits interpolated strings into separate tokens', () => {
      const engine = createEngine();
      const doc = createDocument('less', '@import "import/import-@{my_theme}-e.less";');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const semanticTokens = engine.getSemanticTokens(doc.uri);
      expect(semanticTokens).toBeDefined();
      expect(semanticTokens.data).toBeDefined();

      // Decode tokens
      const types = ['comment', 'string', 'keyword', 'enumMember', 'number', 'operator', 'function', 'variable', 'property', 'type', 'class', 'namespace'];
      const modifiers: string[] = []; // No modifiers in legend for now
      const tokens = decodeSemanticTokens(semanticTokens.data, types, modifiers);

      // Find tokens on line 0 (the import line)
      const line0Tokens = tokens.filter(t => t.line === 0);

      // Debug: log all tokens to see what we're getting
      console.log('Line 0 tokens:', JSON.stringify(line0Tokens, null, 2));

      /*
       * Should have separate tokens for:
       * - @import (namespace)
       * - " (string - opening quote)
       * - import/import- (string)
       * - @{my_theme} (variable)
       * - -e.less (string)
       * - " (string - closing quote)
       * - ; (operator)
       */

      const stringTokens = line0Tokens.filter(t => t.type === 'string');
      const variableTokens = line0Tokens.filter(t => t.type === 'variable');
      const namespaceTokens = line0Tokens.filter(t => t.type === 'namespace');

      // Should have at least 3 string tokens (opening quote, content parts, closing quote)
      expect(stringTokens.length).toBeGreaterThanOrEqual(3);

      // Should have 1 variable token for @{my_theme}
      expect(variableTokens.length).toBeGreaterThanOrEqual(1);

      // Should have 1 namespace token for @import
      expect(namespaceTokens.length).toBeGreaterThanOrEqual(1);
    });

    it('creates separate diagnostics for each interpolation in a string', () => {
      const engine = createEngine();
      const doc = createDocument('less', '@import "import/import-@{in}@{terpolation}.less";');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const diagnostics = engine.getDiagnostics(doc.uri);
      const varDiags = diagnostics.filter(d => d.code === 'var/undefined');

      // Debug: log diagnostics to see what we're getting
      console.log('Variable diagnostics:', JSON.stringify(varDiags.map(d => ({
        message: d.message,
        range: d.range,
        code: d.code
      })), null, 2));
      console.log('Document text:', JSON.stringify(doc.getText()));
      console.log('Expected: @{in} should be around char 25, @{terpolation} should be around char 31');

      // Should have 2 separate diagnostics, one for @{in} and one for @{terpolation}
      expect(varDiags.length).toBeGreaterThanOrEqual(2);

      // Each diagnostic should have a different range
      const ranges = varDiags.map(d => d.range);
      expect(ranges.length).toBeGreaterThanOrEqual(2);

      // Verify the ranges are different (they should point to different interpolations)
      if (ranges.length >= 2) {
        expect(ranges[0]!.start.character).not.toBe(ranges[1]!.start.character);
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

      // Collect all symbols recursively (including children)
      const allSymbols: DocumentSymbol[] = [];
      const collect = (symbols: DocumentSymbol[]) => {
        for (const sym of symbols) {
          allSymbols.push(sym);
          if (sym.children && sym.children.length > 0) {
            collect(sym.children);
          }
        }
      };
      collect(syms);

      const names = allSymbols.map(s => s.name);
      const kinds = allSymbols.map(s => s.kind);

      expect(kinds).toContain(SymbolKind.Variable);
      expect(kinds).toContain(SymbolKind.Namespace);
      expect(kinds).toContain(SymbolKind.Class);

      expect(names.some(n => n.includes('@media'))).toBe(true);
      expect(names.some(n => n.includes('.a'))).toBe(true);
      expect(names.some(n => n.includes('$primary'))).toBe(true);
    });

    it('returns hierarchical symbols with nested structure', () => {
      const engine = createEngine();
      const doc = createDocument(
        'less',
        `
          @primary: red;
          @media (min-width: 768px) {
            .container {
              @secondary: blue;
              .button { color: @primary; }
            }
          }
        `
      );
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const syms = engine.getDocumentSymbols(doc.uri);

      // Find @media symbol
      const mediaSym = syms.find(s => s.name.includes('@media'));
      expect(mediaSym).toBeDefined();
      expect(mediaSym?.kind).toBe(SymbolKind.Namespace);

      // @media should have .container as a child
      expect(mediaSym?.children).toBeDefined();
      const containerSym = mediaSym?.children?.find(s => s.name.includes('.container'));
      expect(containerSym).toBeDefined();
      expect(containerSym?.kind).toBe(SymbolKind.Class);

      // .container should have @secondary and .button as children
      expect(containerSym?.children).toBeDefined();
      const secondarySym = containerSym?.children?.find(s => s.name.includes('@secondary'));
      expect(secondarySym).toBeDefined();
      expect(secondarySym?.kind).toBe(SymbolKind.Variable);

      const buttonSym = containerSym?.children?.find(s => s.name.includes('.button'));
      expect(buttonSym).toBeDefined();
      expect(buttonSym?.kind).toBe(SymbolKind.Class);
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

      const actions = engine.getCodeActions(doc.uri, target!.range, { diagnostics: [target!] });
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

      const actions = engine.getCodeActions(doc.uri, target!.range, { diagnostics: [target!] });
      expect(actions.some(a => a.kind === CodeActionKind.QuickFix)).toBe(true);
      expect(actions.some(a => a.title.includes('Create mixin'))).toBe(true);
    });

    it('offers a "did you mean" fix for a mistyped Less variable', () => {
      const engine = createEngine();
      const doc = createDocument('less', '@primary: red;\na { color: @primay; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
      const diags = engine.getDiagnostics(doc.uri);
      const target = diags.find(d => d.code === 'var/undefined');
      expect(target).toBeDefined();

      const actions = engine.getCodeActions(doc.uri, target!.range, { diagnostics: [target!] });
      const didYouMean = actions.find(a => a.title === 'Change to @primary');
      expect(didYouMean).toBeDefined();

      // The fix rewrites only the identifier, keeping the `@` sigil.
      const textEdits = didYouMean?.edit?.changes?.[doc.uri] ?? [];
      expect(textEdits.length).toBe(1);
      expect(textEdits[0]!.newText).toBe('@primary');
    });

    it('offers a "did you mean" fix for a mistyped Less mixin', () => {
      const engine = createEngine();
      const doc = createDocument('less', '.button() { color: red; }\n.a { .buton(); }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
      const diags = engine.getDiagnostics(doc.uri);
      const target = diags.find(d => d.code === 'mixin/undefined');
      expect(target).toBeDefined();

      const actions = engine.getCodeActions(doc.uri, target!.range, { diagnostics: [target!] });
      const didYouMean = actions.find(a => a.title.startsWith('Change to .button'));
      expect(didYouMean).toBeDefined();

      // The fix keeps the `.` combinator and only swaps the identifier.
      const textEdits = didYouMean?.edit?.changes?.[doc.uri] ?? [];
      expect(textEdits.length).toBe(1);
      expect(textEdits[0]!.newText.startsWith('.button')).toBe(true);
    });

    it('does not offer a "did you mean" fix when nothing is close', () => {
      const engine = createEngine();
      const doc = createDocument('less', '@primary: red;\na { color: @zzzzzz; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());
      const diags = engine.getDiagnostics(doc.uri);
      const target = diags.find(d => d.code === 'var/undefined');
      const actions = engine.getCodeActions(doc.uri, target!.range, { diagnostics: [target!] });
      expect(actions.some(a => a.title.startsWith('Change to'))).toBe(false);

      // The create-variable fix is still offered.
      expect(actions.some(a => a.title.includes('Create variable'))).toBe(true);
    });
  });

  describe('rename', () => {
    let tempDir = '';
    afterEach(() => {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      tempDir = '';
    });

    /*
     * Apply a WorkspaceEdit's edits for one uri to `text` (offsets computed
     * against `text`; edits are applied right-to-left so earlier ones stay valid).
     */
    function applyEdits(text: string, uri: string, edit: { changes?: Record<string, Array<{ range: { start: Position; end: Position }; newText: string }>> } | null): string {
      const doc = TextDocument.create(uri, 'less', 1, text);
      const edits = edit?.changes?.[uri] ?? [];
      const sorted = [...edits].sort((a, b) => doc.offsetAt(b.range.start) - doc.offsetAt(a.range.start));
      let out = text;
      for (const e of sorted) {
        const from = doc.offsetAt(e.range.start);
        const to = doc.offsetAt(e.range.end);
        out = out.slice(0, from) + e.newText + out.slice(to);
      }
      return out;
    }

    it('prepareRename yields the bare identifier of a Less variable', () => {
      const engine = createEngine();
      const doc = createDocument('less', '@primary: red;\na { color: @primary; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const prep = engine.prepareRename(doc.uri, Position.create(1, 14));
      expect(prep).not.toBeNull();
      expect(prep?.placeholder).toBe('primary');
    });

    it('prepareRename returns null when the cursor is not on a symbol', () => {
      const engine = createEngine();
      const doc = createDocument('less', '@primary: red;\na { color: @primary; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      // Cursor on the `red` value of the declaration — not a renameable symbol.
      const prep = engine.prepareRename(doc.uri, Position.create(0, 11));
      expect(prep).toBeNull();
    });

    it('renames every occurrence of a Less variable (declaration + references)', () => {
      const engine = createEngine();
      const src = '@primary: red;\na { color: @primary; }\nb { background: @primary; }';
      const doc = createDocument('less', src);
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const edit = engine.rename(doc.uri, Position.create(1, 14), 'secondary');
      expect(edit).not.toBeNull();
      const edits = edit?.changes?.[doc.uri] ?? [];
      expect(edits.length).toBe(3);

      // Every edit rewrites only the bare identifier.
      expect(edits.every(e => e.newText === 'secondary')).toBe(true);

      const result = applyEdits(src, doc.uri, edit);
      expect(result).toBe('@secondary: red;\na { color: @secondary; }\nb { background: @secondary; }');
      expect(result).not.toContain('@primary');
    });

    it('tolerates a sigil in the requested new name', () => {
      const engine = createEngine();
      const src = '@primary: red;\na { color: @primary; }';
      const doc = createDocument('less', src);
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const edit = engine.rename(doc.uri, Position.create(1, 14), '@brand');
      const result = applyEdits(src, doc.uri, edit);
      expect(result).toBe('@brand: red;\na { color: @brand; }');
    });

    it('renames an SCSS variable', () => {
      const engine = createEngine();
      const src = '$primary: red;\na { color: $primary; }';
      const doc = createDocument('scss', src);
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const edit = engine.rename(doc.uri, Position.create(1, 14), 'accent');
      const edits = edit?.changes?.[doc.uri] ?? [];
      expect(edits.length).toBe(2);
      const doc2 = TextDocument.create(doc.uri, 'scss', 1, src);
      const sorted = [...edits].sort((a, b) => doc2.offsetAt(b.range.start) - doc2.offsetAt(a.range.start));
      let result = src;
      for (const e of sorted) {
        result = result.slice(0, doc2.offsetAt(e.range.start)) + e.newText + result.slice(doc2.offsetAt(e.range.end));
      }
      expect(result).toBe('$accent: red;\na { color: $accent; }');
    });

    it('renames a Less mixin, preserving the leading combinator', () => {
      const engine = createEngine();
      const src = '.button() { color: red; }\n.a { .button(); }';
      const doc = createDocument('less', src);
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const edit = engine.rename(doc.uri, Position.create(1, 7), 'btn');
      expect(edit).not.toBeNull();
      const result = applyEdits(src, doc.uri, edit);
      expect(result).toContain('.btn()');
      expect(result).not.toContain('.button');
    });

    it('renames a Less variable across files', () => {
      tempDir = fs.mkdtempSync(path.join(process.cwd(), 'rename-'));
      const varsFile = path.join(tempDir, 'vars.less');
      const mainFile = path.join(tempDir, 'main.less');
      fs.writeFileSync(varsFile, '@primary: red;');
      fs.writeFileSync(mainFile, '@import "vars";\n.a { color: @primary; }\n.b { background: @primary; }');

      const engine = createEngine();
      const varsUri = String(pathToFileURL(varsFile));
      const mainUri = String(pathToFileURL(mainFile));
      engine.open(varsUri, 'less', 1, fs.readFileSync(varsFile, 'utf-8'));
      engine.open(mainUri, 'less', 1, fs.readFileSync(mainFile, 'utf-8'));

      // Rename from the declaration in vars.less.
      const edit = engine.rename(varsUri, Position.create(0, 2), 'brand');
      expect(edit).not.toBeNull();
      expect((edit?.changes?.[varsUri] ?? []).length).toBe(1);
      expect((edit?.changes?.[mainUri] ?? []).length).toBe(2);
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

  describe('color detection', () => {
    it('detects color keywords', async () => {
      const engine = createEngine();
      const doc = createDocument('css', 'a { color: red; background: blue; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const colors = await engine.getDocumentColors(doc.uri);
      expect(colors.length).toBeGreaterThanOrEqual(2);

      // Check that we found red and blue
      const colorValues = colors.map((c) => {
        const r = Math.round(c.color.red * 255);
        const g = Math.round(c.color.green * 255);
        const b = Math.round(c.color.blue * 255);
        return `${r},${g},${b}`;
      });

      // Red is rgb(255, 0, 0)
      expect(colorValues).toContain('255,0,0');

      // Blue is rgb(0, 0, 255)
      expect(colorValues).toContain('0,0,255');
    });

    it('detects hex colors', async () => {
      const engine = createEngine();
      const doc = createDocument('css', 'a { color: #ff0000; background: #00ff00; }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const colors = await engine.getDocumentColors(doc.uri);
      expect(colors.length).toBeGreaterThanOrEqual(2);

      const colorValues = colors.map((c) => {
        const r = Math.round(c.color.red * 255);
        const g = Math.round(c.color.green * 255);
        const b = Math.round(c.color.blue * 255);
        return `${r},${g},${b}`;
      });

      // #ff0000 is red
      expect(colorValues).toContain('255,0,0');

      // #00ff00 is green
      expect(colorValues).toContain('0,255,0');
    });

    it('detects rgb() color functions', async () => {
      const engine = createEngine();
      const doc = createDocument('css', 'a { color: rgb(255, 0, 0); background: rgb(0, 128, 255); }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const colors = await engine.getDocumentColors(doc.uri);
      expect(colors.length).toBeGreaterThanOrEqual(2);

      const colorValues = colors.map((c) => {
        const r = Math.round(c.color.red * 255);
        const g = Math.round(c.color.green * 255);
        const b = Math.round(c.color.blue * 255);
        return `${r},${g},${b}`;
      });

      // rgb(255, 0, 0) is red
      expect(colorValues).toContain('255,0,0');

      // rgb(0, 128, 255) is a blue
      expect(colorValues).toContain('0,128,255');
    });

    it('detects hsl() color functions', async () => {
      const engine = createEngine();
      const doc = createDocument('css', 'a { color: hsl(0, 100%, 50%); background: hsl(120, 100%, 50%); }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const colors = await engine.getDocumentColors(doc.uri);
      expect(colors.length).toBeGreaterThanOrEqual(2);

      const colorValues = colors.map((c) => {
        const r = Math.round(c.color.red * 255);
        const g = Math.round(c.color.green * 255);
        const b = Math.round(c.color.blue * 255);
        return `${r},${g},${b}`;
      });

      // hsl(0, 100%, 50%) is red (approximately 255, 0, 0)
      expect(colorValues.some(v => v.startsWith('255,0,0') || v.startsWith('254,0,0'))).toBe(true);

      // hsl(120, 100%, 50%) is green (approximately 0, 255, 0)
      expect(colorValues.some(v => v.startsWith('0,255,0') || v.startsWith('0,254,0'))).toBe(true);
    });

    it('detects rgba() color functions with alpha', async () => {
      const engine = createEngine();
      const doc = createDocument('css', 'a { color: rgba(255, 0, 0, 0.5); }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const colors = await engine.getDocumentColors(doc.uri);
      expect(colors.length).toBeGreaterThanOrEqual(1);

      const color = colors[0]!;
      expect(Math.round(color.color.red * 255)).toBe(255);
      expect(Math.round(color.color.green * 255)).toBe(0);
      expect(Math.round(color.color.blue * 255)).toBe(0);
      expect(color.color.alpha).toBeCloseTo(0.5, 1);
    });

    it('detects Less color functions (rgb, hsl)', async () => {
      const engine = createEngine();
      const doc = createDocument('less', 'a { color: rgb(128, 64, 32); background: hsl(240, 50%, 50%); }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const colors = await engine.getDocumentColors(doc.uri);
      expect(colors.length).toBeGreaterThanOrEqual(2);

      const colorValues = colors.map((c) => {
        const r = Math.round(c.color.red * 255);
        const g = Math.round(c.color.green * 255);
        const b = Math.round(c.color.blue * 255);
        return `${r},${g},${b}`;
      });

      // rgb(128, 64, 32)
      expect(colorValues).toContain('128,64,32');
    });

    it('handles invalid color functions gracefully', async () => {
      const engine = createEngine();

      // rgb() with wrong number of arguments or invalid values
      const doc = createDocument('css', 'a { color: rgb(255); background: rgb(256, 0, 0); }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      // Should not throw, but may or may not detect colors depending on evaluation
      const colors = await engine.getDocumentColors(doc.uri);

      // Should still work (might detect some colors or none, but shouldn't crash)
      expect(Array.isArray(colors)).toBe(true);
    });

    it('handles color functions with variables (should not evaluate)', async () => {
      const engine = createEngine();

      // Less variable in color function - should not be evaluated
      const doc = createDocument('less', '@r: 255;\na { color: rgb(@r, 0, 0); }');
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const colors = await engine.getDocumentColors(doc.uri);

      /*
       * Since @r is a variable, the function can't be statically evaluated
       * So we might not get a color, but it shouldn't crash
       */
      expect(Array.isArray(colors)).toBe(true);
    });

    it('detects multiple color formats in one document', async () => {
      const engine = createEngine();
      const doc = createDocument(
        'css',
        `
          a { color: red; }
          b { color: #00ff00; }
          c { color: rgb(0, 0, 255); }
          d { color: hsl(60, 100%, 50%); }
        `
      );
      engine.open(doc.uri, doc.languageId, doc.version, doc.getText());

      const colors = await engine.getDocumentColors(doc.uri);
      expect(colors.length).toBeGreaterThanOrEqual(4);

      const colorValues = colors.map((c) => {
        const r = Math.round(c.color.red * 255);
        const g = Math.round(c.color.green * 255);
        const b = Math.round(c.color.blue * 255);
        return `${r},${g},${b}`;
      });

      // Should have red, green, blue, and yellow (from hsl)
      expect(colorValues).toContain('255,0,0'); // red
      expect(colorValues).toContain('0,255,0'); // green (#00ff00)
      expect(colorValues).toContain('0,0,255'); // blue (rgb)
      // Yellow from hsl(60, 100%, 50%) is approximately 255, 255, 0
      expect(colorValues.some(v => v.startsWith('255,255,0') || v.startsWith('254,254,0'))).toBe(true);
    });
  });
});
