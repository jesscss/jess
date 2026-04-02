import {
  type IToken,
  type TokenType,
  tokenMatcher
} from 'chevrotain';

import {
  CssRecursiveParser,
  type CssRecursiveParserConfig,
  type RuleContext as CssRuleContext,
  type CssTokenType,
  productions as cssProductions
} from '@jesscss/css-parser';

import {
  Reference,
  DefaultGuard,
  Interpolated,
  Any,
  Bool,
  type MathMode,
  type Node,
  type Extend,
  type ComplexSelector,
  type Selector
} from '@jesscss/core';
import { getInterpolatedOrString } from './utils.js';

import { type LessExtraTokenType } from './lessTokens.js';

import * as productions from './productions/index.js';

export type LessParserConfig = CssRecursiveParserConfig & {
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

  /**
   * Less math evaluation mode. Used during parsing to decide whether a given
   * `Operation` should be represented as an `Expression` for Less→Jess conversion.
   *
   * Mirrors runtime behavior in `Context.shouldOperate()`.
   *
   * @default 'parens-division'
   */
  mathMode?: MathMode;

  /**
   * When enabled (default), the parser will wrap the *outermost* Less math/value
   * expressions (math operations, variable references, and chained mixin/variable
   * calls) in an `Expression({ parens: true })`.
   *
   * This is purely a parse-time AST shape choice to support Less→Jess conversion.
   *
   * @default true
   */
  wrapOuterExpressions?: boolean;
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
  allExtended?: boolean;
  isDefinition?: boolean;
  allowAnonymousMixins?: boolean;
  requireAccessorsAfterMixinCall?: boolean;
  inValueList?: boolean;
  allowComma?: boolean;
  node?: Node;
  ruleIsFinished?: boolean;
  sequences?: Array<ComplexSelector | Extend>;
  asReference?: boolean;
  extendTargets?: ExtendTarget[];
  extendNodes?: Extend[];
  inExtend?: boolean;
  wrapInExpression?: boolean;
  parenFrames?: boolean[];
  calcFrames?: number;
  detachedRulesetUsage?: 'function-arg' | 'mixin-arg' | 'default-param';
  inFunctionArgs?: boolean;
  allowMixinCallWithoutAccessor?: boolean;
  startValue?: Node;
};

export class LessRecursiveParser extends CssRecursiveParser {
  declare T: TokenMap;
  looseMode: boolean;
  leakyRules: boolean;
  /** Warnings collected during parsing */
  warnings: Array<{ message: string; token?: IToken; deprecation?: string }> = [];

  /** See `LessParserConfig.mathMode` */
  mathMode: MathMode;
  /** See `LessParserConfig.wrapOuterExpressions` */
  wrapOuterExpressions: boolean;

  constructor(
    T: TokenMap,
    config: LessParserConfig = {}
  ) {
    let {
      legacyMode,
      looseMode = true,
      leakyRules = true,
      mathMode = 'parens-division',
      wrapOuterExpressions = true,
      ...rest
    } = config;
    legacyMode = legacyMode ?? looseMode;
    super(T, { legacyMode, ...rest });

    this.T = T;
    this.looseMode = looseMode;
    this.leakyRules = leakyRules;
    this.mathMode = mathMode;
    this.wrapOuterExpressions = wrapOuterExpressions;
    this.warnings = [];

    for (const [key, factory] of Object.entries(productions)) {
      if (typeof factory !== 'function') {
        continue;
      }
      const rule = (factory as Function).call(this, this.T);
      if (key in cssProductions) {
        this.OVERRIDE_RULE(key, rule);
      } else {
        this.RULE(key, rule);
      }
    }

    if (this.constructor === LessRecursiveParser) {
      this.performSelfAnalysis();
    }
  }

  protected override processValueToken(token: IToken, ctx?: RuleContext): Node {
    let tokenType = token.tokenType;
    const T = this.T;

    if (tokenType.name === 'AtKeyword' || tokenMatcher(token, T.AtKeyword)) {
      if (ctx?.inCustomPropertyValue) {
        const atName = token.image;
        const ident = token.image.slice(1);
        this.warnDeprecation(
          `"${atName}" in custom property values is treated as literal text, not a variable reference. Use "\@{${ident}}" if you want it to be evaluated.`,
          token,
          'variable-in-unknown-value'
        );
        return new Any(token.image, { role: 'any' }, this.getLocationInfo(token), this.context);
      }
      return new Reference(token.image.slice(1), { type: 'variable' }, this.getLocationInfo(token), this.context);
    } else if (tokenType.name === 'PropertyReference') {
      if (ctx?.inCustomPropertyValue) {
        const atName = token.image;
        const ident = token.image.slice(1);
        this.warnDeprecation(
          `"${atName}" in custom property values is treated as literal text, not a property reference. Use "\${${ident}}" if you want it to be evaluated.`,
          token,
          'property-in-unknown-value'
        );
        return new Any(token.image, { role: 'any' }, this.getLocationInfo(token), this.context);
      }
      return super.processValueToken(token, ctx);
    } else if (tokenType === T['DefaultGuardFunc']) {
      return new DefaultGuard(token.image, undefined, this.getLocationInfo(token), this.context);
    } else if (
      tokenType.name === 'JavaScript'
      || (T['JavaScript'] && tokenMatcher(token, T['JavaScript']))
    ) {
      throw new Error(
        'Inline JavaScript using backticks is not supported. Use @use to import a JavaScript/TypeScript module instead. Script-module documentation is coming soon.'
      );
    } else if (tokenType === T['InterpolatedIdent']) {
      const result = getInterpolatedOrString(token.image, this.getLocationInfo(token), this.context);
      if (result instanceof Interpolated) {
        return result;
      } else {
        return new Any(result, { role: 'ident' }, this.getLocationInfo(token), this.context);
      }
    } else if (tokenType === T['PlainIdent']) {
      const image = token.image;
      if (image === 'true' || image === 'false') {
        return new Bool(image === 'true', undefined, this.getLocationInfo(token), this.context);
      }
    }
    return super.processValueToken(token, ctx);
  }

  override shouldTryQualifiedRuleInDeclarationList(): boolean {
    const {
      Ident,
      Assign,
      Colon,
      LCurly,
      Comma,
      LSquare,
      NthPseudoClass,
      SelectorPseudoClass,
      FunctionStart
    } = this.T;

    const isSelectorLikeContinuation = (offset: number): boolean => {
      const tok = this.LA(offset);
      return (
        tokenMatcher(tok, LCurly)
        || tokenMatcher(tok, Comma)
        || tokenMatcher(tok, this.T.Combinator)
        || tokenMatcher(tok, LSquare)
        || tokenMatcher(tok, Colon)
        || tokenMatcher(tok, NthPseudoClass)
        || tokenMatcher(tok, SelectorPseudoClass)
      );
    };

    if (!this.isTypeAt(1, Ident)) {
      return true;
    }
    if (!this.isTypeAt(2, Assign)) {
      return true;
    }
    if (this.hasWS(2)) {
      return false;
    }

    const tt3 = this.LA(3).tokenType;
    if (
      tt3 === Colon
      || tt3 === NthPseudoClass
      || tt3 === SelectorPseudoClass
      || tokenMatcher(this.LA(3), FunctionStart)
    ) {
      return true;
    }
    if (!tokenMatcher(this.LA(3), Ident)) {
      return false;
    }
    return isSelectorLikeContinuation(4);
  }

  warnDeprecation(message: string, token?: IToken, deprecationId?: string): void {
    this.warnings.push({ message, token, deprecation: deprecationId });
  }
}
