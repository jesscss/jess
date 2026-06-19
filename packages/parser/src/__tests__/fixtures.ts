import {
  createLanguageProfile,
  pushIfMissing,
  type DeclarationNameKind,
  type IslandClassificationContext,
  type IslandKind,
  type LanguageProfile,
  type RuleHeaderKind
} from '../index.js';

/** Minimal stylesheet-like profile used only by parser package tests. */
export const fixtureProfile: LanguageProfile = createLanguageProfile({
  name: 'fixture',
  variablePrefixes: [],
  interpolationStarts: [],
  atRuleClassifiers: {
    import: 'import'
  },
  statementStarters: [
    { text: '@', kind: 'at-rule' },
    { text: '--', kind: 'declaration' },
    { text: '.', kind: 'rule' },
    { text: '#', kind: 'rule' },
    { text: '[', kind: 'rule' },
    { text: ':', kind: 'rule' }
  ],
  classifyDeclarationName: classifyFixtureDeclarationName,
  classifyRuleHeader: classifyFixtureRuleHeader,
  classifyIsland: classifyFixtureIsland
});

/** Less-like fixture profile for parser services that need variable islands. */
export const fixtureLessProfile: LanguageProfile = createLanguageProfile({
  ...fixtureProfile,
  name: 'fixture-less',
  variablePrefixes: ['@'],
  interpolationStarts: ['@{', '${'],
  statementStarters: [
    ...fixtureProfile.statementStarters,
    { text: '@', kind: 'variable' },
    { text: '.', kind: 'mixin-definition' },
    { text: '#', kind: 'mixin-definition' },
    { text: ':extend(', kind: 'rule' }
  ],
  classifyDeclarationName(text): DeclarationNameKind {
    if (text.startsWith('@')) {
      return 'variable';
    }
    if (text.startsWith('${') || text.startsWith('@{')) {
      return 'interpolated-property';
    }
    return classifyFixtureDeclarationName(text);
  },
  classifyRuleHeader(text): RuleHeaderKind {
    if (/^[.#][\w-]+\s*\(/.test(text)) {
      return 'mixin-definition';
    }
    return classifyFixtureRuleHeader(text);
  },
  classifyIsland(text, _source, _range, context): readonly IslandKind[] {
    const kinds = [...classifyFixtureIsland(text, _source, _range, context)];
    if (text.includes('@{') || text.includes('${')) {
      pushIfMissing(kinds, 'interpolation');
    }
    if (text.includes(':extend(')) {
      pushIfMissing(kinds, 'extend-candidate');
    }
    if (/^[.#][\w-]+\s*\(/.test(text)) {
      pushIfMissing(kinds, 'mixin-definition');
    }
    if (context?.statementKind === 'mixin-call') {
      pushIfMissing(kinds, 'mixin-call');
    }
    if (text.includes('@')) {
      pushIfMissing(kinds, 'variable-reference');
    }
    return kinds;
  }
});

/** SCSS-like fixture profile for parser service tests. */
export const fixtureScssProfile: LanguageProfile = createLanguageProfile({
  ...fixtureProfile,
  name: 'fixture-scss',
  variablePrefixes: ['$'],
  interpolationStarts: ['#{'],
  atRuleClassifiers: {
    ...fixtureProfile.atRuleClassifiers,
    forward: 'forward',
    include: 'include',
    use: 'use'
  },
  statementStarters: [
    ...fixtureProfile.statementStarters,
    { text: '$', kind: 'variable' },
    { text: '%', kind: 'rule' },
    { text: '@include', kind: 'mixin-call' },
    { text: '@use', kind: 'at-rule' },
    { text: '@forward', kind: 'at-rule' }
  ],
  classifyDeclarationName(text): DeclarationNameKind {
    if (text.startsWith('$')) {
      return 'variable';
    }
    return classifyFixtureDeclarationName(text);
  },
  classifyRuleHeader(text): RuleHeaderKind {
    if (text.startsWith('%')) {
      return 'placeholder-selector';
    }
    return classifyFixtureRuleHeader(text);
  },
  classifyIsland(text, _source, _range, context): readonly IslandKind[] {
    const kinds = [...classifyFixtureIsland(text, _source, _range, context)];
    if (text.includes('#{')) {
      pushIfMissing(kinds, 'interpolation');
    }
    if (text.includes('$')) {
      pushIfMissing(kinds, 'variable-reference');
    }
    if (context?.statementKind === 'mixin-call' || text.startsWith('@include')) {
      pushIfMissing(kinds, 'mixin-call');
    }
    return kinds;
  }
});

function classifyFixtureDeclarationName(text: string): DeclarationNameKind {
  if (text.length === 0) {
    return 'unknown';
  }
  if (text.startsWith('--')) {
    return 'custom-property';
  }
  return 'property';
}

function classifyFixtureRuleHeader(text: string): RuleHeaderKind {
  return text.length > 0 ? 'selector' : 'unknown';
}

function classifyFixtureIsland(
  text: string,
  _source: unknown,
  _range: unknown,
  context?: IslandClassificationContext
): readonly IslandKind[] {
  const kinds: IslandKind[] = [];
  if (context?.parentKind === 'at-rule') {
    kinds.push('at-rule-prelude');
  }
  if (context?.parentKind === 'declaration') {
    kinds.push('declaration-value');
  }
  if (context?.statementKind === 'rule' || looksLikeFixtureSelector(text)) {
    kinds.push('selector');
  }
  return kinds;
}

function looksLikeFixtureSelector(text: string): boolean {
  return (
    text.includes('&') ||
    text.startsWith('.') ||
    text.startsWith('#') ||
    text.startsWith('[') ||
    text.startsWith(':') ||
    text.startsWith('%') ||
    /^[a-zA-Z_*|-]/.test(text)
  );
}
