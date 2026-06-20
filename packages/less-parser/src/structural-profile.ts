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
    if (text.startsWith('--')) {
      return 'custom-property';
    }
    if (text.startsWith('${') || text.startsWith('@{')) {
      return 'interpolated-property';
    }
    if (text.startsWith('@')) {
      return 'variable';
    }
    return undefined;
  },
  classifyRuleHeader(text, source, range): RuleHeaderKind | undefined {
    if (looksLikeLessMixin(text)) {
      return 'mixin-definition';
    }
    return cssProfile.classifyRuleHeader(source, range);
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
  if (containsLessVariableReference(text)) {
    pushIfMissing(kinds, 'variable-reference');
  }
}

function containsLessVariableReference(text: string): boolean {
  let quote = 0;
  let blockComment = false;
  let lineComment = false;
  let parenDepth = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const next = i + 1 < text.length ? text.charCodeAt(i + 1) : -1;

    if (lineComment) {
      if (code === Char.LineFeed || code === Char.CarriageReturn || code === Char.FormFeed) {
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      if (code === Char.Star && next === Char.Slash) {
        blockComment = false;
        i++;
      }
      continue;
    }

    if (quote !== 0) {
      if (code === Char.Backslash) {
        i++;
        continue;
      }
      if (code === quote) {
        quote = 0;
      }
      continue;
    }

    if (code === Char.DoubleQuote || code === Char.SingleQuote) {
      quote = code;
      continue;
    }

    if (code === Char.Slash && next === Char.Star) {
      blockComment = true;
      i++;
      continue;
    }

    if (parenDepth === 0 && code === Char.Slash && next === Char.Slash) {
      lineComment = true;
      i++;
      continue;
    }

    if (code === Char.OpenParen) {
      parenDepth++;
      continue;
    }

    if (code === Char.CloseParen) {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (code !== Char.At) {
      continue;
    }

    if (isEscaped(text, i)) {
      continue;
    }

    if (next === Char.OpenBrace) {
      return true;
    }

    if (next === Char.At || isVariableNameStart(next)) {
      return true;
    }
  }

  return false;
}

function isEscaped(text: string, offset: number): boolean {
  let slashCount = 0;
  for (let i = offset - 1; i >= 0 && text.charCodeAt(i) === Char.Backslash; i--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}

function isVariableNameStart(code: number): boolean {
  return code === Char.Underscore
    || code === Char.Hyphen
    || (code >= Char.Zero && code <= Char.Nine)
    || (code >= Char.UpperA && code <= Char.UpperZ)
    || (code >= Char.LowerA && code <= Char.LowerZ)
    || code >= 0x80;
}

const enum Char {
  At = 64,
  Backslash = 92,
  CarriageReturn = 13,
  CloseParen = 41,
  DoubleQuote = 34,
  FormFeed = 12,
  Hyphen = 45,
  LineFeed = 10,
  LowerA = 97,
  LowerZ = 122,
  OpenBrace = 123,
  OpenParen = 40,
  SingleQuote = 39,
  Slash = 47,
  Star = 42,
  Underscore = 95,
  UpperA = 65,
  UpperZ = 90,
  Zero = 48,
  Nine = 57
}
