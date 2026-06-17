/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
// Methods to be mixed into CssRecursiveParser
import type { IOrAlt, IToken } from 'chevrotain';
import type { CssRecursiveParser, RuleContext, TokenMap, Rule } from '../cssRecursiveParser.js';
import { tokenMatcher } from '../cssRecursiveParser.js';
import { EMPTY_ALT } from 'chevrotain';
import {
  type LocationInfo,
  Node, Any, AtRule, Rules, Sequence, List,
  QueryCondition, Keyword, Paren, Declaration, Call,
  BasicSelector, Block, RawRules
} from '@jesscss/core';

type C = CssRecursiveParser;

type PreludeRule = Rule | string | undefined;

function resolvePreludeRule($: C, preludeRule: PreludeRule): Rule | undefined {
  if (typeof preludeRule === 'string') {
    const resolved = ($ as unknown as Record<string, unknown>)[preludeRule];
    if (typeof resolved === 'function') {
      return resolved as Rule;
    }
    return undefined;
  }
  return preludeRule;
}

export type AltContext = (ctx?: RuleContext) => Array<IOrAlt<any>>;
type ProductionRule = (ctx?: RuleContext) => Node | Node[] | undefined;

export function atRule(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  let ruleAlt = alt ?? ((ctx?: RuleContext) => ([
    { GATE: () => $.isType(T.AtContainer), ALT: () => $.SUBRULE($.containerAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType(T.AtScope), ALT: () => $.SUBRULE($.scopeAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType(T.AtDocument), ALT: () => $.SUBRULE($.documentAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType(T.AtLayer), ALT: () => $.SUBRULE($.layerAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType(T.AtKeyframes), ALT: () => $.SUBRULE($.keyframesAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType(T.AtImport), ALT: () => $.SUBRULE($.importAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType(T.AtMedia), ALT: () => $.SUBRULE($.mediaAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType(T.AtPage), ALT: () => $.SUBRULE($.pageAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType(T.AtFontFace), ALT: () => $.SUBRULE($.fontFaceAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType(T.AtSupports), ALT: () => $.SUBRULE($.supportsAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType(T.AtNested), ALT: () => $.SUBRULE($.nestedAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType(T.AtNonNested), ALT: () => $.SUBRULE($.nonNestedAtRule, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.unknownAtRule, { ARGS: [ctx] }) }
  ]));

  return (ctx?: RuleContext) => $.OR(ruleAlt(ctx));
}

/**
  Inner rules are mostly the same except they have a declarationList
  instead of a main block within {}
*/
// innerAtRule
//   : innerMediaAtRule
//   | unknownAtRule
//   ;
export function innerAtRule(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  alt ??= (ctx: RuleContext = {}) => [
    { GATE: () => $.isType(T.AtContainer), ALT: () => $.SUBRULE($.containerAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType(T.AtScope), ALT: () => $.SUBRULE($.scopeAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType(T.AtDocument), ALT: () => $.SUBRULE($.documentAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType(T.AtLayer), ALT: () => $.SUBRULE($.layerAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType(T.AtKeyframes), ALT: () => $.SUBRULE($.keyframesAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType(T.AtMedia), ALT: () => $.SUBRULE($.mediaAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType(T.AtSupports), ALT: () => $.SUBRULE($.supportsAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType(T.AtNested), ALT: () => $.SUBRULE($.nestedAtRule, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.unknownAtRule, { ARGS: [ctx] }) }
  ];

  return (ctx: RuleContext = {}) => $.OR(alt({ ...ctx, inner: true }));
}

/**
 * @see https://www.w3.org/TR/css-nesting-1/#conditionals
 */
export function atRuleBody(this: C, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) =>
    $.OR([
      {
        GATE: () => !ctx.inner,
        ALT: () => $.SUBRULE($.main, { ARGS: [ctx] })
      },
      {
        GATE: () => !!ctx.inner,
        ALT: () => $.SUBRULE($.declarationList, { ARGS: [ctx] })
      }
    ]);
}

// mediaAtRule
//   : MEDIA_RULE WS* mediaQuery WS* LCURLY main RCURLY
//   ;
type PreludeRuleLocal = PreludeRule;

export function mediaAtRule(this: C, T: TokenMap, preludeRule?: PreludeRuleLocal) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let name = $.CONSUME(T.AtMedia);
    let rules: Rules;
    const resolvedPreludeRule = resolvePreludeRule($, preludeRule);
    const prelude: Node = resolvedPreludeRule
      ? $.SUBRULE(resolvedPreludeRule, { ARGS: [ctx] })
      : $.SUBRULE($.mediaQueryList, { ARGS: [ctx] });
    $.CONSUME(T.LCurly);
    rules = $.SUBRULE($.atRuleBody, { ARGS: [ctx] });
    $.CONSUME(T.RCurly);

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      return new AtRule({
        name: new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context),
        prelude: prelude,
        rules
      }, { nestable: true }, location, this.context);
    }
  };
}

export function mediaQueryList(this: C, T: TokenMap): ProductionRule {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let queries!: Node[];
    if (!RECORDING_PHASE) {
      queries = [];
    }
    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => {
        let query = $.SUBRULE($.mediaQuery, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          queries.push(query);
        }
      }
    });

    if (!RECORDING_PHASE) {
      if (queries!.length === 1) {
        $.endRule();
        return queries![0]!;
      }
      return new List(queries!, undefined, $.endRule(), this.context);
    }
  };
}

/**
 * @see https://w3c.github.io/csswg-drafts/mediaqueries/#mq-syntax
 * Note, some of the spec had to be re-written for less ambiguity.
 * However, this is a spec-compliant implementation.
 */
// mediaQuery
//   : mediaCondition
//   | ((NOT | ONLY) WS*)? mediaType (WS* AND WS* mediaConditionWithoutOr)?
//   ;
export function mediaQuery(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  alt ??= (ctx: RuleContext = {}) => [
    {
      GATE: () => $.startsMediaCondition(T),
      ALT: () => $.SUBRULE2($.mediaCondition, { ARGS: [ctx] })
    },
    {
      ALT: () => $.SUBRULE3($.mediaTypeQuery, { ARGS: [ctx] })
    }
  ];

  return (ctx: RuleContext = {}) => $.OR(alt(ctx));
}

export function mediaTypeQuery(this: C, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let token: IToken | undefined;
    let node: Node | undefined;
    let nodes: Node[];

    if (!RECORDING_PHASE) {
      nodes = [];
    }

    $.OPTION2(() => {
      $.OR([
        { ALT: () => token = $.CONSUME2(T.Not) },
        { ALT: () => token = $.CONSUME3(T.Only) }
      ]);
    });

    if (token && !RECORDING_PHASE) {
      nodes!.push(new Keyword(token.image, undefined, $.getLocationInfo(token), this.context));
      token = undefined;
    }

    const type = $.SUBRULE2($.mediaType, { ARGS: [ctx] });
    if (!RECORDING_PHASE) {
      nodes!.push(type);
    }

    $.OPTION3(() => {
      token = $.CONSUME(T.And);
      node = $.SUBRULE3($.mediaConditionWithoutOr, { ARGS: [ctx] });
    });

    if (!RECORDING_PHASE) {
      if (token) {
        nodes!.push(new Keyword(token.image, undefined, $.getLocationInfo(token), this.context));
      }
      if (node) {
        nodes!.push(node);
      }
      const location = $.endRule();
      return new QueryCondition(nodes!, undefined, location, this.context);
    }
  };
}

/** Doesn't include only, not, and, or, layer */
// mediaType
//   : IDENT
//   | SCREEN
//   | PRINT
//   | ALL
//   ;
export function mediaType(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.CONSUME(T.PlainIdent) },
    { ALT: () => $.CONSUME(T.Screen) },
    { ALT: () => $.CONSUME(T.Print) },
    { ALT: () => $.CONSUME(T.All) }
  ];

  return (ctx: RuleContext = {}) => {
    let token = $.OR(alt(ctx));
    if (!$.RECORDING_PHASE) {
      return new Keyword(token.image, undefined, $.getLocationInfo(token), this.context);
    }
  };
}

// mediaCondition
//   : mediaNot | mediaInParens ( WS* (mediaAnd* | mediaOr* ))
//   ;
export function mediaCondition(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.SUBRULE($.mediaNot, { ARGS: [ctx] }) },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        let node = $.SUBRULE($.mediaInParens, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          nodes!.push(node);
        }
        $.MANY({
          GATE: () => $.LA(1).tokenType === T.And,
          DEF: () => {
            let rule = $.SUBRULE($.mediaAnd, { ARGS: [ctx] });
            if (!RECORDING_PHASE) {
              nodes!.push(...rule);
            }
          }
        });
        $.MANY2({
          GATE: () => $.LA(1).tokenType === T.Or,
          DEF: () => {
            let rule = $.SUBRULE($.mediaOr, { ARGS: [ctx] });
            if (!RECORDING_PHASE) {
              nodes!.push(...rule);
            }
          }
        });
        if (!RECORDING_PHASE) {
          // Only wrap in QueryCondition if there are multiple nodes (AND/OR operators)
          // Otherwise, return the single node directly (like Sequence does)
          if (nodes!.length === 1) {
            $.endRule();
            return nodes![0]!;
          }
          return new QueryCondition(nodes!, undefined, $.endRule(), this.context);
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => $.OR(alt(ctx));
}

// mediaConditionWithoutOr
//   : mediaNot | mediaInParens (WS* mediaAnd)*
//   ;
export function mediaConditionWithoutOr(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.SUBRULE($.mediaNot, { ARGS: [ctx] }) },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        let node = $.SUBRULE($.mediaInParens, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          nodes!.push(node);
        }
        $.MANY(() => {
          let rule = $.SUBRULE($.mediaAnd, { ARGS: [ctx] });
          if (!RECORDING_PHASE) {
            nodes!.push(...rule);
          }
        });

        if (!RECORDING_PHASE) {
          // Only wrap in QueryCondition if there are multiple nodes (AND operators)
          // Otherwise, return the single node directly (like Sequence does)
          if (nodes!.length === 1) {
            $.endRule();
            return nodes![0]!;
          }
          return new QueryCondition(nodes!, undefined, $.endRule(), this.context);
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => $.OR(alt(ctx));
}

// mediaNot
//   : NOT WS* mediaInParens
//   ;
export function mediaNot(this: C, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();

    let token = $.CONSUME(T.Not);
    let node = $.SUBRULE($.mediaInParens, { ARGS: [ctx] });

    if (!$.RECORDING_PHASE) {
      return new QueryCondition([
        new Keyword(token.image, undefined, $.getLocationInfo(token), this.context),
        node
      ], undefined, $.endRule(), this.context);
    }
  };
}

// mediaAnd
//   : AND WS* mediaInParens
//   ;
export function mediaAnd(this: C, T: TokenMap) {
  const $ = this;

  /** Returns an array */
  return (ctx: RuleContext = {}) => {
    let token = $.CONSUME(T.And);
    let node = $.SUBRULE($.mediaInParens, { ARGS: [ctx] });

    if (!$.RECORDING_PHASE) {
      return [
        new Keyword(token.image, undefined, $.getLocationInfo(token), this.context),
        node
      ];
    }
  };
}

// mediaOr
//   : OR WS* mediaInParens
//   ;
export function mediaOr(this: C, T: TokenMap) {
  const $ = this;

  /** Returns an array */
  return (ctx: RuleContext = {}) => {
    let token = $.CONSUME(T.Or);
    let node = $.SUBRULE($.mediaInParens, { ARGS: [ctx] });

    if (!$.RECORDING_PHASE) {
      return [
        new Keyword(token.image, undefined, $.getLocationInfo(token), this.context),
        node
      ];
    }
  };
}

// mediaInParens
//   : '(' WS* (mediaCondition | mediaFeature) WS* ')'
//   | generalEnclosed
//   ;
export function mediaInParens(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  alt ??= (ctx: RuleContext = {}) => [
    {
      GATE: () => $.startsMediaCondition(T),
      ALT: () => $.SUBRULE($.mediaCondition, { ARGS: [ctx] })
    },
    { ALT: () => $.SUBRULE($.mediaFeature, { ARGS: [ctx] }) }
  ];

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.LParen);

    /*
     * CSS also allows for parentheses to contain
     * almost anything, including a wild sequence
     * of tokens (e.g. `@media (!!&) {}`), as it would
     * be up to the user agent to decide what the content
     * of the parentheses means. (CSS defines this as
     * "generalEnclosed" in the spec.)
     *
     * But that would mean that detecting errors in
     * parsing would not be possible. So we only parse
     * "known" media queries.
     */
    let node = $.OR2(alt(ctx));
    $.CONSUME(T.RParen);

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      return new Paren(node, undefined, location, this.context);
    }
  };
}

/**
    An identifier is a legal value, so it can be
    ambiguous which side of the expression we're on
    while parsing. The browser figures this out
    post-parsing.
  */
// mediaFeature
// : identifier (WS* (
//   COLON WS* mfValue
//   | mediaRange
//   | mfComparison WS* mfNonIdentifierValue
// ))?
// | mfNonIdentifierValue WS* (
//   mfComparison WS* identifier
//   | mediaRange
// )
// ;
export function mediaFeature(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  alt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        let rule: Node | undefined;
        let ident = $.CONSUME(T.Ident);
        $.OPTION(() => {
          rule = $.OR2([
            {
              ALT: () => {
                $.CONSUME(T.Colon);
                let value = $.SUBRULE($.mfValue, { ARGS: [ctx] });
                if (!RECORDING_PHASE) {
                  let location = $.endRule();
                  return new Declaration({
                    name: new Any(ident.image, { role: 'property' }),
                    value: value
                  }, undefined, location, this.context);
                }
              }
            },
            {
              /** mediaRange: MfLt/MfGt followed by Ident */
              GATE: () => ($.isTypeAt(1, T.MfLt) || $.isTypeAt(1, T.MfGt)) && $.isTypeAt(2, T.Ident),
              ALT: () => {
                let seq = $.SUBRULE($.mediaRange, { ARGS: [ctx] });

                if (!RECORDING_PHASE) {
                  let [startOffset, startLine, startColumn] = $.endRule();
                  seq.value.unshift(new Any(ident.image, { role: 'ident' }, $.getLocationInfo(ident), this.context));
                  seq.location[0] = startOffset;
                  seq.location[1] = startLine;
                  seq.location[2] = startColumn;
                  return new QueryCondition(seq.value, undefined, seq.location, this.context);
                }
                return seq;
              }
            },
            {
              /** mfComparison: MfLt/MfGt/Eq followed by non-identifier value */
              GATE: () => $.isTypeAt(1, T.MfLt) || $.isTypeAt(1, T.MfGt) || $.LA(1).tokenType === T.Eq,
              ALT: () => {
                let op = $.SUBRULE($.mfComparison, { ARGS: [ctx] });
                let value = $.SUBRULE($.mfNonIdentifierValue, { ARGS: [ctx] });

                if (!RECORDING_PHASE) {
                  let location = $.endRule();
                  return new QueryCondition([
                    new Any(ident.image, { role: 'ident' }, $.getLocationInfo(ident), this.context),
                    new Any(op.image, { role: 'operator' }, $.getLocationInfo(op), this.context),
                    value
                  ], undefined, location, this.context);
                }
              }
            }
          ]);
        });
        if (!RECORDING_PHASE && !rule) {
          let location = $.endRule();
          let anyNode = new Keyword(ident.image, undefined, location, this.context);
          return new QueryCondition([anyNode], undefined, location, this.context);
        }
        return rule;
      }
    },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        let rule1 = $.SUBRULE2($.mfNonIdentifierValue, { ARGS: [{ ...ctx }] });
        return $.OR3([
          {
            /** mfComparison + Ident: operator followed by ident (simple comparison, not a range) */
            GATE: () => {
              if (!(($.isTypeAt(1, T.MfLt) || $.isTypeAt(1, T.MfGt) || $.LA(1).tokenType === T.Eq) && $.isTypeAt(2, T.Ident))) {
                return false;
              }
              if ($.isTypeAt(3, T.MfLt) || $.isTypeAt(3, T.MfGt)) {
                return false;
              }
              return true;
            },
            ALT: () => {
              let op = $.SUBRULE2($.mfComparison, { ARGS: [{ ...ctx }] });
              let value = $.CONSUME2(T.Ident);
              if (!RECORDING_PHASE) {
                let location = $.endRule();
                return new QueryCondition([
                  rule1,
                  new Any(op.image, { role: 'operator' }, $.getLocationInfo(op), this.context),
                  new Any(value.image, { role: 'ident' }, $.getLocationInfo(value), this.context)
                ], undefined, location, this.context);
              }
            }
          },
          {
            /** mediaRange: operator followed by non-ident (range) */
            ALT: () => {
              let seq = $.SUBRULE2($.mediaRange, { ARGS: [{ ...ctx }] });
              if (!RECORDING_PHASE) {
                let [startOffset, startLine, startColumn] = $.endRule();
                seq.value.unshift(rule1);
                seq.location[0] = startOffset;
                seq.location[1] = startLine;
                seq.location[2] = startColumn;
                return new QueryCondition(seq.value, undefined, seq.location, this.context);
              }
              return seq;
            }
          }
        ]);
      }
    }
  ];

  return (ctx: RuleContext = {}) => $.OR(alt(ctx));
}

/**
 * @note Both comparison operators have to match.
 */
// mediaRange
//   : mfLt WS* identifier (WS* mfLt WS* mfValue)?
//   | mfGt WS* identifier (WS* mfGt WS* mfValue)?
//   ;
export function mediaRange(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  alt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        let op1 = $.CONSUME(T.MfLt);
        let val1 = $.CONSUME2(T.Ident);
        let op2: IToken | undefined;
        let val2: Node | undefined;
        $.OPTION2(() => {
          op2 = $.CONSUME3(T.MfLt);
          val2 = $.SUBRULE2($.mfValue, { ARGS: [ctx] });
        });
        return [op1, val1, op2, val2];
      }
    },
    {
      ALT: () => {
        let op1 = $.CONSUME4(T.MfGt);
        let val1 = $.CONSUME5(T.Ident);
        let op2: IToken | undefined;
        let val2: Node | undefined;
        $.OPTION3(() => {
          op2 = $.CONSUME6(T.MfGt);
          val2 = $.SUBRULE3($.mfValue, { ARGS: [ctx] });
        });
        return [op1, val1, op2, val2];
      }
    }
  ];

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let op1: IToken;
    let val1: IToken;
    let op2: IToken | undefined;
    let val2: Node | undefined;

    let val = $.OR(alt(ctx));

    if (!RECORDING_PHASE) {
      ([op1, val1, op2, val2] = val);
    }

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      let nodes: Node[] = [
        new Any(op1!.image, { role: 'operator' }, $.getLocationInfo(op1!), this.context),
        new Any(val1!.image, { role: 'ident' }, $.getLocationInfo(val1!), this.context)
      ];
      if (op2) {
        nodes.push(new Any(op2.image, { role: 'operator' }, $.getLocationInfo(op2), this.context));
        nodes.push(val2!);
      }
      return new Sequence(nodes, undefined, location, this.context);
    }
  };
}

// mfNonIdentifierValue
//   : number (WS* '/' WS* number)?
//   | dimension
//   ;
export function mfNonIdentifierValue(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  alt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        $.startRule();
        let num1 = $.CONSUME(T.Number);
        let num2: IToken | undefined;
        $.OPTION(() => {
          $.CONSUME(T.Slash);
          num2 = $.CONSUME2(T.Number);
        });
        if (!$.RECORDING_PHASE) {
          let location = $.endRule();
          let num1Node = $.processValueToken(num1);
          if (!num2) {
            return num1Node;
          }
          let num2Node = $.processValueToken(num2);
          return new List([num1Node, num2Node], { sep: '/' }, location, this.context);
        }
      }
    },
    {
      ALT: () => {
        let dim = $.CONSUME(T.Dimension);
        if (!$.RECORDING_PHASE) {
          return $.processValueToken(dim);
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => $.OR(alt(ctx));
}

// mfValue
//   : mfNonIdentifierValue | identifier
//   ;
export function mfValue(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;

  alt ??= (ctx: RuleContext = {}) => [
    { ALT: () => $.SUBRULE($.mfNonIdentifierValue, { ARGS: [ctx] }) },
    {
      ALT: () => {
        let token = $.CONSUME(T.Ident);
        if (!$.RECORDING_PHASE) {
          return new Any(token.image, { role: 'ident' }, $.getLocationInfo(token), this.context);
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => $.OR(alt(ctx));
}

// mfComparison
//   : mfLt | mfGt | mfEq
//   ;
export function mfComparison(this: C, T: TokenMap) {
  const $ = this;

  let comparisonAlt = [
    { ALT: () => $.CONSUME(T.MfLt) },
    { ALT: () => $.CONSUME(T.MfGt) },
    { ALT: () => $.CONSUME(T.Eq) }
  ];

  return () => $.OR(comparisonAlt);
}

/**
 * @see https://www.w3.org/TR/css-page-3/
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@page
 */
export function pageAtRule(this: C, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();

    let name = $.CONSUME(T.AtPage);
    let selector: Node[] = [];
    $.MANY_SEP({
      SEP: T.Comma,
      DEF: () => selector.push($.SUBRULE($.pageSelector, { ARGS: [ctx] }))
    });
    $.CONSUME(T.LCurly);
    let rules = $.SUBRULE($.declarationList, { ARGS: [ctx] });
    $.CONSUME(T.RCurly);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      return new AtRule({
        name: new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context),
        prelude: selector.length ? new List(selector, undefined, $.getLocationFromNodes(selector), this.context) : undefined,
        rules
      }, undefined, location, this.context);
    }
  };
}

export function pageSelector(this: C, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();
    let token = '';

    $.OPTION(() => token += $.CONSUME(T.Ident).image);
    $.MANY({
      GATE: () => $.LA(1).tokenType === T.Colon && $.noSep(1),
      DEF: () => {
        token += $.CONSUME(T.Colon).image;
        token += $.CONSUME(T.PagePseudoClassKeywords).image;
      }
    });

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      return new BasicSelector(token, undefined, location, this.context);
    }
  };
}

// fontFaceAtRule
//   : FONT_FACE_RULE WS* LCURLY declarationList RCURLY
//   ;
export function fontFaceAtRule(this: C, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();

    let name = $.CONSUME(T.AtFontFace);
    $.CONSUME(T.LCurly);
    let rules = $.SUBRULE($.declarationList, { ARGS: [ctx] });
    $.CONSUME(T.RCurly);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      return new AtRule({
        name: new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context),
        rules
      }, undefined, location, this.context);
    }
  };
}

// keyframesAtRule
//   : (AT_KEYFRAMES | vendorKeyframes) WS* IDENT WS* '{' keyframeBlock* '}'
//   ;
export function keyframesAtRule(this: C, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let atTok = $.CONSUME(T.AtKeyframes);
    // prelude: a single animation name
    let preludeNode: Node | undefined = $.SUBRULE($.keyframesName, { ARGS: [ctx] });
    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.declarationList, { ARGS: [ctx] });
    $.CONSUME(T.RCurly);

    if (!$.RECORDING_PHASE) {
      return new AtRule({
        name: new Any(atTok.image, { role: 'atkeyword' }, $.getLocationInfo(atTok), this.context),
        prelude: preludeNode ? preludeNode : undefined,
        // Include isolated comments inside the keyframes body
        rules
      }, undefined, $.endRule(), this.context);
    }
  };
}

/**
 * Keyframes name prelude
 * CSS: Ident | String
 */
export function keyframesName(this: C, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    let node: Node | undefined;
    $.OR({
      DEF: [
        { ALT: () => {
          const tok = $.CONSUME(T.Ident);
          if (!RECORDING_PHASE) {
            node = $.processValueToken(tok);
          }
        } },
        { ALT: () => node = $.SUBRULE($.string, { ARGS: [ctx] }) }
      ]
    });
    return node!;
  };
}

// containerAtRule: @container <container-name>? <container-query-list> { main }
/**
 * Parses @container at-rule with optional container name and container query list.
 *
 * WHAT I'M TRYING TO DO:
 * Disambiguate between:
 * 1. `@container sidebar (width > 400px)` - `sidebar` is a container name
 * 2. `@container size(min-width: 60ch)` - `size` is NOT a container name, it's a function call (FunctionStart token)
 * 3. `@container (width > 400px)` - no container name, query starts directly
 *
 * Strategy:
 * - If next token is FunctionStart (like `size(` or `style(`), it's a query function, NOT a container name
 * - If next token is Ident (not a query keyword), it COULD be a container name
 * - The containerQueryList production will handle parsing the actual query (whether it's a function or condition)
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container
 */
export function containerAtRule(this: C, T: TokenMap, preludeRule?: PreludeRule) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    const name = $.CONSUME(T.AtContainer);
    let prelude: Node | undefined;
    let containerName: Node | undefined;
    let queryList: Node | undefined;

    if (preludeRule) {
      const resolvedPreludeRule = resolvePreludeRule($, preludeRule);
      if (resolvedPreludeRule) {
        prelude = $.SUBRULE(resolvedPreludeRule, { ARGS: [ctx] });
      }
    } else {
      $.OR([
        {
          GATE: () => {
            const next = $.LA(1);
            // If it's a FunctionStart (like `size(` or `style(`), it's a query function, not a container name
            if (tokenMatcher(next, T.FunctionStart)) {
              return false;
            }
            // If it's an Ident (not a query keyword), it could be a container name
            return tokenMatcher(next, T.Ident)
              && next.image.toLowerCase() !== 'not'
              && next.image.toLowerCase() !== 'only'
              && next.image.toLowerCase() !== 'and'
              && next.image.toLowerCase() !== 'or';
          },
          ALT: () => {
            containerName = $.SUBRULE($.containerName, { ARGS: [ctx] });
            queryList = $.SUBRULE($.containerQueryList, { ARGS: [ctx] });
          }
        },
        {
          ALT: () => {
            queryList = $.SUBRULE2($.containerQueryList, { ARGS: [ctx] });
          }
        }
      ]);

      queryList = queryList!;
    }

    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [ctx] });
    $.CONSUME(T.RCurly);

    if (!$.RECORDING_PHASE) {
      let preludeNodes: Node[] = [];
      if (!prelude && containerName) {
        preludeNodes.push(containerName);
      }
      if (!prelude) {
        preludeNodes.push(queryList!);
        prelude = preludeNodes.length
          ? new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), this.context)
          : undefined;
      }
      return new AtRule({
        name: new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context),
        prelude,
        rules
      }, { nestable: true }, $.endRule(), this.context);
    }
  };
}

/**
 * Container name: an optional identifier
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-name
 */
export function containerName(this: C, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let token = $.CONSUME(T.Ident);
    if (!$.RECORDING_PHASE) {
      return new Any(token.image, { role: 'ident' }, $.getLocationInfo(token), this.context);
    }
  };
}

/**
 * Container query list: comma-separated list of container queries
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-query
 */
export function containerQueryList(this: C, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let queries!: Node[];
    if (!RECORDING_PHASE) {
      queries = [];
    }
    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => {
        let query = $.SUBRULE($.containerQuery, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          queries.push(query);
        }
      }
    });

    if (!RECORDING_PHASE) {
      if (queries!.length === 1) {
        $.endRule();
        return queries![0]!;
      }
      return new List(queries!, undefined, $.endRule(), this.context);
    }
  };
}

/**
 * Container query: a container condition or container query type function
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-query
 *
 * Container queries can be:
 * - Regular conditions: (width > 400px)
 * - Container query type functions: size(min-width: 60ch), style(--responsive: true), scroll-state(stuck: top)
 */
export function containerQuery(this: C, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    return $.OR([
      {
        // Container query type function: any FunctionStart token
        // This allows for size(...), style(...), scroll-state(...), and any Less-evaluated functions
        GATE: () => $.isTypeAt(1, T.FunctionStart),
        ALT: () => {
          $.startRule();
          let nodes: Node[];
          if (!$.RECORDING_PHASE) {
            nodes = [];
          }

          // Parse first function call
          const funcStart = $.CONSUME(T.FunctionStart);
          const funcName = funcStart.image.slice(0, -1);
          let args!: Node[];
          if (!$.RECORDING_PHASE) {
            args = [];
          }
          $.AT_LEAST_ONE_SEP({
            SEP: T.Comma,
            DEF: () => {
              // Arguments can be QueryConditions, declarations, or just a name (Any)
              $.OR2([
                {
                  // QueryCondition: starts with LParen or Not
                  GATE: () => {
                    const next = $.LA(1);
                    return next.tokenType === T.LParen || next.tokenType === T.Not;
                  },
                  ALT: () => {
                    const arg = $.SUBRULE2($.containerCondition, { ARGS: [ctx] });
                    if (!$.RECORDING_PHASE) {
                      args!.push(arg);
                    }
                  }
                },
                {
                  // Declaration: starts with Ident or CustomProperty followed by Assign (colon)
                  GATE: () => {
                    const next = $.LA(1);
                    const after = $.LA(2);
                    const isIdent = tokenMatcher(next, T.Ident) || next.tokenType === T.CustomProperty;
                    return isIdent && after && tokenMatcher(after, T.Assign);
                  },
                  ALT: () => {
                    const arg = $.SUBRULE($.declaration, { ARGS: [ctx] });
                    if (!$.RECORDING_PHASE) {
                      args!.push(arg);
                    }
                  }
                },
                {
                  // Just a name (Any): Ident or CustomProperty without Assign
                  GATE: () => {
                    const next = $.LA(1);
                    const after = $.LA(2);
                    const isIdent = tokenMatcher(next, T.Ident) || next.tokenType === T.CustomProperty;
                    return isIdent && (!after || !tokenMatcher(after, T.Assign));
                  },
                  ALT: () => {
                    let nameToken: IToken | undefined;
                    $.OR3([
                      { ALT: () => nameToken = $.CONSUME(T.Ident) },
                      { ALT: () => nameToken = $.CONSUME(T.CustomProperty) }
                    ]);
                    if (!$.RECORDING_PHASE && nameToken) {
                      const nameNode = new Any(nameToken.image, { role: 'name' }, $.getLocationInfo(nameToken), this.context);
                      args!.push(nameNode);
                    }
                  }
                }
              ]);
            }
          });
          $.CONSUME(T.RParen);

          if (!$.RECORDING_PHASE) {
            const call = new Call({
              name: funcName,
              args: args!.length > 0 ? new List(args!) : undefined
            }, undefined, $.getLocationFromNodes([funcStart]), this.context);
            nodes!.push(call);
          }

          // Check for and/or after the function call (similar to mediaCondition)
          $.MANY({
            GATE: () => $.LA(1).tokenType === T.And,
            DEF: () => {
              let rule = $.SUBRULE($.containerAnd, { ARGS: [ctx] });
              if (!$.RECORDING_PHASE) {
                nodes!.push(...rule);
              }
            }
          });
          $.MANY2({
            GATE: () => $.LA(1).tokenType === T.Or,
            DEF: () => {
              let rule = $.SUBRULE($.containerOr, { ARGS: [ctx] });
              if (!$.RECORDING_PHASE) {
                nodes!.push(...rule);
              }
            }
          });

          if (!$.RECORDING_PHASE) {
            const location = $.endRule();
            // Always wrap function calls in QueryCondition (even if alone)
            return new QueryCondition(nodes!, undefined, location, this.context);
          }
        }
      },
      {
        // Regular container condition
        ALT: () => $.SUBRULE($.containerCondition, { ARGS: [ctx] })
      }
    ]);
  };
}

/**
 * Container condition: similar to media condition but without mediaType variant
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-query
 *
 * Container conditions can also have `not` followed by a container query type function,
 * and `and`/`or` can be followed by `not`, which media queries don't support.
 */
export function containerCondition(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    return $.OR([
      {
        // Handle `not` followed by a container query type function (e.g., `not scroll-state(...)`)
        GATE: () => {
          const next = $.LA(1);
          if (next.tokenType === T.Not) {
            const afterNot = $.LA(2);
            return afterNot && tokenMatcher(afterNot, T.FunctionStart);
          }
          return false;
        },
        ALT: () => {
          $.startRule();
          const notToken = $.CONSUME(T.Not);
          // Parse the function call as a container query
          const funcQuery = $.SUBRULE($.containerQuery, { ARGS: [ctx] });
          if (!$.RECORDING_PHASE) {
            return new QueryCondition([
              new Keyword(notToken.image, undefined, $.getLocationInfo(notToken), this.context),
              funcQuery
            ], undefined, $.endRule(), this.context);
          }
        }
      },
      {
        // Custom container condition that handles `and not` and `or not`
        // Always use container path for LParen (containerInParens handles the same as mediaInParens,
        // but containerAnd/containerOr can handle container-specific cases)
        GATE: () => {
          const next = $.LA(1);
          return next.tokenType === T.LParen;
        },
        ALT: () => {
          let RECORDING_PHASE = $.RECORDING_PHASE;
          $.startRule();
          let nodes: Node[];
          if (!RECORDING_PHASE) {
            nodes = [];
          }
          let node = $.SUBRULE($.containerInParens, { ARGS: [ctx] });
          if (!RECORDING_PHASE) {
            nodes!.push(node);
          }
          $.MANY({
            GATE: () => $.LA(1).tokenType === T.And,
            DEF: () => {
              let rule = $.SUBRULE($.containerAnd, { ARGS: [ctx] });
              if (!RECORDING_PHASE) {
                nodes!.push(...rule);
              }
            }
          });
          $.MANY2({
            GATE: () => $.LA(1).tokenType === T.Or,
            DEF: () => {
              let rule = $.SUBRULE($.containerOr, { ARGS: [ctx] });
              if (!RECORDING_PHASE) {
                nodes!.push(...rule);
              }
            }
          });
          if (!RECORDING_PHASE) {
            if (nodes!.length === 1) {
              $.endRule();
              return nodes![0]!;
            }
            return new QueryCondition(nodes!, undefined, $.endRule(), this.context);
          }
        }
      },
      {
        // For cases not starting with LParen (like `not` at start), reuse media condition logic
        GATE: () => {
          const next = $.LA(1);
          // Only use mediaCondition if it doesn't start with LParen (LParen case handled above)
          return next.tokenType !== T.LParen;
        },
        ALT: () => $.SUBRULE3($.mediaCondition, { ARGS: [ctx] })
      }
    ]);
  };
}

/**
 * Container and: similar to mediaAnd but can handle `and not` and function calls
 */
export function containerAnd(this: C, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let token = $.CONSUME(T.And);
    // Handle `and not` or `and` followed by containerInParens or function call
    let node: Node | undefined;
    $.OR3([
      {
        GATE: () => $.LA(1).tokenType === T.Not,
        ALT: () => {
          const notToken = $.CONSUME(T.Not);
          node = $.SUBRULE($.containerInParens, { ARGS: [ctx] });
          if (!$.RECORDING_PHASE) {
            const notNode = new Keyword(notToken.image, undefined, $.getLocationInfo(notToken), this.context);
            node = new QueryCondition([notNode, node!], undefined, $.getLocationFromNodes([notNode, node!]), this.context);
          }
        }
      },
      {
        GATE: () => $.isTypeAt(1, T.FunctionStart),
        ALT: () => {
          // Parse function call (reuse containerQuery logic)
          const funcStart = $.CONSUME(T.FunctionStart);
          const funcName = funcStart.image.slice(0, -1);
          let args!: Node[];
          if (!$.RECORDING_PHASE) {
            args = [];
          }
          $.AT_LEAST_ONE_SEP({
            SEP: T.Comma,
            DEF: () => {
              $.OR2([
                {
                  GATE: () => {
                    const next = $.LA(1);
                    return next.tokenType === T.LParen || next.tokenType === T.Not;
                  },
                  ALT: () => {
                    const arg = $.SUBRULE2($.containerCondition, { ARGS: [ctx] });
                    if (!$.RECORDING_PHASE) {
                      args!.push(arg);
                    }
                  }
                },
                {
                  GATE: () => {
                    const next = $.LA(1);
                    const after = $.LA(2);
                    const isIdent = tokenMatcher(next, T.Ident) || next.tokenType === T.CustomProperty;
                    return isIdent && after && tokenMatcher(after, T.Assign);
                  },
                  ALT: () => {
                    const arg = $.SUBRULE($.declaration, { ARGS: [ctx] });
                    if (!$.RECORDING_PHASE) {
                      args!.push(arg);
                    }
                  }
                },
                {
                  GATE: () => {
                    const next = $.LA(1);
                    const after = $.LA(2);
                    const isIdent = tokenMatcher(next, T.Ident) || next.tokenType === T.CustomProperty;
                    return isIdent && (!after || !tokenMatcher(after, T.Assign));
                  },
                  ALT: () => {
                    let nameToken: IToken | undefined;
                    $.OR7([
                      { ALT: () => nameToken = $.CONSUME(T.Ident) },
                      { ALT: () => nameToken = $.CONSUME(T.CustomProperty) }
                    ]);
                    if (!$.RECORDING_PHASE && nameToken) {
                      const nameNode = new Any(nameToken.image, { role: 'name' }, $.getLocationInfo(nameToken), this.context);
                      args!.push(nameNode);
                    }
                  }
                }
              ]);
            }
          });
          $.CONSUME(T.RParen);
          if (!$.RECORDING_PHASE) {
            node = new Call({
              name: funcName,
              args: args!.length > 0 ? new List(args!) : undefined
            }, undefined, $.getLocationFromNodes([funcStart]), this.context);
          }
        }
      },
      {
        ALT: () => {
          node = $.SUBRULE2($.containerInParens, { ARGS: [ctx] });
        }
      }
    ]);
    if (!$.RECORDING_PHASE && node) {
      return [
        new Keyword(token.image, undefined, $.getLocationInfo(token), this.context),
        node
      ];
    }
  };
}

/**
 * Container or: similar to mediaOr but can handle `or not` and function calls
 */
export function containerOr(this: C, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let token = $.CONSUME(T.Or);
    // Handle `or not` or `or` followed by containerInParens or function call
    let node: Node | undefined;
    $.OR3([
      {
        GATE: () => $.LA(1).tokenType === T.Not,
        ALT: () => {
          const notToken = $.CONSUME(T.Not);
          node = $.SUBRULE($.containerInParens, { ARGS: [ctx] });
          if (!$.RECORDING_PHASE) {
            const notNode = new Keyword(notToken.image, undefined, $.getLocationInfo(notToken), this.context);
            node = new QueryCondition([notNode, node!], undefined, $.getLocationFromNodes([notNode, node!]), this.context);
          }
        }
      },
      {
        GATE: () => $.isTypeAt(1, T.FunctionStart),
        ALT: () => {
          // Parse function call (reuse containerQuery logic)
          const funcStart = $.CONSUME(T.FunctionStart);
          const funcName = funcStart.image.slice(0, -1);
          let args!: Node[];
          if (!$.RECORDING_PHASE) {
            args = [];
          }
          $.AT_LEAST_ONE_SEP({
            SEP: T.Comma,
            DEF: () => {
              $.OR2([
                {
                  GATE: () => {
                    const next = $.LA(1);
                    return next.tokenType === T.LParen || next.tokenType === T.Not;
                  },
                  ALT: () => {
                    const arg = $.SUBRULE2($.containerCondition, { ARGS: [ctx] });
                    if (!$.RECORDING_PHASE) {
                      args!.push(arg);
                    }
                  }
                },
                {
                  GATE: () => {
                    const next = $.LA(1);
                    const after = $.LA(2);
                    const isIdent = tokenMatcher(next, T.Ident) || next.tokenType === T.CustomProperty;
                    return isIdent && after && tokenMatcher(after, T.Assign);
                  },
                  ALT: () => {
                    const arg = $.SUBRULE($.declaration, { ARGS: [ctx] });
                    if (!$.RECORDING_PHASE) {
                      args!.push(arg);
                    }
                  }
                },
                {
                  GATE: () => {
                    const next = $.LA(1);
                    const after = $.LA(2);
                    const isIdent = tokenMatcher(next, T.Ident) || next.tokenType === T.CustomProperty;
                    return isIdent && (!after || !tokenMatcher(after, T.Assign));
                  },
                  ALT: () => {
                    let nameToken: IToken | undefined;
                    $.OR9([
                      { ALT: () => nameToken = $.CONSUME(T.Ident) },
                      { ALT: () => nameToken = $.CONSUME(T.CustomProperty) }
                    ]);
                    if (!$.RECORDING_PHASE && nameToken) {
                      const nameNode = new Any(nameToken.image, { role: 'name' }, $.getLocationInfo(nameToken), this.context);
                      args!.push(nameNode);
                    }
                  }
                }
              ]);
            }
          });
          $.CONSUME(T.RParen);
          if (!$.RECORDING_PHASE) {
            node = new Call({
              name: funcName,
              args: args!.length > 0 ? new List(args!) : undefined
            }, undefined, $.getLocationFromNodes([funcStart]), this.context);
          }
        }
      },
      {
        ALT: () => {
          node = $.SUBRULE2($.containerInParens, { ARGS: [ctx] });
        }
      }
    ]);
    if (!$.RECORDING_PHASE && node) {
      return [
        new Keyword(token.image, undefined, $.getLocationInfo(token), this.context),
        node
      ];
    }
  };
}

/**
 * Container in parens: similar to media in parens
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-query
 */
export function containerInParens(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;
  // Reuse media in parens logic since container queries use the same syntax
  return (ctx: RuleContext = {}) => {
    return $.SUBRULE($.mediaInParens, { ARGS: [ctx] });
  };
}

/**
 * Container feature: similar to media feature
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-query
 */
export function containerFeature(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;
  // Reuse media feature logic since container queries use the same syntax
  return (ctx: RuleContext = {}) => {
    return $.SUBRULE($.mediaFeature, { ARGS: [ctx] });
  };
}

// scopeAtRule: @scope <prelude>? { main }
export function scopeAtRule(this: C, T: TokenMap, preludeRule?: PreludeRule) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    const name = $.CONSUME(T.AtScope);
    let prelude: Node | undefined;
    if (preludeRule) {
      const resolvedPreludeRule = resolvePreludeRule($, preludeRule);
      if (resolvedPreludeRule) {
        prelude = $.SUBRULE(resolvedPreludeRule, { ARGS: [ctx] });
      }
    } else {
      const preludeNodes: Node[] = [];
      $.MANY(() => preludeNodes.push($.SUBRULE($.anyOuterValue, { ARGS: [ctx] })));
      if (!$.RECORDING_PHASE) {
        prelude = preludeNodes.length
          ? new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), this.context)
          : undefined;
      }
    }
    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [ctx] });
    $.CONSUME(T.RCurly);
    if (!$.RECORDING_PHASE) {
      return new AtRule({
        name: new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context),
        prelude,
        rules
      }, { nestable: true }, $.endRule(), this.context);
    }
  };
}

// documentAtRule (non-standard): @document <prelude>? { main }
export function documentAtRule(this: C, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    const name = $.CONSUME(T.AtDocument);
    const preludeNodes: Node[] = [];
    $.MANY(() => preludeNodes.push($.SUBRULE($.anyOuterValue, { ARGS: [ctx] })));
    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [ctx] });
    $.CONSUME(T.RCurly);
    if (!$.RECORDING_PHASE) {
      return new AtRule({
        name: new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context),
        prelude: preludeNodes.length ? new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), this.context) : undefined,
        rules
      }, undefined, $.endRule(), this.context);
    }
  };
}
