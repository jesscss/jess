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

  it('marks consecutive duplicate properties as a shared diagnostic qualifier', () => {
    const result = collectTolerantDiagnostics({
      source: '.a { color: red; color: blue; margin: 0; color: green; }',
      language: 'css'
    });
    const duplicates = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.duplicateProperties);

    expect(duplicates.map(diagnostic => [diagnostic.message, diagnostic.qualifiers ?? []])).toEqual([
      ['Duplicate property \'color\'', ['consecutive-duplicate']],
      ['Duplicate property \'color\'', []]
    ]);
  });

  it('marks empty mixin bodies as an opt-in empty block subfamily', () => {
    const cases = [
      collectTolerantDiagnostics({ source: '.mixin() { }\n.a { }', language: 'less' }),
      collectTolerantDiagnostics({ source: '@mixin box() { }\n.a { }', language: 'scss' }),
      collectTolerantDiagnostics({ source: 'box() { }\n.a { }', language: 'jess' })
    ];

    for (const result of cases) {
      expect(result.diagnostics
        .filter(diagnostic => diagnostic.code === LINT_CODES.emptyRules)
        .map(diagnostic => [diagnostic.message, diagnostic.qualifiers ?? []])).toEqual([
        ['Do not use empty mixin bodies', ['mixin-body']],
        ['Do not use empty rulesets', []]
      ]);
    }
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

  it('uses caller-provided CSS metadata for deprecated properties', () => {
    const result = collectTolerantDiagnostics({
      source: '.a { project-old: red; project-new: blue; }',
      language: 'css',
      metadata: {
        isKnownProperty: name => name === 'project-old' || name === 'project-new',
        cssPropertyStatus: name => name === 'project-old' ? 'deprecated' : undefined
      }
    });

    expect(result.diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.deprecatedProperties)
      .map(diagnostic => [diagnostic.code, diagnostic.message])).toEqual([
      [LINT_CODES.deprecatedProperties, 'Deprecated property: \'project-old\'']
    ]);
  });

  it('uses caller-provided CSS metadata for known property values', () => {
    const result = collectTolerantDiagnostics({
      source: '.a { display: project-layout; }',
      language: 'css',
      metadata: {
        isKnownPropertyValue: (name, value) => name === 'display' && value.normalized === 'project-layout'
      }
    });

    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownPropertyValues)).toBe(false);
  });

  it('uses caller-provided CSS metadata for known at-rule descriptors', () => {
    const result = collectTolerantDiagnostics({
      source: '@font-face { project-src: url(font.woff2); }',
      language: 'css',
      metadata: {
        isKnownAtRuleDescriptor: (atRuleName, descriptorName) => atRuleName === 'font-face' && descriptorName === 'project-src'
      }
    });

    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownAtRuleDescriptors)).toBe(false);
    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownProperties)).toBe(false);
  });

  it('uses caller-provided CSS metadata for known at-rule descriptor values', () => {
    const result = collectTolerantDiagnostics({
      source: '@font-face { font-family: Inter; src: url(font.woff2); font-style: project-style; }',
      language: 'css',
      metadata: {
        isKnownAtRuleDescriptorValue: (atRuleName, descriptorName, value) => atRuleName === 'font-face'
          && descriptorName === 'font-style'
          && value.normalized === 'project-style'
          ? true
          : undefined
      }
    });

    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownAtRuleDescriptorValues)).toBe(false);
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

  it('reports var() references to unknown same-file custom properties', () => {
    const source = [
      '.a { color: var(--brand); background: var(--missing, var(--fallback)); border-color: var(--registered); }',
      '@property --registered { syntax: "<color>"; inherits: false; initial-value: red; }',
      ':root { --brand: red; }'
    ].join('\n');
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const unknownCustomProperties = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.unknownCustomProperties
    );

    expect(unknownCustomProperties.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unknown custom property "--missing"', source.indexOf('--missing'), source.indexOf('--missing') + '--missing'.length],
      ['Unknown custom property "--fallback"', source.indexOf('--fallback'), source.indexOf('--fallback') + '--fallback'.length]
    ]);
  });

  it('reports opt-in custom property pattern facts for static definitions', () => {
    const source = [
      '@property --BadToken { syntax: "<color>"; inherits: false; initial-value: red; }',
      '.a { --BadLocal: blue; color: var(--BadLocal); }'
    ].join('\n');
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const customProperties = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.customPropertyPattern
    );

    expect(customProperties.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Custom property "--BadToken" does not match the configured pattern', source.indexOf('--BadToken'), source.indexOf('--BadToken') + '--BadToken'.length],
      ['Custom property "--BadLocal" does not match the configured pattern', source.indexOf('--BadLocal'), source.indexOf('--BadLocal') + '--BadLocal'.length]
    ]);
  });

  it('does not report unknown custom properties in dialect files before project facts exist', () => {
    const less = collectTolerantDiagnostics({
      source: '.a { color: var(--missing); }',
      language: 'less'
    });

    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownCustomProperties)).toBe(false);
  });

  it('reports definite unknown CSS property values from metadata', () => {
    const source = '.a { display: flxe; position: abolute; visibility: collapse; color: grue; display: var(--kind); }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const unknownPropertyValues = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.unknownPropertyValues
    );

    expect(unknownPropertyValues.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unknown value "flxe" for property "display"', source.indexOf('flxe'), source.indexOf('flxe') + 'flxe'.length],
      ['Unknown value "abolute" for property "position"', source.indexOf('abolute'), source.indexOf('abolute') + 'abolute'.length],
      ['Unknown value "grue" for property "color"', source.indexOf('grue'), source.indexOf('grue') + 'grue'.length]
    ]);
  });

  it('checks simple property value restrictions while leaving compound values unknown', () => {
    const source = [
      '.a {',
      '  width: wide;',
      '  width: 12px;',
      '  width: 50%;',
      '  width: 0;',
      '  width: calc(100% - 1rem);',
      '  opacity: 2;',
      '  opacity: 0.5;',
      '  opacity: var(--alpha);',
      '  animation-duration: 1px;',
      '  animation-duration: 200ms;',
      '  background-color: #fff;',
      '  background-color: rgb(1 2 3);',
      '  background-color: linear-gradient(red, blue);',
      '  background: -webkit-linear-gradient(red, blue);',
      '  display: -webkit-flex;',
      '  font-family: system-ui, sans-serif;',
      '}'
    ].join('\n');
    const result = collectTolerantDiagnostics({ source, language: 'css' });
    const unknownPropertyValues = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.unknownPropertyValues
    );

    expect(unknownPropertyValues.map(diagnostic => diagnostic.message)).toEqual([
      'Unknown value "wide" for property "width"',
      'Unknown value "2" for property "opacity"',
      'Unknown value "1px" for property "animation-duration"',
      'Unknown value "linear-gradient(red, blue)" for property "background-color"'
    ]);
  });

  it('reports deprecated CSS properties from web custom data', () => {
    const source = '.a { clip: auto; color: red; -ms-filter: none; }';
    const result = collectTolerantDiagnostics({ source, language: 'css' });
    const deprecatedProperties = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.deprecatedProperties
    );

    expect(deprecatedProperties.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Deprecated property: \'clip\'', source.indexOf('clip'), source.indexOf('clip') + 'clip'.length]
    ]);
  });

  it('does not report deprecated properties in dialect files before CSS property facts exist', () => {
    const result = collectTolerantDiagnostics({
      source: '.a { clip: auto; }',
      language: 'less'
    });

    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.deprecatedProperties)).toBe(false);
  });

  it('does not report unknown property values in dialect files before value facts exist', () => {
    const less = collectTolerantDiagnostics({
      source: '.a { display: flxe; }',
      language: 'less'
    });
    const scss = collectTolerantDiagnostics({
      source: '.a { display: flxe; }',
      language: 'scss'
    });

    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownPropertyValues)).toBe(false);
    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownPropertyValues)).toBe(false);
  });

  it('reports unsupported SCSS @forward modifier forms from the diagnostic CST', () => {
    const source = [
      '@forward "tokens" as token-*;',
      '@forward "visibility" show $a, b;',
      '@forward "hidden" hide $a;',
      '@forward "plain";',
      '@forward "configured" with ($a: 1);'
    ].join('\n');
    const result = collectTolerantDiagnostics({
      source,
      language: 'scss'
    });
    const unsupported = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.unsupportedSassForm);
    const asStart = source.indexOf('@forward "tokens"');
    const showStart = source.indexOf('@forward "visibility"');
    const hideStart = source.indexOf('@forward "hidden"');

    expect(unsupported.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      [
        '@forward with "as <prefix>-*" prefixing is not supported in Jess and will never be. Use explicit namespacing instead.',
        asStart,
        source.indexOf(';', asStart) + 1
      ],
      [
        '@forward with "show"/"hide" lists is not supported in Jess and will never be. Visibility control belongs to the module itself.',
        showStart,
        source.indexOf(';', showStart) + 1
      ],
      [
        '@forward with "show"/"hide" lists is not supported in Jess and will never be. Visibility control belongs to the module itself.',
        hideStart,
        source.indexOf(';', hideStart) + 1
      ]
    ]);
  });

  it('reports duplicate custom properties in one declaration block', () => {
    const source = '.a { --brand: red; --Brand: blue; --brand: green; color: red; color: blue; }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const duplicateCustomProperties = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.duplicateCustomProperties
    );

    expect(duplicateCustomProperties.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Duplicate custom property "--brand"', source.lastIndexOf('--brand'), source.indexOf('; color')]
    ]);
  });

  it('reports shorthand properties that override earlier longhands', () => {
    const source = '.a { margin-left: 1px; margin: 0; background-image: url(a.png); background-color: red; background: blue; }\n'
      + '.b { margin: 0; margin-left: 1px; -webkit-transition-property: opacity; -webkit-transition: opacity 1s; }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const shorthandOverrides = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.shorthandPropertyOverrides
    );
    const marginStart = source.indexOf('margin: 0');
    const backgroundStart = source.indexOf('background: blue');
    const transitionStart = source.indexOf('-webkit-transition: opacity');

    expect(shorthandOverrides.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Overridden property "margin-left" by shorthand "margin"', marginStart, marginStart + 'margin'.length],
      ['Overridden property "background-color" by shorthand "background"', backgroundStart, backgroundStart + 'background'.length],
      ['Overridden property "background-image" by shorthand "background"', backgroundStart, backgroundStart + 'background'.length],
      ['Overridden property "-webkit-transition-property" by shorthand "-webkit-transition"', transitionStart, transitionStart + '-webkit-transition'.length]
    ]);
  });

  it('reports modern shorthand override families from the CSS property table', () => {
    const source = '.a { row-gap: 1rem; gap: 0; overflow-x: hidden; overflow: clip; text-decoration-color: red; text-decoration: underline; }\n'
      + '.b { margin-inline-start: 1rem; margin-inline: 0; padding-block-end: 1rem; padding-block: 0; }\n'
      + '.c { border-inline-start-color: red; border-inline-start: 1px solid; border-block-width: 1px; border-block: 0; }\n'
      + '.d { scroll-padding-inline-end: 2rem; scroll-padding-inline: 0; text-emphasis-color: red; text-emphasis: filled; }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const shorthandOverrides = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.shorthandPropertyOverrides
    );
    const gapStart = source.indexOf('gap: 0');
    const overflowStart = source.indexOf('overflow: clip');
    const textDecorationStart = source.indexOf('text-decoration: underline');
    const marginInlineStart = source.indexOf('margin-inline: 0');
    const paddingBlockStart = source.indexOf('padding-block: 0');
    const borderInlineStart = source.indexOf('border-inline-start: 1px');
    const borderBlockStart = source.indexOf('border-block: 0');
    const scrollPaddingInlineStart = source.indexOf('scroll-padding-inline: 0');
    const textEmphasisStart = source.indexOf('text-emphasis: filled');

    expect(shorthandOverrides.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Overridden property "row-gap" by shorthand "gap"', gapStart, gapStart + 'gap'.length],
      ['Overridden property "overflow-x" by shorthand "overflow"', overflowStart, overflowStart + 'overflow'.length],
      ['Overridden property "text-decoration-color" by shorthand "text-decoration"', textDecorationStart, textDecorationStart + 'text-decoration'.length],
      ['Overridden property "margin-inline-start" by shorthand "margin-inline"', marginInlineStart, marginInlineStart + 'margin-inline'.length],
      ['Overridden property "padding-block-end" by shorthand "padding-block"', paddingBlockStart, paddingBlockStart + 'padding-block'.length],
      ['Overridden property "border-inline-start-color" by shorthand "border-inline-start"', borderInlineStart, borderInlineStart + 'border-inline-start'.length],
      ['Overridden property "border-block-width" by shorthand "border-block"', borderBlockStart, borderBlockStart + 'border-block'.length],
      ['Overridden property "scroll-padding-inline-end" by shorthand "scroll-padding-inline"', scrollPaddingInlineStart, scrollPaddingInlineStart + 'scroll-padding-inline'.length],
      ['Overridden property "text-emphasis-color" by shorthand "text-emphasis"', textEmphasisStart, textEmphasisStart + 'text-emphasis'.length]
    ]);
  });

  it('reports same-file unused variables in dialect stylesheets', () => {
    const less = '@used: red; @unused: blue; .a { color: @used; }';
    const scss = '$used_name: red; $used-name: green; $unused: blue; .a { color: $used-name; }';
    const jess = '$used: red; $unused: blue; $tokens: { tone: blue; }; .a { color: $used; }';

    const lessResult = collectTolerantDiagnostics({ source: less, language: 'less' });
    const scssResult = collectTolerantDiagnostics({ source: scss, language: 'scss' });
    const jessResult = collectTolerantDiagnostics({ source: jess, language: 'jess' });

    expect(lessResult.diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.unusedVariables)
      .map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unused variable "@unused"', less.indexOf('@unused'), less.indexOf('@unused') + '@unused'.length]
    ]);
    expect(scssResult.diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.unusedVariables)
      .map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unused variable "$unused"', scss.indexOf('$unused'), scss.indexOf('$unused') + '$unused'.length]
    ]);
    expect(jessResult.diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.unusedVariables)
      .map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unused variable "$unused"', jess.indexOf('$unused'), jess.indexOf('$unused') + '$unused'.length],
      ['Unused variable "$tokens"', jess.indexOf('$tokens'), jess.indexOf('$tokens') + '$tokens'.length]
    ]);
  });

  it('reports same-file shadowed variables in nested dialect scopes', () => {
    const less = '@tone: red; .theme { @tone: blue; color: @tone; } .root { color: @tone; }';
    const scss = '$tone: red; .theme { $tone: blue; color: $tone; } .root { color: $tone; }';
    const jess = '$tone: red; .theme { $tone: blue; color: $tone; } .root { color: $tone; }';

    const lessResult = collectTolerantDiagnostics({ source: less, language: 'less' });
    const scssResult = collectTolerantDiagnostics({ source: scss, language: 'scss' });
    const jessResult = collectTolerantDiagnostics({ source: jess, language: 'jess' });

    expect(lessResult.diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.shadowedTokens)
      .map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Variable "@tone" shadows "@tone" from an outer scope', less.indexOf('@tone: blue'), less.indexOf('@tone: blue') + '@tone'.length]
    ]);
    expect(scssResult.diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.shadowedTokens)
      .map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Variable "$tone" shadows "$tone" from an outer scope', scss.indexOf('$tone: blue'), scss.indexOf('$tone: blue') + '$tone'.length]
    ]);
    expect(jessResult.diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.shadowedTokens)
      .map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Variable "$tone" shadows "$tone" from an outer scope', jess.indexOf('$tone: blue'), jess.indexOf('$tone: blue') + '$tone'.length]
    ]);
  });

  it('reports same-file unused mixins in dialect stylesheets without external module sources', () => {
    const less = '.used() { color: red; }\n.unused() { color: blue; }\n.a { .used; }';
    const lessNamespaced = '#ns() { .inner() { c: red; } }\n.a { #ns > .inner(); }';
    const scss = '@mixin used() { color: red; }\n@mixin unused() { color: blue; }\n.a { @include used(); }';
    const jess = 'used() { color: red; }\nunused() { color: blue; }\n.a { $ > used(); }';

    expect(collectTolerantDiagnostics({ source: less, language: 'less' }).diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.unusedMixins)
      .map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unused mixin ".unused"', less.indexOf('.unused'), less.indexOf('.unused') + '.unused'.length]
    ]);
    expect(collectTolerantDiagnostics({ source: lessNamespaced, language: 'less' }).diagnostics
      .some(diagnostic => diagnostic.code === LINT_CODES.unusedMixins)).toBe(false);
    expect(collectTolerantDiagnostics({ source: scss, language: 'scss' }).diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.unusedMixins)
      .map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unused mixin "unused"', scss.indexOf('unused'), scss.indexOf('unused') + 'unused'.length]
    ]);
    expect(collectTolerantDiagnostics({ source: jess, language: 'jess' }).diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.unusedMixins)
      .map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unused mixin "unused"', jess.indexOf('unused'), jess.indexOf('unused') + 'unused'.length]
    ]);
  });

  it('does not report same-file unused mixins when imports or modules can export them', () => {
    const less = '@import "lib.less";\n.unused() { color: red; }';
    const scss = '@use "lib";\n@mixin unused() { color: red; }';
    const jess = '@-compose "lib";\nunused() { color: red; }';

    expect(collectTolerantDiagnostics({ source: less, language: 'less' }).diagnostics
      .some(diagnostic => diagnostic.code === LINT_CODES.unusedMixins)).toBe(false);
    expect(collectTolerantDiagnostics({ source: scss, language: 'scss' }).diagnostics
      .some(diagnostic => diagnostic.code === LINT_CODES.unusedMixins)).toBe(false);
    expect(collectTolerantDiagnostics({ source: jess, language: 'jess' }).diagnostics
      .some(diagnostic => diagnostic.code === LINT_CODES.unusedMixins)).toBe(false);
  });

  it('reports same-file unused functions in dialect stylesheets without external module sources', () => {
    const scss = '@function used() { @return 1; }\n@function unused() { @return 2; }\n.a { w: used(); }';
    const scssHyphen = '@function used_name() { @return 1; }\n.a { w: used-name(); }';
    const jess = '$used: @() > { result: 1; }\n$unused: @() > { result: 2; }\n.a { w: $used(); }';
    const jessExpression = '$used: @() > $(1 + 2);\n$unused: @() > $(3 + 4);\n.a { w: $used(); }';
    const jessPlainMixinValue = '$fn: @($x) { color: $x; };\n.a { color: red; }';

    expect(collectTolerantDiagnostics({ source: scss, language: 'scss' }).diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.unusedFunctions)
      .map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unused function "unused"', scss.indexOf('unused'), scss.indexOf('unused') + 'unused'.length]
    ]);
    expect(collectTolerantDiagnostics({ source: scssHyphen, language: 'scss' }).diagnostics
      .some(diagnostic => diagnostic.code === LINT_CODES.unusedFunctions)).toBe(false);
    expect(collectTolerantDiagnostics({ source: jess, language: 'jess' }).diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.unusedFunctions)
      .map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unused function "$unused"', jess.indexOf('$unused'), jess.indexOf('$unused') + '$unused'.length]
    ]);
    expect(collectTolerantDiagnostics({ source: jessExpression, language: 'jess' }).diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.unusedFunctions)
      .map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unused function "$unused"', jessExpression.indexOf('$unused'), jessExpression.indexOf('$unused') + '$unused'.length]
    ]);
    expect(collectTolerantDiagnostics({ source: jessPlainMixinValue, language: 'jess' }).diagnostics
      .some(diagnostic => diagnostic.code === LINT_CODES.unusedFunctions)).toBe(false);
  });

  it('does not report same-file unused functions when imports or modules can export them', () => {
    const scss = '@use "lib";\n@function unused() { @return 1; }';
    const jess = '@-compose "lib";\n$unused: @() > { result: 1; }';

    expect(collectTolerantDiagnostics({ source: scss, language: 'scss' }).diagnostics
      .some(diagnostic => diagnostic.code === LINT_CODES.unusedFunctions)).toBe(false);
    expect(collectTolerantDiagnostics({ source: jess, language: 'jess' }).diagnostics
      .some(diagnostic => diagnostic.code === LINT_CODES.unusedFunctions)).toBe(false);
  });

  it('reports definitely impossible dialect guards without flagging dynamic guards', () => {
    const less = '.a when (false) { color: red; }\n.m() when (1 > 2) { color: blue; }\n.ok() when (not(false)) { color: green; }\n.dyn(@value) when (@value = false) { color: yellow; }';
    const scss = '@if false { .a { color: red; } } @else if 1px > 2px { .b { color: blue; } } @if not(false) { .c { color: green; } } @if $value { .d { color: yellow; } }';
    const jess = '$if (null) { color: red; } $if (1 = 2) { color: blue; } $if (not(false)) { color: green; } m($value) when ($value = false) { color: yellow; }';

    expect(collectTolerantDiagnostics({ source: less, language: 'less' }).diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.impossibleGuards)
      .map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Guard is statically false; this branch can never run', less.indexOf('when (false)'), less.indexOf('when (false)') + 'when (false)'.length],
      ['Guard is statically false; this branch can never run', less.indexOf('when (1 > 2)'), less.indexOf('when (1 > 2)') + 'when (1 > 2)'.length]
    ]);
    expect(collectTolerantDiagnostics({ source: scss, language: 'scss' }).diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.impossibleGuards)
      .map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Guard is statically false; this branch can never run', scss.indexOf('false'), scss.indexOf('false') + 'false'.length],
      ['Guard is statically false; this branch can never run', scss.indexOf('1px > 2px'), scss.indexOf('1px > 2px') + '1px > 2px'.length]
    ]);
    expect(collectTolerantDiagnostics({ source: jess, language: 'jess' }).diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.impossibleGuards)
      .map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Guard is statically false; this branch can never run', jess.indexOf('(null)'), jess.indexOf('(null)') + '(null)'.length],
      ['Guard is statically false; this branch can never run', jess.indexOf('(1 = 2)'), jess.indexOf('(1 = 2)') + '(1 = 2)'.length]
    ]);
  });

  it('reports numeric key access against same-file map-like variables', () => {
    const less = '@tokens: { tone: blue; gap: 1px; };\n.a { color: @tokens[0]; bg: @tokens[tone]; }';
    const scss = '$tokens: (tone: blue, gap: 1px);\n.a { color: map-get($tokens, 0); bg: map-get($tokens, tone); }';
    const jess = '$tokens: { tone: blue; gap: 1px; };\n.a { color: $tokens[0]; bg: $tokens[tone]; dyn: $tokens[$key]; }\n$tokens: red;\n.b { color: $tokens[0]; }';

    const lessResult = collectTolerantDiagnostics({ source: less, language: 'less' });
    const scssResult = collectTolerantDiagnostics({ source: scss, language: 'scss' });
    const jessResult = collectTolerantDiagnostics({ source: jess, language: 'jess' });

    expect(lessResult.diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.suspiciousMapKeyAccess)
      .map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Numeric key access on map-like variable "@tokens" is probably an accidental positional lookup', less.indexOf('[0]'), less.indexOf('[0]') + '[0]'.length]
    ]);
    expect(scssResult.diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.suspiciousMapKeyAccess)
      .map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Numeric key access on map-like variable "$tokens" is probably an accidental positional lookup', scss.indexOf('0);'), scss.indexOf('0);') + '0'.length]
    ]);
    expect(jessResult.diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.suspiciousMapKeyAccess)
      .map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Numeric key access on map-like variable "$tokens" is probably an accidental positional lookup', jess.indexOf('[0]'), jess.indexOf('[0]') + '[0]'.length]
    ]);
  });

  it('reports unknown at-rule descriptors without also reporting unknown properties', () => {
    const source = '@font-face { font-family: Inter; src: url(inter.woff2); made-up: nope; }\n'
      + '@property --x { syntax: "<length>"; inherits: false; initial-value: 0px; unknown: yes; }\n'
      + '@counter-style thumbs { system: cyclic; symbols: "x"; frob: nope; }\n'
      + '@page :first { size: A4; margin: 1cm; content: "bad"; @top-left { content: "ok"; unicode-bidi: normal; bad-margin: x; } }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const unknownDescriptors = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.unknownAtRuleDescriptors);

    expect(unknownDescriptors.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unknown descriptor "made-up" for at-rule "@font-face"', source.indexOf('made-up'), source.indexOf('made-up') + 'made-up'.length],
      ['Unknown descriptor "unknown" for at-rule "@property"', source.indexOf('unknown'), source.indexOf('unknown') + 'unknown'.length],
      ['Unknown descriptor "frob" for at-rule "@counter-style"', source.indexOf('frob'), source.indexOf('frob') + 'frob'.length],
      ['Unknown descriptor "content" for at-rule "@page"', source.indexOf('content: "bad"'), source.indexOf('content: "bad"') + 'content'.length],
      ['Unknown descriptor "bad-margin" for at-rule "@page"', source.indexOf('bad-margin'), source.indexOf('bad-margin') + 'bad-margin'.length]
    ]);
    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownProperties)).toBe(false);
  });

  it('reports definite unknown at-rule descriptor values', () => {
    const source = [
      '@property --bad-inherits { syntax: "<length>"; inherits: yes; initial-value: 0px; }',
      '@property --bad-syntax-token { syntax: <length>; inherits: false; initial-value: 0px; }',
      '@property --bad-syntax-type { syntax: "<lenght>"; inherits: false; initial-value: 0px; }',
      '@property --ok-syntax { syntax: "<length> | auto"; inherits: false; initial-value: 0px; }',
      '@font-face { font-family: Inter; src: url(inter.woff2); font-display: sometimes; }',
      '@font-face { font-family: Inter; src: url(inter.woff2); font-style: sideways; }',
      '@font-face { font-family: Inter; src: url(inter.woff2); font-display: swap; font-style: italic; }',
      '@counter-style chapter { system: sideways; }',
      '@counter-style section { system: numeric; }'
    ].join('\n');
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const descriptorValues = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.unknownAtRuleDescriptorValues);

    expect(descriptorValues.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unknown value "yes" for descriptor "inherits" in @property', source.indexOf('yes'), source.indexOf('yes') + 'yes'.length],
      ['Unknown value "<length>" for descriptor "syntax" in @property', source.indexOf('<length>;'), source.indexOf('<length>;') + '<length>'.length],
      ['Unknown value "<lenght>" for descriptor "syntax" in @property', source.indexOf('"<lenght>"'), source.indexOf('"<lenght>"') + '"<lenght>"'.length],
      ['Unknown value "sometimes" for descriptor "font-display" in @font-face', source.indexOf('sometimes'), source.indexOf('sometimes') + 'sometimes'.length],
      ['Unknown value "sideways" for descriptor "font-style" in @font-face', source.indexOf('sideways; }'), source.indexOf('sideways; }') + 'sideways'.length],
      ['Unknown value "sideways" for descriptor "system" in @counter-style', source.indexOf('sideways; }', source.indexOf('@counter-style chapter')), source.indexOf('sideways; }', source.indexOf('@counter-style chapter')) + 'sideways'.length]
    ]);
  });

  it('does not report unknown at-rule descriptor values in dialect files before value facts exist', () => {
    const scss = collectTolerantDiagnostics({
      source: '@property --gap { syntax: <length>; inherits: yes; initial-value: red; }',
      language: 'scss'
    });
    const less = collectTolerantDiagnostics({
      source: '@font-face { font-family: Inter; src: url(inter.woff2); font-display: sometimes; }',
      language: 'less'
    });

    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownAtRuleDescriptorValues)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownAtRuleDescriptorValues)).toBe(false);
  });

  it('reports @font-face rules missing required CSS descriptors', () => {
    const source = [
      '@font-face { }',
      '@font-face { font-family: Inter; }',
      '@font-face { src: url(inter.woff2); }',
      '@font-face { font-family: Inter; src: url(inter.woff2); }'
    ].join('\n');
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const missing = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.fontFaceMissingRequiredProperties);
    const first = source.indexOf('@font-face');
    const second = source.indexOf('@font-face', first + 1);
    const third = source.indexOf('@font-face', second + 1);

    expect(missing.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['@font-face rule must define "font-family" and "src"', first, first + '@font-face'.length],
      ['@font-face rule must define "src"', second, second + '@font-face'.length],
      ['@font-face rule must define "font-family"', third, third + '@font-face'.length]
    ]);
  });

  it('does not report missing @font-face descriptors in dialect files before semantic facts exist', () => {
    const scss = collectTolerantDiagnostics({
      source: '@font-face { font-family: Inter; }',
      language: 'scss'
    });
    const less = collectTolerantDiagnostics({
      source: '@font-face { src: url(inter.woff2); }',
      language: 'less'
    });

    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.fontFaceMissingRequiredProperties)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.fontFaceMissingRequiredProperties)).toBe(false);
  });

  it('reports CSS properties ignored by display mode', () => {
    const source = [
      '.inline { display: inline-block; float: left; }',
      '.none { display: inline-block; float: none; }',
      '.block { display: block; vertical-align: middle; }',
      '.ok { display: inline; vertical-align: middle; float: right; }',
      '.dynamic { display: var(--display); float: left; }'
    ].join('\n');
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const ignored = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.propertyIgnoredDueToDisplay);
    const floatStart = source.indexOf('float: left');
    const verticalAlignStart = source.indexOf('vertical-align');

    expect(ignored.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      [
        'With display: inline-block, float changes display to block',
        floatStart,
        source.indexOf('; }')
      ],
      [
        'With display: block, vertical-align has no effect',
        verticalAlignStart,
        source.indexOf('; }', verticalAlignStart)
      ]
    ]);
  });

  it('does not report properties ignored by display in dialect files before value facts exist', () => {
    const source = '.a { display: block; vertical-align: middle; }\n.b { display: inline-block; float: left; }';
    const scss = collectTolerantDiagnostics({
      source,
      language: 'scss'
    });
    const less = collectTolerantDiagnostics({
      source,
      language: 'less'
    });

    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.propertyIgnoredDueToDisplay)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.propertyIgnoredDueToDisplay)).toBe(false);
  });

  it('reports definite CSS float layout declarations as an opt-in diagnostic source', () => {
    const source = [
      '.left { float: left; }',
      '.none { float: none; }',
      '.dynamic { float: var(--side); }',
      '.right { float: inline-end; }'
    ].join('\n');
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const floats = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.float);
    const leftStart = source.indexOf('float: left');
    const rightStart = source.indexOf('float: inline-end');

    expect(floats.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      [
        'Avoid using float for layout',
        leftStart,
        source.indexOf(';', leftStart)
      ],
      [
        'Avoid using float for layout',
        rightStart,
        source.indexOf(';', rightStart)
      ]
    ]);
  });

  it('does not report float layout diagnostics in dialect files before value facts exist', () => {
    const source = '.a { float: left; }';
    const scss = collectTolerantDiagnostics({
      source,
      language: 'scss'
    });
    const less = collectTolerantDiagnostics({
      source,
      language: 'less'
    });

    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.float)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.float)).toBe(false);
  });

  it('reports vendor-prefixed CSS declarations missing their standard property', () => {
    const source = [
      '.prefixed { -webkit-transform: rotate(0); -moz-user-select: none; user-select: none; }',
      '.standard { -webkit-transform: rotate(0); transform: rotate(0); }',
      '.unknown { -webkit-made-up: x; }'
    ].join('\n');
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const vendorPrefix = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.vendorPrefix);
    const transformStart = source.indexOf('-webkit-transform');

    expect(vendorPrefix.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      [
        'Also define the standard property "transform" for compatibility',
        transformStart,
        transformStart + '-webkit-transform'.length
      ]
    ]);
  });

  it('reports vendor-prefixed CSS keyframes missing standard and compatible siblings', () => {
    const source = [
      '@-webkit-keyframes spin { from { opacity: 0; } }',
      '@keyframes pulse { from { opacity: 0; } }',
      '@-webkit-keyframes pulse { from { opacity: 0; } }',
      '@keyframes slide { from { opacity: 0; } }',
      '@-webkit-keyframes slide { from { opacity: 0; } }',
      '@-moz-keyframes slide { from { opacity: 0; } }',
      '@-o-keyframes slide { from { opacity: 0; } }'
    ].join('\n');
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const vendorPrefix = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.vendorPrefix);
    const compatibleVendorPrefixes = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.compatibleVendorPrefixes
    );
    const spinStart = source.indexOf('@-webkit-keyframes spin');
    const pulseStart = source.indexOf('@-webkit-keyframes pulse');

    expect(vendorPrefix.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      [
        'Always define standard rule "@keyframes" when defining keyframes',
        spinStart,
        spinStart + '@-webkit-keyframes'.length
      ]
    ]);
    expect(compatibleVendorPrefixes.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      [
        'Always include all vendor-specific rules: Missing: @-moz-keyframes, @-o-keyframes',
        spinStart,
        spinStart + '@-webkit-keyframes'.length
      ],
      [
        'Always include all vendor-specific rules: Missing: @-moz-keyframes, @-o-keyframes',
        pulseStart,
        pulseStart + '@-webkit-keyframes'.length
      ]
    ]);
  });

  it('reports opt-in vendor-prefix policy facts for authored CSS prefixes', () => {
    const source = [
      '.a { -webkit-transform: rotate(0); transform: rotate(0); display: -webkit-flex; background: -webkit-linear-gradient(red, blue); }',
      '@keyframes spin { from { opacity: 0; } }',
      '@-webkit-keyframes spin { from { opacity: 0; } }'
    ].join('\n');
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const propertyNoVendorPrefix = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.propertyNoVendorPrefix
    );
    const atRuleNoVendorPrefix = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.atRuleNoVendorPrefix
    );
    const valueNoVendorPrefix = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.valueNoVendorPrefix
    );
    const propertyStart = source.indexOf('-webkit-transform');
    const atRuleStart = source.indexOf('@-webkit-keyframes');
    const valueStart = source.indexOf('-webkit-flex');
    const functionStart = source.indexOf('-webkit-linear-gradient');

    expect(propertyNoVendorPrefix.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      [
        'Unexpected vendor-prefixed property "-webkit-transform"',
        propertyStart,
        propertyStart + '-webkit-transform'.length
      ]
    ]);
    expect(atRuleNoVendorPrefix.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      [
        'Unexpected vendor-prefixed at-rule "@-webkit-keyframes"',
        atRuleStart,
        atRuleStart + '@-webkit-keyframes'.length
      ]
    ]);
    expect(valueNoVendorPrefix.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      [
        'Unexpected vendor-prefixed value "-webkit-flex"',
        valueStart,
        valueStart + '-webkit-flex'.length
      ],
      [
        'Unexpected vendor-prefixed value "-webkit-linear-gradient"',
        functionStart,
        functionStart + '-webkit-linear-gradient'.length
      ]
    ]);
  });

  it('reports unknown CSS vendor-specific properties', () => {
    const source = [
      '.unknown { -webkit-made-up: x; -foo-thing: y; -webkit-transform: rotate(0); }',
      '.custom { --x: 1; }'
    ].join('\n');
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const unknownVendorSpecific = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.unknownVendorSpecificProperties
    );
    const webkitStart = source.indexOf('-webkit-made-up');
    const fooStart = source.indexOf('-foo-thing');

    expect(unknownVendorSpecific.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      [
        'Unknown vendor-specific property: \'-webkit-made-up\'',
        webkitStart,
        webkitStart + '-webkit-made-up'.length
      ],
      [
        'Unknown vendor-specific property: \'-foo-thing\'',
        fooStart,
        fooStart + '-foo-thing'.length
      ]
    ]);
  });

  it('reports missing compatible vendor-prefixed CSS declarations', () => {
    const source = [
      '.partial { -webkit-user-select: none; user-select: none; }',
      '.complete { -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; user-select: none; }',
      '.single { -webkit-mask-image: url(mask.svg); mask-image: url(mask.svg); }'
    ].join('\n');
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const compatibleVendorPrefixes = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.compatibleVendorPrefixes
    );
    const webkitStart = source.indexOf('-webkit-user-select');

    expect(compatibleVendorPrefixes.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      [
        'Always include all vendor-specific properties: Missing: -moz-user-select, -ms-user-select',
        webkitStart,
        webkitStart + '-webkit-user-select'.length
      ]
    ]);
  });

  it('does not report vendor-prefix diagnostics in dialect files before property facts exist', () => {
    const source = [
      '.a { -webkit-transform: rotate(0); display: -webkit-flex; }',
      '@-webkit-keyframes spin { from { opacity: 0; } }'
    ].join('\n');
    const scss = collectTolerantDiagnostics({
      source,
      language: 'scss'
    });
    const less = collectTolerantDiagnostics({
      source,
      language: 'less'
    });

    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.vendorPrefix)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.vendorPrefix)).toBe(false);
    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.propertyNoVendorPrefix)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.propertyNoVendorPrefix)).toBe(false);
    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.atRuleNoVendorPrefix)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.atRuleNoVendorPrefix)).toBe(false);
    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.valueNoVendorPrefix)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.valueNoVendorPrefix)).toBe(false);
  });

  it('does not report unknown vendor-specific properties in dialect files before property facts exist', () => {
    const source = '.a { -webkit-made-up: x; }';
    const scss = collectTolerantDiagnostics({
      source,
      language: 'scss'
    });
    const less = collectTolerantDiagnostics({
      source,
      language: 'less'
    });

    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownVendorSpecificProperties)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownVendorSpecificProperties)).toBe(false);
  });

  it('does not report compatible vendor-prefix diagnostics in dialect files before property facts exist', () => {
    const source = [
      '.a { -webkit-user-select: none; user-select: none; }',
      '@keyframes spin { from { opacity: 0; } }',
      '@-webkit-keyframes spin { from { opacity: 0; } }'
    ].join('\n');
    const scss = collectTolerantDiagnostics({
      source,
      language: 'scss'
    });
    const less = collectTolerantDiagnostics({
      source,
      language: 'less'
    });

    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.compatibleVendorPrefixes)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.compatibleVendorPrefixes)).toBe(false);
  });

  it('reports definite CSS box-model size risks', () => {
    const source = [
      '.wide { width: 100px; padding-left: 1px; padding-right: 0; }',
      '.tall { height: 10rem; border-top: solid; border-bottom-width: 0; }',
      '.sized { box-sizing: border-box; width: 100px; padding: 1px; }',
      '.zero { width: 100px; padding: 0; border-left: none; }',
      '.dynamic { width: 100px; padding: calc(1px); }'
    ].join('\n');
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const boxModel = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.boxModel);
    const widthStart = source.indexOf('width: 100px');
    const paddingStart = source.indexOf('padding-left');
    const heightStart = source.indexOf('height');
    const borderStart = source.indexOf('border-top');

    expect(boxModel.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      [
        'Width with horizontal padding or border can make the box wider than expected',
        widthStart,
        source.indexOf(';', widthStart)
      ],
      [
        'Width with horizontal padding or border can make the box wider than expected',
        paddingStart,
        source.indexOf(';', paddingStart)
      ],
      [
        'Height with vertical padding or border can make the box taller than expected',
        heightStart,
        source.indexOf(';', heightStart)
      ],
      [
        'Height with vertical padding or border can make the box taller than expected',
        borderStart,
        source.indexOf(';', borderStart)
      ]
    ]);
  });

  it('does not report box-model risks in dialect files before value facts exist', () => {
    const source = '.a { width: 100px; padding-left: 1px; }';
    const scss = collectTolerantDiagnostics({
      source,
      language: 'scss'
    });
    const less = collectTolerantDiagnostics({
      source,
      language: 'less'
    });

    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.boxModel)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.boxModel)).toBe(false);
  });

  it('reports duplicate keyframe selectors and important keyframe declarations', () => {
    const result = collectTolerantDiagnostics({
      source: '@keyframes spin { from { opacity: 1 !important; } 0% { opacity: .5; } 50% { color: red; } 50% { color: blue; } }',
      language: 'css'
    });

    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain(LINT_CODES.keyframeDeclarationNoImportant);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain(LINT_CODES.keyframeDuplicateSelectors);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).not.toContain(LINT_CODES.declarationNoImportant);
    expect(result.diagnostics.find(diagnostic => diagnostic.code === LINT_CODES.keyframeDuplicateSelectors)).toMatchObject({
      message: 'Duplicate keyframe selector \'0%\''
    });
  });

  it('reports opt-in keyframes name pattern facts for static keyframes', () => {
    const source = '@keyframes BadSpin { from { opacity: 0; } }\n@keyframes good-spin { to { opacity: 1; } }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const keyframesNames = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.keyframesNamePattern
    );

    expect(keyframesNames.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Keyframes name "BadSpin" does not match the configured pattern', source.indexOf('BadSpin'), source.indexOf('BadSpin') + 'BadSpin'.length],
      ['Keyframes name "good-spin" does not match the configured pattern', source.indexOf('good-spin'), source.indexOf('good-spin') + 'good-spin'.length]
    ]);
  });

  it('reports important declarations outside keyframes', () => {
    const source = '.a { color: red !important; }\n@keyframes spin { from { opacity: 1 !important; } }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const important = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.declarationNoImportant);

    expect(important.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Disallowed !important', source.indexOf('!important'), source.indexOf('!important') + '!important'.length]
    ]);
  });

  it('reports unknown animation names from CSS declarations', () => {
    const source = '.a { animation: 1s ease-in known, 200ms missing both; animation-name: known, other, none; }\n'
      + '.b { animation: var(--motion); }\n'
      + '@keyframes /* { */ known { from { opacity: 0; } }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const unknownAnimations = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.unknownAnimations);

    expect(unknownAnimations.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unknown animation "missing"', source.indexOf('missing'), source.indexOf('missing') + 'missing'.length],
      ['Unknown animation "other"', source.indexOf('other'), source.indexOf('other') + 'other'.length]
    ]);
  });

  it('does not report unknown animations in dialect files before animation facts exist', () => {
    const scss = collectTolerantDiagnostics({
      source: '.a { animation-name: missing; }',
      language: 'scss'
    });
    const less = collectTolerantDiagnostics({
      source: '.a { animation-name: missing; }',
      language: 'less'
    });

    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownAnimations)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownAnimations)).toBe(false);
  });

  it('reports invalid named grid areas', () => {
    const source = '.a { grid-template-areas: "a a" "b"; }\n'
      + '.b { grid-template: "a ." ". a" / 1fr 1fr; }\n'
      + '.c { grid: "" / 1fr; }\n'
      + '.d { grid-template-areas: "ok ok" "ok ok"; }\n'
      + '.e { grid-template-areas: "gap" "." "gap"; }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const invalidGridAreas = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.invalidNamedGridAreas);

    expect(invalidGridAreas.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Expected same number of cell tokens in each string', source.indexOf('"b"'), source.indexOf('"b"') + '"b"'.length],
      ['Expected single filled-in rectangle for "a"', source.indexOf('"a ."'), source.indexOf('"a ."') + '"a ."'.length],
      ['Expected cell token within string', source.indexOf('""'), source.indexOf('""') + '""'.length]
    ]);
  });

  it('does not report invalid named grid areas in dialect files before value facts exist', () => {
    const scss = collectTolerantDiagnostics({
      source: '.a { grid-template-areas: "a a" "b"; }',
      language: 'scss'
    });
    const less = collectTolerantDiagnostics({
      source: '.a { grid-template-areas: "a a" "b"; }',
      language: 'less'
    });

    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.invalidNamedGridAreas)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.invalidNamedGridAreas)).toBe(false);
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

  it('reports opt-in CSS @import statement policy facts', () => {
    const source = '@import url("a.css");\n.a { color: red; }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const imports = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.importStatement);

    expect(imports.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Avoid @import because it can block parallel stylesheet loading', 0, '@import url("a.css");'.length]
    ]);
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
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.importStatement)).toBe(false);
    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.importStatement)).toBe(false);
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

  it('reports duplicate static module loads in SCSS and Jess', () => {
    const scss = collectTolerantDiagnostics({
      source: '@use "theme";\n@use "theme" as tokens;\n@use "theme";\n@forward "shared";\n@forward "shared";',
      language: 'scss'
    });
    const jess = collectTolerantDiagnostics({
      source: '@-use "theme";\n@-use "theme" as tokens;\n@-use "theme";\n@-from "tokens" import color;\n@-from "tokens" import size;\n@-from "tokens" import color;\n@-compose "base" as base;\n@-compose "base" as base;',
      language: 'jess'
    });

    expect(scss.diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.duplicateModuleLoads)
      .map(diagnostic => [diagnostic.message, diagnostic.line, diagnostic.column])).toEqual([
      ['Duplicate @use module load theme', 3, 1],
      ['Duplicate @forward module load shared', 5, 1]
    ]);
    expect(jess.diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.duplicateModuleLoads)
      .map(diagnostic => [diagnostic.message, diagnostic.line, diagnostic.column])).toEqual([
      ['Duplicate @-use module load theme', 3, 1],
      ['Duplicate @-from module load tokens', 6, 1],
      ['Duplicate @-compose module load base', 8, 1]
    ]);
  });

  it('reports extend targets with no bounded selector anchor', () => {
    const less = collectTolerantDiagnostics({
      source: '.a:extend(div all) {}\n.b:extend(.btn all) {}\n.c:extend([data-x] all, #ok all) {}',
      language: 'less'
    });
    const scss = collectTolerantDiagnostics({
      source: '.a { @extend div; }\n.b { @extend .btn; }\n.c { @extend [data-x]; }\n.d { @extend %tool; }',
      language: 'scss'
    });
    const jess = collectTolerantDiagnostics({
      source: '.a { $extend div, .btn, [data-x]; }',
      language: 'jess'
    });

    expect(less.diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.unboundedExtends)
      .map(diagnostic => [diagnostic.message, diagnostic.line, diagnostic.column])).toEqual([
      ['Extend target "div" has no class, id, placeholder, or parent selector anchor', 1, 11],
      ['Extend target "[data-x]" has no class, id, placeholder, or parent selector anchor', 3, 11]
    ]);
    expect(scss.diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.unboundedExtends)
      .map(diagnostic => [diagnostic.message, diagnostic.line, diagnostic.column])).toEqual([
      ['Extend target "div" has no class, id, placeholder, or parent selector anchor', 1, 14],
      ['Extend target "[data-x]" has no class, id, placeholder, or parent selector anchor', 3, 14]
    ]);
    expect(jess.diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.unboundedExtends)
      .map(diagnostic => [diagnostic.message, diagnostic.line, diagnostic.column])).toEqual([
      ['Extend target "div" has no class, id, placeholder, or parent selector anchor', 1, 14],
      ['Extend target "[data-x]" has no class, id, placeholder, or parent selector anchor', 1, 25]
    ]);
  });

  it('reports exact static extend targets that do not match same-file selectors', () => {
    const less = collectTolerantDiagnostics({
      source: '.hit {}\n.a:extend(.hit) {}\n.b:extend(.missing) {}\n.c:extend(.maybe all) {}',
      language: 'less'
    });
    const scss = collectTolerantDiagnostics({
      source: '.hit {}\n.a { @extend .hit; }\n.b { @extend .missing; }',
      language: 'scss'
    });
    const jess = collectTolerantDiagnostics({
      source: '.hit {}\n.a { $extend .hit !exact; }\n.b { $extend .missing !exact; }\n.c { $extend .maybe; }',
      language: 'jess'
    });
    const imported = collectTolerantDiagnostics({
      source: '@use "external";\n.a { @extend .from-import; }',
      language: 'scss'
    });

    expect(less.diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.deadExtends)
      .map(diagnostic => [diagnostic.message, diagnostic.line, diagnostic.column])).toEqual([
      ['Extend target ".missing" does not match any same-file selector', 3, 11]
    ]);
    expect(scss.diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.deadExtends)
      .map(diagnostic => [diagnostic.message, diagnostic.line, diagnostic.column])).toEqual([
      ['Extend target ".missing" does not match any same-file selector', 3, 14]
    ]);
    expect(jess.diagnostics
      .filter(diagnostic => diagnostic.code === LINT_CODES.deadExtends)
      .map(diagnostic => [diagnostic.message, diagnostic.line, diagnostic.column])).toEqual([
      ['Extend target ".missing" does not match any same-file selector', 3, 14]
    ]);
    expect(imported.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.deadExtends)).toBe(false);
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

  it('reports definite incompatible CSS math function units', () => {
    const source = '.a { width: min(1px, 2s); rotate: max(1turn, 2deg); opacity: clamp(.1, 2, 3); height: clamp(1rem, 2s, 3px); }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const mismatches = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.incompatibleMathFunctionUnits);

    expect(mismatches.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Incompatible units in min(): 1px is length but 2s is time', source.indexOf('2s'), source.indexOf('2s') + '2s'.length],
      ['Incompatible units in clamp(): 1rem is length but 2s is time', source.indexOf('2s, 3px'), source.indexOf('2s, 3px') + '2s'.length]
    ]);
  });

  it('keeps CSS math function unit checks conservative for dynamic, percentage, or compound arguments', () => {
    const result = collectTolerantDiagnostics({
      source: '.a { width: min(10%, 2px); height: min(var(--size), 2s); margin: min(1px + 2px, 1s); }',
      language: 'css'
    });

    expect(result.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.incompatibleMathFunctionUnits)).toBe(false);
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

  it('reports opt-in CSS vendor-prefixed selector policy facts', () => {
    const source = '.a::-webkit-scrollbar, .b:-moz-placeholder, .c:focus-visible { color: red; }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const vendorSelectors = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.selectorNoVendorPrefix);
    const webkitStart = source.indexOf('::-webkit-scrollbar');
    const mozStart = source.indexOf(':-moz-placeholder');

    expect(vendorSelectors.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unexpected vendor-prefixed selector "::-webkit-scrollbar"', webkitStart, webkitStart + '::-webkit-scrollbar'.length],
      ['Unexpected vendor-prefixed selector ":-moz-placeholder"', mozStart, mozStart + ':-moz-placeholder'.length]
    ]);
  });

  it('reports opt-in selector class pattern facts for static class names', () => {
    const source = '.GoodName, .bad-name:hover, #id { color: red; }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const classes = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.selectorClassPattern);

    expect(classes.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Class selector "GoodName" does not match the configured pattern', source.indexOf('.GoodName'), source.indexOf('.GoodName') + '.GoodName'.length],
      ['Class selector "bad-name" does not match the configured pattern', source.indexOf('.bad-name'), source.indexOf('.bad-name') + '.bad-name'.length]
    ]);
  });

  it('does not report vendor-prefixed selector policy facts in dialect files before selector facts exist', () => {
    const source = '.a::-webkit-scrollbar { color: red; }';
    const scss = collectTolerantDiagnostics({ source, language: 'scss' });
    const less = collectTolerantDiagnostics({ source, language: 'less' });

    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.selectorNoVendorPrefix)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.selectorNoVendorPrefix)).toBe(false);
  });

  it('reports unmatchable An+B selector pseudos', () => {
    const source = 'a:nth-child(0), b:nth-child(+0), c:nth-child(-0n+0 of .item), d:nth-of-type(0n-0), e:nth-last-child(n), f:nth-child(00), g:nth-child(0n+00) { color: red; }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const unmatchable = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.unmatchableAnbSelectors);

    expect(unmatchable.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unmatchable An+B selector ":nth-child(0)"', source.indexOf(':nth-child(0)'), source.indexOf(':nth-child(0)') + ':nth-child(0)'.length],
      ['Unmatchable An+B selector ":nth-child(+0)"', source.indexOf(':nth-child(+0)'), source.indexOf(':nth-child(+0)') + ':nth-child(+0)'.length],
      ['Unmatchable An+B selector ":nth-child(-0n+0 of .item)"', source.indexOf(':nth-child(-0n+0 of .item)'), source.indexOf(':nth-child(-0n+0 of .item)') + ':nth-child(-0n+0 of .item)'.length],
      ['Unmatchable An+B selector ":nth-of-type(0n-0)"', source.indexOf(':nth-of-type(0n-0)'), source.indexOf(':nth-of-type(0n-0)') + ':nth-of-type(0n-0)'.length]
    ]);
  });

  it('does not report unmatchable An+B selector pseudos in dialect files before selector facts exist', () => {
    const scss = collectTolerantDiagnostics({
      source: '.a:nth-child(0) { color: red; }',
      language: 'scss'
    });
    const less = collectTolerantDiagnostics({
      source: '.a:nth-child(0) { color: red; }',
      language: 'less'
    });

    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unmatchableAnbSelectors)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unmatchableAnbSelectors)).toBe(false);
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

  it('reports opt-in CSS ID and universal selector policy facts', () => {
    const source = '#app, * > .item, .ok, :not(#nested) { color: red; }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const idSelectors = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.selectorMaxId);
    const universalSelectors = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.selectorMaxUniversal
    );
    const appStart = source.indexOf('#app');
    const universalStart = source.indexOf('*');
    const nestedStart = source.indexOf('#nested');

    expect(idSelectors.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Avoid ID selectors', appStart, appStart + '#app'.length],
      ['Avoid ID selectors', nestedStart, nestedStart + '#nested'.length]
    ]);
    expect(universalSelectors.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Avoid universal selectors', universalStart, universalStart + '*'.length]
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
      source: '$root foo, #app, * { color: red; }',
      language: 'scss'
    });
    const less = collectTolerantDiagnostics({
      source: '@root foo, #app, * { color: red; }',
      language: 'less'
    });

    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownTypeSelectors)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownTypeSelectors)).toBe(false);
    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.selectorMaxId)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.selectorMaxId)).toBe(false);
    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.selectorMaxUniversal)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.selectorMaxUniversal)).toBe(false);
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

  it('reports nonstandard linear-gradient directions', () => {
    const source = [
      '.a { background: linear-gradient(top, #fff, #000); }',
      '.b { background: linear-gradient(left bottom in oklab, red, blue); }',
      '.c { background: repeating-linear-gradient(45, red, blue); }',
      '.d { background: linear-gradient(to top top, red, blue); }',
      '.e { background: linear-gradient(to top, #fff, #000); }',
      '.f { background: linear-gradient(to bottom right in oklab, red, blue); }',
      '.g { background: linear-gradient(45deg, #fff, #000); }',
      '.h { background: linear-gradient(in oklab, red, blue); }',
      '.i { background: linear-gradient(var(--direction), red, blue); }'
    ].join('\n');
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const gradients = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.linearGradientNonstandardDirection
    );

    expect(gradients.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Expected standard direction syntax in linear-gradient()', source.indexOf('top'), source.indexOf('top') + 'top'.length],
      ['Expected standard direction syntax in linear-gradient()', source.indexOf('left bottom'), source.indexOf('left bottom in oklab') + 'left bottom in oklab'.length],
      ['Expected standard direction syntax in repeating-linear-gradient()', source.indexOf('45'), source.indexOf('45') + '45'.length],
      ['Expected standard direction syntax in linear-gradient()', source.indexOf('to top top'), source.indexOf('to top top') + 'to top top'.length]
    ]);
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

  it('reports opt-in modern color notation facts from static CSS values', () => {
    const source = [
      '.a { color: rgb(1, 2, 3); }',
      '.b { color: rgb(1 2 3 / .5); }',
      '.c { opacity: 50%; }',
      '.d { color: hsl(120 50% 50% / 25%); }',
      '.e { color: hsl(120deg 50% 50% / .25); }',
      '.f { color: rgb(var(--brand)); opacity: var(--alpha); }'
    ].join('\n');
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const notation = result.diagnostics.filter(diagnostic =>
      diagnostic.code === LINT_CODES.colorFunctionNotation
      || diagnostic.code === LINT_CODES.alphaValueNotation
      || diagnostic.code === LINT_CODES.hueDegreeNotation
    );

    expect(notation.map(diagnostic => [diagnostic.code, diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      [LINT_CODES.colorFunctionNotation, 'Expected modern color-function notation in rgb()', source.indexOf('rgb(1, 2, 3)'), source.indexOf('rgb(1, 2, 3)') + 'rgb('.length],
      [LINT_CODES.alphaValueNotation, 'Alpha value ".5" does not match the configured notation', source.indexOf('.5'), source.indexOf('.5') + '.5'.length],
      [LINT_CODES.alphaValueNotation, 'Alpha value "50%" does not match the configured notation', source.indexOf('50%'), source.indexOf('50%') + '50%'.length],
      [LINT_CODES.alphaValueNotation, 'Alpha value "25%" does not match the configured notation', source.indexOf('25%'), source.indexOf('25%') + '25%'.length],
      [LINT_CODES.hueDegreeNotation, 'Hue value "120" does not match the configured notation', source.indexOf('120 50%'), source.indexOf('120 50%') + '120'.length],
      [LINT_CODES.alphaValueNotation, 'Alpha value ".25" does not match the configured notation', source.indexOf('.25'), source.indexOf('.25') + '.25'.length],
      [LINT_CODES.hueDegreeNotation, 'Hue value "120deg" does not match the configured notation', source.indexOf('120deg'), source.indexOf('120deg') + '120deg'.length]
    ]);
  });

  it('reports definite invalid CSS color function channels', () => {
    const source = '.a { color: rgb(1px 0 0); background: hsl(120 50 50%); border-color: rgb(0 0); outline-color: rgb(var(--brand)); }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const colorChannels = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.invalidColorFunctionChannels);

    expect(colorChannels.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Invalid rgb() color channel "1px"', source.indexOf('1px'), source.indexOf('1px') + '1px'.length],
      ['Invalid hsl() color channel "50"', source.indexOf('50 50%'), source.indexOf('50 50%') + '50'.length],
      ['Invalid rgb() color channel count', source.indexOf('rgb(0 0)'), source.indexOf('rgb(0 0)') + 'rgb('.length]
    ]);
  });

  it('does not report invalid color function channels in dialect files before value facts exist', () => {
    const scss = collectTolerantDiagnostics({
      source: '.a { color: rgb(1px 0 0); }',
      language: 'scss'
    });
    const less = collectTolerantDiagnostics({
      source: '.a { color: rgb(1px 0 0); }',
      language: 'less'
    });

    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.invalidColorFunctionChannels)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.invalidColorFunctionChannels)).toBe(false);
  });

  it('reports definite invalid typed custom property initial values', () => {
    const source = [
      '@property --gap { syntax: "<length>"; initial-value: red; inherits: false; }',
      '@property --count { syntax: "<integer>"; initial-value: 1.5; inherits: false; }',
      '@property --free { syntax: "*"; initial-value: red; inherits: false; }',
      '@property --dynamic { syntax: "<length>"; initial-value: var(--gap); inherits: false; }',
      '@property --ok-length { syntax: "<length>"; initial-value: 0; inherits: false; }',
      '@property --ok-named-color { syntax: "<color>"; initial-value: red; inherits: false; }',
      '@property --ok-color { syntax: "<color>"; initial-value: rgb(0 0 0); inherits: false; }'
    ].join('\n');
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const typedValues = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.invalidTypedCustomPropertyValue);

    expect(typedValues.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Initial value "red" does not match @property syntax "<length>"', source.indexOf('red'), source.indexOf('red') + 'red'.length],
      ['Initial value "1.5" does not match @property syntax "<integer>"', source.indexOf('1.5'), source.indexOf('1.5') + '1.5'.length]
    ]);
  });

  it('does not report invalid typed custom property values in dialect files before value facts exist', () => {
    const scss = collectTolerantDiagnostics({
      source: '@property --gap { syntax: "<length>"; initial-value: red; inherits: false; }',
      language: 'scss'
    });
    const less = collectTolerantDiagnostics({
      source: '@property --gap { syntax: "<length>"; initial-value: red; inherits: false; }',
      language: 'less'
    });

    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.invalidTypedCustomPropertyValue)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.invalidTypedCustomPropertyValue)).toBe(false);
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

  it('reports opt-in CSS vendor-prefixed media feature policy facts', () => {
    const source = '@media (-webkit-device-pixel-ratio: 2) and (min-width: 1px) { .a { color: red; } }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const vendorFeatures = result.diagnostics.filter(
      diagnostic => diagnostic.code === LINT_CODES.mediaFeatureNameNoVendorPrefix
    );
    const featureStart = source.indexOf('-webkit-device-pixel-ratio');

    expect(vendorFeatures.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      [
        'Unexpected vendor-prefixed media feature name "-webkit-device-pixel-ratio"',
        featureStart,
        featureStart + '-webkit-device-pixel-ratio'.length
      ]
    ]);
  });

  it('reports unknown CSS media feature values', () => {
    const source = '@media (orientation: sideways) and (hover: maybe) and (grid: 2) and (resolution: infinite) and (width: 10px) and (aspect-ratio: 16/9) and (min-width: 0) { .a { color: red; } }';
    const result = collectTolerantDiagnostics({
      source,
      language: 'css'
    });
    const unknownMediaFeatureValues = result.diagnostics.filter(diagnostic => diagnostic.code === LINT_CODES.unknownMediaFeatureValues);

    expect(unknownMediaFeatureValues.map(diagnostic => [diagnostic.message, diagnostic.start, diagnostic.end])).toEqual([
      ['Unknown media feature value "sideways" for name "orientation"', source.indexOf('sideways'), source.indexOf('sideways') + 'sideways'.length],
      ['Unknown media feature value "maybe" for name "hover"', source.indexOf('maybe'), source.indexOf('maybe') + 'maybe'.length],
      ['Unknown media feature value "2" for name "grid"', source.indexOf('2)'), source.indexOf('2)') + '2'.length]
    ]);
  });

  it('does not report unknown media feature values for dynamic or non-CSS media queries', () => {
    const css = collectTolerantDiagnostics({
      source: '@media (orientation: var(--orientation)) and (future-feature: sideways) { .a { color: red; } }',
      language: 'css'
    });
    const scss = collectTolerantDiagnostics({
      source: '@media (orientation: $direction) { .a { color: red; } }',
      language: 'scss'
    });
    const less = collectTolerantDiagnostics({
      source: '@media (orientation: @direction) { .a { color: red; } }',
      language: 'less'
    });

    expect(css.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownMediaFeatureValues)).toBe(false);
    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownMediaFeatureValues)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.unknownMediaFeatureValues)).toBe(false);
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
    expect(scss.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.mediaFeatureNameNoVendorPrefix)).toBe(false);
    expect(less.diagnostics.some(diagnostic => diagnostic.code === LINT_CODES.mediaFeatureNameNoVendorPrefix)).toBe(false);
  });
});
