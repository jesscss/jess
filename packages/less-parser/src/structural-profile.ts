import {
  createLanguageProfile,
  pushIfMissing,
  type DeclarationNameKind,
  type IslandClassificationContext,
  type IslandKind,
  type LanguageProfile,
  type RuleHeaderKind
} from '@jesscss/parser';
import { classifyCssIsland, cssProfile } from '@jesscss/css-parser';

/** Structural Less profile owned by `@jesscss/less-parser`. */
export const lessProfile: LanguageProfile = createLanguageProfile({
  name: 'less',
  variablePrefixes: ['@'],
  interpolationStarts: ['@{', '${'],
  atRuleClassifiers: cssProfile.atRuleClassifiers,
  statementStarters: [
    ...cssProfile.statementStarters,
    { text: '@', kind: 'variable' },
    { text: '.', kind: 'mixin-definition' },
    { text: '#', kind: 'mixin-definition' },
    { text: ':extend(', kind: 'rule' }
  ],
  classifyDeclarationName(text): DeclarationNameKind | undefined {
    if (text.startsWith('@')) {
      return 'variable';
    }
    if (text.startsWith('${') || text.startsWith('@{')) {
      return 'interpolated-property';
    }
    return undefined;
  },
  classifyRuleHeader(text): RuleHeaderKind | undefined {
    if (looksLikeLessMixin(text)) {
      return 'mixin-definition';
    }
    return undefined;
  },
  classifyIsland(text, _source, _range, context): readonly IslandKind[] {
    const kinds = [...classifyCssIsland(text, context)];
    addLessIslandKinds(text, context, kinds);
    return kinds;
  }
});

const LESS_MIXIN_PATTERN = /^[.#][\w-]+\s*\(/;

/** Identifies Less mixin definitions without invoking the full Less parser. */
function looksLikeLessMixin(text: string): boolean {
  return LESS_MIXIN_PATTERN.test(text);
}

/** Adds Less-specific lazy island hints while preserving CSS classifications. */
function addLessIslandKinds(
  text: string,
  context: IslandClassificationContext | undefined,
  kinds: IslandKind[]
): void {
  if (text.includes('@{') || text.includes('${')) {
    pushIfMissing(kinds, 'interpolation');
  }
  if (text.includes(':extend(')) {
    pushIfMissing(kinds, 'extend-candidate');
  }
  if (looksLikeLessMixin(text)) {
    pushIfMissing(kinds, 'mixin-definition');
  }
  if (context?.statementKind === 'mixin-call') {
    pushIfMissing(kinds, 'mixin-call');
  }
  if (text.includes('@')) {
    pushIfMissing(kinds, 'variable-reference');
  }
}
