import {
  type IToken,
  type TokenType,
} from '@jesscss/parser';

import {
  CssRecursiveParser,
  type CssRecursiveParserConfig,
  type CssTokenType
} from '@jesscss/css-parser';

import {
  Reference,
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
  declare scssMapLiteral: typeof productions.scssMapLiteral;
  declare scssUseAtRule: typeof productions.scssUseAtRule;
  declare scssForwardAtRule: typeof productions.scssForwardAtRule;
  declare scssExtendAtRule: typeof productions.scssExtendAtRule;
  declare scssWithConfig: typeof productions.scssWithConfig;
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

// ── Attach production methods to prototype ────────────────────────────
const proto = ScssRecursiveParser.prototype as any;

for (const [name, fn] of Object.entries(productions)) {
  if (typeof fn === 'function') {
    proto[name] = function(this: ScssRecursiveParser, ...args: unknown[]) {
      this.ruleStack.push(name);
      const result = (fn as Function).apply(this, args);
      this.ruleStack.pop();
      return result;
    };
  }
}
