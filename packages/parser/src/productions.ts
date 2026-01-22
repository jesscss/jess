import { productions as cssProductions } from '@jesscss/css-parser';
import type { RuleContext, AltContext } from '@jesscss/css-parser';
import type { IToken } from 'chevrotain';
import {
  type TreeContext,
  Node,
  Any,
  type LocationInfo,
  Rules,
  Ruleset,
  VarDeclaration,
  Mixin,
  Call,
  Reference,
  Condition,
  If,
  type IfBranch,
  StyleImport,
  JsImport,
  Collection,
  Sequence,
  Quoted,
  Url,
  Expression,
  Paren,
  DefaultGuard,
  type Selector,
  type Node as JessNode,
  isNode
} from '@jesscss/core';
import type { JessActionsParser as P, TokenMap } from './jessActionsParser.js';

/**
 * Jess-specific productions.
 * 
 * Key syntax features:
 * - Variables: $var: value;
 * - Collections: $var: { key: value; }
 * - Mixins: mixin() { ... } or .mixin() { ... } or #mixin() { ... }
 * - Mixin calls: $ > mixin() or $ > #ns > .mixin()
 * - Conditionals: $if (condition) { ... } $else { ... }
 * - Interpolation: $(expr) and $(expr).class
 * - At-rules: @-compose, @-from ... import, @-export
 * - Guards: mixin() when (condition) { ... } (from Less)
 */

/**
 * Parse Jess variable declaration: $var: value;
 * $var is parsed as $ (Dollar token) + var (identifier) - two tokens
 */
export function jessVariableDeclaration(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    
    $.CONSUME(T.Dollar); // $ token
    const varName = $.CONSUME(T.PlainIdent); // var identifier
    $.CONSUME(T.Colon);
    const value = $.SUBRULE($.valueSequence, { ARGS: [ctx] });
    $.CONSUME(T.Semi);
    
    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      const name = new Any(varName.image, { role: 'property' }, $.getLocationInfo(varName), $.context);
      return new VarDeclaration({ name, value }, undefined, loc, $.context);
    }
  };
}

/**
 * Parse Jess mixin definition: mixin() { ... } or .mixin() { ... } or #mixin() { ... }
 */
export function jessMixinDefinition(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    
    // Parse selector (can be .mixin, #mixin, or plain mixin)
    const selector = $.SUBRULE($.selectorList, { ARGS: [ctx] });
    
    // Parse parameters (optional)
    let params: Node[] | undefined;
    $.OPTION({
      GATE: () => $.LA(1).tokenType === T.LParen,
      DEF: () => {
        $.CONSUME(T.LParen);
        params = [];
        $.OPTION2({
          DEF: () => {
            $.AT_LEAST_ONE_SEP({
              SEP: T.Comma,
              DEF: () => {
                const param = $.SUBRULE($.valueSequence, { ARGS: [ctx] });
                if (!RECORDING_PHASE) {
                  params!.push(param);
                }
              }
            });
          }
        });
        $.CONSUME(T.RParen);
      }
    });
    
    // Parse guard (optional): when (condition)
    let guard: Condition | undefined;
    $.OPTION3({
      GATE: () => {
        const la = $.LA(1);
        return (la.tokenType === T.PlainIdent || la.tokenType === T.Ident) && la.image === 'when';
      },
      DEF: () => {
        $.CONSUME(T.PlainIdent); // 'when'
        // Guard parsing - simplified for now, will need proper implementation
        // guard = $.SUBRULE($.guard, { ARGS: [ctx] });
      }
    });
    
    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] });
    $.CONSUME(T.RCurly);
    
    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      const selectorValue = selector.valueOf();
      const name = typeof selectorValue === 'string' ? selectorValue : String(selectorValue);
      return new Mixin(
        { name, params: params || [], rules, guard },
        undefined,
        loc,
        $.context
      );
    }
  };
}

/**
 * Parse Jess dollar expression.
 * 
 * Dollar expressions can be:
 * - $foo
 * - $foo.bar
 * - $foo.bar(arg1, arg2)
 * - $foo.bar(arg1, arg2)[0]
 * - $(foo) or $(1 + 1)px
 * - $ > .mixin() or $ > #ns > mixin()
 */
export function jessDollarExpression(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    
    $.CONSUME(T.Dollar); // $ token
    
    // Check if it's a parenthesized expression: $(expr)
    $.OR([
      {
        GATE: () => $.LA(1).tokenType === T.LParen,
        ALT: () => {
          // $(expr) - parenthesized expression
          $.CONSUME(T.LParen);
          const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] });
          $.CONSUME(T.RParen);
          
          if (!RECORDING_PHASE) {
            const loc = $.endRule();
            // Return the expression wrapped in Paren for interpolation
            return new Paren(expr, undefined, loc, $.context);
          }
          // In recording phase, still need to end the rule
          $.endRule();
        }
      },
      {
        GATE: () => $.LA(1).tokenType === T.Gt,
        ALT: () => {
          // $ > mixin() - mixin call
          return $.SUBRULE($.jessMixinCallExpression, { ARGS: [ctx] });
        }
      },
      {
        ALT: () => {
          // $foo or $foo.bar or $foo.bar() or $foo.bar()[0]
          // Start with identifier
          const ident = $.CONSUME(T.PlainIdent);
          
          if (!RECORDING_PHASE) {
            let node: Node = new Reference(
              ident.image,
              { type: 'variable', fallbackValue: false },
              $.getLocationInfo(ident),
              $.context
            );
            
            // Parse accessors: .bar, (args), [index]
            $.MANY({
              GATE: () => {
                const next = $.LA(1).tokenType;
                return (next === T.DotName || next === T.LParen || next === T.LSquare) && $.noSep();
              },
              DEF: () => {
                node = $.SUBRULE($.jessDollarAccessor, { ARGS: [{ ...ctx, node }] });
              }
            });
            
            const loc = $.endRule();
            return node;
          }
          // In recording phase, still need to end the rule
          $.endRule();
        }
      }
    ]);
  };
}

/**
 * Parse accessor chain: .bar, (args), [index]
 */
export function jessDollarAccessor(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext & { node: Node } = { node: null! }) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    let node = ctx.node;
    
    $.OR([
      {
        GATE: () => $.LA(1).tokenType === T.DotName && $.noSep(),
        ALT: () => {
          // Property access: .bar
          $.CONSUME(T.DotName);
          const prop = $.CONSUME(T.PlainIdent);
          if (!RECORDING_PHASE) {
            const propRef = new Reference(
              prop.image,
              { type: 'property', fallbackValue: false },
              $.getLocationInfo(prop),
              $.context
            );
            // Chain the property access onto the node
            // This creates a chained reference: node.prop
            node = new Call(
              { target: node, args: [propRef] },
              undefined,
              $.getLocationFromNodes([node, prop]),
              $.context
            );
          }
        }
      },
      {
        GATE: () => $.LA(1).tokenType === T.LParen && $.noSep(),
        ALT: () => {
          // Function call: (args)
          $.CONSUME(T.LParen);
          const args: Node[] = [];
          $.OPTION({
            DEF: () => {
              $.AT_LEAST_ONE_SEP({
                SEP: T.Comma,
                DEF: () => {
                  const arg = $.SUBRULE2($.valueSequence, { ARGS: [ctx] });
                  if (!RECORDING_PHASE) {
                    args.push(arg);
                  }
                }
              });
            }
          });
          $.CONSUME(T.RParen);
          if (!RECORDING_PHASE) {
            node = new Call(
              { target: node, args },
              undefined,
              $.getLocationFromNodes([node]),
              $.context
            );
          }
        }
      },
      {
        GATE: () => $.LA(1).tokenType === T.LSquare && $.noSep(),
        ALT: () => {
          // Array access: [index]
          $.CONSUME(T.LSquare);
          const index = $.SUBRULE3($.valueSequence, { ARGS: [ctx] });
          $.CONSUME(T.RSquare);
          if (!RECORDING_PHASE) {
            // Array access is also a Call with the index as an argument
            node = new Call(
              { target: node, args: [index] },
              undefined,
              $.getLocationFromNodes([node]),
              $.context
            );
          }
        }
      }
    ]);
    
    if (!RECORDING_PHASE) {
      return node;
    }
  };
}

/**
 * Parse mixin call expression: $ > .mixin() or $ > #ns > mixin()
 */
export function jessMixinCallExpression(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    
    $.CONSUME(T.Gt); // > (regular Gt token)
    
    // Parse chained mixin calls: mixin > inner-mixin()
    const mixinParts: Node[] = [];
    $.AT_LEAST_ONE(() => {
      const part = $.SUBRULE($.selectorList, { ARGS: [ctx] });
      if (!RECORDING_PHASE) {
        mixinParts.push(part);
      }
      // Check for more parts
      $.OPTION({
        GATE: () => $.LA(1).tokenType === T.Gt,
        DEF: () => $.CONSUME2(T.Gt)
      });
    });
    
    // Parse arguments (optional)
    let args: Node[] | undefined;
    $.OPTION2({
      GATE: () => $.LA(1).tokenType === T.LParen,
      DEF: () => {
        $.CONSUME(T.LParen);
        args = [];
        $.OPTION3({
          DEF: () => {
            $.AT_LEAST_ONE_SEP({
              SEP: T.Comma,
              DEF: () => {
                const arg = $.SUBRULE($.valueSequence, { ARGS: [ctx] });
                if (!RECORDING_PHASE) {
                  args!.push(arg);
                }
              }
            });
          }
        });
        $.CONSUME(T.RParen);
      }
    });
    
    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      // Build reference chain from mixin parts
      // This is simplified - actual implementation would need proper chaining
      const firstPart = mixinParts[0]!;
      const partValue = firstPart.valueOf();
      const name = typeof partValue === 'string' ? partValue : String(partValue);
      const ref = new Reference(
        { type: 'mixin', name, fallbackValue: false },
        undefined,
        $.getLocationFromNodes(mixinParts),
        $.context
      );
      return new Call({ target: ref, args: args || [] }, undefined, loc, $.context);
    }
  };
}

/**
 * Parse Jess conditional: $if (condition) { ... } [$else { ... }]
 * Also handles $while and $for (simplified for now)
 */
export function jessConditional(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    
    const keyword = $.OR([
      { ALT: () => $.CONSUME(T.IfKeyword) }, // $if
      { ALT: () => $.CONSUME(T.WhileKeyword) }, // $while
      { ALT: () => $.CONSUME(T.ForKeyword) } // $for
    ]);
    $.CONSUME(T.LParen);
    const condition = $.SUBRULE($.valueSequence, { ARGS: [ctx] });
    $.CONSUME(T.RParen);
    $.CONSUME(T.LCurly);
    const thenRules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] });
    $.CONSUME(T.RCurly);
    
    let elseRules: Rules | undefined;
    $.OPTION({
      GATE: () => {
        const la = $.LA(1);
        return (la.tokenType === T.PlainIdent || la.tokenType === T.Ident) && la.image === '$else';
      },
      DEF: () => {
        $.CONSUME(T.ElseKeyword); // $else
        $.CONSUME2(T.LCurly);
        elseRules = $.SUBRULE2($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] });
        $.CONSUME2(T.RCurly);
      }
    });
    
    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      const branches: IfBranch[] = [
        { condition, rules: thenRules }
      ];
      if (elseRules) {
        branches.push({ condition: new Any('true', { role: 'any' }, loc, $.context), rules: elseRules });
      }
      return new If({ branches }, undefined, loc, $.context);
    }
  };
}

/**
 * Parse @-compose './file.jess' [as <namespace>]
 */
export function jessComposeAtRule(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtCompose);
    
    const pathNode: Quoted | Url = $.OR([
      { ALT: () => $.SUBRULE($.urlFunction, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) }
    ]);
    
    let namespace: string | undefined;
    $.OPTION({
      GATE: () => {
        const la = $.LA(1);
        return (la.tokenType === T.PlainIdent || la.tokenType === T.Ident) && la.image === 'as';
      },
      DEF: () => {
        // Consume "as" keyword (just a PlainIdent)
        const asTok = ($.LA(1).tokenType === T.Ident)
          ? ($.CONSUME(T.Ident) as unknown as IToken)
          : ($.CONSUME(T.PlainIdent) as unknown as IToken);
        if (!RECORDING_PHASE && asTok.image !== 'as') {
          throw new Error('Expected "as" keyword');
        }
        const nsTok = ($.LA(1).tokenType === T.Ident)
          ? ($.CONSUME2(T.Ident) as unknown as IToken)
          : ($.CONSUME2(T.PlainIdent) as unknown as IToken);
        if (!RECORDING_PHASE) {
          namespace = nsTok.image;
        }
      }
    });
    
    $.CONSUME(T.Semi);
    
    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      return new StyleImport(
        { path: pathNode },
        {
          type: 'compose',
          namespace,
          importOptions: {}
        },
        loc,
        $.context
      );
    }
  };
}

/**
 * Parse @-from './file.js' import foo [as bar] [, (named, imports)]
 */
export function jessFromAtRule(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtFrom);
    
    const pathNode: Quoted | Url = $.OR([
      { ALT: () => $.SUBRULE($.urlFunction, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) }
    ]);
    
    // Consume "import" keyword (just a PlainIdent)
    const importTok = $.CONSUME(T.PlainIdent);
    if (!RECORDING_PHASE && importTok.image !== 'import') {
      throw new Error('Expected "import" keyword');
    }
    
    // Parse imports: foo, (named, imports), * as ns
    const imports: Array<{ name: string; alias?: string }> = [];
    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => {
        if ($.LA(1).tokenType === T.Star) {
          // * as ns
          $.CONSUME(T.Star);
          // Consume "as" keyword (just a PlainIdent)
        const asTok = ($.LA(1).tokenType === T.Ident)
          ? ($.CONSUME(T.Ident) as unknown as IToken)
          : ($.CONSUME(T.PlainIdent) as unknown as IToken);
        if (!RECORDING_PHASE && asTok.image !== 'as') {
          throw new Error('Expected "as" keyword');
        }
          const nsTok = ($.LA(1).tokenType === T.Ident)
            ? ($.CONSUME2(T.Ident) as unknown as IToken)
            : ($.CONSUME2(T.PlainIdent) as unknown as IToken);
          if (!RECORDING_PHASE) {
            imports.push({ name: '*', alias: nsTok.image });
          }
        } else if ($.LA(1).tokenType === T.LParen) {
          // (named, imports)
          $.CONSUME(T.LParen);
          $.AT_LEAST_ONE_SEP({
            SEP: T.Comma,
            DEF: () => {
              const nameTok = ($.LA(1).tokenType === T.Ident)
                ? ($.CONSUME3(T.Ident) as unknown as IToken)
                : ($.CONSUME3(T.PlainIdent) as unknown as IToken);
              let alias: string | undefined;
              $.OPTION({
                GATE: () => {
                  const la = $.LA(1);
                  return (la.tokenType === T.PlainIdent || la.tokenType === T.Ident) && la.image === 'as';
                },
                DEF: () => {
                  // Consume "as" keyword (just a PlainIdent)
                  const asTok = ($.LA(1).tokenType === T.Ident)
                    ? ($.CONSUME4(T.Ident) as unknown as IToken)
                    : ($.CONSUME4(T.PlainIdent) as unknown as IToken);
                  if (!RECORDING_PHASE && asTok.image !== 'as') {
                    throw new Error('Expected "as" keyword');
                  }
                  const aliasTok = ($.LA(1).tokenType === T.Ident)
                    ? ($.CONSUME5(T.Ident) as unknown as IToken)
                    : ($.CONSUME5(T.PlainIdent) as unknown as IToken);
                  if (!RECORDING_PHASE) {
                    alias = aliasTok.image;
                  }
                }
              });
              if (!RECORDING_PHASE) {
                imports.push({ name: nameTok.image, alias });
              }
            }
          });
          $.CONSUME(T.RParen);
        } else {
          // Simple name [as alias]
          const nameTok = ($.LA(1).tokenType === T.Ident)
            ? ($.CONSUME6(T.Ident) as unknown as IToken)
            : ($.CONSUME6(T.PlainIdent) as unknown as IToken);
          let alias: string | undefined;
          $.OPTION2({
            GATE: () => {
              const la = $.LA(1);
              return (la.tokenType === T.PlainIdent || la.tokenType === T.Ident) && la.image === 'as';
            },
            DEF: () => {
              // Consume "as" keyword (just a PlainIdent)
              const asTok = ($.LA(1).tokenType === T.Ident)
                ? ($.CONSUME7(T.Ident) as unknown as IToken)
                : ($.CONSUME7(T.PlainIdent) as unknown as IToken);
              if (!RECORDING_PHASE && asTok.image !== 'as') {
                throw new Error('Expected "as" keyword');
              }
              const aliasTok = ($.LA(1).tokenType === T.Ident)
                ? ($.CONSUME8(T.Ident) as unknown as IToken)
                : ($.CONSUME8(T.PlainIdent) as unknown as IToken);
              if (!RECORDING_PHASE) {
                alias = aliasTok.image;
              }
            }
          });
          if (!RECORDING_PHASE) {
            imports.push({ name: nameTok.image, alias });
          }
        }
      }
    });
    
    $.CONSUME(T.Semi);
    
    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      return new JsImport(
        { path: pathNode, imports },
        undefined,
        loc,
        $.context
      );
    }
  };
}

/**
 * Parse @-export './file.jess' [as <namespace>]
 */
export function jessExportAtRule(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.AtExport);
    
    const pathNode: Quoted | Url = $.OR([
      { ALT: () => $.SUBRULE($.urlFunction, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) }
    ]);
    
    let namespace: string | undefined;
    $.OPTION({
      GATE: () => {
        const la = $.LA(1);
        return (la.tokenType === T.PlainIdent || la.tokenType === T.Ident) && la.image === 'as';
      },
      DEF: () => {
        // Consume "as" keyword (just a PlainIdent)
        const asTok = ($.LA(1).tokenType === T.Ident)
          ? ($.CONSUME(T.Ident) as unknown as IToken)
          : ($.CONSUME(T.PlainIdent) as unknown as IToken);
        if (!RECORDING_PHASE && asTok.image !== 'as') {
          throw new Error('Expected "as" keyword');
        }
        const nsTok = ($.LA(1).tokenType === T.Ident)
          ? ($.CONSUME2(T.Ident) as unknown as IToken)
          : ($.CONSUME2(T.PlainIdent) as unknown as IToken);
        if (!RECORDING_PHASE) {
          namespace = nsTok.image;
        }
      }
    });
    
    $.CONSUME(T.Semi);
    
    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      return new StyleImport(
        { path: pathNode },
        {
          type: 'compose',
          namespace,
          importOptions: {
            forward: true
          }
        },
        loc,
        $.context
      );
    }
  };
}

// Re-export guard productions from less-parser
// These will be imported and used directly, not re-exported
// We'll need to adapt them to work with JessActionsParser

/**
 * Override unknownAtRule to handle Jess-specific at-rules.
 */
export function unknownAtRule(this: P, T: TokenMap) {
  const $ = this;
  const baseUnknown = cssProductions.unknownAtRule.call(this, T);

  return (ctx: RuleContext = {}) => {
    const img = $.LA(1).image;
    if (img === '@-compose') {
      return $.SUBRULE($.jessComposeAtRule, { ARGS: [ctx] });
    }
    if (img === '@-from') {
      return $.SUBRULE($.jessFromAtRule, { ARGS: [ctx] });
    }
    if (img === '@-export') {
      return $.SUBRULE($.jessExportAtRule, { ARGS: [ctx] });
    }
    return baseUnknown(ctx);
  };
}

/**
 * Override anyOuterValue to include dollar expressions.
 * Used in at-rule preludes and other "any value" contexts.
 */
export function anyOuterValue(this: P, T: TokenMap) {
  const $ = this;
  const baseAnyOuterValue = cssProductions.anyOuterValue.call(this, T);

  return (ctx: RuleContext = {}) => {
    const la1 = $.LA(1);
    
    // Dollar expression: $foo, $(expr), $ > mixin()
    if (la1.tokenType === T.Dollar) {
      return $.SUBRULE($.jessDollarExpression, { ARGS: [ctx] });
    }
    
    return baseAnyOuterValue(ctx);
  };
}

/**
 * Override anyInnerValue to include dollar expressions.
 * Used in at-rule bodies and interpolation contexts.
 */
export function anyInnerValue(this: P, T: TokenMap) {
  const $ = this;
  const baseAnyInnerValue = cssProductions.anyInnerValue.call(this, T);

  return (ctx: RuleContext = {}) => {
    const la1 = $.LA(1);
    
    // Dollar expression: $foo, $(expr), $ > mixin()
    if (la1.tokenType === T.Dollar) {
      return $.SUBRULE($.jessDollarExpression, { ARGS: [ctx] });
    }
    
    return baseAnyInnerValue(ctx);
  };
}

/**
 * Override value production to include dollar expressions.
 * This makes dollar expressions available everywhere values can be used,
 * just like SCSS's $var and Less's @var.
 */
export function value(this: P, T: TokenMap, valueAlt?: AltContext) {
  const $ = this;
  const baseValue = cssProductions.value.call(this, T, valueAlt);

  // Build value alternatives, adding dollar expression at the beginning
  const jessValueAlt = (ctx: RuleContext = {}) => {
    const baseAlt = valueAlt ? valueAlt(ctx) : [
      { ALT: () => $.SUBRULE($.functionCall, { ARGS: [ctx] }) },
      { ALT: () => $.CONSUME(T.Ident) },
      { ALT: () => $.CONSUME(T.Dimension) },
      { ALT: () => $.CONSUME(T.Number) },
      { ALT: () => $.CONSUME(T.Color) },
      { ALT: () => $.CONSUME(T.UnicodeRange) },
      { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.squareValue, { ARGS: [ctx] }) },
      {
        GATE: () => $.legacyMode,
        ALT: () => $.CONSUME(T.LegacyMSFilter)
      }
    ];
    
    // Add dollar expression as first alternative (highest priority)
    return [
      {
        ALT: () => $.SUBRULE($.jessDollarExpression, { ARGS: [ctx] })
      },
      ...baseAlt
    ];
  };

  return (ctx: RuleContext = {}) => {
    $.startRule();
    let node: Node = $.OR(jessValueAlt(ctx));
    let additionalValue: Node | undefined;
    $.OPTION({
      GATE: () => $.LA(1).tokenType === T.Slash,
      DEF: () => {
        $.CONSUME(T.Slash);
        additionalValue = $.SUBRULE($.value, { ARGS: [ctx] });
      }
    });
    if (!$.RECORDING_PHASE) {
      const location = $.endRule();
      if (additionalValue) {
        return $.wrap(new List([$.wrap(node, true), additionalValue], { sep: '/' }, location, $.context));
      }
      return $.wrap(node);
    }
  };
}

/**
 * Override main to handle Jess variable declarations and mixin definitions at root level.
 */
export function main(this: P, T: TokenMap) {
  const $ = this;
  const baseMain = cssProductions.main.call(this, T);

  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    const isRoot = !!ctx.isRoot;
    let context: TreeContext;

    if (!RECORDING_PHASE) {
      context = this.context;
    }
    let rules: Node[];

    if (!RECORDING_PHASE) {
      rules = [];
    }

    let requiredSemi = false;
    let lastRule: Node | undefined;

    $.MANY({
      GATE: () => !requiredSemi || (requiredSemi && (
        $.LA(1).tokenType === T.Semi
        || $.LA(0).tokenType === T.Semi
      )),
      DEF: () => {
        const la1 = $.LA(1);
        
      // Variable declaration: $var: value; ($ + identifier + :)
      if (la1.tokenType === T.Dollar && $.LA(2).tokenType === T.PlainIdent && $.LA(3).tokenType === T.Colon) {
          const value = $.SUBRULE($.jessVariableDeclaration, { ARGS: [ctx] });
          if (!RECORDING_PHASE) {
            requiredSemi = !!(value as any).requiredSemi;
            rules.push(value);
            lastRule = value;
          }
          return;
        }
        
        // Mixin definition: mixin() { ... } or .mixin() { ... } or #mixin() { ... }
        if (
          (la1.tokenType === T.DotName || la1.tokenType === T.HashName || la1.tokenType === T.PlainIdent) &&
          ($.LA(2).tokenType === T.LParen || $.LA(2).tokenType === T.LCurly)
        ) {
          const value = $.SUBRULE($.jessMixinDefinition, { ARGS: [ctx] });
          if (!RECORDING_PHASE) {
            requiredSemi = !!(value as any).requiredSemi;
            rules.push(value);
            lastRule = value;
          }
          return;
        }
        
      // Conditional: $if (condition) { ... } or $while, $for
      if (la1.tokenType === T.IfKeyword || la1.tokenType === T.WhileKeyword || la1.tokenType === T.ForKeyword) {
          const value = $.SUBRULE($.jessConditional, { ARGS: [ctx] });
          if (!RECORDING_PHASE) {
            requiredSemi = !!(value as any).requiredSemi;
            rules.push(value);
            lastRule = value;
          }
          return;
        }
        
      // Dollar expression at root level (as statement, like Less mixin calls)
      // Note: $ > mixin() is a dollar expression, but we handle it specially
      if (la1.tokenType === T.Dollar && $.LA(2).tokenType === T.Gt) {
        // $ > mixin() - mixin call at root
        const mixinCall = $.SUBRULE($.jessDollarExpression, { ARGS: [ctx] });
        $.OPTION({
          GATE: () => $.LA(1).tokenType === T.Semi,
          DEF: () => $.CONSUME(T.Semi)
        });
        if (!RECORDING_PHASE) {
          requiredSemi = false;
          rules.push(mixinCall);
          lastRule = mixinCall;
        }
        return;
      }
      if (la1.tokenType === T.Dollar) {
        const dollarExpr = $.SUBRULE($.jessDollarExpression, { ARGS: [ctx] });
        // Dollar expressions at root level may or may not need semicolons
        $.OPTION({
          GATE: () => $.LA(1).tokenType === T.Semi,
          DEF: () => $.CONSUME(T.Semi)
        });
        if (!RECORDING_PHASE) {
          requiredSemi = false; // Dollar expressions don't require semicolons
          rules.push(dollarExpr);
          lastRule = dollarExpr;
        }
        return;
      }
        
        // Fall back to base main parsing (CSS rules, at-rules, etc.)
        const localAlt = [
          { ALT: () => $.SUBRULE($.qualifiedRule) },
          { ALT: () => $.SUBRULE($.atRule) }
        ];
        let value = $.OR(localAlt);
        if (!RECORDING_PHASE) {
          if (!(value instanceof Node)) {
            if (lastRule) {
              lastRule.options.semi = true;
            } else {
              rules.push(new Any(';', { role: 'semi' }, $.getLocationInfo($.LA(1)), context));
            }
          } else {
            requiredSemi = !!(value as any).requiredSemi;
            rules.push(value);
            lastRule = value;
          }
        }
      }
    });

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      let returnNode = $.getRulesWithComments(rules!, loc);
      const wrapped = $.wrap(returnNode!, true);
      return wrapped;
    }
    // In recording phase, don't call endRule - it's handled by the base parser
  };
}
