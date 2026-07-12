import {
  type IToken,
  type TokenType,
  buildTokenTypeSet,
  tokenMatches
} from '@jesscss/parser';

import {
  CssRecursiveParser,
  type CssRecursiveParserConfig,
  type CssTokenType
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

export type RuleContext = {
  /** Inside a declaration list */
  inner?: boolean;
  /** Determine if this is the first selector in the list */
  firstSelector?: boolean;
  /** If downstream selector rules are part of a qualified rule */
  qualifiedRule?: boolean;
  /** Inside a custom property value */
  inCustomPropertyValue?: boolean;
  /** Is root stylesheet */
  isRoot?: boolean;

  selector?: Selector;
  isSelectorList?: boolean;
  hasDefault?: boolean;
  /** Selectors in a selector sequence are extended */
  allExtended?: boolean;
  /** Mixin definition */
  isDefinition?: boolean;
  allowAnonymousMixins?: boolean;
  requireAccessorsAfterMixinCall?: boolean;
  inValueList?: boolean;
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

  /**
   * When true, the current production should wrap the *outermost* parsed value
   * (if it is a Less expression) in `Expression({ parens: true })`.
   */
  wrapInExpression?: boolean;

  /**
   * Parse-time equivalent of `Context.parenFrames`.
   */
  parenFrames?: boolean[];

  /**
   * Parse-time equivalent of `Context.calcFrames`.
   */
  calcFrames?: number;
  /**
   * Tracks where a detached ruleset literal is parsed from.
   */
  detachedRulesetUsage?: 'function-arg' | 'mixin-arg' | 'default-param';

  /** Inside function call arguments — allows Eq token as value */
  inFunctionArgs?: boolean;

  /** Allow mixin call without accessor in certain contexts */
  allowMixinCallWithoutAccessor?: boolean;

  /** A pre-parsed start value (e.g., from signed token decomposition) */
  startValue?: Node;

  [k: string]: object | boolean | string | object[] | number | undefined;
};

export class LessRecursiveParser extends CssRecursiveParser {
  declare T: TokenMap;
  looseMode: boolean;
  leakyRules: boolean;
  /** Warnings collected during parsing (extends base class warnings with deprecation info) */
  override warnings: any[] = [];

  /** See `LessParserConfig.mathMode` */
  mathMode: MathMode;
  /** See `LessParserConfig.wrapOuterExpressions` */
  wrapOuterExpressions: boolean;
  EXPRESSION_PRODUCT_OPERATOR_START: Uint32Array;
  GUARD_OR_START: Uint32Array;
  MIXIN_ARG_TERMINATOR: Uint32Array;
  CALL_ARGUMENT_BLOCK_START: Uint32Array;
  LESS_AT_NAME_START: Uint32Array;

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
    super(T as any, { legacyMode, ...rest });

    this.T = T;
    this.looseMode = looseMode;
    this.leakyRules = leakyRules;
    this.mathMode = mathMode;
    this.wrapOuterExpressions = wrapOuterExpressions;
    this.warnings = [];

    this.EXPRESSION_PRODUCT_OPERATOR_START = buildTokenTypeSet([
      T.Star,
      T.Divide,
      T.Percent
    ]);

    this.GUARD_OR_START = buildTokenTypeSet([
      T.Comma,
      T.Or
    ]);

    this.MIXIN_ARG_TERMINATOR = buildTokenTypeSet([
      T.Ellipsis,
      T.RParen,
      T.Comma,
      T.Semi
    ]);

    this.CALL_ARGUMENT_BLOCK_START = buildTokenTypeSet([
      T.AnonMixinStart,
      T.LCurly
    ]);

    this.LESS_AT_NAME_START = buildTokenTypeSet([
      T.AtKeyword,
      T.AtKeywordLessExtension
    ]);
  }

  protected override processValueToken(token: IToken, ctx?: RuleContext): Node {
    let tokenType = token.tokenType;
    const T = this.T;

    // Check if this is an AtKeyword token
    if (tokenType.name === 'AtKeyword' || tokenMatches(token, T.AtKeyword)) {
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
    } else if (tokenType === (T as any)['DefaultGuardFunc']) {
      return new DefaultGuard(token.image, undefined, this.getLocationInfo(token), this.context);
    } else if (
      tokenType.name === 'JavaScript'
      || ((T as any)['JavaScript'] && tokenMatches(token, (T as any)['JavaScript']))
    ) {
      throw new Error(
        'Inline JavaScript using backticks is not supported. Use @use to import a JavaScript/TypeScript module instead. Script-module documentation is coming soon.'
      );
    } else if (tokenType === (T as any)['InterpolatedIdent']) {
      const result = getInterpolatedOrString(token.image, this.getLocationInfo(token), this.context);
      if (result instanceof Interpolated) {
        return result;
      } else {
        return new Any(result, { role: 'ident' }, this.getLocationInfo(token), this.context);
      }
    } else if (tokenType === (T as any)['PlainIdent']) {
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
   */
  warnDeprecation(message: string, token?: IToken, deprecationId?: string): void {
    this.warnings.push({ message, token, deprecation: deprecationId });
  }

  // ════════════════════════════════════════════════════════════════════
  // PRODUCTION RULES — method declarations
  // Implementations are assigned via prototype below.
  // ════════════════════════════════════════════════════════════════════

  // ── New Less-only productions ──────────────────────────────────────
  declare wrappedDeclarationList: typeof productions.wrappedDeclarationList;
  declare qualifiedRuleBody: typeof productions.qualifiedRuleBody;
  declare mixinOrQualifiedRule: typeof productions.mixinOrQualifiedRule;
  declare ampersandExtend: typeof productions.ampersandExtend;
  declare extend: typeof productions.extend;
  declare anonymousMixinDefinition: typeof productions.anonymousMixinDefinition;
  declare varDeclarationOrCall: typeof productions.varDeclarationOrCall;
  declare selectorCapture: typeof productions.selectorCapture;
  declare expressionSum: typeof productions.expressionSum;
  declare expressionProduct: typeof productions.expressionProduct;
  declare expressionValue: typeof productions.expressionValue;
  declare booleanFunction: typeof productions.booleanFunction;
  declare varReference: typeof productions.varReference;
  declare valueReference: typeof productions.valueReference;
  declare guard: typeof productions.guard;
  declare guardOr: typeof productions.guardOr;
  declare guardDefault: typeof productions.guardDefault;
  declare guardAnd: typeof productions.guardAnd;
  declare guardInParens: typeof productions.guardInParens;
  declare guardInner: typeof productions.guardInner;
  declare guardWithConditionValue: typeof productions.guardWithConditionValue;
  declare guardWithCondition: typeof productions.guardWithCondition;
  declare comparison: typeof productions.comparison;
  declare mixinName: typeof productions.mixinName;
  declare mixinReference: typeof productions.mixinReference;
  declare mixinArgs: typeof productions.mixinArgs;
  declare lookupOrCall: typeof productions.lookupOrCall;
  declare mixinArgList: typeof productions.mixinArgList;
  declare varName: typeof productions.varName;
  declare mixinArg: typeof productions.mixinArg;
  declare callArgument: typeof productions.callArgument;
  declare exportAtRule: typeof productions.exportAtRule;
}

// ── Attach production methods to prototype ────────────────────────────
const proto = LessRecursiveParser.prototype as any;

for (const [name, fn] of Object.entries(productions)) {
  if (typeof fn === 'function') {
    proto[name] = function(this: LessRecursiveParser, ...args: unknown[]) {
      this.ruleStack.push(name);
      const result = (fn as Function).apply(this, args);
      this.ruleStack.pop();
      return result;
    };
  }
}
