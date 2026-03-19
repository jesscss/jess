// Methods to be mixed into CssRecursiveParser
import type { IToken } from '@chevrotain/types';
import type { CssRecursiveParser, RuleContext } from '../cssRecursiveParser.js';
import { tokenMatcher } from '../cssRecursiveParser.js';
import {
  type LocationInfo,
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
    { GATE: () => $.isType($.T.AtContainer), ALT: () => $.SUBRULE($.containerAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType($.T.AtScope), ALT: () => $.SUBRULE($.scopeAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType($.T.AtDocument), ALT: () => $.SUBRULE($.documentAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType($.T.AtLayer), ALT: () => $.SUBRULE($.layerAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType($.T.AtKeyframes), ALT: () => $.SUBRULE($.keyframesAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType($.T.AtImport), ALT: () => $.SUBRULE($.importAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType($.T.AtMedia), ALT: () => $.SUBRULE($.mediaAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType($.T.AtPage), ALT: () => $.SUBRULE($.pageAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType($.T.AtFontFace), ALT: () => $.SUBRULE($.fontFaceAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType($.T.AtSupports), ALT: () => $.SUBRULE($.supportsAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType($.T.AtNested), ALT: () => $.SUBRULE($.nestedAtRule, { ARGS: [ctx] }) },
    { GATE: () => $.isType($.T.AtNonNested), ALT: () => $.SUBRULE($.nonNestedAtRule, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.unknownAtRule, { ARGS: [ctx] }) }
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
      ALT: () => $.SUBRULE($.containerAtRule, { ARGS: [{ ...ctx, inner: true }] })
    },
    {
      GATE: () => $.isType($.T.AtScope),
      ALT: () => $.SUBRULE($.scopeAtRule, { ARGS: [{ ...ctx, inner: true }] })
    },
    {
      GATE: () => $.isType($.T.AtDocument),
      ALT: () => $.SUBRULE($.documentAtRule, { ARGS: [{ ...ctx, inner: true }] })
    },
    {
      GATE: () => $.isType($.T.AtLayer),
      ALT: () => $.SUBRULE($.layerAtRule, { ARGS: [{ ...ctx, inner: true }] })
    },
    {
      GATE: () => $.isType($.T.AtKeyframes),
      ALT: () => $.SUBRULE($.keyframesAtRule, { ARGS: [{ ...ctx, inner: true }] })
    },
    {
      GATE: () => $.isType($.T.AtMedia),
      ALT: () => $.SUBRULE($.mediaAtRule, { ARGS: [{ ...ctx, inner: true }] })
    },
    {
      GATE: () => $.isType($.T.AtSupports),
      ALT: () => $.SUBRULE($.supportsAtRule, { ARGS: [{ ...ctx, inner: true }] })
    },
    {
      GATE: () => $.isType($.T.AtNested),
      ALT: () => $.SUBRULE($.nestedAtRule, { ARGS: [{ ...ctx, inner: true }] })
    },
    {
      ALT: () => $.SUBRULE($.unknownAtRule, { ARGS: [{ ...ctx, inner: true }] })
    }
  ]) as Node;
}

/**
 * @see https://www.w3.org/TR/css-nesting-1/#conditionals
 */
export function atRuleBody(this: P, ctx: RuleContext = {}): Node {
  const $ = this;
  return $.OR([
    {
      GATE: () => !ctx.inner,
      ALT: () => $.SUBRULE($.main, { ARGS: [ctx] })
    },
    {
      GATE: () => !!ctx.inner,
      ALT: () => $.SUBRULE($.declarationList, { ARGS: [ctx] })
    }
  ]) as Node;
}

export function mediaAtRule(this: P, ctx: RuleContext = {}, preludeRule?: PreludeRule) {
  const $ = this;
  $.startRule();
  let name = $.CONSUME($.T.AtMedia);
  let rules: Rules;
  const resolvedPreludeRule = resolvePreludeRule(this, preludeRule);
  const prelude: Node = typeof resolvedPreludeRule === 'function'
    ? (resolvedPreludeRule as (ctx: RuleContext) => Node).call(this, ctx)
    : $.SUBRULE($.mediaQueryList, { ARGS: [ctx] }) as Node;
  $.CONSUME($.T.LCurly);
  rules = $.SUBRULE($.atRuleBody, { ARGS: [ctx] }) as Rules;
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
      const query = $.SUBRULE($.mediaQuery, { ARGS: [ctx] }) as Node;
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
    { ALT: () => $.SUBRULE($.mediaCondition, { ARGS: [ctx] }) as Node },
    {
      ALT: () => {
        $.startRule();

        let notOrOnlyToken: IToken | undefined;
        let andToken: IToken | undefined;
        let node: Node | undefined;
        let nodes: Node[] = [];

        $.OPTION(() => {
          $.OR([
            { ALT: () => notOrOnlyToken = $.CONSUME($.T.Not) },
            { ALT: () => notOrOnlyToken = $.CONSUME($.T.Only) }
          ]);
        });

        if (notOrOnlyToken) {
          nodes!.push($.wrap(new Keyword(notOrOnlyToken.image, undefined, $.getLocationInfo(notOrOnlyToken), $.context), 'both'));
        }
        const type = $.SUBRULE($.mediaType) as Node;
        nodes!.push(type);

        $.OPTION(() => {
          andToken = $.CONSUME($.T.And);
          node = $.SUBRULE($.mediaConditionWithoutOr, { ARGS: [ctx] }) as Node;
        });
        if (andToken) {
          nodes!.push($.wrap(new Keyword(andToken.image, undefined, $.getLocationInfo(andToken), $.context), 'both'));
        }
        if (node) {
          nodes!.push(node);
        }
        const location = $.endRule();
        return new QueryCondition(nodes!, undefined, location, $.context);
      }
    }
  ]) as Node;
}

/** Doesn't include only, not, and, or, layer */
export function mediaType(this: P) {
  const $ = this;
  const token = $.OR([
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
    { ALT: () => $.SUBRULE($.mediaNot, { ARGS: [ctx] }) },
    {
      ALT: () => {
        $.startRule();
        const nodes: Node[] = [];
        const node = $.SUBRULE($.mediaInParens, { ARGS: [ctx] }) as Node;
        nodes!.push(node);
        $.MANY(() => {
          const rule = $.OR([
            { ALT: () => $.SUBRULE($.mediaAnd, { ARGS: [ctx] }) },
            { ALT: () => $.SUBRULE($.mediaOr, { ARGS: [ctx] }) }
          ]);
          if (Array.isArray(rule)) nodes!.push(...rule);
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
  ]) as Node;
}

export function mediaConditionWithoutOr(this: P, ctx: RuleContext = {}) {
  const $ = this;
  return $.OR([
    { ALT: () => $.SUBRULE($.mediaNot, { ARGS: [ctx] }) },
    {
      ALT: () => {
        $.startRule();
        let nodes: Node[] = [];
        let node = $.SUBRULE($.mediaInParens, { ARGS: [ctx] });
        nodes!.push(node);
        $.MANY(() => {
          const rule = $.SUBRULE($.mediaAnd, { ARGS: [ctx] });
          if (Array.isArray(rule)) nodes!.push(...rule);
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
  ]) as Node;
}

export function mediaNot(this: P, ctx: RuleContext = {}): Node {
  const $ = this;
  $.startRule();

  const token = $.CONSUME($.T.Not);
  const node = $.SUBRULE($.mediaInParens, { ARGS: [ctx] });

  return new QueryCondition([
    $.wrap(new Keyword(token.image, undefined, $.getLocationInfo(token), $.context), 'both'),
    node
  ], undefined, $.endRule(), $.context);
}

/** Returns an array */
export function mediaAnd(this: P, ctx: RuleContext = {}) {
  const $ = this;
  const token = $.CONSUME($.T.And);
  const node = $.SUBRULE($.mediaInParens, { ARGS: [ctx] });

  return [
    $.wrap(new Keyword(token.image, undefined, $.getLocationInfo(token), $.context), 'both'),
    node
  ];
}

/** Returns an array */
export function mediaOr(this: P, ctx: RuleContext = {}) {
  const $ = this;
  const token = $.CONSUME($.T.Or);
  const node = $.SUBRULE($.mediaInParens, { ARGS: [ctx] });

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
  const node = $.OR([
    { ALT: () => $.SUBRULE($.mediaCondition, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.mediaFeature, { ARGS: [ctx] }) }
  ]) as Node;
  $.CONSUME($.T.RParen);

  const location = $.endRule();
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
        const ident = $.CONSUME($.T.Ident);
        $.OPTION({
          DEF: () => {
            rule = $.OR([
              {
                ALT: () => {
                  $.CONSUME($.T.Colon);
                  const value = $.SUBRULE($.mfValue, { ARGS: [ctx] }) as Node;
                  const location = $.endRule();
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
                  const seq = $.SUBRULE($.mediaRange, { ARGS: [ctx] }) as Sequence;
                  const [startOffset, startLine, startColumn] = $.endRule();
                  const identNode = $.wrap(new Any(ident.image, { role: 'ident' }, $.getLocationInfo(ident), $.context));
                  const arr = seq?.data ? [identNode, ...seq.data] : [identNode];
                  const loc: LocationInfo = [startOffset!, startLine!, startColumn!, startOffset!, startLine!, startColumn!];
                  if (seq?.location) {
                    seq.location[0] = startOffset!;
                    seq.location[1] = startLine!;
                    seq.location[2] = startColumn!;
                    Object.assign(loc, seq.location);
                  }
                  return new QueryCondition(arr, undefined, loc, $.context);
                }
              },
              {
                ALT: (): Node => {
                  const op = $.SUBRULE($.mfComparison, { ARGS: [ctx] });
                  const value = $.SUBRULE($.mfNonIdentifierValue, { ARGS: [ctx] }) as Node;

                  const location = $.endRule();
                  return new QueryCondition([
                    $.wrap(new Any(ident.image, { role: 'ident' }, $.getLocationInfo(ident), $.context)),
                    $.wrap(new Any(op.image, { role: 'operator' }, $.getLocationInfo(op), $.context), 'both'),
                    value
                  ], undefined, location, $.context);
                }
              }
            ]) as Node;
          }
        });
        if (!rule) {
          const location = $.endRule();
          const anyNode = new Keyword(ident.image, undefined, location, $.context);
          return $.wrap(new QueryCondition([anyNode], undefined, location, $.context), 'both');
        }
        return rule;
      }
    },
    {
      ALT: () => {
        $.startRule();
        const rule1 = $.mfNonIdentifierValue({ ...ctx });
        return $.OR([
          {
            ALT: () => {
              // Try range first: `value < ident < value` or `value < ident`
              const seq = $.SUBRULE($.mediaRange, { ARGS: [{ ...ctx }] }) as Sequence;
              const [startOffset, startLine, startColumn] = $.endRule();
              const arr = seq?.data ? [rule1, ...seq.data] : [rule1];
              const loc: LocationInfo = [startOffset!, startLine!, startColumn!, startOffset!, startLine!, startColumn!];
              if (seq?.location) {
                seq.location[0] = startOffset!;
                seq.location[1] = startLine!;
                seq.location[2] = startColumn!;
                Object.assign(loc, seq.location);
              }
              return new QueryCondition(arr, undefined, loc, $.context);
            }
          },
          {
            ALT: () => {
              // Simple comparison: `value = ident`  (Eq not handled by mediaRange)
              const op = $.SUBRULE($.mfComparison, { ARGS: [{ ...ctx }] });
              const value = $.CONSUME($.T.Ident);
              const location = $.endRule();
              return new QueryCondition([
                rule1,
                $.wrap(new Any(op.image, { role: 'operator' }, $.getLocationInfo(op), $.context)),
                $.wrap(new Any(value.image, { role: 'ident' }, $.getLocationInfo(value), $.context), 'both')
              ], undefined, location, $.context);
            }
          }
        ]) as Node;
      }
    }
  ]);
}

/**
 * @note Both comparison operators have to match.
 */
type MediaRangeResult = [IToken, IToken, IToken | undefined, Node | undefined];

export function mediaRange(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  const val = $.OR([
    {
      ALT: (): MediaRangeResult => {
        const op1 = $.CONSUME($.T.MfLt);
        const val1 = $.CONSUME($.T.Ident);
        let op2: IToken | undefined;
        let val2: Node | undefined;
        $.OPTION(() => {
          op2 = $.CONSUME($.T.MfLt);
          val2 = $.SUBRULE($.mfValue, { ARGS: [ctx] }) as Node;
        });
        return [op1, val1, op2, val2];
      }
    },
    {
      ALT: (): MediaRangeResult => {
        const op1 = $.CONSUME($.T.MfGt);
        const val1 = $.CONSUME($.T.Ident);
        let op2: IToken | undefined;
        let val2: Node | undefined;
        $.OPTION(() => {
          op2 = $.CONSUME($.T.MfGt);
          val2 = $.SUBRULE($.mfValue, { ARGS: [ctx] }) as Node;
        });
        return [op1, val1, op2, val2];
      }
    }
  ]) as MediaRangeResult;

  if (!Array.isArray(val)) {
    return new Sequence([], undefined, $.endRule(), $.context);
  }
  const [op1, val1, op2, val2] = val;

  const location = $.endRule();
  const nodes: Node[] = [
    $.wrap(new Any(op1!.image, { role: 'operator' }, $.getLocationInfo(op1!), $.context)),
    $.wrap(new Any(val1!.image, { role: 'ident' }, $.getLocationInfo(val1!), $.context), 'both')
  ];
  if (op2 && val2) {
    nodes.push($.wrap(new Any(op2.image, { role: 'operator' }, $.getLocationInfo(op2), $.context)));
    nodes.push($.wrap(val2, 'both'));
  }
  return new Sequence(nodes, undefined, location, $.context);
}

export function mfNonIdentifierValue(this: P, ctx: RuleContext = {}) {
  const $ = this;
  return $.OR([
    {
      ALT: () => {
        $.startRule();
        const num1 = $.CONSUME($.T.Number);
        let num2: IToken | undefined;
        $.OPTION(() => {
          $.CONSUME($.T.Slash);
          num2 = $.CONSUME($.T.Number);
        });
        const location = $.endRule();
        const num1Node = $.wrap($.processValueToken(num1), 'both');
        if (!num2) {
          return num1Node;
        }
        const num2Node = $.wrap($.processValueToken(num2), 'both');
        return new List([num1Node, num2Node], { sep: '/' }, location, $.context);
      }
    },
    {
      ALT: () => {
        const dim = $.CONSUME($.T.Dimension);
        return $.wrap($.processValueToken(dim), 'both');
      }
    }
  ]);
}

export function mfValue(this: P, ctx: RuleContext = {}) {
  const $ = this;
  return $.OR([
    { ALT: () => $.SUBRULE($.mfNonIdentifierValue, { ARGS: [ctx] }) },
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

  const name = $.CONSUME($.T.AtPage);
  const selector: Node[] = [];
  $.MANY_SEP({
    SEP: $.T.Comma,
    DEF: () => selector.push($.SUBRULE($.pageSelector) as Node)
  });
  $.CONSUME($.T.LCurly);
  let rules = $.SUBRULE($.declarationList, { ARGS: [ctx] }) as Rules;
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
  let rules = $.SUBRULE($.declarationList, { ARGS: [ctx] }) as Rules;
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
  let preludeNode: Node | undefined = $.SUBRULE($.keyframesName);
  $.CONSUME($.T.LCurly);
  const rules = $.SUBRULE($.declarationList, { ARGS: [ctx] }) as Rules;
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
  const node = $.OR([
    {
      ALT: () => {
        const tok = $.CONSUME($.T.Ident);
        return $.wrap($.processValueToken(tok));
      }
    },
    {
      ALT: () => $.SUBRULE($.string)
    }
  ]) as Node;
  return node;
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
      prelude = (resolvedPreludeRule as any).call(this, ctx);
    }
  } else {
    $.OR([
      {
        GATE: () => {
          const next = $.LA(1);
          // If it's a FunctionStart (like `size(` or `style(`), it's a query function, not a container name
          if (tokenMatcher(next, $.T.FunctionStart)) {
            return false;
          }
          // If it's an Ident (not a query keyword), it could be a container name
          return tokenMatcher(next, $.T.IdentLikeStart)
            && next.image.toLowerCase() !== 'not'
            && next.image.toLowerCase() !== 'only'
            && next.image.toLowerCase() !== 'and'
            && next.image.toLowerCase() !== 'or';
        },
        ALT: () => {
          containerName = $.SUBRULE($.containerName);
          queryList = $.SUBRULE($.containerQueryList, { ARGS: [ctx] });
        }
      },
      {
        ALT: () => {
          queryList = $.SUBRULE($.containerQueryList, { ARGS: [ctx] });
        }
      }
    ]);

    queryList = queryList!;
  }

  $.CONSUME($.T.LCurly);
  const rules = $.SUBRULE($.atRuleBody, { ARGS: [ctx] }) as Rules;
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
      const query = $.SUBRULE($.containerQuery, { ARGS: [ctx] }) as Node;
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
      GATE: () => tokenMatcher($.LA(1), $.T.FunctionStart),
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
                GATE: () => tokenMatcher($.LA(1), $.T.QueryConditionStart),
                ALT: () => {
                  const arg = $.SUBRULE($.containerCondition, { ARGS: [ctx] });
                  args!.push($.wrap(arg));
                }
              },
              {
                // Declaration: starts with Ident or CustomProperty followed by Assign (colon)
                GATE: () => {
                  const after = $.LA(2);
                  return tokenMatcher($.LA(1), $.T.DeclValueNameStart)
                    && after
                    && tokenMatcher(after, $.T.Assign);
                },
                ALT: () => {
                  const arg = $.SUBRULE($.declaration, { ARGS: [ctx] });
                  args!.push($.wrap(arg));
                }
              },
              {
                // Just a name (Any): Ident, PlainIdent, or CustomProperty without Assign
                GATE: () => {
                  const after = $.LA(2);
                  return tokenMatcher($.LA(1), $.T.DeclValueNameStart)
                    && (!after || !tokenMatcher(after, $.T.Assign));
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
            const rule = $.OR([
              {
                GATE: () => $.isType($.T.And),
                ALT: () => $.SUBRULE($.containerAnd, { ARGS: [ctx] })
              },
              {
                ALT: () => $.SUBRULE($.containerOr, { ARGS: [ctx] })
              }
            ]) as Node[];
            if (Array.isArray(rule)) nodes!.push(...rule);
          }
        });

        const location = $.endRule();
        // Always wrap function calls in QueryCondition (even if alone)
        return new QueryCondition(nodes!, undefined, location, $.context);
      }
    },
    {
      // Regular container condition
      ALT: () => $.SUBRULE($.containerCondition, { ARGS: [ctx] })
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
          return afterNot && tokenMatcher(afterNot, $.T.FunctionStart);
        }
        return false;
      },
      ALT: () => {
        $.startRule();
        const notToken = $.CONSUME($.T.Not);
        // Parse the function call as a container query
        const funcQuery = $.SUBRULE($.containerQuery, { ARGS: [ctx] });
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
        let node = $.SUBRULE($.containerInParens, { ARGS: [ctx] });
        nodes!.push(node);
        $.MANY({
          GATE: () => $.isType($.T.And) || $.isType($.T.Or),
          DEF: () => {
            const rule = $.OR([
              {
                GATE: () => $.isType($.T.And),
                ALT: () => $.SUBRULE($.containerAnd, { ARGS: [ctx] })
              },
              {
                ALT: () => $.SUBRULE($.containerOr, { ARGS: [ctx] })
              }
            ]) as Node[];
            if (Array.isArray(rule)) nodes!.push(...rule);
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
      ALT: () => $.SUBRULE($.mediaCondition, { ARGS: [ctx] })
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
        node = $.SUBRULE($.containerInParens, { ARGS: [ctx] });
        const notNode = $.wrap(new Keyword(notToken.image, undefined, $.getLocationInfo(notToken), $.context), 'both');
        node = new QueryCondition([notNode, node!], undefined, $.getLocationFromNodes([notNode, node!]), $.context);
      }
    },
    {
      GATE: () => tokenMatcher($.LA(1), $.T.FunctionStart),
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
                GATE: () => tokenMatcher($.LA(1), $.T.QueryConditionStart),
                ALT: () => {
                  const arg = $.SUBRULE($.containerCondition, { ARGS: [ctx] });
                  args!.push($.wrap(arg));
                }
              },
              {
                GATE: () => {
                  const after = $.LA(2);
                  return tokenMatcher($.LA(1), $.T.DeclValueNameStart)
                    && after
                    && tokenMatcher(after, $.T.Assign);
                },
                ALT: () => {
                  const arg = $.SUBRULE($.declaration, { ARGS: [ctx] });
                  args!.push($.wrap(arg));
                }
              },
              {
                GATE: () => {
                  const after = $.LA(2);
                  return tokenMatcher($.LA(1), $.T.DeclValueNameStart)
                    && (!after || !tokenMatcher(after, $.T.Assign));
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
        node = $.SUBRULE($.containerInParens, { ARGS: [ctx] });
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
        node = $.SUBRULE($.containerInParens, { ARGS: [ctx] });
        const notNode = $.wrap(new Keyword(notToken.image, undefined, $.getLocationInfo(notToken), $.context), 'both');
        node = new QueryCondition([notNode, node!], undefined, $.getLocationFromNodes([notNode, node!]), $.context);
      }
    },
    {
      GATE: () => tokenMatcher($.LA(1), $.T.FunctionStart),
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
                GATE: () => tokenMatcher($.LA(1), $.T.QueryConditionStart),
                ALT: () => {
                  const arg = $.SUBRULE($.containerCondition, { ARGS: [ctx] });
                  args!.push($.wrap(arg));
                }
              },
              {
                GATE: () => {
                  const after = $.LA(2);
                  return tokenMatcher($.LA(1), $.T.DeclValueNameStart)
                    && after
                    && tokenMatcher(after, $.T.Assign);
                },
                ALT: () => {
                  const arg = $.SUBRULE($.declaration, { ARGS: [ctx] });
                  args!.push($.wrap(arg));
                }
              },
              {
                GATE: () => {
                  const after = $.LA(2);
                  return tokenMatcher($.LA(1), $.T.DeclValueNameStart)
                    && (!after || !tokenMatcher(after, $.T.Assign));
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
        node = $.SUBRULE($.containerInParens, { ARGS: [ctx] });
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
  return $.SUBRULE($.mediaInParens, { ARGS: [ctx] });
}

/**
 * Container feature: similar to media feature
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-query
 */
export function containerFeature(this: P, ctx: RuleContext = {}) {
  const $ = this;
  // Reuse media feature logic since container queries use the same syntax
  return $.SUBRULE($.mediaFeature, { ARGS: [ctx] });
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
      DEF: () => preludeNodes.push($.wrap($.SUBRULE($.anyOuterValue, { ARGS: [ctx] })))
    });
    prelude = preludeNodes.length
      ? $.wrap(new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), $.context), 'both')
      : undefined;
  }
  $.CONSUME($.T.LCurly);
  const rules = $.SUBRULE($.atRuleBody, { ARGS: [ctx] }) as Rules;
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
    DEF: () => preludeNodes.push($.wrap($.SUBRULE($.anyOuterValue, { ARGS: [ctx] })))
  });
  $.CONSUME($.T.LCurly);
  const rules = $.SUBRULE($.atRuleBody, { ARGS: [ctx] }) as Rules;
  $.CONSUME($.T.RCurly);
  return new AtRule({
    name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), $.context), true),
    prelude: preludeNodes.length ? $.wrap(new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), $.context), 'both') : undefined,
    rules
  }, undefined, $.endRule(), $.context);
}
