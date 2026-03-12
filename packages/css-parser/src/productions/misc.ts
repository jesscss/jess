// Methods to be mixed into CssRecursiveParser
import type { CssRecursiveParser, RuleContext } from '../cssRecursiveParser.js';
import type { IToken } from '@jesscss/parser-runtime';
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
  this.startRule();
  const atTok = this.consume(this.T.AtLayer);

  return this.or([
    {
      ALT: () => {
        const preludeNodes: Node[] = [];
        this.option(() => {
          const nameNode: Node = this.layerName(ctx);
          preludeNodes.push(this.wrap(nameNode));
        });
        this.consume(this.T.LCurly);
        const rules = this.atRuleBody(ctx) as Rules;
        this.consume(this.T.RCurly);
        return new AtRule({
          name: this.wrap(new Any(atTok.image, { role: 'atkeyword' }, this.getLocationInfo(atTok), this.context), true),
          prelude: preludeNodes.length ? this.wrap(new Sequence(preludeNodes, undefined, this.getLocationFromNodes(preludeNodes), this.context), 'both') : undefined,
          rules
        }, { nestable: true }, this.endRule(), this.context);
      }
    },
    {
      ALT: () => {
        const preludeNodes: Node[] = [];
        this.manySep({
          SEP: this.T.Comma,
          DEF: () => {
            let nameNode: Node = this.layerName(ctx);
            preludeNodes.push(this.wrap(nameNode));
          }
        });
        this.consume(this.T.Semi);
        return new AtRule({
          name: this.wrap(new Any(atTok.image, { role: 'atkeyword' }, this.getLocationInfo(atTok), this.context), true),
          prelude: preludeNodes.length ? this.wrap(new List(preludeNodes, undefined, this.getLocationFromNodes(preludeNodes), this.context), 'both') : undefined
        }, undefined, this.endRule(), this.context);
      }
    }
  ]);
}

/**
 * <layer-name> = <ident> ('.' <ident>)*
 */
export function layerName(this: P, ctx: RuleContext = {}) {
  this.startRule();
  const nodes: Node[] = [];

  const first = this.consume(this.T.Ident);
  nodes.push(this.wrap(this.processValueToken(first)));

  this.many({
    GATE: this.noSep.bind(this),
    DEF: () => {
      const seg = this.consume(this.T.DotName);
      nodes.push(this.wrap(this.processValueToken(seg)));
    }
  });

  const loc = this.endRule();
  return new Sequence(nodes, undefined, loc, this.context);
}

/**
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@supports
 */
export function supportsAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();

  let name = this.consume(this.T.AtSupports);
  const prelude: Node = this.supportsCondition(ctx);
  this.consume(this.T.LCurly);
  let rules = this.atRuleBody(ctx) as Rules;
  this.consume(this.T.RCurly);

  let location = this.endRule();
  return new AtRule({
    name: this.wrap(new Any(name.image, { role: 'atkeyword' }, this.getLocationInfo(name), this.context), true),
    prelude: this.wrap(prelude, 'both'),
    rules
  }, { nestable: true }, location, this.context);
}

/** spec-compliant but simplified */
export function supportsCondition(this: P, ctx: RuleContext = {}): Node {
  return this.or([
    {
      ALT: () => {
        this.startRule();
        let keyword = this.consume(this.T.Not);
        let value = this.supportsInParens(ctx);

        let location = this.endRule();
        return new QueryCondition([
          this.wrap(new Keyword(keyword.image, undefined, this.getLocationInfo(keyword), this.context)),
          value
        ], undefined, location, this.context);
      }
    },
    {
      ALT: () => {
        let start = this.startRule();
        let [startOffset, startLine, startColumn] = start ?? [];

        let left: Node = this.supportsInParens(ctx);

        /**
         * Can be followed by many ands or many ors
         */
        this.or([
          {
            ALT: () => {
              this.atLeastOne(() => {
                let keyword = this.consume(this.T.And);
                let right: Node = this.supportsInParens(ctx);
                let [,,,endOffset, endLine, endColumn] = right.location;
                left = new QueryCondition([
                  left,
                  this.wrap(new Keyword(keyword.image, undefined, this.getLocationInfo(keyword), this.context)),
                  right
                ], undefined, [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!], this.context);
              });
            }
          },
          {
            ALT: () => {
              this.atLeastOne(() => {
                let keyword = this.consume(this.T.Or);
                let right: Node = this.supportsInParens(ctx);
                let [,,,endOffset, endLine, endColumn] = right.location;
                left = new QueryCondition([
                  left,
                  this.wrap(new Keyword(keyword.image, undefined, this.getLocationInfo(keyword), this.context)),
                  right
                ], undefined, [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!], this.context);
              });
            }
          },
          {
            ALT: () => undefined
          }
        ]);

        this.endRule();

        return left;
      }
    }
  ]);
}

export function supportsInParens(this: P, ctx: RuleContext = {}): Node {
  return this.or([
    {
      ALT: (): Node => {
        this.startRule();
        /** Function-like call */
        let name = this.consume(this.T.Ident);
        let args: List | undefined;
        this.or([
          {
            GATE: this.noSep.bind(this),
            ALT: () => {
              this.consume(this.T.LParen);
              args = this.valueList(ctx) as List;
              this.consume(this.T.RParen);
            }
          }
        ]);

        let location = this.endRule();
        return new Call({
          name: name.image,
          args
        }, undefined, location, this.context);
      }
    },
    {
      ALT: (): Node => {
        this.startRule();
        let values: Node[] = [];
        this.consume(this.T.LParen);
        /**
         * Intentionally omits "generalEnclosed" from spec.
         * See the note on media queries.
         */
        let value: Node = this.or([
          { ALT: (): Node => this.supportsCondition(ctx) },
          { ALT: (): Node => this.declaration(ctx) }
        ]);
        this.consume(this.T.RParen);

        let location = this.endRule();
        if (!(value instanceof Node)) {
          value = new Sequence(values, undefined, this.getLocationFromNodes(values), this.context);
        }
        return this.wrap(new Paren(this.wrap(value, 'both'), undefined, location, this.context));
      }
    }
  ]);
}

/** Used within anyOuterValue  */
export function functionCallLike(this: P, ctx: RuleContext = {}) {
  this.startRule();
  const name = this.consume(this.T.FunctionStart);
  let args: Node[] = [];
  let seq: Sequence | undefined;
  this.many({
    GATE: () => {
      let tt = this.la(1).tokenType;
      return tt !== this.T.RParen && tt !== this.T.UrlEnd;
    },
    DEF: () => {
      const node = this.anyOuterValue(ctx);
      args.push(this.wrap(node));
    }
  });
  let location = args.length ? this.getLocationFromNodes(args) : undefined;
  if (args.length) {
    seq = new Sequence(args, undefined, location, this.context);
  }
  this.or([
    { ALT: () => this.consume(this.T.RParen) },
    { ALT: () => this.consume(this.T.UrlEnd) }
  ]);
  const endLocation = this.endRule();
  return this.wrap(new Call({ name: name.image.slice(0, -1), args: new List(seq ? [seq] : []) }, undefined, endLocation, this.context));
}

export function functionCall(this: P, ctx: RuleContext = {}) {
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

  return this.or([
    { ALT: () => this.ifFunction(ctx) },
    { ALT: () => this.knownFunctions(ctx) },
    {
      ALT: () => {
        this.startRule();

        let name = this.consume(this.T.FunctionStart);
        let args: List<Node> | undefined;

        this.option(() => args = this.functionCallArgs(ctx));
        this.consume(this.T.RParen);

        let location = this.endRule();
        const functionName = name.image.slice(0, -1);
        const modernSyntax = isModernColorCall(functionName, args);
        return new Call({
          name: functionName,
          args
        }, modernSyntax ? { modernSyntax: true } : undefined, location, this.context);
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
  this.startRule();

  let node = this.valueSequence(ctx);

  let commaNodes: Node[] = [this.wrap(node, true)];
  let semiNodes: Node[] = [];
  let isSemiList = false;

  this.many(() => {
    this.or([
      {
        GATE: () => !isSemiList,
        ALT: () => {
          this.consume(this.T.Comma);
          node = this.valueSequence(ctx);
          commaNodes!.push(this.wrap(node, true));
        }
      },
      {
        ALT: () => {
          isSemiList = true;

          this.consume(this.T.Semi);

          /** Aggregate the previous set of comma-nodes */
          if (commaNodes.length > 1) {
            let commaList = new List(commaNodes, undefined, this.getLocationFromNodes(commaNodes), this.context);
            semiNodes.push(commaList);
          } else {
            semiNodes.push(commaNodes[0]!);
          }
          node = this.valueList(ctx) as Node;
          semiNodes.push(this.wrap(node, true));
        }
      }
    ]);
  });

  this.endRule();
  const nodes = isSemiList ? semiNodes! : commaNodes!;
  return new List(nodes, isSemiList ? { sep: ';' } : undefined);
}

// https://www.w3.org/TR/css-cascade-4/#at-import
export function importAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();
  let name = this.consume(this.T.AtImport);
  let preludeNodes: Node[] = [];
  let node = this.importPrelude(ctx) as Node;

  preludeNodes!.push(this.wrap(node));

  let extraNodes: Node[] | undefined;
  this.option(() => {
    extraNodes = this.importPostlude(ctx) as Node[];
  });
  if (extraNodes && extraNodes.length) {
    for (const n of extraNodes) {
      preludeNodes!.push(n);
    }
  }
  this.consume(this.T.Semi);

  let location = this.endRule();
  return new AtRule({
    name: this.wrap(new Any(name.image, { role: 'atkeyword' }, this.getLocationInfo(name), this.context), true),
    prelude: new Sequence(preludeNodes!, undefined, this.getLocationFromNodes(preludeNodes!), this.context)
  }, undefined, location, this.context);
}

/** import prelude: url(...) or "string" */
export function importPrelude(this: P, ctx: RuleContext = {}) {
  return this.or([
    { ALT: () => this.urlFunction(ctx) },
    { ALT: () => this.string(ctx) }
  ]);
}

/** import postlude: optional layer(), supports(), media. Returns Node[] */
export function importPostlude(this: P, ctx: RuleContext = {}) {
  let nodes: Node[] = [];

  /** layer(responsive) */
  this.option(() => {
    let start = this.consume(this.T.Layer);
    let value: Node = this.layerName();
    let end = this.consume(this.T.RParen);
    let { startOffset, startLine, startColumn } = start;
    let { endOffset, endLine, endColumn } = end;
    let location: LocationInfo = [startOffset, startLine!, startColumn!, endOffset!, endLine!, endColumn!];
    nodes!.push(
      this.wrap(
        new Call({
          name: 'layer',
          args: new List([value])
        }, undefined, location, this.context)
      )
    );
  });

  /** supports(display: grid) */
  this.option(() => {
    let start = this.consume(this.T.Supports);
    let value = this.or([
      { ALT: () => this.supportsCondition(ctx) },
      { ALT: () => this.declaration(ctx) }
    ]);
    let end = this.consume(this.T.RParen);
    let { startOffset, startLine, startColumn } = start;
    let { endOffset, endLine, endColumn } = end;
    let location: LocationInfo = [startOffset, startLine!, startColumn!, endOffset!, endLine!, endColumn!];
    nodes!.push(
      this.wrap(
        new Call({
          name: 'supports',
          args: new List([this.wrap(value, 'both')])
        }, undefined, location, this.context)
      )
    );
  });

  /** media query list */
  this.option(() => {
    let mediaNode = this.mediaQueryList(ctx);
    nodes!.push(mediaNode);
  });

  return nodes!;
}

/**
 * @todo - add more structure for known nested at-rules.
 */
export function nestedAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();

  let name = this.consume(this.T.AtNested);
  let preludeNodes: Node[] = [];
  let rules: Rules;

  this.many(() => {
    let value = this.anyOuterValue(ctx);
    preludeNodes.push(this.wrap(value));
  });
  this.consume(this.T.LCurly);
  // All known nested at-rules use declaration lists in their blocks
  rules = this.declarationList(ctx) as Rules;
  this.consume(this.T.RCurly);

  return new AtRule({
    name: this.wrap(new Any(name.image, { role: 'atkeyword' }, this.getLocationInfo(name), this.context), true),
    prelude: preludeNodes!.length ? this.wrap(new Sequence(preludeNodes!, undefined, this.getLocationFromNodes(preludeNodes!), this.context), 'both') : undefined,
    rules
  }, undefined, this.endRule(), this.context);
}

export function nonNestedAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();
  let preludeNodes: Node[] = [];

  let name = this.consume(this.T.AtNonNested);
  this.many(() => preludeNodes.push(this.wrap(this.anyOuterValue(ctx))));
  this.consume(this.T.Semi);

  return new AtRule({
    name: this.wrap(new Any(name.image, { role: 'atkeyword' }, this.getLocationInfo(name), this.context), true),
    prelude: this.wrap(new Sequence(preludeNodes, undefined, this.getLocationFromNodes(preludeNodes), this.context))
  }, undefined, this.endRule(), this.context);
}

// unknownAtRule
//   : AT_RULE anyOuterValue* (SEMI | LCURLY anyInnerValue* RCURLY)
//   ;
export function unknownAtRule(this: P, ctx: RuleContext = {}) {
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
  } = this.T;

  this.startRule();

  let preludeNodes: Node[] = [];
  let valueNodes!: Node[];
  let declRules: Rules | undefined;
  let endToken: IToken | undefined;
  let innerBlockLocation: LocationInfo | undefined;

  let name = this.consume(this.T.AtKeyword);
  this.many(() => {
    let val = this.anyOuterValue(ctx);
    preludeNodes.push(this.wrap(val, 'both'));
  });
  this.or([
    { ALT: () => this.consume(Semi) },
    {
      ALT: () => {
        valueNodes = [];
        this.consume(LCurly);
        this.startRule();
        // 1) Fast selector/nested-at-rule start gate
        let t1 = this.la(1).tokenType;
        let t2 = this.la(2).tokenType;
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
        this.or([
          {
            GATE: () => assumeDeclList,
            ALT: () => {
              declRules = this.atRuleBody({ ...ctx, inner: true }) as Rules;
            }
          },
          {
            GATE: () => !assumeDeclList,
            ALT: () => {
              /** Fallback to raw capture */
              this.many(() => {
                const value = this.anyInnerValue(ctx);
                valueNodes.push(this.wrap(value, 'both'));
              });
            }
          }
        ]);
        endToken = this.consume(RCurly);
        innerBlockLocation = this.endRule();
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
      const seqLoc = this.getLocationFromNodes(valueNodes!);
      const seq = new Sequence(valueNodes!, undefined, seqLoc, this.context);
      // Use RawRules to avoid inserting newlines/indentation during serialization
      rules = new RawRules([seq], undefined, seqLoc, this.context) as unknown as Rules;
    }
  }
  return new AtRule({
    name: this.wrap(new Any(name.image, { role: 'atkeyword' }, this.getLocationInfo(name), this.context), true),
    prelude: preludeNodes!.length ? new Sequence(preludeNodes!, undefined, this.getLocationFromNodes(preludeNodes!), this.context) : undefined,
    rules
  }, undefined, this.endRule(), this.context);
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
  return this.or([
    { ALT: () => this.extraTokens(ctx) },
    { ALT: () => this.string(ctx) },
    {
      ALT: () => {
        this.startRule();
        let nodes: Node[] = [];
        this.consume(this.T.LParen);
        this.many(() => {
          let val = this.anyInnerValue(ctx);
          nodes.push(this.wrap(val));
        });
        this.consume(this.T.RParen);

        let location = this.endRule();
        return new Paren(
          nodes!.length ? new Sequence(nodes!, undefined, this.getLocationFromNodes(nodes!), this.context) : undefined,
          undefined,
          location,
          this.context
        );
      }
    },
    {
      ALT: () => {
        this.startRule();
        let nodes: Node[] = [];

        this.consume(this.T.LSquare);
        this.many(() => {
          let node = this.anyInnerValue(ctx);
          nodes.push(this.wrap(node));
        });
        this.consume(this.T.RSquare);

        let location = this.endRule();
        return new Paren(
          this.wrap(new Sequence(nodes!, undefined, this.getLocationFromNodes(nodes!), this.context), true),
          undefined,
          location,
          this.context
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
  return this.or([
    { ALT: () => this.anyOuterValue(ctx) },
    {
      ALT: () => {
        this.startRule();
        let nodes: Node[] = [];
        this.consume(this.T.LCurly);
        this.many(() => {
          let node = this.anyInnerValue(ctx);
          nodes.push(node);
        });
        this.consume(this.T.RCurly);

        let location = this.endRule();

        return new Block(
          this.wrap(new Sequence(nodes!, undefined, this.getLocationFromNodes(nodes!), this.context), 'both'),
          { type: 'curly' },
          location,
          this.context
        );
      }
    },
    {
      ALT: () => {
        let semi = this.consume(this.T.Semi);

        return this.wrap(new Any(semi.image, { role: 'semi' }, this.getLocationInfo(semi), this.context));
      }
    }
  ]);
}
