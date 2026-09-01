/**
 * Functional Less host-mode grammar.
 *
 * CSS base: ../../../css/css-parser/src/grammar.ts
 *
 * Less extends CSS and adds or overrides only:
 * - Language-specific features: @variables, property variables, detached
 *   rulesets, mixins, guards, loops, plugin/import options, escaped strings,
 *   and inline :extend(...). Extends are collected while parsing selectors
 *   because reparsing selectors to discover them loses source ownership.
 * - Expanded CSS shapes: dynamic/interpolated values, selectors, property
 *   names, imports, and media/query terms where Less permits runtime data.
 * - Less-specific placement: block and at-rule ordering/nesting deviations
 *   that are documented Less behavior rather than generic CSS structure.
 * Unchanged CSS productions remain CSS-owned; an override changes the smallest
 * child, value slot, or reference that Less syntax actually changes.
 *
 * Its structural `node(parser)` entries are consumed by the CST runner or by
 * parser-local AST reductions; core supplies neither a parse host nor a
 * parse entry.
 */
import {
  attempt, rules, classifiedTrivia, compose,
  node, regex, literal, sequence, choice, many, oneOrMore, oneOrMoreSep, optional,
  not, scanTo, balanced, parser, noTrivia, label, word, keywords, field, leaf, peek,
  dispatch, endsWith, makeWhen, makeWord, matches, otherwise, routed, token, transform, when
} from 'parseman' with { type: 'macro' };
import type { Combinator, FieldCapture, FieldMap, Span } from 'parseman';
import { lessSyntax } from '@jesscss/parser-shared/recognition';
import { cssPseudoSyntax } from '@jesscss/parser-shared/pseudo-consts';
import { cssBaseRules } from '@jesscss/css-parser/grammar';
import { NO_SPAN, any, atRuleBlock, atRuleStatement, block, bodySpanFromRaw, callArg, selectorBranchCanonical, selectorBranchOf, condition, decl, classifyValueBlock, dimension, expression, forNode, funcCall, important, importIsCompileTime, interpolation, interpolatedSimpleSelector, isForBinding, isSpannedToken, isToken, keyword, list, mixinCall, mixinDef, opaqueAtRuleBlock, operation, ifNode, ifValue, propertyReference, pseudoSelector, quoted, reference, relativeSelector, selectorCapture, selectorTermOf, semanticGapText, styleImport, stylesheet, rule, selist, simpleSelector, sourceSpanOf, spaced, url, variableDeclaration, variableReference, valueLayoutOf, withBlockBody, withBodySpan, withImportSourceSpan, withImportTailStart, withSourceSpan, withValueLayout } from '@jesscss/core/ast';
import type { SourceSpan, SpannedToken, Token, AnonymousMixin, Any, AtRuleBlock, AtRuleStatement, CallArg, Combinator as SelectorCombinator, ComplexSelector, Declaration, ExtendInstruction, For, ForBinding, Expression, FunctionCall, If, IfBranch, IfValueBranch, Block, Important, Interpolation, Keyword, List, Lookup, MixinCall, MixinDefinition, OpaqueAtRuleBlock, Param, Plugin, Quoted, Reference, ReferenceStep, SelectorBranch, SelectorCapture, SelectorTerm, Stylesheet, Ruleset, SelectorList, SimpleSelector, SimpleToken, Statement, StyleImport, Url, ValueNode, ValueSlot, VariableDeclaration } from '@jesscss/core/ast';
import { requireLessParseState } from './parse-state.js';
import { LessBareVariableInterpolationError, LessDynamicCharsetError, LessImportPostludeError, LessInlineJavaScriptError, LessUnparenthesizedMixinGuardError, LessUnsupportedMixinNameError, LessUnsupportedVariableNameError } from './parse-error.js';
import {
  appendInterpolationLiteral,
  argumentFunctionFromChildren,
  lessBranchSegments,
  callArgumentSource,
  combinatorTailReducer,
  commaListWithTriviaFromChildren,
  complexSegmentsFrom,
  customPartsFromChildren,
  customValueFromParts,
  enclosedInterpolationFromChildren,
  foldFunctionCondition,
  foldMixinGuards,
  lessFoldOperation,
  functionCallFromChildren,
  functionConditionSource,
  functionNameFromOpener,
  guardOperatorText,
  hasRulesetTerminator,
  interpolationFactFromChildren,
  interpolationPartsFrom,
  isAny,
  isAttributeNameFact,
  isBareMixinCallFact,
  isBodyExtendFact,
  isComplexTailFact,
  isLessDeclaration,
  isDefaultGuardCall,
  isExtendTargetFact,
  isFunctionCall,
  isFunctionConditionFact,
  isInterp,
  isInterpolationFact,
  isLessCallArg,
  isLessEachCallback,
  isMixinCall,
  isMixinCallArgument,
  isMixinCallFact,
  isMixinDefinitionFact,
  isMixinGuard,
  isMixinPathTail,
  isMixinReferenceBaseFact,
  isPropRef,
  isQuoted,
  isReference,
  isReferenceTailFact,
  isRuleset,
  isRulesetTailFact,
  isLessSelectorBranch,
  isSelectorBranchFact,
  isLessSelectorList,
  isSelectorTerm,
  isSequence,
  isSimpleSelector,
  isLessSimpleToken,
  isSlashBoundaryFact,
  isStatement,
  isLessTerminalText,
  isUrl,
  isValueNode,
  isLessValueSlotValue,
  isVarIndirect,
  isVarRef,
  keywordOrValue,
  lessGuardTruth,
  lessMathOutsideParens,
  lessTruth,
  lowerLogicalCallStatement,
  mixinArgumentSource,
  mixinArgumentsFromChildren,
  mixinCallArgsFromInterior,
  mixinCallFromSelectorBranch,
  mixinDefinitionNameFromSelectorBranch,
  mixinParamsFromInterior,
  queryClauseReducer,
  lessQueryComparisonOperators,
  referenceWithTails,
  requireCallbackStatements,
  requireCombinator,
  requireField,
  requireFields,
  requireInterpolationAccessorFact,
  requireInterpolationFact,
  requireKeyword,
  requireMixinCallArgumentValue,
  requireMixinInteriorItem,
  requireMixinReferenceBaseFact,
  requireRulesetBody,
  requireSelectorList,
  requireSelectorListWithExtendsFact,
  requireStatementArray,
  requireString,
  requireSupportedVariableName,
  requireTerminalText,
  requireToken,
  requireValueBlockBody,
  requireValueNode,
  requireValueSlot,
  requiredTokenStart,
  selectorBranchesFrom,
  lessSelectorTermFromTokens,
  spacedFromValueChildren,
  staticNonSelectorPseudoFrom,
  staticSelectorPseudoFrom,
  staticText,
  staticTextWithTriviaGaps,
  valuePieceReducerWithTrivia,
  lessValueSlot,
  variableNameText,
  variableValueSlot,
  withoutBareMath
} from './grammar-helpers.js';
import type {
  AttributeMatchFact,
  AttributeNameFact,
  BodyExtendFact,
  CustomValuePart,
  EnclosedNameFact,
  ExtendTargetFact,
  FunctionConditionFact,
  InterpolationAccessorFact,
  InterpolationFact,
  LessCallArg,
  LessEachCallback,
  MixinCallArgument,
  MixinGuard,
  MixinInteriorFact,
  ReferenceTailFact,
  SelectorBranchFact
} from './grammar-helpers.js';

// ---------------------------------------------------------------------------
// Grammar — Less host-mode grammar.
// ---------------------------------------------------------------------------

/** A `Lookup` whose target is named literally — the `@name` / `$prop` shapes. */

/** Rules this file defines; macro-fused recognition inputs are not local output. */
type LessRules = {
  Stylesheet: Combinator<Stylesheet>;
  Document: Combinator<Stylesheet>;
  VarDeclaration: Combinator<VariableDeclaration>;
  ImportStatement: Combinator<StyleImport | AtRuleStatement>;
  PluginDirective: Combinator<Plugin>;
  ValueBlockDeclaration: Combinator<VariableDeclaration>;
  ValueBlock: Combinator<ValueNode>;
  IndirectVariableReference: Combinator<Lookup>;
  VariableReferenceChain: Combinator<ValueNode>;
  VariableReference: Combinator<Lookup>;
  PropertyReference: Combinator<ValueNode>;
  VariableInterpolation: Combinator<InterpolationFact>;
  PropertyInterpolation: Combinator<InterpolationFact>;
  Interpolation: Combinator<InterpolationFact>;
  AtRuleInterpolation: Combinator<Interpolation>;
  InterpolationAccessor: Combinator<InterpolationAccessorFact>;
  ReferenceTail: Combinator<ReferenceTailFact>;
  InterpolatedValue: Combinator<Interpolation>;
  InterpolatedProperty: Combinator<Interpolation>;
  Keyword: Combinator<ValueNode>;
  Percentage: Combinator<string>;
  Dimension: Combinator<ValueNode>;
  EscapeValue: Combinator<Any>;
  PagePseudo: Combinator<Any>;
  DoubledQuoteArgument: Combinator<Any>;
  FunctionArgument: Combinator<ValueSlot | LessCallArg>;
  FunctionScalarArgument: Combinator<ValueNode>;
  FunctionAssignmentArgument: Combinator<ValueNode>;
  FunctionKeywordArgument: Combinator<LessCallArg>;
  ArgumentValueSequence: Combinator<ValueSlot>;
  FunctionCondition: Combinator<ValueNode>;
  FunctionConditionOr: Combinator<FunctionConditionFact>;
  FunctionConditionAnd: Combinator<FunctionConditionFact>;
  FunctionConditionTerm: Combinator<FunctionConditionFact>;
  FunctionConditionOperand: Combinator<ValueNode>;
  FunctionConditionParen: Combinator<FunctionConditionFact>;
  Call: Combinator<ValueNode>;
  CallArgumentFunction: Combinator<FunctionCall>;
  FormatFunction: Combinator<ValueNode>;
  CallArgumentValue: Combinator<MixinCallArgument['value']>;
  FunctionStatement: Combinator<Statement | string>;
  Value: Combinator<ValueNode>;
  SelectorCapture: Combinator<SelectorCapture>;
  MathAtom: Combinator<ValueNode>;
  MathUnary: Combinator<ValueNode>;
  MathProduct: Combinator<ValueNode>;
  MathSum: Combinator<ValueNode>;
  TopProduct: Combinator<ValueNode>;
  TopSum: Combinator<ValueNode>;
  PreservedDivision: Combinator<ValueNode>;
  EscapedParen: Combinator<ValueNode>;
  Paren: Combinator<ValueNode>;
  ValueSequence: Combinator<ValueSlot>;
  ValueList: Combinator<ValueSlot>;
  VariableValue: Combinator<ValueSlot>;
  ImportantValue: Combinator<Important>;
  ValueListWithPriority: Combinator<ValueSlot>;
  CustomPropertyName: Combinator<string | Interpolation>;
  CustomAtKeywordText: Combinator<string>;
  CustomPart: Combinator<CustomValuePart>;
  CustomInnerPart: Combinator<CustomValuePart>;
  CustomGroup: Combinator<readonly CustomValuePart[]>;
  CustomValue: Combinator<ValueNode>;
  CustomPropertyValue: Combinator<Keyword>;
  CustomDeclaration: Combinator<Declaration>;
  Declaration: Combinator<Declaration>;
  ClassIdStatement: Combinator<Statement>;
  MixinArgumentGroup: Combinator<MixinCallArgument>;
  MixinArguments: Combinator<readonly MixinCallArgument[]>;
  MixinInterior: Combinator<MixinInteriorFact>;
  ClassIdSelectorPrefix: Combinator<SelectorBranchFact>;
  SelectorBranchTail: Combinator<SelectorBranchFact>;
  FlatMixinCall: Combinator<MixinCall>;
  NamespacedMixinCall: Combinator<MixinCall>;
  NamespacedMixinValue: Combinator<MixinCall>;
  MixinReference: Combinator<Reference>;
  ReferenceCall: Combinator<Reference>;
  MixinGuard: Combinator<MixinGuard>;
  MixinGuardTopOr: Combinator<MixinGuard>;
  MixinGuardTopAnd: Combinator<MixinGuard>;
  MixinGuardTopTerm: Combinator<MixinGuard>;
  MixinGuardOr: Combinator<MixinGuard>;
  MixinGuardAnd: Combinator<MixinGuard>;
  MixinGuardTerm: Combinator<MixinGuard>;
  MixinGuardOperand: Combinator<ValueNode>;
  EachName: Combinator<string>;
  /** A complete Less statement body, shared by detached rulesets and `each()` callbacks. */
  BodyStatement: Combinator<Statement | string>;
  EachCallback: Combinator<LessEachCallback>;
  EachFunctionStatement: Combinator<For>;
  SupportsValue: Combinator<ValueNode>;
  SupportsFeature: Combinator<ValueNode>;
  SupportsInParens: Combinator<ValueNode>;
  SupportsCondition: Combinator<ValueNode>;
  EnclosedContent: Combinator<Interpolation>;
  EnclosedGroup: Combinator<Interpolation>;
  EnclosedQuoted: Combinator<Interpolation>;
  EnclosedFunctionName: Combinator<EnclosedNameFact>;
  Enclosed: Combinator<FunctionCall | Block>;
  SupportsBlock: Combinator<AtRuleBlock>;
  QueryValue: Combinator<ValueNode>;
  QueryColonFeature: Combinator<ValueNode>;
  /** A feature value, folding an authored `<ratio>` slash into one Operation. */
  QueryFeatureValue: Combinator<ValueNode>;
  /** A query keyword that is not the `only` modifier. */
  QueryNonOnlyKeyword: Combinator<Keyword>;
  /** One term of a query clause. */
  QueryTerm: Combinator<ValueNode>;
  /** One term of a media query clause, admitting Less interpolation. */
  MediaQueryTerm: Combinator<ValueNode>;
  QueryFeature: Combinator<ValueNode>;
  QueryClause: Combinator<ValueNode>;
  ContainerStyleQuery: Combinator<FunctionCall>;
  ContainerScrollStateQuery: Combinator<FunctionCall>;
  ContainerName: Combinator<Keyword>;
  ContainerQueryAtom: Combinator<ValueNode>;
  ContainerCondition: Combinator<ValueNode>;
  MediaContainerBody: Combinator<readonly Statement[]>;
  MediaContainerBlock: Combinator<AtRuleBlock>;
  KeyframeSelector: Combinator<SimpleSelector>;
  KeyframeBlock: Combinator<Ruleset>;
  Keyframes: Combinator<AtRuleBlock>;
  DottedAtRuleKeyword: Combinator<ValueNode>;
  AtRulePreludeValueAtom: Combinator<ValueNode>;
  AtRulePreludeValueTerm: Combinator<ValueNode>;
  AtRulePreludeValue: Combinator<ValueNode>;
  AtRulePrelude: Combinator<ValueNode | null>;
  NamespacePrelude: Combinator<ValueNode>;
  AtRuleBlock: Combinator<AtRuleBlock>;
  OpaqueAtPrelude: Combinator<string | null>;
  OpaqueBody: Combinator<string>;
  AtRuleName: Combinator<string>;
  CustomValueAtKeyword: Combinator<string>;
  StaticAtRuleStatementName: Combinator<string>;
  OpaqueAtRuleBlock: Combinator<OpaqueAtRuleBlock>;
  AtRuleStatement: Combinator<AtRuleStatement>;
  PseudoSelector: Combinator<SimpleToken>;
  InterpolatedPseudo: Combinator<SimpleSelector>;
  InterpolatedNthPseudo: Combinator<SimpleSelector>;
  InterpolatedArgumentPseudo: Combinator<SimpleSelector>;
  NthPseudoSelector: Combinator<SimpleSelector>;
  NthPseudoArgument: Combinator<string>;
  PseudoArgumentText: Combinator<string>;
  PseudoArgumentGroup: Combinator<string>;
  PseudoArgumentCompound: Combinator<SelectorTerm>;
  PseudoArgumentComplex: Combinator<SelectorBranch>;
  PseudoArgumentSelectorTail: Combinator<SelectorBranch>;
  PseudoArgumentSelector: Combinator<SelectorList>;
  AttributeNamespace: Combinator<string>;
  NamespaceTypeSelector: Combinator<SimpleSelector>;
  AttributeName: Combinator<AttributeNameFact>;
  AttributeMatch: Combinator<AttributeMatchFact>;
  AttributeSelector: Combinator<SimpleSelector>;
  InterpolatedAttributeToken: Combinator<Interpolation>;
  InterpolatedAttributeValueToken: Combinator<Interpolation>;
  InterpolatedAttributeQuoted: Combinator<Interpolation>;
  InterpolatedAttributeSelector: Combinator<SimpleSelector>;
  InterpolatedSimpleSelector: Combinator<SimpleSelector>;
  BareInterpolatedSelector: Combinator<SimpleSelector>;
  AdjacentInterpolatedSelector: Combinator<SimpleSelector>;
  BareInterpolatedSelectorWithSuffix: Combinator<SimpleSelector>;
  InterpolatedParentSuffix: Combinator<SimpleSelector>;
  CompoundSelector: Combinator<SelectorTerm>;
  ComplexSelector: Combinator<SelectorBranch>;
  RelativeComplex: Combinator<SelectorBranch>;
  SelectorList: Combinator<SelectorList>;
  ExtendTarget: Combinator<ExtendTargetFact>;
  ExtendStatement: Combinator<BodyExtendFact>;
  RulesetWithExtends: Combinator<Ruleset>;
  NestedRulesetWithExtends: Combinator<Ruleset>;
  Quoted: Combinator<Quoted | Interpolation>;
  LiteralQuoted: Combinator<Quoted>;
  EscapedQuoted: Combinator<Quoted | Interpolation>;
  PlainUrl: Combinator<Url>;
  UrlInterpolation: Combinator<Interpolation>;
  VariableUrl: Combinator<Url>;
  ImportOption: Combinator<Any>;
  ImportOptions: Combinator<List>;
  ImportTarget: Combinator<Quoted | Url | Interpolation>;
  ImportTail: Combinator<unknown>;
  ImportTailText: Combinator<unknown>;
  ImportTailGroup: Combinator<unknown>;
  ImportTailParen: Combinator<unknown>;
  whitespace: Combinator<unknown>;
  blockBody: Combinator<unknown>;
  BareVariableInterpolation: Combinator<unknown>;
  valuePiece: Combinator<unknown>;
  pseudoArgumentInner: Combinator<unknown>;
  queryLeaf: Combinator<unknown>;
  interpolatedValueTail: Combinator<unknown>;
  GenericFunction: Combinator<unknown>;
  CalcFunction: Combinator<unknown>;
  FunctionArguments: Combinator<unknown>;
};

/** Macro-fused shared recognition plus this file's recursively defined outputs. */
type LessInputRules = LessRules & typeof lessSyntax;

type SharedSyntax = {
  AttributeModifier: Combinator<unknown>;
  AttributeOperator: Combinator<unknown>;
  HexColor: Combinator<string>;
  // Converged to the CSS base (inherited via compose): shared HexColor token,
  // reducer differs only requireToken().value vs tokenText() over one token.
  Color: Combinator<ValueNode>;
  UnicodeRangeToken: Combinator<string>;
  // Converged to the CSS base (inherited via compose): same named
  // UnicodeRangeToken; reducer differs only requireToken().value vs tokenText().
  UnicodeRange: Combinator<Any>;
  NthExpression: Combinator<unknown>;
  NthChildPseudoSelectorName: Combinator<string>;
  NthTypePseudoSelectorName: Combinator<string>;
  NthPseudoSelectorName: Combinator<string>;
  NthOfKeyword: Combinator<string>;
  NumberToken: Combinator<string>;
  DimensionUnit: Combinator<string>;
  InterpolatedPropertyStart: Combinator<unknown>;
  InterpolatedPropertyTail: Combinator<unknown>;
  Identifier: Combinator<string>;
  SupportsAtKeyword: Combinator<unknown>;
  KeyframesAtKeyword: Combinator<unknown>;
  MediaContainerAtKeyword: Combinator<unknown>;
  MediaAtKeyword: Combinator<unknown>;
  ContainerAtKeyword: Combinator<unknown>;
  QueryNot: Combinator<unknown>;
  QueryOnly: Combinator<unknown>;
  QueryAndOr: Combinator<unknown>;
  QueryComparisonOperator: Combinator<unknown>;
  QueryFunctionName: Combinator<unknown>;
  ImportantToken: Combinator<unknown>;
  BlockCommentToken: Combinator<unknown>;
};

const lineComment = regex(/\/\/[^\n\r]*/);
const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
/*
 * Parseman trivia labels belong to terminal identity. This dedicated terminal
 * keeps custom-value comments classed as `blockComment` in the root index rather
 * than inheriting the generic whitespace label of the shared scanner terminal.
 */
const customValueBlockCommentRun = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const whitespaceRun = regex(/[ \t\n\r\f]+/);

// Less comments are trivia. Line comments must not become renderable CSS
// comments; block comments may still make an otherwise empty ruleset renderable
// through body-span trivia, not through a `Comment` statement node.
// URL bodies explicitly disable trivia below, so `url(//host/path)` remains
// URL content rather than a comment.
const whitespace = classifiedTrivia({
  whitespace: whitespaceRun,
  lineComment,
  blockComment
});
const selectorAttributeModifierSpace = regex(/[ \t\n\r\f]+/);
const importKeyword = keywords(
  ['@-import', '@import'],
  { caseInsensitive: true, boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF' }
);
/* `customValueAtKeyword` is now the composed `g.CustomValueAtKeyword` rule. */
// Opaque quoted-string skippers for the grammar-level ambient `scanSkip`.
// `scanTo`/`balanced` with no per-call skip consults these so a delimiter hidden
// inside a string is never matched. Consumes quote-to-quote including escapes;
// used only as a scan hole, so it builds nothing.
const scanSkipDoubleString = noTrivia(sequence(literal('"'), regex(/(?:[^"\\]|\\.)*/), literal('"')));
const scanSkipSingleString = noTrivia(sequence(literal('\''), regex(/(?:[^'\\]|\\.)*/), literal('\'')));
const lessOpaqueBodyBrace = balanced(
  '{',
  '}'
);
const lessOpaqueBodyCapture = noTrivia(scanTo(
  literal('}'),
  { skip: [lessOpaqueBodyBrace] }
));
// Trivia that may surround an UNAMBIGUOUS product operator (`*`/`/`/`%`):
// whitespace, `//` line comments, or `/* */` block comments. This matches CSS,
// where `*` and `/` need no whitespace and comments are freely allowed around
// them (`1/**/*/**/2`, `1 // c\n * 2`). It is deliberately NOT used by the sum
// terminal: `+`/`-` are sign-ambiguous, so — like CSS `calc()` — they require
// real whitespace and comments do NOT count (see `sumOperator`). In
// operator position this trivia is a separator the arithmetic consumes; a comment
// in value-LIST position (`1 /* c */ 2`, no operator char follows) makes the
// operator loop backtrack and is left as preserved value syntax.
const mathTrivia = classifiedTrivia({
  whitespace: whitespaceRun,
  lineComment,
  blockComment
});
// Function argument comments are trivia. Block comments stay out of the value
// AST and are replayed through the call argument ValueLayout when they sit on an
// argument boundary.
const functionTrivia = classifiedTrivia({
  whitespace: whitespaceRun,
  lineComment,
  blockComment
});
// Mixin signatures and guards are invisible definition syntax. Unlike an
// ordinary declaration value, a block comment at one of their token boundaries
// is lexical trivia (the legacy MixinArgs production used the same rule). The
// signature scope still needs the normal classified trivia: it spans a
// continuation which may contain a block body, so collapsing comments into a
// synthetic `whitespace` label here would hide them from selected root capture.
const mixinSignatureGap = regex(/(?:(?:[ \t\n\r\f]+)|(?:\/\/[^\n\r]*)|(?:\/\*(?:[^*]|\*(?!\/))*\*\/))+/);
const mixinGuardGap = regex(/(?:(?:[ \t\n\r\f]+)|(?:\/\/[^\n\r]*)|(?:\/\*(?:[^*]|\*(?!\/))*\*\/))+/);
const mixinSignatureTrivia = whitespace;
const mixinGuardTrivia = classifiedTrivia({ whitespace: mixinGuardGap });
// Selector grammar components used inside functional pseudos retain their
// established lexical-comment behavior.
const staticSelectorTrivia = classifiedTrivia({
  whitespace: whitespaceRun,
  lineComment,
  blockComment
});
const compoundSelectorTrivia = classifiedTrivia({
  lineComment,
  blockComment
});
const atPreludeCommentTrivia = classifiedTrivia({ blockComment });
const customValueCommentTrivia = classifiedTrivia({ blockComment: customValueBlockCommentRun });
// Outer selector comments are lexical trivia. Render-time body/source spans own
// whether a trivia-only body remains output-bearing; selectors do not invent
// comment simple selectors.
const outerSelectorTrivia = classifiedTrivia({
  whitespace: whitespaceRun,
  lineComment,
  blockComment
});
const staticSimpleSelector = regex(/(?:[.#]?-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\*)/);
const staticIdentifier = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
// A selector simple that contains Less interpolation stays one selector atom.
// Its literal runs deliberately exclude `.`, `#`, `[`, `:`, whitespace, and
// combinators: those have separate selector grammar roles and must not be
// flattened into an interpolation template.
const interpolatedSelectorPrefix = regex(/[.#](?:-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*)?/);
const interpolatedSelectorTail = regex(/(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);
// A bare `@{name}` is a whole-selector interpolation only. Keeping the
// delimiter lookahead here prevents it from consuming the interpolation prefix
// of an unmodelled namespace/attribute selector such as `@{ns}|a`.
const bareInterpolatedSelectorEnd = regex(/(?=[ \t\n\r\f]*(?:[,{]))/);
// Semantically identical to the production Less `ampToken` terminal. A static ampersand
// is already the canonical AST representation: `SimpleSelector.text` retains `&` and
// core's selector path identifies parent references from that text.  The
// parenthesized and interpolation forms stay outside this static slice
// until their typed semantic payloads are constructed by grammar reductions.
const staticAmpersand = regex(/&[-_a-zA-Z0-9\u0080-\uffff]*/);
const keyframeEndpoint = keywords(
  ['from', 'to'],
  { caseInsensitive: true, boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF' }
);
// Ordered longest-first, identical to the production Less `combinator`
// terminal. A missing authored token between compounds is the canonical
// descendant relation; grammar trivia provides the separating whitespace.
const staticCombinator = keywords(['||', '>', '+', '~', '|']);
// A leading `|` belongs to namespace selector syntax (`|a`), not a relative
// selector. Keep relative starts to the Less nested-selector combinators.
const relativeSelectorCombinator = keywords(['>', '+', '~']);
const pseudoDelimiter = keywords(['::', ':']);
const commaOrSemicolon = keywords([',', ';']);
const eachCallbackSigil = keywords(['.', '#']);
// The production Less `urlInner` terminal, narrowed only at a dynamic Less
// opener. A leading `@name` / `@{…}` belongs to the unimplemented Reference /
// interpolation path, so this static slice rejects it instead of
// misrepresenting it as `Any`. Other URL-token escapes and control boundaries
// remain the production terminal exactly.
const staticUrlText = regex(/(?!@(?:-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*|\{))(?:[^"'()\\ \t\n\f\r\x00-\x08\x0B\x0E-\x1F\x7F]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/);
// Less accepts formatting whitespace in an unquoted data URL and preserves it
// in the URL payload (for example, a wrapped base64 body). CSS's shared
// unquoted URL terminal remains strict: this is a Less-only Parseman leaf.
// Keep the production URL exclusions intact—quotes, unescaped parentheses,
// controls, and malformed escapes never become opaque URL text.
const staticDataUrlText = regex(/data:(?:[^"'()\\\x00-\x08\x0B\x0E-\x1F\x7F]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+?(?=[ \t\n\r\f]*\))/i);
// URL-edge whitespace is deliberately not the Less `whitespace` production:
// that production also recognizes `//` comments, while `url(//cdn.example)`
// is an ordinary URL payload.
const urlBoundaryWhitespace = regex(/[ \t\n\r\f]+/);
const urlFunctionOpen = token(noTrivia(regex(/url\(/i)));
const staticTailText = regex(/[^()\[\]{};@'"]+/);
const importOption = keywords(
  ['reference', 'optional', 'once', 'multiple', 'inline', 'css', 'less'],
  { caseInsensitive: true, boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF' }
);
const inlineJavaScriptBody = regex(/(?:[^`\\]|\\[\s\S])*/);
// Math productions run under `noTrivia`, so their operators own precisely the
// gap that distinguishes arithmetic from a Less space-list. `leaf()` keeps the
// comment-aware structural gap hidden from `lessFoldOperation`: it receives the
// same flat `*`/`/`/`%` terminal stream it did before, with no scanner or
// post-parse text recovery. Keep the sum terminal below unchanged: its glued
// numeric-sign lookahead is intentional Less syntax, not an operator gap.
const productOperator = leaf(
  noTrivia(sequence(optional(mathTrivia), keywords(['*', '/', '%']), optional(mathTrivia))),
  children => children[1] as string
);
const topProductOperator = leaf(
  noTrivia(sequence(optional(mathTrivia), keywords(['*', '%']), optional(mathTrivia))),
  children => children[1] as string
);
// A preserved top-level Less slash is not arithmetic in parens-division mode,
// but authored whitespace around `/` is still part of that opaque value. Keep
// the boundary explicit so `10px / 2` does not flatten into a plain ValueSlot
// array before the evaluator can apply the math-mode rule.
const preservedSlashGap = regex(/[ \t\n\r\f]+/);
const preservedSlashBoundary = leaf(
  sequence(
    optional(preservedSlashGap),
    literal('/'),
    optional(preservedSlashGap)
  ),
  (children) => {
    if (!Array.isArray(children)) {
      throw new TypeError('Less slash boundary produced a non-sequence value.');
    }
    return {
      before: staticText(children[0]),
      after: staticText(children[2])
    };
  }
);
/*
 * `+`/`-` are ambiguous between a binary operator and a leading sign, so the
 * operand must be SEPARATED from the operator for this to be arithmetic: `1 - 2`
 * subtracts, `1 -2` is a space list whose second item is the signed dimension.
 * Less additionally treats the fully glued `1-2` as arithmetic.
 *
 * What separates them is the DIALECT'S trivia, not a local spelling of it. This
 * used to hand-spell the pad as `comment* ws+ (comment ws*)*`, which is a second,
 * private definition of the trivia table inside one expression production
 * (DESIGN-DECISIONS G24) — and it drifted from the table in a way that was
 * visible in emitted CSS: because the pad REQUIRED a whitespace run, a comment
 * standing alone as the separator did not count, so `1px/**\/-/**\/2px` performed
 * no arithmetic and the comment bytes were emitted verbatim as value content.
 * `mathTrivia` is the same `classifiedTrivia` the `*`/`/`/`%` product operators
 * above already use, and `classifiedTrivia` is one-or-more by construction, so
 * naming it bare (rather than under `optional()`) IS the "must be separated"
 * assertion. css-syntax-3 §4 makes a comment trivia wherever whitespace is, so
 * both Less comment forms now count, exactly as the document trivia table says.
 *
 * The separation is required on BOTH sides, which is what keeps `1 -2` a list:
 * there is a pad before the `-` and none after it, so this arm cannot match and
 * the glued arms below reject it on their `(?![0-9.])` guard. That guard is why
 * the pad may not be relaxed to one side — a comment defeats it, since in
 * `1/**\/-2px` the lookahead sees `/` rather than the digit actually there.
 *
 * The three arms remain separated-both-sides | glued-to-number | asymmetric
 * reject guard. This one is a `leaf()` for the same reason the product operators
 * are: the leaf's value is exactly the sign, so `lessFoldOperation` still reads a
 * flat operator stream and no CST arity moves. Folding the pad into the operator
 * terminal instead would leave the reducer recovering the sign with `.trim()`
 * from bytes that can now hold a comment's own `/` and `*` — the parser handing
 * core a value to re-parse.
 */
const sumOperatorSpaced = leaf(
  noTrivia(sequence(mathTrivia, keywords(['-', '+']), mathTrivia)),
  children => children[1] as string
);
const sumOperatorGlued = regex(/[-+](?=[0-9.])|[ \t\n\r\f]*[-+](?![0-9.])[ \t\n\r\f]*/);
const sumOperator = choice(sumOperatorSpaced, sumOperatorGlued);
// Generic Less at-rule names are grammar terminals. This grammar keeps
// their prelude/body semantic only where the existing canonical AST has a
// truthful structured representation; it never captures a block as text.
// Imports are typed facts with stricter target validation. Excluding their names
// here prevents a malformed import from falling through as a generic at-rule.
const charsetAtRuleName = word(
  '@charset',
  '-_a-zA-Z0-9\\u0080-\\uFFFF',
  { caseInsensitive: true }
);
const layerAtRuleName = word(
  '@layer',
  '-_a-zA-Z0-9\\u0080-\\uFFFF',
  { caseInsensitive: true }
);
/*
 * The Less-only compiler-namespace at-rule names, declared ONCE. The CSS names
 * this must also exclude (@import, @layer, @media/@container/@supports,
 * @keyframes) are NOT re-spelled: `AtRuleName` below inverts cssSyntax's own
 * leaves for them, so the two polarities cannot drift apart and the
 * css-syntax-3 §4.3.11 boundary is inherited rather than re-typed.
 */
const lessOwnAtKeyword = keywords(
  ['@-import', '@-export'],
  { caseInsensitive: true, boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF' }
);
/* `staticAtRuleStatementName` is now the composed `g.StaticAtRuleStatementName` rule. */
const mixinName = regex(/[.#]-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/);
const mixinPathCombinator = regex(/>/);
const mixinGuardOperator = regex(/>=|<=|=>|=<|=~|[<>=]/);
const functionConditionStop = regex(/[ \t\n\r\f]*(?:>=|<=|=>|=<|=~|[<>=]|(?:and|or)(?![-_a-zA-Z0-9\u0080-\uffff]))/i);
const functionConditionOperator = regex(/[ \t\n\r\f]*(?:>=|<=|=>|=<|=~|[<>=])[ \t\n\r\f]*/);
const functionConditionAnd = regex(/[ \t\n\r\f]*and(?![-_a-zA-Z0-9\u0080-\uffff])[ \t\n\r\f]*/i);
const functionConditionOr = regex(/[ \t\n\r\f]*or(?![-_a-zA-Z0-9\u0080-\uffff])[ \t\n\r\f]*/i);
const functionConditionNot = word(
  'not',
  '-_a-zA-Z0-9\\u0080-\\uFFFF',
  { caseInsensitive: true }
);
// A non-selector functional pseudo is still one canonical SimpleSelector leaf.
// A pseudo body cannot quietly turn a Less variable read into static bytes.
// Keep only `@` that cannot start `@{...}`, `@@name`, or `@name`; nested
// delimiters, quoted strings, and comments are reduced below rather than
// recovered from source after recognition.
const staticPseudoChunk = regex(/(?:[^()\[\]'"@/]|@(?![@{_a-zA-Z\u0080-\uffff-])|\/(?!\*))+/);
// General-enclosed content is a raw template assembled by Parseman: structural
// delimiters, strings, comments, and `@{…}` each have their own grammar arm.
// This terminal owns only the remaining literal bytes; no completed source span
// is scanned or re-parsed after recognition.
const enclosedText = regex(/(?:\\[\s\S]|\/(?!\*)|@(?!\{)|[^\\/'"@()[\]{}]+)+/);
const enclosedDoubleChunk = regex(/(?:\\[\s\S]|@(?!\{)|[^"\\@])+/);
const enclosedSingleChunk = regex(/(?:\\[\s\S]|@(?!\{)|[^'\\@])+/);
const lessSupportedVariableName = regex(/[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/);
const lessUnsupportedNumericVariableName = node(
  'UnsupportedVariableName',
  regex(/[0-9][-_a-zA-Z0-9\u0080-\uffff]*/),
  children => ({ unsupportedVariableName: requireToken(children[0]).value })
);
const lessDashVariableName = leaf(
  noTrivia(sequence(literal('-'), optional(regex(/[-_a-zA-Z0-9\u0080-\uffff]+/)))),
  (children) => {
    if (!Array.isArray(children)) {
      throw new TypeError('Less dash variable name lost its grammar facts.');
    }
    const tail = children[1];
    return tail === undefined || tail === null
      ? { unsupportedVariableName: '-' }
      : `-${requireTerminalText(tail)}`;
  }
);
const lessVariableName = choice(lessUnsupportedNumericVariableName, lessSupportedVariableName, lessDashVariableName);

const lessGrammarFactory = (g: LessInputRules & SharedSyntax) => {
  const caseOf = makeWhen({ caseInsensitive: true });
  const lessWord = makeWord('-_a-zA-Z0-9\\u0080-\\uFFFF');
  const lessCaseWord = makeWord('-_a-zA-Z0-9\\u0080-\\uFFFF', { caseInsensitive: true });
  const whenGuardAhead = sequence(optional(regex(/[ \t\n\r\f]+/)), lessCaseWord('when'));
  const mixinGuardDefaultCall = regex(/default[ \t\n\r\f]*\([ \t\n\r\f]*\)(?![-_a-zA-Z0-9\u0080-\uffff])/);
  // `@@name` is a variable reference whose lookup name is the resolved value
  // of `@name`; retain that two-step lookup as a typed AST edge.  The doubled
  // sigil is glued just like the production `nestedRef`, so trivia cannot turn
  // it into two unrelated tokens.
  const IndirectVariableReference = node(
    'Reference',
    noTrivia(sequence(literal('@@'), lessVariableName)),
    (children, _fields, span) => {
      const name = requireSupportedVariableName(children[1], span.start, span.end);
      return withSourceSpan(
        variableReference(variableReference(name, 'scoped'), 'scoped', `@@${name}`),
        span
      );
    }
  );
  const VariableReference = node(
    'Reference',
    sequence(literal('@'), lessVariableName),
    (children, _fields, span) => withSourceSpan(
      variableReference(requireSupportedVariableName(children[1], span.start, span.end), 'scoped'),
      span
    )
  );
  const BareVariableInterpolation = node(
    'BareVariableInterpolation',
    noTrivia(sequence(literal('@'), lessVariableName)),
    (children, _fields, span) => {
      const name = requireSupportedVariableName(children[1], span.start, span.end);
      throw new LessBareVariableInterpolationError(span.start, span.end, name);
    }
  );
  const PropertyReference = node(
    'Reference',
    noTrivia(sequence(literal('$'), g.LessIdentifier)),
    (children, _fields, span) => withSourceSpan(propertyReference(requireToken(children[1]).value), span)
  );
  const InterpolationAccessor = choice(
    // Less `[]` selects the final declaration of a namespace/mixin result.
    // Lower it directly to the established negative-one index contract; the
    // existing Reference evaluator already applies negative indexes from the
    // end of its typed declaration map.
    node(
      'InterpolationLastAccessor',
      noTrivia(literal('[]')),
      (): InterpolationAccessorFact => ({ key: -1, keyKind: 'index', src: '-1' })
    ),
    node(
      'InterpolationIndexAccessor',
      noTrivia(sequence(literal('['), g.InterpolationIndex, literal(']'))),
      (children): InterpolationAccessorFact => {
        const text = requireToken(children[1]).value;
        return { key: Number(text), keyKind: 'index', src: text };
      }
    ),
    // `$@name` is a property-map key selected by the VALUE of `@name`, e.g.
    // `#namespace[$@prop-name]`. Keep both the indirection and the property
    // namespace explicit: the existing resolver evaluates this key, then uses
    // `keyKind: 'prop'` to select the declaration-member map.
    node(
      'InterpolationPropertyVariableAccessor',
      noTrivia(sequence(literal('['), literal('$'), g.VariableReference, literal(']'))),
      (children): InterpolationAccessorFact => {
        const key = requireValueNode(children[2]);
        if (!isVarRef(key)) {
          throw new TypeError('Less property-variable map key must retain its variable reference.');
        }
        return { key, keyKind: 'prop', src: `$@${key.name}` };
      }
    ),
    node(
      'InterpolationReferenceAccessor',
      noTrivia(sequence(literal('['), choice(g.IndirectVariableReference, g.VariableReference, g.PropertyReference, g.InterpolationKey), literal(']'))),
      (children): InterpolationAccessorFact => {
        const key = children[1];
        if (isVarIndirect(key)) {
          const nameRef = key.name;
          if (!isVarRef(nameRef)) {
            throw new TypeError('Less indirect map key must retain its variable reference.');
          }
          return { key, keyKind: 'var', src: `@@${nameRef.name}` };
        }
        if (isVarRef(key)) {
          return { key, keyKind: 'var', src: `@${key.name}` };
        }
        if (isPropRef(key)) {
          return { key, keyKind: 'prop', src: key.raw };
        }
        const text = requireToken(key).value;
        return { key: keyword(text), keyKind: 'prop', src: text };
      }
    )
  );
  // Left-factored `@`+name so the ubiquitous plain `@var` is parsed ONCE: the
  // accessor tails are optional, so a bare variable reference no longer parses
  // `@name`, fails a required tail, backtracks, and re-parses `@name` through a
  // separate plain-reference production. With tails this reduces to the tailed
  // Reference node; without, to the plain VariableReference (identical shapes).
  const VariableReferenceChain = node(
    'Reference',
    noTrivia(sequence(literal('@'), lessVariableName, optional(oneOrMore(g.ReferenceTail)))),
    (children, _fields, span) => {
      const name = requireSupportedVariableName(children[1], span.start, span.end);
      const base = variableReference(name, 'scoped');
      return children.length > 2
        ? withSourceSpan(referenceWithTails(base, `@${name}`, children.slice(2)), span)
        : withSourceSpan(base, span);
    }
  );
  const MixinPathTail = node(
    'MixinPathTail',
    sequence(optional(mixinPathCombinator), mixinName),
    (children) => {
      const combToken = children.find(child => isLessTerminalText(child, '>'));
      return {
        combinator: combToken === undefined ? ' ' : '>',
        selector: requireToken(children.at(-1)).value
      };
    }
  );
  const UnsupportedDashVariableInterpolation = node(
    'UnsupportedVariableName',
    noTrivia(literal('@{-}')),
    (_children, _fields, span) => {
      throw new LessUnsupportedVariableNameError(span.start, span.end, '-');
    }
  );
  const VariableInterpolation = node(
    'VariableInterpolation',
    choice(
      UnsupportedDashVariableInterpolation,
      noTrivia(sequence(literal('@{'), lessVariableName, many(g.InterpolationAccessor), literal('}')))
    ),
    (children, _fields, span) => interpolationFactFromChildren(children, span)
  );
  const PropertyInterpolation = node(
    'PropertyInterpolation',
    noTrivia(sequence(literal('${'), g.InterpolationHead, many(g.InterpolationAccessor), literal('}'))),
    (children, _fields, span) => interpolationFactFromChildren(children, span)
  );
  const Interpolation = node(
    'Interpolation',
    choice(g.VariableInterpolation, g.PropertyInterpolation),
    children => requireInterpolationFact(children[0])
  );
  // A complete Less at-rule header can be deferred through one `@{…}` lookup.
  // Keep that as the existing typed Interpolation value rather than treating a header
  // as raw text; dedicated query/supports reducers still own static structure.
  const AtRuleInterpolation = node(
    'AtRuleInterpolation',
    g.VariableInterpolation,
    (children) => {
      const fact = requireInterpolationFact(children[0]);
      return interpolation([{ ref: fact.ref, unquote: true }]);
    }
  );
  const interpolatedValueTail = choice(g.InterpolatedValueTail, g.Interpolation);
  const InterpolatedValue = node(
    'InterpolatedValue',
    noTrivia(sequence(
      g.Interpolation,
      many(g.interpolatedValueTail)
    )),
    children => interpolation(interpolationPartsFrom(children, true))
  );
  const Quoted = node(
    'Quoted',
    choice(
      noTrivia(sequence(literal('"'), many(choice(g.VariableInterpolation, g.PropertyInterpolation, g.QuotedDoubleText, literal('@'), literal('$'))), literal('"'))),
      noTrivia(sequence(literal('\''), many(choice(g.VariableInterpolation, g.PropertyInterpolation, g.QuotedSingleText, literal('@'), literal('$'))), literal('\'')))
    ),
    (children) => {
      const open = requireToken(children[0]);
      if (!children.some(isInterpolationFact)) {
        const value = children.slice(1, -1).map(requireToken).map(token => token.value).join('');
        return quoted(`${open.value}${value}${open.value}`, value, open.value, false);
      }
      const parts = interpolationPartsFrom(children.slice(1, -1), true, open.value);
      appendInterpolationLiteral(parts, open.value);
      return interpolation(parts);
    }
  );
  // Plain (interpolation-free) single/double-quoted body shared by the quoted
  // value, functional-pseudo, and attribute-selector static grammars.
  const staticQuotedBody = choice(
    noTrivia(sequence(literal('"'), many(choice(g.QuotedDoubleText, sequence(not(noTrivia(literal('@{'))), literal('@')), literal('$'))), literal('"'))),
    noTrivia(sequence(literal('\''), many(choice(g.QuotedSingleText, sequence(not(noTrivia(literal('@{'))), literal('@')), literal('$'))), literal('\'')))
  );
  const LiteralQuoted = node(
    'Quoted',
    staticQuotedBody,
    (children) => {
      const open = requireToken(children[0]);
      const value = children.slice(1, -1).map(requireToken).map(token => token.value).join('');
      return quoted(`${open.value}${value}${open.value}`, value, open.value, false);
    }
  );
  // A non-interpolated Less `~"…"` / `~'…'` is an ordinary quoted value with the
  // existing escaped flag. Its interpolation-bearing form is a structural,
  // unquoted template—never a recovered source string.
  const EscapedQuoted = node(
    'Quoted',
    choice(
      noTrivia(sequence(literal('~"'), many(choice(g.VariableInterpolation, g.PropertyInterpolation, g.QuotedDoubleText, literal('@'), literal('$'))), literal('"'))),
      noTrivia(sequence(literal('~\''), many(choice(g.VariableInterpolation, g.PropertyInterpolation, g.QuotedSingleText, literal('@'), literal('$'))), literal('\'')))
    ),
    (children) => {
      const opener = requireToken(children[0]).value;
      const quote = opener[1];
      if (quote !== '"' && quote !== '\'') {
        throw new TypeError('Less escaped quote lost its quote delimiter.');
      }
      if (children.some(isInterpolationFact)) {
        return interpolation(interpolationPartsFrom(children.slice(1, -1), true));
      }
      const value = children.slice(1, -1).map(requireToken).map(token => token.value).join('');
      return quoted(`${opener}${value}${quote}`, value, quote, true);
    }
  );
  const PlainUrl = node(
    'Url',
    noTrivia(sequence(
      urlFunctionOpen,
      optional(urlBoundaryWhitespace),
      optional(field('body', choice(g.EscapedQuoted, g.Quoted, staticDataUrlText, staticUrlText))),
      optional(urlBoundaryWhitespace),
      literal(')')
    )),
    (_children, fields) => {
      const captured = fields?.body;
      if (Array.isArray(captured)) {
        throw new TypeError('Less plain URL produced repeated body facts.');
      }
      const body = captured?.value;
      if (body === undefined) {
        return url(any(''));
      }
      if (isQuoted(body) || isInterp(body)) {
        return url(body);
      }
      return url(any(requireTerminalText(body)));
    }
  );
  // Bare `@name` and `@{name}` URL bodies are structural Less values, not
  // opaque URL text. The interpolation branch retains its literal suffixes as
  // `Interpolation` parts, so neither form needs a source scan or a value re-parser.
  const UrlInterpolation = node(
    'UrlInterpolation',
    noTrivia(choice(
      sequence(g.VariableReference, oneOrMore(choice(staticUrlText, g.Interpolation))),
      sequence(g.Interpolation, many(choice(staticUrlText, g.Interpolation)))
    )),
    children => interpolation(interpolationPartsFrom(children, true))
  );
  const VariableUrl = node(
    'Url',
    sequence(urlFunctionOpen, choice(g.UrlInterpolation, g.VariableReference), literal(')')),
    children => url(requireValueNode(children[1]))
  );
  const RoutedVariableUrl = node(
    'Url',
    sequence(routed(), choice(g.UrlInterpolation, g.VariableReference), literal(')')),
    children => url(requireValueNode(children[1]))
  );
  const RoutedPlainUrl = node(
    'Url',
    noTrivia(sequence(
      routed(),
      optional(urlBoundaryWhitespace),
      optional(field('body', choice(g.EscapedQuoted, g.Quoted, staticDataUrlText, staticUrlText))),
      optional(urlBoundaryWhitespace),
      literal(')')
    )),
    (_children, fields) => {
      const captured = fields?.body;
      if (Array.isArray(captured)) {
        throw new TypeError('Less routed plain URL produced repeated body facts.');
      }
      const body = captured?.value;
      if (body === undefined) {
        return url(any(''));
      }
      if (isQuoted(body) || isInterp(body)) {
        return url(body);
      }
      return url(any(requireTerminalText(body)));
    }
  );
  const UrlTarget = choice(g.VariableUrl, g.PlainUrl);
  const ImportOption = node(
    'ImportOption',
    importOption,
    children => any(requireToken(children[0]).value)
  );
  const ImportOptions = node(
    'ImportOptions',
    sequence(
      literal('('),
      oneOrMoreSep(
        field('option', g.ImportOption),
        literal(',')
      ),
      literal(')')
    ),
    (_children, fields) => {
      const options = requireFields(fields, 'option').map((option) => {
        const value = option.value;
        if (!isAny(value)) {
          throw new TypeError('Less grammar produced a non-static import option.');
        }
        return value;
      });
      return list(options, ',');
    }
  );
  const ImportTailParen = noTrivia(sequence(
    literal('('),
    many(choice(staticTailText, g.Quoted, g.ImportTailGroup)),
    literal(')')
  ));
  const ImportTailGroup = g.ImportTailParen;
  const ImportTailText = noTrivia(oneOrMore(choice(
    staticTailText,
    g.Quoted,
    g.ImportTailGroup
  )));
  // An import postlude's variable-bearing media feature has an exact typed
  // shape. Keep this small prelude production here because the generic query
  // family is defined after `ImportStatement`; no forward grammar reference
  // may poison the document's direct start rule.
  const ImportQueryTail = node(
    'ImportQueryTail',
    sequence(literal('('), g.Identifier, regex(/:[ \t\n\r\f]*/), g.VariableReference, literal(')')),
    (children, _fields, _span, _rawChildren, _triviaLog, state) =>
      block(operation(':', keyword(requireToken(children[1]).value), requireValueNode(children[3]), false,
        lessMathOutsideParens(state, ':')))
  );
  const quotedOrUrlTarget = choice(g.EscapedQuoted, g.Quoted, UrlTarget);
  /**
   * Keep the import target as the original typed grammar child. The enclosing
   * import reducer owns target/tail structure; root boundary trivia stays in
   * Parseman's sparse document index and this leaf gains no source slots.
   */
  const ImportTarget = node(
    'ImportTarget',
    quotedOrUrlTarget,
    (children) => {
      const target = children.find(child => isQuoted(child) || isUrl(child) || isInterp(child));
      if (target === undefined) {
        throw new TypeError('Less import target lost its typed value.');
      }
      return target;
    }
  );
  const ImportTail = node(
    'ImportTail',
    choice(
      ImportQueryTail,
      g.AtRuleInterpolation,
      g.ImportTailText
    ),
    children => children.length === 1 ? children[0] : children
  );
  /**
   * There are TWO import nodes and this reducer picks between them. A plain CSS
   * `@import` is an ordinary `AtRuleStatement`; a compile-time import — one with
   * options, or with a loadable target — is a `StyleImport`. `importIsCompileTime`
   * is the ONE definition of that split, shared by every dialect, and all of its
   * inputs are authored syntax, so nothing about the shape defers to eval.
   *
   * The CSS-terminal prelude stays TYPED (`target`, then the tail) rather than
   * being flattened to bytes: the root CSS-import hoist reads the target node
   * back out of it, and a variable-bearing media feature still has to evaluate.
   * The option clause is import machinery with no CSS meaning, so it is simply
   * absent from that statement — exactly as Less 4.x emits it.
   * Root boundary trivia is projected later from Parseman's sparse root index;
   * this reducer stays on its original children/fields/span ABI.
   *
   * A postlude on the COMPILE-TIME branch is rejected here rather than carried:
   * a media/layer/supports query describes a linked CSS resource, and a loaded
   * document is spliced into this one instead. Deliberately unlike Less 4.x,
   * which accepts `@import "foo.less" screen` and wraps the result in `@media`.
   */
  const ImportStatement = node(
    'ImportStatement',
    sequence(importKeyword, optional(g.ImportOptions), g.ImportTarget, optional(field('tail', g.ImportTail)), literal(';')),
    (children, fields, span) => {
      // Every accepted import fact is a grammar child or a field capture. In
      // particular, the opaque tail is reconstructed from terminal values only
      // after the recursive grammar has closed every delimiter.
      const keyword = requireToken(children[0]);
      const options = children.find((child): child is List => typeof child === 'object' && child !== null && 'type' in child && child.type === 'List') ?? null;
      const target = children.find((child): child is Quoted | Url | Interpolation => isQuoted(child) || isUrl(child) || isInterp(child));
      if (target === undefined) {
        throw new TypeError('Less grammar produced no import target.');
      }
      const tailField = fields?.tail;
      // The variable-bearing query feature and a complete `@{…}` tail are
      // structural values. Mixed text and interpolation stays rejected until
      // the import tail has a typed segment model; do not flatten it back into
      // opaque source bytes.
      const tailValue = tailField === undefined ? undefined : requireField(fields, 'tail').value;
      const tail = tailValue === undefined ? null : isValueNode(tailValue) ? tailValue : any(staticText(tailValue));
      if (importIsCompileTime(keyword.value, target, options)) {
        if (tail !== null) {
          throw new LessImportPostludeError(span.start, span.end);
        }
        return styleImport(keyword.value, target, { options, mode: 'import' });
      }
      return withImportSourceSpan(
        withImportTailStart(
          atRuleStatement(
            keyword.value,
            tail === null ? target : spaced([target, tail])
          ),
          tailField === undefined || Array.isArray(tailField) ? NO_SPAN : tailField.span.start
        ),
        span.start,
        span.end
      );
    }
  );
  // `@plugin` is a compile-time directive, not an unknown CSS at-rule. Its
  // target and the *inner* option string are grammar facts so the evaluator
  // never rediscovers either from raw prelude bytes. EnclosedContent
  // recursively closes delimiters and preserves arbitrary option text as
  // interpolation literal/ref segments, matching Less's opaque option string.
  const PluginDirective = node(
    'Plugin',
    sequence(
      word(
        '@plugin',
        '-_a-zA-Z0-9\\u0080-\\uFFFF',
        { caseInsensitive: true }
      ),
      optional(sequence(literal('('), field('options', g.EnclosedContent), literal(')'))),
      field('target', quotedOrUrlTarget),
      literal(';')
    ),
    (_children, fields): Plugin => {
      const target = requireField(fields, 'target').value;
      if (!isQuoted(target) && !isUrl(target) && !isInterp(target)) {
        throw new TypeError('Less Plugin lost its typed target.');
      }
      const optionValue = fields?.options === undefined ? null : requireField(fields, 'options').value;
      if (optionValue !== null && !isInterp(optionValue)) {
        throw new TypeError('Less Plugin options must remain an interpolation template.');
      }
      return { type: 'Plugin', target, options: optionValue };
    }
  );
  // A call arm here is a COMPLETE variable value, so it must not claim the call
  // half of a lookup-bearing mixin reference (`#m(@a)[]`). Without this the
  // choice commits to the bare call and the trailing `[…]` can never be read,
  // even though Value already recognizes the whole reference —
  // which is why the same value parsed in property position and not here.
  const mixinValueWithoutLookup = not(noTrivia(literal('[')));
  // `;` separates block-list items, so the final item in a braced body may omit
  // it — `.a { @o: 3 }` and `.a { o: 3 }` are both Less. The omission is allowed
  // ONLY against the block's own `}`: `@o: 3` at end-of-stylesheet stays a parse
  // error (`lessc` 4.8.1: "@o rule is missing block or ending semi-colon"), and
  // a declaration still may not run into a following declaration or nested rule.
  const declarationEnd = choice(
    literal(';'),
    peek(literal('}'))
  );
  const variableName = node(
    'VariableName',
    noTrivia(sequence(literal('@'), lessVariableName)),
    (children, _fields, span) => `@${requireSupportedVariableName(children[1], span.start, span.end)}`
  );
  const VarDeclaration = node(
    'VariableDeclaration',
    sequence(variableName, literal(':'), choice(sequence(g.NamespacedMixinValue, mixinValueWithoutLookup), g.ImportantValue, sequence(g.FlatMixinCall, mixinValueWithoutLookup), sequence(not(literal('{')), g.VariableValue)), declarationEnd),
    (children, _fields, span) => {
      const name = requireTerminalText(children[0]).slice(1);
      const value = children[2];
      return withSourceSpan(
        variableDeclaration(name, isMixinCall(value) ? value : variableValueSlot(value), { mode: 'declare' }),
        span
      );
    }
  );
  const ValueBlockDeclaration = node(
    'VariableDeclaration',
    sequence(
      variableName,
      literal(':'),
      g.ValueBlock
    ),
    (children, _fields, span) => {
      const name = requireTerminalText(children[0]).slice(1);
      return withSourceSpan(
        variableDeclaration(
          name,
          lessValueSlot(requireValueNode(children[2])),
          { mode: 'declare' }
        ),
        span
      );
    }
  );
  const Keyword = node(
    'Keyword',
    g.ValueIdentifier,
    children => keyword(requireToken(children[0]).value)
  );
  /*
   * `<percentage>` — css-values-4 §8.2: "a `<number>` immediately followed by a
   * percent sign `%`", i.e. `<percentage> = <number> %`. It is a NAMED CSS value
   * type, referenced by name from many productions — `<keyframe-selector> = from
   * | to | <percentage>` (css-animations-1 §4), `image-set()`, `color-mix()`,
   * `<position>` — so it is a rule here rather than a shape each consumer
   * re-spells. Three dialects previously carried three different hand-rolled
   * numeric regexes for it, none referenceable and none agreeing with this
   * grammar's own `<number>` token.
   *
   * This does NOT add an AST node type: a percentage is still a `Dimension`
   * whose unit is `%`, which is why this is a token rule and not a `node()`.
   * `noTrivia` enforces the "immediately followed by" of the spec, so `50 %`
   * is not a percentage.
   */
  const Percentage = token(noTrivia(sequence(g.NumberToken, literal('%'))));
  const Dimension = node(
    'Dimension',
    noTrivia(sequence(g.NumberToken, optional(g.DimensionUnit))),
    (children, _fields, span) => {
      const numberText = requireToken(children[0]).value;
      const unit = children.length > 1 ? requireToken(children[1]).value : '';
      return dimension(Number(numberText), unit, `${numberText}${unit}`);
    }
  );
  // CSS declaration hacks such as `#000 \\9` are a real one-token value
  // suffix. Keep the escape structural and narrow; this is not a raw-value
  // fallback or a second scanner for declaration text.
  const EscapeValue = node(
    'EscapeValue',
    regex(/(?:\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))+/),
    children => any(requireToken(children[0]).value)
  );
  const PercentEscape = node(
    'PercentEscape',
    g.PercentEscapeToken,
    children => any(requireToken(children[0]).value)
  );
  // `@page` pseudo-pages are header atoms, not selector syntax in a value
  // position. Preserve their one-token spelling without widening generic values.
  const PagePseudo = node(
    'PagePseudo',
    sequence(literal(':'), g.ValueIdentifier),
    children => any(`:${requireToken(children[1]).value}`)
  );
  // Unknown at-rule functions are intentionally permissive.  This legacy Less
  // argument spelling is one opaque grammar fact—not two quoted strings around
  // a value—and remains available to any unknown function name.
  const DoubledQuoteArgument = node(
    'DoubledQuoteArgument',
    sequence(literal('""'), regex(/[^"()]+/), literal('""')),
    children => any(`""${requireToken(children[1]).value}""`)
  );
  // This is the AST reduction of the public Less `ArgCondition` grammar. Its
  // operands are bounded ordinary values; comparison/logical structure is added
  // only after those values have been recognized.
  const FunctionConditionOperand = node(
    'FunctionConditionOperand',
    oneOrMore(sequence(not(functionConditionStop), g.TopSum)),
    (children) => {
      const values = children.filter(isValueNode);
      if (values.length === 0) {
        throw new TypeError('Less function condition lost its operand.');
      }
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const FunctionConditionParen = node(
    'FunctionConditionParen',
    sequence(literal('('), g.FunctionConditionOr, literal(')')),
    (children): FunctionConditionFact => {
      const inner = children.find(isFunctionConditionFact);
      if (inner === undefined) {
        throw new TypeError('Less function condition lost its parenthesized operand.');
      }
      return { guard: inner.guard, src: `(${inner.src})`, grouped: true, hasComparison: inner.hasComparison };
    }
  );
  const FunctionConditionTerm = node(
    'FunctionConditionTerm',
    sequence(
      optional(functionConditionNot),
      choice(g.FunctionConditionParen, g.FunctionConditionOperand),
      optional(sequence(functionConditionOperator, choice(g.FunctionConditionParen, g.FunctionConditionOperand)))
    ),
    (children): FunctionConditionFact => {
      const nested = children.filter(isFunctionConditionFact);
      const values = children.filter(isValueNode);
      const operator = children.map(guardOperatorText).find((value): value is string => value !== null)?.trim();
      const left = nested[0] ?? (values[0] === undefined ? undefined : { guard: lessTruth(values[0]), src: functionConditionSource(values[0]), grouped: false, hasComparison: false, bare: values[0] });
      const right = nested[1] ?? (values.length > 1 && values[1] !== undefined ? { guard: lessTruth(values[1]), src: functionConditionSource(values[1]), grouped: false, hasComparison: false, bare: values[1] } : undefined);
      if (left === undefined) {
        throw new TypeError('Less function condition term lost its left operand.');
      }
      let guard: MixinGuard;
      let src: string;
      if (operator === undefined) {
        guard = left.guard;
        src = left.src;
      } else {
        if (right === undefined) {
          throw new TypeError('Less comparison requires value operands.');
        }
        if (nested.length === 0 && children.some(child => typeof child === 'object' && child !== null && 'value' in child && child.value === 'not')) {
          throw new TypeError('Less function condition `not` requires a grouped condition operand.');
        }
        const leftValue = left.bare ?? condition(left.guard, left.src);
        const rightValue = right.bare ?? condition(right.guard, right.src);
        guard = { g: 'cmp', op: operator, left: leftValue, right: rightValue };
        src = `${left.src} ${operator} ${right.src}`;
      }
      const negated = children.some(child => typeof child === 'object' && child !== null && 'value' in child && child.value === 'not');
      const hasComparison = operator !== undefined || left.hasComparison || right?.hasComparison === true;
      const grouped = operator === undefined && left.grouped;
      return negated
        ? { guard: { g: 'not', inner: guard }, src: `not(${src})`, grouped, hasComparison }
        : { guard, src, grouped, hasComparison };
    }
  );
  const FunctionConditionAnd = node(
    'FunctionConditionAnd',
    sequence(g.FunctionConditionTerm, many(sequence(functionConditionAnd, g.FunctionConditionTerm))),
    children => foldFunctionCondition('and', children)
  );
  const FunctionConditionOr = node(
    'FunctionConditionOr',
    sequence(g.FunctionConditionAnd, many(sequence(functionConditionOr, g.FunctionConditionAnd))),
    children => foldFunctionCondition('or', children)
  );
  const FunctionCondition = node(
    'FunctionCondition',
    g.FunctionConditionOr,
    (children) => {
      const fact = children.find(isFunctionConditionFact);
      if (fact === undefined) {
        throw new TypeError('Less function condition lost its fact.');
      }
      return condition(fact.guard, fact.src);
    }
  );
  /**
   * A math expression may claim a function argument only at an actual argument
   * boundary. The enclosing call's ambient `functionTrivia` reaches this
   * sequence boundary first; this one-code-unit-or-end rejection then proves
   * that the next non-trivia byte is comma, semicolon, or close. The enclosing
   * call still consumes the real delimiter, while Parseman's negative assertion
   * lowers to a capture-free recognizer instead of creating and rolling back
   * speculative delimiter CST leaves.
   */
  const functionArgumentBoundaryAhead = not(regex(/[^,;)]|$/));
  const FunctionScalarArgument = node(
    'FunctionScalarArgument',
    sequence(g.MathSum, functionArgumentBoundaryAhead),
    children => requireValueNode(children[0])
  );
  // `not(...)` is an explicit Less condition opener even without a comparison.
  // Keep this bounded opener test local: it only distinguishes that condition
  // form from an ordinary function value, and does not inspect an opaque
  // argument body.
  const functionConditionNotAhead = peek(parser(
    { trivia: functionTrivia },
    sequence(functionConditionNot, literal('('))
  ));
  // `name=value` is a call-argument PAIR, not a comparison — Less models it as a
  // dedicated assignment (`tree/assignment.js`) so `filter: alpha(opacity=50)`
  // replays verbatim instead of collapsing to `false`. The form is nothing
  // IE-specific: `foo(bar=1)` takes the same shape.
  //
  // The two forms are separated by SHAPE, not by function name: an assignment
  // key is a bare authored identifier, so a comparison whose left operand is
  // anything else — a number (`boolean(3 = 4)`), a variable (`foo(@a = 1)`), a
  // group or a call — still reaches `FunctionCondition` untouched. The `=` must
  // also open no other operator, keeping `==`, `=<`, `=>` and `=~` out.
  const assignmentKey = regex(/[-_a-zA-Z\u0080-\uffff][-\w\u0080-\uffff]*(?=[ \t\n\r\f]*=(?![=<>~]))/);
  const assignmentOperator = regex(/[ \t\n\r\f]*=[ \t\n\r\f]*/);
  const FunctionAssignmentArgument = node(
    'FunctionAssignmentArgument',
    noTrivia(sequence(field('key', assignmentKey), assignmentOperator, g.ArgumentValueSequence)),
    (children, fields) => {
      const value = children.find(isLessValueSlotValue);
      if (value === undefined) {
        throw new TypeError('Less function assignment argument lost its value.');
      }
      /*
       * §12.3 row 2: the pair is VERBATIM BYTES, not a node. Resolving `@x` in
       * `alpha(opacity=@x)` has no utility — the construct is dropped from
       * Less v5 — so this keeps the authored spelling and stops pretending the
       * value is live. The `=` re-emits unspaced, exactly as `Assignment` did.
       */
      return any(`${staticText(requireField(fields, 'key').value)}=${mixinArgumentSource(value)}`);
    }
  );
  // `@name: value` is a KEYWORD argument — the SAME construct `.m(@name: 1)`
  // already spells on the mixin lane (§12.0: one `.less` source, one node), so
  // it reduces to the same `CallArg` and the callee's own parameter names bind
  // it. It sits beside `FunctionAssignmentArgument` because it is the same
  // shape of problem — a key, an operator, a value — and it is gated the same
  // way: the key regex carries the operator LOOKAHEAD, so a positional `@c`
  // fails the key match outright instead of parsing a variable and backtracking
  // out of it. `@name:` must open no other operator, keeping `::` out.
  const keywordArgumentKey = regex(/@[-_a-zA-Z\u0080-\uffff][-\w\u0080-\uffff]*(?=[ \t\n\r\f]*:(?!:))/);
  const keywordArgumentOperator = regex(/[ \t\n\r\f]*:[ \t\n\r\f]*/);
  const FunctionKeywordArgument = node(
    'FunctionKeywordArgument',
    noTrivia(sequence(field('key', keywordArgumentKey), keywordArgumentOperator, g.ArgumentValueSequence)),
    (children, fields) => {
      const value = children.find(isLessValueSlotValue);
      if (value === undefined) {
        throw new TypeError('Less function keyword argument lost its value.');
      }
      return callArg(value, staticText(requireField(fields, 'key').value).slice(1));
    }
  );
  const FunctionArgument = node(
    'FunctionArgument',
    choice(
      sequence(functionConditionNotAhead, g.FunctionCondition),
      g.FunctionKeywordArgument,
      g.FunctionScalarArgument,
      g.ArgumentValueSequence,
      g.FunctionAssignmentArgument,
      g.FunctionCondition
    ),
    (children) => {
      const named = children.find(isLessCallArg);
      if (named !== undefined) {
        return named;
      }
      const value = children.find(isLessValueSlotValue);
      if (value === undefined) {
        throw new TypeError('Less function argument lost its value.');
      }
      return value;
    }
  );
  // Generic Less function calls carry one flat positional argument vector.
  // Unlike mixin arguments, commas and semicolons do not create nested groups
  // here: either delimiter separates the next typed argument, and evaluation
  // canonicalizes both to the ordinary function-call comma spelling.
  // A final delimiter has no following argument, so it intentionally has no
  // ValueLayout boundary to retain.
  // The `separator` capture records the authored delimiter gap for byte-faithful
  // replay; it is layout, never a substitute for trivia. The following argument
  // therefore stays under ambient trivia (`functionTrivia` here), so a `//` line
  // comment after a delimiter is skipped exactly as it is before the first
  // argument. Block comments on argument boundaries stay in that trivia stream
  // and are replayed through ValueLayout; only comments inside a value sequence
  // still reach ArgumentValueSequence.
  const functionArgumentSeparator = field('separator', regex(/[;,][ \t\n\r\f]*/));
  const trailingFunctionArgumentSeparator = field('trailingSeparator', noTrivia(regex(/[;,][ \t\n\r\f]*/)));
  const functionArgument = choice(
    g.DoubledQuoteArgument,
    g.ValueBlock,
    g.FunctionArgument
  );
  const FunctionArguments = optional(sequence(
    oneOrMoreSep(functionArgument, functionArgumentSeparator),
    optional(trailingFunctionArgumentSeparator)
  ));
  // Value-position identifiers and glued function openers share one lexical
  // family. Parse that opener once, then route by the returned text. Branch
  // nodes own `routed()` so the consumed opener remains inside the selected CST
  // node, and `foo (` still stays keyword + paren because the `(` is not glued
  // into the opener.
  const identOrFunction = token(noTrivia(sequence(g.InterpolatedValueStart, optional(literal('(')))));
  const genericFunctionOpen = token(noTrivia(sequence(
    not(keywords(['url(', 'calc('], { caseInsensitive: true })),
    g.InterpolatedValueStart,
    literal('(')
  )));
  const GenericFunction = node(
    'Call',
    parser({ trivia: functionTrivia }, sequence(routed(), g.FunctionArguments, literal(')'))),
    (children, fields, span, rawChildren, triviaLog, state) =>
      functionCallFromChildren(children, fields, span, triviaLog, state, rawChildren)
  );
  const Call = node(
    'Call',
    parser({ trivia: functionTrivia }, sequence(genericFunctionOpen, g.FunctionArguments, literal(')'))),
    (children, fields, span, rawChildren, triviaLog, state) =>
      functionCallFromChildren(children, fields, span, triviaLog, state, rawChildren)
  );
  // A detached ruleset is a call-argument form, not a general value piece.
  // Keep this argument-enabled function production out of Value
  // so a declaration value cannot acquire the call-only `{ … }` first set.
  const callArgumentFunctionSeparator = field('separator', regex(/[;,][ \t\n\r\f]*/));
  const trailingCallArgumentFunctionSeparator = field('trailingSeparator', noTrivia(regex(/[;,][ \t\n\r\f]*/)));
  const CallArgumentFunctionArguments = optional(sequence(
    oneOrMoreSep(g.CallArgumentValue, callArgumentFunctionSeparator),
    optional(trailingCallArgumentFunctionSeparator)
  ));
  const CallArgumentFunction = node(
    'Call',
    sequence(routed(genericFunctionOpen), CallArgumentFunctionArguments, literal(')')),
    argumentFunctionFromChildren
  );
  // Deprecated Less percent-format syntax is a normal existing function fact.
  // The glued `%(` opener keeps it distinct from the `%` arithmetic operator.
  const FormatFunction = node(
    'Call',
    sequence(noTrivia(literal('%(')), optional(sequence(not(literal('{')), g.ValueSequence)), many(noTrivia(sequence(regex(/,[ \t\n\r\f]*/), not(literal('{')), g.ValueSequence))), literal(')')),
    children => funcCall('%', children.slice(1, -1).filter(isLessValueSlotValue))
  );
  // A bare call is a Less statement only with its terminator.  Keep this
  // distinct from Call, which is also a value piece and must not
  // consume a declaration/list boundary.
  const terminalFunctionBoundary = noTrivia(peek(sequence(
    optional(g.whitespace),
    choice(literal('}'), not(regex(/[\s\S]/)))
  )));
  const GenericFunctionStatement = node(
    'Call',
    sequence(g.CallArgumentFunction, literal(';')),
    (children) => {
      const call = children.find(isFunctionCall);
      if (call === undefined) {
        throw new TypeError('Less function statement lost its call fact.');
      }
      return lowerLogicalCallStatement(call);
    }
  );
  const TerminalGenericFunction = transform(
    sequence(GenericFunction, terminalFunctionBoundary),
    ([call]) => isStatement(call) ? call : ''
  );
  const FunctionStatement = transform(
    dispatch(
      identOrFunction,
      caseOf('each(', g.EachFunctionStatement),
      /*
       * The url/calc exclusion here is LOAD-BEARING, not redundant with
       * `genericFunctionOpen`'s `not(keywords(['url(','calc(']))` guard (:3380).
       * This arm routes through `CallArgumentFunction`'s
       * `routed(genericFunctionOpen)`, and `routed()` reuses the dispatch opener
       * token WITHOUT running that guard — so the negative lookahead is the only
       * thing keeping `url(`/`calc(` from ENTERING this arm. A dispatch miss
       * falls through to `declarationItem`; entering and failing is a *committed*
       * dispatch failure that `choice` propagates, suppressing the fall-through
       * (verified: `endsWith('(')` reparses bare `calc(1px + 2px);` as a function
       * statement). To make it principled, divert `url(`/`calc(` with `caseOf`
       * arms first (as `IdentifierOrFunction` does) — a behavior change, not a rename.
       */
      when(
        matches(/^(?!(?:url|calc)\($).+\($/i),
        choice(GenericFunctionStatement, TerminalGenericFunction)
      )
    ),
    ([, statement]) => statement
  );
  // `calc(` owns its boundary gaps for the same reason `Paren` below does: the
  // math ladder runs under `noTrivia`, so an interior that admits authored
  // padding has to spell it. Without these terms `calc( 1px + 2px )` was
  // rejected as hard as `calc(/* c */1px + 2px)` was, and `Paren`'s own padding
  // was unreachable from inside a calc — `calc( (1px + 2px) )` failed too.
  const CalcFunction = node(
    'CalcCall',
    noTrivia(sequence(routed(), optional(whitespace), g.MathSum, optional(whitespace), literal(')'))),
    children => funcCall(functionNameFromOpener(children[0]), [requireValueNode(children.find(isValueNode))])
  );
  const Identifier = node(
    'Identifier',
    noTrivia(sequence(routed(), many(g.interpolatedValueTail))),
    (children) => {
      if (children.some(isInterpolationFact)) {
        return interpolation(interpolationPartsFrom(children, true));
      }
      return keyword(children.map(child => requireToken(child).value).join(''));
    }
  );
  const IdentifierOrFunction = dispatch(
    identOrFunction,
    caseOf('url(', choice(RoutedVariableUrl, RoutedPlainUrl)),
    caseOf('calc(', g.CalcFunction),
    when(endsWith('('), g.GenericFunction),
    otherwise(Identifier)
  );
  // Less 5 removed inline backtick JavaScript. Recognize the complete legacy
  // value shape so public diagnostics can point at the removed construct instead
  // of reporting a generic value-position expected-token failure.
  const BacktickJavaScript = node(
    'BacktickJavaScript',
    noTrivia(sequence(literal('`'), inlineJavaScriptBody, literal('`'))),
    (_children, _fields, span) => {
      throw new LessInlineJavaScriptError(span.start, span.end);
    }
  );
  // `~(...)` escapes its delimiters and makes the complete inner list the value
  // (rather than a math grouping). A paren-delimited `Block` already has exactly the required
  // evaluation behavior for that typed list: a computed list loses its outer
  // parentheses, while the inner list remains indexable by `each()` and list
  // functions.  This is grammar construction, not a raw source-value escape.
  const EscapedParen = node(
    'Block',
    noTrivia(sequence(literal('~('), g.ValueList, literal(')'))),
    (children, _fields, span) => withSourceSpan(
      block(requireValueSlot(children[1]), 'paren', true),
      span
    )
  );
  // A bare `(...)` is a math grouping in Less.  Function/mixin argument lists
  // have their own productions above; do not widen this value position into a
  // permissive raw list.
  const Paren = node(
    'Block',
    // Math itself is deliberately no-trivia so space-list and glued-sign rules
    // stay exact. Parentheses own their boundary gaps, including Less `//`
    // comments before the first or after the final operand.
    noTrivia(sequence(literal('('), optional(whitespace), g.MathSum, optional(whitespace), literal(')'))),
    (children, _fields, span) => {
      const inner = children.find(isValueNode);
      if (inner === undefined) {
        throw new TypeError('Less parenthesized math lost its inner value.');
      }
      return withSourceSpan(block(inner), span);
    }
  );
  // CSS grid line names are a bracketed value piece, not a map accessor or an
  // opaque post-parse string. Keep the delimited grammar fact as one existing
  // raw value leaf; dynamic/interpolated grid names remain outside this slice.
  const gridLineName = node(
    'GridLineName',
    noTrivia(sequence(literal('['), g.Keyword, literal(']'))),
    (children) => {
      const name = requireValueNode(children[1]);
      if (name.type !== 'Keyword') {
        throw new TypeError('Less grid line name requires a keyword fact.');
      }
      return any(`[${name.src}]`);
    }
  );
  // A parenthesized `feature: value` is an ordinary typed Less value as well
  // as a media/container query fact: `@tablet: (min-width: @size)`.  Keep the
  // one canonical Block(paren, Operation(':')) reduction outside QueryValue so the
  // value and query grammars share it without a recursive query-value cycle.
  const QueryColonFeature = node(
    'QueryColonFeature',
    sequence(literal('('), g.Identifier, regex(/:[ \t\n\r\f]*/), g.MathSum, literal(')')),
    (children, _fields, span, _rawChildren, _triviaLog, state) => withSourceSpan(
      block(operation(':', keyword(requireToken(children[1]).value), requireValueNode(children[3]), false,
        lessMathOutsideParens(state, ':'))),
      span
    )
  );
  const Value = node(
    'Value',
    choice(
      attempt(g.MixinReference),
      g.InterpolatedValue,
      g.EscapedQuoted,
      g.Quoted,
      BacktickJavaScript,
      g.IndirectVariableReference,
      g.VariableReferenceChain,
      g.PropertyReference,
      g.CustomPropertyValue,
      g.Dimension,
      g.Color,
      g.FormatFunction,
      IdentifierOrFunction,
      g.SelectorCapture,
      g.EscapedParen,
      g.QueryColonFeature,
      g.Paren,
      gridLineName,
      g.EscapeValue,
      PercentEscape
    ),
    children => requireValueNode(children.find(isValueNode))
  );
  // Signed numerics are already one Dimension leaf (`-2px`).  Less unary minus
  // is glued to a variable or grouping (`-@x`, `-(...)`); `- @x` is instead a
  // preserved space-list. The grammar keeps that source-order/spacing
  // distinction rather than normalizing both spellings to negation.
  const MathUnary = node(
    'MathUnary',
    sequence(
      optional(noTrivia(regex(/-(?=[(@])/))),
      g.Value
    ),
    (children, _fields, _span, _rawChildren, _triviaLog, state) => children.length === 1
      ? requireValueNode(children[0])
      : operation(
          '*',
          dimension(-1, '', '-1'),
          requireValueNode(children[1]),
          false,
          lessMathOutsideParens(state, '*')
        ),
    { collapse: true }
  );
  const MathAtom = node(
    'MathAtom',
    g.MathUnary,
    children => requireValueNode(children[0]),
    { collapse: true }
  );
  // Parenthesized and calc math follows Less precedence: product before sum,
  // both left-associative.  Top-level declarations deliberately exclude `/`:
  // with Less's default parens-division mode it is a preserved slash group, not
  // an eager division Operation.  The existing serializer already recognizes
  // that Sequence shape and reinterprets it only inside calc().
  const MathProduct = node(
    'MathProduct',
    noTrivia(sequence(g.MathAtom, many(sequence(productOperator, g.MathAtom)))),
    lessFoldOperation,
    { collapse: true }
  );
  const MathSum = node(
    'MathSum',
    noTrivia(sequence(g.MathProduct, many(sequence(sumOperator, g.MathProduct)))),
    lessFoldOperation,
    { collapse: true }
  );
  const TopProduct = node(
    'TopProduct',
    noTrivia(sequence(g.MathAtom, many(sequence(topProductOperator, g.MathAtom)))),
    lessFoldOperation,
    { collapse: true }
  );
  const TopSum = node(
    'TopSum',
    noTrivia(sequence(g.TopProduct, many(sequence(sumOperator, g.TopProduct)))),
    lessFoldOperation,
    { collapse: true }
  );
  // In Less's default `parens-division` mode a glued top-level `/` is not an
  // eager Operation. It is one parser-owned slash group that becomes division
  // only when a surrounding calc context consumes it.
  const PreservedDivision = node(
    'PreservedDivision',
    noTrivia(sequence(g.TopSum, oneOrMore(sequence(field('separator', preservedSlashBoundary), g.TopSum)))),
    (children, fields, _span, _rawChildren, _triviaLog, state): ValueNode => {
      /*
       * The group is preserved bytes exactly when the policy does NOT divide a
       * bare `/`. Under `math: always` it is not preserved at all, so operands
       * keep the arithmetic they were built with.
       */
      const preserved = !lessMathOutsideParens(state, '/');
      const slashBoundaries = fields?.separator === undefined
        ? []
        : requireFields(fields, 'separator').map((separator) => {
            if (!isSlashBoundaryFact(separator.value)) {
              throw new TypeError('Less preserved division produced an invalid slash boundary.');
            }
            return separator.value;
          });
      const values = children.filter(isValueNode);
      const parts: ValueNode[] = [];
      for (let index = 0; index < values.length; index += 1) {
        parts.push(preserved ? withoutBareMath(values[index]!) : values[index]!);
        if (index < slashBoundaries.length) {
          parts.push(keyword('/'));
        }
      }
      const separators = slashBoundaries.flatMap(boundary => [boundary.before, boundary.after]);
      return withValueLayout(
        spaced(parts),
        separators.length === parts.length - 1
          ? separators
          : Array.from({ length: parts.length - 1 }, () => '')
      );
    }
  );
  // Value pieces are separated by grammar-owned whitespace. Keeping that token
  // here is what lets a canonical Sequence retain multiline CSS layout without
  // scanning/re-splitting a completed declaration value later.
  // Left-factored `TopSum (/ TopSum)*`: the value-piece choice used to try
  // `PreservedDivision` (a full `TopSum` + REQUIRED slash tail) and, on the
  // no-slash majority, fail the tail, backtrack, and re-parse `TopSum` from the
  // same position (the two arms share `TopSum`'s first-set, so the `choice` is
  // not disjoint and cannot dispatch past the redundant descent). Parsing
  // `TopSum` once and taking an OPTIONAL slash tail yields byte-identical values
  // — a bare `TopSum` when no slash follows, the same `Sequence` when one
  // does — without the second full value descent per non-slash piece.
  const topSumMaybeDivision = node(
    'TopSumMaybeDivision',
    noTrivia(sequence(g.TopSum, many(sequence(field('separator', preservedSlashBoundary), g.TopSum)))),
    (children, fields, _span, _rawChildren, _triviaLog, state) => {
      if (fields?.separator === undefined) {
        return requireValueNode(children[0]);
      }
      const slashBoundaries = requireFields(fields, 'separator').map((separator) => {
        if (!isSlashBoundaryFact(separator.value)) {
          throw new TypeError('Less value piece produced an invalid slash boundary.');
        }
        return separator.value;
      });

      /*
       * The group is preserved bytes exactly when the policy does NOT divide a
       * bare `/`; under `math: always` it is not preserved and its operands keep
       * the arithmetic they were built with. See {@link withoutBareMath}.
       */
      const preserved = !lessMathOutsideParens(state, '/');
      const values = children.filter(isValueNode);
      const parts: ValueNode[] = [];
      for (let index = 0; index < values.length; index += 1) {
        parts.push(preserved ? withoutBareMath(values[index]!) : values[index]!);
        if (index < slashBoundaries.length) {
          parts.push(keyword('/'));
        }
      }
      const separators = slashBoundaries.flatMap(boundary => [boundary.before, boundary.after]);
      return withValueLayout(
        spaced(parts),
        separators.length === parts.length - 1
          ? separators
          : Array.from({ length: parts.length - 1 }, () => '')
      );
    }
  );
  const valuePiece = choice(g.UnicodeRange, topSumMaybeDivision, literal('/'), literal('-'), literal('%'));
  const nestedAtRuleValueStart = regex(/@[^;{}()'"]*\{/);
  const valueTriviaBoundary = parser(
    { trivia: whitespace },
    sequence(
      peek(whitespace),
      not(nestedAtRuleValueStart),
      g.valuePiece
    )
  );
  const gluedVariableValueBoundary = sequence(
    leaf(peek(literal('@')), () => ({ kind: 'glued-value-boundary' })),
    g.valuePiece
  );
  const valueContinuation = choice(valueTriviaBoundary, gluedVariableValueBoundary);
  // Function arguments are the one value context where top-level Less
  // comparison/logical syntax has a separate continuation. Stop before that
  // marker so the FunctionArgument family can route it through FunctionCondition;
  // nested calls are already one value piece and therefore never leak an inner
  // operator into their parent's decision.
  const functionArgumentValueTriviaBoundary = sequence(
    not(functionConditionStop),
    valueTriviaBoundary
  );
  const functionArgumentValueContinuation = choice(
    functionArgumentValueTriviaBoundary,
    gluedVariableValueBoundary
  );
  // Adjacent value pieces are normally separated by authored whitespace, but a
  // Less variable reference may also be glued straight onto the previous piece
  // (`1px@v`, `calc(@w + 2vw)@suffix`). Less treats the glued form as the same
  // space-separated expression as `1px @v` — the missing gap is layout, not a
  // different value shape — so the `@` boundary is a zero-width separator here.
  // One shared piece-tail keeps declaration values and `@name:` variable values
  // on the same rule instead of diverging on the glued spelling.
  // The piece separator stops the value before a nested at-rule. `;` separates
  // declarations rather than terminating them (css-syntax-3 §5.4.7), so the last
  // declaration in a block ends at whatever follows it — and in Less that
  // successor may be `@media all { … }`, whose at-keyword this term would
  // otherwise take as an ordinary `@name` variable reference, leaving the `{`
  // with no statement to open. Less cannot resolve this by reserving the CSS
  // at-rule names the way css/scss/jess do: `@name` IS Less's variable spelling,
  // so `color: red @media` must stay a two-piece value. The discriminator is
  // therefore the shape that follows, not the name — an at-keyword run that
  // reaches `{` before any `;`, `}`, group, or quote is a nested at-rule header
  // and nothing else, because a value piece can never contain a top-level `{`.
  // The lookahead is name-independent (so `@foo all { … }` works too) and costs
  // nothing on ordinary values: it fails on its first character unless the next
  // non-space character is `@`, and even then stops at the declaration's own
  // terminator a few characters later.
  const ValueSequence = node(
    'ValueSequence',
    noTrivia(sequence(g.valuePiece, many(valueContinuation))),
    (children, _fields, _span, _rawChildren, triviaLog, state) => valuePieceReducerWithTrivia(children, triviaLog, state)
  );
  /**
   * Function bodies use their own argument delimiters, but comments *inside*
   * an argument are still lexical trivia. This local value term therefore uses
   * the same continuation boundary as ordinary values. The terminal condition
   * check declines only when the next token belongs to FunctionCondition; the
   * enclosing argument list owns comma, semicolon, close, and their trivia.
   * This avoids speculatively parsing and rolling back that parent-owned
   * boundary in the generated AST and CST tables.
   */
  const ArgumentValueSequence = node(
    'FunctionValueSequence',
    noTrivia(sequence(
      g.valuePiece,
      many(functionArgumentValueContinuation),
      not(functionConditionStop)
    )),
    (children, _fields, _span, _rawChildren, triviaLog, state) => valuePieceReducerWithTrivia(children, triviaLog, state)
  );
  const ValueList = node(
    'ValueList',
    choice(
      // This transaction owns the WHOLE accessor-bearing value. Keeping it out
      // of Value means its typed mixin arguments do not recurse through the
      // same candidate before the required accessor fact has been established.
      attempt(sequence(g.MixinReference, not(choice(topProductOperator, sumOperator)))),
      oneOrMoreSep(
        g.ValueSequence,
        field('separator', regex(/,[ \t\n\r\f]*/))
      )
    ),
    (children, fields, _span, rawChildren, triviaLog, state) => {
      const referenceValue = children.find(isReference);
      if (referenceValue !== undefined) {
        return referenceValue;
      }
      return commaListWithTriviaFromChildren(children, fields, triviaLog, state, isLessValueSlotValue, rawChildren);
    }
  );
  // Variable declarations additionally permit Less trivia immediately after
  // `:` and after comma boundaries. A `//` line comment is trivia (never a CSS
  // value node), while the comma-separated value remains the normal List fact.
  const VariableValue = node(
    'VariableValue',
    sequence(
      optional(whitespace),
      oneOrMoreSep(
        g.ValueSequence,
        field('separator', regex(/,[ \t\n\r\f]*/))
      ),
      optional(sequence(literal(','), optional(whitespace)))
    ),
    (children, fields, _span, rawChildren, triviaLog, state) =>
      commaListWithTriviaFromChildren(children, fields, triviaLog, state, isLessValueSlotValue, rawChildren)
  );
  // `!important` is a grammar-owned declaration/value modifier.  Variables
  // carry the wrapper so references hoist importance once; declarations expose
  // their own flag.  Do not represent it as an opaque keyword/value suffix.
  const ImportantValue = node(
    'ImportantValue',
    // Priority syntax is token structure, not one glued source string: Less
    // accepts `!important`, `! important`, and `!/*comment*/important`.
    sequence(g.ValueList, literal('!'), g.ImportantToken),
    children => important(requireValueSlot(children[0]))
  );
  // Left-factored value/priority: parse the value tower ONCE, then an optional
  // `!important` tail.  The old `choice(ImportantValue, ValueList)`
  // was non-disjoint on the value first-set, so every declaration without a
  // priority (~99%) descended the whole value tower inside `ImportantValue`,
  // failed at the required `!`, backtracked, and re-descended as a bare value.
  // The tail mirrors `ImportantValue` exactly (`!`, trivia, `important`),
  // so the AST is identical either way:
  // an `Important` wrapper when the tail matched, else the bare value.
  const ValueListWithPriority = node(
    'ValueListWithPriority',
    sequence(
      not(literal('{')),
      g.ValueList,
      optional(sequence(literal('!'), g.ImportantToken))
    ),
    (children) => {
      const value = requireValueSlot(children[0]);
      return children.some(child => isLessTerminalText(child, '!')) ? important(value) : value;
    }
  );
  // Less custom properties retain CSS declaration-value text.  The direct
  // route therefore treats every ordinary byte run as literal `Any` content,
  // but lets the shared strict `@{…}` grammar surface interpolation as typed
  // AST facts.  Delimiters and strings are grammar children—not a captured
  // source span—while block comments stay in Parseman's trivia log.
  // Gating note: the static and interpolated `--*` name arms share `-`; keep the
  // public name branches explicit until the custom-property family has a shared
  // opener that preserves both AST construction and CST ownership.
  const CustomPropertyName = node(
    'CustomPropertyName',
    choice(
      noTrivia(sequence(
        literal('--'),
        optional(choice(g.InterpolatedCustomPropertyStart, g.InterpolatedCustomPropertyDash)),
        g.Interpolation,
        many(choice(g.InterpolatedCustomPropertyTail, g.Interpolation))
      )),
      g.CustomPropertyToken
    ),
    (children) => {
      if (!children.some(isInterpolationFact)) {
        return requireToken(children[0]).value;
      }
      return interpolation(interpolationPartsFrom(children, false));
    }
  );
  const CustomGroup = node(
    'CustomGroup',
    parser(
      { trivia: customValueCommentTrivia },
      choice(
        sequence(literal('('), many(g.CustomInnerPart), literal(')')),
        sequence(literal('['), many(g.CustomInnerPart), literal(']')),
        sequence(literal('{'), many(g.CustomInnerPart), literal('}'))
      )
    ),
    children => customPartsFromChildren(children)
  );
  const CustomAtKeywordText = node(
    'CustomAtKeywordText',
    g.CustomValueAtKeyword,
    children => requireToken(children[0]).value
  );
  const CustomInnerPart: Combinator<CustomValuePart> = choice(
    g.Interpolation,
    g.CustomValueInnerContent,
    g.CustomValueSingleQuoted,
    g.CustomValueDoubleQuoted,
    g.CustomGroup,
    g.CustomAtKeywordText,
    g.VariableReference
  );
  const CustomPart: Combinator<CustomValuePart> = choice(
    g.Interpolation,
    g.CustomValueOuterContent,
    g.CustomValueSingleQuoted,
    g.CustomValueDoubleQuoted,
    g.CustomGroup,
    g.CustomAtKeywordText,
    g.VariableReference
  );
  const CustomValue = node(
    'CustomValue',
    parser(
      { trivia: customValueCommentTrivia },
      many(g.CustomPart)
    ),
    (children, _fields, span) => withSourceSpan(
      customValueFromParts(customPartsFromChildren(children)),
      span
    )
  );
  // A CSS custom-property token is an ordinary component value in Less
  // functions such as `var(--accent)`. It is not a Less declaration name here.
  // It reduces to the same Keyword the css/scss/jess grammars produce, and the
  // same one the at-rule prelude custom-property branch produces for the
  // identical token in an at-rule header.
  const CustomPropertyValue = node(
    'CustomPropertyValue',
    g.CustomPropertyToken,
    children => keyword(requireToken(children[0]).value)
  );
  const CustomDeclaration = node(
    'CustomDeclaration',
    // A trailing `!important` is declaration priority, not value text: css-syntax-3
    // §5.5.6 strips it before the custom-property original-text step. The value leaf
    // already stops before the marker (and before the whitespace preceding it), so
    // this tail simply claims it. It mirrors the ordinary-declaration tail exactly:
    // `!`, trivia, `important`.
    sequence(
      g.CustomPropertyName,
      literal(':'),
      g.CustomValue,
      optional(sequence(literal('!'), g.ImportantToken))
    ),
    (children) => {
      const name = children[0];
      // A custom property name may itself be an `Interpolation`, so choose the final
      // value child rather than treating the first AST value in this reduction
      // as the declaration value.
      const value = children.filter(isValueNode).at(-1);
      if (name === undefined || value === undefined) {
        throw new TypeError('Less grammar produced an incomplete custom declaration.');
      }
      return decl(
        isInterp(name) ? name : requireTerminalText(name),
        lessValueSlot(value),
        null,
        children.some(child => isLessTerminalText(child, '!'))
      );
    }
  );
  const InterpolatedProperty = node(
    'InterpolatedProperty',
    choice(
      noTrivia(sequence(optional(literal('*')), optional(literal('-')), optional(g.InterpolatedPropertyStart), g.Interpolation, many(choice(g.InterpolatedPropertyTail, g.Interpolation)))),
      noTrivia(sequence(literal('--'), optional(choice(g.InterpolatedCustomPropertyStart, g.InterpolatedCustomPropertyDash)), g.Interpolation, many(choice(g.InterpolatedCustomPropertyTail, g.Interpolation))))
    ),
    children => interpolation(interpolationPartsFrom(children, false))
  );
  // An interpolated property name always carries a `@{`/`${` marker before the
  // declaration `:`; a plain property never does. InterpolatedProperty
  // is tried first in the property choice (its literal prefix arm can begin a
  // property like `color-@{n}`), so a plain `color:` otherwise scans the whole
  // property ident through the interpolated-property-start production before
  // failing at the required interpolation. This positive lookahead is the cheap
  // commit signal: only enter the interpolated-property arm when a marker is
  // actually present before the delimiter, so plain properties fall straight to
  // the literal DeclarationProperty arm. The collapsed semantic node keeps the
  // marker off the declaration reducer's `children[0]` property slot without
  // adding a second public CST name for the same InterpolatedProperty concept.
  const interpolatedPropertyAhead = peek(regex(/[^:;{}]*[@$]\{/));
  const interpolatedPropertyHead = node(
    'InterpolatedProperty',
    sequence(interpolatedPropertyAhead, g.InterpolatedProperty),
    (children) => {
      const property = children.find(isInterp);
      if (property === undefined) {
        throw new TypeError('Less interpolated-property gate lost its interpolation.');
      }
      return property;
    },
    { collapse: true }
  );
  // Declaration-head gaps are trivia, not declaration-name syntax. The AST keeps
  // the semantic property name clean; rendering replays output-bearing block
  // comments from the source trivia map before writing the colon.
  const DeclarationHead = parser({ trivia: whitespace }, sequence(
    choice(
      interpolatedPropertyHead,
      g.NumericMapKeyToken,
      g.DeclarationPropertyToken
    ),
    optional(sequence(choice(literal('+_'), literal('+')))),
    literal(':')
  ));
  const StandardDeclaration = node(
    'Declaration',
    noTrivia(sequence(
      DeclarationHead,
      noTrivia(sequence(
        field('valueGap', regex(/[ \t\n\r\f]*/)),
        // Less accepts an explicit empty declaration value (`margin: ;`). Keep
        // it as a canonical empty opaque value rather than dropping the
        // declaration or falling back to a second parser.
        optional(g.ValueListWithPriority)
      ))
    )),
    (children, fields, span) => {
      // Property, delimiter, and value are independently recognized grammar
      // children; AST construction does not split or reclassify authored text.
      const rawName = children[0];
      // Parseman's optional branch is transparent when absent. Find the value
      // only after the property delimiter, because an interpolated property
      // name is itself an `Interpolation` value node.
      const mergeToken = children.find(child => isToken(child) && (child.value === '+' || child.value === '+_'));
      const colonIndex = children.findIndex(child => isLessTerminalText(child, ':'));
      if (colonIndex < 0) {
        throw new TypeError('Less grammar produced no declaration delimiter.');
      }
      const valueChild = children.slice(colonIndex + 1).find(isLessValueSlotValue);
      const value: ValueSlot = valueChild === undefined ? any('') : requireValueSlot(valueChild);
      const merge = mergeToken === undefined ? null : requireToken(mergeToken).value === '+_' ? ' ' : ',';
      const valueGap = fields?.valueGap === undefined ? '' : requireTerminalText(requireField(fields, 'valueGap').value);
      // A lone line break after `:` is ordinary parser layout and canonicalizes
      // back to `: value`. Preserve the declaration break only when the value
      // itself carries multiline separator facts (grid-area style output).
      const layout = Array.isArray(value) || isSequence(value) ? valueLayoutOf(value) : undefined;
      const valueOnNewLine = (valueGap.includes('\n') || valueGap.includes('\r'))
        && layout?.some(separator => separator.includes('\n') || separator.includes('\r')) === true;
      if (merge !== null && merge !== ',' && merge !== ' ') {
        throw new TypeError('Less grammar produced an invalid declaration merge modifier.');
      }
      const node = !Array.isArray(value) && isValueNode(value) && value.type === 'Important'
        ? decl(isInterp(rawName) ? rawName : requireToken(rawName).value, lessValueSlot(value.value), merge, true, valueOnNewLine)
        : decl(isInterp(rawName) ? rawName : requireToken(rawName).value, Array.isArray(value) ? value : lessValueSlot(value), merge, false, valueOnNewLine);
      return withSourceSpan(node, span);
    }
  );
  // Ordered before the ordinary value grammar: a `--*` declaration has the
  // custom-property semantics above, while every other property remains on the
  // typed Less value path.
  // Gating note: `CustomDeclaration` and ordinary `Declaration` overlap on
  // `--*`; the real fix is the custom-property factoring/trivia pass above,
  // not a zero-width dispatch wrapper around the same ambiguous opener.
  const Declaration: Combinator<Declaration> = choice(
    g.CustomDeclaration,
    StandardDeclaration
  );
  /** Less detached maps can use punctuation members (`<: %3c; #: %23;`).
   * This is a declaration fact with a non-CSS name, not an opaque body slice. */
  const PunctuationMapDeclaration = node(
    'PunctuationMapDeclaration',
    sequence(
      g.PunctuationMapKeyToken,
      literal(':'),
      optional(g.ValueListWithPriority)
    ),
    (children, _fields, span) => {
      const value = children.find(isLessValueSlotValue);
      return withSourceSpan(
        decl(requireToken(children[0]).value, value === undefined ? any('') : value),
        span
      );
    }
  );
  const PositionalMixinCallArgument = node(
    'PositionalMixinArgument',
    sequence(g.CallArgumentValue, optional(literal('...'))),
    /* ONE shape for both arms and both call families. The conditional spread
     * this replaced realized a second hidden class for every `@args...`. */
    children => callArg(
      requireMixinCallArgumentValue(children[0]),
      undefined,
      children.some(child => isLessTerminalText(child, '...'))
    )
  );
  const mixinCallArgument: Combinator<MixinCallArgument> = choice(
    node(
      'NamedMixinArgument',
      sequence(literal('@'), lessVariableName, literal(':'), g.CallArgumentValue),
      (children, _fields, span) => {
        const name = requireSupportedVariableName(children[1], span.start, span.start + variableNameText(children[1]).length + 1);
        return callArg(requireMixinCallArgumentValue(children[3]), name);
      }
    ),
    PositionalMixinCallArgument
  );
  // In Less, a semicolon starts a new mixin argument group; commas *within*
  // that group form one list-valued argument. Keep the semicolon branch
  // transactional so ordinary comma-only calls retain their existing individual
  // argument shape.
  const MixinArgumentGroup = node(
    'MixinArgumentGroup',
    sequence(PositionalMixinCallArgument, oneOrMore(sequence(literal(','), PositionalMixinCallArgument))),
    (children) => {
      const args = children.filter(isMixinCallArgument);
      return callArg(list(args.map(argument => requireValueSlot(argument.value)), ','));
    }
  );
  const mixinSemicolonArgument = choice(g.MixinArgumentGroup, mixinCallArgument);
  const semicolonSeparatedMixinArguments = sequence(
    mixinSemicolonArgument,
    literal(';'),
    optional(sequence(
      oneOrMoreSep(
        mixinSemicolonArgument,
        literal(';')
      ),
      optional(literal(';'))
    ))
  );
  const MixinArguments = node(
    'MixinArguments',
    choice(
      attempt(semicolonSeparatedMixinArguments),
      // A comma-only call has individual arguments. Once a semicolon appears,
      // Less switches to its semicolon-group grammar above; a mixed named
      // `@a: x, @b: y; @c: z` call is invalid and must not fall through.
      sequence(
        oneOrMoreSep(
          mixinCallArgument,
          literal(',')
        ),
        optional(literal(';'))
      )
    ),
    children => mixinArgumentsFromChildren(children)
  );
  /*
   * A class/id statement has one parenthesized interior. It becomes a mixin
   * definition only when the continuation reaches `when` / `{`; otherwise it
   * is a call. Keep the shared syntax as facts until that continuation is
   * known, rather than retrying the entire parameter list as call arguments.
   */
  // A bare `@name` is a parameter binding only at an item boundary. In a call,
  // `@name - 1` is one positional value, so the boundary gate leaves that form
  // to CallArgumentValue without reparsing the variable reference.
  const mixinInteriorBoundary = choice(literal(','), literal(';'), literal(')'));
  const MixinInteriorBinding = node(
    'MixinBinding',
    sequence(
      g.VariableReference,
      choice(
        literal('...'),
        sequence(literal(':'), g.CallArgumentValue),
        peek(mixinInteriorBoundary)
      )
    ),
    (children) => {
      const reference = children[0];
      if (!isVarRef(reference)) {
        throw new TypeError('Less mixin binding lost its variable reference.');
      }
      const defaultValue = children.slice(1).find(value => isLessValueSlotValue(value) || isMixinCall(value));
      return {
        kind: 'binding',
        reference,
        ...(defaultValue === undefined ? {} : { default: requireMixinCallArgumentValue(defaultValue) }),
        rest: children.some(child => isLessTerminalText(child, '...'))
      };
    }
  );
  const MixinInteriorAnonymousRest = node(
    'MixinRestParam',
    literal('...'),
    () => ({ kind: 'anonymous-rest' })
  );
  const MixinInteriorPositional = node(
    'MixinArgument',
    g.CallArgumentValue,
    children => ({ kind: 'positional', value: requireMixinCallArgumentValue(children[0]) })
  );
  const mixinInteriorItem = choice(
    MixinInteriorBinding,
    MixinInteriorAnonymousRest,
    MixinInteriorPositional
  );
  const mixinInteriorSeparator = parser({ trivia: mixinSignatureTrivia }, commaOrSemicolon);
  const MixinInterior = node(
    'MixinInterior',
    parser({ trivia: mixinSignatureTrivia }, sequence(
      literal('('),
      optional(oneOrMoreSep(
        field('item', mixinInteriorItem),
        field('separator', mixinInteriorSeparator)
      )),
      optional(field('trailingSeparator', choice(literal(','), literal(';'))))
    )),
    (_children, fields): MixinInteriorFact => ({
      items: fields?.item === undefined
        ? []
        : requireFields(fields, 'item').map(item => requireMixinInteriorItem(item.value)),
      separators: fields?.separator === undefined
        ? []
        : requireFields(fields, 'separator').map((separator) => {
            const value = requireTerminalText(separator.value);
            if (value !== ',' && value !== ';') {
              throw new TypeError('Less mixin interior produced an invalid separator.');
            }
            return value;
          }),
      ...(fields?.trailingSeparator === undefined
        ? {}
        : (() => {
            const value = requireTerminalText(requireField(fields, 'trailingSeparator').value);
            if (value !== ',' && value !== ';') {
              throw new TypeError('Less mixin interior produced an invalid trailing separator.');
            }
            return { trailingSeparator: value };
          })())
    })
  );
  const ReferenceTail = choice(
    node(
      'ReferenceBracketTail',
      g.InterpolationAccessor,
      (children): ReferenceTailFact => {
        const accessor = requireInterpolationAccessorFact(children[0]);
        return { step: { type: 'LookupStep', kind: accessor.keyKind, name: accessor.key }, src: `[${accessor.src}]` };
      }
    ),
    node(
      'ReferenceDotTail',
      sequence(literal('.'), g.VariableNameToken),
      (children): ReferenceTailFact => {
        const name = requireToken(children[1]).value;
        return { step: { type: 'LookupStep', kind: 'member', name }, src: `.${name}` };
      }
    ),
    node(
      'ReferenceCallTail',
      sequence(literal('('), optional(g.MixinArguments), literal(')')),
      (children): ReferenceTailFact => {
        const args = mixinArgumentsFromChildren(children);
        return { step: { type: 'Call', args }, src: `(${args.map(callArgumentSource).join(', ')})` };
      }
    )
  );
  const InterpolationLastAccessorFromRouted = node(
    'InterpolationLastAccessor',
    noTrivia(routed()),
    (): InterpolationAccessorFact => ({ key: -1, keyKind: 'index', src: '-1' })
  );
  const InterpolationIndexAccessorFromRouted = node(
    'InterpolationIndexAccessor',
    noTrivia(sequence(routed(), g.InterpolationIndex, literal(']'))),
    (children): InterpolationAccessorFact => {
      const text = requireToken(children[1]).value;
      return { key: Number(text), keyKind: 'index', src: text };
    }
  );
  const InterpolationPropertyVariableAccessorFromRouted = node(
    'InterpolationPropertyVariableAccessor',
    noTrivia(sequence(routed(), literal('$'), g.VariableReference, literal(']'))),
    (children) => {
      const key = requireValueNode(children[2]);
      if (!isVarRef(key)) {
        throw new TypeError('Less property-variable map key must retain its variable reference.');
      }
      return { key, keyKind: 'prop', src: `$@${key.name}` };
    }
  );
  const InterpolationReferenceAccessorFromRouted = choice(
    node(
      'InterpolationReferenceAccessor',
      noTrivia(sequence(routed(), g.IndirectVariableReference, literal(']'))),
      (children) => {
        const key = requireValueNode(children[1]);
        if (!isVarIndirect(key) || !isVarRef(key.name)) {
          throw new TypeError('Less indirect map key must retain its variable reference.');
        }
        return { key, keyKind: 'var', src: `@@${key.name.name}` };
      }
    ),
    node(
      'InterpolationReferenceAccessor',
      noTrivia(sequence(routed(), g.VariableReference, literal(']'))),
      (children) => {
        const key = requireValueNode(children[1]);
        if (!isVarRef(key)) {
          throw new TypeError('Less variable map key must retain its variable reference.');
        }
        return { key, keyKind: 'var', src: `@${key.name}` };
      }
    ),
    node(
      'InterpolationReferenceAccessor',
      noTrivia(sequence(routed(), g.PropertyReference, literal(']'))),
      (children) => {
        const key = requireValueNode(children[1]);
        if (!isPropRef(key)) {
          throw new TypeError('Less property map key must retain its property reference.');
        }
        return { key, keyKind: 'prop', src: key.raw };
      }
    ),
    node(
      'InterpolationReferenceAccessor',
      noTrivia(sequence(routed(), g.InterpolationKey, literal(']'))),
      (children): InterpolationAccessorFact => {
        const text = requireToken(children[1]).value;
        return { key: keyword(text), keyKind: 'prop', src: text };
      }
    )
  );
  const ReferenceLastTailFromRouted = node(
    'ReferenceBracketTail',
    InterpolationLastAccessorFromRouted,
    (children): ReferenceTailFact => {
      const accessor = requireInterpolationAccessorFact(children[0]);
      return { step: { type: 'LookupStep', kind: accessor.keyKind, name: accessor.key }, src: `[${accessor.src}]` };
    }
  );
  const ReferenceBracketTailFromRouted = node(
    'ReferenceBracketTail',
    choice(
      InterpolationIndexAccessorFromRouted,
      InterpolationPropertyVariableAccessorFromRouted,
      InterpolationReferenceAccessorFromRouted
    ),
    (children): ReferenceTailFact => {
      const accessor = requireInterpolationAccessorFact(children[0]);
      return { step: { type: 'LookupStep', kind: accessor.keyKind, name: accessor.key }, src: `[${accessor.src}]` };
    }
  );
  const ReferenceDotTailFromRouted = node(
    'ReferenceDotTail',
    sequence(routed(), g.VariableNameToken),
    (children): ReferenceTailFact => {
      const name = requireToken(children[1]).value;
      return { step: { type: 'LookupStep', kind: 'member', name }, src: `.${name}` };
    }
  );
  const ReferenceCallTailFromRouted = node(
    'ReferenceCallTail',
    sequence(routed(), optional(g.MixinArguments), literal(')')),
    (children): ReferenceTailFact => {
      const args = mixinArgumentsFromChildren(children);
      return { step: { type: 'Call', args }, src: `(${args.map(callArgumentSource).join(', ')})` };
    }
  );
  const ReferenceTailFromDelimiter = dispatch(
    choice(literal('[]'), literal('['), literal('.'), literal('(')),
    when('[]', ReferenceLastTailFromRouted),
    when('[', ReferenceBracketTailFromRouted),
    when('.', ReferenceDotTailFromRouted),
    when('(', ReferenceCallTailFromRouted)
  );
  // This is the existing callable-value fact shared by `each(.mixin(), …)` and
  // `@name: .mixin()`. Keep it narrower than an ordinary MixinCall: namespace
  // paths, dynamic names, and call-level modifiers have no approved binding
  // contract in this direct slice.
  const FlatMixinCall = node(
    'MixinCall',
    sequence(
      mixinName,
      literal('('),
      optional(g.MixinArguments),
      literal(')')
    ),
    children => mixinCall(requireToken(children[0]).value, mixinArgumentsFromChildren(children))
  );
  // `each()` can iterate the emitted declaration map of an existing static
  // namespaced MixinCall.  This is intentionally narrower than statement-level
  // calls: a namespace path is required, and call-level `!important`/`;` forms
  // are not iterable values.  The resulting `path` is the ordinary MixinCall
  // path already consumed by `forItemsFromMixinCall` / `expandCall`.
  const NamespacedMixinCall = node(
    'MixinCall',
    sequence(
      mixinName,
      oneOrMore(MixinPathTail),
      literal('('),
      optional(g.MixinArguments),
      literal(')')
    ),
    (children) => {
      const head = requireToken(children[0]).value;
      const tails = children.filter(isMixinPathTail);
      const last = tails.at(-1);
      if (last === undefined) {
        throw new TypeError('Less namespaced iterable lost its final mixin name.');
      }
      const path: MixinCall['path'] = [{ combinator: ' ', selector: head }, ...tails.slice(0, -1)];
      return {
        ...mixinCall(last.selector, mixinArgumentsFromChildren(children)),
        path
      };
    }
  );
  // A variable can retain a namespaced mixin call as its lazy map value. This
  // differs from the `each()` iterable route above because Less permits a
  // call-level `!important` modifier here; the established MixinCall flag
  // carries it without a raw-value recovery or a new AST node family.
  const NamespacedMixinValue = node(
    'NamespacedMixinValue',
    sequence(
      mixinName,
      oneOrMore(MixinPathTail),
      literal('('),
      optional(g.MixinArguments),
      literal(')'),
      optional(literal('!important'))
    ),
    (children) => {
      const head = requireToken(children[0]).value;
      const tails = children.filter(isMixinPathTail);
      const last = tails.at(-1);
      if (last === undefined) {
        throw new TypeError('Less namespaced variable value lost its final mixin name.');
      }
      const path: MixinCall['path'] = [{ combinator: ' ', selector: head }, ...tails.slice(0, -1)];
      const call = {
        ...mixinCall(last.selector, mixinArgumentsFromChildren(children)),
        path
      };
      return children.some(child => isLessTerminalText(child, '!important')) ? { ...call, important: true } : call;
    }
  );
  const MixinReferenceBase = node(
    'MixinReferenceBase',
    sequence(
      mixinName,
      many(MixinPathTail),
      optional(sequence(
        literal('('),
        optional(g.MixinArguments),
        literal(')')
      ))
    ),
    (children) => {
      const head = requireToken(children[0]).value;
      const tails = children.filter(isMixinPathTail);
      const terminal = tails.at(-1);
      const call = mixinCall(terminal?.selector ?? head, mixinArgumentsFromChildren(children));
      const path: MixinCall['path'] = [{ combinator: ' ', selector: head }, ...tails.slice(0, -1)];
      const withPath = tails.length === 0 ? call : { ...call, path };
      const hasCall = children.some(child => isLessTerminalText(child, '('));
      const raw = `${head}${tails.map(tail => `${tail.combinator}${tail.selector}`).join('')}${hasCall ? `(${withPath.args.map(callArgumentSource).join(', ')})` : ''}`;
      return { call: withPath, raw };
    }
  );
  // A static namespace/mixin invocation remains the existing typed MixinCall
  // (including its selector-path combinators). Once the shared base is followed
  // by a lookup/call accessor, the whole value is a Reference. The first
  // accessor delimiter is consumed once and routed to the matching tail builder,
  // so malformed accessor bodies stay on the selected reference route instead
  // of probing forward with a broad value-position lookahead.
  const MixinReference = node(
    'MixinReference',
    sequence(
      MixinReferenceBase,
      oneOrMore(ReferenceTailFromDelimiter)
    ),
    (children, _fields, span) => {
      const base = requireMixinReferenceBaseFact(children.find(isMixinReferenceBaseFact));
      return withSourceSpan(referenceWithTails(base.call, base.raw, children.filter(isReferenceTailFact)), span);
    }
  );
  const ReferenceCall = node(
    'VarCall',
    sequence(
      literal('@'), not(word(
        'supports',
        '-_a-zA-Z0-9\\u0080-\\uFFFF',
        { caseInsensitive: true }
      )), lessVariableName, literal('('),
      optional(g.MixinArguments),
      literal(')'), optional(literal(';'))
    ),
    (children, _fields, span) => {
      const name = requireSupportedVariableName(children[1], span.start, span.start + variableNameText(children[1]).length + 1);
      const args = mixinArgumentsFromChildren(children);
      return withSourceSpan(reference(variableReference(name, 'scoped'), [{ type: 'Call', args }], `@${name}()`), span);
    }
  );
  const mixinGuardDefaultOperand = node(
    'MixinGuardDefaultOperand',
    mixinGuardDefaultCall,
    () => funcCall('default', [])
  );
  const MixinGuardOperand = node(
    'MixinGuardOperand',
    // A complete `default()` is a typed FunctionCall when used as a comparison
    // operand; the evaluator already supplies its mixin-dispatch value in that
    // exact context. Leading with that arm is the whole disambiguation needed —
    // a bare `default` is an ordinary ident SHAPE and reduces to a Keyword, as
    // less.js does (`@a: default; .m() when (@a = default)` matches there).
    // Whether that comparison means anything is a language-service fact.
    choice(
      mixinGuardDefaultOperand,
      // Guard operands reuse the ordinary typed access References. The
      // namespace branch must backtrack for ordinary non-accessor colors.
      attempt(g.MixinReference),
      g.VariableReferenceChain,
      g.Quoted,
      g.EscapedQuoted,
      g.Dimension,
      g.Color,
      g.Call,
      g.Keyword
    ),
    children => requireValueNode(children[0])
  );
  const MixinGuardTerm = node(
    'MixinGuardTerm',
    sequence(
      optional(lessWord('not')),
      choice(
        sequence(literal('('), g.MixinGuardOr, literal(')')),
        sequence(g.MixinGuardOperand, optional(sequence(mixinGuardOperator, g.MixinGuardOperand)))
      )
    ),
    (children): MixinGuard => {
      const nested = children.find(isMixinGuard);
      const values = children.filter(isValueNode);
      const operator = children.map(guardOperatorText).find((value): value is string => value !== null);
      let guard: MixinGuard;
      if (nested !== undefined) {
        guard = nested;
      } else {
        const left = values[0];
        if (left === undefined) {
          throw new TypeError('Less grammar produced a guard without a value.');
        }
        if (operator === undefined) {
          const call = isFunctionCall(left) ? left : null;
          if (call !== null && isDefaultGuardCall(call)) {
            guard = { g: 'default' };
          } else if (call !== null) {
            guard = { g: 'call', name: call.name, args: call.args.map(arg => requireValueNode(arg.value)) };
          } else {
            guard = lessGuardTruth(left);
          }
        } else {
          const right = values[1];
          if (right === undefined) {
            throw new TypeError('Less grammar produced a comparison guard without a right operand.');
          }
          /*
           * GUARD position, so the comparison lowers to the MATCH test (§4.2a).
           * This production family is reached only from `g.MixinGuard` — the
           * `when` clause of a mixin definition or a CSS guard — and both ask
           * whether a definition APPLIES. `.generic(1, true) when (@a < @b)`
           * has no ordering and therefore does not match; lessc 4.6.3 agrees,
           * and so does the owner-maintained expected CSS. Value position keeps
           * the assertion, built separately in `FunctionConditionTerm`.
           */
          guard = { g: 'match', op: operator, left, right };
        }
      }
      return children.some(child => isLessTerminalText(child, 'not')) ? { g: 'not', inner: guard } : guard;
    }
  );
  const MixinGuardAnd = node(
    'MixinGuardAnd',
    sequence(g.MixinGuardTerm, many(sequence(lessWord('and'), g.MixinGuardTerm))),
    children => foldMixinGuards('and', children)
  );
  const MixinGuardOr = node(
    'MixinGuardOr',
    sequence(g.MixinGuardAnd, many(sequence(choice(lessWord('or'), literal(',')), g.MixinGuardAnd))),
    children => foldMixinGuards('or', children)
  );
  const unparenthesizedMixinGuard = node(
    'UnparenthesizedMixinGuard',
    choice(
      sequence(
        optional(lessWord('not')),
        choice(mixinGuardDefaultOperand, g.Call),
        optional(sequence(mixinGuardOperator, g.MixinGuardOperand))
      ),
      sequence(
        optional(lessWord('not')),
        g.MixinGuardOperand,
        mixinGuardOperator,
        g.MixinGuardOperand
      )
    ),
    (_children, _fields, span) => {
      throw new LessUnparenthesizedMixinGuardError(span.start, span.end);
    }
  );
  const MixinGuardTopTerm = node(
    'MixinGuardTopTerm',
    choice(
      unparenthesizedMixinGuard,
      sequence(optional(lessWord('not')), literal('('), g.MixinGuardOr, literal(')')),
      sequence(lessWord('not'), g.MixinGuardTerm)
    ),
    (children): MixinGuard => {
      const guard = children.find(isMixinGuard);
      if (guard === undefined) {
        throw new TypeError('Less grammar produced an empty top-level grouped guard.');
      }
      return children.some(child => isLessTerminalText(child, 'not')) ? { g: 'not', inner: guard } : guard;
    }
  );
  const MixinGuardTopAnd = node(
    'MixinGuardTopAnd',
    sequence(g.MixinGuardTopTerm, many(sequence(lessWord('and'), g.MixinGuardTopTerm))),
    children => foldMixinGuards('and', children)
  );
  const MixinGuardTopOr = node(
    'MixinGuardTopOr',
    sequence(g.MixinGuardTopAnd, many(sequence(choice(lessWord('or'), literal(',')), g.MixinGuardTopAnd))),
    children => foldMixinGuards('or', children)
  );
  const MixinGuard = node(
    'MixinGuard',
    parser({ trivia: mixinGuardTrivia }, sequence(lessWord('when'), g.MixinGuardTopOr)),
    (children) => {
      const guard = children.find(isMixinGuard);
      if (guard === undefined) {
        throw new TypeError('Less grammar produced a missing mixin guard.');
      }
      return guard;
    }
  );
  // Shared block-body statement choice. Every braced Less body (mixin
  // definitions, `@supports`/media/container/generic at-rule blocks, and the
  // ruleset body via the extend-augmented reuse below) accepts this exact
  // ordered arm set. Factoring it into one named combinator keeps the arm-win
  // precedence identical across all block contexts instead of hand-copying the
  // arms per production. The root document and the detached-ruleset/`each`
  // `BodyStatement` deliberately keep their own ordered arm sets
  // because they legitimately differ (comment-first root ordering; the
  // punctuation-map arm and function/ruleset reordering in body statements).
  // `@`-led statement group. Every body context lists these eleven arms in this
  // exact contiguous order, so grouping them into one nested choice is
  // byte-identical to the flat listing (a bare `choice` passes its winning arm's
  // value through unchanged, and firstMatch order is preserved). This is the
  // structural "one at-rule choice group"; parseman already first-set-gates the
  // whole group behind a single `@` (codepoint 64) check, so a non-`@` statement
  // skips all ten arms with one integer compare. This is deliberately not a
  // `dispatch(...)` yet: Less `@name` forms need more than bare `@` or bare
  // `@name` to distinguish variable declarations, reference calls, known
  // at-rules, generic blocks, and generic statements.
  const atStatement = choice(g.ImportStatement, g.PluginDirective, g.ValueBlockDeclaration, g.VarDeclaration, g.SupportsBlock, g.MediaContainerBlock, g.ReferenceCall, g.Keyframes, g.AtRuleBlock, g.OpaqueAtRuleBlock, g.AtRuleStatement);
  // Class/id statement starts are resolved by `ClassIdStatement` below. It
  // parses the selector prefix once, then the literal-led continuation decides
  // whether the retained structure is a mixin definition/call or a ruleset.
  // Keep the unsupported dash-only spelling separate because it has a dedicated
  // public diagnostic and cannot form the shared selector prefix.
  const UnsupportedDashOnlyMixin = node(
    'UnsupportedMixinName',
    noTrivia(choice(
      sequence(choice(literal('.'), literal('#')), literal('-'), literal('('), optional(g.MixinArguments), literal(')')),
      sequence(choice(literal('.'), literal('#')), literal('-'), literal(';'))
    )),
    (_children, _fields, span) => {
      throw new LessUnsupportedMixinNameError(span.start, span.end);
    }
  );
  const mixinStatement = choice(UnsupportedDashOnlyMixin, g.ClassIdStatement);
  // Chevrotain disambiguated a nested rule from a declaration on the colon's
  // trailing trivia, not a full selector speculation: `foo: bar` (colon then
  // whitespace) is always a declaration, never a selector, because a selector
  // pseudo requires its name glued to the colon (`foo:hover`). Ruleset is tried
  // before Declaration (a bare type-selector nested rule must win over a property
  // name), so every `foo: value` otherwise parses `foo` as a type-selector
  // compound and only fails at the missing `{`. This negative lookahead skips the
  // Ruleset arm for the unambiguous `<ident><ws?>:<ws>` declaration shape, leaving
  // the rarer `foo:bar` / `@{p}:` / `foo+:` forms on the original
  // Ruleset-then-Declaration path. No real selector matches `<ident>:<ws>`, so the
  // emitted AST and PEG priority are unchanged; a `node()` boundary keeps the
  // lookahead marker from splicing into the statement list.
  const rulesetNotDeclaration = not(regex(/[-\w]+[ \t]*:[ \t\n\r\f]/));
  const guardedRuleset = node(
    'GuardedRuleset',
    sequence(rulesetNotDeclaration, g.RulesetWithExtends),
    (children) => {
      const ruleset = children.find(isRuleset);
      if (ruleset === undefined) {
        throw new TypeError('Less declaration-guarded ruleset lost its rule.');
      }
      return ruleset;
    },
    { collapse: true }
  );
  const declarationItem = node(
    'DeclarationItem',
    sequence(
      g.Declaration,
      declarationEnd
    ),
    (children) => {
      const declaration = children.find(isLessDeclaration);
      if (declaration === undefined) {
        throw new TypeError('Less declaration-list item lost its declaration fact.');
      }
      return declaration;
    },
    { collapse: true }
  );
  const stylesheetEnd = not(regex(/[\s\S]/));
  const rootDeclarationItem = node(
    'RootDeclarationItem',
    sequence(
      g.Declaration,
      choice(
        literal(';'),
        stylesheetEnd
      )
    ),
    (children) => {
      const declaration = children.find(isLessDeclaration);
      if (declaration === undefined) {
        throw new TypeError('Less root declaration item lost its declaration fact.');
      }
      return declaration;
    },
    { collapse: true }
  );
  const punctuationMapDeclarationItem = node(
    'PunctuationMapDeclarationItem',
    sequence(
      PunctuationMapDeclaration,
      declarationEnd
    ),
    (children) => {
      const declaration = children.find(isLessDeclaration);
      if (declaration === undefined) {
        throw new TypeError('Less punctuation map item lost its declaration fact.');
      }
      return declaration;
    },
    { collapse: true }
  );
  const nestedGuardedRuleset = node(
    'GuardedRuleset',
    sequence(rulesetNotDeclaration, g.NestedRulesetWithExtends),
    (children) => {
      const ruleset = children.find(isRuleset);
      if (ruleset === undefined) {
        throw new TypeError('Less guarded ruleset lost its ruleset fact.');
      }
      return ruleset;
    },
    { collapse: true }
  );
  const blockItem = choice(atStatement, mixinStatement, g.FunctionStatement, nestedGuardedRuleset, declarationItem, literal(';'));
  const blockBody = many(blockItem);
  // The ruleset body adds one extra arm (`ExtendStatement`) after the
  // shared arms. Nesting the shared choice ahead of it preserves the original
  // precedence: the shared arms (including the empty `;`) are tried in the same
  // order first, then the extend statement — behaviourally identical to the
  // former flat `choice(<shared arms>, ExtendStatement, ';')` because
  // an extend head never matches `;` or any shared arm the flat list did not.
  const rulesetBody = many(choice(blockItem, g.ExtendStatement));
  const EachName = node(
    'EachName',
    sequence(literal('@'), lessVariableName),
    (children, _fields, span) => requireSupportedVariableName(
      children[1],
      span.start,
      span.start + variableNameText(children[1]).length + 1
    )
  );
  // Detached rulesets and `each()` callbacks are both statement containers.
  // Keep their accepted content on the same grammar path as normal Less
  // bodies: reductions above construct each canonical statement, and these
  // containers merely retain those typed children.  This is deliberately not a
  // CST/tree conversion or an opaque body fallback.
  // The ruleset arm is `nestedGuardedRuleset`, the same arm `blockItem` uses:
  // a detached-ruleset body is a nested context, so a child selector may lead
  // with a combinator (`> td { … }`). Only `Stylesheet` keeps the absolute
  // `guardedRuleset`, where a leading combinator stays an error.
  const BodyStatement = choice(punctuationMapDeclarationItem, atStatement, mixinStatement, nestedGuardedRuleset, g.FunctionStatement, declarationItem, literal(';'));
  const ValueBlock = node(
    'ValueBlock',
    sequence(literal('{'), many(g.BodyStatement), optional(g.Call), literal('}')),
    children => classifyValueBlock(requireValueBlockBody(children))
  );
  const CallArgumentValue = node(
    'CallArgumentValue',
    choice(attempt(g.FlatMixinCall), g.ValueBlock, g.ValueSequence),
    (children) => {
      const value = children[0];
      if (isMixinCall(value) || isLessValueSlotValue(value)) {
        return value;
      }
      throw new TypeError('Less call argument must reduce to a value or typed mixin call.');
    }
  );
  const EachCallback = node(
    'EachCallback',
    choice(
      sequence(
        literal('{'),
        many(g.BodyStatement),
        optional(g.Call),
        literal('}')
      ),
      sequence(
        // Less anonymous mixin callbacks accept either `.(...) { ... }` or
        // `#(...) { ... }`; both lower to the same canonical For binding.
        eachCallbackSigil, literal('('), g.EachName,
        optional(sequence(commaOrSemicolon, g.EachName, optional(sequence(commaOrSemicolon, g.EachName)))),
        literal(')'), literal('{'),
        many(g.BodyStatement),
        optional(g.Call),
        literal('}')
      )
    ),
    (children): LessEachCallback => {
      if (requireToken(children[0]).value === '{') {
        return {
          binding: { kind: 'comma', names: ['value', 'key', 'index'] },
          rules: requireCallbackStatements(children.slice(1, -1))
        };
      }
      const names = children.filter((child): child is string => typeof child === 'string');
      const bodyStart = children.findIndex(child => isLessTerminalText(child, '{'));
      if (bodyStart < 0) {
        throw new TypeError('Less grammar produced a named each() callback without a body.');
      }
      const body = requireCallbackStatements(children.slice(bodyStart + 1, -1));
      if (names.length === 1) {
        return { binding: { kind: 'single', name: names[0]! }, rules: body };
      }
      if (names.length === 2 || names.length === 3) {
        return {
          binding: { kind: 'comma', names: [names[0]!, names[1]!, names[2]] },
          rules: body
        };
      }
      throw new TypeError('Less grammar produced an invalid each() callback binding.');
    }
  );
  const EachFunctionStatement = node(
    'For',
    // An inline detached ruleset is an ordinary `each()` iterable
    // (`each({ margin: m; padding: p; }, \u2026)`). It is listed here rather than in
    // ValueList because the call-only `{ \u2026 }` first set must stay out of
    // ordinary declaration values.
    sequence(
      routed(),
      choice(
        g.NamespacedMixinCall,
        g.FlatMixinCall,
        g.ValueBlock,
        g.ValueList
      ),
      choice(
        literal(','),
        literal(';')
      ),
      g.EachCallback,
      literal(')'),
      optional(literal(';'))
    ),
    (children) => {
      const callback = children.find(isLessEachCallback);
      if (callback === undefined) {
        throw new TypeError('Less each() reduction produced an invalid callback.');
      }
      const iterable = children.find(child => isMixinCall(child) || isLessValueSlotValue(child));
      if (iterable === undefined) {
        throw new TypeError('Less each() reduction produced an invalid iterable.');
      }
      return forNode(isMixinCall(iterable) ? iterable : requireValueSlot(iterable), callback.rules, callback.binding);
    }
  );
  const enclosedRaw = node(
    'EnclosedRaw',
    noTrivia(choice(g.BlockCommentToken, enclosedText)),
    children => requireToken(children[0]).value
  );
  const EnclosedQuoted = node(
    'EnclosedQuoted',
    choice(
      noTrivia(sequence(literal('"'), many(choice(g.VariableInterpolation, g.BareVariableInterpolation, enclosedDoubleChunk)), literal('"'))),
      noTrivia(sequence(literal('\''), many(choice(g.VariableInterpolation, g.BareVariableInterpolation, enclosedSingleChunk)), literal('\'')))
    ),
    enclosedInterpolationFromChildren
  );
  const EnclosedGroup = node(
    'EnclosedGroup',
    choice(
      noTrivia(sequence(literal('('), g.EnclosedContent, literal(')'))),
      noTrivia(sequence(literal('['), g.EnclosedContent, literal(']'))),
      noTrivia(sequence(literal('{'), g.EnclosedContent, literal('}')))
    ),
    enclosedInterpolationFromChildren
  );
  const EnclosedContent = node(
    'EnclosedContent',
    noTrivia(many(choice(
      g.BareVariableInterpolation,
      enclosedRaw,
      g.VariableInterpolation,
      g.EnclosedQuoted,
      g.EnclosedGroup
    ))),
    enclosedInterpolationFromChildren
  );
  const EnclosedFunctionName = node(
    'EnclosedFunctionName',
    token(noTrivia(sequence(g.QueryFunctionName, literal('(')))),
    children => ({ name: functionNameFromOpener(children[0]) })
  );
  const Enclosed = node(
    'Enclosed',
    choice(
      noTrivia(sequence(g.EnclosedFunctionName, g.EnclosedContent, literal(')'))),
      noTrivia(sequence(literal('('), g.EnclosedContent, literal(')')))
    ),
    (children) => {
      const content = children.find((child): child is Interpolation => typeof child === 'object' && child !== null && 'type' in child && child.type === 'Interpolation');
      if (content === undefined) {
        throw new TypeError('Less general-enclosed lost its grammar-owned content.');
      }
      const name = children.find((child): child is EnclosedNameFact => typeof child === 'object' && child !== null && 'name' in child);
      return name === undefined ? block(content) : funcCall(name.name, [content]);
    }
  );
  // `@supports` has its own typed condition grammar. Keep this narrower than
  // ordinary Less values: feature values are static leaf facts, logical terms
  // and nested conditions retain their authored parentheses as `Block`, and
  // functions/general-enclosed/dynamic forms fail instead of becoming raw text.
  const SupportsValue = node(
    'SupportsValue',
    g.ValueList,
    (children) => {
      const value = requireValueSlot(children[0]);
      if (isValueNode(value)) {
        return value;
      }
      return spaced(value.map(requireValueNode));
    }
  );
  const SupportsFeature = node(
    'SupportsFeature',
    sequence(
      literal('('),
      g.Identifier,
      optional(sequence(literal(':'), g.SupportsValue)),
      literal(')')
    ),
    (children, _fields, _span, _rawChildren, _triviaLog, state) => {
      const property = keyword(requireToken(children[1]).value);
      const value = children.find(isValueNode);
      return value === undefined
        ? block(property)
        : block(operation(':', property, value, false, lessMathOutsideParens(state, ':')));
    }
  );
  const SupportsInParens = node(
    'SupportsInParens',
    choice(
      sequence(literal('('), g.SupportsCondition, literal(')')),
      g.SupportsFeature,
      g.Enclosed
    ),
    children => children.length === 1
      ? requireValueNode(children[0])
      : block(requireValueNode(children[1]))
  );
  const SupportsCondition = node(
    'SupportsCondition',
    choice(
      sequence(g.QueryNot, g.SupportsInParens),
      sequence(g.SupportsInParens, many(sequence(g.QueryAndOr, g.SupportsInParens)))
    ),
    (children) => {
      const values = children.map(child => isValueNode(child)
        ? child
        : keyword(requireToken(child).value));
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const SupportsBlock = node(
    'SupportsBlock',
    sequence(
      g.SupportsAtKeyword,
      choice(g.AtRuleInterpolation, g.BareVariableInterpolation, g.SupportsCondition),
      literal('{'),
      g.blockBody,
      optional(g.Call),
      literal('}')
    ),
    (children, _fields, span, rawChildren) => withSourceSpan(
      withBlockBody(
        atRuleBlock(requireToken(children[0]).value, requireValueNode(children[1]), children.filter(isStatement)),
        rawChildren
      ),
      span
    )
  );
  const queryIdentifier = regex(/(?!(?:url)(?=\())-?[_a-zA-Z\u0080-\uffff][-_a-zA-Z0-9\u0080-\uffff]*/i);
  const queryIdentOrFunction = token(noTrivia(sequence(
    queryIdentifier,
    optional(literal('('))
  )));
  const QueryKeyword = node(
    'Keyword',
    routed(),
    children => keyword(requireToken(children[0]).value)
  );
  const QueryIdentOrFunction = dispatch(
    queryIdentOrFunction,
    caseOf('calc(', g.CalcFunction),
    when(
      endsWith('('),
      g.GenericFunction
    ),
    otherwise(QueryKeyword)
  );
  const queryLeaf = choice(g.VariableReferenceChain, g.Dimension, g.Color, g.LiteralQuoted, QueryIdentOrFunction);
  // Media/container query syntax shares CSS's grammar-owned comparison terminal
  // and canonical `Block(paren, Operation)` shape. Less only supplies the additional
  // variable-bearing value leaves; it does not capture a query prelude as raw
  // text or run a second scanner over it.
  const QueryValue = node(
    'QueryValue',
    choice(g.PreservedDivision, g.queryLeaf),
    children => requireValueNode(children[0])
  );
  // A media/container feature value may be a `<ratio>` — media-queries-4 §2.1,
  // `<number> [ / <number> ]?` — as in `(aspect-ratio >= 16/9)`. The colon form
  // already folds that slash into a typed `/` Operation through its math value;
  // the comparison and range forms took the value-position leaf, where Less's
  // `parens-division` slash group turned the same ratio into a Sequence. Fold
  // it here so every feature form — and every dialect — carries one ratio shape.
  // `style(--x: …)` keeps QueryValue above: that payload is a
  // declaration, so its slash stays a value-position slash group.
  const QueryFeatureValue = node(
    'QueryFeatureValue',
    sequence(g.queryLeaf, many(sequence(literal('/'), g.queryLeaf))),
    lessFoldOperation
  );
  const QueryBareFeature = node(
    'QueryBareFeature',
    sequence(literal('('), g.Identifier, literal(')')),
    children => block(keyword(requireToken(children[1]).value))
  );
  const QueryComparisonFeature = node(
    'QueryComparisonFeature',
    sequence(
      literal('('), g.Identifier, g.QueryComparisonOperator, g.QueryFeatureValue,
      optional(sequence(g.QueryComparisonOperator, g.QueryFeatureValue)), literal(')')
    ),
    (children, _fields, _span, _rawChildren, _triviaLog, state) => {
      const values = children.filter(isValueNode);
      const operators = lessQueryComparisonOperators(children);
      if (values.length < 1 || operators.length < 1) {
        throw new TypeError('Less query comparison lost a value or operator.');
      }
      let comparison = operation(operators[0]!, keyword(requireToken(children[1]).value), values[0]!, false,
        lessMathOutsideParens(state, operators[0]!));
      if (operators.length === 2) {
        if (values[1] === undefined) {
          throw new TypeError('Less chained query comparison lost its final value.');
        }
        comparison = operation(operators[1]!, comparison, values[1], false,
          lessMathOutsideParens(state, operators[1]!));
      }
      return block(comparison);
    }
  );
  const QueryRangeFeature = node(
    'QueryRangeFeature',
    sequence(
      literal('('), g.QueryFeatureValue, g.QueryComparisonOperator, g.Identifier,
      optional(sequence(g.QueryComparisonOperator, g.QueryFeatureValue)), literal(')')
    ),
    (children, _fields, _span, _rawChildren, _triviaLog, state) => {
      const values = children.filter(isValueNode);
      const operators = lessQueryComparisonOperators(children);
      if (values.length < 1 || operators.length < 1) {
        throw new TypeError('Less query range lost a value or operator.');
      }
      let comparison = operation(operators[0]!, values[0]!, keyword(requireToken(children[3]).value), false,
        lessMathOutsideParens(state, operators[0]!));
      if (operators.length === 2) {
        if (values[1] === undefined) {
          throw new TypeError('Less chained query range lost its final value.');
        }
        comparison = operation(operators[1]!, comparison, values[1], false,
          lessMathOutsideParens(state, operators[1]!));
      }
      return block(comparison);
    }
  );
  // Container queries permit parenthesized boolean groups, for example
  // `((width < 500px) or (height < 500px))`. The individual features retain
  // their existing typed Block(paren, Operation) representation inside the group.
  const QueryLogicalGroup = node(
    'QueryLogicalGroup',
    sequence(literal('('), g.QueryFeature, oneOrMore(sequence(g.QueryAndOr, g.QueryFeature)), literal(')')),
    children => block(spaced(children.filter(child => isValueNode(child) ? true : isLessTerminalText(child, 'and') || isLessTerminalText(child, 'or')).map(keywordOrValue)))
  );
  // Container queries permit a nested negated condition, for example
  // `(not (height > 670px))`. It is a parenthesized structural query fact,
  // not an opaque at-rule header.
  const QueryNegatedFeature = node(
    'QueryNegatedFeature',
    sequence(literal('('), g.QueryNot, g.QueryFeature, literal(')')),
    children => block(spaced([keyword(requireToken(children[1]).value), requireValueNode(children[2])]))
  );
  const QueryFeature = node(
    'QueryFeature',
    choice(QueryBareFeature, g.QueryColonFeature, QueryComparisonFeature, QueryRangeFeature, QueryLogicalGroup, QueryNegatedFeature),
    children => requireValueNode(children[0])
  );
  // `only` is a media/query modifier, not an ordinary media-type keyword.
  const QueryNonOnlyKeyword = node(
    'QueryNonOnlyKeyword',
    sequence(not(g.QueryOnly), g.Keyword),
    children => requireKeyword(children.at(-1))
  );
  const QueryTerm = node(
    'QueryTerm',
    choice(
      // A namespace/map read is a whole query term only after its required
      // accessor has succeeded; otherwise ordinary colors and mixin prefixes
      // continue to the existing query alternatives.
      attempt(g.MixinReference),
      g.QueryFeature,
      g.VariableReference,
      g.QueryNonOnlyKeyword
    ),
    children => requireValueNode(children[0])
  );
  const QueryOnlyClause = node(
    'QueryOnlyClause',
    sequence(
      g.QueryOnly,
      g.QueryNonOnlyKeyword,
      many(sequence(g.QueryAndOr, g.QueryTerm))
    ),
    (children, _fields, _span, _rawChildren, triviaLog, state) => spacedFromValueChildren(children, triviaLog, state)
  );
  // Gating note: `only` and ordinary query terms share the keyword first set.
  // `QueryNonOnlyKeyword` already rejects `only` in the generic branch; a
  // dispatch wrapper would mostly restate that negative guard without removing
  // the media/container semantic split.
  const QueryClause = node(
    'QueryClause',
    choice(
      QueryOnlyClause,
      sequence(
        g.QueryTerm,
        many(sequence(g.QueryAndOr, g.QueryTerm))
      )
    ),
    (children, _fields, _span, _rawChildren, triviaLog, state) => queryClauseReducer(children, triviaLog, state)
  );
  const QueryPrelude = node(
    'QueryPrelude',
    oneOrMoreSep(
      g.QueryClause,
      field('separator', regex(/,[ \t\n\r\f]*/))
    ),
    (children, fields, _span, rawChildren, triviaLog, state) =>
      commaListWithTriviaFromChildren(children, fields, triviaLog, state, isValueNode, rawChildren)
  );
  // Less permits a variable interpolation as an ordinary `@media` query term:
  // `@media @{all} and @{tv}`. That is not a container-query form, so retain
  // the stricter shared query prelude used by `@container` and construct this
  // media-only typed sequence from the same structural leaves.
  const MediaQueryTerm = node(
    'MediaQueryTerm',
    choice(g.AtRuleInterpolation, g.BareVariableInterpolation, g.QueryTerm),
    children => requireValueNode(children[0])
  );
  const MediaQueryOnlyClause = node(
    'MediaQueryOnlyClause',
    sequence(
      g.QueryOnly,
      g.QueryNonOnlyKeyword,
      many(sequence(g.QueryAndOr, g.MediaQueryTerm))
    ),
    (children, _fields, _span, _rawChildren, triviaLog, state) => spacedFromValueChildren(children, triviaLog, state)
  );
  const MediaQueryNotClause = node(
    'MediaQueryNotClause',
    sequence(
      g.QueryNot,
      g.MediaQueryTerm,
      many(sequence(g.QueryAndOr, g.MediaQueryTerm))
    ),
    (children, _fields, _span, _rawChildren, triviaLog, state) => spacedFromValueChildren(children, triviaLog, state)
  );
  const MediaQueryClause = node(
    'MediaQueryClause',
    choice(
      MediaQueryOnlyClause,
      MediaQueryNotClause,
      sequence(
        g.MediaQueryTerm,
        many(sequence(g.QueryAndOr, g.MediaQueryTerm))
      )
    ),
    (children, _fields, _span, _rawChildren, triviaLog, state) => queryClauseReducer(children, triviaLog, state)
  );
  const MediaQueryPrelude = node(
    'MediaQueryPrelude',
    oneOrMoreSep(
      MediaQueryClause,
      field('separator', regex(/,[ \t\n\r\f]*/))
    ),
    (children, fields, _span, rawChildren, triviaLog, state) =>
      commaListWithTriviaFromChildren(children, fields, triviaLog, state, isValueNode, rawChildren)
  );
  // A style query is a real typed container-header function. Its argument is a
  // structural custom-property comparison rather than an opaque header slice.
  const styleFunctionOpener = token(noTrivia(sequence(word(
    'style',
    '-_a-zA-Z0-9\\u0080-\\uFFFF',
    { caseInsensitive: true }
  ), literal('('))));
  const scrollStateFunctionOpener = token(noTrivia(sequence(word(
    'scroll-state',
    '-_a-zA-Z0-9\\u0080-\\uFFFF',
    { caseInsensitive: true }
  ), literal('('))));
  const ContainerStyleQuery = node(
    'ContainerStyleQuery',
    sequence(styleFunctionOpener, g.CustomPropertyToken, literal(':'), g.QueryValue, literal(')')),
    (children, _fields, _span, _rawChildren, _triviaLog, state) =>
      funcCall(functionNameFromOpener(children[0]), [operation(':', keyword(requireToken(children[1]).value),
        requireValueNode(children[3]), false, lessMathOutsideParens(state, ':'))])
  );
  const ContainerScrollStateQuery = node(
    'ContainerScrollStateQuery',
    sequence(scrollStateFunctionOpener, g.Identifier, literal(':'), g.QueryValue, literal(')')),
    (children, _fields, _span, _rawChildren, _triviaLog, state) =>
      funcCall(functionNameFromOpener(children[0]), [operation(':', keyword(requireToken(children[1]).value),
        requireValueNode(children[3]), false, lessMathOutsideParens(state, ':'))])
  );
  const ContainerName = node(
    'ContainerName',
    sequence(
      not(word(
        'none',
        '-_a-zA-Z0-9\\u0080-\\uFFFF\\\\',
        { caseInsensitive: true }
      )),
      not(g.QueryNot),
      not(g.QueryAndOr),
      g.Keyword
    ),
    children => requireKeyword(children.at(-1))
  );
  const ContainerQueryAtom = node(
    'ContainerQueryAtom',
    choice(
      g.ContainerStyleQuery,
      g.ContainerScrollStateQuery,
      g.QueryFeature
    ),
    children => requireValueNode(children[0])
  );
  const ContainerCondition = node(
    'ContainerCondition',
    choice(
      sequence(
        g.QueryNot,
        g.ContainerQueryAtom
      ),
      sequence(
        g.ContainerQueryAtom,
        many(sequence(
          g.QueryAndOr,
          g.ContainerQueryAtom
        ))
      )
    ),
    (children, _fields, _span, _rawChildren, triviaLog, state) => queryClauseReducer(children, triviaLog, state)
  );
  // A container condition is either a container-query, an optional leading
  // container name plus a query, or a name-only condition. The condition remains
  // container-query syntax, not a media-query prelude, so a second bare media
  // type cannot masquerade as a condition after the optional name.
  const ContainerConditionItem = node(
    'ContainerConditionItem',
    choice(
      g.BareVariableInterpolation,
      g.ContainerCondition,
      sequence(
        g.AtRuleInterpolation,
        g.ContainerCondition
      ),
      sequence(
        g.ContainerName,
        g.ContainerCondition
      ),
      g.ContainerName
    ),
    (children) => {
      const values = children.filter(isValueNode);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const ContainerQueryPrelude = node(
    'ContainerQueryPrelude',
    oneOrMoreSep(
      ContainerConditionItem,
      field('separator', regex(/,[ \t\n\r\f]*/))
    ),
    (children, fields, _span, rawChildren, triviaLog, state) =>
      commaListWithTriviaFromChildren(children, fields, triviaLog, state, isValueNode, rawChildren)
  );
  // Media and container headers differ, but their child statement language is
  // one shared grammar production. Keep it shared so a valid nested Less
  // construct cannot become valid in one conditional at-rule but not the other.
  const MediaContainerBody = node(
    'MediaContainerBody',
    sequence(
      literal('{'),
      g.blockBody,
      optional(g.Call),
      literal('}')
    ),
    children => children.filter(isStatement)
  );
  const MediaContainerBlock = node(
    'QueryAtRuleBlock',
    dispatch(
      token(noTrivia(g.MediaContainerAtKeyword)),
      caseOf(
        '@media',
        sequence(routed(), choice(MediaQueryPrelude, g.AtRuleInterpolation), g.MediaContainerBody)
      ),
      caseOf(
        '@container',
        sequence(routed(), ContainerQueryPrelude, g.MediaContainerBody)
      )
    ),
    (children, _fields, span) => {
      const body = children.find(Array.isArray);
      if (body === undefined) {
        throw new TypeError('Less conditional at-rule lost its body facts.');
      }
      return withSourceSpan(
        atRuleBlock(requireToken(children[0]).value, requireValueNode(children[1]), requireStatementArray(body)),
        span
      );
    }
  );
  // Keyframes use the existing canonical AtRuleBlock + Ruleset shape. Keeping the
  // header and selector list structural avoids routing valid CSS keyframes
  // through the generic Less at-rule/ruleset combination, which cannot model
  // percentage selectors as selector facts.
  // Gating note: block entries overlap on ident-led declarations and
  // function-call statements. The shared prefix is the property/call name, but
  // the deciding delimiter is `:` versus `(` / `;`, so a cosmetic dispatch on
  // the identifier would commit too early.
  const KeyframeSelector = node(
    'SimpleSelector',
    choice(keyframeEndpoint, g.Percentage),
    children => simpleSelector(requireToken(children[0]).value)
  );
  const KeyframeBlock = node(
    'KeyframeBlock',
    sequence(
      oneOrMoreSep(
        g.KeyframeSelector,
        literal(',')
      ),
      literal('{'),
      many(choice(declarationItem, g.FunctionStatement, literal(';'))),
      optional(g.Call),
      literal('}')
    ),
    (children, _fields, span, rawChildren) => {
      const selectors = children.filter(isSimpleSelector)
        .map(selector => selector);
      if (selectors.length === 0) {
        throw new TypeError('Less keyframe block requires a selector.');
      }
      return withSourceSpan(
        withBlockBody(rule(selist(...selectors), children.filter(isStatement)), rawChildren),
        span
      );
    }
  );
  const Keyframes = node(
    'Keyframes',
    sequence(
      g.KeyframesAtKeyword,
      field('prelude', choice(g.AtRuleInterpolation, g.BareVariableInterpolation, g.EscapedQuoted, g.LiteralQuoted, g.Keyword)),
      literal('{'),
      // Less permits a detached-ruleset call as a keyframes-body entry. Keep
      // that as the existing typed Reference fact so a parameterized keyframe
      // name and its body are both grammar-owned.
      many(choice(g.ReferenceCall, g.KeyframeBlock)),
      literal('}')
    ),
    (children, fields, span, rawChildren) => {
      // The keyframes body may itself contain Reference values. Select header
      // facts only from the grammar region before `{`, rather than filtering
      // every value-shaped child in the whole production.
      requireField(fields, 'prelude');
      const bodyStart = children.findIndex(child => isLessTerminalText(child, '{'));
      if (bodyStart < 0) {
        throw new TypeError('Less keyframes lost its body boundary.');
      }
      const preludeParts = children.slice(1, bodyStart).filter(isValueNode);
      if (preludeParts.length === 0) {
        throw new TypeError('Less keyframes lost their header fact.');
      }
      return withSourceSpan(withBlockBody(
        atRuleBlock(
          requireToken(children[0]).value,
          preludeParts.length === 1 ? preludeParts[0]! : spaced(preludeParts),
          children.filter(isStatement)
        ),
        rawChildren
      ), span);
    }
  );
  // A dotted layer name is one syntactic identifier, rather than a selector or
  // a post-parse string shape. Keep its spelling in the ordinary Keyword node.
  const DottedAtRuleKeyword = node(
    'DottedAtRuleKeyword',
    sequence(staticIdentifier, oneOrMore(sequence(noTrivia(literal('.')), noTrivia(staticIdentifier)))),
    children => keyword(children.map(requireTerminalText).join(''))
  );
  const atRulePreludeCustomProperty = node(
    'AtRulePreludeValueCustomProperty',
    g.CustomPropertyToken,
    children => keyword(requireToken(children[0]).value)
  );
  const atRulePreludeIdentOrFunction = token(noTrivia(sequence(staticIdentifier, optional(literal('(')))));
  const AtRulePreludeKeyword = node(
    'Keyword',
    routed(),
    children => keyword(requireToken(children[0]).value)
  );
  const AtRulePreludeIdentOrFunction = dispatch(
    atRulePreludeIdentOrFunction,
    caseOf('url(', RoutedPlainUrl),
    caseOf('calc(', g.CalcFunction),
    when(endsWith('('), g.GenericFunction),
    otherwise(AtRulePreludeKeyword)
  );
  // Generic at-rule headers have no parser-owned syntax-preserving evaluation
  // model for interpolation or parenthesized forms. Their direct subset stays
  // static; `@layer` gets its own typed interpolation alternative below.
  const AtRulePreludeValueAtom = node(
    'AtRulePreludeValueAtom',
    choice(
      g.EscapedQuoted,
      g.LiteralQuoted,
      g.Color,
      g.Dimension,
      g.PagePseudo,
      g.Paren,
      g.DottedAtRuleKeyword,
      atRulePreludeCustomProperty,
      AtRulePreludeIdentOrFunction
    ),
    children => requireValueNode(children[0])
  );
  const AtRulePreludeValueTerm = node(
    'AtRulePreludeValueTerm',
    oneOrMore(g.AtRulePreludeValueAtom),
    (children) => {
      const values = children.map(requireValueNode);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const AtRulePreludeValue = node(
    'AtRulePreludeValue',
    oneOrMoreSep(
      g.AtRulePreludeValueTerm,
      field('separator', regex(/,[ \t\n\r\f]*/))
    ),
    (children, fields) => {
      const values = children.filter(isValueNode);
      if (values.length === 1) {
        return values[0]!;
      }
      const result = list(values, ',');
      const separators = fields?.separator === undefined
        ? []
        : requireFields(fields, 'separator').map(separator => requireTerminalText(separator.value));
      return separators.length === values.length - 1 ? withValueLayout(result, separators) : result;
    }
  );
  const atPreludeWhitespace = noTrivia(regex(/[ \t\n\r\f]+/));
  const atPreludeComma = noTrivia(literal(','));
  const atPreludeGroup = noTrivia(choice(
    token(balanced(
      '(',
      ')'
    )),
    token(balanced(
      '[',
      ']'
    ))
  ));
  const atPreludeQuoted = noTrivia(choice(
    scanSkipDoubleString,
    scanSkipSingleString
  ));
  const atPreludeText = noTrivia(regex(/(?:\\[\s\S]|\/(?!\*)|[^\\/@ \t\n\r\f,;{}()[\]"'])+/));
  const AtRulePrelude = node(
    'AtRulePrelude',
    parser(
      { trivia: atPreludeCommentTrivia },
      many(choice(
        atPreludeWhitespace,
        atPreludeComma,
        atPreludeGroup,
        atPreludeQuoted,
        g.BareVariableInterpolation,
        atPreludeText
      ))
    ),
    (children, _fields, _span, _rawChildren, triviaLog) => {
      const text = staticTextWithTriviaGaps(children, triviaLog).trim();
      return text === '' ? null : any(text);
    }
  );
  const lessOpaqueAtPreludeText = noTrivia(regex(/(?:\\[\s\S]|@(?!\{)|\/(?!\*)|[^\\/@ \t\n\r\f,;{}()[\]"'])+/));
  const lessOpaqueAtPreludeCapture = many(choice(
    atPreludeWhitespace,
    atPreludeComma,
    atPreludeGroup,
    atPreludeQuoted,
    g.BareVariableInterpolation,
    lessOpaqueAtPreludeText
  ));
  // CSS-defined statement at-rules have grammar-owned interpolation forms that
  // the generic at-rule subset intentionally does not accept. Keep the
  // namespace prefix and URI as ordinary typed values; this preserves
  // `@namespace @{prefix} "…"` without widening unknown at-rules such as
  // `@custom foo@{name};` into a raw/recovered-header path.
  // Gating note: `url(` overlaps the URI-only arm with an identifier-prefixed
  // namespace in the analyzer, but the glued `url(` delimiter belongs to
  // `PlainUrl`; dispatching on bare `url` would lose that distinction.
  const NamespacePrelude = node(
    'NamespacePrelude',
    choice(
      g.PlainUrl,
      g.Quoted,
      sequence(
        choice(g.AtRuleInterpolation, g.Keyword),
        choice(g.Quoted, g.PlainUrl)
      )
    ),
    (children) => {
      const values = children.filter(isValueNode);
      const uri = values.at(-1);
      if (uri === undefined) {
        throw new TypeError('Less namespace prelude lost its URI value.');
      }
      return children.length === 1
        ? uri
        : spaced([values[0]!, uri]);
    }
  );
  const atRuleBlockBody = sequence(
    literal('{'),
    g.blockBody,
    optional(g.Call),
    literal('}')
  );
  const genericAtRuleBlockTail = choice(
    attempt(sequence(
      // Generic headers serialize as ordinary bytes. Their interpolation and
      // parenthesized forms need a dedicated syntax-preserving model, so this
      // This route deliberately leaves them closed.
      attempt(g.AtRulePreludeValue),
      atRuleBlockBody
    )),
    sequence(
      not(regex(/[ \t\n\r\f]*:/)),
      g.AtRulePrelude,
      atRuleBlockBody
    )
  );
  const AtRuleBlock = node(
    'AtRuleBlock',
    choice(
      sequence(
        layerAtRuleName,
        not(noTrivia(literal('('))),
        optional(choice(g.BareVariableInterpolation, g.InterpolatedValue, g.AtRulePreludeValue)),
        atRuleBlockBody
      ),
      sequence(
        g.AtRuleName,
        genericAtRuleBlockTail
      )
    ),
    (children, _fields, span, rawChildren) => {
      const prelude = children.find(isValueNode) ?? null;
      // A FunctionCall is a legal statement *and* a legal generic prelude
      // component. Exclude the exact selected prelude object rather than
      // reclassifying it through text or weakening the statement grammar.
      const body = children.filter(isStatement).filter(statement => statement !== prelude);
      return withSourceSpan(withBlockBody(atRuleBlock(requireToken(children[0]).value, prelude, body), rawChildren), span);
    }
  );
  const OpaqueAtPrelude = node(
    'OpaqueAtPrelude',
    parser(
      { trivia: atPreludeCommentTrivia },
      lessOpaqueAtPreludeCapture
    ),
    (children, _fields, _span, _rawChildren, triviaLog) => {
      const text = children.length === 0 ? '' : staticTextWithTriviaGaps(children, triviaLog).trim();
      return text === '' ? null : text;
    }
  );
  const OpaqueBody = node(
    'OpaqueBody',
    lessOpaqueBodyCapture,
    children => children.length === 0 ? '' : staticText(children)
  );
  /*
   * The at-rule names Less routes to a TYPED production, in one place. Every
   * name here is defined by the leaf that also matches it positively -- Less's
   * own compiler namespace plus cssSyntax's shared CSS leaves -- so the
   * positive form (`CustomValueAtKeyword`) and the two negative forms below
   * cannot drift. This replaced three hand-spelled copies of the same set.
   */
  const CustomValueAtKeyword = token(noTrivia(choice(
    lessOwnAtKeyword,
    g.ImportAtKeyword,
    g.ConditionalAtKeyword,
    g.KeyframesAtKeyword
  )));
  const StaticAtRuleStatementName = token(noTrivia(sequence(
    not(CustomValueAtKeyword),
    g.AtIdentifierUnescaped
  )));
  const AtRuleName = token(noTrivia(sequence(
    not(CustomValueAtKeyword),
    not(g.LayerAtKeyword),
    g.AtIdentifierUnescaped
  )));
  const OpaqueAtRuleBlock = node(
    'OpaqueAtRuleBlock',
    sequence(
      g.AtRuleName,
      not(regex(/[ \t\n\r\f]*:/)),
      noTrivia(sequence(
        g.OpaqueAtPrelude,
        literal('{'),
        g.OpaqueBody,
        literal('}')
      ))
    ),
    (children) => {
      const prelude = children[1];
      const rawBody = children[3];
      if ((prelude !== null && typeof prelude !== 'string') || typeof rawBody !== 'string') {
        throw new TypeError('Less opaque at-rule block lost its grammar-owned raw facts.');
      }
      return opaqueAtRuleBlock(
        requireToken(children[0]).value,
        prelude,
        rawBody
      );
    }
  );
  // CSS @charset is a single static token. Less 4 interpolated inside it, but
  // Less 5 deliberately rejects that legacy form. Recognize the authored form
  // here so the public diagnostic carries its exact grammar span instead of
  // falling through the root repetition as generic trailing input.
  const CharsetStatement = node(
    'AtRuleStatement',
    sequence(charsetAtRuleName, g.Quoted, literal(';')),
    (children, _fields, span) => {
      const prelude = requireValueNode(children[1]);
      if (prelude.type === 'Interpolation') {
        throw new LessDynamicCharsetError(span.start, span.end);
      }
      return atRuleStatement(requireToken(children[0]).value, prelude);
    }
  );
  const AtRuleStatement: Combinator<AtRuleStatement> = choice(
    CharsetStatement,
    node(
      'AtRuleStatement',
      dispatch(
        g.StaticAtRuleStatementName,
        caseOf('@namespace', sequence(routed(), g.NamespacePrelude, literal(';'))),
        caseOf(
          '@layer',
          sequence(
            routed(),
            not(noTrivia(literal('('))),
            optional(choice(g.BareVariableInterpolation, g.InterpolatedValue, g.AtRulePreludeValue)),
            literal(';')
          )
        ),
        otherwise(sequence(
          routed(),
          choice(
            attempt(sequence(
              g.AtRulePreludeValue,
              literal(';')
            )),
            sequence(
              not(regex(/[ \t\n\r\f]*:/)),
              g.AtRulePrelude,
              literal(';')
            )
          )
        ))
      ),
      (children) => {
        const routedChildren = children.flatMap(child => Array.isArray(child) ? child : [child]);
        return atRuleStatement(requireToken(routedChildren[0]).value, routedChildren.find(isValueNode) ?? null);
      }
    )
  );
  const NthPseudoArgument = node(
    'NthChildArgument',
    sequence(
      g.NthExpression,
      optional(sequence(g.NthOfKeyword, parser({ trivia: staticSelectorTrivia }, g.PseudoArgumentSelector)))
    ),
    (children) => {
      const nth = requireToken(children[0]).value;
      const selector = children.find(isLessSelectorList);
      return selector === undefined ? nth : `${nth} of ${selector.selectors.map(selectorBranchCanonical).join(',')}`;
    }
  );
  const NthPseudoSelector: Combinator<SimpleSelector> = choice(
    node(
      'NthChildPseudo',
      parser({ trivia: staticSelectorTrivia }, sequence(
        token(noTrivia(sequence(pseudoDelimiter, g.NthChildPseudoSelectorName, literal('(')))),
        g.NthPseudoArgument,
        literal(')')
      )),
      children => simpleSelector(`${requireToken(children[0]).value}${requireString(children[1])})`)
    ),
    node(
      'NthTypePseudo',
      parser({ trivia: staticSelectorTrivia }, sequence(
        token(noTrivia(sequence(pseudoDelimiter, g.NthTypePseudoSelectorName, literal('(')))),
        g.NthExpression,
        literal(')')
      )),
      children => simpleSelector(`${requireToken(children[0]).value}${requireToken(children[1]).value})`)
    )
  );
  // Less permits a variable interpolation as an An+B argument (`:nth-child(@{n})`).
  // Keep the pseudo delimiter/name, variable reference, and closing delimiter as
  // typed interpolation segments; no raw selector recovery or second parse is
  // needed when the value is substituted during evaluation.
  const InterpolatedNthPseudo = node(
    'InterpolatedNthPseudo',
    parser({ trivia: staticSelectorTrivia }, sequence(
      token(noTrivia(sequence(pseudoDelimiter, choice(g.NthChildPseudoSelectorName, g.NthTypePseudoSelectorName), literal('(')))),
      g.VariableInterpolation,
      literal(')')
    )),
    (children) => {
      const open = requireTerminalText(children[0]);
      const interpolationFact = requireInterpolationFact(children[1]);
      return interpolatedSimpleSelector(interpolation([
        { lit: open },
        { ref: interpolationFact.ref, unquote: true },
        { lit: ')' }
      ]));
    }
  );
  const extendPseudoNameOpen = parser(
    { trivia: staticSelectorTrivia },
    token(noTrivia(sequence(lessCaseWord('extend'), literal('('))))
  );
  // A functional pseudo's ARGUMENT may be interpolated (`:lang(@{lang})`,
  // `:dir(@{d})`), which no static argument grammar can recognize because the
  // argument's bytes do not exist until evaluation. Keep it structural: the
  // whole atom becomes one Interpolation-backed SimpleSelector holding typed
  // literal/ref parts, exactly like the interpolated nth and name pseudos. The
  // parser never joins it into text and never re-scans the span.
  // At least one interpolation is required, so a fully static argument stays on
  // the PseudoSelector route it already had.
  const InterpolatedArgumentPseudo = node(
    'InterpolatedArgumentPseudo',
    parser({ trivia: staticSelectorTrivia }, sequence(
      token(noTrivia(sequence(
        pseudoDelimiter,
        not(extendPseudoNameOpen),
        g.LessIdentifier,
        literal('(')
      ))),
      many(staticPseudoChunk),
      g.VariableInterpolation,
      many(choice(g.VariableInterpolation, staticPseudoChunk)),
      literal(')')
    )),
    (children) => {
      const open = requireTerminalText(children[0]);
      const parts = interpolationPartsFrom(children.slice(1, -1), true, open);
      parts.push({ lit: ')' });
      return interpolatedSimpleSelector(interpolation(parts));
    }
  );
  const pseudoArgumentInner = choice(g.PseudoArgumentGroup, g.LiteralQuoted, staticPseudoChunk);
  const PseudoArgumentGroup = node(
    'PseudoArgumentGroup',
    parser({ trivia: staticSelectorTrivia }, choice(
      sequence(literal('('), many(g.pseudoArgumentInner), literal(')')),
      sequence(literal('['), many(g.pseudoArgumentInner), literal(']'))
    )),
    (children, _fields, _span, _rawChildren, triviaLog) => staticTextWithTriviaGaps(children, triviaLog)
  );
  const PseudoArgumentText = node(
    'PseudoArgumentText',
    parser({ trivia: staticSelectorTrivia }, oneOrMore(g.pseudoArgumentInner)),
    (children, _fields, _span, _rawChildren, triviaLog) => staticTextWithTriviaGaps(children, triviaLog)
  );
  // A functional pseudo's static selector argument is the same recursive
  // selector grammar as a rule header. `rules()` names the cycle at macro
  // lowering (`pseudo argument -> selector -> compound -> pseudo`), so this
  // retains structural selector facts without a text scanner or a reparse.
  // Keep it local, like CSS's generic pseudo argument: it is an implementation
  // component of the public pseudo production, not a second parser API.
  // Retain the parsed `SelectorList` rather than collapsing it to text. A
  // whitelisted selector-function pseudo (`:is`/`:not`/…) keeps it as structured
  // `args`; `PseudoSelector` joins the opaque `:global`/`:local`
  // fallback via `selectorBranchCanonical`. The parser never bakes the inline
  // `:is(a, b)` spelling — core serialization owns that.
  const pseudoSelectorArgument = node(
    'PseudoSelectorArgument',
    parser({ trivia: staticSelectorTrivia }, g.PseudoArgumentSelector),
    children => requireSelectorList(children[0])
  );
  // This selector family is private to functional pseudo arguments.  A block
  // comment immediately between two simple selectors is lexical trivia, not a
  // descendant relation (`.a/*x*/.b` is one compound); actual whitespace still
  // belongs to the complex-tail descendant boundary.
  const PseudoArgumentCompound = node(
    'PseudoArgumentCompound',
    parser(
      { trivia: compoundSelectorTrivia },
      oneOrMore(choice(g.NamespaceTypeSelector, staticSimpleSelector, staticAmpersand, g.PseudoSelector, g.NthPseudoSelector, g.AttributeSelector))
    ),
    children => lessSelectorTermFromTokens(children.map((child) => {
      return isLessSimpleToken(child) ? child : simpleSelector(requireToken(child).value);
    }))
  );
  // This selector family is private to functional pseudo arguments.  Its tail
  // admits Less selector trivia immediately before the next compound, so
  // `.a /* note */ > /* note */ .b` remains one structured complex selector.
  // The ordinary outer selector folds its combinator tail inline (there is no
  // `ComplexTail` node), and its no-trivia compound boundary is intentionally
  // unchanged.
  const PseudoArgumentComplex = node(
    'PseudoArgumentComplex',
    sequence(
      optional(relativeSelectorCombinator),
      g.PseudoArgumentCompound,
      many(sequence(not(whenGuardAhead), optional(staticCombinator), parser({ trivia: staticSelectorTrivia }, g.PseudoArgumentCompound)))
    ),
    (children) => {
      const first = children[0];
      const leading = (isLessTerminalText(first, '>') || isLessTerminalText(first, '+') || isLessTerminalText(first, '~')) ? first : undefined;
      const branch = selectorBranchOf(complexSegmentsFrom(children));
      return leading === undefined ? branch : relativeSelector(requireCombinator(leading), lessBranchSegments(branch));
    }
  );
  const PseudoArgumentSelectorTail = node(
    'PseudoArgumentSelectorTail',
    sequence(literal(','), parser({ trivia: staticSelectorTrivia }, g.PseudoArgumentComplex)),
    children => children.find(isLessSelectorBranch)!
  );
  const PseudoArgumentSelector = node(
    'PseudoArgumentSelector',
    sequence(g.PseudoArgumentComplex, many(g.PseudoArgumentSelectorTail)),
    children => selist(...selectorBranchesFrom(children))
  );
  // `*[ … ]` is only the glued capture delimiter around the existing static
  // selector-list grammar. It is a selector-valued Less value, not a text
  // capture: the selector grammar owns every branch boundary and the AST keeps
  // the canonical branches for selector interpolation.
  const SelectorCapture = node(
    'SelectorCapture',
    sequence(noTrivia(literal('*[')), parser({ trivia: staticSelectorTrivia }, g.PseudoArgumentSelector), noTrivia(literal(']'))),
    (children) => {
      const selector = requireSelectorList(children[1]);
      const branches = selector.selectors.map(selectorBranchCanonical);
      return selectorCapture(branches, `*[${branches.join(', ')}]`);
    }
  );
  const pseudoOpen = token(noTrivia(sequence(
    regex(/::?(?![ \t\n\r\f])/),
    not(extendPseudoNameOpen),
    not(g.NthPseudoSelectorName),
    g.LessIdentifier,
    optional(literal('('))
  )));
  const pseudoSelectorRouted = node(
    'PseudoSelector',
    sequence(routed(), pseudoSelectorArgument, literal(')')),
    children => staticSelectorPseudoFrom(
      requireToken(children[0]).value.slice(0, -1),
      children[1]
    )
  );
  const interpolatedArgumentPseudoRouted = node(
    'InterpolatedArgumentPseudo',
    sequence(
      routed(),
      many(staticPseudoChunk),
      g.VariableInterpolation,
      many(choice(g.VariableInterpolation, staticPseudoChunk)),
      literal(')')
    ),
    (children) => {
      const open = requireToken(children[0]).value;
      const parts = interpolationPartsFrom(children.slice(1, -1), true, open);
      parts.push({ lit: ')' });
      return interpolatedSimpleSelector(interpolation(parts));
    }
  );
  const staticNonSelectorPseudoRouted = node(
    'GenericPseudo',
    sequence(routed(), g.PseudoArgumentText, literal(')')),
    children => staticNonSelectorPseudoFrom(
      requireToken(children[0]).value.slice(0, -1),
      requireString(children[1])
    )
  );
  const staticBarePseudoRouted = node(
    'GenericPseudo',
    routed(),
    children => staticNonSelectorPseudoFrom(requireToken(children[0]).value, null)
  );
  const pseudo = dispatch(
    pseudoOpen,
    caseOf(
      [':is(', '::is(', ':not(', '::not(', ':has(', '::has(', ':where(', '::where(', ':matches(', '::matches(', ':global(', '::global(', ':local(', '::local('],
      choice(pseudoSelectorRouted, interpolatedArgumentPseudoRouted)
    ),
    when(
      endsWith('('),
      choice(interpolatedArgumentPseudoRouted, staticNonSelectorPseudoRouted)
    ),
    otherwise(staticBarePseudoRouted)
  );
  // `:extend(...)` is an inline-extend production, not a pseudo. Like ordinary
  // function openers, every pseudo-function opener is glued, so
  // `:extend /*...*/ (` must not fall through as a generic pseudo or reparsed
  // selector surface.
  const staticPseudoDispatch = dispatch(
    pseudoOpen,
    caseOf(
      [':is(', '::is(', ':not(', '::not(', ':has(', '::has(', ':where(', '::where(', ':matches(', '::matches(', ':global(', '::global(', ':local(', '::local('],
      pseudoSelectorRouted
    ),
    when(
      endsWith('('),
      staticNonSelectorPseudoRouted
    ),
    otherwise(staticBarePseudoRouted)
  );
  const PseudoSelector = node(
    'PseudoSelector',
    staticPseudoDispatch,
    children => children.find(isLessSimpleToken)!
  );
  // A Less pseudo name may itself be interpolated (`:@{pseudo}` / `::@{pseudo}`)
  // and remains one interpolation-backed selector atom. Keep the delimiter and
  // interpolation structural so evaluation can substitute the name without a
  // selector-string reparse.
  const InterpolatedPseudo = node(
    'InterpolatedPseudo',
    noTrivia(sequence(pseudoDelimiter, g.VariableInterpolation)),
    (children) => {
      const delimiter = requireTerminalText(children[0]);
      const interpolationFact = requireInterpolationFact(children[1]);
      return interpolatedSimpleSelector(interpolation([
        { lit: delimiter },
        { ref: interpolationFact.ref, unquote: true }
      ]));
    }
  );
  const AttributeNamespace = node(
    'AttributeNamespace',
    choice(
      // `|=` is the CSS attribute operator, not a namespace separator. Guard
      // the namespace arm before consuming `|` so a quoted interpolation after
      // `prop|=` remains on the ordinary attribute-value route.
      sequence(staticIdentifier, literal('|'), not(literal('='))),
      literal('*|'),
      literal('|')
    ),
    children => children.map(requireToken).map(token => token.value).join('')
  );
  const NamespaceTypeSelector = node(
    'NamespaceTypeSelector',
    sequence(g.AttributeNamespace, choice(staticIdentifier, literal('*'))),
    children => simpleSelector(children.map(requireTerminalText).join(''))
  );
  const AttributeName = node(
    'AttributeName',
    sequence(optional(g.AttributeNamespace), staticIdentifier),
    children => ({
      namespace: children.find((child): child is string => typeof child === 'string') ?? '',
      name: requireToken(children.at(-1)).value
    })
  );
  // Less's attribute name/value interpolation is one complete selector token.
  // Keep every literal delimiter and every interpolation reference (`@{…}` and
  // `${…}`) as an `Interpolation` part rather than recovering the bracket text
  // after parsing. Dynamic pseudos and extend headers remain separate, rejected forms.
  // Attribute name and value interpolation share one grammar body; the reducers
  // differ only by whether each reference part is unquoted (name) or kept quoted
  // (value, so `[data=@{value}]` retains its source spelling).
  const attributeInterpolationTokenBody = noTrivia(sequence(
    optional(choice(g.InterpolatedValueStart, g.InterpolatedValueDash)),
    g.Interpolation,
    many(g.interpolatedValueTail)
  ));
  const InterpolatedAttributeToken = node(
    'InterpolatedAttributeToken',
    attributeInterpolationTokenBody,
    children => interpolation(interpolationPartsFrom(children, true))
  );
  const InterpolatedAttributeValueToken = node(
    'InterpolatedAttributeValueToken',
    attributeInterpolationTokenBody,
    children => interpolation(interpolationPartsFrom(children, false))
  );
  const InterpolatedAttributeQuoted = node(
    'InterpolatedAttributeQuoted',
    choice(
      noTrivia(sequence(literal('"'), many(choice(g.VariableInterpolation, g.QuotedDoubleText, literal('@'), literal('$'))), literal('"'))),
      noTrivia(sequence(literal('\''), many(choice(g.VariableInterpolation, g.QuotedSingleText, literal('@'), literal('$'))), literal('\'')))
    ),
    children => interpolation(interpolationPartsFrom(children, true))
  );
  const AttributeMatch = node(
    'AttributeMatch',
    sequence(
      g.AttributeOperator,
      choice(staticIdentifier, g.LiteralQuoted),
      optional(g.AttributeModifier)
    ),
    children => ({
      operator: requireToken(children[0]).value,
      value: staticText(children[1]),
      modifier: children.length === 2 ? null : requireToken(children[2]).value
    })
  );
  /*
   * Inside `[` … `]` whitespace is trivia, exactly as it is in the CSS base.
   * selectors-4 §6 puts optional whitespace on both sides of the matcher and
   * before the modifier, so `[data-x = y i]` is valid CSS and every superset
   * must accept it. The separation of the unquoted value from the modifier is
   * carried by ident tokenization — `[a=yi]` is one greedy `staticIdentifier`,
   * `[a=y i]` is two — not by a mandatory whitespace terminal, which is what
   * rejected the spaced spellings. The `[` itself keeps the ambient compound
   * trivia, so a comment before it still joins one compound and `a [b]` stays
   * a descendant relation.
   */
  const AttributeSelector = node(
    'AttributeSelector',
    sequence(
      literal('['),
      parser(
        { trivia: staticSelectorTrivia },
        sequence(g.AttributeName, optional(g.AttributeMatch), literal(']'))
      )
    ),
    (children) => {
      const match = children.find((child): child is AttributeMatchFact =>
        typeof child === 'object' && child !== null && 'operator' in child && 'value' in child && 'modifier' in child
      );
      const name = children.find((child): child is AttributeNameFact =>
        typeof child === 'object' && child !== null && 'namespace' in child && 'name' in child
      );
      if (name === undefined) {
        throw new TypeError('Less grammar produced an attribute selector without a name.');
      }
      return simpleSelector(`[${name.namespace}${name.name}${match === undefined ? '' : `${match.operator}${match.value}${match.modifier === null ? '' : ` ${match.modifier}`}`}]`);
    }
  );
  const InterpolatedAttributeSelector = node(
    'InterpolatedAttributeSelector',
    sequence(
      literal('['),
      choice(
        sequence(
          optional(g.AttributeNamespace),
          g.InterpolatedAttributeToken,
          optional(sequence(
            g.AttributeOperator,
            choice(g.InterpolatedAttributeValueToken, g.InterpolatedAttributeQuoted, g.LessIdentifier, g.LiteralQuoted),
            optional(sequence(selectorAttributeModifierSpace, g.AttributeModifier))
          ))
        ),
        sequence(
          g.AttributeName,
          g.AttributeOperator,
          choice(g.InterpolatedAttributeValueToken, g.InterpolatedAttributeQuoted),
          optional(sequence(selectorAttributeModifierSpace, g.AttributeModifier))
        )
      ),
      literal(']')
    ),
    (children) => {
      const parts: Interpolation['parts'] = [];
      for (const child of children) {
        if (isInterp(child)) {
          for (const part of child.parts) {
            if ('lit' in part) {
              appendInterpolationLiteral(parts, part.lit);
            } else {
              parts.push(part);
            }
          }
        } else if (isAttributeNameFact(child)) {
          const name = child;
          appendInterpolationLiteral(parts, `${name.namespace}${name.name}`);
        } else if (typeof child === 'string') {
          appendInterpolationLiteral(parts, child);
        } else {
          appendInterpolationLiteral(parts, requireToken(child).value);
        }
      }
      return interpolatedSimpleSelector(interpolation(parts));
    }
  );
  const BareInterpolatedSelector = node(
    'BareInterpolatedSelector',
    sequence(g.VariableInterpolation, bareInterpolatedSelectorEnd),
    (children) => {
      const fact = requireInterpolationFact(children[0]);
      return interpolatedSimpleSelector(interpolation([{ ref: fact.ref, unquote: true }]));
    }
  );
  // Adjacent selector interpolations are one compound simple, not two selector
  // branches. Keep this arm separate from literal suffixes so Parseman's
  // generated choice commits on the second `@{…}` without treating it as a
  // static selector-tail byte sequence.
  const AdjacentInterpolatedSelector = node(
    'AdjacentInterpolatedSelector',
    noTrivia(sequence(g.VariableInterpolation, oneOrMore(g.VariableInterpolation))),
    children => interpolatedSimpleSelector(interpolation(interpolationPartsFrom(children, true)))
  );
  // A bare interpolation may be followed by a glued selector simple, such as
  // `@{base}.bbb`. Keep that suffix as an interpolation literal segment rather
  // than recovering a completed selector string after parse.
  const BareInterpolatedSelectorWithSuffix = node(
    'BareInterpolatedSelectorWithSuffix',
    noTrivia(sequence(g.VariableInterpolation, oneOrMore(choice(interpolatedSelectorTail, staticSimpleSelector)))),
    children => interpolatedSimpleSelector(interpolation(interpolationPartsFrom(children, true)))
  );
  const InterpolatedSimpleSelector = node(
    'InterpolatedSimpleSelector',
    noTrivia(sequence(
      interpolatedSelectorPrefix,
      g.VariableInterpolation,
      many(choice(interpolatedSelectorTail, g.VariableInterpolation))
    )),
    children => interpolatedSimpleSelector(interpolation(interpolationPartsFrom(children, true)))
  );
  // `&` plus a glued Less interpolation is one parent-suffix selector token,
  // not a static parent selector followed by a second compound member. The
  // existing Interpolation-backed SimpleSelector is its complete canonical model.
  const InterpolatedParentSuffix = node(
    'InterpolatedParentSuffix',
    noTrivia(sequence(
      staticAmpersand,
      g.VariableInterpolation,
      many(choice(interpolatedSelectorTail, g.VariableInterpolation))
    )),
    children => interpolatedSimpleSelector(interpolation(interpolationPartsFrom(children, true)))
  );
  const compoundSimple = choice(
    g.InterpolatedParentSuffix,
    g.InterpolatedSimpleSelector,
    g.AdjacentInterpolatedSelector,
    g.BareInterpolatedSelectorWithSuffix,
    g.BareInterpolatedSelector,
    g.NamespaceTypeSelector,
    staticSimpleSelector,
    staticAmpersand,
    // Generic and selector pseudos (`:hover`, `::before`, `:not(...)`) dominate
    // real selectors; the two nth arms and the interpolated-name arm are rare.
    // PseudoSelector carries the generic/selector case and is name-set
    // disjoint from the other three — its NonSelectorPseudo `not(nth-name)` /
    // `not(selector-name)` guards and its SelectorPseudo name regex mean it can
    // never match an nth pseudo or an interpolated-name pseudo (`:@{n}`). So
    // trying it first lets the common pseudo commit on the first arm instead of
    // paying four failed `::?`+name re-scans through the nth/interp arms, while a
    // rare nth/interp pseudo still falls through to its arm with output and PEG
    // priority unchanged.
    pseudo,
    g.InterpolatedNthPseudo,
    g.NthPseudoSelector,
    g.InterpolatedArgumentPseudo,
    g.InterpolatedPseudo,
    g.AttributeSelector,
    g.InterpolatedAttributeSelector
  );
  /*
   * Statement-position class/id starts share their parsed selector prefix with
   * mixin paths. `(` and `;` later select the mixin tails; selector punctuation
   * continues from this same branch. The first simple is deliberately the
   * class/id-only mixin name, while the rest of the compound and complex path
   * retain the ordinary selector productions and their exact AST structure.
   */
  const ClassIdCompound = node(
    'CompoundSelector',
    parser({ trivia: compoundSelectorTrivia }, sequence(mixinName, many(compoundSimple))),
    children => lessSelectorTermFromTokens(children.map((child) => {
      return isLessSimpleToken(child) ? child : simpleSelector(requireToken(child).value);
    }))
  );
  const ClassIdSelectorPrefix = node(
    'SelectorBranch',
    sequence(
      ClassIdCompound,
      many(sequence(not(whenGuardAhead), optional(staticCombinator), g.CompoundSelector))
    ),
    (children, _fields, span) => ({
      selector: withSourceSpan(selectorBranchOf(complexSegmentsFrom(children)), span),
      extensions: []
    })
  );
  const CompoundSelector: Combinator<SelectorTerm> = node(
    'CompoundSelector',
    // Production's CompoundSelector is a run of adjacent simple selectors.
    // Keep that same structural distinction here: `.a#id` is one CompoundSelector with
    // two SimpleSelector children, not a recovered selector string. Static pseudos use
    // the same canonical SimpleSelector representation. The exact shared An+B terminal
    // is also direct; arbitrary pseudo arguments, attributes, and interpolation
    // remain outside this slice until their own typed payloads have reductions.
    // The functional form precedes its no-argument prefix so ordered choice does
    // not commit `:nth-child` before seeing the opening parenthesis.
    parser({ trivia: compoundSelectorTrivia }, oneOrMore(compoundSimple)),
    (children) => {
      const simples = children.map(child => isLessSimpleToken(child) ? child : simpleSelector(requireToken(child).value));
      return lessSelectorTermFromTokens(simples);
    }
  );
  const ComplexSelector = node(
    'ComplexSelector',
    sequence(
      g.CompoundSelector,
      many(sequence(not(whenGuardAhead), optional(staticCombinator), g.CompoundSelector))
    ),
    (children, _fields, span) => withSourceSpan(selectorBranchOf(complexSegmentsFrom(children)), span)
  );
  const RelativeComplex = node(
    'RelativeComplexSelector',
    sequence(
      optional(relativeSelectorCombinator),
      g.ComplexSelector
    ),
    (children, _fields, span) => {
      const branch = children.find(isLessSelectorBranch)!;
      const leading = children.find(child => isLessTerminalText(child, '>') || isLessTerminalText(child, '+') || isLessTerminalText(child, '~'));
      return withSourceSpan(leading === undefined ? branch : relativeSelector(requireCombinator(leading), lessBranchSegments(branch)), span);
    }
  );
  const SelectorList = node(
    'SelectorList',
    parser({ trivia: outerSelectorTrivia }, oneOrMoreSep(g.ComplexSelector, literal(','))),
    (children, _fields, span) => withSourceSpan(selist(...selectorBranchesFrom(children)), span)
  );
  const RelativeSelector = node(
    'SelectorList',
    parser({ trivia: outerSelectorTrivia }, sequence(g.RelativeComplex, many(sequence(literal(','), g.ComplexSelector)))),
    (children, _fields, span) => withSourceSpan(selist(...selectorBranchesFrom(children)), span)
  );
  const extendAllFlag = regex(/!?all(?![-_a-zA-Z0-9\u0080-\uffff])/i);
  const InlineExtendSubjectCompound = node(
    'InlineExtendSubjectCompound',
    parser(
      { trivia: compoundSelectorTrivia },
      oneOrMore(choice(g.NamespaceTypeSelector, staticSimpleSelector, staticAmpersand, pseudo, g.NthPseudoSelector, g.AttributeSelector))
    ),
    children => lessSelectorTermFromTokens(children.map(child => isLessSimpleToken(child) ? child : simpleSelector(requireToken(child).value)))
  );
  const InlineExtendSubjectComplexTail = node(
    'InlineExtendSubjectComplexTail',
    sequence(optional(staticCombinator), InlineExtendSubjectCompound),
    combinatorTailReducer
  );
  const ExtendComplex = node(
    'ComplexSelector',
    sequence(
      InlineExtendSubjectCompound,
      many(sequence(not(regex(/[ \t\n\r\f]*!?all(?=[ \t\n\r\f]*(?:,|\)))/i)), InlineExtendSubjectComplexTail))
    ),
    (children, _fields, span) => withSourceSpan(selectorBranchOf([
      { term: children.find(isSelectorTerm)! },
      // The terminal-flag lookahead is a recognition-only child. Keep only
      // actual tail facts: otherwise the successful stop check is emitted as
      // a fake descendant tail with no compound.
      ...children.slice(1).filter(isComplexTailFact)
    ]), span)
  );
  const ExtendTargetComplex = node(
    'ComplexSelector',
    sequence(
      // An extend target can carry a typed selector interpolation, unlike its
      // inline subject. Keep `.@{name}` in the AST rather than rescanning it.
      g.CompoundSelector,
      many(sequence(not(regex(/[ \t\n\r\f]*!?all(?=[ \t\n\r\f]*(?:,|\)))/i)), optional(staticCombinator), g.CompoundSelector))
    ),
    (children, _fields, span) => withSourceSpan(selectorBranchOf(complexSegmentsFrom(children)), span)
  );
  const ExtendTarget = node(
    'ExtendTarget',
    sequence(ExtendTargetComplex, optional(extendAllFlag)),
    children => ({
      target: selist(children.find(isLessSelectorBranch)!),
      partial: children.some(child => isLessTerminalText(child, 'all') || isLessTerminalText(child, '!all'))
    })
  );
  const ExtendPseudo = node(
    'ExtendPseudo',
    sequence(
      noTrivia(sequence(literal(':'), literal('extend'), literal('('))),
      oneOrMoreSep(
        g.ExtendTarget,
        literal(',')
      ),
      literal(')')
    ),
    children => children.filter(isExtendTargetFact)
  );
  const selectorBranchBoundary = peek(choice(literal(','), whenGuardAhead, literal('{')));
  // A body-form `&:extend(...)` applies to the WHOLE carrying rule selector, so
  // its instructions carry no `subject` (see `ExtendInstruction`: absent subject
  // means whole-rule). That is the opposite of an inline `.a:extend(...)`, which
  // binds to its own branch. The two are indistinguishable as bare `{target,
  // partial}` arrays, so the body form reduces to its own fact instead; a ruleset
  // reducer that mixed them stamped the first branch onto every body extend and
  // silently dropped the rest of a comma list.
  const ExtendStatement = node(
    'ExtendStatement',
    sequence(literal('&'), ExtendPseudo, optional(literal(';'))),
    children => ({
      bodyExtensions: children
        .flatMap(child => Array.isArray(child) ? child.filter(isExtendTargetFact) : [])
        .map(target => ({ target: target.target, partial: target.partial }))
    })
  );
  const selectorBranchContinuation = choice(
    sequence(ExtendPseudo, selectorBranchBoundary),
    selectorBranchBoundary
  );
  const SelectorBranch = node(
    'SelectorBranch',
    sequence(ExtendComplex, selectorBranchContinuation),
    (children) => {
      const subject = children.find(isLessSelectorBranch)!;
      const extensions = children
        .filter(Array.isArray)
        .flatMap(child => child.filter(isExtendTargetFact))
        .map(target => ({ target: target.target, partial: target.partial, subject: selist(subject) }));
      return { selector: subject, extensions };
    }
  );
  const DynamicSelectorBranch = node(
    'SelectorBranch',
    g.ComplexSelector,
    children => ({ selector: children.find(isLessSelectorBranch)!, extensions: [] })
  );
  const selectorBranch = choice(SelectorBranch, DynamicSelectorBranch);
  const SelectorBranchTail = node(
    'SelectorBranch',
    sequence(literal(','), selectorBranch),
    (children) => {
      const branch = children.find(isSelectorBranchFact);
      if (branch === undefined) {
        throw new TypeError('Less selector list tail lost its selector branch.');
      }
      return branch;
    }
  );
  const selectorListWithExtends = node(
    'SelectorListWithExtends',
    parser(
      { trivia: outerSelectorTrivia },
      oneOrMoreSep(
        selectorBranch,
        literal(',')
      )
    ),
    (children, _fields, span) => ({
      selector: withSourceSpan(selist(...children.flatMap(child => isSelectorBranchFact(child)
        ? [child.selector]
        : [])), span),
      extensions: children.filter(isSelectorBranchFact).flatMap(branch => branch.extensions)
    })
  );
  const relativeSelectorListWithExtends = node(
    'SelectorListWithExtends',
    parser(
      { trivia: outerSelectorTrivia },
      oneOrMoreSep(
        choice(SelectorBranch, node(
          'SelectorBranch',
          g.RelativeComplex,
          children => ({ selector: children.find(isLessSelectorBranch)!, extensions: [] })
        )),
        literal(',')
      )
    ),
    (children, _fields, span) => ({
      selector: withSourceSpan(selist(...children.flatMap(child => isSelectorBranchFact(child)
        ? [child.selector]
        : [])), span),
      extensions: children.filter(isSelectorBranchFact).flatMap(branch => branch.extensions)
    })
  );
  const RulesetWithExtends = node(
    'Ruleset',
    sequence(selectorListWithExtends, optional(g.MixinGuard), literal('{'), rulesetBody, optional(g.Call), literal('}'), optional(literal(';'))),
    (children, _fields, span, rawChildren) => {
      const selectorFact = requireSelectorListWithExtendsFact(children[0]);
      const bodyExtensions = children.filter(isBodyExtendFact).flatMap(fact => fact.bodyExtensions);
      const extensions = [...selectorFact.extensions, ...bodyExtensions];
      const node = withBlockBody(
        rule(
          selectorFact.selector,
          // The fixed sequence places only direct declaration/comment facts between
          // the braces. This validates that fact list; it never reparses body text.
          requireRulesetBody(children.filter(isStatement)),
          extensions.length === 0 ? undefined : extensions,
          children.find(isMixinGuard)
        ),
        rawChildren
      );
      return hasRulesetTerminator(rawChildren) ? withSourceSpan(node, span) : node;
    }
  );
  const NestedRulesetWithExtends = node(
    'Ruleset',
    sequence(relativeSelectorListWithExtends, optional(g.MixinGuard), literal('{'), rulesetBody, optional(g.Call), literal('}'), optional(literal(';'))),
    (children, _fields, span, rawChildren) => {
      const selectorFact = requireSelectorListWithExtendsFact(children[0]);
      const bodyExtensions = children.filter(isBodyExtendFact).flatMap(fact => fact.bodyExtensions);
      const extensions = [...selectorFact.extensions, ...bodyExtensions];
      const node = withBlockBody(
        rule(
          selectorFact.selector,
          requireRulesetBody(children.filter(isStatement)),
          extensions.length === 0 ? undefined : extensions,
          children.find(isMixinGuard)
        ),
        rawChildren
      );
      return hasRulesetTerminator(rawChildren) ? withSourceSpan(node, span) : node;
    }
  );
  const MixinDefinitionContinuation = node(
    'MixinDefinition',
    parser({ trivia: mixinSignatureTrivia }, sequence(
      literal(')'),
      choice(
        sequence(g.MixinGuard, optional(mixinSignatureGap), literal('{')),
        literal('{')
      ),
      g.blockBody,
      optional(g.Call),
      literal('}'),
      optional(literal(';'))
    )),
    (children, _fields, _span, rawChildren) => {
      const bodySpan = bodySpanFromRaw(rawChildren);
      return {
        params: [],
        ...(children.find(isMixinGuard) === undefined ? {} : { guard: children.find(isMixinGuard) }),
        rules: children.filter(isStatement),
        ...(bodySpan === undefined ? {} : { bodySpan })
      };
    }
  );
  const MixinCallContinuation = node(
    'MixinCall',
    parser({ trivia: mixinSignatureTrivia }, sequence(
      literal(')'),
      not(whenGuardAhead),
      optional(literal('!important')),
      optional(literal(';'))
    )),
    children => ({
      args: [],
      important: children.some(child => isLessTerminalText(child, '!important'))
    })
  );
  const MixinStatementTail = node(
    'MixinStatement',
    sequence(g.MixinInterior, choice(attempt(MixinDefinitionContinuation), MixinCallContinuation)),
    (children) => {
      const interior = children.find((value): value is MixinInteriorFact =>
        typeof value === 'object' && value !== null && 'items' in value && 'separators' in value
      );
      if (interior === undefined) {
        throw new TypeError('Less mixin statement lost its parenthesized interior.');
      }
      const definition = children.find(isMixinDefinitionFact);
      if (definition !== undefined) {
        return { ...definition, params: mixinParamsFromInterior(interior) };
      }
      const call = children.find(isMixinCallFact);
      if (call === undefined) {
        throw new TypeError('Less mixin statement lost its continuation.');
      }
      return { ...call, args: mixinCallArgsFromInterior(interior) };
    }
  );
  const BareMixinCall = node(
    'MixinCall',
    sequence(optional(literal('!important')), literal(';')),
    children => ({ important: children.some(child => isLessTerminalText(child, '!important')) })
  );
  const RulesetTail = node(
    'Ruleset',
    sequence(
      selectorBranchContinuation,
      many(g.SelectorBranchTail),
      optional(g.MixinGuard),
      literal('{'),
      rulesetBody,
      optional(g.Call),
      literal('}'),
      optional(literal(';'))
    ),
    (children, _fields, _span, rawChildren) => {
      const bodySpan = bodySpanFromRaw(rawChildren);
      return {
        firstExtensions: children
          .filter(Array.isArray)
          .flatMap(values => values.filter(isExtendTargetFact)),
        branches: children.filter(isSelectorBranchFact),
        selectorEnd: requiredTokenStart(rawChildren, '{'),
        ...(children.find(isMixinGuard) === undefined ? {} : { guard: children.find(isMixinGuard) }),
        rules: children.filter(isStatement),
        extensions: children.filter(isBodyExtendFact).flatMap(fact => fact.bodyExtensions),
        ...(bodySpan === undefined ? {} : { bodySpan }),
        ...(hasRulesetTerminator(rawChildren) ? { terminated: true } : {})
      };
    }
  );
  const ClassIdStatement = node(
    'Statement',
    sequence(
      g.ClassIdSelectorPrefix,
      choice(
        MixinStatementTail,
        BareMixinCall,
        RulesetTail
      )
    ),
    (children, _fields, span) => {
      const prefix = children.find(isSelectorBranchFact);
      if (prefix === undefined) {
        throw new TypeError('Less class/id statement lost its selector prefix.');
      }
      const definition = children.find(isMixinDefinitionFact);
      if (definition !== undefined) {
        const node = mixinDef(
          mixinDefinitionNameFromSelectorBranch(prefix.selector),
          [...definition.params],
          [...definition.rules],
          definition.guard
        );
        return withSourceSpan(
          definition.bodySpan === undefined ? node : withBodySpan(node, definition.bodySpan),
          span
        );
      }
      const call = children.find(isMixinCallFact);
      if (call !== undefined) {
        return mixinCallFromSelectorBranch(prefix.selector, call.args, call.important, span);
      }
      const bare = children.find(isBareMixinCallFact);
      if (bare !== undefined) {
        return mixinCallFromSelectorBranch(prefix.selector, [], bare.important, span);
      }
      const ruleset = children.find(isRulesetTailFact);
      if (ruleset === undefined) {
        throw new TypeError('Less class/id statement lost its continuation.');
      }
      const prefixSpan = sourceSpanOf(prefix.selector);
      const guardSpan = ruleset.guard === undefined ? undefined : sourceSpanOf(ruleset.guard);
      const selector = prefixSpan === undefined
        ? selist(prefix.selector, ...ruleset.branches.map(branch => branch.selector))
        : withSourceSpan(
            selist(prefix.selector, ...ruleset.branches.map(branch => branch.selector)),
            { start: prefixSpan.start, end: guardSpan?.start ?? ruleset.selectorEnd }
          );
      const extensions = [
        ...ruleset.firstExtensions.map(target => ({
          target: target.target,
          partial: target.partial,
          subject: selist(prefix.selector)
        })),
        ...ruleset.branches.flatMap(branch => branch.extensions),
        ...ruleset.extensions
      ];
      const node = rule(
        selector,
        [...ruleset.rules],
        extensions.length === 0 ? undefined : extensions,
        ruleset.guard
      );
      const withBody = ruleset.bodySpan === undefined ? node : withBodySpan(node, ruleset.bodySpan);
      return ruleset.terminated === true ? withSourceSpan(withBody, span) : withBody;
    },
    { collapse: true }
  );
  const Stylesheet = node(
    'Stylesheet',
    sequence(many(choice(atStatement, mixinStatement, g.FunctionStatement, guardedRuleset, rootDeclarationItem, literal(';'))), optional(g.Call)),
    children => stylesheet(children.filter(isStatement)),
    { trailingTrivia: true }
  );

  return {
    Stylesheet,
    Document: Stylesheet,
    VarDeclaration,
    ImportStatement,
    PluginDirective,
    ValueBlockDeclaration,
    ValueBlock,
    IndirectVariableReference,
    VariableReferenceChain,
    VariableReference,
    PropertyReference,
    VariableInterpolation,
    PropertyInterpolation,
    Interpolation,
    AtRuleInterpolation,
    InterpolationAccessor,
    ReferenceTail,
    InterpolatedValue,
    InterpolatedProperty,
    Keyword,
    Percentage,
    Dimension,
    EscapeValue,
    PagePseudo,
    DoubledQuoteArgument,
    FunctionArgument,
    FunctionScalarArgument,
    FunctionAssignmentArgument,
    FunctionKeywordArgument,
    ArgumentValueSequence,
    FunctionCondition,
    FunctionConditionOr,
    FunctionConditionAnd,
    FunctionConditionTerm,
    FunctionConditionOperand,
    FunctionConditionParen,
    Call,
    CallArgumentFunction,
    FormatFunction,
    CallArgumentValue,
    FunctionStatement,
    Value,
    SelectorCapture,
    MathAtom,
    MathUnary,
    MathProduct,
    MathSum,
    TopProduct,
    TopSum,
    PreservedDivision,
    EscapedParen,
    Paren,
    ValueSequence,
    ValueList,
    VariableValue,
    ImportantValue,
    ValueListWithPriority,
    CustomPropertyName,
    CustomAtKeywordText,
    CustomPart,
    CustomInnerPart,
    CustomGroup,
    CustomValue,
    CustomPropertyValue,
    CustomDeclaration,
    Declaration,
    ClassIdStatement,
    MixinArgumentGroup,
    MixinArguments,
    MixinInterior,
    ClassIdSelectorPrefix,
    SelectorBranchTail,
    FlatMixinCall,
    NamespacedMixinCall,
    NamespacedMixinValue,
    MixinReference,
    ReferenceCall,
    MixinGuard,
    MixinGuardTopOr,
    MixinGuardTopAnd,
    MixinGuardTopTerm,
    MixinGuardOr,
    MixinGuardAnd,
    MixinGuardTerm,
    MixinGuardOperand,
    EachName,
    BodyStatement,
    EachCallback,
    EachFunctionStatement,
    SupportsValue,
    SupportsFeature,
    SupportsInParens,
    SupportsCondition,
    EnclosedContent,
    EnclosedGroup,
    EnclosedQuoted,
    EnclosedFunctionName,
    Enclosed,
    SupportsBlock,
    QueryValue,
    QueryColonFeature,
    QueryFeatureValue,
    QueryNonOnlyKeyword,
    QueryTerm,
    MediaQueryTerm,
    QueryFeature,
    QueryClause,
    ContainerStyleQuery,
    ContainerScrollStateQuery,
    ContainerName,
    ContainerQueryAtom,
    ContainerCondition,
    MediaContainerBody,
    MediaContainerBlock,
    KeyframeSelector,
    KeyframeBlock,
    Keyframes,
    DottedAtRuleKeyword,
    AtRulePreludeValueAtom,
    AtRulePreludeValueTerm,
    AtRulePreludeValue,
    AtRulePrelude,
    NamespacePrelude,
    AtRuleBlock,
    OpaqueAtPrelude,
    OpaqueBody,
    AtRuleName,
    CustomValueAtKeyword,
    StaticAtRuleStatementName,
    OpaqueAtRuleBlock,
    AtRuleStatement,
    PseudoSelector,
    InterpolatedPseudo,
    InterpolatedNthPseudo,
    InterpolatedArgumentPseudo,
    NthPseudoSelector,
    NthPseudoArgument,
    PseudoArgumentText,
    PseudoArgumentGroup,
    PseudoArgumentCompound,
    PseudoArgumentComplex,
    PseudoArgumentSelectorTail,
    PseudoArgumentSelector,
    AttributeNamespace,
    NamespaceTypeSelector,
    AttributeName,
    AttributeMatch,
    AttributeSelector,
    InterpolatedAttributeToken,
    InterpolatedAttributeValueToken,
    InterpolatedAttributeQuoted,
    InterpolatedAttributeSelector,
    InterpolatedSimpleSelector,
    BareInterpolatedSelector,
    AdjacentInterpolatedSelector,
    BareInterpolatedSelectorWithSuffix,
    InterpolatedParentSuffix,
    CompoundSelector,
    ComplexSelector,
    SelectorList,
    ExtendTarget,
    ExtendStatement,
    RulesetWithExtends,
    RelativeComplex,
    NestedRulesetWithExtends,
    Quoted,
    LiteralQuoted,
    EscapedQuoted,
    PlainUrl,
    UrlInterpolation,
    VariableUrl,
    ImportOption,
    ImportOptions,
    ImportTarget,
    ImportTail,
    ImportTailText,
    ImportTailGroup,
    ImportTailParen,
    blockBody,
    BareVariableInterpolation,
    valuePiece,
    pseudoArgumentInner,
    queryLeaf,
    interpolatedValueTail,
    GenericFunction,
    CalcFunction,
    FunctionArguments,
    whitespace,
    rw: whitespace
  };
};

export const lessGrammar = compose([cssBaseRules, lessSyntax, cssPseudoSyntax, rules<LessRules>({ trivia: whitespace, scanSkip: [scanSkipDoubleString, scanSkipSingleString, blockComment] }, lessGrammarFactory)], { hostMode: 'ast' });

/** AST artifact with Parseman line/column tracking enabled. */
export const lessPositionsGrammar = compose([cssBaseRules, lessSyntax, cssPseudoSyntax, rules<LessRules>({ trivia: whitespace, scanSkip: [scanSkipDoubleString, scanSkipSingleString, blockComment], trackLines: true }, lessGrammarFactory)], { hostMode: 'ast' });

/** Public Less CST artifact: the same grammar factory compiled in CST mode. */
export const lessCstGrammar = compose([cssBaseRules, lessSyntax, cssPseudoSyntax, rules<LessRules>({ trivia: whitespace, scanSkip: [scanSkipDoubleString, scanSkipSingleString, blockComment] }, lessGrammarFactory)], { hostMode: 'cst' });

/** CST artifact with Parseman line/column tracking enabled. */
export const lessCstPositionsGrammar = compose([cssBaseRules, lessSyntax, cssPseudoSyntax, rules<LessRules>({ trivia: whitespace, scanSkip: [scanSkipDoubleString, scanSkipSingleString, blockComment], trackLines: true }, lessGrammarFactory)], { hostMode: 'cst' });
