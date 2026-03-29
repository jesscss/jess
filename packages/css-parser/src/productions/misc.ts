// Methods to be mixed into CssRecursiveParser
import type { IToken } from '@chevrotain/types';
import type { CssRecursiveParser, RuleContext, TokenMap } from '../cssRecursiveParser.js';
import { EMPTY_ALT } from 'chevrotain';
import {
  type LocationInfo,
  Node, Any, AtRule, Rules, Sequence, List,
  QueryCondition, Keyword, Paren, Call, Block, RawRules,
  Url
} from '@jesscss/core';
import type { AltContext } from './atRules.js';

type C = CssRecursiveParser;

/**
 * `@layer` at rule
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@layer
 *
 * `@layer` =
 * `@layer` <layer-name>? { <rule-list> }  |
 * `@layer` <layer-name># ;
 *
 * `<layer-name>` =
 * <ident> [ '.' <ident> ]*
 */
export function layerAtRule(this: C, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    const atTok = $.CONSUME(T.AtLayer);

    // Parse now, structure later:
    // Parse optional first layer-name, then decide block vs statement
    // based on what follows (LCurly → block, Comma/Semi → statement)
    const preludeNodes: Node[] = RECORDING_PHASE ? ([] as unknown as Node[]) : [];

    // Parse optional first layer name
    $.OPTION(() => {
      const nameNode: Node = $.SUBRULE($.layerName, { ARGS: [ctx] });
      if (!RECORDING_PHASE) {
        preludeNodes.push($.wrap(nameNode));
      }
    });

    return $.OR([
      {
        /** Block form: @layer name? { ... } */
        GATE: () => $.LA(1).tokenType === T.LCurly,
        ALT: () => {
          $.CONSUME(T.LCurly);
          const rules = $.SUBRULE($.atRuleBody, { ARGS: [ctx] });
          $.CONSUME(T.RCurly);
          if (!RECORDING_PHASE) {
            return new AtRule({
              name: $.wrap(new Any(atTok.image, { role: 'atkeyword' }, $.getLocationInfo(atTok), this.context), true),
              prelude: preludeNodes.length ? $.wrap(new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), this.context), 'both') : undefined,
              rules
            }, { nestable: true }, $.endRule(), this.context);
          }
        }
      },
      {
        /** Statement form: @layer name (, name)* ; */
        ALT: () => {
          $.MANY(() => {
            $.CONSUME(T.Comma);
            let nameNode: Node = $.SUBRULE2($.layerName, { ARGS: [ctx] });
            if (!RECORDING_PHASE) {
              preludeNodes.push($.wrap(nameNode));
            }
          });
          $.CONSUME(T.Semi);
          if (!RECORDING_PHASE) {
            return new AtRule({
              name: $.wrap(new Any(atTok.image, { role: 'atkeyword' }, $.getLocationInfo(atTok), this.context), true),
              prelude: preludeNodes.length ? $.wrap(new List(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), this.context), 'both') : undefined
            }, undefined, $.endRule(), this.context);
          }
        }
      }
    ]);
  };
}

/**
 * <layer-name> = <ident> ('.' <ident>)*
 */
export function layerName(this: C, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    const nodes: Node[] = RECORDING_PHASE ? ([] as unknown as Node[]) : [];

    const first = $.CONSUME(T.Ident);
    if (!RECORDING_PHASE) {
      nodes.push($.wrap($.processValueToken(first)));
    }

    $.MANY({
      GATE: $.noSep,
      DEF: () => {
        const seg = $.CONSUME(T.DotName);
        if (!RECORDING_PHASE) {
          nodes.push($.wrap($.processValueToken(seg)));
        }
      }
    });

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      return new Sequence(nodes, undefined, loc, this.context);
    }
  };
}

/**
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@supports
 */
export function supportsAtRule(this: C, T: TokenMap, preludeRule?: any) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();

    let name = $.CONSUME(T.AtSupports);
    const resolvedPreludeRule = typeof preludeRule === 'string'
      ? ($ as unknown as Record<string, unknown>)[preludeRule]
      : preludeRule;
    const prelude: Node = typeof resolvedPreludeRule === 'function'
      ? $.SUBRULE(resolvedPreludeRule as any, { ARGS: [ctx] })
      : $.SUBRULE($.supportsCondition, { ARGS: [ctx] });
    $.CONSUME(T.LCurly);
    let rules = $.SUBRULE($.atRuleBody, { ARGS: [ctx] });
    $.CONSUME(T.RCurly);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      return new AtRule({
        name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context), true),
        prelude: $.wrap(prelude, 'both'),
        rules
      }, { nestable: true }, location, this.context);
    }
  };
}

/** spec-compliant but simplified */
export function supportsCondition(this: C, T: TokenMap) {
  const $ = this;

  let conditionAlt = (ctx: RuleContext = {}) => [
    {
      GATE: () => $.LA(1).tokenType === T.Not,
      ALT: () => {
        $.startRule();
        let keyword = $.CONSUME2(T.Not);
        let value = $.SUBRULE2($.supportsInParens, { ARGS: [ctx] });

        if (!$.RECORDING_PHASE) {
          let location = $.endRule();
          return new QueryCondition([
            $.wrap(new Keyword(keyword.image, undefined, $.getLocationInfo(keyword), this.context)),
            value
          ], undefined, location, this.context);
        }
      }
    },
    {
      GATE: () => $.LA(1).tokenType !== T.Not,
      ALT: () => {
        let start = $.startRule();
        let RECORDING_PHASE = $.RECORDING_PHASE;
        let [startOffset, startLine, startColumn] = start ?? [];

        let left = $.SUBRULE3($.supportsInParens, { ARGS: [ctx] });

        /**
         * Can be followed by many ands or many ors
         */
        $.OR2([
          {
            ALT: () => {
              $.AT_LEAST_ONE2(() => {
                let keyword = $.CONSUME3(T.And);
                let right: Node = $.SUBRULE4($.supportsInParens, { ARGS: [ctx] });
                if (!RECORDING_PHASE) {
                  let [,,,endOffset, endLine, endColumn] = right.location;
                  left = new QueryCondition([
                    left,
                    $.wrap(new Keyword(keyword.image, undefined, $.getLocationInfo(keyword), this.context)),
                    right
                  ], undefined, [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!], this.context);
                }
              });
            }
          },
          {
            ALT: () => {
              $.AT_LEAST_ONE3(() => {
                let keyword = $.CONSUME4(T.Or);
                let right: Node = $.SUBRULE5($.supportsInParens, { ARGS: [ctx] });
                if (!RECORDING_PHASE) {
                  let [,,,endOffset, endLine, endColumn] = right.location;
                  left = new QueryCondition([
                    left,
                    $.wrap(new Keyword(keyword.image, undefined, $.getLocationInfo(keyword), this.context)),
                    right
                  ], undefined, [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!], this.context);
                }
              });
            }
          },
          {
            ALT: EMPTY_ALT()
          }
        ]);

        if (!RECORDING_PHASE) {
          $.endRule();
        }

        return left;
      }
    }
  ];

  return (ctx: RuleContext = {}) => $.OR(conditionAlt(ctx));
}

export function supportsInParens(this: C, T: TokenMap) {
  const $ = this;

  let conditionAlt = (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        $.startRule();
        /** Function-like call */
        let name = $.CONSUME(T.Ident);
        let args: List | undefined;
        $.OR2([
          {
            GATE: $.noSep,
            ALT: () => {
              $.CONSUME2(T.LParen);
              args = $.SUBRULE2($.valueList, { ARGS: [ctx] });
              $.CONSUME3(T.RParen);
            }
          }
        ]);

        if (!$.RECORDING_PHASE) {
          let location = $.endRule();
          return new Call({
            name: name.image,
            args
          }, undefined, location, this.context);
        }
      }
    },
    {
      ALT: () => {
        $.startRule();
        let values: Node[] = [];
        $.CONSUME4(T.LParen);
        /**
         * Intentionally omits "generalEnclosed" from spec.
         * See the note on media queries.
         */
        let value = $.OR3([
          {
            /**
             * supportsCondition starts with Not or (
             * or Ident followed by ( (function-like supportsInParens)
             */
            GATE: () => {
              let t1 = $.LA(1).tokenType;
              if (t1 === T.Not || t1 === T.LParen) {
                return true;
              }
              // Ident followed by ( is a function-like call in supportsInParens
              if ($.isTypeAt(1, T.Ident) && $.isTypeAt(2, T.LParen)) {
                return true;
              }
              return false;
            },
            ALT: () => $.SUBRULE3($.supportsCondition, { ARGS: [ctx] })
          },
          {
            /** declaration: Ident/CustomProperty followed by Colon */
            ALT: () => $.SUBRULE4($.declaration, { ARGS: [ctx] })
          }
        ]);
        $.CONSUME5(T.RParen);

        if (!$.RECORDING_PHASE) {
          let location = $.endRule();
          if (!(value instanceof Node)) {
            value = new Sequence(values, undefined, $.getLocationFromNodes(values), this.context);
          }
          return $.wrap(new Paren($.wrap(value, 'both'), undefined, location, this.context));
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => $.OR(conditionAlt(ctx) as Array<import('@chevrotain/types').IOrAlt<any>>);
}

/** Used within anyOuterValue  */
export function functionCallLike(this: C, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    const name = $.CONSUME(T.FunctionStart);
    let args: Node[] = !RECORDING_PHASE ? [] : undefined as unknown as Node[];
    let seq: Sequence | undefined;
    $.MANY({
      GATE: () => {
        let tt = $.LA(1).tokenType;
        return tt !== T.RParen && tt !== T.UrlEnd;
      },
      DEF: () => {
        const node = $.SUBRULE($.anyOuterValue, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          args.push($.wrap(node));
        }
      }
    });
    if (!RECORDING_PHASE) {
      let location = args.length ? $.getLocationFromNodes(args) : undefined;
      if (args.length) {
        seq = new Sequence(args, undefined, location, this.context);
      }
    }
    $.OR([
      { ALT: () => $.CONSUME(T.RParen) },
      { ALT: () => $.CONSUME(T.UrlEnd) }
    ]);
    if (!RECORDING_PHASE) {
      const location = $.endRule();
      return $.wrap(new Call({ name: name.image.slice(0, -1), args: new List(seq ? [seq] : []) }, undefined, location, this.context));
    }
  };
}

export function functionCall(this: C, T: TokenMap, alt?: AltContext) {
  const $ = this;
  const modernColorFunctions = new Set(['rgb', 'rgba', 'hsl', 'hsla']);
  const isModernColorCall = (name: string, args?: List<Node>) => {
    if (!modernColorFunctions.has(name.toLowerCase())) {
      return false;
    }
    const argsValue = args?.get('value');
    if (!argsValue || argsValue.length !== 1) {
      return false;
    }
    const firstArg = argsValue[0];
    return Boolean(firstArg instanceof Sequence && firstArg.get('value').length >= 2);
  };

  alt ??= (ctx: RuleContext = {}) => [
    {
      GATE: () => $.isTypeAt(1, T.FunctionStart) && $.LA(1).image.slice(0, -1).toLowerCase() === 'if',
      ALT: () => $.SUBRULE($.ifFunction, { ARGS: [ctx] })
    },
    {
      // Disambiguate known functions by their dedicated tokens
      GATE: () => {
        let tokenType = $.LA(1).tokenType;
        return tokenType === T.UrlStart
          || tokenType === T.Var
          || tokenType === T.Calc;
      },
      ALT: () => $.SUBRULE($.knownFunctions, { ARGS: [ctx] })
    },
    {
      GATE: () => {
        let tokenType = $.LA(1).tokenType;
        return tokenType !== T.UrlStart
          && tokenType !== T.Var
          && tokenType !== T.Calc;
      },
      ALT: () => {
        $.startRule();

        let name = $.CONSUME(T.FunctionStart);
        let args: List<Node> | undefined;

        $.OPTION(() => args = $.SUBRULE($.functionCallArgs, { ARGS: [ctx] }));
        $.CONSUME(T.RParen);

        if (!$.RECORDING_PHASE) {
          let location = $.endRule();
          const functionName = name.image.slice(0, -1);
          const modernSyntax = isModernColorCall(functionName, args);
          return new Call({
            name: functionName,
            args
          }, modernSyntax ? { modernSyntax: true } : undefined, location, this.context);
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => $.OR(alt!(ctx));
}

/**
 * Originally, function arguments always had commas,
 * but it looks like that might be expanded in the
 * future in CSS to allow for semi-colon separators.
 * with the same rationale of why this was introduced
 * by Less (that values can already have commas).
 *
 * @see https://drafts.csswg.org/css-values-4/#interpolate
 *
 * @todo - if a function is introduced where semi-colons
 * are separators AND only 1 argument is required, then
 * that will have to be specially handled.
 */
export function functionCallArgs(this: C, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let node = $.SUBRULE($.valueSequence, { ARGS: [ctx] });

    let commaNodes: Node[];
    let semiNodes: Node[];
    if (!RECORDING_PHASE) {
      commaNodes = [$.wrap(node, true)];
      semiNodes = [];
    }
    let isSemiList = false;

    $.MANY(() => {
      $.OR([
        {
          GATE: () => !isSemiList,
          ALT: () => {
            $.CONSUME(T.Comma);
            node = $.SUBRULE2($.valueSequence, { ARGS: [ctx] });
            if (!RECORDING_PHASE) {
              commaNodes!.push($.wrap(node, true));
            }
          }
        },
        {
          ALT: () => {
            isSemiList = true;

            $.CONSUME(T.Semi);

            if (!RECORDING_PHASE) {
              /** Aggregate the previous set of comma-nodes */
              if (commaNodes.length > 1) {
                let commaList = new List(commaNodes, undefined, $.getLocationFromNodes(commaNodes), this.context);
                semiNodes.push(commaList);
              } else {
                semiNodes.push(commaNodes[0]!);
              }
            }
            node = $.SUBRULE3($.valueList, { ARGS: [ctx] });
            if (!RECORDING_PHASE) {
              semiNodes.push($.wrap(node, true));
            }
          }
        }
      ]);
    });

    if (!RECORDING_PHASE) {
      $.endRule();
      const nodes = isSemiList ? semiNodes! : commaNodes!;
      return new List(nodes, isSemiList ? { sep: ';' } : undefined);
    }
  };
}

// https://www.w3.org/TR/css-cascade-4/#at-import
export function importAtRule(this: C, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let name = $.CONSUME(T.AtImport);
    let preludeNodes: Node[];
    if (!RECORDING_PHASE) {
      preludeNodes = [];
    }
    let node = $.SUBRULE($.importPrelude, { ARGS: [ctx] }) as Node;

    if (!RECORDING_PHASE) {
      preludeNodes!.push($.wrap(node));
    }

    let extraNodes: Node[] | undefined;
    $.OPTION(() => {
      extraNodes = $.SUBRULE($.importPostlude, { ARGS: [ctx] }) as Node[];
    });
    if (!RECORDING_PHASE && extraNodes && extraNodes.length) {
      for (const n of extraNodes) {
        preludeNodes!.push(n);
      }
    }
    $.CONSUME(T.Semi);

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      return new AtRule({
        name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context), true),
        prelude: new Sequence(preludeNodes!, undefined, $.getLocationFromNodes(preludeNodes!), this.context)
      }, undefined, location, this.context);
    }
  };
}

/** import prelude: url(...) or "string" */
export function importPrelude(this: C, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    return $.OR([
      { ALT: () => $.SUBRULE($.urlFunction, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) }
    ]);
  };
}

/** import postlude: optional layer(), supports(), media. Returns Node[] */
export function importPostlude(this: C, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    let nodes: Node[] | undefined;
    if (!RECORDING_PHASE) {
      nodes = [];
    }

    /** layer(responsive) */
    $.OPTION(() => {
      let start = $.CONSUME(T.Layer);
      let value: Node = $.SUBRULE($.layerName);
      let end = $.CONSUME(T.RParen);
      if (!RECORDING_PHASE) {
        let { startOffset, startLine, startColumn } = start;
        let { endOffset, endLine, endColumn } = end;
        let location: LocationInfo = [startOffset, startLine!, startColumn!, endOffset!, endLine!, endColumn!];
        nodes!.push(
          $.wrap(
            new Call({
              name: 'layer',
              args: new List([value])
            }, undefined, location, this.context)
          )
        );
      }
    });

    /** supports(display: grid) */
    $.OPTION2(() => {
      let start = $.CONSUME(T.Supports);
      let value = $.OR4([
        {
          GATE: () => {
            let t1 = $.LA(1).tokenType;
            if (t1 === T.Not || t1 === T.LParen) {
              return true;
            }
            if ($.isTypeAt(1, T.Ident) && $.isTypeAt(2, T.LParen)) {
              return true;
            }
            return false;
          },
          ALT: () => $.SUBRULE($.supportsCondition, { ARGS: [ctx] })
        },
        { ALT: () => $.SUBRULE($.declaration, { ARGS: [ctx] }) }
      ]);
      let end = $.CONSUME2(T.RParen);
      if (!RECORDING_PHASE) {
        let { startOffset, startLine, startColumn } = start;
        let { endOffset, endLine, endColumn } = end;
        let location: LocationInfo = [startOffset, startLine!, startColumn!, endOffset!, endLine!, endColumn!];
        nodes!.push(
          $.wrap(
            new Call({
              name: 'supports',
              args: new List([$.wrap(value, 'both')])
            }, undefined, location, this.context)
          )
        );
      }
    });

    /** media query list */
    $.OPTION3(() => {
      let mediaNode = $.SUBRULE($.mediaQueryList, { ARGS: [ctx] });
      if (!RECORDING_PHASE) {
        nodes!.push(mediaNode);
      }
    });

    return nodes!;
  };
}

/**
 * @todo - add more structure for known nested at-rules.
 */
export function nestedAtRule(this: C, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let name = $.CONSUME(T.AtNested);
    let preludeNodes: Node[];
    let rules: Rules;

    if (!RECORDING_PHASE) {
      preludeNodes = [];
    }

    $.MANY(() => {
      let value = $.SUBRULE($.anyOuterValue, { ARGS: [ctx] });
      if (!RECORDING_PHASE) {
        preludeNodes.push($.wrap(value));
      }
    });
    $.CONSUME(T.LCurly);
    // All known nested at-rules use declaration lists in their blocks
    rules = $.SUBRULE($.declarationList, { ARGS: [ctx] });
    $.CONSUME(T.RCurly);

    if (!$.RECORDING_PHASE) {
      return new AtRule({
        name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context), true),
        prelude: preludeNodes!.length ? $.wrap(new Sequence(preludeNodes!, undefined, $.getLocationFromNodes(preludeNodes!), this.context), 'both') : undefined,
        rules
      }, undefined, $.endRule(), this.context);
    }
  };
}

export function nonNestedAtRule(this: C, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();
    let preludeNodes: Node[] = [];

    let name = $.CONSUME(T.AtNonNested);
    $.MANY(() => preludeNodes.push($.wrap($.SUBRULE($.anyOuterValue, { ARGS: [ctx] }))));
    $.CONSUME(T.Semi);

    if (!$.RECORDING_PHASE) {
      return new AtRule({
        name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context), true),
        prelude: $.wrap(new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), this.context))
      }, undefined, $.endRule(), this.context);
    }
  };
}

// unknownAtRule
//   : AT_RULE anyOuterValue* (SEMI | LCURLY anyInnerValue* RCURLY)
//   ;
export function unknownAtRule(this: C, T: TokenMap) {
  const $ = this;

  const {
    AtKeyword,
    Semi,
    LCurly,
    RCurly,
    DotName,
    HashName,
    Ampersand,
    LSquare,
    SelectorPseudoClass,
    NthPseudoClass,
    Star,
    ColorIdentStart,
    PlainIdent,
    CustomProperty,
    LegacyPropIdent,
    Colon
  } = T;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let preludeNodes: Node[];
    let valueNodes!: Node[];
    let declRules: Rules | undefined;
    let endToken: IToken | undefined;
    let innerBlockLocation: LocationInfo | undefined;

    if (!RECORDING_PHASE) {
      preludeNodes = [];
    }

    let name = $.CONSUME(T.AtKeyword);
    $.MANY(() => {
      let val = $.SUBRULE($.anyOuterValue, { ARGS: [ctx] });
      if (!RECORDING_PHASE) {
        preludeNodes.push($.wrap(val, 'both'));
      }
    });
    $.OR([
      { ALT: () => $.CONSUME(Semi) },
      {
        ALT: () => {
          if (!RECORDING_PHASE) {
            valueNodes = [];
          }
          $.CONSUME(LCurly);
          $.startRule();
          // 1) Fast selector/nested-at-rule start gate
          let t1 = $.LA(1).tokenType;
          let t2 = $.LA(2).tokenType;
          let assumeDeclList = (
            t1 === DotName
            || t1 === HashName
            || t1 === Ampersand
            || t1 === LSquare
            || t1 === SelectorPseudoClass
            || t1 === NthPseudoClass
            || t1 === Star
            || t1 === ColorIdentStart
            || t1 === AtKeyword
            // Also treat IDENT followed by '{' as a rule start (e.g., @-moz-document url-prefix() { a { ... } })
            || (
              (t1 === PlainIdent
                || t1 === CustomProperty
                || t1 === LegacyPropIdent
              ) && t2 === LCurly
            )
          );
          if (!assumeDeclList) {
            assumeDeclList = (
              t1 === PlainIdent
              || t1 === CustomProperty
              || t1 === LegacyPropIdent
            ) && t2 === Colon;
          }
          $.OR9([
            {
              GATE: () => assumeDeclList,
              ALT: () => {
                declRules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] });
              }
            },
            {
              GATE: () => !assumeDeclList,
              ALT: () => {
                /** Fallback to raw capture */
                $.MANY9(() => {
                  const value = $.SUBRULE($.anyInnerValue, { ARGS: [ctx] });
                  if (!RECORDING_PHASE) {
                    valueNodes.push($.wrap(value, 'both'));
                  }
                });
              }
            }
          ]);
          endToken = $.CONSUME(RCurly);
          if (!RECORDING_PHASE) {
            innerBlockLocation = $.endRule();
          }
        }
      }
    ]);

    if (!RECORDING_PHASE) {
      // Build rules result: declaration list, or single-sequence fallback, or undefined
      let rules: Rules | undefined;
      if (declRules) {
        rules = declRules;
      } else {
        if (valueNodes?.length) {
          // Create a single Sequence from all inner nodes, so serialization treats it as one unit
          const seqLoc = $.getLocationFromNodes(valueNodes!);
          const seq = new Sequence(valueNodes!, undefined, seqLoc, this.context);
          // Use RawRules to avoid inserting newlines/indentation during serialization
          rules = new RawRules([seq], undefined, seqLoc, this.context) as unknown as Rules;
        }
      }
      return new AtRule({
        name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context), true),
        prelude: preludeNodes!.length ? new Sequence(preludeNodes!, undefined, $.getLocationFromNodes(preludeNodes!), this.context) : undefined,
        rules
      }, undefined, $.endRule(), this.context);
    }
  };
}

/**
  @todo - add all tokens
  @see - https://stackoverflow.com/questions/55594491/antlr-4-parser-match-any-token

  From - https://w3c.github.io/csswg-drafts/css-syntax-3/#typedef-any-value
  The <any-value> production is identical to <declaration-value>, but also allows
  top-level <semicolon-token> tokens and <delim-token> tokens with a value of "!".
  It represents the entirety of what valid CSS can be in any context.

  Parts of the spec that allow any value should not display a warning or error
  for any unknown token.
*/
export function anyOuterValue(this: C, T: TokenMap) {
  const $ = this;

  let valueAlt = (ctx: RuleContext = {}) => [
    { ALT: () => $.SUBRULE($.extraTokens, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        $.CONSUME(T.LParen);
        $.MANY(() => {
          let val = $.SUBRULE($.anyInnerValue, { ARGS: [ctx] });
          if (!RECORDING_PHASE) {
            nodes.push($.wrap(val));
          }
        });
        $.CONSUME(T.RParen);

        if (!RECORDING_PHASE) {
          let location = $.endRule();
          return new Paren(
            nodes!.length ? new Sequence(nodes!, undefined, $.getLocationFromNodes(nodes!), this.context) : undefined,
            undefined,
            location,
            this.context
          );
        }
      }
    },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        let nodes: Node[];

        if (!RECORDING_PHASE) {
          nodes = [];
        }

        $.CONSUME(T.LSquare);
        $.MANY2(() => {
          let node = $.SUBRULE2($.anyInnerValue, { ARGS: [ctx] });
          if (!RECORDING_PHASE) {
            nodes.push($.wrap(node));
          }
        });
        $.CONSUME(T.RSquare);

        if (!RECORDING_PHASE) {
          let location = $.endRule();
          return new Paren(
            $.wrap(new Sequence(nodes!, undefined, $.getLocationFromNodes(nodes!), this.context), true),
            undefined,
            location,
            this.context
          );
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => $.OR(valueAlt(ctx));
}

/**
 * Same as allowable outer values, but allows
 * semi-colons and curly blocks.
 */
export function anyInnerValue(this: C, T: TokenMap) {
  const $ = this;

  let valueAlt = (ctx: RuleContext = {}) => [
    { ALT: () => $.SUBRULE($.anyOuterValue, { ARGS: [ctx] }) },
    {
      ALT: () => {
        $.startRule();
        let RECORDING_PHASE = $.RECORDING_PHASE;
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        $.CONSUME(T.LCurly);
        $.MANY(() => {
          let node = $.SUBRULE2($.anyInnerValue, { ARGS: [ctx] });
          if (!RECORDING_PHASE) {
            nodes.push(node);
          }
        });
        $.CONSUME(T.RCurly);

        if (!RECORDING_PHASE) {
          let location = $.endRule();

          return new Block(
            $.wrap(new Sequence(nodes!, undefined, $.getLocationFromNodes(nodes!), this.context), 'both'),
            { type: 'curly' },
            location,
            this.context
          );
        }
      }
    },
    {
      ALT: () => {
        let semi = $.CONSUME(T.Semi);

        if (!$.RECORDING_PHASE) {
          return $.wrap(new Any(semi.image, { role: 'semi' }, $.getLocationInfo(semi), this.context));
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => $.OR(valueAlt(ctx));
}
