// Methods to be mixed into CssRecursiveParser
import type { IToken } from '@chevrotain/types';
import type { CssRecursiveParser, RuleContext } from '../cssRecursiveParser.js';
import { tokenMatcher } from '../cssRecursiveParser.js';
import {
  Node, Any, AtRule, Ruleset, Rules, Sequence, List, Block,
  QueryCondition, Keyword, Paren, Call, Url, RawRules,
  type LocationInfo
} from '@jesscss/core';

type P = CssRecursiveParser;

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
export function layerAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  const atTok = $.CONSUME($.T.AtLayer);

  return $.OR([
    {
      ALT: () => {
        const preludeNodes: Node[] = [];
        $.OPTION(() => {
          const nameNode: Node = $.SUBRULE($.layerName, { ARGS: [ctx] });
          preludeNodes.push($.wrap(nameNode));
        });
        $.CONSUME($.T.LCurly);
        const rules = $.SUBRULE($.atRuleBody, { ARGS: [ctx] }) as Rules;
        $.CONSUME($.T.RCurly);
        return new AtRule({
          name: $.wrap(new Any(atTok.image, { role: 'atkeyword' }, $.getLocationInfo(atTok), $.context), true),
          prelude: preludeNodes.length ? $.wrap(new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), $.context), 'both') : undefined,
          rules
        }, { nestable: true }, $.endRule(), $.context);
      }
    },
    {
      ALT: () => {
        const preludeNodes: Node[] = [];
        $.MANY_SEP({
          SEP: $.T.Comma,
          DEF: () => {
            let nameNode: Node = $.SUBRULE($.layerName, { ARGS: [ctx] });
            preludeNodes.push($.wrap(nameNode));
          }
        });
        $.CONSUME($.T.Semi);
        return new AtRule({
          name: $.wrap(new Any(atTok.image, { role: 'atkeyword' }, $.getLocationInfo(atTok), $.context), true),
          prelude: preludeNodes.length ? $.wrap(new List(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), $.context), 'both') : undefined
        }, undefined, $.endRule(), $.context);
      }
    }
  ]);
}

/**
 * <layer-name> = <ident> ('.' <ident>)*
 */
export function layerName(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  const nodes: Node[] = [];

  const first = $.CONSUME($.T.Ident);
  nodes.push($.wrap($.processValueToken(first)));

  $.MANY({
    GATE: $.noSep.bind($),
    DEF: () => {
      const seg = $.CONSUME($.T.DotName);
      nodes.push($.wrap($.processValueToken(seg)));
    }
  });

  const loc = $.endRule();
  return new Sequence(nodes, undefined, loc, $.context);
}

/**
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@supports
 */
export function supportsAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  let name = $.CONSUME($.T.AtSupports);
  const prelude: Node = $.SUBRULE($.supportsCondition, { ARGS: [ctx] });
  $.CONSUME($.T.LCurly);
  let rules = $.SUBRULE($.atRuleBody, { ARGS: [ctx] }) as Rules;
  $.CONSUME($.T.RCurly);

  let location = $.endRule();
  return new AtRule({
    name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), $.context), true),
    prelude: $.wrap(prelude, 'both'),
    rules
  }, { nestable: true }, location, $.context);
}

/** spec-compliant but simplified */
export function supportsCondition(this: P, ctx: RuleContext = {}): Node {
  const $ = this;
  return $.OR([
    {
      ALT: () => {
        $.startRule();
        let keyword = $.CONSUME($.T.Not);
        let value = $.supportsInParens(ctx);

        let location = $.endRule();
        return new QueryCondition([
          $.wrap(new Keyword(keyword.image, undefined, $.getLocationInfo(keyword), $.context)),
          value
        ], undefined, location, $.context);
      }
    },
    {
      ALT: () => {
        let start = $.startRule();
        let [startOffset, startLine, startColumn] = start ?? [];

        let left: Node = $.supportsInParens(ctx);

        /**
         * Can be followed by many ands or many ors
         */
        $.OR([
          {
            ALT: () => {
              $.AT_LEAST_ONE(() => {
                let keyword = $.CONSUME($.T.And);
                let right: Node = $.supportsInParens(ctx);
                if (!$.RECORDING_PHASE) {
                  let [,,,endOffset, endLine, endColumn] = right.location;
                  left = new QueryCondition([
                    left,
                    $.wrap(new Keyword(keyword.image, undefined, $.getLocationInfo(keyword), $.context)),
                    right
                  ], undefined, [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!], $.context);
                }
              });
            }
          },
          {
            ALT: () => {
              $.AT_LEAST_ONE(() => {
                let keyword = $.CONSUME($.T.Or);
                let right: Node = $.supportsInParens(ctx);
                if (!$.RECORDING_PHASE) {
                  let [,,,endOffset, endLine, endColumn] = right.location;
                  left = new QueryCondition([
                    left,
                    $.wrap(new Keyword(keyword.image, undefined, $.getLocationInfo(keyword), $.context)),
                    right
                  ], undefined, [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!], $.context);
                }
              });
            }
          },
          {
            ALT: () => undefined
          }
        ]);

        $.endRule();

        return left;
      }
    }
  ]);
}

export function supportsInParens(this: P, ctx: RuleContext = {}): Node {
  const $ = this;
  return $.OR([
    {
      ALT: (): Node => {
        $.startRule();
        /** Function-like call */
        let name = $.CONSUME($.T.Ident);
        let args: List | undefined;
        $.OR([
          {
            GATE: () => $.noSep(),
            ALT: () => {
              $.CONSUME($.T.LParen);
              args = $.SUBRULE($.valueList, { ARGS: [ctx] }) as List;
              $.CONSUME($.T.RParen);
            }
          }
        ]);

        let location = $.endRule();
        return new Call({
          name: name.image,
          args
        }, undefined, location, $.context);
      }
    },
    {
      ALT: (): Node => {
        $.startRule();
        let values: Node[] = [];
        $.CONSUME($.T.LParen);
        /**
         * Intentionally omits "generalEnclosed" from spec.
         * See the note on media queries.
         */
        let value: Node = $.OR([
          { ALT: (): Node => $.SUBRULE($.supportsCondition, { ARGS: [ctx] }) },
          { ALT: (): Node => $.declaration(ctx) }
        ]);
        $.CONSUME($.T.RParen);

        let location = $.endRule();
        if (!(value instanceof Node)) {
          value = new Sequence(values, undefined, $.getLocationFromNodes(values), $.context);
        }
        return $.wrap(new Paren($.wrap(value, 'both'), undefined, location, $.context));
      }
    }
  ]);
}

/** Used within anyOuterValue  */
export function functionCallLike(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  const name = $.CONSUME($.T.FunctionStart);
  let args: Node[] = [];
  let seq: Sequence | undefined;
  $.MANY({
    GATE: () => !tokenMatcher($.LA(1), $.T.FunctionLikeEnd),
    DEF: () => {
      const node = $.SUBRULE($.anyOuterValue, { ARGS: [ctx] });
      args.push($.wrap(node));
    }
  });
  let location = args.length ? $.getLocationFromNodes(args) : undefined;
  if (args.length) {
    seq = new Sequence(args, undefined, location, $.context);
  }
  $.OR([
    { ALT: () => $.CONSUME($.T.RParen) },
    { ALT: () => $.CONSUME($.T.UrlEnd) }
  ]);
  const endLocation = $.endRule();
  return $.wrap(new Call({ name: name.image.slice(0, -1), args: new List(seq ? [seq] : []) }, undefined, endLocation, $.context));
}

export function functionCall(this: P, ctx: RuleContext = {}) {
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

  return $.OR([
    {
      GATE: () => $.isType($.T.FunctionStart) && $.LA(1).image.slice(0, -1).toLowerCase() === 'if',
      ALT: () => $.ifFunction(ctx)
    },
    {
      GATE: () => $.isType($.T.FunctionStart),
      ALT: () => $.knownFunctions(ctx)
    },
    {
      ALT: () => {
        $.startRule();

        let name = $.CONSUME($.T.FunctionStart);
        let args: List<Node> | undefined;

        $.OPTION(() => args = $.SUBRULE($.functionCallArgs, { ARGS: [ctx] }) as List<Node>);
        $.CONSUME($.T.RParen);

        let location = $.endRule();
        const functionName = name.image.slice(0, -1);
        const modernSyntax = isModernColorCall(functionName, args);
        return new Call({
          name: functionName,
          args
        }, modernSyntax ? { modernSyntax: true } : undefined, location, $.context);
      }
    }
  ]);
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
export function functionCallArgs(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  let node = $.valueSequence(ctx);

  let commaNodes: Node[] = [$.wrap(node, true)];
  let semiNodes: Node[] = [];
  let isSemiList = false;

  $.MANY({
    GATE: () => (!isSemiList && $.isType($.T.Comma)) || $.isType($.T.Semi),
    DEF: () => {
      $.OR([
        {
          GATE: () => !isSemiList,
          ALT: () => {
            $.CONSUME($.T.Comma);
            node = $.valueSequence(ctx);
            commaNodes!.push($.wrap(node, true));
          }
        },
        {
          ALT: () => {
            isSemiList = true;

            $.CONSUME($.T.Semi);

            /** Aggregate the previous set of comma-nodes */
            if (commaNodes.length > 1) {
              let commaList = new List(commaNodes, undefined, $.getLocationFromNodes(commaNodes), $.context);
              semiNodes.push(commaList);
            } else {
              semiNodes.push(commaNodes[0]!);
            }
            node = $.valueList(ctx) as Node;
            semiNodes.push($.wrap(node, true));
          }
        }
      ]);
    }
  });

  $.endRule();
  const nodes = isSemiList ? semiNodes! : commaNodes!;
  return new List(nodes, isSemiList ? { sep: ';' } : undefined);
}

// https://www.w3.org/TR/css-cascade-4/#at-import
export function importAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  let name = $.CONSUME($.T.AtImport);
  let preludeNodes: Node[] = [];
  let node = $.SUBRULE($.importPrelude, { ARGS: [ctx] }) as Node;

  preludeNodes!.push($.wrap(node));

  let extraNodes: Node[] | undefined;
  $.OPTION(() => {
    extraNodes = $.SUBRULE($.importPostlude, { ARGS: [ctx] });
  });
  if (extraNodes && extraNodes.length) {
    for (const n of extraNodes) {
      preludeNodes!.push(n);
    }
  }
  $.CONSUME($.T.Semi);

  let location = $.endRule();
  return new AtRule({
    name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), $.context), true),
    prelude: new Sequence(preludeNodes!, undefined, $.getLocationFromNodes(preludeNodes!), $.context)
  }, undefined, location, $.context);
}

/** import prelude: url(...) or "string" */
export function importPrelude(this: P, ctx: RuleContext = {}) {
  const $ = this;
  return $.OR([
    { ALT: () => $.urlFunction(ctx) },
    { ALT: () => $.string(ctx) }
  ]);
}

/** import postlude: optional layer(), supports(), media. Returns Node[] */
export function importPostlude(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let nodes: Node[] = [];

  /** layer(responsive) */
  $.OPTION(() => {
    let start = $.CONSUME($.T.Layer);
    let value: Node = $.SUBRULE($.layerName);
    let end = $.CONSUME($.T.RParen);
    let { startOffset, startLine, startColumn } = start;
    let { endOffset, endLine, endColumn } = end;
    let location: LocationInfo = [startOffset, startLine!, startColumn!, endOffset!, endLine!, endColumn!];
    nodes!.push(
      $.wrap(
        new Call({
          name: 'layer',
          args: new List([value])
        }, undefined, location, $.context)
      )
    );
  });

  /** supports(display: grid) */
  $.OPTION(() => {
    let start = $.CONSUME($.T.Supports);
    let value = $.OR([
      { ALT: () => $.SUBRULE($.supportsCondition, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.declaration, { ARGS: [ctx] }) }
    ]);
    let end = $.CONSUME($.T.RParen);
    let { startOffset, startLine, startColumn } = start;
    let { endOffset, endLine, endColumn } = end;
    let location: LocationInfo = [startOffset, startLine!, startColumn!, endOffset!, endLine!, endColumn!];
    nodes!.push(
      $.wrap(
        new Call({
          name: 'supports',
          args: new List([$.wrap(value, 'both')])
        }, undefined, location, $.context)
      )
    );
  });

  /** media query list */
  $.OPTION(() => {
    let mediaNode = $.SUBRULE($.mediaQueryList, { ARGS: [ctx] });
    nodes!.push(mediaNode);
  });

  return nodes!;
}

/**
 * @todo - add more structure for known nested at-rules.
 */
export function nestedAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  let name = $.CONSUME($.T.AtNested);
  let preludeNodes: Node[] = [];
  let rules: Rules;

  $.MANY(() => {
    let value = $.SUBRULE($.anyOuterValue, { ARGS: [ctx] });
    preludeNodes.push($.wrap(value));
  });
  $.CONSUME($.T.LCurly);
  // All known nested at-rules use declaration lists in their blocks
  rules = $.SUBRULE($.declarationList, { ARGS: [ctx] }) as Rules;
  $.CONSUME($.T.RCurly);

  return new AtRule({
    name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), $.context), true),
    prelude: preludeNodes!.length ? $.wrap(new Sequence(preludeNodes!, undefined, $.getLocationFromNodes(preludeNodes!), $.context), 'both') : undefined,
    rules
  }, undefined, $.endRule(), $.context);
}

export function nonNestedAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  let preludeNodes: Node[] = [];

  let name = $.CONSUME($.T.AtNonNested);
  $.MANY(() => preludeNodes.push($.wrap($.SUBRULE($.anyOuterValue, { ARGS: [ctx] }))));
  $.CONSUME($.T.Semi);

  return new AtRule({
    name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), $.context), true),
    prelude: $.wrap(new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), $.context))
  }, undefined, $.endRule(), $.context);
}

// unknownAtRule
//   : AT_RULE anyOuterValue* (SEMI | LCURLY anyInnerValue* RCURLY)
//   ;
export function unknownAtRule(this: P, ctx: RuleContext = {}) {
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
  } = $.T;

  $.startRule();

  let preludeNodes: Node[] = [];
  let valueNodes!: Node[];
  let declRules: Rules | undefined;
  let endToken: IToken | undefined;
  let innerBlockLocation: LocationInfo | undefined;

  let name = $.CONSUME($.T.AtKeyword);
  $.MANY(() => {
    let val = $.SUBRULE($.anyOuterValue, { ARGS: [ctx] });
    preludeNodes.push($.wrap(val, 'both'));
  });
  $.OR([
    { ALT: () => $.CONSUME(Semi) },
    {
      ALT: () => {
        valueNodes = [];
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
        $.OR([
          {
            GATE: () => assumeDeclList,
            ALT: () => {
              declRules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] }) as Rules;
            }
          },
          {
            GATE: () => !assumeDeclList,
            ALT: () => {
              /** Fallback to raw capture */
              $.MANY(() => {
                const value = $.SUBRULE($.anyInnerValue, { ARGS: [ctx] });
                valueNodes.push($.wrap(value, 'both'));
              });
            }
          }
        ]);
        endToken = $.CONSUME(RCurly);
        innerBlockLocation = $.endRule();
      }
    }
  ]);

  // Build rules result: declaration list, or single-sequence fallback, or undefined
  let rules: Rules | undefined;
  if (declRules) {
    rules = declRules;
  } else {
    if (valueNodes?.length) {
      // Create a single Sequence from all inner nodes, so serialization treats it as one unit
      const seqLoc = $.getLocationFromNodes(valueNodes!);
      const seq = new Sequence(valueNodes!, undefined, seqLoc, $.context);
      // Use RawRules to avoid inserting newlines/indentation during serialization
      rules = new RawRules([seq], undefined, seqLoc, $.context);
    }
  }
  return new AtRule({
    name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), $.context), true),
    prelude: preludeNodes!.length ? new Sequence(preludeNodes!, undefined, $.getLocationFromNodes(preludeNodes!), $.context) : undefined,
    rules
  }, undefined, $.endRule(), $.context);
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
export function anyOuterValue(this: P, ctx: RuleContext = {}) {
  const $ = this;
  return $.OR([
    { ALT: () => $.extraTokens(ctx) },
    { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) },
    {
      GATE: () => $.isType($.T.LParen),
      ALT: () => {
        $.startRule();
        let nodes: Node[] = [];
        $.CONSUME($.T.LParen);
        $.MANY({
          GATE: () => !$.isType($.T.RParen),
          DEF: () => {
            let val = $.SUBRULE($.anyInnerValue, { ARGS: [ctx] });
            nodes.push($.wrap(val));
          }
        });
        $.CONSUME($.T.RParen);

        let location = $.endRule();
        return new Paren(
          nodes!.length ? new Sequence(nodes!, undefined, $.getLocationFromNodes(nodes!), $.context) : undefined,
          undefined,
          location,
          $.context
        );
      }
    },
    {
      GATE: () => $.isType($.T.LSquare),
      ALT: () => {
        $.startRule();
        let nodes: Node[] = [];

        $.CONSUME($.T.LSquare);
        $.MANY({
          GATE: () => !$.isType($.T.RSquare),
          DEF: () => {
            let node = $.SUBRULE($.anyInnerValue, { ARGS: [ctx] });
            nodes.push($.wrap(node));
          }
        });
        $.CONSUME($.T.RSquare);

        let location = $.endRule();
        return new Paren(
          $.wrap(new Sequence(nodes!, undefined, $.getLocationFromNodes(nodes!), $.context), true),
          undefined,
          location,
          $.context
        );
      }
    }
  ]);
}

/**
 * Same as allowable outer values, but allows
 * semi-colons and curly blocks.
 */
export function anyInnerValue(this: P, ctx: RuleContext = {}) {
  const $ = this;
  return $.OR([
    { ALT: () => $.SUBRULE($.anyOuterValue, { ARGS: [ctx] }) },
    {
      GATE: () => $.isType($.T.LCurly),
      ALT: () => {
        $.startRule();
        let nodes: Node[] = [];
        $.CONSUME($.T.LCurly);
        $.MANY({
          GATE: () => !$.isType($.T.RCurly),
          DEF: () => {
            let node = $.SUBRULE($.anyInnerValue, { ARGS: [ctx] });
            nodes.push(node);
          }
        });
        $.CONSUME($.T.RCurly);

        let location = $.endRule();

        return new Block(
          $.wrap(new Sequence(nodes!, undefined, $.getLocationFromNodes(nodes!), $.context), 'both'),
          { type: 'curly' },
          location,
          $.context
        );
      }
    },
    {
      ALT: () => {
        let semi = $.CONSUME($.T.Semi);

        return $.wrap(new Any(semi.image, { role: 'semi' }, $.getLocationInfo(semi), $.context));
      }
    }
  ]);
}
