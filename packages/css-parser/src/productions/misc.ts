/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
// Methods to be mixed into CssRecursiveParser
import type { IToken } from 'chevrotain';
import type { CssRecursiveParser, RuleContext, TokenMap, Rule } from '../cssRecursiveParser.js';
import { EMPTY_ALT } from 'chevrotain';
import {
  type LocationInfo,
  Node, Any, AtRule, Rules, Sequence, List,
  QueryCondition, Keyword, Paren, Call, Block, RawRules,
  Url
} from '@jesscss/core';
import type { AltContext } from './atRules.js';

type C = CssRecursiveParser;
type ProductionRule = (ctx?: RuleContext) => Node | Node[] | undefined;

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
    const preludeNodes: Node[] = [];

    // Parse optional first layer name
    $.OPTION(() => {
      const nameNode: Node = $.SUBRULE($.layerName, { ARGS: [ctx] });
      if (!RECORDING_PHASE) {
        preludeNodes.push(nameNode);
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
              name: new Any(atTok.image, { role: 'atkeyword' }, $.getLocationInfo(atTok), this.context),
              prelude: preludeNodes.length ? new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), this.context) : undefined,
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
              preludeNodes.push(nameNode);
            }
          });
          $.CONSUME(T.Semi);
          if (!RECORDING_PHASE) {
            return new AtRule({
              name: new Any(atTok.image, { role: 'atkeyword' }, $.getLocationInfo(atTok), this.context),
              prelude: preludeNodes.length ? new List(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), this.context) : undefined
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
    const nodes: Node[] = [];

    const first = $.CONSUME(T.Ident);
    if (!RECORDING_PHASE) {
      nodes.push($.processValueToken(first));
    }

    $.MANY({
      GATE: $.noSep,
      DEF: () => {
        const seg = $.CONSUME(T.DotName);
        if (!RECORDING_PHASE) {
          nodes.push($.processValueToken(seg));
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
export function supportsAtRule(this: C, T: TokenMap, preludeRule?: Rule | string) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();

    let name = $.CONSUME(T.AtSupports);
    let resolvedPreludeRule: Rule | undefined;
    if (typeof preludeRule === 'string') {
      const resolved: unknown = Reflect.get($, preludeRule);
      if (typeof resolved === 'function') {
        resolvedPreludeRule = resolved as Rule;
      }
    } else {
      resolvedPreludeRule = preludeRule;
    }
    const prelude: Node = resolvedPreludeRule
      ? $.SUBRULE(resolvedPreludeRule, { ARGS: [ctx] })
      : $.SUBRULE($.supportsCondition, { ARGS: [ctx] });
    $.CONSUME(T.LCurly);
    let rules = $.SUBRULE($.atRuleBody, { ARGS: [ctx] });
    $.CONSUME(T.RCurly);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      return new AtRule({
        name: new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context),
        prelude: prelude,
        rules
      }, { nestable: true }, location, this.context);
    }
  };
}

/**
 * @supports condition — modeled after the Less parser's working pattern.
 * Uses GATE + MANY with explicit token checks instead of factory/alt pattern.
 */
export function supportsCondition(this: C, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => $.OR([
    {
      GATE: () => $.isType(T.Not),
      ALT: () => {
        $.startRule();
        const keyword = $.CONSUME(T.Not);
        const value = $.SUBRULE($.supportsInParens, { ARGS: [ctx] });

        if ($.RECORDING_PHASE) {
          return;
        }
        const location = $.endRule();
        return new QueryCondition([
          new Keyword(keyword.image, undefined, $.getLocationInfo(keyword), this.context),
          value
        ], undefined, location, this.context);
      }
    },
    {
      ALT: () => {
        const RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        let left = $.SUBRULE2($.supportsInParens, { ARGS: [ctx] });

        $.MANY({
          GATE: () => $.isType(T.And),
          DEF: () => {
            const keyword = $.CONSUME2(T.And);
            const right = $.SUBRULE3($.supportsInParens, { ARGS: [ctx] });
            if (!RECORDING_PHASE) {
              const [startOffset, startLine, startColumn] = left.location;
              const [,,, endOffset, endLine, endColumn] = right.location;
              left = new QueryCondition([
                left,
                new Keyword(keyword.image, undefined, $.getLocationInfo(keyword), this.context),
                right
              ], undefined, [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!], this.context);
            }
          }
        });
        $.MANY2({
          GATE: () => $.isType(T.Or),
          DEF: () => {
            const keyword = $.CONSUME2(T.Or);
            const right = $.SUBRULE4($.supportsInParens, { ARGS: [ctx] });
            if (!RECORDING_PHASE) {
              const [startOffset, startLine, startColumn] = left.location;
              const [,,, endOffset, endLine, endColumn] = right.location;
              left = new QueryCondition([
                left,
                new Keyword(keyword.image, undefined, $.getLocationInfo(keyword), this.context),
                right
              ], undefined, [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!], this.context);
            }
          }
        });

        if (RECORDING_PHASE) {
          return;
        }
        $.endRule();
        return left;
      }
    }
  ]);
}

export function supportsInParens(this: C, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => $.OR<Node | undefined>([
    {
      GATE: () => $.isType(T.Ident) && $.isTypeAt(2, T.LParen),
      ALT: () => {
        $.startRule();
        const name = $.CONSUME(T.Ident);
        $.CONSUME(T.LParen);
        const args = $.SUBRULE($.valueList, { ARGS: [ctx] });
        $.CONSUME2(T.RParen);

        if ($.RECORDING_PHASE) {
          return;
        }
        const location = $.endRule();
        return new Call({ name: name.image, args }, undefined, location, this.context);
      }
    },
    {
      GATE: () => $.isType(T.LParen),
      ALT: () => {
        $.startRule();
        $.CONSUME3(T.LParen);
        let value: Node | undefined;
        // Try supportsCondition first (starts with Not, LParen, or Ident+LParen)
        $.OPTION({
          GATE: () => (
            $.isType(T.Not)
            || $.isType(T.LParen)
            || ($.isTypeAt(1, T.Ident) && $.isTypeAt(2, T.LParen))
          ),
          DEF: () => {
            value = $.SUBRULE2($.supportsCondition, { ARGS: [ctx] });
          }
        });
        // Otherwise parse as declaration (property: value)
        $.OPTION2({
          GATE: () => (
            !value
            && !$.isType(T.Not)
            && !$.isType(T.LParen)
            && !($.isTypeAt(1, T.Ident) && $.isTypeAt(2, T.LParen))
          ),
          DEF: () => {
            value = $.SUBRULE($.declaration, { ARGS: [ctx] });
          }
        });
        $.CONSUME4(T.RParen);

        if ($.RECORDING_PHASE) {
          return;
        }
        const location = $.endRule();
        return new Paren(value ? value : undefined, undefined, location, this.context);
      }
    }
  ]);
}

/** Used within anyOuterValue  */
export function functionCallLike(this: C, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    const name = $.CONSUME(T.FunctionStart);
    let args!: Node[];
    if (!RECORDING_PHASE) {
      args = [];
    }
    let seq: Sequence | undefined;
    $.MANY({
      GATE: () => {
        let tt = $.LA(1).tokenType;
        return tt !== T.RParen && tt !== T.UrlEnd;
      },
      DEF: () => {
        const node = $.SUBRULE($.anyOuterValue, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          args.push(node);
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
      return new Call({ name: name.image.slice(0, -1), args: new List(seq ? [seq] : []) }, undefined, location, this.context);
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
    if (!args || args.value.length !== 1) {
      return false;
    }
    const firstArg = args.value[0];
    return Boolean(firstArg instanceof Sequence && firstArg.value.length >= 2);
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
export function functionCallArgs(this: C, T: TokenMap): ProductionRule {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let node = $.SUBRULE($.valueSequence, { ARGS: [ctx] });

    let commaNodes: Node[];
    let semiNodes: Node[];
    if (!RECORDING_PHASE) {
      commaNodes = [node];
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
              commaNodes!.push(node);
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
              semiNodes.push(node);
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
    let node: Node = $.SUBRULE($.importPrelude, { ARGS: [ctx] });

    if (!RECORDING_PHASE) {
      preludeNodes!.push(node);
    }

    let extraNodes: Node[] | undefined;
    $.OPTION(() => {
      extraNodes = $.SUBRULE($.importPostlude, { ARGS: [ctx] });
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
        name: new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context),
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
export function importPostlude(this: C, T: TokenMap): ProductionRule {
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
          new Call({
            name: 'layer',
            args: new List([value])
          }, undefined, location, this.context)
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
          new Call({
            name: 'supports',
            args: new List([value])
          }, undefined, location, this.context)
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
        preludeNodes.push(value);
      }
    });
    $.CONSUME(T.LCurly);
    // All known nested at-rules use declaration lists in their blocks
    rules = $.SUBRULE($.declarationList, { ARGS: [ctx] });
    $.CONSUME(T.RCurly);

    if (!$.RECORDING_PHASE) {
      return new AtRule({
        name: new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context),
        prelude: preludeNodes!.length ? new Sequence(preludeNodes!, undefined, $.getLocationFromNodes(preludeNodes!), this.context) : undefined,
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
    $.MANY(() => preludeNodes.push($.SUBRULE($.anyOuterValue, { ARGS: [ctx] })));
    $.CONSUME(T.Semi);

    if (!$.RECORDING_PHASE) {
      return new AtRule({
        name: new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context),
        prelude: new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), this.context)
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
        preludeNodes.push(val);
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
                    valueNodes.push(value);
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
          rules = new RawRules([seq], undefined, seqLoc, this.context);
        }
      }
      return new AtRule({
        name: new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context),
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
            nodes.push(val);
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
            nodes.push(node);
          }
        });
        $.CONSUME(T.RSquare);

        if (!RECORDING_PHASE) {
          let location = $.endRule();
          return new Paren(
            new Sequence(nodes!, undefined, $.getLocationFromNodes(nodes!), this.context),
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
            new Sequence(nodes!, undefined, $.getLocationFromNodes(nodes!), this.context),
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
          return new Any(semi.image, { role: 'semi' }, $.getLocationInfo(semi), this.context);
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => $.OR(valueAlt(ctx));
}
