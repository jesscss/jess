import {
  createLanguageProfile,
  type DeclarationNameKind,
  type IslandClassificationContext,
  type IslandKind,
  type LanguageProfile
} from '@jesscss/parser';

/** Structural CSS profile owned by `@jesscss/css-parser`. */
export const cssProfile: LanguageProfile = createLanguageProfile({
  name: 'css',
  variablePrefixes: [],
  interpolationStarts: [],
  atRuleClassifiers: {
    charset: 'charset',
    container: 'container',
    ['font-face']: 'font-face',
    import: 'import',
    keyframes: 'keyframes',
    media: 'media',
    supports: 'supports'
  },
  statementStarters: [
    { text: '@', kind: 'at-rule' },
    { text: '--', kind: 'declaration' },
    { text: '.', kind: 'rule' },
    { text: '#', kind: 'rule' },
    { text: '[', kind: 'rule' },
    { text: ':', kind: 'rule' }
  ],
  classifyDeclarationName(text): DeclarationNameKind {
    if (text.length === 0) {
      return 'unknown';
    }
    if (text.startsWith('--')) {
      return 'custom-property';
    }
    return 'property';
  },
  classifyRuleHeader(text) {
    return text.length > 0 ? 'selector' : 'unknown';
  },
  classifyIsland(text, _source, _range, context) {
    return classifyCssIsland(text, context);
  }
});

/**
 * Classifies raw CSS spans that may be promoted by later services.
 *
 * This intentionally returns broad island kinds; exact AST shape is deferred to
 * an island parser provider.
 */
export function classifyCssIsland(
  text: string,
  context: IslandClassificationContext | undefined
): readonly IslandKind[] {
  const kinds: IslandKind[] = [];
  if (context?.parentKind === 'at-rule') {
    kinds.push('at-rule-prelude');
  }
  if (context?.parentKind === 'declaration') {
    kinds.push('declaration-value');
    return kinds;
  }
  if (context?.parentKind !== 'at-rule' && (context?.statementKind === 'rule' || looksLikeCssSelector(text))) {
    kinds.push('selector');
  }
  return kinds;
}

/** Conservative selector heuristic used before the full CSS parser runs. */
export function looksLikeCssSelector(text: string): boolean {
  return (
    text.includes('&')
    || text.startsWith('.')
    || text.startsWith('#')
    || text.startsWith('[')
    || text.startsWith(':')
    || CSS_SELECTOR_START_PATTERN.test(text)
  );
}

const CSS_SELECTOR_START_PATTERN = /^[a-zA-Z_*|-]/;
