import {
  createLanguageProfile,
  pushIfMissing,
  type DeclarationNameKind,
  type LanguageProfile,
  type RuleHeaderKind
} from '@jesscss/parser';
import type {
  IslandClassificationContext,
  IslandKind
} from '@jesscss/parser/profiles/index';
import { classifyCssIsland, cssProfile, looksLikeCssSelector } from '@jesscss/css-parser';

/** Structural SCSS profile owned by `@jesscss/scss-parser`. */
export const scssProfile: LanguageProfile = createLanguageProfile({
  name: 'scss',
  variablePrefixes: ['$'],
  interpolationStarts: ['#{'],
  atRuleClassifiers: {
    ...cssProfile.atRuleClassifiers,
    forward: 'forward',
    include: 'include',
    use: 'use'
  },
  statementStarters: [
    ...cssProfile.statementStarters,
    { text: '$', kind: 'variable' },
    { text: '%', kind: 'rule' },
    { text: '@include', kind: 'mixin-call' },
    { text: '@use', kind: 'at-rule' },
    { text: '@forward', kind: 'at-rule' },
    { text: '@if', kind: 'at-rule' },
    { text: '@else', kind: 'at-rule' },
    { text: '@for', kind: 'at-rule' },
    { text: '@each', kind: 'at-rule' },
    { text: '@while', kind: 'at-rule' }
  ],
  classifyDeclarationName(text): DeclarationNameKind {
    if (text.startsWith('$')) {
      return 'variable';
    }
    if (text.startsWith('#{')) {
      return 'interpolated-property';
    }
    if (text.length === 0) {
      return 'unknown';
    }
    if (text.startsWith('--')) {
      return 'custom-property';
    }
    return 'property';
  },
  classifyRuleHeader(text): RuleHeaderKind {
    if (text.startsWith('%')) {
      return 'placeholder-selector';
    }
    if (SCSS_CONTROL_HEADER_PATTERN.test(text)) {
      return 'control-flow';
    }
    return looksLikeCssSelector(text) ? 'selector' : 'unknown';
  },
  classifyIsland(text, _source, _range, context): readonly IslandKind[] {
    const kinds = [...classifyCssIsland(text, context)];
    addScssIslandKinds(text, context, kinds);
    return kinds;
  }
});

const SCSS_CONTROL_HEADER_PATTERN = /^@(if|else\s+if|for|each|while)\b/;
const SCSS_CONDITION_HEADER_PATTERN = /^@(if|else\s+if|while)\b/;

/** Adds SCSS-specific lazy island hints while preserving CSS classifications. */
function addScssIslandKinds(
  text: string,
  context: IslandClassificationContext | undefined,
  kinds: IslandKind[]
): void {
  if (text.includes('#{')) {
    pushIfMissing(kinds, 'interpolation');
  }
  if (text.includes('$')) {
    pushIfMissing(kinds, 'variable-reference');
  }
  if (context?.statementKind === 'mixin-call' || text.startsWith('@include')) {
    pushIfMissing(kinds, 'mixin-call');
  }
  if (SCSS_CONDITION_HEADER_PATTERN.test(text) || isScssConditionAtRule(context?.atRuleName)) {
    pushIfMissing(kinds, 'control-condition');
  }
}

function isScssConditionAtRule(name: string | undefined): boolean {
  return name === '@if' || name === '@while' || name === '@else';
}
