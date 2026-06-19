import type { SourceText, SourceSpan } from '../source/index.js';
import type {
  AtRuleKind,
  DeclarationNameKind,
  IslandClassificationContext,
  IslandKind,
  LanguageProfile,
  RuleHeaderKind
} from './types.js';

/**
 * Configuration object for constructing a language profile.
 *
 * Parser packages and plugins own this data. The shared parser intentionally
 * does not hard-code CSS/Less/SCSS/Jess profiles so third-party CSS-family
 * languages can register equivalent structural behavior.
 */
export type ProfileConfig = {
  name: LanguageProfile['name'];
  variablePrefixes: readonly string[];
  interpolationStarts: readonly string[];
  atRuleClassifiers: Readonly<Record<string, AtRuleKind>>;
  statementStarters: LanguageProfile['statementStarters'];
  classifyDeclarationName: (
    text: string,
    source: SourceText,
    range: SourceSpan
  ) => DeclarationNameKind;
  classifyRuleHeader: (
    text: string,
    source: SourceText,
    range: SourceSpan
  ) => RuleHeaderKind;
  classifyIsland: (
    text: string,
    source: SourceText,
    range: SourceSpan,
    context?: IslandClassificationContext
  ) => readonly IslandKind[];
};

/**
 * Creates a language profile from caller-owned structural heuristics.
 *
 * The shared parser does not supply CSS defaults. CSS, Less, SCSS, Jess, and
 * third-party CSS+ syntaxes provide their own classifiers in their parser
 * packages or plugins.
 */
export function createLanguageProfile(config: ProfileConfig): LanguageProfile {
  return {
    name: config.name,
    variablePrefixes: config.variablePrefixes,
    interpolationStarts: config.interpolationStarts,
    atRuleClassifiers: config.atRuleClassifiers,
    statementStarters: config.statementStarters,
    classifyAtRule(name) {
      return config.atRuleClassifiers[normalizeAtRuleName(name)] ?? 'unknown';
    },
    classifyDeclarationName(source, range) {
      const text = rangeText(source, range);
      return config.classifyDeclarationName(text, source, range);
    },
    classifyRuleHeader(source, range) {
      const text = rangeText(source, range);
      return config.classifyRuleHeader(text, source, range);
    },
    classifyIsland(source, range, context) {
      const text = rangeText(source, range);
      return config.classifyIsland(text, source, range, context);
    }
  };
}

/** Returns trimmed source text for classifier heuristics. */
export function rangeText(source: SourceText, range: SourceSpan): string {
  return source.slice(range.start, range.end).trim();
}

/** Normalizes at-rule names for table lookup while accepting optional `@`. */
export function normalizeAtRuleName(name: string): string {
  return name.startsWith('@') ? name.slice(1).toLowerCase() : name.toLowerCase();
}

/** Adds a unique item while preserving classifier order. */
export function pushIfMissing<T>(items: T[], item: T): void {
  if (!items.includes(item)) {
    items.push(item);
  }
}
