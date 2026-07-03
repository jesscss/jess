/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import type {
  TokenType
} from 'chevrotain';

import {
  ScssRecursiveParser,
  type ScssParserConfig,
  type CombinedTokenMap
} from '@jesscss/scss-parser';
import { productions as cssProductions, type Rule } from '@jesscss/css-parser';

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

/**
 * @deprecated LEGACY — Chevrotain-based Jess parser engine (extends the deprecated
 * ScssRecursiveParser). The functional macro grammar (`JessGrammar` /
 * `JessParserParseman` in ./parseman/) is the successor; it is not yet at full
 * parity, so the `JessParser` wrapper still ships as the primary `Parser`. TO BE
 * DELETED once the functional Jess parser reaches parity.
 */
export class JessRecursiveParser extends ScssRecursiveParser {
  declare T: JessTokenMap;

  // ════════════════════════════════════════════════════════════════════
  // PRODUCTION RULES — registered in the constructor
  // ════════════════════════════════════════════════════════════════════

  // ── Jess at-rules ─────────────────────────────────────────────────
  jessComposeAtRule!: Rule;
  jessFromAtRule!: Rule;
  jessExportAtRule!: Rule;

  // ── Control flow ──────────────────────────────────────────────────
  jessComparison!: Rule;
  jessConditionInParens!: Rule;
  jessIfStatement!: Rule;
  jessForStatement!: Rule;

  // ── Mixins ────────────────────────────────────────────────────────
  jessMixinParams!: Rule;
  jessGuard!: Rule;
  jessMixinDefinition!: Rule;
  jessMixinCall!: Rule;

  // ── Values ────────────────────────────────────────────────────────
  declare expressionSum: Rule;
  declare expressionProduct: Rule;
  declare expressionValue: Rule;
  jessParenExpression!: Rule;
  jessCallArgs!: Rule;
  jessVarWithAccessors!: Rule;

  // ── Root / statements ─────────────────────────────────────────────
  jessCollection!: Rule;
  varDeclaration!: Rule;
  jessExprStatement!: Rule;

  constructor(
    T: JessTokenMap,
    config: JessParserConfig = {}
  ) {
    super(T as any, config);
    this.T = T;
    type ProductionFactory = (this: JessRecursiveParser, T: JessTokenMap) => Rule;
    for (const [key, factory] of Object.entries(productions as Record<string, ProductionFactory>)) {
      if (typeof factory !== 'function') {
        continue;
      }
      const rule = factory.call(this, this.T);
      if (key in cssProductions) {
        this.OVERRIDE_RULE(key, rule);
      } else {
        this.RULE(key, rule);
      }
    }

    if (this.constructor === JessRecursiveParser) {
      this.performSelfAnalysis();
    }
  }
}
