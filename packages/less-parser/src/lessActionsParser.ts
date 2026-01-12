import type { TokenVocabulary, TokenType, IToken } from 'chevrotain';
import { tokenMatcher } from 'chevrotain';
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
  Interpolated,
  Any,
  Bool,
  type Node,
  type Extend,
  type ComplexSelector,
  type Selector
} from '@jesscss/core';
import { getInterpolatedOrString } from './utils';

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
   * Is less strict with certain CSS rules and Less syntax
   * that the old Less parser allowed.
   *
   * @note This will also enable CSS legacyMode unless
   * legacyMode is explicitly false.
   */
  looseMode?: boolean;

  /**
   * Controls whether mixins and detached rulesets "leak" their inner rules.
   * When true (default):
   * - Mixins: Mixin and VarDeclaration nodes are 'public' and 'optional' respectively
   * - Detached rulesets: Mixin and VarDeclaration nodes are 'public' and 'private' respectively
   * When false:
   * - Both mixins and detached rulesets: Mixin and VarDeclaration nodes are 'private'
   */
  leakyRules?: boolean;
};

// Concrete TokenMap: union of CSS and Less token names
export type CombinedTokenMap = Record<CssTokenType, TokenType> & Record<LessExtraTokenType, TokenType>;
export type TokenMap = CombinedTokenMap;

export interface ExtendTarget {
  selector?: Selector;
  target: Selector;
  flag: IToken | undefined;
}

export type RuleContext = CssRuleContext & {
  selector?: Selector;
  hasDefault?: boolean;
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
  asReference?: boolean;

  /** For :extend(...) */
  extendTargets?: ExtendTarget[];
  extendNodes?: Extend[];
  /** Inside an extend production - prevents 'all' from being consumed as selector */
  inExtend?: boolean;
  /** Inside a custom property value - used for deprecation warnings */
  inCustomPropertyValue?: boolean;
};
/**
 * Unlike the historical Less parser, this parser
 * avoids all backtracking
 */
export class LessActionsParser extends CssActionsParser {
  declare T: CssTokenMap;
  looseMode: boolean;
  leakyRules: boolean;
  /** Warnings collected during parsing */
  warnings: Array<{ message: string; token?: IToken; deprecation?: string }> = [];

  expressionSum!: Rule;
  expressionProduct!: Rule;
  expressionValue!: Rule;
  functionValueList!: Rule;
  ifFunction!: Rule;
  booleanFunction!: Rule;

  wrappedDeclarationList!: Rule;

  varDeclarationOrCall!: Rule;
  varName!: Rule;
  valueReference!: Rule;
  varReference!: Rule;

  // mixins
  mixinReference!: Rule;
  mixinName!: Rule;
  mixinOrQualifiedRule!: Rule;
  qualifiedRuleBody!: Rule;
  // mixinDefinition!: Rule;
  // mixinCall!: Rule;
  // mixinCallStatement!: Rule;
  mixinArgs!: Rule;
  mixinArgList!: Rule;
  mixinArg!: Rule;
  anonymousMixinDefinition!: Rule;

  callArgument!: Rule;

  extend!: Rule;
  ampersandExtend!: Rule;

  // namespaces
  // accessors!: Rule;
  lookupOrCall!: Rule;

  comparison!: Rule;
  guard!: Rule;
  guardDefault!: Rule;
  guardOr!: Rule;
  guardAnd!: Rule;
  guardInParens!: Rule;
  guardInner!: Rule;
  guardWithCondition!: Rule;
  guardWithConditionValue!: Rule;

  constructor(
    tokenVocabulary: TokenVocabulary,
    T: any,
    config: LessParserConfig = {}
  ) {
    let { legacyMode, looseMode = true, leakyRules = true, ...rest } = config;
    legacyMode = legacyMode ?? looseMode;
    super(tokenVocabulary, T, { legacyMode, ...rest });

    this.looseMode = looseMode;
    this.leakyRules = leakyRules;
    this.warnings = [];

    const $ = this;

    /** Less extensions */
    for (let [key, value] of Object.entries(productions)) {
      // @ts-expect-error - this is fine
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

  protected processValueToken(token: IToken, ctx?: RuleContext) {
    let tokenType = token.tokenType;
    const TT = this.T as unknown as Record<string, TokenType>;
    const tokenName = tokenType.name;

    // Check if this is an AtKeyword token (can be consumed via T.AtName category or T.Value category)
    // Also check tokenMatcher in case the token type name check doesn't work
    if (tokenType.name === 'AtKeyword' || tokenMatcher(token, this.T.AtKeyword)) {
      if (!this.RECORDING_PHASE && ctx?.inCustomPropertyValue) {
        // Warn about @ident in custom property values - it's treated as literal text, not a variable reference
        this.warnDeprecation(
          '@[ident] in custom property values is treated as literal text, not a variable reference. Use @{[ident]} if you want it to be evaluated.',
          token,
          'variable-in-unknown-value'
        );
      }
      return new Reference(token.image.slice(1), { type: 'variable' }, this.getLocationInfo(token), this.context);
    } else if (tokenType.name === 'PropertyReference') {
      if (!this.RECORDING_PHASE) {
        if (ctx?.inCustomPropertyValue) {
          this.warnDeprecation(
            '$[ident] in custom property values is treated as literal text, not a property reference. Use ${[ident]} if you want it to be evaluated.',
            token,
            'property-in-unknown-value'
          );
        }
      }
      return super.processValueToken(token, ctx);
    } else if (tokenType === TT['DefaultGuardFunc']) {
      return new DefaultGuard(token.image, undefined, this.getLocationInfo(token), this.context);
    } else if (tokenType === TT['JavaScript']) {
      return new JsExpression(token.image, undefined, this.getLocationInfo(token), this.context);
    } else if (tokenType === TT['InterpolatedIdent']) {
      const result = getInterpolatedOrString(token.image, this.getLocationInfo(token), this.context);
      if (result instanceof Interpolated) {
        return result;
      } else {
        return new Any(result, { role: 'ident' }, this.getLocationInfo(token), this.context);
      }
    } else if (tokenType === TT['PlainIdent']) {
      // Parse true/false as Bool nodes in Less
      const image = token.image;
      if (image === 'true' || image === 'false') {
        return new Bool(image === 'true', undefined, this.getLocationInfo(token), this.context);
      }
    }
    return super.processValueToken(token, ctx);
  }

  /**
   * Emits a deprecation warning during parsing.
   * Only collects warnings during the non-recording phase.
   */
  protected warnDeprecation(message: string, token?: IToken, deprecationId?: string): void {
    if (!this.RECORDING_PHASE) {
      this.warnings.push({ message, token, deprecation: deprecationId });
    }
  }
}