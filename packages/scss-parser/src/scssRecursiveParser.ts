import type {
  IToken,
  TokenType,
} from 'chevrotain';
import { tokenMatcher } from 'chevrotain';

import {
  CssRecursiveParser,
  type CssRecursiveParserConfig,
  type CssTokenType,
  type Rule,
  productions as cssProductions
} from '@jesscss/css-parser';

import {
  Reference,
  type MathMode,
  type Node,
} from '@jesscss/core';

import { type ScssExtraTokenType } from './scssTokens.js';

import * as productions from './productions/index.js';
import { registerScssRecursiveParser } from './productions/helpers.js';

export type ScssParserConfig = CssRecursiveParserConfig & {
  // reserved for future scss-specific config
};

// Concrete TokenMap: union of CSS and SCSS token names
export type CombinedTokenMap = Record<CssTokenType, TokenType> & Record<ScssExtraTokenType, TokenType>;
export type TokenMap = CombinedTokenMap;

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
  /** Allow comma in guard context */
  allowComma?: boolean;
  /** Inside an @extend target selector */
  inExtend?: boolean;
  /** Wrap a parsed outer operation as an Expression when appropriate */
  wrapInExpression?: boolean;
  /** Parenthesis math frames; top-most value controls math-in-parens semantics */
  parenFrames?: boolean[];
  /** Calc depth counter */
  calcFrames?: number;
  /** Seed value for continuing a parsed expression */
  startValue?: Node;
  /** Allow slash to parse as division instead of a separator */
  allowSlashDivision?: boolean;
  /** Prefer isolated arithmetic parsing for paren groups */
  preferExpressionInParens?: boolean;
  /** Reserved for future math-mode alignment with Less */
  mathMode?: MathMode;

  [k: string]: object | boolean | string | object[] | number | undefined;
};

export class ScssRecursiveParser extends CssRecursiveParser {
  declare T: TokenMap;

  /** Warnings collected during parsing (extends base ParseError[]) */
  declare warnings: any[];

  private tempVarCounter = 0;
  private pendingNodes: Node[] = [];

  constructor(
    T: TokenMap,
    config: ScssParserConfig = {}
  ) {
    super(T as any, config);
    this.T = T;
    this.warnings = [];
    (this as any).skipValidations = true;

    type ProductionFactory = (this: ScssRecursiveParser, T: TokenMap) => Rule;
    for (const [key, factory] of Object.entries(productions as Record<string, ProductionFactory>)) {
      if (typeof factory !== 'function') continue;
      const rule = factory.call(this, this.T);
      if (key in cssProductions) {
        this.OVERRIDE_RULE(key, rule);
      } else {
        this.RULE(key, rule);
      }
    }

    if (this.constructor === ScssRecursiveParser) {
      this.performSelfAnalysis();
    }
  }

  nextTempVarName(): string {
    return `_tmp_${this.tempVarCounter++}`;
  }

  enqueuePendingNode(node: Node): void {
    this.pendingNodes.push(node);
  }

  consumePendingNodes(): Node[] {
    const out = this.pendingNodes;
    this.pendingNodes = [];
    return out;
  }

  resetGeneratedState(): void {
    this.tempVarCounter = 0;
    this.pendingNodes = [];
  }

  /**
   * SCSS adds `$var` references. We tokenize these as `DollarVariable` and
   * convert them into Jess `Reference` nodes here.
   */
  protected override processValueToken(token: IToken, ctx?: RuleContext): Node {
    if (token.tokenType.name === 'DollarVariable') {
      if (ctx?.inCustomPropertyValue) {
        return new Reference(
          { key: token.image.slice(1) },
          { type: 'variable', role: 'ident' },
          this.getLocationInfo(token),
          this.context
        );
      }
      return new Reference(
        token.image.slice(1),
        { type: 'variable' },
        this.getLocationInfo(token),
        this.context
      );
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
      PlainIdent,
      LegacyPropIdent,
      CustomProperty
    } = this.T as TokenMap & Partial<Record<'PlainIdent' | 'LegacyPropIdent' | 'CustomProperty', TokenType>>;

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

    const first = this.LA(1);
    const firstIsDeclarationName = this.isTypeAt(1, Ident)
      || (PlainIdent !== undefined && first.tokenType === PlainIdent)
      || (LegacyPropIdent !== undefined && first.tokenType === LegacyPropIdent)
      || (CustomProperty !== undefined && first.tokenType === CustomProperty);

    if (!firstIsDeclarationName) {
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
    ) {
      return true;
    }

    const third = this.LA(3);
    const thirdIsNameLike = tokenMatcher(third, Ident)
      || (PlainIdent !== undefined && third.tokenType === PlainIdent);
    if (!thirdIsNameLike) {
      return false;
    }

    return isSelectorLikeContinuation(4);
  }

  // ════════════════════════════════════════════════════════════════════
  // PRODUCTION RULES — method declarations
  // Implementations are assigned via prototype below.
  // ════════════════════════════════════════════════════════════════════

  // ── New SCSS-only productions ──────────────────────────────────────
  declare scssCondition: typeof productions.scssCondition;
  declare scssConditionOr: typeof productions.scssConditionOr;
  declare scssConditionAnd: typeof productions.scssConditionAnd;
  declare scssConditionInParens: typeof productions.scssConditionInParens;
  declare scssConditionInner: typeof productions.scssConditionInner;
  declare scssComparison: typeof productions.scssComparison;
  expressionSum!: Rule;
  expressionProduct!: Rule;
  expressionValue!: Rule;
  parenValue!: Rule;
  declare scssMapLiteral: typeof productions.scssMapLiteral;
  declare scssNestedPropertyCollection: typeof productions.scssNestedPropertyCollection;
  declare scssIdentValue: typeof productions.scssIdentValue;
  declare scssUseAtRule: typeof productions.scssUseAtRule;
  declare scssForwardAtRule: typeof productions.scssForwardAtRule;
  declare scssExtendAtRule: typeof productions.scssExtendAtRule;
  declare scssWithConfig: typeof productions.scssWithConfig;
  declare scssIncludeUsingParams: typeof productions.scssIncludeUsingParams;
  declare scssContentAtRule: typeof productions.scssContentAtRule;
  declare scssIncludeAtRule: typeof productions.scssIncludeAtRule;
  declare scssIfAtRule: typeof productions.scssIfAtRule;
  declare scssForAtRule: typeof productions.scssForAtRule;
  declare scssEachAtRule: typeof productions.scssEachAtRule;
  declare scssWhileAtRule: typeof productions.scssWhileAtRule;
  declare scssMixinAtRule: typeof productions.scssMixinAtRule;
  declare scssFunctionAtRule: typeof productions.scssFunctionAtRule;
  declare scssReturnAtRule: typeof productions.scssReturnAtRule;
  declare scssDiagnosticAtRule: typeof productions.scssDiagnosticAtRule;
  declare scssAtRootAtRule: typeof productions.scssAtRootAtRule;
  declare scssMixinParams: typeof productions.scssMixinParams;
  declare scssMixinParamsAfterFunctionStart: typeof productions.scssMixinParamsAfterFunctionStart;
  declare scssMixinParam: typeof productions.scssMixinParam;

  // ── SCSS prelude rules ─────────────────────────────────────────────
  declare scssMediaPrelude: typeof productions.scssMediaPrelude;
  declare scssSupportsPrelude: typeof productions.scssSupportsPrelude;
  declare scssContainerPrelude: typeof productions.scssContainerPrelude;
  declare scssScopePrelude: typeof productions.scssScopePrelude;
}

// Register for lazy interpolation parser creation (breaks circular dep)
registerScssRecursiveParser(ScssRecursiveParser);
