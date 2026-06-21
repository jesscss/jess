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
import { classifyCssIsland, looksLikeCssSelector } from '@jesscss/css-parser';
import { scssProfile } from '@jesscss/scss-parser';

/** Structural Jess profile owned by `@jesscss/jess-parser`. */
export const jessProfile: LanguageProfile = createLanguageProfile({
  name: 'jess',
  variablePrefixes: ['$'],
  interpolationStarts: ['$('],
  atRuleClassifiers: {
    ...scssProfile.atRuleClassifiers,
    module: 'module'
  },
  statementStarters: [
    ...scssProfile.statementStarters,
    { text: '$if', kind: 'at-rule' },
    { text: '$else', kind: 'at-rule' },
    { text: '$for', kind: 'at-rule' },
    { text: '$while', kind: 'at-rule' },
    { text: '$>', kind: 'mixin-call' },
    { text: '$ >', kind: 'mixin-call' },
    { text: '$', kind: 'variable' },
    { text: '@-compose', kind: 'at-rule' },
    { text: '@-from', kind: 'at-rule' },
    { text: '@-export', kind: 'at-rule' }
  ],
  classifyDeclarationName(text): DeclarationNameKind {
    if (text.startsWith('$')) {
      return 'variable';
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
    if (JESS_CONTROL_HEADER_PATTERN.test(text)) {
      return 'control-flow';
    }
    if (looksLikeJessMixinDefinition(text)) {
      return 'mixin-definition';
    }
    return looksLikeCssSelector(text) ? 'selector' : 'unknown';
  },
  classifyIsland(text, _source, _range, context): readonly IslandKind[] {
    const kinds = [...classifyCssIsland(text, context)];
    addJessIslandKinds(text, context, kinds);
    return kinds;
  }
});

const JESS_CONTROL_HEADER_PATTERN = /^\$(if|else\s+if|for|while)\b/;
const JESS_CONDITION_HEADER_PATTERN = /^\$(if|else\s+if|while)\b/;
const JESS_MODULE_AT_RULE_PATTERN = /^@-(compose|from|export)\b/;
const JESS_MIXIN_PATTERN = /^[$.#]?[-_a-zA-Z][\w-]*\s*\(/;

/** Identifies Jess mixin definitions without invoking the full parser. */
function looksLikeJessMixinDefinition(text: string): boolean {
  return JESS_MIXIN_PATTERN.test(text) && !text.startsWith('$(');
}

/** Adds Jess-specific lazy island hints while preserving CSS/SCSS classifications. */
function addJessIslandKinds(
  text: string,
  context: IslandClassificationContext | undefined,
  kinds: IslandKind[]
): void {
  if (text.includes('$(')) {
    pushIfMissing(kinds, 'interpolation');
  }
  if (text.includes('$')) {
    pushIfMissing(kinds, 'variable-reference');
  }
  if (looksLikeJessMixinDefinition(text)) {
    pushIfMissing(kinds, 'mixin-definition');
  }
  if (context?.statementKind === 'mixin-call' || text.startsWith('$ >') || text.startsWith('$>')) {
    pushIfMissing(kinds, 'mixin-call');
  }
  if (JESS_MODULE_AT_RULE_PATTERN.test(text)) {
    pushIfMissing(kinds, 'at-rule-prelude');
  }
  if (JESS_CONDITION_HEADER_PATTERN.test(text)) {
    pushIfMissing(kinds, 'control-condition');
  }
}
