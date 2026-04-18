import { productions as cssProductions } from '@jesscss/css-parser';
import type { RuleContext, AltContext } from '@jesscss/css-parser';
import type { IToken } from 'chevrotain';
import { tokenMatcher, Lexer } from 'chevrotain';
import { createLexerDefinition } from '@jesscss/css-parser';
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
  isNode,
  N,
  Color,
  ColorFormat,
  Interpolated,
  INTERPOLATION_PLACEHOLDER,
  Declaration,
  CustomDeclaration,
  List,
  AssignmentType
} from '@jesscss/core';
import colors from 'color-name';
import type { TokenMap } from './jessActionsParser.js';
import { JessActionsParser as P } from './jessActionsParser.js';
import { jessFragments, jessTokens } from './jessTokens.js';

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
    $.CONSUME(T.Assign); // : (colon) - CSS parser uses Assign for declarations
    const value = $.SUBRULE($.valueSequence, { ARGS: [ctx] });
    $.CONSUME(T.Semi);

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      const name = new Any(varName.image, { role: 'property' }, $.getLocationInfo(varName), $.context);
      return new VarDeclaration({ name, value }, undefined, loc, $.context);
    }
    return undefined;
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
        { name: new Any(name, { role: 'name' }), params: Array.isArray(params) ? new List(params) : (params ?? new List([])), rules, guard },
        undefined,
        loc,
        $.context
      );
    }
    return undefined;
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
    let result: Node | undefined;
    $.OR([
      {
        GATE: () => $.LA(1).tokenType === T.LParen,
        ALT: () => {
          // $(expr) - parenthesized expression
          $.CONSUME(T.LParen);
          const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] });
          $.CONSUME(T.RParen);

          if (!RECORDING_PHASE) {
            // Return the expression wrapped in Paren for interpolation
            result = new Paren(expr, undefined, $.getLocationFromNodes([expr]), $.context);
          }
        }
      },
      {
        GATE: () => $.LA(1).tokenType === T.Gt,
        ALT: () => {
          // $ > mixin() - mixin call
          // Note: jessMixinCallExpression will handle its own startRule/endRule
          result = $.SUBRULE($.jessMixinCallExpression, { ARGS: [ctx] });
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

            result = node;
          }
        }
      }
    ]);

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      // Wrap in Expression node if we're in an expression context
      // This ensures proper serialization (preserves $ prefix)
      if (result && ctx.wrapInExpression && !isNode(result, N.Expression)) {
        return new Expression(result, undefined, loc, $.context);
      }
      return result;
    }
    return undefined;
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
              { name: node, args: new List([propRef]) },
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
              { name: node, args: new List(args) },
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
              { name: node, args: new List([index]) },
              undefined,
              $.getLocationFromNodes([node]),
              $.context
            );
          }
        }
      }
    ]);

    // Always return node (modified or original)
    return node;
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
        { key: name },
        { type: 'mixin', fallbackValue: false },
        $.getLocationFromNodes(mixinParts),
        $.context
      );
      return new Call({ name: ref, args: new List(args || []) }, undefined, loc, $.context);
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
      return new If({
        branches: [
          { condition, rules: thenRules },
          ...(elseRules ? [{ rules: elseRules }] : [])
        ]
      }, undefined, loc, $.context);
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
          ? ($.CONSUME(T.Ident))
          : ($.CONSUME(T.PlainIdent));
        if (!RECORDING_PHASE && asTok.image !== 'as') {
          throw new Error('Expected "as" keyword');
        }
        const nsTok = ($.LA(1).tokenType === T.Ident)
          ? ($.CONSUME2(T.Ident))
          : ($.CONSUME2(T.PlainIdent));
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
            ? ($.CONSUME(T.Ident))
            : ($.CONSUME(T.PlainIdent));
          if (!RECORDING_PHASE && asTok.image !== 'as') {
            throw new Error('Expected "as" keyword');
          }
          const nsTok = ($.LA(1).tokenType === T.Ident)
            ? ($.CONSUME2(T.Ident))
            : ($.CONSUME2(T.PlainIdent));
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
                ? ($.CONSUME3(T.Ident))
                : ($.CONSUME3(T.PlainIdent));
              let alias: string | undefined;
              $.OPTION({
                GATE: () => {
                  const la = $.LA(1);
                  return (la.tokenType === T.PlainIdent || la.tokenType === T.Ident) && la.image === 'as';
                },
                DEF: () => {
                  // Consume "as" keyword (just a PlainIdent)
                  const asTok = ($.LA(1).tokenType === T.Ident)
                    ? ($.CONSUME4(T.Ident))
                    : ($.CONSUME4(T.PlainIdent));
                  if (!RECORDING_PHASE && asTok.image !== 'as') {
                    throw new Error('Expected "as" keyword');
                  }
                  const aliasTok = ($.LA(1).tokenType === T.Ident)
                    ? ($.CONSUME5(T.Ident))
                    : ($.CONSUME5(T.PlainIdent));
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
            ? ($.CONSUME6(T.Ident))
            : ($.CONSUME6(T.PlainIdent));
          let alias: string | undefined;
          $.OPTION2({
            GATE: () => {
              const la = $.LA(1);
              return (la.tokenType === T.PlainIdent || la.tokenType === T.Ident) && la.image === 'as';
            },
            DEF: () => {
              // Consume "as" keyword (just a PlainIdent)
              const asTok = ($.LA(1).tokenType === T.Ident)
                ? ($.CONSUME7(T.Ident))
                : ($.CONSUME7(T.PlainIdent));
              if (!RECORDING_PHASE && asTok.image !== 'as') {
                throw new Error('Expected "as" keyword');
              }
              const aliasTok = ($.LA(1).tokenType === T.Ident)
                ? ($.CONSUME8(T.Ident))
                : ($.CONSUME8(T.PlainIdent));
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
          ? ($.CONSUME(T.Ident))
          : ($.CONSUME(T.PlainIdent));
        if (!RECORDING_PHASE && asTok.image !== 'as') {
          throw new Error('Expected "as" keyword');
        }
        const nsTok = ($.LA(1).tokenType === T.Ident)
          ? ($.CONSUME2(T.Ident))
          : ($.CONSUME2(T.PlainIdent));
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
      const exprCtx: RuleContext = { ...ctx, wrapInExpression: true };
      return $.SUBRULE($.jessDollarExpression, { ARGS: [exprCtx] });
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
      const exprCtx: RuleContext = { ...ctx, wrapInExpression: true };
      return $.SUBRULE($.jessDollarExpression, { ARGS: [exprCtx] });
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

  // Build value alternatives, adding dollar expression at the beginning
  // Follow SCSS pattern - don't call baseValue, build our own alternatives
  const jessValueAlt = valueAlt ?? ((ctx: RuleContext = {}) => [
    // PlainIdent: Jess's main identifier token - put first so it matches before functionCall
    // processValueToken will handle color keyword conversion to Color node
    { ALT: () => $.CONSUME(T.PlainIdent) },
    // Follow SCSS pattern: functionCall after PlainIdent (Chevrotain handles ambiguity)
    { ALT: () => $.SUBRULE($.functionCall, { ARGS: [ctx] }) },
    // Ident: only match actual Ident tokens, not PlainIdent (to resolve ambiguity)
    // PlainIdent is in Ident category, so we need to check the actual token type name
    {
      GATE: () => {
        const tokenType = $.LA(1).tokenType;
        return tokenType.name === 'Ident';
      },
      ALT: () => $.CONSUME(T.Ident)
    },
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
  ]);

  // Add dollar expression as first alternative (highest priority)
  // Wrap in expression context for proper serialization
  const finalValueAlt = (ctx: RuleContext = {}) => {
    const baseAlt = typeof jessValueAlt === 'function' ? jessValueAlt(ctx) : jessValueAlt;
    return [
      {
        // Only try dollar expression if next token is Dollar
        GATE: () => $.LA(1).tokenType === T.Dollar,
        ALT: () => {
          const exprCtx: RuleContext = { ...ctx, wrapInExpression: true };
          return $.SUBRULE($.jessDollarExpression, { ARGS: [exprCtx] });
        }
      },
      ...baseAlt
    ];
  };

  return (ctx: RuleContext = {}) => {
    $.startRule();
    let node: Node = $.OR(finalValueAlt(ctx));
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
      if (!(node instanceof Node)) {
        node = $.processValueToken(node);
      }
      if (additionalValue) {
        return new List([node, additionalValue], { sep: '/' }, location, $.context);
      }
      return node;
    }
  };
}

/**
 * Helper functions for Jess interpolation support.
 * Similar to SCSS but uses $(expr) syntax instead of #{expr}.
 */

type InterpolationMatch = { start: number; end: number; content: string };

/**
 * Find all $(expr) interpolations in a string.
 * Handles nested parentheses correctly.
 */
function findJessInterpolations(value: string): InterpolationMatch[] {
  const matches: InterpolationMatch[] = [];
  let i = 0;
  while (i < value.length) {
    if (value[i] === '$' && value[i + 1] === '(') {
      const start = i;
      i += 2; // skip $(
      let parenCount = 1;
      const contentStart = i;
      while (i < value.length && parenCount > 0) {
        const ch = value[i]!;
        if (ch === '(') {
          parenCount++;
        } else if (ch === ')') {
          parenCount--;
        }
        i++;
      }
      if (parenCount === 0) {
        matches.push({ start, end: i, content: value.slice(contentStart, i - 1) });
      }
    } else {
      i++;
    }
  }
  return matches;
}

let interpolationParser:
  | {
    lexer: Lexer;
    parser: P;
  }
  | undefined;

/**
 * Get or create a parser instance for parsing interpolation expressions.
 * Uses a separate parser instance to avoid state conflicts.
 */
function getInterpolationParser(): { lexer: Lexer; parser: P } {
  if (interpolationParser) {
    return interpolationParser;
  }
  const { lexer, T } = createLexerDefinition(jessFragments(), jessTokens());
  const chevLexer = new Lexer(lexer, {
    ensureOptimizations: true,
    skipValidations: process.env.TEST !== 'true'
  });
  const parser = new P(lexer, T as unknown as TokenMap, {
    skipValidations: process.env.TEST !== 'true'
  });
  interpolationParser = { lexer: chevLexer, parser };
  return interpolationParser;
}

/**
 * Parse an interpolation expression string into a Node.
 * The expression is parsed as a valueSequence (full expression support).
 */
function parseInterpolationExpression(expr: string): Node {
  const { lexer, parser } = getInterpolationParser();
  const lexed = lexer.tokenize(expr);
  parser.input = lexed.tokens;
  // Parse as a value sequence (expression-ish).
  return parser.valueSequence({}) as Node;
}

/**
 * Process a string value that may contain $(expr) interpolations.
 * Returns an Any node if no interpolation, or Interpolated node if interpolations found.
 */
function processJessStringInterpolation(
  value: string,
  location: LocationInfo,
  context: TreeContext
): Any | Interpolated {
  const matches = findJessInterpolations(value);
  if (matches.length === 0) {
    return new Any(value, { role: 'any' }, location, context);
  }

  const replacements: Node[] = [];
  let source = value;
  let offset = 0;

  for (const match of matches) {
    const adjustedStart = match.start - offset;
    const adjustedEnd = match.end - offset;
    const before = source.slice(0, adjustedStart);
    const after = source.slice(adjustedEnd);
    source = before + INTERPOLATION_PLACEHOLDER + after;
    offset += (match.end - match.start) - INTERPOLATION_PLACEHOLDER.length;

    const parsed = parseInterpolationExpression(match.content.trim());
    replacements.push(parsed);
  }

  return new Interpolated({ source, replacements }, { role: 'any' }, location, context);
}

/**
 * Override CSS `declaration` to support Jess interpolated property names.
 * Handles patterns like `bar$(foo): value;`, `$(prop): value;`, `--x-$(y): value;`
 */
export function declaration(this: P, T: TokenMap, alt?: AltContext) {
  const $ = this;

  // Inline the CSS declaration production (rather than calling it) so we can
  // add interpolated property names without Chevrotain "numerical suffix" conflicts.
  //
  // Key point: all parsing DSL calls remain reachable during RECORDING_PHASE.

  const looksLikeInterpolatedDeclName = () => {
    // Look ahead until ':' and see if we encounter `$(`.
    // This keeps the fast path for normal CSS declarations.
    for (let i = 1; i < 64; i++) {
      const tok = $.LA(i);
      if (tok.tokenType === T.Assign || tok.tokenType.name === 'EOF') {
        return false;
      }
      if (tok.tokenType === T.InterpolationStart) {
        return true;
      }
    }
    return false;
  };

  alt ??= (ctx: RuleContext = {}) => [
    {
      // Jess interpolated declaration name: `foo-$(bar): ...`, `$(prop): ...`, `--x-$(y): ...`
      GATE: () => (
        (
          $.LA(1).tokenType === T.PlainIdent
          || $.LA(1).tokenType === T.Ident
          || $.LA(1).tokenType === T.CustomProperty
          || ($.legacyMode && $.LA(1).tokenType === T.LegacyPropIdent)
          || $.LA(1).tokenType === T.InterpolationStart
        ) && looksLikeInterpolatedDeclName()
      ),
      ALT: () => {
        const RECORDING_PHASE = $.RECORDING_PHASE;
        let source = '';
        const replacements: Node[] = [];

        $.AT_LEAST_ONE({
          DEF: () => {
            $.OR([
              {
                GATE: () => $.LA(1).tokenType === T.InterpolationStart,
                ALT: () => {
                  $.CONSUME(T.InterpolationStart);
                  const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
                  $.CONSUME(T.RParen);
                  if (!RECORDING_PHASE) {
                    source += INTERPOLATION_PLACEHOLDER;
                    replacements.push(expr);
                  }
                }
              },
              {
                ALT: () => {
                  const tok = $.OR([
                    { ALT: () => $.CONSUME(T.PlainIdent) },
                    { ALT: () => $.CONSUME(T.Ident) },
                    { ALT: () => $.CONSUME(T.CustomProperty) },
                    {
                      GATE: () => $.legacyMode,
                      ALT: () => $.CONSUME(T.LegacyPropIdent)
                    }
                  ]);
                  if (!RECORDING_PHASE) {
                    source += tok.image;
                  }
                }
              }
            ]);
          }
        });

        const assign = $.CONSUME(T.Assign);
        const value = $.SUBRULE($.valueList, { ARGS: [ctx] });
        let important: IToken | undefined;
        $.OPTION(() => {
          important = $.CONSUME(T.Important);
        });

        if (!RECORDING_PHASE) {
          const nameNode = new Interpolated({ source, replacements }, { role: 'property' }, $.getLocationFromNodes(replacements), $.context);
          return [nameNode, assign, value, important] as const;
        }
      }
    },
    {
      ALT: () => {
        let name: IToken;
        $.OR([
          { ALT: () => name = $.CONSUME(T.PlainIdent) },
          { ALT: () => name = $.CONSUME(T.Ident) },
          {
            GATE: () => $.legacyMode,
            ALT: () => name = $.CONSUME(T.LegacyPropIdent)
          }
        ]);
        const assign = $.CONSUME(T.Assign);
        const value = $.SUBRULE($.valueList, { ARGS: [ctx] });
        let important: IToken | undefined;
        $.OPTION(() => {
          important = $.CONSUME(T.Important);
        });
        if (!$.RECORDING_PHASE) {
          const nameNode = new Any(name!.image, { role: 'property' }, $.getLocationInfo(name!), $.context);
          return [nameNode, assign, value, important] as const;
        }
      }
    },
    {
      ALT: () => {
        const RECORDING_PHASE = $.RECORDING_PHASE;
        const name = $.CONSUME(T.CustomProperty);
        const assign = $.CONSUME2(T.Assign);
        let nodes: Node[] | undefined;
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        $.startRule();
        $.MANY(() => {
          const val = $.SUBRULE($.value, { ARGS: [ctx] });
          if (!RECORDING_PHASE) {
            nodes!.push(val);
          }
        });
        if (!RECORDING_PHASE) {
          const location = $.endRule();
          const nameNode = new Any(name.image, { role: 'property' }, $.getLocationInfo(name), $.context);
          const value = new Sequence(nodes!, undefined, location, $.context);
          return [nameNode, assign, value] as const;
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let name: Any<'property'> | Interpolated<'property'> | undefined;
    let assign: IToken | undefined;
    let value: Node | undefined;
    let important: IToken | undefined;

    const picked: unknown = $.OR(alt!(ctx));

    if (!RECORDING_PHASE) {
      if (Array.isArray(picked)) {
        if (picked.length === 3) {
          [name, assign, value] = picked as [typeof name, typeof assign, typeof value];
        } else {
          [name, assign, value, important] = picked as [typeof name, typeof assign, typeof value, typeof important];
        }
      }
    }

    if (!RECORDING_PHASE) {
      const location = $.endRule();

      // Match CSS parser behavior: return Declaration / CustomDeclaration.
      const isCustom = String(name!.valueOf()).startsWith('--');
      return new (isCustom ? CustomDeclaration : Declaration)({
        name: name!,
        value: value!,
        important: important ? new Any(important.image, { role: 'flag' }, $.getLocationInfo(important), $.context) : undefined
      }, { assign: assign!.image as unknown as AssignmentType }, location, $.context);
    }
  };
}

/**
 * Override CSS `string` to support Jess interpolation `$(expr)` inside quoted strings.
 */
export function string(this: P, T: TokenMap, stringAlt?: AltContext) {
  const $ = this;

  stringAlt ??= (ctx: RuleContext = {}) => [
    {
      ALT: () => {
        const RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        $.CONSUME(T.SingleQuoteStart);

        let contents: IToken | undefined;
        $.OPTION(() => contents = $.CONSUME(T.SingleQuoteStringContents));

        $.CONSUME(T.SingleQuoteEnd);
        if (!RECORDING_PHASE) {
          const location = $.endRule();
          const raw = contents?.image ?? '';
          const inner = processJessStringInterpolation(raw, location, $.context);
          return new Quoted(inner, { quote: '\'' }, location, $.context);
        }
      }
    },
    {
      ALT: () => {
        const RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        $.CONSUME2(T.DoubleQuoteStart);

        let contents: IToken | undefined;
        $.OPTION2(() => contents = $.CONSUME2(T.DoubleQuoteStringContents));

        $.CONSUME(T.DoubleQuoteEnd);
        if (!RECORDING_PHASE) {
          const location = $.endRule();
          const raw = contents?.image ?? '';
          const inner = processJessStringInterpolation(raw, location, $.context);
          return new Quoted(inner, { quote: '"' }, location, $.context);
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => $.OR(stringAlt!(ctx));
}

/**
 * Override main to handle Jess variable declarations and mixin definitions at root level.
 * Follows the same pattern as SCSS parser - pass alt function to cssProductions.main.
 */
export function main(this: P, T: TokenMap, alt?: AltContext) {
  const $ = this;
  alt ??= (ctx: RuleContext = {}) => [
    // Conditional: $if (condition) { ... } or $while, $for
    // Check these first since they're keywords (single tokens)
    {
      GATE: () => {
        const la1 = $.LA(1);
        return la1.tokenType === T.IfKeyword || la1.tokenType === T.WhileKeyword || la1.tokenType === T.ForKeyword;
      },
      ALT: () => $.SUBRULE($.jessConditional, { ARGS: [ctx] })
    },
    // Jess variable declaration: $var: value;
    // GATE on third token being ':' distinguishes from:
    // - $ > mixin() (third token is '>')
    // - $foo (third token is ';' or EOF)
    // The PlainIdent check ensures it's a variable declaration, not an expression
    {
      GATE: () => {
        const la1 = $.LA(1);
        const la2 = $.LA(2);
        const la3 = $.LA(3);
        return la1 && la2 && la3
          && la1.tokenType === T.Dollar
          && la2.tokenType === T.PlainIdent
          && la3.tokenType === T.Colon;
      },
      ALT: () => $.SUBRULE($.jessVariableDeclaration, { ARGS: [ctx] })
    },
    // Mixin definition: mixin() { ... } or .mixin() { ... } or #mixin() { ... }
    // Check for class/id/plain ident followed by LParen (function start)
    {
      GATE: () => {
        const la1 = $.LA(1).tokenType;
        const la2 = $.LA(2).tokenType;
        return (la1 === T.DotName || la1 === T.HashName || la1 === T.PlainIdent)
          && la2 === T.LParen;
      },
      ALT: () => $.SUBRULE($.jessMixinDefinition, { ARGS: [ctx] })
    },
    // Dollar expression at root level: $ > mixin() or $foo or $foo.bar()
    // This must come after variable declaration check
    // Wrap in Expression node for proper serialization (preserves $ prefix)
    {
      GATE: () => $.LA(1).tokenType === T.Dollar,
      ALT: () => {
        const exprCtx: RuleContext = { ...ctx, wrapInExpression: true };
        const dollarExpr = $.SUBRULE($.jessDollarExpression, { ARGS: [exprCtx] });
        // Dollar expressions at root level may or may not need semicolons
        $.OPTION({
          GATE: () => $.LA(1).tokenType === T.Semi,
          DEF: () => $.CONSUME(T.Semi)
        });
        // Wrap in Expression node for proper serialization
        if (!$.RECORDING_PHASE && dollarExpr && !isNode(dollarExpr, N.Expression)) {
          return new Expression(dollarExpr, undefined, dollarExpr.location, $.context);
        }
        return dollarExpr;
      }
    },
    // Fall back to base CSS parsing (CSS rules, at-rules, etc.)
    // qualifiedRule should NOT match mixin definitions (class/id/plain ident + LParen)
    {
      GATE: () => {
        const la1 = $.LA(1).tokenType;
        const la2 = $.LA(2).tokenType;
        // Exclude mixin definition pattern
        return !((la1 === T.DotName || la1 === T.HashName || la1 === T.PlainIdent) && la2 === T.LParen);
      },
      ALT: () => $.SUBRULE($.qualifiedRule)
    },
    { ALT: () => $.SUBRULE($.atRule) },
    // Allow stray semicolons at root (like SCSS)
    { ALT: () => $.CONSUME2(T.Semi) }
  ];

  return cssProductions.main.call(this, T, alt as any);
}
