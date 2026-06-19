import { describe, expect, test } from 'vitest';
import {
  SourceText,
  sourceSpan,
  createLanguageProfile,
  type LanguageProfile
} from '../index.js';
import { fixtureLessProfile, fixtureProfile, fixtureScssProfile } from './fixtures.js';

describe('language profiles', () => {
  test('creates caller-owned profiles without built-in language exports', () => {
    const source = new SourceText('.foo { --x: red }');

    expect(fixtureProfile.name).toBe('fixture');
    expect(fixtureProfile.classifyAtRule('@import')).toBe('import');
    expect(fixtureProfile.classifyAtRule('unknown')).toBe('unknown');
    expect(fixtureProfile.classifyDeclarationName(source, sourceSpan(7, 10))).toBe(
      'custom-property'
    );
    expect(fixtureProfile.classifyRuleHeader(source, sourceSpan(0, 4))).toBe(
      'selector'
    );
    expect(
      fixtureProfile.classifyIsland(source, sourceSpan(0, 4), {
        statementKind: 'rule'
      })
    ).toEqual(['selector']);
  });

  test('supports extension profiles with variables, interpolation, mixins, and extend candidates', () => {
    const source = new SourceText('@brand: #f00; .mixin(@x) when (@x) { &:extend(.a); color: @{brand}; }');

    expect(fixtureLessProfile.variablePrefixes).toEqual(['@']);
    expect(fixtureLessProfile.interpolationStarts).toEqual(['@{', '${']);
    expect(fixtureLessProfile.classifyDeclarationName(source, sourceSpan(0, 6))).toBe(
      'variable'
    );
    expect(fixtureLessProfile.classifyDeclarationName(new SourceText('${prop}'), sourceSpan(0, 7))).toBe(
      'interpolated-property'
    );
    expect(fixtureLessProfile.classifyRuleHeader(source, sourceSpan(14, 24))).toBe(
      'mixin-definition'
    );
    expect(fixtureLessProfile.classifyIsland(source, sourceSpan(25, source.length))).toEqual(
      expect.arrayContaining([
        'extend-candidate',
        'interpolation',
        'variable-reference'
      ])
    );
  });

  test('allows a different extension profile shape without substrate changes', () => {
    const source = new SourceText('$color: red; %tool { @include reset; color: #{$color}; }');

    expect(fixtureScssProfile.variablePrefixes).toEqual(['$']);
    expect(fixtureScssProfile.interpolationStarts).toEqual(['#{']);
    expect(fixtureScssProfile.classifyAtRule('@use')).toBe('use');
    expect(fixtureScssProfile.classifyAtRule('forward')).toBe('forward');
    expect(fixtureScssProfile.classifyAtRule('@include')).toBe('include');
    expect(fixtureScssProfile.classifyDeclarationName(source, sourceSpan(0, 6))).toBe(
      'variable'
    );
    expect(fixtureScssProfile.classifyRuleHeader(source, sourceSpan(13, 18))).toBe(
      'placeholder-selector'
    );
    expect(fixtureScssProfile.classifyIsland(source, sourceSpan(20, source.length))).toEqual(
      expect.arrayContaining(['interpolation', 'variable-reference', 'mixin-call'])
    );
  });

  test('allows third-party language profile names', () => {
    const tailwindProfile: LanguageProfile = createLanguageProfile({
      ...fixtureProfile,
      name: 'tailwind-utility-css',
      statementStarters: [
        ...fixtureProfile.statementStarters,
        { text: '@apply', kind: 'at-rule' }
      ]
    });

    expect(tailwindProfile.name).toBe('tailwind-utility-css');
    expect(tailwindProfile.statementStarters).toContainEqual({
      text: '@apply',
      kind: 'at-rule'
    });
  });
});
