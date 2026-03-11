// Methods to be mixed into CssRecursiveParser
import type { CssRecursiveParser, RuleContext } from '../cssRecursiveParser.js';
import type { IToken, LocationInfo } from '@jesscss/parser-runtime';
import { tokenMatches } from '@jesscss/parser-runtime';
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
  const la1 = this.la(1);
  return this.or([
    { GATE: () => tokenMatches(la1, this.T.AtContainer), ALT: () => this.containerAtRule(ctx) },
    { GATE: () => tokenMatches(la1, this.T.AtScope), ALT: () => this.scopeAtRule(ctx) },
    { GATE: () => tokenMatches(la1, this.T.AtDocument), ALT: () => this.documentAtRule(ctx) },
    { GATE: () => tokenMatches(la1, this.T.AtLayer), ALT: () => this.layerAtRule(ctx) },
    { GATE: () => tokenMatches(la1, this.T.AtKeyframes), ALT: () => this.keyframesAtRule(ctx) },
    { GATE: () => tokenMatches(la1, this.T.AtImport), ALT: () => this.importAtRule(ctx) },
    { GATE: () => tokenMatches(la1, this.T.AtMedia), ALT: () => this.mediaAtRule(ctx) },
    { GATE: () => tokenMatches(la1, this.T.AtPage), ALT: () => this.pageAtRule(ctx) },
    { GATE: () => tokenMatches(la1, this.T.AtFontFace), ALT: () => this.fontFaceAtRule(ctx) },
    { GATE: () => tokenMatches(la1, this.T.AtSupports), ALT: () => this.supportsAtRule(ctx) },
    { GATE: () => tokenMatches(la1, this.T.AtNested), ALT: () => this.nestedAtRule(ctx) },
    { GATE: () => tokenMatches(la1, this.T.AtNonNested), ALT: () => this.nonNestedAtRule(ctx) },
    { ALT: () => this.unknownAtRule(ctx) }
  ]);
}

/**
  Inner rules are mostly the same except they have a declarationList
  instead of a main block within {}
*/
export function innerAtRule(this: P, ctx: RuleContext = {}): Node {
  const la1 = this.la(1);
  return this.or([
    { GATE: () => tokenMatches(la1, this.T.AtContainer), ALT: () => this.containerAtRule({ ...ctx, inner: true }) },
    { GATE: () => tokenMatches(la1, this.T.AtScope), ALT: () => this.scopeAtRule({ ...ctx, inner: true }) },
    { GATE: () => tokenMatches(la1, this.T.AtDocument), ALT: () => this.documentAtRule({ ...ctx, inner: true }) },
    { GATE: () => tokenMatches(la1, this.T.AtLayer), ALT: () => this.layerAtRule({ ...ctx, inner: true }) },
    { GATE: () => tokenMatches(la1, this.T.AtKeyframes), ALT: () => this.keyframesAtRule({ ...ctx, inner: true }) },
    { GATE: () => tokenMatches(la1, this.T.AtMedia), ALT: () => this.mediaAtRule({ ...ctx, inner: true }) },
    { GATE: () => tokenMatches(la1, this.T.AtSupports), ALT: () => this.supportsAtRule({ ...ctx, inner: true }) },
    { GATE: () => tokenMatches(la1, this.T.AtNested), ALT: () => this.nestedAtRule({ ...ctx, inner: true }) },
    { ALT: () => this.unknownAtRule({ ...ctx, inner: true }) }
  ]);
}

/**
 * @see https://www.w3.org/TR/css-nesting-1/#conditionals
 */
export function atRuleBody(this: P, ctx: RuleContext = {}): Node {
  return this.or([
    {
      GATE: () => !ctx.inner,
      ALT: () => this.main(ctx)
    },
    {
      GATE: () => !!ctx.inner,
      ALT: () => this.declarationList(ctx)
    }
  ]);
}

export function mediaAtRule(this: P, ctx: RuleContext = {}, preludeRule?: PreludeRule) {
  this.startRule();
  let name = this.consume(this.T.AtMedia);
  let rules: Rules;
  const resolvedPreludeRule = resolvePreludeRule(this, preludeRule);
  const prelude: Node = typeof resolvedPreludeRule === 'function'
    ? (resolvedPreludeRule as any).call(this, ctx)
    : this.mediaQueryList(ctx);
  this.consume(this.T.LCurly);
  rules = this.atRuleBody(ctx) as Rules;
  this.consume(this.T.RCurly);

  let location = this.endRule();
  return new AtRule({
    name: this.wrap(new Any(name.image, { role: 'atkeyword' }, this.getLocationInfo(name), this.context), true),
    prelude: this.wrap(prelude, true),
    rules
  }, { nestable: true }, location, this.context);
}

export function mediaQueryList(this: P, ctx: RuleContext = {}) {
  this.startRule();
  let queries: Node[] = [];
  this.atLeastOneSep({
    SEP: this.T.Comma,
    DEF: () => {
      let query = this.mediaQuery(ctx);
      queries.push(query);
    }
  });

  if (queries!.length === 1) {
    this.endRule();
    return queries![0]!;
  }
  return new List(queries!, undefined, this.endRule(), this.context);
}

/**
 * @see https://w3c.github.io/csswg-drafts/mediaqueries/#mq-syntax
 */
export function mediaQuery(this: P, ctx: RuleContext = {}) {
  return this.or([
    { ALT: () => this.mediaCondition(ctx) },
    {
      ALT: () => {
        this.startRule();

        let token: IToken | undefined;
        let node: Node | undefined;
        let nodes: Node[] = [];

        this.option(() => {
          this.or([
            { ALT: () => token = this.consume(this.T.Not) },
            { ALT: () => token = this.consume(this.T.Only) }
          ]);
        });

        if (token) {
          nodes!.push(this.wrap(new Keyword(token.image, undefined, this.getLocationInfo(token), this.context), 'both'));
          token = undefined;
        }
        let type = this.mediaType(ctx);

        nodes!.push(type);

        this.option(() => {
          token = this.consume(this.T.And);
          node = this.mediaConditionWithoutOr(ctx);
        });
        if (token) {
          nodes!.push(this.wrap(new Keyword((token as IToken).image, undefined, this.getLocationInfo(token as IToken), this.context), 'both'));
        }
        if (node) {
          nodes!.push(node);
        }
        let location = this.endRule();
        return new QueryCondition(nodes!, undefined, location, this.context);
      }
    }
  ]);
}

/** Doesn't include only, not, and, or, layer */
export function mediaType(this: P, ctx: RuleContext = {}) {
  let token = this.or([
    { ALT: () => this.consume(this.T.PlainIdent) },
    { ALT: () => this.consume(this.T.Screen) },
    { ALT: () => this.consume(this.T.Print) },
    { ALT: () => this.consume(this.T.All) }
  ]);
  return this.wrap(new Keyword(token.image, undefined, this.getLocationInfo(token), this.context), 'both');
}

export function mediaCondition(this: P, ctx: RuleContext = {}): Node {
  return this.or([
    { ALT: () => this.mediaNot(ctx) },
    {
      ALT: () => {
        this.startRule();
        let nodes: Node[] = [];
        let node = this.mediaInParens(ctx);
        nodes!.push(node);
        this.many(() => {
          let rule =
            this.or([
              { ALT: () => this.mediaAnd(ctx) },
              { ALT: () => this.mediaOr(ctx) }
            ]);
          nodes!.push(...rule);
        });
        // Only wrap in QueryCondition if there are multiple nodes (AND/OR operators)
        // Otherwise, return the single node directly (like Sequence does)
        if (nodes!.length === 1) {
          this.endRule();
          return nodes![0]!;
        }
        return new QueryCondition(nodes!, undefined, this.endRule(), this.context);
      }
    }
  ]);
}

export function mediaConditionWithoutOr(this: P, ctx: RuleContext = {}) {
  return this.or([
    { ALT: () => this.mediaNot(ctx) },
    {
      ALT: () => {
        this.startRule();
        let nodes: Node[] = [];
        let node = this.mediaInParens(ctx);
        nodes!.push(node);
        this.many(() => {
          let rule = this.mediaAnd(ctx);
          nodes!.push(...rule);
        });

        // Only wrap in QueryCondition if there are multiple nodes (AND operators)
        // Otherwise, return the single node directly (like Sequence does)
        if (nodes!.length === 1) {
          this.endRule();
          return nodes![0]!;
        }
        return new QueryCondition(nodes!, undefined, this.endRule(), this.context);
      }
    }
  ]);
}

export function mediaNot(this: P, ctx: RuleContext = {}): Node {
  this.startRule();

  let token = this.consume(this.T.Not);
  let node = this.mediaInParens(ctx);

  return new QueryCondition([
    this.wrap(new Keyword(token.image, undefined, this.getLocationInfo(token), this.context), 'both'),
    node
  ], undefined, this.endRule(), this.context);
}

/** Returns an array */
export function mediaAnd(this: P, ctx: RuleContext = {}) {
  let token = this.consume(this.T.And);
  let node = this.mediaInParens(ctx);

  return [
    this.wrap(new Keyword(token.image, undefined, this.getLocationInfo(token), this.context), 'both'),
    node
  ];
}

/** Returns an array */
export function mediaOr(this: P, ctx: RuleContext = {}) {
  let token = this.consume(this.T.Or);
  let node = this.mediaInParens(ctx);

  return [
    this.wrap(new Keyword(token.image, undefined, this.getLocationInfo(token), this.context), 'both'),
    node
  ];
}

export function mediaInParens(this: P, ctx: RuleContext = {}): Node {
  this.startRule();
  this.consume(this.T.LParen);

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
  let node = this.or([
    { ALT: () => this.mediaCondition(ctx) },
    { ALT: () => this.mediaFeature(ctx) }
  ]);
  this.consume(this.T.RParen);

  let location = this.endRule();
  return this.wrap(new Paren(this.wrap(node, 'both'), undefined, location, this.context));
}

/**
    An identifier is a legal value, so it can be
    ambiguous which side of the expression we're on
    while parsing. The browser figures this out
    post-parsing.
  */
export function mediaFeature(this: P, ctx: RuleContext = {}) {
  return this.or([
    {
      ALT: () => {
        this.startRule();
        let rule: Node | undefined;
        let ident = this.consume(this.T.Ident);
        this.option(() => {
          rule = this.or([
            {
              ALT: () => {
                this.consume(this.T.Colon);
                let value = this.mfValue(ctx);
                let location = this.endRule();
                return this.wrap(
                  new Declaration({
                    name: this.wrap(new Any(ident.image, { role: 'property' }), true),
                    value: this.wrap(value)
                  }, undefined, location, this.context),
                  'both');
              }
            },
            {
              ALT: (): Node => {
                let seq = this.mediaRange(ctx);
                let [startOffset, startLine, startColumn] = this.endRule();
                seq.value.unshift(this.wrap(new Any(ident.image, { role: 'ident' }, this.getLocationInfo(ident), this.context)));
                seq.location[0] = startOffset!;
                seq.location[1] = startLine!;
                seq.location[2] = startColumn!;
                return new QueryCondition(seq.value, undefined, seq.location as LocationInfo, this.context);
              }
            },
            {
              ALT: (): Node => {
                let op = this.mfComparison(ctx);
                let value = this.mfNonIdentifierValue(ctx);

                let location = this.endRule();
                return new QueryCondition([
                  this.wrap(new Any(ident.image, { role: 'ident' }, this.getLocationInfo(ident), this.context)),
                  this.wrap(new Any(op.image, { role: 'operator' }, this.getLocationInfo(op), this.context), 'both'),
                  value
                ], undefined, location, this.context);
              }
            }
          ]);
        });
        if (!rule) {
          let location = this.endRule();
          let anyNode = new Keyword(ident.image, undefined, location, this.context);
          return this.wrap(new QueryCondition([anyNode], undefined, location, this.context), 'both');
        }
        return rule;
      }
    },
    {
      ALT: () => {
        this.startRule();
        let rule1 = this.mfNonIdentifierValue({ ...ctx });
        return this.or([
          {
            ALT: () => {
              // Try range first: `value < ident < value` or `value < ident`
              let seq = this.mediaRange({ ...ctx });
              let [startOffset, startLine, startColumn] = this.endRule();
              seq.value.unshift(rule1);
              seq.location[0] = startOffset!;
              seq.location[1] = startLine!;
              seq.location[2] = startColumn!;
              return new QueryCondition(seq.value, undefined, seq.location as LocationInfo, this.context);
            }
          },
          {
            ALT: () => {
              // Simple comparison: `value = ident`  (Eq not handled by mediaRange)
              let op = this.mfComparison({ ...ctx });
              let value = this.consume(this.T.Ident);
              let location = this.endRule();
              return new QueryCondition([
                rule1,
                this.wrap(new Any(op.image, { role: 'operator' }, this.getLocationInfo(op), this.context)),
                this.wrap(new Any(value.image, { role: 'ident' }, this.getLocationInfo(value), this.context), 'both')
              ], undefined, location, this.context);
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
  this.startRule();

  let op1: IToken;
  let val1: IToken;
  let op2: IToken | undefined;
  let val2: Node | undefined;

  let val = this.or([
    {
      ALT: () => {
        let op1 = this.consume(this.T.MfLt);
        let val1 = this.consume(this.T.Ident);
        let op2: IToken | undefined;
        let val2: Node | undefined;
        this.option(() => {
          op2 = this.consume(this.T.MfLt);
          val2 = this.mfValue(ctx);
        });
        return [op1, val1, op2, val2];
      }
    },
    {
      ALT: () => {
        let op1 = this.consume(this.T.MfGt);
        let val1 = this.consume(this.T.Ident);
        let op2: IToken | undefined;
        let val2: Node | undefined;
        this.option(() => {
          op2 = this.consume(this.T.MfGt);
          val2 = this.mfValue(ctx);
        });
        return [op1, val1, op2, val2];
      }
    }
  ]);

  ([op1!, val1!, op2, val2] = val as any);

  let location = this.endRule();
  let nodes: Node[] = [
    this.wrap(new Any(op1!.image, { role: 'operator' }, this.getLocationInfo(op1!), this.context)),
    this.wrap(new Any(val1!.image, { role: 'ident' }, this.getLocationInfo(val1!), this.context), 'both')
  ];
  if (op2) {
    nodes.push(this.wrap(new Any(op2.image, { role: 'operator' }, this.getLocationInfo(op2), this.context)));
    nodes.push(this.wrap(val2!, 'both'));
  }
  return new Sequence(nodes, undefined, location, this.context);
}

export function mfNonIdentifierValue(this: P, ctx: RuleContext = {}) {
  return this.or([
    {
      ALT: () => {
        this.startRule();
        let num1 = this.consume(this.T.Number);
        let num2: IToken | undefined;
        this.option(() => {
          this.consume(this.T.Slash);
          num2 = this.consume(this.T.Number);
        });
        let location = this.endRule();
        let num1Node = this.wrap(this.processValueToken(num1), 'both');
        if (!num2) {
          return num1Node;
        }
        let num2Node = this.wrap(this.processValueToken(num2), 'both');
        return new List([num1Node, num2Node], { sep: '/' }, location, this.context);
      }
    },
    {
      ALT: () => {
        let dim = this.consume(this.T.Dimension);
        return this.wrap(this.processValueToken(dim), 'both');
      }
    }
  ]);
}

export function mfValue(this: P, ctx: RuleContext = {}) {
  return this.or([
    { ALT: () => this.mfNonIdentifierValue(ctx) },
    {
      ALT: () => {
        let token = this.consume(this.T.Ident);
        return this.wrap(new Any(token.image, { role: 'ident' }, this.getLocationInfo(token), this.context), 'both');
      }
    }
  ]);
}

export function mfComparison(this: P, ctx: RuleContext = {}) {
  return this.or([
    { ALT: () => this.consume(this.T.MfLt) },
    { ALT: () => this.consume(this.T.MfGt) },
    { ALT: () => this.consume(this.T.Eq) }
  ]);
}

/**
 * @see https://www.w3.org/TR/css-page-3/
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@page
 */
export function pageAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();

  let name = this.consume(this.T.AtPage);
  let selector: Node[] = [];
  this.manySep({
    SEP: this.T.Comma,
    DEF: () => selector.push(this.pageSelector(ctx))
  });
  this.consume(this.T.LCurly);
  let rules = this.declarationList(ctx) as Rules;
  this.consume(this.T.RCurly);

  let location = this.endRule();
  return new AtRule({
    name: this.wrap(new Any(name.image, { role: 'atkeyword' }, this.getLocationInfo(name), this.context), true),
    prelude: selector.length ? this.wrap(new List(selector, undefined, this.getLocationFromNodes(selector), this.context), true) : undefined,
    rules
  }, undefined, location, this.context);
}

export function pageSelector(this: P, ctx: RuleContext = {}) {
  this.startRule();
  let token = '';

  this.option(() => token += this.consume(this.T.Ident).image);
  this.many({
    GATE: () => this.la(1).tokenType === this.T.Colon && this.noSep(1),
    DEF: () => {
      token += this.consume(this.T.Colon).image;
      token += this.consume(this.T.PagePseudoClassKeywords).image;
    }
  });

  let location = this.endRule();
  return this.wrap(new BasicSelector(token, undefined, location, this.context));
}

export function fontFaceAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();

  let name = this.consume(this.T.AtFontFace);
  this.consume(this.T.LCurly);
  let rules = this.declarationList(ctx) as Rules;
  this.consume(this.T.RCurly);

  let location = this.endRule();
  return new AtRule({
    name: this.wrap(new Any(name.image, { role: 'atkeyword' }, this.getLocationInfo(name), this.context), true),
    rules
  }, undefined, location, this.context);
}

export function keyframesAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();

  let atTok = this.consume(this.T.AtKeyframes);
  // prelude: a single animation name
  let preludeNode: Node | undefined = this.keyframesName(ctx);
  this.consume(this.T.LCurly);
  const rules = this.declarationList(ctx) as Rules;
  this.consume(this.T.RCurly);

  return new AtRule({
    name: this.wrap(new Any(atTok.image, { role: 'atkeyword' }, this.getLocationInfo(atTok), this.context), true),
    prelude: preludeNode ? this.wrap(preludeNode, 'both') : undefined,
    // Include isolated comments inside the keyframes body
    rules
  }, undefined, this.endRule(), this.context);
}

/**
 * Keyframes name prelude
 * CSS: Ident | String
 */
export function keyframesName(this: P, ctx: RuleContext = {}) {
  let node: Node | undefined;
  this.or([
    {
      ALT: () => {
        const tok = this.consume(this.T.Ident);
        node = this.wrap(this.processValueToken(tok));
      }
    },
    {
      ALT: () => {
        node = this.string(ctx);
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
  this.startRule();
  const name = this.consume(this.T.AtContainer);
  let prelude: Node | undefined;
  let containerName: Node | undefined;
  let queryList: Node | undefined;

  if (preludeRule) {
    const resolvedPreludeRule = resolvePreludeRule(this, preludeRule);
    if (typeof resolvedPreludeRule === 'function') {
      (resolvedPreludeRule as any).call(this, ctx);
    }
  } else {
    this.or([
      {
        GATE: () => {
          const next = this.la(1);
          // If it's a FunctionStart (like `size(` or `style(`), it's a query function, not a container name
          if (tokenMatches(next, this.T.FunctionStart)) {
            return false;
          }
          // If it's an Ident (not a query keyword), it could be a container name
          return (next.tokenType === this.T.Ident || next.tokenType === this.T.PlainIdent)
            && next.image.toLowerCase() !== 'not'
            && next.image.toLowerCase() !== 'only'
            && next.image.toLowerCase() !== 'and'
            && next.image.toLowerCase() !== 'or';
        },
        ALT: () => {
          containerName = this.containerName(ctx);
          queryList = this.containerQueryList(ctx);
        }
      },
      {
        ALT: () => {
          queryList = this.containerQueryList(ctx);
        }
      }
    ]);

    queryList = queryList!;
  }

  this.consume(this.T.LCurly);
  const rules = this.atRuleBody(ctx) as Rules;
  this.consume(this.T.RCurly);

  let preludeNodes: Node[] = [];
  if (!prelude && containerName) {
    preludeNodes.push(this.wrap(containerName, true));
  }
  if (!prelude) {
    preludeNodes.push(this.wrap(queryList!, containerName ? true : 'both'));
    prelude = preludeNodes.length
      ? this.wrap(new Sequence(preludeNodes, undefined, this.getLocationFromNodes(preludeNodes), this.context), 'both')
      : undefined;
  }
  return new AtRule({
    name: this.wrap(new Any(name.image, { role: 'atkeyword' }, this.getLocationInfo(name), this.context), true),
    prelude,
    rules
  }, { nestable: true }, this.endRule(), this.context);
}

/**
 * Container name: an optional identifier
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-name
 */
export function containerName(this: P, ctx: RuleContext = {}) {
  let token = this.consume(this.T.Ident);
  return this.wrap(new Any(token.image, { role: 'ident' }, this.getLocationInfo(token), this.context), 'both');
}

/**
 * Container query list: comma-separated list of container queries
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-query
 */
export function containerQueryList(this: P, ctx: RuleContext = {}) {
  this.startRule();
  let queries: Node[] = [];
  this.atLeastOneSep({
    SEP: this.T.Comma,
    DEF: () => {
      let query = this.containerQuery(ctx);
      queries.push(query);
    }
  });

  if (queries!.length === 1) {
    this.endRule();
    return queries![0]!;
  }
  return new List(queries!, undefined, this.endRule(), this.context);
}

/**
 * Container query: a container condition or container query type function
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-query
 */
export function containerQuery(this: P, ctx: RuleContext = {}): Node {
  return this.or([
    {
      // Container query type function: any FunctionStart token
      GATE: () => tokenMatches(this.la(1), this.T.FunctionStart),
      ALT: () => {
        this.startRule();
        let nodes: Node[] = [];

        // Parse first function call
        const funcStart = this.consume(this.T.FunctionStart);
        const funcName = funcStart.image.slice(0, -1);
        let args: Node[] = [];
        this.atLeastOneSep({
          SEP: this.T.Comma,
          DEF: () => {
            // Arguments can be QueryConditions, declarations, or just a name (Any)
            this.or([
              {
                // QueryCondition: starts with LParen or Not
                GATE: () => {
                  const next = this.la(1);
                  return next.tokenType === this.T.LParen || next.tokenType === this.T.Not;
                },
                ALT: () => {
                  const arg = this.containerCondition(ctx);
                  args!.push(this.wrap(arg));
                }
              },
              {
                // Declaration: starts with Ident or CustomProperty followed by Assign (colon)
                GATE: () => {
                  const next = this.la(1);
                  const after = this.la(2);
                  const isIdent = next.tokenType === this.T.Ident || next.tokenType === this.T.PlainIdent || next.tokenType === this.T.CustomProperty;
                  return isIdent && after && tokenMatches(after, this.T.Assign);
                },
                ALT: () => {
                  const arg = this.declaration(ctx);
                  args!.push(this.wrap(arg));
                }
              },
              {
                // Just a name (Any): Ident, PlainIdent, or CustomProperty without Assign
                GATE: () => {
                  const next = this.la(1);
                  const after = this.la(2);
                  const isIdent = next.tokenType === this.T.Ident || next.tokenType === this.T.PlainIdent || next.tokenType === this.T.CustomProperty;
                  return isIdent && (!after || !tokenMatches(after, this.T.Assign));
                },
                ALT: () => {
                  let nameToken: IToken | undefined;
                  this.or([
                    { ALT: () => nameToken = this.consume(this.T.Ident) },
                    { ALT: () => nameToken = this.consume(this.T.PlainIdent) },
                    { ALT: () => nameToken = this.consume(this.T.CustomProperty) }
                  ]);
                  if (nameToken) {
                    const nameNode = this.wrap(new Any(nameToken.image, { role: 'name' }, this.getLocationInfo(nameToken), this.context), true);
                    args!.push(nameNode);
                  }
                }
              }
            ]);
          }
        });
        this.consume(this.T.RParen);

        const call = new Call({
          name: funcName,
          args: args!.length > 0 ? new List(args!) : undefined
        }, undefined, this.getLocationFromNodes([funcStart]), this.context);
        nodes!.push(call);

        // Check for and/or after the function call (similar to mediaCondition)
        this.many(() => {
          let rule = this.or([
            { ALT: () => this.containerAnd(ctx) },
            { ALT: () => this.containerOr(ctx) }
          ]) as Node[];
          nodes!.push(...rule);
        });

        const location = this.endRule();
        // Always wrap function calls in QueryCondition (even if alone)
        return new QueryCondition(nodes!, undefined, location, this.context);
      }
    },
    {
      // Regular container condition
      ALT: () => this.containerCondition(ctx)
    }
  ]);
}

/**
 * Container condition: similar to media condition but without mediaType variant
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-query
 */
export function containerCondition(this: P, ctx: RuleContext = {}): Node {
  return this.or([
    {
      // Handle `not` followed by a container query type function (e.g., `not scroll-state(...)`)
      GATE: () => {
        const next = this.la(1);
        if (next.tokenType === this.T.Not) {
          const afterNot = this.la(2);
          return afterNot && tokenMatches(afterNot, this.T.FunctionStart);
        }
        return false;
      },
      ALT: () => {
        this.startRule();
        const notToken = this.consume(this.T.Not);
        // Parse the function call as a container query
        const funcQuery = this.containerQuery(ctx);
        return new QueryCondition([
          this.wrap(new Keyword(notToken.image, undefined, this.getLocationInfo(notToken), this.context), 'both'),
          funcQuery
        ], undefined, this.endRule(), this.context);
      }
    },
    {
      // Custom container condition that handles `and not` and `or not`
      GATE: () => {
        const next = this.la(1);
        return next.tokenType === this.T.LParen;
      },
      ALT: () => {
        this.startRule();
        let nodes: Node[] = [];
        let node = this.containerInParens(ctx);
        nodes!.push(node);
        this.many(() => {
          let rule = this.or([
            { ALT: () => this.containerAnd(ctx) },
            { ALT: () => this.containerOr(ctx) }
          ]) as Node[];
          nodes!.push(...rule);
        });
        if (nodes!.length === 1) {
          this.endRule();
          return nodes![0]!;
        }
        return new QueryCondition(nodes!, undefined, this.endRule(), this.context);
      }
    },
    {
      // For cases not starting with LParen (like `not` at start), reuse media condition logic
      GATE: () => {
        const next = this.la(1);
        return next.tokenType !== this.T.LParen;
      },
      ALT: () => this.mediaCondition(ctx)
    }
  ]);
}

/**
 * Container and: similar to mediaAnd but can handle `and not` and function calls
 */
export function containerAnd(this: P, ctx: RuleContext = {}) {
  let token = this.consume(this.T.And);
  // Handle `and not` or `and` followed by containerInParens or function call
  let node: Node | undefined;
  this.or([
    {
      GATE: () => this.la(1).tokenType === this.T.Not,
      ALT: () => {
        const notToken = this.consume(this.T.Not);
        node = this.containerInParens(ctx);
        const notNode = this.wrap(new Keyword(notToken.image, undefined, this.getLocationInfo(notToken), this.context), 'both');
        node = new QueryCondition([notNode, node!], undefined, this.getLocationFromNodes([notNode, node!]), this.context);
      }
    },
    {
      GATE: () => tokenMatches(this.la(1), this.T.FunctionStart),
      ALT: () => {
        // Parse function call (reuse containerQuery logic)
        const funcStart = this.consume(this.T.FunctionStart);
        const funcName = funcStart.image.slice(0, -1);
        let args: Node[] = [];
        this.atLeastOneSep({
          SEP: this.T.Comma,
          DEF: () => {
            this.or([
              {
                GATE: () => {
                  const next = this.la(1);
                  return next.tokenType === this.T.LParen || next.tokenType === this.T.Not;
                },
                ALT: () => {
                  const arg = this.containerCondition(ctx);
                  args!.push(this.wrap(arg));
                }
              },
              {
                GATE: () => {
                  const next = this.la(1);
                  const after = this.la(2);
                  const isIdent = next.tokenType === this.T.Ident || next.tokenType === this.T.PlainIdent || next.tokenType === this.T.CustomProperty;
                  return isIdent && after && tokenMatches(after, this.T.Assign);
                },
                ALT: () => {
                  const arg = this.declaration(ctx);
                  args!.push(this.wrap(arg));
                }
              },
              {
                GATE: () => {
                  const next = this.la(1);
                  const after = this.la(2);
                  const isIdent = next.tokenType === this.T.Ident || next.tokenType === this.T.PlainIdent || next.tokenType === this.T.CustomProperty;
                  return isIdent && (!after || !tokenMatches(after, this.T.Assign));
                },
                ALT: () => {
                  let nameToken: IToken | undefined;
                  this.or([
                    { ALT: () => nameToken = this.consume(this.T.Ident) },
                    { ALT: () => nameToken = this.consume(this.T.PlainIdent) },
                    { ALT: () => nameToken = this.consume(this.T.CustomProperty) }
                  ]);
                  if (nameToken) {
                    const nameNode = this.wrap(new Any(nameToken.image, { role: 'name' }, this.getLocationInfo(nameToken), this.context), true);
                    args!.push(nameNode);
                  }
                }
              }
            ]);
          }
        });
        this.consume(this.T.RParen);
        node = new Call({
          name: funcName,
          args: args!.length > 0 ? new List(args!) : undefined
        }, undefined, this.getLocationFromNodes([funcStart]), this.context);
      }
    },
    {
      ALT: () => {
        node = this.containerInParens(ctx);
      }
    }
  ]);
  if (node) {
    return [
      this.wrap(new Keyword(token.image, undefined, this.getLocationInfo(token), this.context), 'both'),
      node
    ];
  }
}

/**
 * Container or: similar to mediaOr but can handle `or not` and function calls
 */
export function containerOr(this: P, ctx: RuleContext = {}) {
  let token = this.consume(this.T.Or);
  // Handle `or not` or `or` followed by containerInParens or function call
  let node: Node | undefined;
  this.or([
    {
      GATE: () => this.la(1).tokenType === this.T.Not,
      ALT: () => {
        const notToken = this.consume(this.T.Not);
        node = this.containerInParens(ctx);
        const notNode = this.wrap(new Keyword(notToken.image, undefined, this.getLocationInfo(notToken), this.context), 'both');
        node = new QueryCondition([notNode, node!], undefined, this.getLocationFromNodes([notNode, node!]), this.context);
      }
    },
    {
      GATE: () => tokenMatches(this.la(1), this.T.FunctionStart),
      ALT: () => {
        // Parse function call (reuse containerQuery logic)
        const funcStart = this.consume(this.T.FunctionStart);
        const funcName = funcStart.image.slice(0, -1);
        let args: Node[] = [];
        this.atLeastOneSep({
          SEP: this.T.Comma,
          DEF: () => {
            this.or([
              {
                GATE: () => {
                  const next = this.la(1);
                  return next.tokenType === this.T.LParen || next.tokenType === this.T.Not;
                },
                ALT: () => {
                  const arg = this.containerCondition(ctx);
                  args!.push(this.wrap(arg));
                }
              },
              {
                GATE: () => {
                  const next = this.la(1);
                  const after = this.la(2);
                  const isIdent = next.tokenType === this.T.Ident || next.tokenType === this.T.PlainIdent || next.tokenType === this.T.CustomProperty;
                  return isIdent && after && tokenMatches(after, this.T.Assign);
                },
                ALT: () => {
                  const arg = this.declaration(ctx);
                  args!.push(this.wrap(arg));
                }
              },
              {
                GATE: () => {
                  const next = this.la(1);
                  const after = this.la(2);
                  const isIdent = next.tokenType === this.T.Ident || next.tokenType === this.T.PlainIdent || next.tokenType === this.T.CustomProperty;
                  return isIdent && (!after || !tokenMatches(after, this.T.Assign));
                },
                ALT: () => {
                  let nameToken: IToken | undefined;
                  this.or([
                    { ALT: () => nameToken = this.consume(this.T.Ident) },
                    { ALT: () => nameToken = this.consume(this.T.PlainIdent) },
                    { ALT: () => nameToken = this.consume(this.T.CustomProperty) }
                  ]);
                  if (nameToken) {
                    const nameNode = this.wrap(new Any(nameToken.image, { role: 'name' }, this.getLocationInfo(nameToken), this.context), true);
                    args!.push(nameNode);
                  }
                }
              }
            ]);
          }
        });
        this.consume(this.T.RParen);
        node = new Call({
          name: funcName,
          args: args!.length > 0 ? new List(args!) : undefined
        }, undefined, this.getLocationFromNodes([funcStart]), this.context);
      }
    },
    {
      ALT: () => {
        node = this.containerInParens(ctx);
      }
    }
  ]);
  if (node) {
    return [
      this.wrap(new Keyword(token.image, undefined, this.getLocationInfo(token), this.context), 'both'),
      node
    ];
  }
}

/**
 * Container in parens: similar to media in parens
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-query
 */
export function containerInParens(this: P, ctx: RuleContext = {}) {
  // Reuse media in parens logic since container queries use the same syntax
  return this.mediaInParens(ctx);
}

/**
 * Container feature: similar to media feature
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@container#container-query
 */
export function containerFeature(this: P, ctx: RuleContext = {}) {
  // Reuse media feature logic since container queries use the same syntax
  return this.mediaFeature(ctx);
}

// scopeAtRule: @scope <prelude>? { main }
export function scopeAtRule(this: P, ctx: RuleContext = {}, preludeRule?: PreludeRule) {
  this.startRule();
  const name = this.consume(this.T.AtScope);
  let prelude: Node | undefined;
  if (preludeRule) {
    const resolvedPreludeRule = resolvePreludeRule(this, preludeRule);
    if (typeof resolvedPreludeRule === 'function') {
      prelude = (resolvedPreludeRule as any).call(this, ctx);
    }
  } else {
    const preludeNodes: Node[] = [];
    this.many(() => preludeNodes.push(this.wrap(this.anyOuterValue(ctx))));
    prelude = preludeNodes.length
      ? this.wrap(new Sequence(preludeNodes, undefined, this.getLocationFromNodes(preludeNodes), this.context), 'both')
      : undefined;
  }
  this.consume(this.T.LCurly);
  const rules = this.atRuleBody(ctx) as Rules;
  this.consume(this.T.RCurly);
  return new AtRule({
    name: this.wrap(new Any(name.image, { role: 'atkeyword' }, this.getLocationInfo(name), this.context), true),
    prelude,
    rules
  }, { nestable: true }, this.endRule(), this.context);
}

// documentAtRule (non-standard): @document <prelude>? { main }
export function documentAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();
  const name = this.consume(this.T.AtDocument);
  const preludeNodes: Node[] = [];
  this.many(() => preludeNodes.push(this.wrap(this.anyOuterValue(ctx))));
  this.consume(this.T.LCurly);
  const rules = this.atRuleBody(ctx) as Rules;
  this.consume(this.T.RCurly);
  return new AtRule({
    name: this.wrap(new Any(name.image, { role: 'atkeyword' }, this.getLocationInfo(name), this.context), true),
    prelude: preludeNodes.length ? this.wrap(new Sequence(preludeNodes, undefined, this.getLocationFromNodes(preludeNodes), this.context), 'both') : undefined,
    rules
  }, undefined, this.endRule(), this.context);
}
