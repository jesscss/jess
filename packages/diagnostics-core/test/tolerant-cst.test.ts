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

  it('uses caller-provided CSS metadata for known selector pseudos', () => {
    const result = collectTolerantDiagnostics({
      source: '.a:project-state::project-part { color: red; }',
      language: 'css',
      metadata: {
        isKnownPseudoClass: name => name === ':project-state',
        isKnownPseudoElement: name => name === '::project-part'
      }
    });

    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownPseudoClasses)).toBe(false);
    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownPseudoElements)).toBe(false);
  });

  it('uses caller-provided CSS metadata for known functions', () => {
    const result = collectTolerantDiagnostics({
      source: '.a { width: project-size(1px); }',
      language: 'css',
      metadata: {
        isKnownFunction: name => name === 'project-size'
      }
    });

    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownFunctions)).toBe(false);
  });

  it('uses caller-provided CSS metadata for known media feature names', () => {
    const result = collectTolerantDiagnostics({
      source: '@media (project-feature: enabled) { .a { color: red; } }',
      language: 'css',
      metadata: {
        isKnownMediaFeatureName: name => name === 'project-feature'
      }
    });

    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownMediaFeatureNames)).toBe(false);
  });

  it('uses caller-provided CSS metadata for known type selectors', () => {
    const result = collectTolerantDiagnostics({
      source: 'projectpanel { color: red; }',
      language: 'css',
      metadata: {
        isKnownTypeSelector: name => name === 'projectpanel'
      }
    });

    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownTypeSelectors)).toBe(false);
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

  it('reports @import rules after style rules or blocking at-rules', () => {
    const source = '@charset "utf-8";\n@layer reset;\n@import "ok.css";\n@namespace svg url(http://www.w3.org/2000/svg);\n@import "late-at.css";\n@layer theme { .x { color: red; } }\n@import "late-layer.css";\n.a { color: red; }\n@import "late-rule.css";';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const invalidImports = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.invalidImportPosition);

    expect(invalidImports.map(diagnostic => [diagnostic.message, diagnostic.line, diagnostic.column])).toEqual([
      ['Invalid position for @import rule', 5, 1],
      ['Invalid position for @import rule', 7, 1],
      ['Invalid position for @import rule', 9, 1]
    ]);
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

  it('reports unknown selector pseudo-classes and pseudo-elements', () => {
    const result = collectTolerantDiagnostics({
      source: '.a:focus-visible::before { color: red; }\n.b:foo::bar { color: blue; }',
      language: 'css'
    });
    const pseudos = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.unknownPseudoClasses || diagnostic.code === LINT_CODES.unknownPseudoElements
    );

    expect(pseudos.map(diagnostic => [diagnostic.code, diagnostic.message, diagnostic.line, diagnostic.column])).toEqual([
      [LINT_CODES.unknownPseudoClasses, 'Unknown pseudo-class selector ":foo"', 2, 3],
      [LINT_CODES.unknownPseudoElements, 'Unknown pseudo-element selector "::bar"', 2, 7]
    ]);
  });

  it('suppresses legacy, custom, vendor, and dialect selector pseudos', () => {
    const css = collectTolerantDiagnostics({
      source: '.a:before:--project::-webkit-scrollbar { color: red; }',
      language: 'css'
    });
    const scss = collectTolerantDiagnostics({
      source: ':global(.x), :local(.y) { color: red; }',
      language: 'scss'
    });

    expect(css.diagnostics.some(
      diagnostic => diagnostic.code === LINT_CODES.unknownPseudoClasses || diagnostic.code === LINT_CODES.unknownPseudoElements
    )).toBe(false);
    expect(scss.diagnostics.some(
      diagnostic => diagnostic.code === LINT_CODES.unknownPseudoClasses || diagnostic.code === LINT_CODES.unknownPseudoElements
    )).toBe(false);
  });

  it('reports unknown CSS type selectors', () => {
    const source = 'main, foo, x-thing, svg|circle, *|unknown, :not(bar), ::highlight(baz), foreignObject { color: red; }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const unknownTypes = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.unknownTypeSelectors);

    expect(unknownTypes.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unknown type selector "foo"', source.indexOf('foo'), source.indexOf('foo') + 'foo'.length],
      ['Unknown type selector "unknown"', source.indexOf('unknown'), source.indexOf('unknown') + 'unknown'.length],
      ['Unknown type selector "bar"', source.indexOf('bar'), source.indexOf('bar') + 'bar'.length]
    ]);
  });

  it('reports duplicate CSS selectors with Stylelint default scoping', () => {
    const source = '.a, .b, .a { color: red; }\n'
      + '.a, .b { color: red; }\n'
      + '.b, .a { color: blue; }\n'
      + '.a { color: green; }\n'
      + '@media screen { .card { color: red; } .card { color: blue; } }\n'
      + '@keyframes spin { from { opacity: 0; } from { opacity: 1; } }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const duplicates = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.duplicateSelectors);

    expect(duplicates.map(diagnostic => [diagnostic.message, diagnostic.line, diagnostic.column])).toEqual([
      ['Duplicate selector ".a", first used at line 1', 1, 9],
      ['Duplicate selector ".b, .a", first used at line 2', 3, 1],
      ['Duplicate selector ".card", first used at line 5', 5, 39]
    ]);
  });

  it('does not report duplicate CSS selectors across different parent contexts', () => {
    const result = collectTolerantDiagnostics({
      source: '.a { color: red; }\n@media screen { .a { color: blue; } }\n@supports (display: grid) { .a { display: grid; } }',
      language: 'css'
    });

    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.duplicateSelectors)).toBe(false);
  });

  it('does not report unknown type selectors in dialect files before selector facts exist', () => {
    const scss = collectTolerantDiagnostics({
      source: '$root foo { color: red; }',
      language: 'scss'
    });
    const less = collectTolerantDiagnostics({
      source: '@root foo { color: red; }',
      language: 'less'
    });

    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownTypeSelectors)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownTypeSelectors)).toBe(false);
  });

  it('reports unknown CSS declaration functions', () => {
    const source = '.a { color: rgb(0 0 0); width: calc(1px + 1px); height: project-size(1px); background: url(asset.png); opacity: --fade(1); }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const unknownFunctions = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.unknownFunctions);
    const nameStart = source.indexOf('project-size');

    expect(unknownFunctions).toHaveLength(1);
    expect(unknownFunctions[0]).toMatchObject({
      message: 'Unknown function "project-size"',
      start: nameStart,
      end: nameStart + 'project-size('.length
    });
  });

  it('does not report unknown declaration functions in dialect files before callable facts exist', () => {
    const scss = collectTolerantDiagnostics({
      source: '.a { color: project-size($x); }',
      language: 'scss'
    });
    const less = collectTolerantDiagnostics({
      source: '.a { color: project-size(@x); }',
      language: 'less'
    });

    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownFunctions)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownFunctions)).toBe(false);
  });

  it('reports unknown CSS media feature names', () => {
    const source = '@media (min-width: 1px) and (future-feature: 3) and (600px < project-range < 900px) and (-webkit-device-pixel-ratio: 2) { .a { color: red; } }\n@container (future-feature: 3) { .a { color: red; } }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const unknownMediaFeatures = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.unknownMediaFeatureNames);
    const futureStart = source.indexOf('future-feature');
    const rangeStart = source.indexOf('project-range');

    expect(unknownMediaFeatures.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unknown media feature name "future-feature"', futureStart, futureStart + 'future-feature'.length],
      ['Unknown media feature name "project-range"', rangeStart, rangeStart + 'project-range'.length]
    ]);
  });

  it('does not report unknown media feature names in dialect files before media facts exist', () => {
    const scss = collectTolerantDiagnostics({
      source: '@media (project-feature: $value) { .a { color: red; } }',
      language: 'scss'
    });
    const less = collectTolerantDiagnostics({
      source: '@media (project-feature: @value) { .a { color: red; } }',
      language: 'less'
    });

    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownMediaFeatureNames)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownMediaFeatureNames)).toBe(false);
  });
});
