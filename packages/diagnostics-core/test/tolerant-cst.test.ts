import { describe, expect, it } from 'vitest';
import { collectTolerantDiagnostics, LINT_CODES } from '../src/index.js';

describe('collectTolerantDiagnostics', () => {
  it('reports CST-grounded lint findings with parser-captured source positions', () => {
    const result = collectTolerantDiagnostics({
      source: '.a {\n  colr: red;\n  width: 0px;\n}',
      language: 'css',
      filePath: '/tmp/input.css'
    });

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain(LINT_CODES.unknownProperties);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain(LINT_CODES.zeroUnits);
    expect(result.diagnostics.every(diagnostic => diagnostic.filePath === '/tmp/input.css')).toBe(true);
    expect(result.diagnostics.find(diagnostic => diagnostic.code === LINT_CODES.unknownProperties)).toMatchObject({
      line: 2,
      column: 3
    });
    expect(result.diagnostics.find(diagnostic => diagnostic.code === LINT_CODES.zeroUnits)).toMatchObject({
      line: 3,
      column: 10
    });
  });

  it('uses caller-provided CSS metadata for known properties', () => {
    const result = collectTolerantDiagnostics({
      source: '.a { colr: red; }',
      language: 'css',
      metadata: {
        isKnownProperty: name => name === 'colr'
      }
    });

    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownProperties)).toBe(false);
  });

  it('recognizes lint-relevant nodes from direct SCSS and Jess grammars', () => {
    const scss = collectTolerantDiagnostics({
      source: '.a { .b {} }',
      language: 'scss'
    });
    const jess = collectTolerantDiagnostics({
      source: '.a { colr: red; width: 0px; }',
      language: 'jess'
    });

    expect(scss.diagnostics.map(diagnostic => diagnostic.code)).toContain(LINT_CODES.emptyRules);
    expect(jess.diagnostics.map(diagnostic => diagnostic.code)).toContain(LINT_CODES.unknownProperties);
    expect(jess.diagnostics.map(diagnostic => diagnostic.code)).toContain(LINT_CODES.zeroUnits);
  });

  it('keeps invalid hex-color diagnostics tolerant when the declaration node is not produced', () => {
    const result = collectTolerantDiagnostics({
      source: '#abcde { color: red; }\n.a { color: #12345; }',
      language: 'css'
    });
    const hexDiagnostics = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.hexColorLength);

    expect(hexDiagnostics).toHaveLength(1);
    expect(hexDiagnostics[0]?.start).toBe('#abcde { color: red; }\n.a { color: '.length);
  });

  it('reports bare custom property reads without flagging var() calls or custom declarations', () => {
    const result = collectTolerantDiagnostics({
      source: '.a { color: --brand; background: var(--ok); --local: --allowed; }',
      language: 'css'
    });
    const customPropertyReads = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.customPropertyMissingVarFunction
    );

    expect(customPropertyReads).toHaveLength(1);
    expect(customPropertyReads[0]).toMatchObject({
      message: 'Use var(--brand) when reading a custom property',
      start: '.a { color: '.length
    });
  });

  it('reports duplicate keyframe selectors and important keyframe declarations', () => {
    const result = collectTolerantDiagnostics({
      source: '@keyframes spin { from { opacity: 1 !important; } 0% { opacity: .5; } 50% { color: red; } 50% { color: blue; } }',
      language: 'css'
    });

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain(LINT_CODES.keyframeDeclarationNoImportant);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain(LINT_CODES.keyframeDuplicateSelectors);
    expect(result.diagnostics.find(diagnostic => diagnostic.code === LINT_CODES.keyframeDuplicateSelectors)).toMatchObject({
      message: 'Duplicate keyframe selector \'0%\''
    });
  });

  it('reports duplicate font families and missing generic family keywords', () => {
    const result = collectTolerantDiagnostics({
      source: '.a { font-family: Inter, "Open Sans", inter; }\n.b { font-family: Arial, sans-serif; }\n.c { font: 12px/16px Arial; }',
      language: 'css'
    });

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain(LINT_CODES.fontFamilyDuplicateNames);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain(LINT_CODES.fontFamilyMissingGeneric);
    expect(result.diagnostics.find(diagnostic => diagnostic.code === LINT_CODES.fontFamilyDuplicateNames)).toMatchObject({
      message: 'Duplicate font family \'inter\''
    });
    expect(result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.fontFamilyMissingGeneric)).toHaveLength(2);
  });

  it('does not report missing generic font families for CSS-wide, dynamic, or @font-face values', () => {
    const result = collectTolerantDiagnostics({
      source: '@font-face { font-family: Headline; src: url(headline.woff2); }\n.a { font-family: inherit; }\n.b { font-family: var(--family); }\n.c { font-family: $family; }',
      language: 'css'
    });

    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.fontFamilyMissingGeneric)).toBe(false);
  });

  it('reports duplicate @import rules with the same target and conditions', () => {
    const result = collectTolerantDiagnostics({
      source: '@import url("a.css");\n@import "a.css";\n@import url(b.css) screen;\n@import url(b.css) print;\n@import url("b.css") screen;',
      language: 'css'
    });
    const duplicates = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.duplicateAtImportRules);

    expect(duplicates).toHaveLength(2);
    expect(duplicates.map(diagnostic => diagnostic.message)).toEqual([
      'Duplicate @import rule a.css',
      'Duplicate @import rule b.css'
    ]);
    expect(duplicates[0]).toMatchObject({
      line: 2,
      column: 1
    });
    expect(duplicates[1]).toMatchObject({
      line: 5,
      column: 1
    });
  });

  it('keeps duplicate @import checks conservative for dialect options and dynamic imports', () => {
    const less = collectTolerantDiagnostics({
      source: '@import (less) "theme.less";\n@import (reference) "theme.less";',
      language: 'less'
    });
    const scss = collectTolerantDiagnostics({
      source: '@import "theme-#{$mode}.css";\n@import "theme-#{$mode}.css";',
      language: 'scss'
    });

    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.duplicateAtImportRules)).toBe(false);
    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.duplicateAtImportRules)).toBe(false);
  });

  it('normalizes protocol-relative @import urls without treating // as a comment', () => {
    const result = collectTolerantDiagnostics({
      source: '@import url("//cdn.example/theme.css");\n@import "//cdn.example/theme.css";',
      language: 'less'
    });

    expect(result.diagnostics.find(diagnostic => diagnostic.code === LINT_CODES.duplicateAtImportRules)).toMatchObject({
      message: 'Duplicate @import rule //cdn.example/theme.css'
    });
  });

  it('reports unknown units while accepting modern CSS units', () => {
    const result = collectTolerantDiagnostics({
      source: '.a { width: 1pixels; height: 1e3px; min-width: 1e3foo; gap: 1cqi; flex: 1fr; rotate: 1turn; transition-duration: 1ms; }',
      language: 'css'
    });
    const unknownUnits = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.unknownUnits);

    expect(unknownUnits.map(diagnostic => diagnostic.message)).toEqual([
      'Unknown unit "pixels"',
      'Unknown unit "foo"'
    ]);
    expect(unknownUnits.map(diagnostic => [diagnostic.start, diagnostic.end])).toEqual([
      ['.a { width: 1'.length, '.a { width: 1pixels'.length],
      ['.a { width: 1pixels; height: 1e3px; min-width: 1e3'.length, '.a { width: 1pixels; height: 1e3px; min-width: 1e3foo'.length]
    ]);
  });

  it('does not report unknown units in url values or valid resolution x contexts', () => {
    const result = collectTolerantDiagnostics({
      source: '.a { background: url(1quux); image: image-set(url(a.png) 1x, url(b.png) 2foo); image-resolution: 1x; width: 1x; }\n@media (min-resolution: 2x) and (min-width: 1x) { .a { color: red; } }',
      language: 'css'
    });
    const unknownUnits = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.unknownUnits);

    expect(unknownUnits.map(diagnostic => diagnostic.message)).toEqual([
      'Unknown unit "foo"',
      'Unknown unit "x"',
      'Unknown unit "x"'
    ]);
    expect(unknownUnits.map(diagnostic => diagnostic.start)).toEqual([
      '.a { background: url(1quux); image: image-set(url(a.png) 1x, url(b.png) 2'.length,
      '.a { background: url(1quux); image: image-set(url(a.png) 1x, url(b.png) 2foo); image-resolution: 1x; width: 1'.length,
      '.a { background: url(1quux); image: image-set(url(a.png) 1x, url(b.png) 2foo); image-resolution: 1x; width: 1x; }\n@media (min-resolution: 2x) and (min-width: 1'.length
    ]);
  });
});
