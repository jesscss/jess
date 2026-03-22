import type {
  TokenType
} from 'chevrotain';

import {
  ScssRecursiveParser,
  type ScssParserConfig,
  type CombinedTokenMap
} from '@jesscss/scss-parser';
import { productions as cssProductions } from '@jesscss/css-parser';

import { type JessExtraTokenType } from './jessTokens.js';

import * as productions from './productions/index.js';

export type JessParserConfig = ScssParserConfig & {
  // reserved for future Jess-specific config
};

export type JessTokenMap = CombinedTokenMap & Record<JessExtraTokenType, TokenType>;
export type TokenMap = JessTokenMap;

/** The RuleContext type used across all Jess productions */
export type JessRuleContext = {
  inner?: boolean;
  firstSelector?: boolean;
  qualifiedRule?: boolean;
  inCustomPropertyValue?: boolean;
  isRoot?: boolean;
  allowComma?: boolean;
  inExtend?: boolean;
  skipLParen?: boolean;
  [k: string]: object | boolean | string | object[] | number | undefined;
};

export class JessRecursiveParser extends ScssRecursiveParser {
  declare T: JessTokenMap;

  // ════════════════════════════════════════════════════════════════════
  // PRODUCTION RULES — registered in the constructor
  // ════════════════════════════════════════════════════════════════════

  // ── Jess at-rules ─────────────────────────────────────────────────
  declare jessComposeAtRule: typeof productions.jessComposeAtRule;
  declare jessFromAtRule: typeof productions.jessFromAtRule;
  declare jessExportAtRule: typeof productions.jessExportAtRule;

  // ── Control flow ──────────────────────────────────────────────────
  declare jessComparison: typeof productions.jessComparison;
  declare jessConditionInParens: typeof productions.jessConditionInParens;
  declare jessIfStatement: typeof productions.jessIfStatement;
  declare jessForStatement: typeof productions.jessForStatement;

  // ── Mixins ────────────────────────────────────────────────────────
  declare jessMixinParams: typeof productions.jessMixinParams;
  declare jessGuard: typeof productions.jessGuard;
  declare jessMixinDefinition: typeof productions.jessMixinDefinition;
  declare jessMixinCall: typeof productions.jessMixinCall;

  // ── Values ────────────────────────────────────────────────────────
  declare jessParenExpression: typeof productions.jessParenExpression;
  declare jessCallArgs: typeof productions.jessCallArgs;
  declare jessVarWithAccessors: typeof productions.jessVarWithAccessors;

  // ── Root / statements ─────────────────────────────────────────────
  declare jessCollection: typeof productions.jessCollection;
  declare varDeclaration: typeof productions.varDeclaration;
  declare jessExprStatement: typeof productions.jessExprStatement;

  constructor(
    T: JessTokenMap,
    config: JessParserConfig = {}
  ) {
    super(T as unknown as CombinedTokenMap, config);
    this.T = T;
    type ProductionFactory = (this: JessRecursiveParser, T: JessTokenMap) => (ctx?: JessRuleContext) => unknown;
    const entries = Object.entries(productions) as Array<[keyof typeof productions, ProductionFactory]>;

    for (const [key, factory] of entries) {
      const rule = factory.call(this, this.T);
      if (key in cssProductions) {
        this.OVERRIDE_RULE(key, rule);
      } else {
        this.RULE(key, rule);
      }
    }

    if ((this.constructor as typeof JessRecursiveParser) === JessRecursiveParser) {
      this.performSelfAnalysis();
    }
  }
}
