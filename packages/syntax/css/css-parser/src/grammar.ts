/**
 * Canonical CSS grammar.
 *
 * CSS owns the shared stylesheet structure: rulesets, declarations, selectors,
 * values, standard at-rules, conditional query/supports/container preludes,
 * custom properties, pseudos, and opaque unknown CSS at-rules. Dialects should
 * reuse these rules unless they expand a specific value/selector/header shape
 * or add language-specific statements.
 *
 * Parseman reductions call core AST constructors directly in the default
 * artifact. The CST artifact is compiled from the same factory with
 * `hostMode: 'cst'` for language-service and dialect composition use.
 *
 * Dialect grammar dependents:
 * - Less: ../../../less/less-parser/src/grammar.ts
 * - SCSS: ../../../scss/scss-parser/src/grammar.ts
 * - Jess: ../../../jess/jess-parser/src/grammar.ts
 */
import { balanced, classifiedTrivia, choice, compose, composeLeaf, dispatch, endsWith, expect, field, keywords, literal, makeWhen, makeWord, many, noTrivia, node, not, oneOrMore, oneOrMoreSep, optional, otherwise, parser, peek, regex, routed, rules, scanTo, sepBy, sequence, token, when } from 'parseman' with { type: 'macro' };
import type { Combinator } from 'parseman';
import { cssSyntax } from '@jesscss/parser-shared/recognition';
import { cssPseudoSyntax } from '@jesscss/parser-shared/pseudo-consts';
import {
  any,
  atRuleBlock,
  atRuleStatement,
  attributeSelector,
  authoredText,
  block,
  blockStatements,
  branchSegments,
  chainedQueryComparison,
  color,
  complexSegments,
  cssBaseMathOutsideParens,
  cssRelativeCombinator,
  decl,
  dimension,
  documentStatements,
  firstValue,
  flattenSequences,
  foldOperation,
  funcCall,
  functionOpenName,
  importPrelude,
  interpolation,
  isAtRuleBlock,
  isDeclaration,
  isImportTarget,
  isInterpolation,
  isKeyword,
  isNodeType,
  isSelectorBranch,
  isSelectorList,
  isSimpleToken,
  isTerminalText,
  isValue,
  isValueSlotValue,
  keyframeSelectorList,
  keyword,
  list,
  opaqueAtRuleBlock,
  operation,
  optionalValue,
  pseudoSelector,
  queryComparisonOperators,
  quoted,
  relativeSelector,
  rule,
  rulesetStatements,
  selectorArgumentText,
  selectorBranches,
  selectorBranchOf,
  selectorTermFromTokens,
  selist,
  semanticTextWithTriviaGaps,
  simpleSelector,
  sourceText,
  spaced,
  STRUCTURED_PSEUDOS,
  stylesheet,
  tokenText,
  url,
  valueChildren,
  valueSlot,
  valueSlotChildren,
  withAuthoredSeparators,
  withBlockBody,
  withSourceSpan
} from '@jesscss/core/ast';
import type {
  AtRuleBlock,
  Declaration,
  Interpolation,
  ValueNode
} from '@jesscss/core/ast';

type GrammarRuleName =
  | 'AtRulePrelude'
  | 'AtRulePreludeSegments'
  | 'AtRuleStatement'
  | 'AttributeModifier'
  | 'AttributeOperator'
  | 'AttributeSelector'
  | 'BasicSelector'
  | 'CalcCall'
  | 'CalcIdentOrFunction'
  | 'CalcParen'
  | 'CalcProduct'
  | 'CalcSequence'
  | 'CalcSum'
  | 'CalcValue'
  | 'MathFunction'
  | 'Call'
  | 'CharsetStatement'
  | 'Color'
  | 'ComplexSelector'
  | 'CompoundSelector'
  | 'ConditionalBlock'
  | 'ConditionalGroupAtRule'
  | 'ContainerPrelude'
  | 'ContainerQueryClause'
  | 'ContainerQueryPrelude'
  | 'ConditionalAtKeyword'
  | 'ContainerAtKeyword'
  | 'CustomPropertyName'
  | 'DescriptorAtKeyword'
  | 'DocumentAtKeyword'
  | 'DoubleQuotedText'
  | 'FontFeatureValueAtKeyword'
  | 'FontFeatureValuesAtKeyword'
  | 'GenericAtRuleName'
  | 'ImportantToken'
  | 'KeyframesAtKeyword'
  | 'LayerAtKeyword'
  | 'MalformedPseudoSelectorNumericArgument'
  | 'MarginAtKeyword'
  | 'MediaAtKeyword'
  | 'NthExpression'
  | 'NthChildPseudoSelectorName'
  | 'NthPseudoSelectorName'
  | 'NthTypePseudoSelectorName'
  | 'NthOfKeyword'
  | 'PageAtKeyword'
  | 'PseudoSelectorCloseAhead'
  | 'QueryAndOr'
  | 'QueryComparisonOperator'
  | 'QueryFunctionOpen'
  | 'QueryNot'
  | 'QueryOnly'
  | 'AtRuleKeyword'
  | 'ScopeAtKeyword'
  | 'SelectorArgumentPseudoSelectorName'
  | 'SingleQuotedText'
  | 'StartingStyleAtKeyword'
  | 'StatementAtRuleName'
  | 'SupportsAtKeyword'
  | 'UnicodeRangeToken'
  | 'UrlInner'
  | 'UrlOpen'
  | 'CustomProperty'
  | 'CustomValue'
  | 'Declaration'
  | 'DeclarationListAtRule'
  | 'PunctuationValue'
  | 'ParenValue'
  | 'SquareValue'
  | 'Identifier'
  | 'RawParenValue'
  | 'DescriptorBlock'
  | 'Dimension'
  | 'DocumentBlock'
  | 'FeatureValueBlock'
  | 'FontFeatureValuesBlock'
  | 'Enclosed'
  | 'EnclosedContent'
  | 'EnclosedGroup'
  | 'EnclosedQuoted'
  | 'ImportStatement'
  | 'ImportTail'
  | 'ImportTailBody'
  | 'ImportTailRaw'
  | 'ImportUrl'
  | 'ImportUrlUnquoted'
  | 'Important'
  | 'RoutedKeyword'
  | 'KeyframeBlock'
  | 'Keyframes'
  | 'Keyword'
  | 'LayerBlock'
  | 'LayerStatement'
  | 'LeadingDashOfTypePseudoArgument'
  | 'LeadingDashPseudoArgument'
  | 'LeadingDashRawPseudoArgument'
  | 'MarginAtRule'
  | 'NestedConditionalBlock'
  | 'NestedLayerBlock'
  | 'NestedStartingStyleBlock'
  | 'NamespaceTypeSelector'
  | 'NestingSelector'
  | 'OfTypePseudoArgument'
  | 'OpaqueAtRuleBlock'
  | 'PageBlock'
  | 'Percentage'
  | 'Property'
  | 'PseudoArgument'
  | 'PseudoSelector'
  | 'QueryClause'
  | 'QueryFeature'
  | 'QueryFunction'
  | 'QueryPrelude'
  | 'Quoted'
  | 'Ruleset'
  | 'ScopeBlock'
  | 'SelectorList'
  | 'StartingStyleBlock'
  | 'StylesheetAtRule'
  | 'StatementPrelude'
  | 'SupportsCondition'
  | 'SupportsInParens'
  | 'SupportsPrelude'
  | 'TopLevelRuleset'
  | 'TopLevelSelectorList'
  | 'TypedNthPseudoArgument'
  | 'TypedOfTypePseudoArgument'
  | 'UnicodeRange'
  | 'Url'
  | 'Value'
  | 'ValueList'
  | 'ValueSequence'
  | 'TypedValue'
  | 'TypedValueList'
  | 'TypedValueSequence'
  | 'VarCall'
  | 'VarFallback'
  | 'VarFallbackBrace'
  | 'VarFallbackBracket'
  | 'VarFallbackCall'
  | 'VarFallbackEmpty'
  | 'VarFallbackItem'
  | 'VarFallbackParen'
  | 'VarFallbackPunctuation'
  | 'VarFallbackTerm'

  /*
   * These seven were already rules-map keys but had never been declared here,
   * because nothing referenced them through `g.` — the map and this union are
   * different sets, and only a `g.` reference forces them to agree.
   */
  | 'AtRulePreludeWhitespace'
  | 'AtRulePreludeComma'
  | 'AtRulePreludeGroup'
  | 'AtRulePreludeQuoted'
  | 'AtRulePreludeText'
  | 'QueryBareFeature'
  | 'QueryRangeFeature'
  | 'keyframeSelector'
  | 'stylesheetBodyBlock'
  | 'declarationListBlock'
  | 'descriptorBodyBlock'
  | 'declarationListItem'
  | 'declarationListDeclaration'
  | 'simpleSelectorAtom'
  | 'calcValueAtom'
  | 'valueAtom'
  | 'RoutedAtRuleStatement'
  | 'pseudoArgumentContent'
  | 'CustomPropertyValue'
  | 'QueryValue'
  | 'QueryTerm'
  | 'stylesheetBodyItem'
  | 'routedStylesheetBody'
  | 'routedDeclarationListBody'
  | 'valueFunctionArguments'
  | 'calcFunctionArguments';

/*
 * Rules that the shared recognition library defines keep its concrete
 * combinator type; the rest stay opaque. Flattening every rule to
 * `Combinator<unknown>` lost the value type of `token(...)`-backed rules such
 * as `AtRuleKeyword`, which `dispatch(...)` requires to be `Combinator<string>`.
 */
type GrammarSelf = {
  readonly [K in GrammarRuleName]: K extends keyof typeof cssSyntax
    ? (typeof cssSyntax)[K]
    : Combinator<unknown>
};

const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);

/*
 * Document trivia arms carry their category so root capture can retain just the
 * comment gaps the renderer replays, the way the other three dialects do.
 */
const whitespaceRun = regex(/[ \t\n\r\f]+/);
const whitespace = classifiedTrivia({
  whitespace: whitespaceRun,
  blockComment
});

/*
 * Value-slot boundaries are authored trivia, not semantic leaves. Capture the
 * complete run so raw ValueSlot arrays can replay comments/newlines/indentation
 * without growing a public `separators` field.
 */
const cssValueTrivia = regex(/(?:[ \t\n\r\f]+|\/\*(?:[^*]|\*(?!\/))*\*\/)+/);

/*
 * Block comments are grammar trivia. noTrivia lexical leaves still cannot glue
 * `10/*x*\/px` into one Dimension.
 */
const interstitialTrivia = classifiedTrivia({
  whitespace: whitespaceRun,
  blockComment
});
const compoundTrivia = classifiedTrivia({ blockComment });
const commentTrivia = classifiedTrivia({ blockComment });

/*
 * The value ladder runs under `ValueSequence`'s `noTrivia`, and parseman scopes
 * trivia dynamically — clearing it covers every rule reached through a `g.`
 * reference, not just the terms written inside the wrapper. So every interior
 * that admits authored padding has to spell it, and it must spell `cssValueTrivia`
 * rather than a bare whitespace run: css-syntax-3 §4 makes a comment trivia
 * wherever whitespace is trivia. The `[ \t\n\r\f]+` spellings these replaced are
 * why `calc(1px /* c *\/ + 2px)` was rejected outright while `var(--x, /* c *\/ e)`
 * silently mis-parsed the comment bytes into the value as punctuation.
 *
 * `*`, `/` and `%` take optional padding; `+` and `-` require real whitespace on
 * both sides (css-values-4 §10.1), which a comment does not supply — hence the
 * mandatory `[ \t\n\r\f]+` in the sum pad and its absence in the product one.
 * Both pads are spelled `ws* (comment ws*)*` so the comment and whitespace arms
 * have disjoint first characters and the match stays linear.
 *
 * The pad is its own term rather than part of the operator regex so the operator
 * token stays exactly the operator character. Folding it in would leave the
 * reducer re-deriving the operator from padded bytes that can contain `/` and `*`
 * of their own, which is the parser handing core a value it has to re-parse.
 */
const calcProductPad = regex(/[ \t\n\r\f]*(?:\/\*(?:[^*]|\*(?!\/))*\*\/[ \t\n\r\f]*)*/);
const calcSumPad = regex(/(?:\/\*(?:[^*]|\*(?!\/))*\*\/)*[ \t\n\r\f]+(?:\/\*(?:[^*]|\*(?!\/))*\*\/[ \t\n\r\f]*)*/);
const calcProductOperator = sequence(
  calcProductPad,
  regex(/[*/%]/),
  calcProductPad
);
const calcSumOperator = sequence(
  calcSumPad,
  regex(/[-+]/),
  calcSumPad
);
const genericIdentifier = regex(/-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/i);

/*
 * The css-values-4 §10 math functions, as glued function OPENERS — the token a
 * value dispatch routes on.
 *
 * CANONICAL TABLE: `CSS_MATH_FUNCTIONS` in `@jesscss/core/ast`
 * (`packages/core/src/ast/math-functions.ts`). Add or remove a name THERE
 * first; `test/math-function-table.test.ts` fails if this literal drifts from
 * it.
 *
 * It is spelled as a LITERAL here, and in each of the other three grammars,
 * because it must be macro-visible: parseman's plugin const-folds dispatch keys
 * at build time and cannot follow an imported binding. Importing the table —
 * from core, from `@jesscss/parser-shared`, or through a relative source path —
 * was measured and fails the build with `composeLeaf() must macro-fuse`. So the
 * repo gets one AUTHORITY plus a gate rather than one occurrence.
 */
const CSS_MATH_FUNCTION_OPENERS = [
  'calc(',
  'min(', 'max(', 'clamp(',
  'round(', 'mod(', 'rem(',
  'sin(', 'cos(', 'tan(', 'asin(', 'acos(', 'atan(', 'atan2(',
  'pow(', 'sqrt(', 'hypot(', 'log(', 'exp(',
  'abs(', 'sign('
];

/*
 * A `+`/`-` GLUED to the number that follows it. After a run separator inside a
 * math function this shape is never a run item: `calc(1px +2px)` is an
 * ASYMMETRIC additive operator, which css-values-4 §10.1 rejects because `+`
 * and `-` need real whitespace on BOTH sides. A bare `-` that starts an
 * identifier (`-webkit-foo`) is not this shape and stays a run item.
 */
const signedNumericStart = regex(/[-+](?=[.0-9])/);
const genericFunctionIdentifier = regex(/(?!(?:calc|url|var)(?=\())-?(?:[_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*/i);
const genericFunctionOpen = noTrivia(sequence(
  genericFunctionIdentifier,
  literal('(')
));
const customEscape = regex(/\\[^\n\r\f]/);

/*
 * Only the Selectors An+B pseudo families give a leading numeric argument the
 * special An+B meaning. Every other functional pseudo retains its raw argument.
 * The two families diverge on the `of S` tail: `:nth-child`/`:nth-last-child`
 * accept it (Selectors-4 §6.6.2), `:nth-of-type`/`:nth-last-of-type` do not.
 * The `g`-free name recognitions live in the shared `cssPseudoSyntax`
 * artifact and are referenced as `g.NthChildPseudoSelectorName` /
 * `g.NthTypePseudoSelectorName`.
 * Public `anyValue` is intentionally permissive. The direct declaration
 * extension needs only its punctuation-run branch: identifier-shaped values
 * already lower through Keyword, and `#` stays reserved for the strict
 * color production. Literal combinators keep this recognition macro-owned.
 */
const punctuationValueCharacter = choice(
  customEscape,
  literal('+'),
  literal('-'),
  literal('*'),
  literal('/'),
  literal('='),
  literal('<'),
  literal('>'),
  literal('|'),
  literal('~'),
  literal('^'),
  literal('?'),
  literal('$'),
  literal('@'),
  literal('%'),
  literal('&'),
  literal(':'),
  literal('.')
);

/*
 * punctuationValueCharacter minus `/`. Leading the punctuation-run arm with this
 * (concrete 16-char first-set) instead of a `not('/*')` guard lets the compiler
 * resolve PunctuationValue's first-set and first-char-gate it; the `/` cases
 * keep their adjacent-comment guard in the dedicated slash arm.
 * An at-keyword may not BEGIN a declaration-value component. `;` separates
 * declarations rather than terminating them (css-syntax-3 §5.4.7), so the last
 * declaration in a block ends at whatever follows it — and when that is a nested
 * at-rule, `a { color: red @media all { … } }`, the value run would otherwise
 * swallow `@` as permissive punctuation and strand the `{` with no statement to
 * open. A nested at-rule can only start where a value component could start, so
 * rejecting the at-keyword exactly there is the whole boundary: `@` keeps its
 * permissive reading everywhere it is not an at-keyword (`@`, `@1`, `@(`), and
 * mid-run `@` is untouched because no statement can begin inside a punctuation
 * run. The lookahead is css-syntax-3 §4.3.1 "would start an ident sequence",
 * the same spelling the at-rule name terminals use.
 * This const is the value-component START only; `punctuationValueCharacter` stays
 * unguarded because it also carries the `var()` fallback, where an at-keyword is
 * a legal `<declaration-value>` token (css-variables-1 §2.1).
 */
const nonSlashPunctuationValueStart = choice(
  customEscape,
  literal('+'),
  literal('-'),
  literal('*'),
  literal('='),
  literal('<'),
  literal('>'),
  literal('|'),
  literal('~'),
  literal('^'),
  literal('?'),
  literal('$'),
  regex(/@(?!-?(?:[-_a-zA-Z\u0080-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f])))/),
  literal('%'),
  literal('&'),
  literal(':'),
  literal('.')
);

const importTailWhitespace = regex(/[ \t\n\r\f]+/);
const importTailText = regex(/[^()[\]"'\/; \t\n\r\f]+/);
const keyframeEndpoint = keywords(
  ['from', 'to'],
  { caseInsensitive: true, boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF' }
);

/*
 * `|` is NOT a combinator: `svg|circle` is one namespaced type selector
 * (`NamespaceTypeSelector` below), not two compounds separated by `|`. Only the
 * child/sibling/column combinators separate compounds; the column combinator
 * `||` (selectors-4 §16.1) stays, and its leading `|` is disambiguated from a
 * namespace prefix by the `keywords` longest-match preferring `||`.
 */
const combinator = keywords(['||', '>', '+', '~']);

/*
 * A relative selector (a `:has()` argument) may open with a combinator. Only the
 * child/sibling combinators lead a relative selector; a leading `|`/`||` is
 * namespace syntax, not a relative combinator.
 */
const relativeSelectorCombinator = keywords(['>', '+', '~']);

/*
 * A pseudo selector always opens with `:`/`::`. Spelling this leading colon as a
 * grammar-local recognizer (identical to the shared PseudoSelectorColon) lets
 * the compiler resolve the pseudo arm's first-set to `:` and first-char-gate it in
 * the compound-selector choice, instead of treating a cross-composition reference
 * as an `any` first-set and speculatively entering the pseudo node at every simple
 * selector.
 * The colon and the pseudo name are ADJACENT tokens: selectors-4 §3.5 spells a
 * pseudo-class as `':' <ident-token>` / `':' <function-token>`, with no
 * <whitespace-token> between them. The pseudo arm runs under `interstitialTrivia`
 * so that its ARGUMENT may be spaced (`:not( .b )`) and so a comment may sit
 * where tokenization already removes one (`:/*c*\/hover` is still `:hover`), but
 * that same trivia was silently swallowing a whitespace token here and accepting
 * `a : hover` — and, worse, letting `color: red b` read as the compound
 * `color` + `:red` followed by ` b`, which is what made a declaration whose value
 * strands a `{` look like a valid nested rule. Rejecting only the whitespace
 * keeps the comment case and restores the token adjacency.
 */
const pseudoColon = regex(/::?(?![ \t\n\r\f])/);

/*
 * Grammar-local copy of SimpleSelectorToken. As the fallback arm of the compound
 * selector choice it must resolve a concrete first-set (`.`/`#`/`-`/letter/digit/
 * `*`) so the compiler first-char-gates the whole compound choice; a cross-
 * composition reference reads as `any`, entering the simple-selector node frame
 * at every compound-selector boundary (`{`, `,`, whitespace).
 */
const simpleSelectorToken = regex(/(?:[.#]?-?(?:[_a-zA-Z\u0080-\uFFFF]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uFFFF]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\d+(?:\.\d+)?%|\*)/);

/*
 * A CSS-namespaces prefix: `<ident>|`, `*|`, or bare `|`, glued (no whitespace
 * around `|` \u2014 CSS Namespaces \u00A72, selectors-4 \u00A75.1). It prefixes a type/universal
 * selector (`svg|circle`, `*|a`, `|a`) and an attribute name (`[svg|attr]`), so
 * one recognizer serves both. `(?!=)` keeps the attribute operator `|=`
 * (selectors-4 \u00A76.3) on its own route \u2014 `[a|=b]` is `a` matched by `|=`, not the
 * `a|` namespace of a `b` attribute.
 */
const attributeNamespace = regex(/(?:-?(?:[_a-zA-Z\u0080-\uFFFF]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))(?:[-_a-zA-Z0-9\u0080-\uFFFF]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f]))*|\*)?\|(?!=)/);

/*
 * Grammar-local copies of the leading hex-color and number recognizers (identical
 * to HexColor / NumberToken). Leading a component-value choice
 * arm with a cross-composition shared `g.*` reference leaves that arm's
 * first-set unresolved (`any`), so the compiler enters the Color / Dimension node
 * frame speculatively at every value atom. A local leading recognizer resolves the
 * arm's first-set (`#` / `[+-.0-9]`) so it is first-char-gated instead.
 */
const hexColor = regex(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/);
const numberValue = regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)/);
const numberNoPercentage = regex(/[+-]?(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?|\d+)(?!%)/);
const dimensionUnit = regex(/-?[_a-zA-Z\u0080-\uFFFF](?:[_a-zA-Z0-9\u0080-\uFFFF]|-(?![0-9]))*/);
const customDoubleQuotedText = regex(/(?:[^"\\]|\\[\s\S])*/);
const customSingleQuotedText = regex(/(?:[^'\\]|\\[\s\S])*/);
const customDoubleQuoted = sequence(
  literal('"'),
  customDoubleQuotedText,
  literal('"')
);
const customSingleQuoted = sequence(
  literal('\''),
  customSingleQuotedText,
  literal('\'')
);

/*
 * A balanced interior stops at the first character of every skipper it is given,
 * so `blockComment` puts `/` in the interior's stop set: a `/` that does NOT open
 * a comment matches no interior arm and truncates the group early (the balanced
 * close is recovered, so the truncation is silent). `url(//host/a;b)` inside a
 * custom-property value is exactly that shape — the group ended at the first `/`
 * and the `;` inside it then terminated the declaration. This arm gives the lone
 * slash somewhere to go. It is ordered after `blockComment` at every skip site,
 * so a real `/*` still opens a comment.
 */
const customSlash = regex(/\/(?!\*)/);

/*
 * Balanced-group skips shared by the value, import-tail, calc var()-fallback,
 * and at-prelude scanners. One combinator per delimiter, reused at every skip
 * site instead of respelling the identical comment/escape/quote skip set.
 */
const balancedParens = balanced(
  '(',
  ')',
  { skip: [blockComment, customDoubleQuoted, customSingleQuoted, customSlash] }
);
const balancedBrackets = balanced(
  '[',
  ']',
  { skip: [blockComment, customDoubleQuoted, customSingleQuoted, customSlash] }
);
const balancedBraces = balanced(
  '{',
  '}',
  { skip: [blockComment, customDoubleQuoted, customSingleQuoted, customSlash] }
);

/*
 * An unknown at-rule's block is a simple block of component values
 * (css-syntax-3 §5.4.2 → §5.4.8): braces balanced, with strings, comments and
 * escapes inert. No spec defines a semantic reading for an unknown at-rule, so
 * the body is scanned to its closing `}` and kept as raw bytes — the tolerance
 * an unknown at-rule adds lives in the SCANNER, not in a forked copy of the
 * comment/string/group productions. The skip set reuses the canonical
 * `blockComment`, `customEscape`, `customDoubleQuoted` and `customSingleQuoted`
 * terminals verbatim; the balanced brace carries `customEscape` (not the
 * `customSlash` of `balancedBraces`) so a `\}` stays inert inside a nested
 * group, which is the one byte-language difference this tolerant scan requires.
 */
const opaqueAtRuleBrace = balanced(
  '{',
  '}',
  { skip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] }
);
const opaqueAtRuleSkip = [blockComment, customEscape, customDoubleQuoted, customSingleQuoted, opaqueAtRuleBrace];
const opaqueAtRulePrelude = optional(scanTo(
  choice(
    literal('{'),
    literal(';')
  ),
  { skip: opaqueAtRuleSkip }
));
const opaqueAtRuleBody = noTrivia(scanTo(
  literal('}'),
  { skip: opaqueAtRuleSkip }
));

/*
 * A general-enclosed payload is grammar-owned arbitrary CSS component text. This
 * raw-template chunk deliberately stops at every structural delimiter; quotes,
 * comments, and balanced groups below own those bytes instead. It is a Parseman
 * terminal, not a source scan or a post-parse text recovery step.
 */
const enclosedText = regex(/(?:\\[\s\S]|\/(?!\*)|[^\\/'"()[\]{}]+)+/);

/*
 * A custom property is a CSS `<declaration-value>`: its opaque bytes must be
 * captured as one value while its balanced groups, quoted strings, and comments
 * cannot terminate the declaration. This is a Parseman grammar combinator, not
 * a secondary scanner or a post-parse source slice.
 * css-syntax-3 §5.5.6 strips a trailing `!important` and sets the declaration's
 * priority flag *before* the custom-property original-text step, so the preserved
 * text excludes the marker. css-variables-1 §2.1 confirms the `<declaration-value>`
 * ban on a top-level `!` does not apply, because the removal happens first.
 * The marker is a scan sentinel rather than a post-parse text slice: the leading
 * `[ \t\n\r\f]*` makes the scan stop *before* the whitespace that precedes `!`, so
 * the captured value keeps no trailing space. Only a marker that is genuinely last
 * qualifies — the `(?=[;}])` tail is what leaves `--x: a !important b` untouched and
 * what makes `--x: a !important !important` strip only the final one.
 */
const customImportantTail = regex(/[ \t\n\r\f]*!(?:[ \t\n\r\f]|\/\*(?:[^*]|\*(?!\/))*\*\/)*important(?:[ \t\n\r\f]|\/\*(?:[^*]|\*(?!\/))*\*\/)*(?=[;}])/i);
const customValue = scanTo(
  choice(
    literal(';'),
    literal('}'),
    customImportantTail
  ),
  {
    skip: [
      balancedParens,
      balancedBrackets,
      balancedBraces
    ]
  }
);
const importTailGroup = sequence(
  literal('('),
  scanTo(
    literal(')'),
    {
      skip: [balancedParens]
    }
  ),
  expect(
    literal(')'),
    ')'
  )
);
const importTailSquareGroup = sequence(
  literal('['),
  scanTo(
    literal(']'),
    {
      skip: [balancedBrackets]
    }
  ),
  expect(
    literal(']'),
    ']'
  )
);

/*
 * NOT exported, and must never be. The body is written entirely in parseman's
 * macro vocabulary (`makeWord`, `sequence`, `node`, ...), which exists only at
 * build time -- the macro plugin lowers each call site into inline JS and the
 * package emits no runtime `parseman` combinator import. Exporting the factory
 * makes the plugin emit a live runtime binding for it whose body still names
 * the macro-only identifiers, so the export throws
 * `ReferenceError: makeWord is not defined` the first time anyone calls it.
 * That artifact shipped until 205eba3c4 split each compiled grammar into its
 * own entry and tree-shook the factory out. `scripts/check-macro-buildable.mjs`
 * now fails the build if any built module references an undefined identifier.
 */
const cssFactory = (g: GrammarSelf) => {
  const identWord = makeWord(
    '-_a-zA-Z0-9\\u0080-\\uFFFF\\\\',
    { caseInsensitive: true }
  );
  const cssCase = makeWhen({ caseInsensitive: true });

  /*
   * CSS keywords, at-keywords, and function names are ASCII-case-insensitive.
   * Function openers are glued with noTrivia so `url (` / `calc (` / `var (`
   * remain an identifier plus a parenthesized value, not a function token.
   */
  const importAtKeyword = identWord('@import');
  const charsetAtKeyword = identWord('@charset');
  const urlOpen = noTrivia(sequence(
    identWord('url'),
    literal('(')
  ));
  const calcOpen = noTrivia(sequence(
    identWord('calc'),
    literal('(')
  ));
  const varOpen = noTrivia(sequence(
    identWord('var'),
    literal('(')
  ));

  const pseudoIdentOrFunction = token(noTrivia(sequence(
    g.Identifier,
    optional(literal('('))
  )));
  const pseudoArgumentContent = scanTo(
    literal(')'),
    {
      skip: [
        balanced('(', ')'),
        balanced('[', ']')
      ]
    }
  );
  const authoredValueComma = field(
    'separator',
    noTrivia(sequence(
      literal(','),
      optional(cssValueTrivia)
    ))
  );

  /*
   * An argument comma also admits padding BEFORE it, which the value-list comma
   * must not: at the top level `a , b` is a space-separated run whose middle
   * component is the punctuation `,`, and widening `authoredValueComma` would
   * re-cut every such value that parses today. Inside an argument list there is
   * no competing punctuation reading, so `f(c , d)` and `f(c /* z *\/, d)` are
   * plain padded separators.
   */
  const authoredArgumentComma = field(
    'separator',
    noTrivia(sequence(
      optional(cssValueTrivia),
      literal(','),
      optional(cssValueTrivia)
    ))
  );
  const valueFunctionArguments = sepBy(
    g.TypedValueSequence,
    authoredArgumentComma
  );
  const genericFunctionArguments = sepBy(
    g.ValueSequence,
    authoredArgumentComma
  );
  const BasicSelector = node(
    'BasicSelector',
    simpleSelectorToken,
    children => simpleSelector(tokenText(children[0]))
  );

  /*
   * `ns|E` / `*|E` / `|E` is ONE type selector with a namespace prefix
   * (selectors-4 §5.1), not two compounds joined by a `|` combinator. It leads
   * the compound choice because its prefix shares a first char with a plain type
   * selector; `noTrivia` keeps the prefix glued so `svg | circle` is not a
   * namespaced selector. The reduced value is a plain `SimpleSelector` carrying
   * the whole `svg|circle` text, matching the other dialects (one representation
   * per construct).
   */
  const NamespaceTypeSelector = node(
    'NamespaceTypeSelector',
    noTrivia(sequence(
      attributeNamespace,
      choice(g.Identifier, literal('*'))
    )),
    children => simpleSelector(children.map(tokenText).join(''))
  );
  const AttributeSelector = node(
    'AttributeSelector',
    sequence(
      literal('['),
      optional(attributeNamespace),
      g.Identifier,
      optional(sequence(
        g.AttributeOperator,
        choice(
          g.Quoted,
          g.Identifier
        ),
        optional(g.AttributeModifier)
      )),
      literal(']')
    ),
    children => attributeSelector(children.map(sourceText))
  );

  /*
   * A leading dash in a valid contiguous negative An+B argument must not be
   * greedily consumed as a selector token. The zero-width close check makes
   * this a complete argument recognition, so malformed `-n+` and generic raw
   * `-` arguments still reach the existing raw branch. Parser trivia owns
   * comments before `of`; semantic pseudo text keeps only `of <selector>`.
   */
  const LeadingDashPseudoArgument = node(
    'LeadingDashPseudoArgument',
    parser(
      { trivia: whitespace },
      sequence(
        noTrivia(sequence(
          literal('-'),
          g.NthExpression
        )),
        optional(sequence(
          g.NthOfKeyword,
          g.SelectorList
        )),
        g.PseudoSelectorCloseAhead
      )
    ),
    (children) => {
      const nth = `-${tokenText(children[1])}`;
      const selector = children.find(isSelectorList);
      return selector === undefined ? nth : `${nth} of ${selectorArgumentText(selector)}`;
    }
  );
  const LeadingDashRawPseudoArgument = node(
    'LeadingDashRawPseudoArgument',

    /*
     * Preserve only dash-led raw forms that cannot begin a contiguous An+B
     * attempt. A `-` followed by `n`/digits belongs to the complete typed arm
     * above; if that arm cannot close, the public grammar rejects it rather
     * than accepting malformed An+B bytes as a generic pseudo argument.
     */
    choice(
      sequence(
        literal('-'),
        g.PseudoSelectorCloseAhead
      ),
      noTrivia(sequence(

        /* `- 2n` is malformed An+B, not a generic dash-led raw argument.
         * The shared gate owns the full prefix before this branch can consume
         * the dash and bypass the ordinary raw-argument guard below. */
        not(g.MalformedPseudoSelectorNumericArgument),
        literal('-'),
        regex(/[ \t\n\r\f]+/),
        g.pseudoArgumentContent
      )),
      noTrivia(sequence(
        literal('-'),
        literal('-'),
        g.pseudoArgumentContent
      ))
    ),
    children => children.map(sourceText).join('')
  );

  /*
   * A non-dash-led An+B argument (`2n+1`, `n+3`, `n - 3`, `even`). Selectors-4
   * defines the `<An+B>` microsyntax with OPTIONAL whitespace around the `+`/`-`
   * sign — `2n + 1` and `n - 3` are as valid as `2n+1`
   * (https://www.w3.org/TR/selectors-4/#anb-microsyntax; the equivalent grammar
   * note is https://www.w3.org/TR/css-syntax-3/#the-anb-type). The shared `nth`
   * recognition already spans that whitespace; recognize the complete typed form
   * here so a bare-`n`-led argument (`n+3`) is not first claimed by the selector
   * arm below as a lone type selector `n` and then left unable to close. This
   * mirrors the negative `LeadingDashPseudoArgument` arm for the positive
   * and unsigned cases; the trailing `(?=\))` keeps malformed forms (`2n +`,
   * `2n+1x`) on their existing rejecting path.
   */
  const TypedNthPseudoArgument = node(
    'TypedNthPseudoArgument',
    parser(
      { trivia: whitespace },
      sequence(
        g.NthExpression,
        optional(sequence(
          g.NthOfKeyword,
          g.SelectorList
        )),
        g.PseudoSelectorCloseAhead
      )
    ),
    (children) => {
      const nth = tokenText(children[0]);
      const selector = children.find(isSelectorList);
      return selector === undefined ? nth : `${nth} of ${selectorArgumentText(selector)}`;
    }
  );

  /*
   * `:nth-of-type`/`:nth-last-of-type` accept only a BARE `<An+B>` — Selectors-4
   * §6.6.2 does not define an `of S` tail for the type-index families. These arms
   * mirror the child arms above but omit the optional `of <selector>` clause, so
   * a `... of ...` argument no longer matches here and falls to the raw/reject
   * path (the CSS-aligned owner decision, §7.1).
   */
  const LeadingDashOfTypePseudoArgument = node(
    'LeadingDashOfTypePseudoArgument',
    parser(
      { trivia: whitespace },
      sequence(
        noTrivia(sequence(
          literal('-'),
          g.NthExpression
        )),
        g.PseudoSelectorCloseAhead
      )
    ),
    children => `-${tokenText(children[1])}`
  );
  const TypedOfTypePseudoArgument = node(
    'TypedOfTypePseudoArgument',
    parser(
      { trivia: whitespace },
      sequence(
        g.NthExpression,
        g.PseudoSelectorCloseAhead
      )
    ),
    children => tokenText(children[0])
  );
  const PseudoArgument = node(
    'PseudoArgument',
    choice(
      g.LeadingDashPseudoArgument,
      g.LeadingDashRawPseudoArgument,
      g.TypedNthPseudoArgument,
      parser(
        { trivia: interstitialTrivia },
        g.SelectorList
      ),
      sequence(
        not(g.MalformedPseudoSelectorNumericArgument),
        g.pseudoArgumentContent
      )
    ),
    children => selectorArgumentText(children[0])
  );

  /*
   * The `:nth-of-type` family's argument: identical to `PseudoArgument`
   * except the An+B arms are the bare (no-`of`) variants. The two bare An+B arms
   * reject an `of` tail via their close-ahead, but the selector and raw fallbacks
   * would otherwise re-capture `<An+B> of …` as opaque text (the selector arm as a
   * compound selector, the raw arm as a scanned span). A negative lookahead for an
   * `<An+B>` immediately followed by `of` closes both leaks so the whole of-type
   * branch fails — Selectors-4 §6.6.2 defines `of S` only for nth-child/last-child
   * (§7.1). The guard fires ONLY on an An+B-prefixed `of` tail, so every argument
   * that does not use one (a plain selector or opaque raw arg) stays byte-identical.
   */
  const OfTypePseudoArgument = node(
    'OfTypePseudoArgument',
    choice(
      g.LeadingDashOfTypePseudoArgument,
      g.LeadingDashRawPseudoArgument,
      g.TypedOfTypePseudoArgument,
      sequence(
        not(parser(
          { trivia: whitespace },
          sequence(
            g.NthExpression,
            g.NthOfKeyword
          )
        )),
        choice(
          parser(
            { trivia: interstitialTrivia },
            g.SelectorList
          ),
          sequence(
            not(g.MalformedPseudoSelectorNumericArgument),
            g.pseudoArgumentContent
          )
        )
      )
    ),
    children => selectorArgumentText(children[0])
  );

  /*
   * An unknown functional pseudo has one structural `<any-value>` argument.
   * Selector-only pseudos route above to `SelectorOnlyPseudoArgument`; generic
   * pseudos do not speculate on a selector prefix because that is not their
   * grammar. The bounded capture owns its final delimiter so nested groups are
   * part of this complete production rather than a partial outer continuation.
   */
  const GenericPseudoArgument = node(
    'GenericPseudoArgument',
    sequence(
      g.pseudoArgumentContent,
      literal(')')
    ),
    children => selectorArgumentText(children[0])
  );

  /*
   * A `:has()` argument is a relative selector, so an individual branch may open
   * with a combinator (`:has(> .b)`). The outer selector grammar forbids a leading
   * combinator, so this pseudo-private branch admits an optional relative one and
   * emits a `RelativeSelector`. A leading `|` is namespace
   * syntax, not a relative combinator, so it is excluded (mirrors Less's
   * `relativeSelectorCombinator`).
   */
  const RelativeSelector = node(
    'RelativeSelector',
    sequence(
      optional(relativeSelectorCombinator),
      g.ComplexSelector
    ),
    (children) => {
      const branch = children.find(isSelectorBranch)!;
      if (children.length === 1) {
        return branch;
      }
      const lead = cssRelativeCombinator(children[0]);
      return relativeSelector(lead, branchSegments(branch));
    }
  );

  /*
   * The selector-argument pseudos (`:is`/`:where`/`:not`/`:has`/`:matches`) take a
   * selector-ONLY argument: a (relative) selector list with no general-any text
   * fallback, so `:not(2n+1)` fails the selector and rejects the whole pseudo. The
   * non-relative shape reduces byte-identically to `SelectorList` (both assemble
   * `selist(...selectorBranches(children))`); the retained `SelectorList` becomes
   * structured `PseudoSelector.args` in `PseudoSelector`, never joined at parse.
   */
  const SelectorOnlyPseudoArgument = node(
    'SelectorOnlyPseudoArgument',
    parser(
      { trivia: interstitialTrivia },
      oneOrMoreSep(
        RelativeSelector,
        literal(',')
      )
    ),
    children => selist(...selectorBranches(children))
  );

  /*
   * Pseudo selectors share one identifier/function opener after `:`/`::`.
   * Route that opener once, so known function pseudos commit to their structured
   * argument grammar while unknown glued functions keep the generic raw argument
   * path and bare pseudos stay bare keyword pseudos.
   *
   * Functional pseudos consume a CSS function-token opener: the name and `(` are
   * adjacent bytes. `:not (.a)` must not become `:not(.a)` through ambient
   * interstitial trivia, even though spacing inside the argument remains valid.
   */
  const PseudoSelector = node(
    'PseudoSelector',
    sequence(
      pseudoColon,
      dispatch(
        pseudoIdentOrFunction,
        cssCase(
          ['nth-child(', 'nth-last-child('],
          sequence(
            routed(),
            g.PseudoArgument,
            literal(')')
          )
        ),
        cssCase(
          ['nth-of-type(', 'nth-last-of-type('],
          sequence(
            routed(),
            g.OfTypePseudoArgument,
            literal(')')
          )
        ),
        cssCase(
          ['is(', 'where(', 'not(', 'has(', 'matches('],
          sequence(
            routed(),
            SelectorOnlyPseudoArgument,
            literal(')')
          )
        ),
        when(
          endsWith('('),
          sequence(
            routed(),
            GenericPseudoArgument
          )
        ),
        otherwise(sequence(
          not(g.NthPseudoSelectorName),
          routed()
        ))
      )
    ),
    (children) => {
      const pseudoName = functionOpenName(children[1]);
      const head = `${tokenText(children[0])}${pseudoName}`;
      if (children.length === 2) {
        return simpleSelector(head);
      }

      /*
       * Parser = STRUCTURE + trivia only. A whitelisted selector-function pseudo
       * keeps the parsed `args` (SelectorList) and does NOT join: core serialize
       * owns the inline `:is(a, b)` rule (`pseudoCanonical`). The opaque/nth/raw
       * path still collapses to SimpleSelector text via `selectorArgumentText`.
       */
      const arg = children[2];
      if (isSelectorList(arg) && STRUCTURED_PSEUDOS.has(pseudoName.toLowerCase())) {
        return pseudoSelector(
          head,
          arg
        );
      }
      return simpleSelector(`${head}(${selectorArgumentText(arg)})`);
    }
  );

  /*
   * `&` is a semantic selector token, not a post-parse text substitution. The
   * core selector model represents it as the canonical SimpleSelector text expected by
   * nested-rule serialization.
   */
  const NestingSelector = node(
    'SimpleSelector',
    literal('&'),
    () => simpleSelector('&')
  );

  /*
   * The simple-selector atom shared by the compound tower. `&`
   * (NestingSelector) is added as one more arm in `CompoundSelector`; this atom
   * is the non-`&` core. A superset widens this one leaf (interpolation,
   * placeholder, etc.) and inherits the whole selector tower via open-recursion
   * (COMPOSE-MIGRATION-SPEC.md §4.1).
   */
  const simpleSelectorAtom = choice(
    parser(
      { trivia: interstitialTrivia },
      g.AttributeSelector
    ),
    parser(
      { trivia: interstitialTrivia },
      g.PseudoSelector
    ),
    g.NamespaceTypeSelector,
    g.BasicSelector
  );
  const CompoundSelector = node(
    'CompoundSelector',
    noTrivia(parser(
      { trivia: compoundTrivia },
      oneOrMore(choice(
        g.NestingSelector,
        g.simpleSelectorAtom
      ))
    )),
    children => selectorTermFromTokens(children.filter(isSimpleToken))
  );
  const ComplexSelector = node(
    'ComplexSelector',
    sequence(
      g.CompoundSelector,

      /*
       * The separator between compound selectors may be an explicit combinator
       * (`>`, `+`, `~`, `||`) or just ambient trivia, which CSS treats as the
       * descendant combinator. `|` is not here: it is a namespace prefix bound
       * into a single type selector, not a compound separator. Do not collapse
       * this to oneOrMoreSep(): a nullable separator would be the wrong Parseman
       * shape.
       */
      many(sequence(
        optional(combinator),
        g.CompoundSelector
      ))
    ),
    children => selectorBranchOf(complexSegments(children))
  );

  /*
   * A ruleset's selector list carries the STATEMENT's start offset: the
   * renderer reads `sourceStartOf(node.selector)` for a `Ruleset`, because a
   * `Ruleset` itself has no span of its own. Without it the root trivia cursor
   * never advances past a rule, so a comment BETWEEN two top-level rules is
   * dropped even though it was captured. Less spans exactly these two
   * productions and leaves its pseudo-argument selector list unspanned;
   * `SelectorOnlyPseudoArgument` below is left alone for the same reason — it
   * is never a `Ruleset`'s selector, so a span there would move the tree for
   * nothing.
   */
  const SelectorList = node(
    'SelectorList',
    oneOrMoreSep(
      g.ComplexSelector,
      literal(',')
    ),
    (children, _fields, span) => withSourceSpan(selist(...selectorBranches(children)), span)
  );
  const TopLevelSelectorList = node(
    'TopLevelSelectorList',
    oneOrMoreSep(
      g.ComplexSelector,
      literal(',')
    ),
    (children, _fields, span) => withSourceSpan(selist(...selectorBranches(children)), span)
  );

  /*
   * A NESTED ruleset's selector list is relative-capable: CSS Nesting lets a
   * nested selector open with a combinator (`.parent { > .child { … } }`),
   * where `>` relates to the implicit parent (`.parent > .child`). This reuses
   * `RelativeSelector` — the same producer the `:has()`-style pseudos
   * use. Each item keeps its ORDINARY shape (`SimpleSelector`/`CompoundSelector`/
   * `ComplexSelector`, whatever it reduces to); the nesting context ADDS
   * `RelativeSelector` as one more admissible item, produced only when the item
   * opens with a leading combinator. Items MIX freely (`> .a, .b`). The node NAME
   * is the canonical `SelectorList`; only the rules-map KEY differs. The
   * TOP-LEVEL list (`TopLevelSelectorList`) admits no leading combinator, so a
   * stylesheet-root `> .a` — which has no parent to relate to — is still
   * rejected. Carries the ruleset statement's start offset like `SelectorList`.
   */
  const NestedSelectorList = node(
    'SelectorList',
    oneOrMoreSep(
      RelativeSelector,
      literal(',')
    ),
    (children, _fields, span) => withSourceSpan(selist(...selectorBranches(children)), span)
  );
  const Property = node(
    'Property',
    g.Identifier,
    children => tokenText(children[0])
  );
  const CustomProperty = node(
    'CustomProperty',
    g.CustomPropertyName,
    children => tokenText(children[0])
  );

  /* A custom-property value is one opaque token. Comments the balanced-group
   * scanner steps over inside it are value bytes the token already carries, so
   * this scope keeps them out of the root capture the renderer replays. */
  const CustomValue = node(
    'CustomValue',
    parser({ trivia: whitespace, rootCapture: 'opaque' }, customValue),
    children => any(children.length === 0 ? '' : tokenText(children[0]))
  );
  const Keyword = node(
    'Keyword',
    g.Identifier,
    children => keyword(tokenText(children[0]))
  );

  /*
   * Dashed identifiers are not ordinary CSS keywords, but they are valid
   * component values (most visibly as `var(--name)` arguments). Keep the
   * authored dashed identifier as a structured keyword leaf rather than
   * collapsing the whole function or its enclosing calc to raw bytes.
   */
  const CustomPropertyValue = node(
    'CustomPropertyValue',
    g.CustomPropertyName,
    children => keyword(tokenText(children[0]))
  );
  const Color = node(
    'Color',
    hexColor,
    children => color(tokenText(children[0]))
  );

  /*
   * A `<urange>` is one opaque CSS token, so it must be recognized before the
   * numeric/keyword atoms: `U+0-7F` split at the `+` leaves `+0`/`-7F` to be
   * re-read as signed numbers, which serializes valid CSS back out as `U +0 -7F`.
   */
  const UnicodeRange = node(
    'UnicodeRange',
    g.UnicodeRangeToken,
    children => any(tokenText(children[0]))
  );
  const Percentage = node(
    'Dimension',
    noTrivia(sequence(
      numberValue,
      literal('%')
    )),
    (children) => {
      const numberText = tokenText(children[0]);
      return dimension(
        Number(numberText),
        '%',
        `${numberText}%`
      );
    }
  );
  const Dimension = node(
    'Dimension',
    noTrivia(sequence(
      numberNoPercentage,
      optional(dimensionUnit)
    )),
    (children) => {
      const numberText = tokenText(children[0]);
      const unit = children.length > 1 ? tokenText(children[1]) : '';
      return dimension(
        Number(numberText),
        unit,
        `${numberText}${unit}`
      );
    }
  );
  const Quoted = node(
    'Quoted',
    choice(
      noTrivia(sequence(
        literal('"'),
        g.DoubleQuotedText,
        literal('"')
      )),
      noTrivia(sequence(
        literal('\''),
        g.SingleQuotedText,
        literal('\'')
      )),

      /*
       * The public CST already recognizes this static escaped-string spelling.
       * Reduce it to the existing `Quoted.escaped` fact, never an opaque value.
       */
      noTrivia(sequence(
        literal('~"'),
        g.DoubleQuotedText,
        literal('"')
      )),
      noTrivia(sequence(
        literal('~\''),
        g.SingleQuotedText,
        literal('\'')
      ))
    ),
    (children) => {
      const opener = tokenText(children[0]);
      const escaped = opener.startsWith('~');
      const quote = escaped ? opener[1]! : opener;
      const value = tokenText(children[1]);
      return quoted(
        `${escaped ? '~' : ''}${quote}${value}${quote}`,
        value,
        quote,
        escaped
      );
    }
  );
  const UrlUnquoted = node(
    'UrlUnquoted',
    g.UrlInner,
    children => any(tokenText(children[0]!))
  );
  const Url = node(
    'Url',
    sequence(
      urlOpen,
      optional(regex(/[ \t\n\r\f]+/)),
      optional(choice(
        g.Quoted,
        UrlUnquoted
      )),
      optional(regex(/[ \t\n\r\f]+/)),
      expect(
        literal(')'),
        ')'
      )
    ),
    (children) => {
      const body = children.find(isValue);
      return url(body ?? any(''));
    }
  );
  const Call = node(
    'Call',
    sequence(
      genericFunctionOpen,
      optional(cssValueTrivia),
      g.valueFunctionArguments,
      optional(cssValueTrivia),
      literal(')')
    ),
    (children, fields) => {
      const name = functionOpenName(children[0]);
      const args = children.slice(1).filter(isValueSlotValue);
      return funcCall(
        name,
        withAuthoredSeparators(
          args,
          fields,
          Math.max(
            0,
            args.length - 1
          )
        )
      );
    }
  );

  /*
   * CSS arithmetic parentheses are structural only inside calc(), where they
   * preserve math precedence in the AST.
   */
  const CalcParen = node(
    'Block',
    noTrivia(sequence(
      literal('('),
      optional(cssValueTrivia),
      g.CalcSum,
      optional(cssValueTrivia),
      literal(')')
    )),
    children => block(firstValue(children))
  );

  /*
   * `var()` is a component-value substitution boundary even inside a strict
   * calc expression. Its fallback is its own component-value sequence, while
   * the surrounding calc still supplies the arithmetic reduction. This keeps
   * `var(--x, 1px + 2px)` and non-math component fallbacks lossless without
   * turning the function or outer calc into opaque raw bytes.
   */
  const VarFallbackPunctuation = node(
    'VarFallbackPunctuation',
    oneOrMore(punctuationValueCharacter),
    children => any(children.map(tokenText).join(''))
  );

  /*
   * The fallback's bracket/brace leaves retain their authored bytes, so their
   * bodies are captured with scanTo. These zero-width structural guards make
   * that lossless capture reject a closer reached before a nested, differently
   * shaped block has closed: `[a(b]` and `{a[b}` cannot be accepted merely
   * because the outer leaf sees its own closer first. The nested-group skips are
   * the shared `balancedBrackets`/`balancedBraces` combinators.
   */
  const varFallbackBracketCrossParen = sequence(
    literal('['),
    scanTo(
      literal('('),
      { skip: [balancedBrackets] }
    ),
    literal('('),
    scanTo(
      choice(
        literal(')'),
        literal(']')
      ),
      { skip: [balancedBrackets] }
    ),
    literal(']')
  );
  const varFallbackBracketCrossBrace = sequence(
    literal('['),
    scanTo(
      literal('{'),
      { skip: [balancedBrackets] }
    ),
    literal('{'),
    scanTo(
      choice(
        literal('}'),
        literal(']')
      ),
      { skip: [balancedBrackets] }
    ),
    literal(']')
  );
  const varFallbackBraceCrossParen = sequence(
    literal('{'),
    scanTo(
      literal('('),
      { skip: [balancedBraces] }
    ),
    literal('('),
    scanTo(
      choice(
        literal(')'),
        literal('}')
      ),
      { skip: [balancedBraces] }
    ),
    literal('}')
  );
  const varFallbackBraceCrossBracket = sequence(
    literal('{'),
    scanTo(
      literal('['),
      { skip: [balancedBraces] }
    ),
    literal('['),
    scanTo(
      choice(
        literal(']'),
        literal('}')
      ),
      { skip: [balancedBraces] }
    ),
    literal('}')
  );

  /*
   * A parenthesized fallback is structural, unlike the raw bracket/brace
   * leaves below. Give it the same ordered-delimiter guard: `([a])` and
   * `({a})` are valid adjacent nested groups, while `([a)]` and `({a)}` are
   * crossed closures rather than an opportunity to reassign a closer to an
   * enclosing var()/calc() production.
   */
  const varFallbackParenCrossBracket = sequence(
    literal('('),
    scanTo(
      literal('[')
    ),
    literal('['),
    scanTo(
      choice(
        literal(']'),
        literal(')')
      )
    ),
    literal(')')
  );
  const varFallbackParenCrossBrace = sequence(
    literal('('),
    scanTo(
      literal('{')
    ),
    literal('{'),
    scanTo(
      choice(
        literal('}'),
        literal(')')
      )
    ),
    literal(')')
  );
  const VarFallbackParen = node(
    'VarFallbackParen',
    sequence(
      not(choice(
        varFallbackParenCrossBracket,
        varFallbackParenCrossBrace
      )),
      literal('('),
      optional(cssValueTrivia),
      optional(g.VarFallback),
      optional(cssValueTrivia),
      literal(')')
    ),
    children => block(valueSlotChildren(children)[0] ?? any(''))
  );

  /*
   * Core has no bracket value node. Keep a bracket component as its existing
   * lossless Any leaf, but let Parseman recognize its balanced structure so a
   * nested group or quoted/string content can never terminate the fallback
   * early or make the enclosing var call opaque.
   */
  const VarFallbackBracket = node(
    'VarFallbackBracket',
    sequence(
      not(choice(
        varFallbackBracketCrossParen,
        varFallbackBracketCrossBrace
      )),
      literal('['),
      scanTo(
        literal(']'),
        {
          skip: [balancedBrackets]
        }
      ),
      literal(']')
    ),
    children => any(children.map(tokenText).join(''))
  );
  const VarFallbackBrace = node(
    'VarFallbackBrace',
    sequence(
      not(choice(
        varFallbackBraceCrossParen,
        varFallbackBraceCrossBracket
      )),
      literal('{'),
      scanTo(
        literal('}'),
        {
          skip: [balancedBraces]
        }
      ),
      literal('}')
    ),
    children => any(children.map(tokenText).join(''))
  );

  /*
   * A nested var() needs its own first separator and trailing fallback commas
   * preserved exactly as the outer var does. It must therefore win before the
   * generic function-call component arm in every fallback component position.
   * This is a dispatch-adjacent hotspot, but not a blind rewrite target:
   * fallback generic functions use fallback comma semantics, while ordinary
   * typed values use CSS value-list separators. A future routed shape must keep
   * that fallback-specific function body instead of merely reusing
   * TypedIdentOrFunction.
   */
  const varFallbackComponent = choice(
    g.VarCall,
    g.VarFallbackCall,
    g.TypedValue,
    g.VarFallbackParen,
    g.VarFallbackBracket,
    g.VarFallbackBrace,
    g.VarFallbackPunctuation
  );

  const VarFallbackTerm = node(
    'VarFallbackTerm',
    sequence(
      varFallbackComponent,
      many(sequence(
        optional(cssValueTrivia),
        varFallbackComponent
      ))
    ),
    (children) => {
      const values = valueSlotChildren(children);
      return values.length === 1 ? values[0]! : values;
    }
  );
  const VarFallbackEmpty = node(
    'VarFallbackEmpty',
    choice(
      peek(literal(',')),
      peek(literal(')'))
    ),
    () => any('')
  );
  const varFallbackComma = sequence(
    literal(','),
    optional(cssValueTrivia)
  );
  const VarFallbackItem = node(
    'VarFallbackItem',
    choice(
      g.VarFallbackTerm,
      g.VarFallbackEmpty
    ),
    { project: 0 }
  );
  const VarFallback = node(
    'VarFallback',
    oneOrMoreSep(
      g.VarFallbackItem,
      varFallbackComma
    ),
    (children) => {
      const values = valueSlotChildren(children);
      return values.length === 1
        ? values[0]!
        : list(
            values,
            ','
          );
    }
  );
  const VarFallbackCall = node(
    'VarFallbackCall',
    sequence(
      genericFunctionOpen,
      optional(sequence(
        not(literal(')')),
        oneOrMoreSep(
          g.VarFallbackItem,
          varFallbackComma
        )
      )),
      literal(')')
    ),
    children => funcCall(
      functionOpenName(children[0]),
      children.filter(isValueSlotValue)
    )
  );
  const VarCall = node(
    'VarCall',
    sequence(
      varOpen,
      optional(cssValueTrivia),
      g.CustomPropertyValue,
      optional(cssValueTrivia),
      optional(sequence(
        literal(','),
        optional(cssValueTrivia),
        choice(
          g.VarFallback,
          g.VarFallbackEmpty
        ),
        optional(cssValueTrivia)
      )),
      literal(')')
    ),
    children => funcCall(
      functionOpenName(children[0]),
      children.filter(isValueSlotValue)
    )
  );

  /*
   * Blast radius: `../../../jess/jess-parser/src/grammar.ts` PORTS this family
   * (`CalcValue`/`CalcParen`/`CalcProduct`/`CalcSum`/`CalcSequence`) rather
   * than referencing it — a mutually recursive, AST-reducing family cannot be
   * shared through `@jesscss/parser-shared`, whose artifacts are `g.`-free by
   * contract. A change to the shape or accept set here must be mirrored there.
   * Less and SCSS express the same ladder as `MathProduct`/`MathSum`.
   */
  /*
   * `UnicodeRange` is here so this rung is a SUPERSET of the ordinary typed
   * value atom rather than a narrower cousin of it. Before §6 the ladder was reachable only from `calc()`, so the gap did
   * not show; now that every css-values-4 §10 function routes here, anything
   * this choice lacks is a construct the base would start REJECTING. `min(U+0-7F)`
   * is the measured case — `UnicodeRange` is in `Value`/`TypedValue` and was
   * absent here.
   *
   * `PunctuationValue` is deliberately NOT admitted: it would let a bare `+`
   * match as an operand and collapse the operator ladder above. `ParenValue`
   * and `SquareValue` are not admitted either — measured: adding `ParenValue`
   * here makes the TOP-LEVEL `a { b: (c ,d) }` stop parsing, so the cycle it
   * creates through the value dispatch is not inert. `CalcParen` already covers
   * the arithmetic-grouping shape, which is the one css-values-4 §10 defines.
   */
  const calcValueAtom = choice(
    g.Percentage,
    g.Dimension,
    g.Color,
    g.UnicodeRange,
    g.CalcIdentOrFunction,
    g.CalcParen,
    g.Quoted,
    g.CustomPropertyValue
  );
  const CalcValue = node(
    'CalcValue',
    g.calcValueAtom,
    { project: 0 }
  );
  const CalcProduct = node(
    'CalcProduct',
    noTrivia(sequence(
      g.CalcValue,
      many(sequence(
        calcProductOperator,
        g.CalcValue
      ))
    )),
    children => foldOperation(children)
  );
  const CalcSum = node(
    'CalcSum',
    noTrivia(sequence(
      g.CalcProduct,
      many(sequence(
        calcSumOperator,
        g.CalcProduct
      ))
    )),
    children => foldOperation(children)
  );

  /*
   * The SEQUENCE layer, and the reason routing a math function's arguments to
   * the ladder below is a widening rather than a narrowing.
   *
   * `CalcSum` has no space-separated-run derivation, because `calc()` never
   * needed one. Every other css-values-4 §10 function does: `min(1px 2px)`,
   * `clamp(1px 2px, 3px)` and `min(red blue)` are shapes the base accepts
   * today through the ordinary value sequence, and the parser accepts SHAPES,
   * not semantics — that `min(1px 2px)` is not valid CSS does not license
   * rejecting it. Without this rung, routing the §10 names to the ladder was
   * measured at 17 regressions in a 25-case battery.
   *
   * This is `ValueSequence`'s own shape with `CalcSum` in place of `Value`, so
   * a run whose items carry no operator reduces to exactly what the ordinary
   * sequence would have produced — with ONE deliberate difference: the
   * separator is REQUIRED between run items.
   *
   * That difference is the adjacency question (ledger G24), and it is the whole
   * reason this rung cannot be `ValueSequence` itself. `ValueSequence` admits
   * ADJACENT items with no trivia at all, because at top level `1rem+1vw` is
   * two component values. Inside a math function it is not: css-values-4 §10.1
   * requires real whitespace on both sides of `+`/`-`, so `calc(1rem+1vw)` must
   * be REJECTED, and it is rejected here by the absence of the bare arm rather
   * than by any production re-spelling what a separator looks like.
   */
  const CalcSequence = node(
    'CalcSequence',
    noTrivia(sequence(
      g.CalcSum,
      many(sequence(
        field(
          'separator',
          cssValueTrivia
        ),
        not(signedNumericStart),
        g.CalcSum
      ))
    )),
    (children, fields) => {
      const values = valueSlotChildren(children);
      if (values.length === 1) {
        return values[0]!;
      }
      return withAuthoredSeparators(
        values,
        fields,
        values.length - 1
      );
    }
  );

  /*
   * `<calc-sum>#` — the comma-separated argument list every §10 function takes.
   * `round()` additionally takes an optional leading `<rounding-strategy>`
   * keyword (`round(up, 1.2px, 1px)`), which needs no arm of its own: a bare
   * keyword is already a `CalcValue`, so the strategy arrives as the first
   * argument. The grammar is therefore NOT uniformly `<calc-sum>#`, and the
   * place that fact is enforced is the language service, not here.
   */
  const calcFunctionArguments = oneOrMoreSep(
    g.CalcSequence,
    authoredArgumentComma
  );
  const CalcCall = node(
    'CalcCall',
    noTrivia(sequence(
      calcOpen,
      optional(cssValueTrivia),
      g.CalcSum,
      optional(cssValueTrivia),
      literal(')')
    )),
    children => funcCall(
      functionOpenName(children[0]),
      [firstValue(children)]
    )
  );

  /*
   * Preserve the public declaration component-value language without letting
   * its permissive forms leak into query preludes or dedicated function
   * productions. url()/var()/calc() stay owned by their strict branches;
   * genericFunctionOpen excludes those glued openers.
   */
  /*
   * The padding is spelled for the same reason `GenericFunction` spells it: this
   * interior runs with trivia cleared, so without these terms `( c )` — and every
   * comment form of it — was rejected as hard as `(/* c *\/ e)` was.
   */
  const ParenValue = node(
    'ParenValue',
    sequence(
      literal('('),
      optional(cssValueTrivia),
      optional(g.ValueList),
      optional(cssValueTrivia),
      literal(')')
    ),
    children => block(valueSlotChildren(children)[0] ?? any(''))
  );

  /*
   * The square sibling of `ParenValue`, carrying its delimiter as a first-class
   * `Block` fact rather than opaque bytes. `[` had no value first-set at all, so
   * `grid: [a] 10px` and `grid-template-columns: [full-start] 1fr` died at the
   * bracket while Less and SCSS both accepted them — the base rejecting what its
   * own supersets accept.
   *
   * Named for the delimiter, not for `<line-names>`: the same bytes are Sass
   * bracketed lists, and naming a shared shape after one consumer is how a
   * grammar ends up claiming a construct it does not own.
   *
   * The interior is `ValueList`, exactly as the paren sibling spells it, so a
   * multi-name `[a b]` is one slot holding an ARRAY. A reducer that narrows that
   * with a single-node guard throws past the `SyntaxError` contract instead of
   * declining — the defect SCSS's own square arm shipped and fixed in e4c948a7d.
   *
   * `find`, not `valueSlotChildren`: `<line-names>` is `<custom-ident>*`, so `[]`
   * is legal and its interior is empty. `valueSlotChildren` THROWS on an empty
   * match rather than returning `[]`, so the `?? []` a caller writes after it
   * is unreachable — which is exactly why the paren sibling still crashes on
   * `a{color:()}` instead of rejecting it. Do not copy that call here.
   *
   * The empty interior is the EMPTY SLOT `[]`, not `any('')`. A contentless `Any`
   * is a content node minted where the source has no content: it erases the one
   * fact `[]` carries — that it is EMPTY — and every downstream emptiness test
   * (`.jess` truthiness, §4.4's fourth falsy row) then reads a non-empty group and
   * answers TRUTHY. Storing the emptiness losslessly here is what lets those
   * consumers derive it, instead of each sniffing an empty `src` for itself.
   */
  const SquareValue = node(
    'Block',
    sequence(
      literal('['),
      optional(cssValueTrivia),
      optional(g.ValueList),
      optional(cssValueTrivia),
      literal(']')
    ),
    children => block(
      children.find(isValueSlotValue) ?? [],
      'square'
    )
  );
  const RawParenValue = node(
    'RawParenValue',
    sequence(
      literal('('),
      scanTo(
        literal(')'),
        { skip: [balancedParens, balancedBrackets, balancedBraces] }
      ),
      literal(')')
    ),
    children => block(any(tokenText(children[1])))
  );

  /*
   * The spaced paren bridge (`foo (bar)`), reached through `IdentOrFunction`'s
   * routing so the identifier is scanned once. As a sibling of the identifier
   * atoms in `Value` it led with its own `genericIdentifier` and failed on every
   * ordinary keyword, re-scanning the identifier the next arm then scanned
   * again. Routing keeps the order rather than swapping it: a glued `(` is
   * claimed by the function cases, and `cssValueTrivia` cannot match empty, so
   * this bridge always requires trivia before its `(` and no input can reach
   * both.
   */
  const IdentBlock = node(
    'IdentBlock',
    sequence(
      routed(),
      field(
        'separator',
        cssValueTrivia
      ),
      g.RawParenValue
    ),
    (children, fields) => withAuthoredSeparators(
      spaced([
        keyword(tokenText(children[0])),
        firstValue(children)
      ]),
      fields,
      1
    )
  );
  const slashValueBoundaryAhead = peek(choice(
    literal('.'),
    regex(/[0-9]/),
    regex(/[ \t\n\r\f]/)
  ));
  const identOrFunction = token(noTrivia(
    sequence(
      genericIdentifier,
      optional(literal('('))
    )
  ));
  const PunctuationValue = node(
    'PunctuationValue',

    /*
     * Slash is a component boundary before a number or whitespace. Keep just
     * that slash as one structured punctuation component so `/ .5` does not
     * swallow the numeric leaf into opaque bytes; punctuation runs such as
     * `//` remain losslessly represented as one Any node.
     *
     * Both original arms led with not('/*'), collapsing this node's first-set to
     * 'any' so it (and the whole value atom it terminates) entered speculatively
     * at every value-term boundary. This value path runs under the enclosing
     * value-term noTrivia, so the '/*' guard is adjacent-only; split on the first
     * char instead: the '/' arm consumes '/', rejects an adjacent '*' (comment),
     * then keeps the single-slash-before-number/ws case or continues the run; the
     * non-slash arm leads with the 16 non-'/' punctuation literals. Every arm now
     * resolves a concrete first-set, so the compiler first-char-gates it.
     */
    choice(
      noTrivia(sequence(
        literal('/'),
        not(literal('*')),
        choice(
          slashValueBoundaryAhead,
          many(punctuationValueCharacter)
        )
      )),
      sequence(
        nonSlashPunctuationValueStart,
        many(punctuationValueCharacter)
      )
    ),
    children => any(children.map(tokenText).join(''))
  );
  const GenericFunction = node(
    'Call',
    sequence(
      routed(),
      optional(cssValueTrivia),
      genericFunctionArguments,
      optional(cssValueTrivia),
      literal(')')
    ),
    (children, fields) => {
      const name = functionOpenName(children[0]);
      const args = children.filter(isValueSlotValue);
      return funcCall(
        name,
        withAuthoredSeparators(
          args,
          fields,
          Math.max(
            0,
            args.length - 1
          )
        )
      );
    }
  );
  const UrlFunction = node(
    'Url',
    sequence(
      routed(),
      optional(regex(/[ \t\n\r\f]+/)),
      optional(choice(
        g.Quoted,
        UrlUnquoted
      )),
      optional(regex(/[ \t\n\r\f]+/)),
      expect(
        literal(')'),
        ')'
      )
    ),
    (children) => {
      const body = children.find(isValue);
      return url(body ?? any(''));
    }
  );

  /*
   * The css-values-4 §10 math functions — `calc` and the other twenty — share
   * ONE tail. `calc()` computes nothing; it is a spelling the parser detects so
   * the operations inside it are not folded away, and every other §10 name has
   * exactly that same relationship to the grammar. The names come from
   * `CSS_MATH_FUNCTIONS` (`@jesscss/core/ast`), which is the single table all
   * four grammars and core share.
   *
   * The tail is the same `Call` reduction `GenericFunction` uses, so the AST a
   * math function produces differs from a generic call only in what its
   * ARGUMENTS parsed as. `calc()` keeps arriving as one argument.
   */
  const MathFunction = node(
    'Call',
    noTrivia(sequence(
      routed(),
      optional(cssValueTrivia),
      g.calcFunctionArguments,
      optional(cssValueTrivia),
      literal(')')
    )),
    (children, fields) => {
      const name = functionOpenName(children[0]);
      const args = children.slice(1).filter(isValueSlotValue);
      return funcCall(
        name,
        withAuthoredSeparators(
          args,
          fields,
          Math.max(
            0,
            args.length - 1
          )
        )
      );
    }
  );
  const VarFunction = node(
    'VarCall',
    sequence(
      routed(),
      optional(cssValueTrivia),
      g.CustomPropertyValue,
      optional(cssValueTrivia),
      optional(sequence(
        literal(','),
        optional(cssValueTrivia),
        choice(
          g.VarFallback,
          g.VarFallbackEmpty
        ),
        optional(cssValueTrivia)
      )),
      literal(')')
    ),
    children => funcCall(
      functionOpenName(children[0]),
      children.filter(isValueSlotValue)
    )
  );
  const RoutedKeyword = node(
    'Keyword',
    routed(),
    children => keyword(tokenText(children[0]))
  );
  const IdentBlockOrKeyword = choice(
    IdentBlock,
    g.RoutedKeyword
  );

  /*
   * Declaration identifiers and glued function openers share one lexical shape.
   * Parse it once, then route the complete opener to the dedicated URL, calc(),
   * var(), generic-call, or keyword tail. `foo (` remains a keyword followed by
   * a parenthesized value because the opener is parsed with noTrivia.
   */
  const IdentOrFunction = dispatch(
    identOrFunction,
    cssCase(
      'url(',
      UrlFunction
    ),

    /*
     * ONE multi-key arm, not twenty. parseman compiles `dispatch` to a linear
     * if/else chain with each tail fully INLINED, and this tail is emitted
     * once per artifact per arm: twenty separate `cssCase` arms were measured
     * at roughly 1.4 MB of generated code across css+jess against roughly
     * 70 KB for the multi-key form. The tail is a `g.`-rule reference for the
     * same reason.
     *
     * Both css dispatch tables carry this arm. Changing only one would leave
     * the typed and non-typed ladders reaching different argument grammars for
     * the same function name — which is the divergence §6 exists to close.
     */
    cssCase(
      CSS_MATH_FUNCTION_OPENERS,
      g.MathFunction
    ),
    cssCase(
      'var(',
      VarFunction
    ),
    when(
      endsWith('('),
      GenericFunction
    ),
    otherwise(IdentBlockOrKeyword)
  );
  const TypedGenericFunction = node(
    'Call',
    sequence(
      routed(),
      optional(cssValueTrivia),
      g.valueFunctionArguments,
      optional(cssValueTrivia),
      literal(')')
    ),
    (children, fields) => {
      const name = functionOpenName(children[0]);
      const args = children.slice(1).filter(isValueSlotValue);
      return funcCall(
        name,
        withAuthoredSeparators(
          args,
          fields,
          Math.max(
            0,
            args.length - 1
          )
        )
      );
    }
  );
  const typedIdentOrFunction = dispatch(
    identOrFunction,
    cssCase(
      'url(',
      UrlFunction
    ),

    /*
     * ONE multi-key arm, not twenty. parseman compiles `dispatch` to a linear
     * if/else chain with each tail fully INLINED, and this tail is emitted
     * once per artifact per arm: twenty separate `cssCase` arms were measured
     * at roughly 1.4 MB of generated code across css+jess against roughly
     * 70 KB for the multi-key form. The tail is a `g.`-rule reference for the
     * same reason.
     *
     * Both css dispatch tables carry this arm. Changing only one would leave
     * the typed and non-typed ladders reaching different argument grammars for
     * the same function name — which is the divergence §6 exists to close.
     */
    cssCase(
      CSS_MATH_FUNCTION_OPENERS,
      g.MathFunction
    ),
    cssCase(
      'var(',
      VarFunction
    ),
    when(
      endsWith('('),
      TypedGenericFunction
    ),
    otherwise(g.RoutedKeyword)
  );
  const CalcIdentOrFunction = typedIdentOrFunction;
  const TypedIdentOrFunction = typedIdentOrFunction;

  /*
   * Identifier-shaped atoms are routed by `IdentOrFunction`: known glued
   * functions keep their dedicated tails, other glued functions use the
   * generic call tail, and an identifier with no glued `(` is either the
   * spaced paren bridge (`foo (bar)`, which preserves its authored separator
   * as a value boundary) or a keyword. One route means the identifier is
   * scanned once. The final punctuation fallback needs no negative identifier
   * preflight: every identifier-shaped start has already been consumed by
   * this route.
   */
  const valueAtom = choice(
    g.Percentage,
    g.Dimension,
    g.Color,
    g.UnicodeRange,
    IdentOrFunction,
    g.ParenValue,
    g.SquareValue,
    g.Quoted,
    g.CustomPropertyValue,
    g.PunctuationValue
  );
  const Value = node(
    'Value',
    g.valueAtom,
    { project: 0 }
  );
  const ValueSequence = node(
    'ValueSequence',
    noTrivia(sequence(
      g.Value,
      many(choice(
        sequence(
          field(
            'separator',
            cssValueTrivia
          ),
          g.Value
        ),
        g.Value
      ))
    )),
    (children, fields) => {
      const values = valueSlotChildren(children);
      if (values.length === 1) {
        return values[0]!;
      }
      return withAuthoredSeparators(
        values,
        fields,
        values.length - 1
      );
    }
  );
  const ValueList = node(
    'ValueList',
    oneOrMoreSep(
      g.ValueSequence,
      authoredValueComma
    ),
    (children, fields) => {
      const terms = valueSlotChildren(children);
      if (terms.length === 1) {
        return terms[0]!;
      }
      return withAuthoredSeparators(
        list(
          terms,
          ','
        ),
        fields,
        terms.length - 1
      );
    }
  );
  const TypedValue = node(
    'TypedValue',
    choice(
      g.Percentage,
      g.Dimension,
      g.Color,
      g.Quoted,
      g.CustomPropertyValue,
      g.UnicodeRange,
      TypedIdentOrFunction
    ),
    { project: 0 }
  );
  const TypedValueSequence = node(
    'TypedValueSequence',
    noTrivia(sequence(
      g.TypedValue,
      many(choice(
        sequence(
          field(
            'separator',
            cssValueTrivia
          ),
          g.TypedValue
        ),
        g.TypedValue
      ))
    )),
    (children, fields) => {
      const values = valueSlotChildren(children);
      if (values.length === 1) {
        return values[0]!;
      }
      return withAuthoredSeparators(
        values,
        fields,
        values.length - 1
      );
    }
  );
  const TypedValueList = node(
    'TypedValueList',
    oneOrMoreSep(
      g.TypedValueSequence,
      authoredValueComma
    ),
    (children, fields) => {
      const terms = valueSlotChildren(children);
      if (terms.length === 1) {
        return terms[0]!;
      }
      return withAuthoredSeparators(
        list(
          terms,
          ','
        ),
        fields,
        terms.length - 1
      );
    }
  );

  /*
   * Comments are CSS component-value trivia around a priority marker. They
   * cannot become declaration values or block the `!important` reduction.
   */
  const Important = node(
    'Important',

    /*
     * Lead with `!` (the cheap disambiguating signal) so this arm resolves a
     * concrete first-set and optional(Important) is first-char-gated instead of
     * entering the node frame at every declaration's value boundary.
     */
    sequence(literal('!'), g.ImportantToken),
    () => true
  );
  const Declaration = node(
    'Declaration',
    choice(
      sequence(
        g.CustomProperty,
        literal(':'),
        g.CustomValue,
        optional(g.Important)
      ),
      sequence(
        g.Property,
        literal(':'),

        /*
         * A declaration value is a component-value sequence. In particular, a
         * structured function is one component, not the entire value: `url(x)
         * / cover`, `var(--x) solid`, and `foo(bar) baz` all retain the
         * existing structured leaves inside a Sequence. Identifier-shaped
         * components route from one opener, so a malformed known function such
         * as `calc()` cannot degrade into a keyword plus punctuation.
         */
        g.ValueList,
        not(literal('{')),
        optional(g.Important)
      )
    ),

    /*
     * The span is what BOUNDS a declaration inside its owner's body. The
     * renderer replays body trivia by advancing a cursor to each statement's
     * END, so a declaration with no span leaves the cursor parked at the body
     * start: every comment authored in the body then falls out of the closing
     * flush in one clump at the `}` instead of at the position it was written.
     * Less has carried this span from the start (`StandardDeclaration`), which
     * is why Less alone renders these in place; css, scss and jess did not.
     *
     * The production deliberately does NOT include the statement `;` — Less's
     * does not either, and an end past the semicolon turns a following comment
     * into an INLINE trailing comment, which splices it before the `;`.
     *
     * The CUSTOM-PROPERTY arm is deliberately left unspanned, exactly as Less
     * leaves its own `CustomDeclaration` unspanned. A custom-property value is
     * retained as authored bytes, so a comment inside it is already part of the
     * value; spanning the declaration additionally claims the run that FOLLOWS
     * the value, and `a{--var:/* 1 *\/}` renders `--var: /* 1 *\/;` instead of
     * keeping the comment as a body comment the way all four dialects do today.
     */
    (children, _fields, span) => {
      const name = tokenText(children[0]);
      if (name.startsWith('--')) {
        const value = children.find((child): child is ValueNode => isNodeType(
          child,
          'Any'
        ));
        if (value === undefined) {
          throw new Error('Declaration requires a captured custom-property value');
        }
        return decl(
          name,
          valueSlot(value),
          null,
          children.includes(true)
        );
      }
      const value = children.find(isValueSlotValue);
      if (value === undefined) {
        throw new Error('Declaration requires a structured value');
      }
      return withSourceSpan(decl(
        name,
        Array.isArray(value) ? value : valueSlot(value),
        null,
        children.includes(true)
      ), span);
    }
  );

  /*
   * This import-local URL target intentionally accepts the public grammar's
   * comment trivia around `url` / `(` / payload / `)`. It does not change the
   * ordinary declaration-value URL grammar, and comments after the closing `)`
   * remain owned by ImportTail as authored tail bytes.
   */
  const ImportUrlUnquoted = node(
    'ImportUrlUnquoted',
    g.UrlInner,
    children => any(tokenText(children[0]!))
  );
  const ImportUrl = node(
    'ImportUrl',
    sequence(
      urlOpen,
      optional(choice(
        g.Quoted,
        g.ImportUrlUnquoted
      )),
      expect(
        literal(')'),
        ')'
      )
    ),
    children => url(children.find(isValue) ?? any(''))
  );
  const ImportTailRaw = node(
    'ImportTailRaw',
    choice(
      importTailGroup,
      importTailSquareGroup,
      customDoubleQuoted,
      customSingleQuoted,
      importTailText,
      literal('/')
    ),
    children => any(children.map(tokenText).join(''))
  );
  const ImportTailBody = node(
    'ImportTailBody',
    parser(
      { trivia: commentTrivia },
      sequence(
        g.ImportTailRaw,
        many(choice(
          g.ImportTailRaw,
          importTailWhitespace
        ))
      )
    ),
    (children, _fields, _span, _rawChildren, triviaLog) => any(semanticTextWithTriviaGaps(children, triviaLog))
  );
  const ImportTail = node(
    'ImportTail',
    noTrivia(sequence(
      many(importTailWhitespace),
      g.ImportTailBody
    )),
    children => any(sourceText(children[children.length - 1]!))
  );
  const ImportStatement = node(
    'ImportStatement',
    sequence(
      importAtKeyword,
      choice(
        g.Quoted,
        g.ImportUrl
      ),
      optional(g.ImportTail),
      literal(';')
    ),
    (children, _fields, span) => {
      const target = children.find(isImportTarget);
      if (target === undefined) {
        throw new Error('ImportStatement requires a static quoted or url target');
      }
      const tail = children.find((child): child is ValueNode => isNodeType(
        child,
        'Any'
      )) ?? null;
      return withSourceSpan(atRuleStatement(
        tokenText(children[0]),
        importPrelude(
          target,
          tail
        )
      ), span);
    }
  );
  const AtRuleStatement = node(
    'AtRuleStatement',
    sequence(
      g.StatementAtRuleName,
      g.StatementPrelude,
      literal(';')
    ),
    (children, _fields, span) => {
      const name = tokenText(children[0]);
      return withSourceSpan(atRuleStatement(
        name,
        optionalValue(children[1])
      ), span);
    }
  );
  const RoutedAtRuleStatement = node(
    'AtRuleStatement',
    sequence(
      routed(),
      g.StatementPrelude,
      literal(';')
    ),
    (children, _fields, span) => {
      const name = tokenText(children[0]);
      return withSourceSpan(atRuleStatement(
        name,
        optionalValue(children[1])
      ), span);
    }
  );
  const AtRulePreludeWhitespace = node(
    'AtRulePreludeWhitespace',
    noTrivia(regex(/[ \t\n\r\f]+/)),
    children => authoredText(children)
  );
  const AtRulePreludeComma = node(
    'AtRulePreludeComma',
    noTrivia(literal(',')),
    children => authoredText(children)
  );
  const AtRulePreludeGroup = node(
    'AtRulePreludeGroup',
    noTrivia(choice(
      token(balancedParens),
      token(balancedBrackets)
    )),
    children => authoredText(children)
  );
  const AtRulePreludeQuoted = node(
    'AtRulePreludeQuoted',
    noTrivia(choice(
      customSingleQuoted,
      customDoubleQuoted
    )),
    children => authoredText(children)
  );
  const atPreludeTextSegment = regex(/(?:\\[\s\S]|\/(?!\*)|[^\\/ \t\n\r\f,;{}()[\]"'])+/);
  const AtRulePreludeText = node(
    'AtRulePreludeText',
    noTrivia(atPreludeTextSegment),
    children => authoredText(children)
  );
  const AtRulePreludeSegments = node(
    'AtRulePreludeSegments',
    parser(
      { trivia: commentTrivia },
      many(choice(
        g.AtRulePreludeWhitespace,
        g.AtRulePreludeComma,
        g.AtRulePreludeGroup,
        g.AtRulePreludeQuoted,
        g.AtRulePreludeText
      ))
    ),
    (children, _fields, _span, _rawChildren, triviaLog) => semanticTextWithTriviaGaps(children, triviaLog)
  );

  /*
   * `@charset` is the first thing a stylesheet may contain (css-syntax-3 §3.2),
   * and css-cascade-5 §3 then admits `@import` before any other rule. Without a
   * prologue arm of its own `@charset` is only reachable as an ordinary body
   * at-rule, and matching one there ends the prologue `many` — which is what
   * made the canonical `@charset` + `@import` pair unparseable while `@charset`
   * followed by a rule, a comment, `@media` or `@layer` all parsed. The
   * statement stays a plain `AtRuleStatement` fact so nothing downstream has a
   * new node shape to learn.
   */
  const CharsetStatement = node(
    'CharsetStatement',
    sequence(
      charsetAtKeyword,
      g.StatementPrelude,
      literal(';')
    ),
    children => atRuleStatement(
      tokenText(children[0]),
      optionalValue(children[1])
    )
  );
  const LayerStatement = node(
    'LayerStatement',
    sequence(
      g.LayerAtKeyword,
      g.StatementPrelude,
      literal(';')
    ),
    children => atRuleStatement(
      tokenText(children[0]),
      optionalValue(children[1])
    )
  );

  const AtRulePrelude = node(
    'AtRulePrelude',
    g.AtRulePreludeSegments,
    (children) => {
      const text = children.length === 0 ? '' : tokenText(children[0]).trim();
      return text === '' ? null : any(text);
    }
  );
  const StatementPrelude = node(
    'StatementPrelude',
    g.AtRulePreludeSegments,
    (children) => {
      const text = children.length === 0 ? '' : tokenText(children[0]).trim();
      return text === '' ? null : any(text);
    }
  );

  /*
   * An unknown at-rule's block is a simple block of component values
   * (css-syntax-3 §5.4.2 "consume an at-rule" → §5.4.8 "consume a simple
   * block"). That is the block's SYNTACTIC structure and the spec states it;
   * what the spec leaves to the defining at-rule is the SEMANTIC reading —
   * *"This specification places no limits on what an at-rule's block may
   * contain. Individual at-rules must define whether they accept a block, and
   * if so, how to parse it."* No spec defines one for an unknown at-rule, so
   * the prelude and body are scanned to their delimiters and kept as raw bytes
   * (`opaqueAtRulePrelude`/`opaqueAtRuleBody`), reusing the canonical comment,
   * escape and quoted-string terminals — a string is still the canonical
   * `String`, a comment still `Comment`; the unknown at-rule adds tolerance in
   * the scanner (an unpaired quote is walked past as an ordinary byte), not a
   * forked copy of those productions.
   *
   * The prelude and body scans are both optional/zero-width — an empty header or
   * body contributes no child slot — so the reducer anchors on the structural
   * `{` literal: the prelude is the one child before it, the body the one child
   * between it and the closing `}`.
   */
  const OpaqueAtRuleBlock = node(
    'OpaqueAtRuleBlock',
    sequence(
      routed(),
      noTrivia(sequence(
        opaqueAtRulePrelude,
        literal('{'),
        opaqueAtRuleBody,
        literal('}')
      ))
    ),
    (children) => {
      const openIdx = tokenText(children[1]) === '{' ? 1 : 2;
      const preludeText = openIdx === 2 ? tokenText(children[1]).trim() : '';
      const prelude = preludeText === '' ? null : preludeText;
      const rawBody = children.length - openIdx === 3 ? tokenText(children[openIdx + 1]) : '';
      return opaqueAtRuleBlock(
        tokenText(children[0]!),
        prelude,
        rawBody
      );
    }
  );

  /*
   * A media/container feature value may be a `<ratio>` — media-queries-4 §2.1,
   * `<number> [ / <number> ]?` — as in `(aspect-ratio: 16/9)`. The component
   * value language has no top-level slash (only the permissive declaration
   * fallback carries one), so the query value takes the ratio's slash tail
   * explicitly and reduces it to the same typed Operation the prelude already
   * uses for `:` and the range comparisons. Left-factored on the atom: the
   * no-slash majority parses one value and takes an absent optional tail
   * instead of speculating a doomed ratio arm first.
   *
   * `<mf-value>` is ONE component value (media-queries-4 §4: `<number>`,
   * `<dimension>`, `<ident>` or `<ratio>`), so this takes TypedValue, not
   * the space/comma-list ValueList. A list-valued operand (`(foo: bar baz)`)
   * is `<general-enclosed>` per §3.1, and the whole-list production could not
   * represent one anyway: its multi-part slot is an array, which the enclosing
   * feature reducers cannot place in an Operation. Matching that shape here and
   * failing in the reduction is what let a raw `Error` escape `parse()`; the
   * shape now fails to MATCH, so the caller gets a positioned CssParseError,
   * and `@supports` falls through to its general-enclosed arm as intended.
   */
  const QueryValue = node(
    'QueryValue',
    sequence(
      g.TypedValue,
      optional(sequence(
        literal('/'),
        g.TypedValue
      ))
    ),
    (children) => {
      const values = valueChildren(children);
      const numerator = values[0]!;
      const denominator = values[1];
      if (denominator === undefined) {
        return numerator;
      }
      return operation(
        '/',
        numerator,
        denominator,
        false,
        cssBaseMathOutsideParens('/')
      );
    }
  );
  const QueryBareFeature = node(
    'QueryBareFeature',
    sequence(
      literal('('),
      g.Property,
      literal(')')
    ),
    children => block(keyword(tokenText(children[1]!)))
  );
  const QueryColonFeature = node(
    'QueryColonFeature',
    sequence(
      literal('('),
      g.Property,
      literal(':'),
      g.QueryValue,
      literal(')')
    ),
    children => block(operation(
      ':',
      keyword(tokenText(children[1]!)),
      firstValue(children),
      false,
      cssBaseMathOutsideParens(':')
    ))
  );
  const QueryComparisonFeature = node(
    'QueryComparisonFeature',
    sequence(
      literal('('),
      g.Property,
      g.QueryComparisonOperator,
      g.QueryValue,
      optional(sequence(
        g.QueryComparisonOperator,
        g.QueryValue
      )),
      literal(')')
    ),
    children => block(chainedQueryComparison(
      keyword(tokenText(children[1]!)),
      children
    ))
  );

  /*
   * Media/container ranges can put the feature name between two values:
   * `(100em < width < 200em)`. Keep both comparisons as typed Operations;
   * the outer operation preserves their authored order without raw-prelude
   * fallback or a secondary query parser.
   */
  const QueryRangeFeature = node(
    'QueryRangeFeature',
    sequence(
      literal('('),
      g.QueryValue,
      g.QueryComparisonOperator,
      g.Property,
      optional(sequence(
        g.QueryComparisonOperator,
        g.QueryValue
      )),
      literal(')')
    ),
    (children) => {
      const values = valueChildren(children);
      const property = keyword(tokenText(children[3]!));
      if (values.length === 0) {
        throw new Error('CSS AST query range requires its leading value');
      }
      const operators = queryComparisonOperators(children);
      if (operators.length === 0) {
        throw new Error('CSS AST query range requires a comparison operator');
      }
      let result = operation(
        operators[0]!,
        values[0]!,
        property,
        false,
        cssBaseMathOutsideParens(operators[0]!)
      );
      if (operators.length > 1) {
        const right = values[1];
        if (right === undefined) {
          throw new Error('CSS AST query range lost its trailing value');
        }
        result = operation(
          operators[1]!,
          result,
          right,
          false,
          cssBaseMathOutsideParens(operators[1]!)
        );
      }
      return block(result);
    }
  );
  const QueryFeature = node(
    'QueryFeature',
    choice(
      g.QueryBareFeature,
      QueryColonFeature,
      QueryComparisonFeature,
      g.QueryRangeFeature
    ),
    { project: 0 }
  );
  const mediaTypeKeywordReserved = keywords(
    ['only', 'layer'],
    { caseInsensitive: true, boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF' }
  );
  const containerNameReserved = keywords(
    ['none'],
    { caseInsensitive: true, boundary: '-_a-zA-Z0-9\\u0080-\\uFFFF' }
  );
  const QueryNonOnlyKeyword = node(
    'QueryNonOnlyKeyword',
    sequence(
      not(mediaTypeKeywordReserved),
      g.Keyword
    ),
    (children) => {
      const value = children.find(isKeyword);
      if (value === undefined) {
        throw new Error('CSS AST query keyword requires a keyword fact');
      }
      return value;
    }
  );
  const queryFunctionOpen = token(noTrivia(sequence(
    genericIdentifier,
    literal('(')
  )));
  const queryIdentOrFunction = token(noTrivia(sequence(
    not(sequence(
      mediaTypeKeywordReserved,
      not(literal('('))
    )),
    genericIdentifier,
    optional(literal('('))
  )));

  /*
   * A generic query function keeps its component payload opaque, but both the
   * direct `QueryFunction` entry and the identifier/function dispatch consume
   * the same CSS-owned tail. Only the opener differs: `routed()` preserves the
   * token already consumed by the dispatch route.
   */
  const queryFunctionTail = sequence(
    scanTo(
      literal(')'),
      { skip: [balancedParens] }
    ),
    expect(
      literal(')'),
      ')'
    )
  );
  const RoutedQueryFunction = node(
    'QueryFunction',
    sequence(
      routed(),
      queryFunctionTail
    ),
    children => funcCall(
      functionOpenName(children[0]!),
      [any(children.length > 2 ? tokenText(children[1]!) : '')]
    )
  );
  const RoutedQueryNonOnlyKeyword = node(
    'QueryNonOnlyKeyword',
    routed(),
    children => keyword(tokenText(children[0]))
  );
  const queryIdentOrFunctionTerm = dispatch(
    queryIdentOrFunction,
    when(
      endsWith('('),
      RoutedQueryFunction
    ),
    otherwise(RoutedQueryNonOnlyKeyword)
  );
  const QueryTerm = node(
    'QueryTerm',
    choice(
      g.QueryFeature,
      queryIdentOrFunctionTerm
    ),
    { project: 0 }
  );
  const QueryOnlyClause = node(
    'QueryOnlyClause',
    sequence(
      g.QueryOnly,
      QueryNonOnlyKeyword,
      many(sequence(
        g.QueryAndOr,
        g.QueryTerm
      ))
    ),
    children => spaced(children.map(child => isValue(child) ? child : keyword(tokenText(child))))
  );

  /*
   * A clause is one `<media-query>`: whitespace-joined terms only. The comma
   * belongs to the enclosing `<media-query-list>` (mediaqueries-4 §2.1), so it
   * must not be an optional separator here — swallowing it collapsed
   * `screen, print` into a Sequence instead of the List the other three
   * dialects produce.
   */
  const QueryClause = node(
    'QueryClause',
    choice(
      QueryOnlyClause,
      sequence(
        g.QueryTerm,
        many(g.QueryTerm)
      )
    ),
    (children) => {
      const values = valueChildren(children);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const QueryPrelude = node(
    'QueryPrelude',
    oneOrMoreSep(
      g.QueryClause,
      literal(',')
    ),
    (children) => {
      const values = valueChildren(children);
      return values.length === 1
        ? values[0]!
        : list(
            values,
            ','
          );
    }
  );
  const containerName = sequence(
    not(g.QueryFunctionOpen),
    not(containerNameReserved),
    g.Keyword
  );
  const ContainerQueryClause = node(
    'ContainerQueryClause',
    sequence(
      choice(
        g.QueryFeature,
        g.QueryFunction
      ),
      many(g.QueryTerm)
    ),
    (children) => {
      const values = valueChildren(children);
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );
  const ContainerQueryPrelude = node(
    'ContainerQueryPrelude',
    oneOrMoreSep(
      g.ContainerQueryClause,
      literal(',')
    ),
    (children) => {
      const values = valueChildren(children);
      return values.length === 1
        ? values[0]!
        : list(
            values,
            ','
          );
    }
  );
  const ContainerPrelude = node(
    'ContainerPrelude',
    choice(
      sequence(
        containerName,
        optional(g.ContainerQueryPrelude)
      ),
      g.ContainerQueryPrelude
    ),
    (children) => {
      const values = flattenSequences(valueChildren(children));
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );

  /*
   * A supports condition is deliberately distinct from the media/container
   * query prelude above. In particular it has no bare-keyword form: `@supports
   * color {}` must fail rather than being lowered to an opaque Any prelude.
   * General-enclosed carries its own raw-template content model: the payload is
   * one `Interpolation`, so the `FunctionCall` / `Block` it builds is never read
   * as structured call arguments or a parenthesized value expression.
   */
  const EnclosedRaw = node(
    'EnclosedRaw',
    noTrivia(choice(
      blockComment,
      enclosedText
    )),
    children => tokenText(children[0]!)
  );
  const EnclosedQuoted = node(
    'EnclosedQuoted',
    choice(
      noTrivia(sequence(
        literal('"'),
        customDoubleQuotedText,
        literal('"')
      )),
      noTrivia(sequence(
        literal('\''),
        customSingleQuotedText,
        literal('\'')
      ))
    ),
    children => children.map(tokenText).join('')
  );
  const EnclosedGroup = node(
    'EnclosedGroup',
    choice(
      noTrivia(sequence(
        literal('('),
        g.EnclosedContent,
        literal(')')
      )),
      noTrivia(sequence(
        literal('['),
        g.EnclosedContent,
        literal(']')
      )),
      noTrivia(sequence(
        literal('{'),
        g.EnclosedContent,
        literal('}')
      ))
    ),
    children => children.map(child => isInterpolation(child)
      ? child.parts.map(part => 'lit' in part ? part.lit : '').join('')
      : tokenText(child)).join('')
  );
  const EnclosedContent = node(
    'EnclosedContent',
    noTrivia(many(choice(
      EnclosedRaw,
      g.EnclosedQuoted,
      g.EnclosedGroup
    ))),
    children => interpolation([{ lit: children.map(tokenText).join('') }])
  );
  const Enclosed = node(
    'Enclosed',
    choice(
      noTrivia(sequence(
        g.QueryFunctionOpen,
        g.EnclosedContent,
        literal(')')
      )),
      noTrivia(sequence(
        literal('('),
        g.EnclosedContent,
        literal(')')
      ))
    ),
    (children) => {
      const content = children.find((child): child is Interpolation => isNodeType(
        child,
        'Interpolation'
      ));
      if (content === undefined) {
        throw new TypeError('CSS general-enclosed lost its grammar-owned content.');
      }
      const head = children[0];
      return isTerminalText(head) && tokenText(head) !== '('
        ? funcCall(
            tokenText(head),
            [content]
          )
        : block(content);
    }
  );
  const QueryFunction = node(
    'QueryFunction',
    sequence(
      queryFunctionOpen,
      queryFunctionTail
    ),
    children => funcCall(
      functionOpenName(children[0]!),
      [any(children.length > 2 ? tokenText(children[1]!) : '')]
    )
  );
  const SupportsInParens = node(
    'SupportsInParens',
    choice(
      sequence(
        literal('('),
        g.SupportsCondition,
        literal(')')
      ),
      g.QueryFeature,
      g.Enclosed
    ),
    (children) => {
      const value = firstValue(children);
      return isValue(children[0]) ? value : block(value);
    }
  );
  const SupportsCondition = node(
    'SupportsCondition',
    choice(
      sequence(
        g.QueryNot,
        g.SupportsInParens
      ),
      sequence(
        g.SupportsInParens,
        many(sequence(
          g.QueryAndOr,
          g.SupportsInParens
        ))
      )
    ),
    (children) => {
      const values: ValueNode[] = [];
      for (const child of children) {
        if (isValue(child)) {
          values.push(child);
        } else {
          const text = tokenText(child);
          const normalized = text.toLowerCase();
          if (normalized === 'not' || normalized === 'and' || normalized === 'or') {
            values.push(keyword(text));
          }
        }
      }
      return values.length === 1 ? values[0]! : spaced(values);
    }
  );

  /*
   * The existing public grammar currently admits a comma-separated condition
   * list for all conditional groups, including @supports. Keep the direct path
   * parity-compatible until that public grammar is intentionally tightened.
   */
  const SupportsPrelude = node(
    'SupportsPrelude',
    oneOrMoreSep(
      g.SupportsCondition,
      literal(',')
    ),
    (children) => {
      const values = valueChildren(children);
      return values.length === 1
        ? values[0]!
        : list(
            values,
            ','
          );
    }
  );
  const declarationListDeclaration = sequence(
    g.Declaration,
    choice(
      literal(';'),
      peek(literal('}'))
    )
  );
  const declarationListItem = choice(g.declarationListDeclaration, g.NestedConditionalBlock, g.DeclarationListAtRule, g.Ruleset, literal(';'));
  const descriptorBodyItem = choice(g.declarationListDeclaration, literal(';'));
  const conditionalGroupBodyItem = choice(g.ConditionalBlock, g.ConditionalGroupAtRule, g.TopLevelRuleset);
  const stylesheetBodyItem = choice(g.ConditionalBlock, g.StylesheetAtRule, g.TopLevelRuleset);
  const descriptorBodyBlock = sequence(literal('{'), many(descriptorBodyItem), literal('}'));
  const declarationListBlock = sequence(literal('{'), many(g.declarationListItem), literal('}'));
  const conditionalGroupBodyBlock = sequence(literal('{'), many(conditionalGroupBodyItem), literal('}'));
  const stylesheetBodyBlock = sequence(literal('{'), many(g.stylesheetBodyItem), literal('}'));
  const pageBodyItem = choice(g.declarationListDeclaration, g.MarginAtRule, literal(';'));
  const pageBodyBlock = sequence(literal('{'), many(pageBodyItem), literal('}'));
  const keyframesBodyBlock = sequence(literal('{'), many(g.KeyframeBlock), literal('}'));
  const fontFeatureValuesBodyBlock = sequence(literal('{'), many(g.FeatureValueBlock), literal('}'));

  /*
   * Routed at-rule bodies: the routed keyword, its prelude, and a body block.
   * The nested (declaration-list) and top-level (stylesheet) body shapes are each
   * spelled once here and referenced by every routed block node that carries them,
   * so the shape cannot drift between the at-rules that share it. Each `node()`
   * keeps its own name and reducer; only the recognition shape is shared.
   */
  const routedDeclarationListBody = sequence(routed(), g.AtRulePrelude, g.declarationListBlock);
  const routedStylesheetBody = sequence(routed(), g.AtRulePrelude, g.stylesheetBodyBlock);
  const LayerBlock = node(
    'LayerBlock',
    g.routedStylesheetBody,
    (children, _fields, span, rawChildren) => withSourceSpan(withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      optionalValue(children[1]),
      blockStatements(children)
    ), rawChildren), span)
  );
  const NestedLayerBlock = node(
    'NestedLayerBlock',
    g.routedDeclarationListBody,
    (children, _fields, span, rawChildren) => withSourceSpan(withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      optionalValue(children[1]),
      rulesetStatements(children)
    ), rawChildren), span)
  );
  const DescriptorBlock = node(
    'DescriptorBlock',
    sequence(
      routed(),
      g.AtRulePrelude,
      g.descriptorBodyBlock
    ),
    (children, _fields, span, rawChildren) => withSourceSpan(withBlockBody(atRuleBlock(
      tokenText(children[0]),
      children.find(isValue) ?? null,
      children.filter(isDeclaration)
    ), rawChildren), span)
  );
  const PageBlock = node(
    'PageBlock',
    sequence(
      routed(),
      g.AtRulePrelude,
      pageBodyBlock
    ),
    (children, _fields, span, rawChildren) => withSourceSpan(withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      children.find(isValue) ?? null,
      children.filter((value): value is Declaration | AtRuleBlock => isDeclaration(value) || isAtRuleBlock(value))
    ), rawChildren), span)
  );
  const Keyframes = node(
    'Keyframes',
    sequence(
      routed(),
      g.AtRulePrelude,
      keyframesBodyBlock
    ),
    (children, _fields, span, rawChildren) => withSourceSpan(withBlockBody(atRuleBlock(
      tokenText(children[0]),
      optionalValue(children[1]),
      blockStatements(children)
    ), rawChildren), span)
  );
  const FontFeatureValuesBlock = node(
    'FontFeatureValuesBlock',
    sequence(
      routed(),
      g.AtRulePrelude,
      fontFeatureValuesBodyBlock
    ),
    (children, _fields, span, rawChildren) => withSourceSpan(withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      children.find(isValue) ?? null,
      children.filter(isAtRuleBlock)
    ), rawChildren), span)
  );

  /*
   * `@scope` has the public declaration-list body model, so a nested scope
   * retains the canonical AtRuleBlock reduction rather than being rejected or
   * routed through an opaque body.
   */
  const ScopeBlock = node(
    'ScopeBlock',
    g.routedDeclarationListBody,
    (children, _fields, span, rawChildren) => withSourceSpan(withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      optionalValue(children[1]),
      rulesetStatements(children)
    ), rawChildren), span)
  );
  const StartingStyleBlock = node(
    'StartingStyleBlock',
    g.routedStylesheetBody,
    (children, _fields, span, rawChildren) => withSourceSpan(withBlockBody(atRuleBlock(
      tokenText(children[0]),
      optionalValue(children[1]),
      blockStatements(children)
    ), rawChildren), span)
  );
  const NestedStartingStyleBlock = node(
    'NestedStartingStyleBlock',
    g.routedDeclarationListBody,
    (children, _fields, span, rawChildren) => withSourceSpan(withBlockBody(atRuleBlock(
      tokenText(children[0]),
      optionalValue(children[1]),
      rulesetStatements(children)
    ), rawChildren), span)
  );
  const DocumentBlock = node(
    'DocumentBlock',
    g.routedStylesheetBody,
    (children, _fields, span, rawChildren) => withSourceSpan(withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      children.find(isValue) ?? null,
      blockStatements(children)
    ), rawChildren), span)
  );
  const keyframesAtRuleNames = [
    '@keyframes',
    '@-webkit-keyframes',
    '@-moz-keyframes',
    '@-o-keyframes',
    '@-ms-keyframes'
  ];

  /*
   * At-rules whose recognition is identical whether they appear at the top level
   * of a stylesheet or inside a declaration list. Only `@layer` and
   * `@starting-style` differ between the two positions (nested variants carry a
   * declaration-list body); every other at-rule below is position-independent, so
   * its case arm is spelled once here and referenced by both dispatches. Each
   * dispatch keeps its own name and its own position-specific arms.
   */
  const scopeAtRuleCase = cssCase(
    '@scope',
    choice(
      g.RoutedAtRuleStatement,
      g.ScopeBlock
    )
  );
  const descriptorAtRuleCase = cssCase(
    [
      '@font-face',
      '@counter-style',
      '@property',
      '@color-profile',
      '@font-palette-values',
      '@position-try',
      '@view-transition'
    ],
    choice(
      g.RoutedAtRuleStatement,
      g.DescriptorBlock
    )
  );
  const pageAtRuleCase = cssCase(
    '@page',
    choice(
      g.RoutedAtRuleStatement,
      g.PageBlock
    )
  );
  const keyframesAtRuleCase = cssCase(
    keyframesAtRuleNames,
    choice(
      g.RoutedAtRuleStatement,
      g.Keyframes
    )
  );
  const fontFeatureValuesAtRuleCase = cssCase(
    '@font-feature-values',
    choice(
      g.RoutedAtRuleStatement,
      g.FontFeatureValuesBlock
    )
  );
  const documentAtRuleCase = cssCase(
    ['@document', '@-moz-document'],
    choice(
      g.RoutedAtRuleStatement,
      g.DocumentBlock
    )
  );
  const opaqueAtRuleOtherwise = otherwise(choice(
    g.RoutedAtRuleStatement,
    g.OpaqueAtRuleBlock
  ));
  const StylesheetAtRule = dispatch(
    g.AtRuleKeyword,
    cssCase(
      '@layer',
      choice(
        g.RoutedAtRuleStatement,
        g.LayerBlock
      )
    ),
    cssCase(
      '@starting-style',
      choice(
        g.RoutedAtRuleStatement,
        g.StartingStyleBlock
      )
    ),
    scopeAtRuleCase,
    descriptorAtRuleCase,
    pageAtRuleCase,
    keyframesAtRuleCase,
    fontFeatureValuesAtRuleCase,
    documentAtRuleCase,
    opaqueAtRuleOtherwise
  );
  const DeclarationListAtRule = dispatch(
    g.AtRuleKeyword,
    cssCase(
      '@layer',
      choice(
        g.RoutedAtRuleStatement,
        g.NestedLayerBlock
      )
    ),
    cssCase(
      '@starting-style',
      choice(
        g.RoutedAtRuleStatement,
        g.NestedStartingStyleBlock
      )
    ),
    scopeAtRuleCase,
    descriptorAtRuleCase,
    pageAtRuleCase,
    keyframesAtRuleCase,
    fontFeatureValuesAtRuleCase,
    documentAtRuleCase,
    opaqueAtRuleOtherwise
  );
  const ConditionalGroupAtRule = dispatch(
    g.AtRuleKeyword,
    cssCase(
      '@layer',
      g.LayerBlock
    ),
    cssCase(
      '@starting-style',
      g.StartingStyleBlock
    ),
    cssCase(
      '@scope',
      g.ScopeBlock
    ),
    cssCase(
      [
        '@font-face',
        '@counter-style',
        '@property',
        '@color-profile',
        '@font-palette-values',
        '@position-try',
        '@view-transition'
      ],
      g.DescriptorBlock
    ),
    cssCase(
      '@page',
      g.PageBlock
    ),
    cssCase(
      keyframesAtRuleNames,
      g.Keyframes
    ),
    cssCase(
      '@font-feature-values',
      g.FontFeatureValuesBlock
    ),
    cssCase(
      ['@document', '@-moz-document'],
      g.DocumentBlock
    ),
    otherwise(g.OpaqueAtRuleBlock)
  );

  /*
   * `@page` accepts only declarations, empty statements, and its sixteen
   * margin-box at-rules. Each margin box is declarations-only as well. The
   * generic grammar-owned header capture retains a page selector until that
   * selector syntax receives a dedicated AST node family.
   */
  const MarginAtRule = node(
    'MarginAtRule',
    sequence(
      g.MarginAtKeyword,
      g.descriptorBodyBlock
    ),
    (children, _fields, span, rawChildren) => withSourceSpan(withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      null,
      children.filter(isDeclaration)
    ), rawChildren), span)
  );
  const keyframeSelector = node(
    'SimpleSelector',
    choice(
      keyframeEndpoint,
      g.Percentage
    ),
    children => simpleSelector(sourceText(children[0]))
  );
  const KeyframeBlock = node(
    'KeyframeBlock',
    sequence(
      oneOrMoreSep(
        g.keyframeSelector,
        literal(',')
      ),

      /*
       * This is the public descriptorBody shape: empty declaration statements
       * are syntactically valid and deliberately have no AST statement node.
       */
      g.descriptorBodyBlock
    ),
    (children, _fields, span, rawChildren) => withSourceSpan(withBlockBody(rule(
      keyframeSelectorList(children),
      children.filter(isDeclaration)
    ), rawChildren), span)
  );
  const Ruleset = node(
    'Ruleset',
    sequence(
      parser(
        { trivia: interstitialTrivia },
        NestedSelectorList
      ),

      parser(
        { trivia: interstitialTrivia },
        literal('{')
      ),
      many(g.declarationListItem),
      expect(literal('}'), '}')
    ),
    (children, _fields, _span, rawChildren) => {
      const selector = children.find(isSelectorList)!;
      return withBlockBody(rule(
        selector,
        rulesetStatements(children)
      ), rawChildren);
    }
  );
  const TopLevelRuleset = node(
    'TopLevelRuleset',
    sequence(
      parser(
        { trivia: interstitialTrivia },
        g.TopLevelSelectorList
      ),
      parser(
        { trivia: interstitialTrivia },
        literal('{')
      ),
      many(g.declarationListItem),
      expect(literal('}'), '}')
    ),
    (children, _fields, _span, rawChildren) => {
      const selector = children.find(isSelectorList)!;
      return withBlockBody(rule(
        selector,
        rulesetStatements(children)
      ), rawChildren);
    }
  );
  const ConditionalBlock = node(
    'ConditionalBlock',
    choice(
      sequence(
        g.SupportsAtKeyword,
        parser(
          { trivia: interstitialTrivia },
          g.SupportsPrelude
        ),
        conditionalGroupBodyBlock
      ),
      sequence(
        g.MediaAtKeyword,
        g.QueryPrelude,
        conditionalGroupBodyBlock
      ),
      sequence(
        g.ContainerAtKeyword,
        g.ContainerPrelude,
        conditionalGroupBodyBlock
      )
    ),
    (children, _fields, span, rawChildren) => {
      return withSourceSpan(withBlockBody(atRuleBlock(
        tokenText(children[0]!),
        children.find(isValue)!,
        blockStatements(children)
      ), rawChildren), span);
    }
  );
  const NestedConditionalBlock = node(
    'NestedConditionalBlock',
    choice(
      sequence(
        g.SupportsAtKeyword,
        parser(
          { trivia: interstitialTrivia },
          g.SupportsPrelude
        ),
        g.declarationListBlock
      ),
      sequence(
        g.MediaAtKeyword,
        g.QueryPrelude,
        g.declarationListBlock
      ),
      sequence(
        g.ContainerAtKeyword,
        g.ContainerPrelude,
        g.declarationListBlock
      )
    ),
    (children, _fields, span, rawChildren) => {
      return withSourceSpan(withBlockBody(atRuleBlock(
        tokenText(children[0]!),
        children.find(isValue)!,
        rulesetStatements(children)
      ), rawChildren), span);
    }
  );

  /*
   * `@font-feature-values` admits exactly seven named feature blocks, each
   * containing declarations only. Preserve that public grammar shape rather
   * than lowering either level to an ordinary CSS ruleset.
   */
  const FeatureValueBlock = node(
    'FeatureValueBlock',
    sequence(
      g.FontFeatureValueAtKeyword,
      g.descriptorBodyBlock
    ),
    (children, _fields, span, rawChildren) => withSourceSpan(withBlockBody(atRuleBlock(
      tokenText(children[0]!),
      null,
      children.filter(isDeclaration)
    ), rawChildren), span)
  );
  const Stylesheet = node(
    'Stylesheet',
    sequence(
      optional(g.CharsetStatement),
      many(choice(g.ImportStatement, g.LayerStatement)),
      many(g.stylesheetBodyItem)
    ),
    children => stylesheet(documentStatements(children)),
    { trailingTrivia: true }
  );
  return {
    Stylesheet,
    SelectorList,
    TopLevelSelectorList,
    ComplexSelector,
    CompoundSelector,
    simpleSelectorAtom,
    BasicSelector,
    NamespaceTypeSelector,
    AttributeSelector,
    PseudoSelector,
    PseudoArgument,
    OfTypePseudoArgument,
    LeadingDashPseudoArgument,
    TypedNthPseudoArgument,
    LeadingDashOfTypePseudoArgument,
    TypedOfTypePseudoArgument,
    LeadingDashRawPseudoArgument,
    NestingSelector,
    Property,
    CustomProperty,
    CustomValue,
    Keyword,
    RoutedKeyword,
    Color,
    UnicodeRange,
    Percentage,
    Dimension,
    Quoted,
    Url,
    Call,
    CalcCall,
    VarFallbackPunctuation,
    VarFallbackParen,
    VarFallbackBracket,
    VarFallbackBrace,
    VarFallbackCall,
    VarFallbackTerm,
    VarFallbackEmpty,
    VarFallbackItem,
    VarFallback,
    VarCall,
    CalcIdentOrFunction,
    CalcParen,
    ParenValue,
    SquareValue,
    RawParenValue,
    PunctuationValue,
    ValueSequence,
    ValueList,
    calcValueAtom,
    CalcValue,
    CalcProduct,
    CalcSum,
    CalcSequence,
    calcFunctionArguments,
    MathFunction,
    valueAtom,
    Value,
    TypedValue,
    TypedValueSequence,
    TypedValueList,
    Important,
    Declaration,
    ImportStatement,
    ImportUrl,
    ImportUrlUnquoted,
    ImportTailRaw,
    ImportTailBody,
    ImportTail,
    AtRuleStatement,
    AtRulePreludeWhitespace,
    AtRulePreludeComma,
    AtRulePreludeGroup,
    AtRulePreludeQuoted,
    AtRulePreludeText,
    AtRulePreludeSegments,
    CharsetStatement,
    LayerStatement,
    AtRulePrelude,
    StatementPrelude,
    OpaqueAtRuleBlock,
    LayerBlock,
    NestedLayerBlock,
    DescriptorBlock,
    PageBlock,
    Keyframes,
    FontFeatureValuesBlock,
    ScopeBlock,
    StartingStyleBlock,
    NestedStartingStyleBlock,
    DocumentBlock,
    StylesheetAtRule,
    DeclarationListAtRule,
    ConditionalGroupAtRule,
    QueryBareFeature,
    QueryRangeFeature,
    QueryFeature,
    QueryClause,
    QueryPrelude,
    ContainerQueryClause,
    ContainerQueryPrelude,
    ContainerPrelude,
    QueryFunction,
    Enclosed,
    EnclosedContent,
    EnclosedGroup,
    EnclosedQuoted,
    SupportsInParens,
    SupportsCondition,
    SupportsPrelude,
    ConditionalBlock,
    NestedConditionalBlock,
    FeatureValueBlock,
    MarginAtRule,
    keyframeSelector,
    KeyframeBlock,
    Ruleset,
    TopLevelRuleset,
    stylesheetBodyBlock,
    declarationListBlock,
    descriptorBodyBlock,
    declarationListItem,
    declarationListDeclaration,
    RoutedAtRuleStatement,
    pseudoArgumentContent,
    CustomPropertyValue,
    QueryValue,
    QueryTerm,
    stylesheetBodyItem,
    routedStylesheetBody,
    routedDeclarationListBody,
    valueFunctionArguments,
    whitespace,
    rw: whitespace
  };
};

export const cssGrammar = composeLeaf([cssSyntax, cssPseudoSyntax, rules(
  { trivia: whitespace, scanSkip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] },
  cssFactory
)]);

/** AST artifact with Parseman line/column tracking enabled. */
export const cssPositionsGrammar = composeLeaf([cssSyntax, cssPseudoSyntax, rules(
  { trivia: whitespace, scanSkip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted], trackLines: true },
  cssFactory
)]);

export const cssCstGrammar = composeLeaf([cssSyntax, cssPseudoSyntax, rules(
  { trivia: whitespace, scanSkip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted], hostMode: 'cst' },
  cssFactory
)]);

/** CST artifact with Parseman line/column tracking enabled. */
export const cssCstPositionsGrammar = composeLeaf([cssSyntax, cssPseudoSyntax, rules(
  { trivia: whitespace, scanSkip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted], hostMode: 'cst', trackLines: true },
  cssFactory
)]);

/**
 * CSS's WHOLE grammar as one hole-free composable base, for a dialect to
 * `compose([cssBaseRules, rules(dialectDelta)])` onto and override by name.
 * The recognition pieces (`cssSyntax`, pseudo) travel with it so
 * a dialect delta need only add its own scan-skips. Every reducer this base
 * carries references only importable bindings (canonical AST constructors and
 * the hoisted `@jesscss/core/ast` grammar helpers), so the lifted compose
 * analyzer can carry its `buildImports` provenance and the base macro-fuses.
 */
export const cssBaseRules = compose([cssSyntax, cssPseudoSyntax, rules(
  { trivia: whitespace, scanSkip: [blockComment, customEscape, customDoubleQuoted, customSingleQuoted] },
  cssFactory
)], { hostMode: 'ast' });
