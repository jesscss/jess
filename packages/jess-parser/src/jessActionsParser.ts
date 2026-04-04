import type { TokenVocabulary, TokenType } from 'chevrotain';
import {
  CssActionsParser,
  type CssParserConfig,
  productions as cssProductions,
  type CssTokenType,
  type TokenMap as CssTokenMap,
  type Rule,
  type RuleContext
} from '@jesscss/css-parser';

import type { IToken } from 'chevrotain';
import { Color, ColorFormat, Any } from '@jesscss/core';
import colors from 'color-name';

import type { JessTokenType, JessExtraTokenType } from './jessTokens.js';
import * as productions from './productions.js';

/**
 * Jess parser config extends CssParserConfig.
 */
export type JessParserConfig = CssParserConfig & {
  // reserved for future jess-specific config
};

export type CombinedTokenMap =
  & Record<CssTokenType, TokenType>
  & Record<JessExtraTokenType, TokenType>;

export type TokenMap = CombinedTokenMap & Record<JessTokenType, TokenType>;

/**
 * Jess actions parser. Starts from the CSS parser and selectively overrides or
 * extends productions. This matches the approach used by `ScssActionsParser` and `LessActionsParser`.
 */
export class JessActionsParser extends CssActionsParser {
  declare T: TokenMap;
  warnings: Array<{ message: string; token?: IToken; deprecation?: string }> = [];

  // Jess-specific rules (added via productions registration)
  jessVariableDeclaration!: Rule;
  jessMixinDefinition!: Rule;
  jessDollarExpression!: Rule;
  jessDollarAccessor!: Rule;
  jessMixinCallExpression!: Rule;
  jessConditional!: Rule;
  jessComposeAtRule!: Rule;
  jessFromAtRule!: Rule;
  jessExportAtRule!: Rule;
  jessInterpolation!: Rule;
  jessWhile!: Rule;
  jessFor!: Rule;

  // Guard productions from Less (for when() guards)
  guard!: Rule;
  guardOr!: Rule;
  guardAnd!: Rule;
  guardInParens!: Rule;
  guardInner!: Rule;
  guardDefault!: Rule;
  guardWithCondition!: Rule;
  guardWithConditionValue!: Rule;
  comparison!: Rule;

  constructor(
    tokenVocabulary: TokenVocabulary,
    T: TokenMap,
    config: JessParserConfig = {}
  ) {
    super(tokenVocabulary, T, config);

    // Jess extensions (overrides and additional rules).
    type ProductionFactory = (this: JessActionsParser, T: TokenMap) => Rule;
    const entries = Object.entries(productions as Record<string, ProductionFactory>);
    // Two-pass registration:
    // 1) Register new Jess-only rules first (so overrides can reference them reliably).
    // 2) Then register overrides of CSS productions.
    for (const [key, value] of entries) {
      if (key in cssProductions) continue;
      const rule = value.call(this, T);
      this.RULE(key, rule);
    }
    for (const [key, value] of entries) {
      if (!(key in cssProductions)) continue;
      const rule = value.call(this, T);
      this.OVERRIDE_RULE(key, rule);
    }

    if (this.constructor === JessActionsParser) {
      this.performSelfAnalysis();
    }
  }

  /**
   * Override processValueToken to handle PlainIdent tokens and convert color keywords to Color nodes
   */
  override processValueToken(token: IToken): Node {
    const tokValue = token.image;
    const tokType = token.tokenType;
    const T = this.T;

    // Check if it's a PlainIdent (Jess-specific token)
    if (tokType === T.PlainIdent) {
      // Check if it's a color keyword
      const colorKey = tokValue.toLowerCase();
      if (colors[colorKey as keyof typeof colors]) {
        // Create a Color node with the keyword data
        const colorValue = colors[colorKey as keyof typeof colors];
        return new Color(
          {
            node: tokValue, // Store the original keyword string
            rgb: colorValue,
            alpha: 1
          },
          { format: ColorFormat.HEX },
          this.getLocationInfo(token),
          this.context
        );
      } else {
        // Not a color keyword, create a generic Any node
        return new Any(tokValue, undefined, this.getLocationInfo(token), this.context);
      }
    }

    // Fall back to base implementation for other token types
    return super.processValueToken(token);
  }
}
