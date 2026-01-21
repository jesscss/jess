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
import { Reference } from '@jesscss/core';

import type { ScssTokenType, ScssExtraTokenType } from './scssTokens.js';
import * as productions from './productions.js';

/**
 * SCSS parser config is currently identical to CssParserConfig.
 * We keep this alias so SCSS-specific toggles can be added later
 * without breaking API.
 */
export type ScssParserConfig = CssParserConfig & {
  // reserved for future scss-specific config
};

export type CombinedTokenMap =
  & Record<CssTokenType, TokenType>
  & Record<ScssExtraTokenType, TokenType>;

export type TokenMap = CombinedTokenMap & Record<ScssTokenType, TokenType>;

/**
 * SCSS actions parser. Starts from the CSS parser and selectively overrides or
 * extends productions. This matches the approach used by `LessActionsParser`.
 */
export class ScssActionsParser extends CssActionsParser {
  declare T: TokenMap;

  // SCSS-specific rules (added via productions registration)
  scssCondition!: Rule;
  scssGuardOr!: Rule;
  scssGuardAnd!: Rule;
  scssGuardInParens!: Rule;
  scssGuardInner!: Rule;
  scssComparison!: Rule;
  scssMapLiteral!: Rule;
  scssUseAtRule!: Rule;
  scssForwardAtRule!: Rule;
  scssExtendAtRule!: Rule;
  scssWithConfig!: Rule;
  scssContentAtRule!: Rule;
  scssIncludeAtRule!: Rule;
  scssIfAtRule!: Rule;
  scssForAtRule!: Rule;
  scssEachAtRule!: Rule;
  scssWhileAtRule!: Rule;
  scssMixinAtRule!: Rule;
  scssMixinParams!: Rule;
  scssMixinParamsAfterFunctionStart!: Rule;
  scssMixinParam!: Rule;

  constructor(
    tokenVocabulary: TokenVocabulary,
    T: TokenMap,
    config: ScssParserConfig = {}
  ) {
    super(tokenVocabulary, T, config);

    // SCSS extensions (overrides and additional rules).
    type ProductionFactory = (this: ScssActionsParser, T: TokenMap) => Rule;
    const entries = Object.entries(productions as Record<string, ProductionFactory>);
    // Two-pass registration:
    // 1) Register new SCSS-only rules first (so overrides can reference them reliably).
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

    if (this.constructor === ScssActionsParser) {
      this.performSelfAnalysis();
    }
  }

  /**
   * SCSS adds `$var` references. We tokenize these as `DollarVariable` and
   * convert them into Jess `Reference` nodes here.
   */
  protected override processValueToken(token: IToken, ctx?: RuleContext) {
    if (token.tokenType.name === 'DollarVariable') {
      return new Reference(
        token.image.slice(1),
        { type: 'variable' },
        this.getLocationInfo(token),
        this.context
      );
    }
    return super.processValueToken(token, ctx);
  }
}

