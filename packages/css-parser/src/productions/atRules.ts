// Methods to be mixed into CssRecursiveParser
import type { CssRecursiveParser, RuleContext } from '../cssRecursiveParser.js';
import type { IToken, LocationInfo } from '@jesscss/parser-runtime';
import { tokenMatches, tokenTypeInSet } from '@jesscss/parser-runtime';
import {
  Node, Any, AtRule, Rules, Sequence, List,
  QueryCondition, Keyword, Paren, Declaration, Call,
  BasicSelector
} from '@jesscss/core';

type P = CssRecursiveParser;

type PreludeRule = unknown;

function resolvePreludeRule(parser: P, preludeRule: PreludeRule): unknown {
  if (typeof preludeRule === 'string') {
    const rec = parser as unknown as Record<string, unknown>;
    return rec[preludeRule];
  }
  return preludeRule;
}

export function atRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  return $.OR([
    { GATE: () => $.isType($.T.AtContainer), ALT: () => $.containerAtRule(ctx) },
    { GATE: () => $.isType($.T.AtScope), ALT: () => $.scopeAtRule(ctx) },
    { GATE: () => $.isType($.T.AtDocument), ALT: () => $.documentAtRule(ctx) },
    { GATE: () => $.isType($.T.AtLayer), ALT: () => $.layerAtRule(ctx) },
    { GATE: () => $.isType($.T.AtKeyframes), ALT: () => $.keyframesAtRule(ctx) },
    { GATE: () => $.isType($.T.AtImport), ALT: () => $.importAtRule(ctx) },
    { GATE: () => $.isType($.T.AtMedia), ALT: () => $.mediaAtRule(ctx) },
    { GATE: () => $.isType($.T.AtPage), ALT: () => $.pageAtRule(ctx) },
    { GATE: () => $.isType($.T.AtFontFace), ALT: () => $.fontFaceAtRule(ctx) },
    { GATE: () => $.isType($.T.AtSupports), ALT: () => $.supportsAtRule(ctx) },
    { GATE: () => $.isType($.T.AtNested), ALT: () => $.nestedAtRule(ctx) },
    { GATE: () => $.isType($.T.AtNonNested), ALT: () => $.nonNestedAtRule(ctx) },
    { ALT: () => $.unknownAtRule(ctx) }
  ]);
}

/**
  Inner rules are mostly the same except they have a declarationList
  instead of a main block within {}
*/
export function innerAtRule(this: P, ctx: RuleContext = {}): Node {
  const $ = this;
  return $.OR([
    {
      GATE: () => $.isType($.T.AtContainer),
      ALT: () => $.containerAtRule({ ...ctx, inner: true })
    },
    {
      GATE: () => $.isType($.T.AtScope),
      ALT: () => $.scopeAtRule({ ...ctx, inner: true })
    },
    {
      GATE: () => $.isType($.T.AtDocument),
      ALT: () => $.documentAtRule({ ...ctx, inner: true })
    },
    {
      GATE: () => $.isType($.T.AtLayer),
      ALT: () => $.layerAtRule({ ...ctx, inner: true })
    },
    {
      GATE: () => $.isType($.T.AtKeyframes),
      ALT: () => $.keyframesAtRule({ ...ctx, inner: true })
    },
    {
      GATE: () => $.isType($.T.AtMedia),
      ALT: () => $.mediaAtRule({ ...ctx, inner: true })
    },
    {
      GATE: () => $.isType($.T.AtSupports),
      ALT: () => $.supportsAtRule({ ...ctx, inner: true })
    },
    {
      GATE: () => $.isType($.T.AtNested),
      ALT: () => $.nestedAtRule({ ...ctx, inner: true })
    },
    {
      ALT: () => $.unknownAtRule({ ...ctx, inner: true })
    }
  ]);
}

/**
 * @see https://www.w3.org/TR/css-nesting-1/#conditionals
 */
export function atRuleBody(this: P, ctx: RuleContext = {}): Node {
  const $ = this;
  return $.OR([
    {
      GATE: () => !ctx.inner,
      ALT: () => $.main(ctx)
    },
    {
      GATE: () => !!ctx.inner,
      ALT: () => $.declarationList(ctx)
    }
  ]);
}

export function mediaAtRule(this: P, ctx: RuleContext = {}, preludeRule?: PreludeRule) {
  const $ = this;
  $.startRule();
  let name = $.CONSUME($.T.AtMedia);
  let rules: Rules;
  const resolvedPreludeRule = resolvePreludeRule(this, preludeRule);
  const prelude: Node = typeof resolvedPreludeRule === 'function'
    ? (resolvedPreludeRule as any).call(this, ctx)
    : $.mediaQueryList(ctx);
  $.CONSUME($.T.LCurly);
  rules = $.atRuleBody(ctx) as Rules;
  $.CONSUME($.T.RCurly);

  let location = $.endRule();
  return new AtRule({
    name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), $.context), true),
    prelude: $.wrap(prelude, true),
    rules
  }, { nestable: true }, location, $.context);
}

export function mediaQueryList(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  let queries: Node[] = [];
  $.AT_LEAST_ONE_SEP({
    SEP: $.T.Comma,
    DEF: () => {
      let query = $.mediaQuery(ctx);
      queries.push(query);
    }
  });

  if (queries!.length === 1) {
    $.endRule();
    return queries![0]!;
  }
  return new List(queries!, undefined, $.endRule(), $.context);
}

/**
 * @see https://w3c.github.io/csswg-drafts/mediaqueries/#mq-syntax
 */
export function mediaQuery(this: P, ctx: RuleContext = {}) {
  const $ = this;
  return $.OR([
    { ALT: () => $.mediaCondition(ctx) },
    {
      ALT: () => {
        $.startRule();

        let token: IToken | undefined;
        let node: Node | undefined;
        let nodes: Node[] = [];

        $.OPTION(() => {
          $.OR([
            { ALT: () => token = $.CONSUME($.T.Not) },
            { ALT: () => token = $.CONSUME($.T.Only) }
          ]);
        });

        if (token) {
          nodes!.push($.wrap(new Keyword(token.image, undefined, $.getLocationInfo(token), $.context), 'both'));
          token = undefined;
        }
        let type = $.mediaType(ctx);

        nodes!.push(type);

        $.OPTION(() => {
          token = $.CONSUME($.T.And);
          node = $.mediaConditionWithoutOr(ctx);
        });
        if (token) {
          nodes!.push($.wrap(new Keyword((token as IToken).image, undefined, $.getLocationInfo(token as IToken), $.context), 'both'));
        }
        if (node) {
          nodes!.push(node);
        }
        let location = $.endRule();
        return new QueryCondition(nodes!, undefined, location, $.context);
      }
    }
  ]);
}

/** Doesn't include only, not, and, or, layer */
export function mediaType(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let token = $.OR([
    { ALT: () => $.CONSUME($.T.PlainIdent) },
    { ALT: () => $.CONSUME($.T.Screen) },
    { ALT: () => $.CONSUME($.T.Print) },
    { ALT: () => $.CONSUME($.T.All) }
  ]);
  return $.wrap(new Keyword(token.image, undefined, $.getLocationInfo(token), $.context), 'both');
}

export function mediaCondition(this: P, ctx: RuleContext = {}): Node {
  const $ = this;
  return $.OR([
    { ALT: () => $.mediaNot(ctx) },
    {
      ALT: () => {
        $.startRule();
        let nodes: Node[] = [];
        let node = $.mediaInParens(ctx);
        nodes!.push(node);
        $.MANY(() => {
          let rule =
            $.OR([
              { ALT: () => $.mediaAnd(ctx) },
              { ALT: () => $.mediaOr(ctx) }
            ]);
          nodes!.push(...rule);
        });
        // Only wrap in QueryCondition if there are multiple nodes (AND/OR operators)
        // Otherwise, return the single node directly (like Sequence does)
        if (nodes!.length === 1) {
          $.endRule();
          return nodes![0]!;
        }
        return new QueryCondition(nodes!, undefined, $.endRule(), $.context);
      }
    }
  ]);
}

export function mediaConditionWithoutOr(this: P, ctx: RuleContext = {}) {
  const $ = this;
  return $.OR([
    { ALT: () => $.mediaNot(ctx) },
    {
      ALT: () => {
        $.startRule();
        let nodes: Node[] = [];
        let node = $.mediaInParens(ctx);
        nodes!.push(node);
        $.MANY(() => {
          let rule = $.mediaAnd(ctx);
          nodes!.push(...rule);
        });

        // Only wrap in QueryCondition if there are multiple nodes (AND operators)
        // Otherwise, return the single node directly (like Sequence does)
        if (nodes!.length === 1) {
          $.endRule();
          return nodes![0]!;
        }
        return new QueryCondition(nodes!, undefined, $.endRule(), $.context);
      }
    }
  ]);
}

export function mediaNot(this: P, ctx: RuleContext = {}): Node {
  const $ = this;
  $.startRule();

  let token = $.CONSUME($.T.Not);
  let node = $.mediaInParens(ctx);

  return new QueryCondition([
    $.wrap(new Keyword(token.image, undefined, $.getLocationInfo(token), $.context), 'both'),
    node
  ], undefined, $.endRule(), $.context);
}

/** Returns an array */
export function mediaAnd(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let token = $.CONSUME($.T.And);
  let node = $.mediaInParens(ctx);

  return [
    $.wrap(new Keyword(token.image, undefined, $.getLocationInfo(token), $.context), 'both'),
    node
  ];
}

/** Returns an array */
export function mediaOr(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let token = $.CONSUME($.T.Or);
  let node = $.mediaInParens(ctx);

  return [
    $.wrap(new Keyword(token.image, undefined, $.getLocationInfo(token), $.context), 'both'),
    node
  ];
}

export function mediaInParens(this: P, ctx: RuleContext = {}): Node {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.LParen);

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
  let node = $.OR([
    { ALT: () => $.mediaCondition(ctx) },
    { ALT: () => $.mediaFeature(ctx) }
  ]);
  $.CONSUME($.T.RParen);

  let location = $.endRule();
  return $.wrap(new Paren($.wrap(node, 'both'), undefined, location, $.context));
}

/**
    An identifier is a legal value, so it can be
    ambiguous which side of the expression we're on
    while parsing. The browser figures this out
    post-parsing.
  */
export function mediaFeature(this: P, ctx: RuleContext = {}) {
  const $ = this;
  return $.OR([
    {
      ALT: () => {
        $.startRule();
        let rule: Node | undefined;
        let ident = $.CONSUME($.T.Ident);
        $.OPTION(() => {
          rule = $.OR([
            {
              ALT: () => {
                $.CONSUME($.T.Colon);
                let value = $.mfValue(ctx);
                let location = $.endRule();
                return $.wrap(
                  new Declaration({
                    name: $.wrap(new Any(ident.image, { role: 'property' }), true),
                    value: $.wrap(value)
                  }, undefined, location, $.context),
                  'both');
              }
            },
            {
              ALT: (): Node => {
                let seq = $.mediaRange(ctx);
                let [startOffset, startLine, startColumn] = $.endRule();
                const identNode = $.wrap(new Any(ident.image, { role: 'ident' }, $.getLocationInfo(ident), $.context));
                const arr = [identNode, ...seq.data];
                seq.location[0] = startOffset!;
                seq.location[1] = startLine!;
                seq.location[2] = startColumn!;
                return new QueryCondition(arr, undefined, seq.location as LocationInfo, $.context);
              }
            },
            {
              ALT: (): Node => {
                let op = $.mfComparison(ctx);
                let value = $.mfNonIdentifierValue(ctx);

                let location = $.endRule();
                return new QueryCondition([
                  $.wrap(new Any(ident.image, { role: 'ident' }, $.getLocationInfo(ident), $.context)),
                  $.wrap(new Any(op.image, { role: 'operator' }, $.getLocationInfo(op), $.context), 'both'),
                  value
                ], undefined, location, $.context);
              }
            }
          ]);
        });
        if (!rule) {
          let location = $.endRule();
          let anyNode = new Keyword(ident.image, undefined, location, $.context);
          return $.wrap(new QueryCondition([anyNode], undefined, location, $.context), 'both');
        }
        return rule;
      }
    },
    {
      ALT: () => {
        $.startRule();
        let rule1 = $.mfNonIdentifierValue({ ...ctx });
        return $.OR([
          {
            ALT: () => {
              // Try range first: `value < ident < value` or `value < ident`
              let seq = $.mediaRange({ ...ctx });
              let [startOffset, startLine, startColumn] = $.endRule();
              const arr = [rule1, ...seq.data];
              seq.location[0] = startOffset!;
              seq.location[1] = startLine!;
              seq.location[2] = startColumn!;
              return new QueryCondition(arr, undefined, seq.location as LocationInfo, $.context);
            }
          },
          {
            ALT: () => {
              // Simple comparison: `value = ident`  (Eq not handled by mediaRange)
              let op = $.mfComparison({ ...ctx });
              let value = $.CONSUME($.T.Ident);
              let location = $.endRule();
              return new QueryCondition([
                rule1,
                $.wrap(new Any(op.image, { role: 'operator' }, $.getLocationInfo(op), $.context)),
                $.wrap(new Any(value.image, { role: 'ident' }, $.getLocationInfo(value), $.context), 'both')
              ], undefined, location, $.context);
            }
          }
        ]);
      }
    }
  ]);
}

/**
 * @note Both comparison operators have to match.
 */
export function mediaRange(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  let op1: IToken;
  let val1: IToken;
  let op2: IToken | undefined;
  let val2: Node | undefined;

  let val = $.OR([
    {
      ALT: () => {
        let op1 = $.CONSUME($.T.MfLt);
        let val1 = $.CONSUME($.T.Ident);
        let op2: IToken | undefined;
        let val2: Node | undefined;
        $.OPTION(() => {
          op2 = $.CONSUME($.T.MfLt);
          val2 = $.mfValue(ctx);
        });
        return [op1, val1, op2, val2];
      }
    },
    {
      ALT: () => {
        let op1 = $.CONSUME($.T.MfGt);
        let val1 = $.CONSUME($.T.Ident);
        let op2: IToken | undefined;
        let val2: Node | undefined;
        $.OPTION(() => {
          op2 = $.CONSUME($.T.MfGt);
          val2 = $.mfValue(ctx);
        });
        return [op1, val1, op2, val2];
      }
    }
  ]);

  ([op1!, val1!, op2, val2] = val as any);

  let location = $.endRule();
  let nodes: Node[] = [
    $.wrap(new Any(op1!.image, { role: 'operator' }, $.getLocationInfo(op1!), $.context)),
    $.wrap(new Any(val1!.image, { role: 'ident' }, $.getLocationInfo(val1!), $.context), 'both')
  ];
  if (op2) {
    nodes.push($.wrap(new Any(op2.image, { role: 'operator' }, $.getLocationInfo(op2), $.context)));
    nodes.push($.wrap(val2!, 'both'));
  }
  return new Sequence(nodes, undefined, location, $.context);
}

export function mfNonIdentifierValue(this: P, ctx: RuleContext = {}) {
  const $ = this;
  return $.OR([
    {
      ALT: () => {
        $.startRule();
        let num1 = $.CONSUME($.T.Number);
        let num2: IToken | undefined;
        $.OPTION(() => {
          $.CONSUME($.T.Slash);
          num2 = $.CONSUME($.T.Number);
        });
        let location = $.endRule();
        let num1Node = $.wrap($.processValueToken(num1), 'both');
        if (!num2) {
          return num1Node;
        }
        let num2Node = $.wrap($.processValueToken(num2), 'both');
        return new List([num1Node, num2Node], { sep: '/' }, location, $.context);
      }
    },
    {
      ALT: () => {
        let dim = $.CONSUME($.T.Dimension);
        return $.wrap($.processValueToken(dim), 'both');
      }
    }
  ]);
}

export function mfValue(this: P, ctx: RuleContext = {}) {
  const $ = this;
  return $.OR([
    { ALT: () => $.mfNonIdentifierValue(ctx) },
    {
      ALT: () => {
        let token = $.CONSUME($.T.Ident);
        return $.wrap(new Any(token.image, { role: 'ident' }, $.getLocationInfo(token), $.context), 'both');
      }
    }
  ]);
}

export function mfComparison(this: P, ctx: RuleContext = {}) {
  const $ = this;
  return $.OR([
    { ALT: () => $.CONSUME($.T.MfLt) },
    { ALT: () => $.CONSUME($.T.MfGt) },
    { ALT: () => $.CONSUME($.T.Eq) }
  ]);
}

/**
 * @see https://www.w3.org/TR/css-page-3/
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@page
 */
export function pageAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  let name = $.CONSUME($.T.AtPage);
  let selector: Node[] = [];
  $.MANY_SEP({
    SEP: $.T.Comma,
    DEF: () => selector.push($.pageSelector(ctx))
  });
  $.CONSUME($.T.LCurly);
  let rules = $.declarationList(ctx) as Rules;
  $.CONSUME($.T.RCurly);

  let location = $.endRule();
  return new AtRule({
    name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), $.context), true),
    prelude: selector.length && String(selector[0]!.valueOf()) !== ''
      ? $.wrap(new List(selector, undefined, $.getLocationFromNodes(selector), $.context), true)
      : undefined,
    rules
  }, undefined, location, $.context);
}

export function pageSelector(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  let token = '';

  $.OPTION(() => token += $.CONSUME($.T.Ident).image);
  $.MANY({
    GATE: () => $.isType($.T.Colon) && $.noSep(1),
    DEF: () => {
      token += $.CONSUME($.T.Colon).image;
      token += $.CONSUME($.T.PagePseudoClassKeywords).image;
    }
  });

  let location = $.endRule();
  return $.wrap(new BasicSelector(token, undefined, location, $.context));
}

export function fontFaceAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  let name = $.CONSUME($.T.AtFontFace);
  $.CONSUME($.T.LCurly);
  let rules = $.declarationList(ctx) as Rules;
  $.CONSUME($.T.RCurly);

  let location = $.endRule();
  return new AtRule({
    name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), $.context), true),
    rules
  }, undefined, location, $.context);
}

export function keyframesAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  let atTok = $.CONSUME($.T.AtKeyframes);
  // prelude: a single animation name
  let preludeNode: Node | undefined = $.keyframesName(ctx);
  $.CONSUME($.T.LCurly);
  const rules = $.declarationList(ctx) as Rules;
  $.CONSUME($.T.RCurly);

  return new AtRule({
    name: $.wrap(new Any(atTok.image, { role: 'atkeyword' }, $.getLocationInfo(atTok), $.context), true),
    prelude: preludeNode ? $.wrap(preludeNode, 'both') : undefined,
    // Include isolated comments inside the keyframes body
    rules
  }, undefined, $.endRule(), $.context);
}

/**
 * Keyframes name prelude
 * CSS: Ident | String
 */
export function keyframesName(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let node: Node | undefined;
  $.OR([
    {
      ALT: () => {
        const tok = $.CONSUME($.T.Ident);
        node = $.wrap($.processValueToken(tok));
      }
    },
    {
      ALT: () => {
        node = $.string(ctx);
      }
    }
  ]);
  return node!;
}

/**
 * Parses @container at-rule with optional container name and container query list.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container
 */
export function containerAtRule(this: P, ctx: RuleContext = {}, preludeRule?: PreludeRule): Node {
  const $ = this;
  $.startRule();
  const name = $.CONSUME($.T.AtContainer);
  let prelude: Node | undefined;
  let containerName: Node | undefined;
  let queryList: Node | undefined;

  if (preludeRule) {
    const resolvedPreludeRule = resolvePreludeRule(this, preludeRule);
    if (typeof resolvedPreludeRule === 'function') {
      (resolvedPreludeRule as any).call(this, ctx);
    }
  } else {
    $.OR([
      {
        GATE: () => {
          const next = $.LA(1);
          // If it's a FunctionStart (like `size(` or `style(`), it's a query function, not a container name
          if (tokenMatches(next, $.T.FunctionStart)) {
            return false;
          }
          // If it's an Ident (not a query keyword), it could be a container name
          return tokenTypeInSet(next.tokenType, $.IDENT_LIKE_START)
            && next.image.toLowerCase() !== 'not'
            && next.image.toLowerCase() !== 'only'
            && next.image.toLowerCase() !== 'and'
            && next.image.toLowerCase() !== 'or';
        },
        ALT: () => {
          containerName = $.containerName(ctx);
          queryList = $.containerQueryList(ctx);
        }
      },
      {
        ALT: () => {
          queryList = $.containerQueryList(ctx);
        }
      }
    ]);

    queryList = queryList!;
  }

  $.CONSUME($.T.LCurly);
  const rules = $.atRuleBody(ctx) as Rules;
  $.CONSUME($.T.RCurly);

  let preludeNodes: Node[] = [];
  if (!prelude && containerName) {
    preludeNodes.push($.wrap(containerName, true));
  }
  if (!prelude) {
    preludeNodes.push($.wrap(queryList!, containerName ? true : 'both'));
    prelude = preludeNodes.length
      ? $.wrap(new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), $.context), 'both')
      : undefined;
  }
  return new AtRule({
    name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), $.context), true),
    prelude,
    rules
  }, { nestable: true }, $.endRule(), $.context);
}

/**
 * Container name: an optional identifier
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-name
 */
export function containerName(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let token = $.CONSUME($.T.Ident);
  return $.wrap(new Any(token.image, { role: 'ident' }, $.getLocationInfo(token), $.context), 'both');
}

/**
 * Container query list: comma-separated list of container queries
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-query
 */
export function containerQueryList(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  let queries: Node[] = [];
  $.AT_LEAST_ONE_SEP({
    SEP: $.T.Comma,
    DEF: () => {
      let query = $.containerQuery(ctx);
      queries.push(query);
    }
  });

  if (queries!.length === 1) {
    $.endRule();
    return queries![0]!;
  }
  return new List(queries!, undefined, $.endRule(), $.context);
}

/**
 * Container query: a container condition or container query type function
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-query
 */
export function containerQuery(this: P, ctx: RuleContext = {}): Node {
  const $ = this;
  return $.OR([
    {
      // Container query type function: any FunctionStart token
      GATE: () => tokenMatches($.LA(1), $.T.FunctionStart),
      ALT: () => {
        $.startRule();
        let nodes: Node[] = [];

        // Parse first function call
        const funcStart = $.CONSUME($.T.FunctionStart);
        const funcName = funcStart.image.slice(0, -1);
        let args: Node[] = [];
        $.AT_LEAST_ONE_SEP({
          SEP: $.T.Comma,
          DEF: () => {
            // Arguments can be QueryConditions, declarations, or just a name (Any)
            $.OR([
              {
                // QueryCondition: starts with LParen or Not
                GATE: () => tokenTypeInSet($.LA(1).tokenType, $.QUERY_CONDITION_START),
                ALT: () => {
                  const arg = $.containerCondition(ctx);
                  args!.push($.wrap(arg));
                }
              },
              {
                // Declaration: starts with Ident or CustomProperty followed by Assign (colon)
                GATE: () => {
                  const after = $.LA(2);
                  return tokenTypeInSet($.LA(1).tokenType, $.DECL_VALUE_NAME_START)
                    && after
                    && tokenMatches(after, $.T.Assign);
                },
                ALT: () => {
                  const arg = $.declaration(ctx);
                  args!.push($.wrap(arg));
                }
              },
              {
                // Just a name (Any): Ident, PlainIdent, or CustomProperty without Assign
                GATE: () => {
                  const after = $.LA(2);
                  return tokenTypeInSet($.LA(1).tokenType, $.DECL_VALUE_NAME_START)
                    && (!after || !tokenMatches(after, $.T.Assign));
                },
                ALT: () => {
                  let nameToken: IToken | undefined;
                  $.OR([
                    {
                      GATE: () => $.isType($.T.Ident),
                      ALT: () => nameToken = $.CONSUME($.T.Ident)
                    },
                    {
                      GATE: () => $.isType($.T.PlainIdent),
                      ALT: () => nameToken = $.CONSUME($.T.PlainIdent)
                    },
                    {
                      ALT: () => nameToken = $.CONSUME($.T.CustomProperty)
                    }
                  ]);
                  if (nameToken) {
                    const nameNode = $.wrap(new Any(nameToken.image, { role: 'name' }, $.getLocationInfo(nameToken), $.context), true);
                    args!.push(nameNode);
                  }
                }
              }
            ]);
          }
        });
        $.CONSUME($.T.RParen);

        const call = new Call({
          name: funcName,
          args: args!.length > 0 ? new List(args!) : undefined
        }, undefined, $.getLocationFromNodes([funcStart]), $.context);
        nodes!.push(call);

        // Check for and/or after the function call (similar to mediaCondition)
        $.MANY({
          GATE: () => $.isType($.T.And) || $.isType($.T.Or),
          DEF: () => {
            let rule = $.OR([
              {
                GATE: () => $.isType($.T.And),
                ALT: () => $.containerAnd(ctx)
              },
              {
                ALT: () => $.containerOr(ctx)
              }
            ]) as Node[];
            nodes!.push(...rule);
          }
        });

        const location = $.endRule();
        // Always wrap function calls in QueryCondition (even if alone)
        return new QueryCondition(nodes!, undefined, location, $.context);
      }
    },
    {
      // Regular container condition
      ALT: () => $.containerCondition(ctx)
    }
  ]);
}

/**
 * Container condition: similar to media condition but without mediaType variant
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-query
 */
export function containerCondition(this: P, ctx: RuleContext = {}): Node {
  const $ = this;
  return $.OR([
    {
      // Handle `not` followed by a container query type function (e.g., `not scroll-state(...)`)
      GATE: () => {
        const next = $.LA(1);
        if (next.tokenType === $.T.Not) {
          const afterNot = $.LA(2);
          return afterNot && tokenMatches(afterNot, $.T.FunctionStart);
        }
        return false;
      },
      ALT: () => {
        $.startRule();
        const notToken = $.CONSUME($.T.Not);
        // Parse the function call as a container query
        const funcQuery = $.containerQuery(ctx);
        return new QueryCondition([
          $.wrap(new Keyword(notToken.image, undefined, $.getLocationInfo(notToken), $.context), 'both'),
          funcQuery
        ], undefined, $.endRule(), $.context);
      }
    },
    {
      // Custom container condition that handles `and not` and `or not`
      GATE: () => $.isType($.T.LParen),
      ALT: () => {
        $.startRule();
        let nodes: Node[] = [];
        let node = $.containerInParens(ctx);
        nodes!.push(node);
        $.MANY({
          GATE: () => $.isType($.T.And) || $.isType($.T.Or),
          DEF: () => {
            let rule = $.OR([
              {
                GATE: () => $.isType($.T.And),
                ALT: () => $.containerAnd(ctx)
              },
              {
                ALT: () => $.containerOr(ctx)
              }
            ]) as Node[];
            nodes!.push(...rule);
          }
        });
        if (nodes!.length === 1) {
          $.endRule();
          return nodes![0]!;
        }
        return new QueryCondition(nodes!, undefined, $.endRule(), $.context);
      }
    },
    {
      // For cases not starting with LParen (like `not` at start), reuse media condition logic
      GATE: () => !$.isType($.T.LParen),
      ALT: () => $.mediaCondition(ctx)
    }
  ]);
}

/**
 * Container and: similar to mediaAnd but can handle `and not` and function calls
 */
export function containerAnd(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let token = $.CONSUME($.T.And);
  // Handle `and not` or `and` followed by containerInParens or function call
  let node: Node | undefined;
  $.OR([
    {
      GATE: () => $.isType($.T.Not),
      ALT: () => {
        const notToken = $.CONSUME($.T.Not);
        node = $.containerInParens(ctx);
        const notNode = $.wrap(new Keyword(notToken.image, undefined, $.getLocationInfo(notToken), $.context), 'both');
        node = new QueryCondition([notNode, node!], undefined, $.getLocationFromNodes([notNode, node!]), $.context);
      }
    },
    {
      GATE: () => tokenMatches($.LA(1), $.T.FunctionStart),
      ALT: () => {
        // Parse function call (reuse containerQuery logic)
        const funcStart = $.CONSUME($.T.FunctionStart);
        const funcName = funcStart.image.slice(0, -1);
        let args: Node[] = [];
        $.AT_LEAST_ONE_SEP({
          SEP: $.T.Comma,
          DEF: () => {
            $.OR([
              {
                GATE: () => tokenTypeInSet($.LA(1).tokenType, $.QUERY_CONDITION_START),
                ALT: () => {
                  const arg = $.containerCondition(ctx);
                  args!.push($.wrap(arg));
                }
              },
              {
                GATE: () => {
                  const after = $.LA(2);
                  return tokenTypeInSet($.LA(1).tokenType, $.DECL_VALUE_NAME_START)
                    && after
                    && tokenMatches(after, $.T.Assign);
                },
                ALT: () => {
                  const arg = $.declaration(ctx);
                  args!.push($.wrap(arg));
                }
              },
              {
                GATE: () => {
                  const after = $.LA(2);
                  return tokenTypeInSet($.LA(1).tokenType, $.DECL_VALUE_NAME_START)
                    && (!after || !tokenMatches(after, $.T.Assign));
                },
                ALT: () => {
                  let nameToken: IToken | undefined;
                  $.OR([
                    {
                      GATE: () => $.isType($.T.Ident),
                      ALT: () => nameToken = $.CONSUME($.T.Ident)
                    },
                    {
                      GATE: () => $.isType($.T.PlainIdent),
                      ALT: () => nameToken = $.CONSUME($.T.PlainIdent)
                    },
                    {
                      ALT: () => nameToken = $.CONSUME($.T.CustomProperty)
                    }
                  ]);
                  if (nameToken) {
                    const nameNode = $.wrap(new Any(nameToken.image, { role: 'name' }, $.getLocationInfo(nameToken), $.context), true);
                    args!.push(nameNode);
                  }
                }
              }
            ]);
          }
        });
        $.CONSUME($.T.RParen);
        node = new Call({
          name: funcName,
          args: args!.length > 0 ? new List(args!) : undefined
        }, undefined, $.getLocationFromNodes([funcStart]), $.context);
      }
    },
    {
      ALT: () => {
        node = $.containerInParens(ctx);
      }
    }
  ]);
  if (node) {
    return [
      $.wrap(new Keyword(token.image, undefined, $.getLocationInfo(token), $.context), 'both'),
      node
    ];
  }
}

/**
 * Container or: similar to mediaOr but can handle `or not` and function calls
 */
export function containerOr(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let token = $.CONSUME($.T.Or);
  // Handle `or not` or `or` followed by containerInParens or function call
  let node: Node | undefined;
  $.OR([
    {
      GATE: () => $.isType($.T.Not),
      ALT: () => {
        const notToken = $.CONSUME($.T.Not);
        node = $.containerInParens(ctx);
        const notNode = $.wrap(new Keyword(notToken.image, undefined, $.getLocationInfo(notToken), $.context), 'both');
        node = new QueryCondition([notNode, node!], undefined, $.getLocationFromNodes([notNode, node!]), $.context);
      }
    },
    {
      GATE: () => tokenMatches($.LA(1), $.T.FunctionStart),
      ALT: () => {
        // Parse function call (reuse containerQuery logic)
        const funcStart = $.CONSUME($.T.FunctionStart);
        const funcName = funcStart.image.slice(0, -1);
        let args: Node[] = [];
        $.AT_LEAST_ONE_SEP({
          SEP: $.T.Comma,
          DEF: () => {
            $.OR([
              {
                GATE: () => tokenTypeInSet($.LA(1).tokenType, $.QUERY_CONDITION_START),
                ALT: () => {
                  const arg = $.containerCondition(ctx);
                  args!.push($.wrap(arg));
                }
              },
              {
                GATE: () => {
                  const after = $.LA(2);
                  return tokenTypeInSet($.LA(1).tokenType, $.DECL_VALUE_NAME_START)
                    && after
                    && tokenMatches(after, $.T.Assign);
                },
                ALT: () => {
                  const arg = $.declaration(ctx);
                  args!.push($.wrap(arg));
                }
              },
              {
                GATE: () => {
                  const after = $.LA(2);
                  return tokenTypeInSet($.LA(1).tokenType, $.DECL_VALUE_NAME_START)
                    && (!after || !tokenMatches(after, $.T.Assign));
                },
                ALT: () => {
                  let nameToken: IToken | undefined;
                  $.OR([
                    {
                      GATE: () => $.isType($.T.Ident),
                      ALT: () => nameToken = $.CONSUME($.T.Ident)
                    },
                    {
                      GATE: () => $.isType($.T.PlainIdent),
                      ALT: () => nameToken = $.CONSUME($.T.PlainIdent)
                    },
                    {
                      ALT: () => nameToken = $.CONSUME($.T.CustomProperty)
                    }
                  ]);
                  if (nameToken) {
                    const nameNode = $.wrap(new Any(nameToken.image, { role: 'name' }, $.getLocationInfo(nameToken), $.context), true);
                    args!.push(nameNode);
                  }
                }
              }
            ]);
          }
        });
        $.CONSUME($.T.RParen);
        node = new Call({
          name: funcName,
          args: args!.length > 0 ? new List(args!) : undefined
        }, undefined, $.getLocationFromNodes([funcStart]), $.context);
      }
    },
    {
      ALT: () => {
        node = $.containerInParens(ctx);
      }
    }
  ]);
  if (node) {
    return [
      $.wrap(new Keyword(token.image, undefined, $.getLocationInfo(token), $.context), 'both'),
      node
    ];
  }
}

/**
 * Container in parens: similar to media in parens
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-query
 */
export function containerInParens(this: P, ctx: RuleContext = {}) {
  const $ = this;
  // Reuse media in parens logic since container queries use the same syntax
  return $.mediaInParens(ctx);
}

/**
 * Container feature: similar to media feature
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-query
 */
export function containerFeature(this: P, ctx: RuleContext = {}) {
  const $ = this;
  // Reuse media feature logic since container queries use the same syntax
  return $.mediaFeature(ctx);
}

// scopeAtRule: @scope <prelude>? { main }
export function scopeAtRule(this: P, ctx: RuleContext = {}, preludeRule?: PreludeRule) {
  const $ = this;
  $.startRule();
  const name = $.CONSUME($.T.AtScope);
  let prelude: Node | undefined;
  if (preludeRule) {
    const resolvedPreludeRule = resolvePreludeRule(this, preludeRule);
    if (typeof resolvedPreludeRule === 'function') {
      prelude = (resolvedPreludeRule as any).call(this, ctx);
    }
  } else {
    const preludeNodes: Node[] = [];
    $.MANY({
      GATE: () => !$.isType($.T.LCurly) && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => preludeNodes.push($.wrap($.anyOuterValue(ctx)))
    });
    prelude = preludeNodes.length
      ? $.wrap(new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), $.context), 'both')
      : undefined;
  }
  $.CONSUME($.T.LCurly);
  const rules = $.atRuleBody(ctx) as Rules;
  $.CONSUME($.T.RCurly);
  return new AtRule({
    name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), $.context), true),
    prelude,
    rules
  }, { nestable: true }, $.endRule(), $.context);
}

// documentAtRule (non-standard): @document <prelude>? { main }
export function documentAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  const name = $.CONSUME($.T.AtDocument);
  const preludeNodes: Node[] = [];
  $.MANY({
    GATE: () => !$.isType($.T.LCurly) && $.LA(1).tokenType.name !== 'EOF',
    DEF: () => preludeNodes.push($.wrap($.anyOuterValue(ctx)))
  });
  $.CONSUME($.T.LCurly);
  const rules = $.atRuleBody(ctx) as Rules;
  $.CONSUME($.T.RCurly);
  return new AtRule({
    name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), $.context), true),
    prelude: preludeNodes.length ? $.wrap(new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), $.context), 'both') : undefined,
    rules
  }, undefined, $.endRule(), $.context);
}
