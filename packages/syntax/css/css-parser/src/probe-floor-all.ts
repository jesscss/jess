/**
 * Byte-attribution probe (Candidate B tournament scaffolding — not shipped).
 *
 * Every `cssSyntax` leaf referenced exactly once. The delta against
 * `probe-floor-with` is the shared leaves' real artifact cost, separating
 * "composed but tree-shaken" from "composed and emitted".
 */
import { choice, classifiedTrivia, composeLeaf, node, regex, rules } from 'parseman' with { type: 'macro' };
import type { Combinator } from 'parseman';
import { cssSyntax } from '@jesscss/parser-shared/recognition';
import { opaqueAtRuleRecognition } from '@jesscss/parser-shared/opaque-at-rule';
import { cssPseudoSyntax } from '@jesscss/parser-shared/pseudo-consts';

const blockComment = regex(/\/\*(?:[^*]|\*(?!\/))*\*\//);
const whitespaceRun = regex(/[ \t\n\r\f]+/);
const whitespace = classifiedTrivia({ whitespace: whitespaceRun, blockComment });

type LeafName =
  | 'Identifier' | 'AttributeOperator' | 'AttributeModifier' | 'DoubleQuotedText'
  | 'SingleQuotedText' | 'UrlOpen' | 'UrlInner' | 'SimpleSelectorToken'
  | 'PseudoSelectorColon' | 'NthExpression' | 'MalformedPseudoSelectorNumericArgument'
  | 'BlockCommentToken' | 'LineComment' | 'MediaModifier' | 'ImportantToken'
  | 'HexColor' | 'UnicodeRangeToken' | 'ConditionalAtKeyword' | 'MediaContainerAtKeyword'
  | 'MediaAtKeyword' | 'ContainerAtKeyword' | 'SupportsAtKeyword' | 'StartingStyleAtKeyword'
  | 'PageAtKeyword' | 'MarginAtKeyword' | 'QueryNot' | 'QueryOnly' | 'QueryAndOr'
  | 'QueryComparisonOperator' | 'QueryFunctionName' | 'QueryFunctionOpen'
  | 'ScopeAtKeyword' | 'DescriptorAtKeyword' | 'DocumentAtKeyword' | 'LayerAtKeyword'
  | 'KeyframesAtKeyword' | 'StatementAtRuleName' | 'GenericAtRuleName' | 'AtRuleKeyword'
  | 'FontFeatureValuesAtKeyword' | 'FontFeatureValueAtKeyword' | 'NumberToken'
  | 'DimensionUnit' | 'InterpolatedPropertyStart' | 'InterpolatedPropertyTail'
  | 'CustomPropertyName' | 'CustomPropertyToken' | 'CustomOuterContent'
  | 'CustomInnerContent' | 'CustomSingleQuoted' | 'CustomDoubleQuoted';

type ProbeSelf = { readonly [K in LeafName | 'Stylesheet']: Combinator<unknown> };

const probeFactory = (g: ProbeSelf) => {
  const Stylesheet = node(
    'Stylesheet',
    choice(
      g.Identifier, g.AttributeOperator, g.AttributeModifier, g.DoubleQuotedText,
      g.SingleQuotedText, g.UrlOpen, g.UrlInner, g.SimpleSelectorToken,
      g.PseudoSelectorColon, g.NthExpression, g.MalformedPseudoSelectorNumericArgument,
      g.BlockCommentToken, g.LineComment, g.MediaModifier, g.ImportantToken,
      g.HexColor, g.UnicodeRangeToken, g.ConditionalAtKeyword, g.MediaContainerAtKeyword,
      g.MediaAtKeyword, g.ContainerAtKeyword, g.SupportsAtKeyword, g.StartingStyleAtKeyword,
      g.PageAtKeyword, g.MarginAtKeyword, g.QueryNot, g.QueryOnly, g.QueryAndOr,
      g.QueryComparisonOperator, g.QueryFunctionName, g.QueryFunctionOpen,
      g.ScopeAtKeyword, g.DescriptorAtKeyword, g.DocumentAtKeyword, g.LayerAtKeyword,
      g.KeyframesAtKeyword, g.StatementAtRuleName, g.GenericAtRuleName, g.AtRuleKeyword,
      g.FontFeatureValuesAtKeyword, g.FontFeatureValueAtKeyword, g.NumberToken,
      g.DimensionUnit, g.InterpolatedPropertyStart, g.InterpolatedPropertyTail,
      g.CustomPropertyName, g.CustomPropertyToken, g.CustomOuterContent,
      g.CustomInnerContent, g.CustomSingleQuoted, g.CustomDoubleQuoted
    ),
    () => null
  );
  return { Stylesheet };
};

export const allLeaves = composeLeaf([cssSyntax, opaqueAtRuleRecognition, cssPseudoSyntax, rules(
  { trivia: whitespace },
  probeFactory
)]);
