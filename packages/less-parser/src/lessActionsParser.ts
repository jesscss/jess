import type { TokenVocabulary, TokenType, IToken } from 'chevrotain';
// import { LLStarLookaheadStrategy } from 'chevrotain-allstar'
import {
  type Rule,
  type RuleContext as CssRuleContext,
  type CssParserConfig,
  CssActionsParser,
  productions as cssProductions,
  type CssTokenType,
  type TokenMap as CssTokenMap
} from '@jesscss/css-parser';

import {
  Reference,
  DefaultGuard,
  JsExpression,
  type Node,
  type Extend,
  type ComplexSelector
} from '@jesscss/core';

import { type LessTokenType, type LessExtraTokenType } from './lessTokens';
import * as productions from './productions';

// import root from './productions/root'
// import atRules from './productions/atRules'
// import blocks from './productions/blocks'
// import declarations from './productions/declarations'
// import mixin from './productions/mixin'
// import selectors from './productions/selectors'
// import interpolation from './productions/interpolation'
// import values from './productions/values'

export type LessParserConfig = CssParserConfig & {
  /**
   * Is less strict with certain CSS rules
   * that the old Less parser allowed.
   *
   * @note This will also enable CSS legacyMode unless
   * legacyMode is explicitly false.
   */
  looseMode?: boolean;
};

// Concrete TokenMap: union of CSS and Less token names
export type CombinedTokenMap = Record<CssTokenType, TokenType> & Record<LessExtraTokenType, TokenType>;
export type TokenMap = CombinedTokenMap;

export type RuleContext = CssRuleContext & {
  hasDefault?: boolean;
  /** Parse-time roll-up flag indicating subtree may async */
  mayAsync?: boolean;
  /** Selectors in a selector sequence are extended */
  allExtended?: boolean;
  /** Mixin definition */
  isDefinition?: boolean;
  // isCompareExpression?: boolean
  allowAnonymousMixins?: boolean;
  requireAccessorsAfterMixinCall?: boolean;
  // boolean() and if() do not need parens around compare expressions
  // additionally, they do not allow outer commas
  inValueList?: boolean;
  // An outer guard allows a comma
  allowComma?: boolean;
  /** Allow passing in the currently constructed Node */
  node?: Node;
  ruleIsFinished?: boolean;
  sequences?: Array<ComplexSelector | Extend>;
};
/**
 * Unlike the historical Less parser, this parser
 * avoids all backtracking
 */
export class LessActionsParser extends CssActionsParser {
  declare T: CssTokenMap;
  looseMode: boolean;

  expressionSum!: Rule<(ctx?: RuleContext) => void>;
  expressionProduct!: Rule<(ctx?: RuleContext) => void>;
  expressionValue!: Rule<(ctx?: RuleContext) => void>;
  functionValueList!: Rule;
  ifFunction!: Rule;
  booleanFunction!: Rule;

  wrappedDeclarationList!: Rule;

  varName!: Rule;
  valueReference!: Rule<(ctx?: RuleContext) => void>;
  varReference!: Rule<(ctx?: RuleContext) => void>;

  // mixins
  mixinReference!: Rule;
  mixinName!: Rule<(asReference?: boolean) => void>;
  mixinOrQualifiedRule!: Rule<(ctx?: RuleContext) => void>;
  qualifiedRuleBody!: Rule<(ctx?: RuleContext) => void>;
  // mixinDefinition!: Rule;
  // mixinCall!: Rule;
  // mixinCallStatement!: Rule;
  inlineMixinCall!: Rule<(ctx?: RuleContext) => void>;
  mixinArgs!: Rule<(ctx?: RuleContext) => void>;
  mixinArgList!: Rule<(ctx?: RuleContext) => void>;
  mixinArg!: Rule<(ctx?: RuleContext) => void>;
  anonymousMixinDefinition!: Rule;

  callArgument!: Rule<(ctx?: RuleContext) => void>;

  extend!: Rule<(selector?: ComplexSelector) => void>;
  extendList!: Rule<(ctx?: RuleContext) => void>;

  // namespaces
  accessors!: Rule<(ctx?: RuleContext) => void>;

  comparison!: Rule<(ctx?: RuleContext) => void>;
  guard!: Rule<(ctx?: RuleContext) => void>;
  guardDefault!: Rule<(ctx?: RuleContext) => void>;
  guardOr!: Rule<(ctx?: RuleContext) => void>;
  guardAnd!: Rule<(ctx?: RuleContext) => void>;
  guardInParens!: Rule<(ctx?: RuleContext) => void>;
  guardInner!: Rule<(ctx?: RuleContext) => void>;
  guardWithCondition!: Rule;
  guardWithConditionValue!: Rule;

  constructor(
    tokenVocabulary: TokenVocabulary,
    T: any,
    config: LessParserConfig = {}
  ) {
    let { legacyMode, looseMode = true, ...rest } = config;
    legacyMode = legacyMode ?? looseMode;
    super(tokenVocabulary, T, { legacyMode, ...rest });

    this.looseMode = looseMode;

    const $ = this;

    /** Less extensions */
    for (let [key, value] of Object.entries(productions)) {
      // @ts-expect-error - `this` is fine
      let rule = value.call(this, T);
      if (key in cssProductions) {
        this.OVERRIDE_RULE(key, rule);
      } else {
        this.RULE(key, rule);
      }
    }

    if ($.constructor === LessActionsParser) {
      $.performSelfAnalysis();
    }
  }

  protected processValueToken(token: IToken) {
    let tokenType = token.tokenType;
    const TT = this.T as unknown as Record<string, TokenType>;
    if (tokenType === TT['AtKeyword']) {
      return new Reference(token.image.slice(1), { type: 'variable' }, this.getLocationInfo(token), this.context);
    } else if (tokenType === TT['DefaultGuardFunc']) {
      return new DefaultGuard(token.image, undefined, this.getLocationInfo(token), this.context);
    } else if (tokenType === TT['JavaScript']) {
      return new JsExpression(token.image, undefined, this.getLocationInfo(token), this.context);
    }
    return super.processValueToken(token);
  }
}