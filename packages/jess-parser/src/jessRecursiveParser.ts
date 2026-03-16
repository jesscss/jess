import {
  type TokenType
} from '@jesscss/parser';

import {
  ScssRecursiveParser,
  type ScssParserConfig,
  type CombinedTokenMap
} from '@jesscss/scss-parser';

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
  [k: string]: object | boolean | string | object[] | number | undefined;
};

export class JessRecursiveParser extends ScssRecursiveParser {
  declare T: JessTokenMap;

  constructor(
    T: JessTokenMap,
    config: JessParserConfig = {}
  ) {
    super(T as any, config);
    this.T = T;
  }

  // ════════════════════════════════════════════════════════════════════
  // PRODUCTION RULES — method declarations
  // Implementations are assigned via prototype below.
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
  declare jessVarWithAccessors: typeof productions.jessVarWithAccessors;

  // ── Root / statements ─────────────────────────────────────────────
  declare jessCollection: typeof productions.jessCollection;
  declare varDeclaration: typeof productions.varDeclaration;
  declare jessExprStatement: typeof productions.jessExprStatement;
}

// ── Attach production methods to prototype ────────────────────────────
const proto = JessRecursiveParser.prototype as any;

for (const [name, fn] of Object.entries(productions)) {
  if (typeof fn === 'function') {
    proto[name] = function(this: JessRecursiveParser, ...args: unknown[]) {
      this.ruleStack.push(name);
      const result = (fn as Function).apply(this, args);
      this.ruleStack.pop();
      return result;
    };
  }
}
