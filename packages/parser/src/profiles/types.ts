import type { SourceText, SourceSpan } from '../source/index.js';

/**
 * Language/profile identifier supplied by a parser package or plugin.
 *
 * `@jesscss/parser` treats this as opaque; CSS, Less, Tailwind-like dialects,
 * and future Jess-family profiles register their own names outside this
 * substrate package.
 */
export type LanguageName = string & {};

/** Coarse at-rule classes used by structural and semantic services. */
export type AtRuleKind =
  | 'charset'
  | 'container'
  | 'font-face'
  | 'forward'
  | 'import'
  | 'include'
  | 'keyframes'
  | 'media'
  | 'module'
  | 'supports'
  | 'use'
  | 'unknown';

/** Coarse statement start classes used before full parsing runs. */
export type StatementStarterKind =
  | 'at-rule'
  | 'declaration'
  | 'mixin-call'
  | 'mixin-definition'
  | 'rule'
  | 'variable';

/**
 * Prefix heuristic for classifying a statement before scanning its body.
 *
 * These are cheap recognizers, not full grammar productions. Expensive or rare
 * syntax can remain in island providers or canonical fallback paths.
 */
export type StatementStarter = {
  text: string;
  kind: StatementStarterKind;
};

/** Declaration-name classification used to split properties from variables. */
export type DeclarationNameKind =
  | 'custom-property'
  | 'interpolated-property'
  | 'property'
  | 'unknown'
  | 'variable';

/** Header classification for rule-like container nodes. */
export type RuleHeaderKind =
  | 'control-flow'
  | 'mixin-call'
  | 'mixin-definition'
  | 'placeholder-selector'
  | 'selector'
  | 'unknown';

/**
 * Raw island categories that can be promoted by language-specific providers.
 *
 * The structural parser may record several island kinds for one span when a
 * later consumer could reasonably ask for different target shapes.
 */
export type IslandKind =
  | 'at-rule-prelude'
  | 'control-condition'
  | 'declaration-value'
  | 'extend-candidate'
  | 'interpolation'
  | 'mixin-call'
  | 'mixin-definition'
  | 'selector'
  | 'variable-reference';

/** Context passed to profile island classifiers for ownership-sensitive hints. */
export type IslandClassificationContext = {
  parentKind?: 'document' | 'rule' | 'at-rule' | 'declaration';
  statementKind?: StatementStarterKind;
  atRuleName?: string;
};

/**
 * Language-specific structural heuristics.
 *
 * Profiles classify spans for the scanner-first parser without owning parsing
 * or materialization; service registries decide later which raw islands become
 * full language ASTs.
 *
 * Third-party languages should keep these callbacks cheap and side-effect
 * free. They should return classification data only, leaving AST construction,
 * visitor adapters, and fallback policy to island providers or compiler/plugin
 * layers.
 */
export type LanguageProfile = {
  name: LanguageName;
  variablePrefixes: readonly string[];
  interpolationStarts: readonly string[];
  atRuleClassifiers: Readonly<Record<string, AtRuleKind>>;
  statementStarters: readonly StatementStarter[];
  classifyAtRule(name: string): AtRuleKind;
  classifyDeclarationName(source: SourceText, range: SourceSpan): DeclarationNameKind;
  classifyRuleHeader(source: SourceText, range: SourceSpan): RuleHeaderKind;
  classifyIsland(
    source: SourceText,
    range: SourceSpan,
    context?: IslandClassificationContext
  ): readonly IslandKind[];
};
