import type { JessRuleContext as RuleContext, TokenMap } from '../jessRecursiveParser.js';
import type { IToken } from 'chevrotain';
import { productions as cssProductions } from '@jesscss/css-parser';
import {
  JsImport,
  Quoted,
  StyleImport
} from '@jesscss/core';

/** Use `any` for `this` to avoid structural incompatibility */
type P = any;

/**
 * `@-compose './file.jess' [as namespace];`
 * Produces StyleImport(type: 'compose').
 */
export function jessComposeAtRule(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    $.CONSUME($.T.AtKeyword); // @-compose
    const pathNode: Quoted = $.OR([
      { ALT: () => $.SUBRULE($.urlFunction, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) }
    ]) as unknown as Quoted;

    let namespace: string | undefined;
    $.OPTION({
      GATE: () => $.LA(1).tokenType === $.T.PlainIdent && $.LA(1).image === 'as',
      DEF: () => {
        $.CONSUME($.T.PlainIdent); // 'as'
        const nsTok = $.CONSUME2($.T.PlainIdent) as unknown as IToken;
        namespace = nsTok.image;
      }
    });

    $.CONSUME($.T.Semi);
    const loc = $.endRule();
    return new StyleImport(
      { path: pathNode },
      { type: 'compose', namespace, importOptions: {} },
      loc,
      $.context
    );
  };
}

/**
 * `@-from './tokens.js' import ( name [as alias], ... );`
 * `@-from './tokens.js' import * as namespace;`
 * Produces JsImport.
 *
 * Both paren and brace forms accepted for named imports:
 *   `@-from './tokens.js' import ( primary, secondary )`
 *   `@-from './tokens.js' import { primary, secondary }`
 */
export function jessFromAtRule(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    $.CONSUME($.T.AtKeyword); // @-from
    const pathNode: Quoted = $.OR([
      { ALT: () => $.SUBRULE($.urlFunction, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) }
    ]) as unknown as Quoted;

    let namespace: string | undefined;
    const specifiers: Array<string | [string, string]> = [];

    $.OPTION({
      GATE: () => $.LA(1).tokenType === $.T.PlainIdent && $.LA(1).image === 'import',
      DEF: () => {
        $.CONSUME($.T.PlainIdent); // 'import'
        $.OR2([
          {
            GATE: () => $.LA(1).tokenType === $.T.Star,
            ALT: () => {
              $.CONSUME($.T.Star);
              $.CONSUME2($.T.PlainIdent); // 'as'
              const nsTok = $.CONSUME3($.T.PlainIdent) as unknown as IToken;
              namespace = nsTok.image;
            }
          },
          {
            ALT: () => {
              $.OR3([
                {
                  ALT: () => {
                    $.CONSUME($.T.LParen);
                    if ($.LA(1).tokenType !== $.T.RParen) {
                      $.AT_LEAST_ONE_SEP({
                        SEP: $.T.Comma,
                        DEF: () => {
                          const nameTok = $.CONSUME4($.T.PlainIdent) as unknown as IToken;
                          const name = nameTok.image;
                          let aliased = false;
                          $.OPTION2({
                            GATE: () => $.LA(1).tokenType === $.T.PlainIdent && $.LA(1).image === 'as',
                            DEF: () => {
                              aliased = true;
                              $.CONSUME5($.T.PlainIdent); // 'as'
                              const aliasTok = $.CONSUME6($.T.PlainIdent) as unknown as IToken;
                              specifiers.push([name, aliasTok.image]);
                            }
                          });
                          if (!aliased) {
                            specifiers.push(name);
                          }
                        }
                      });
                    }
                    $.CONSUME($.T.RParen);
                  }
                },
                {
                  ALT: () => {
                    $.CONSUME($.T.LCurly);
                    if ($.LA(1).tokenType !== $.T.RCurly) {
                      $.AT_LEAST_ONE_SEP({
                        SEP: $.T.Comma,
                        DEF: () => {
                          const nameTok = $.CONSUME7($.T.PlainIdent) as unknown as IToken;
                          const name = nameTok.image;
                          let aliased = false;
                          $.OPTION3({
                            GATE: () => $.LA(1).tokenType === $.T.PlainIdent && $.LA(1).image === 'as',
                            DEF: () => {
                              aliased = true;
                              $.CONSUME8($.T.PlainIdent); // 'as'
                              const aliasTok = $.CONSUME9($.T.PlainIdent) as unknown as IToken;
                              specifiers.push([name, aliasTok.image]);
                            }
                          });
                          if (!aliased) {
                            specifiers.push(name);
                          }
                        }
                      });
                    }
                    $.CONSUME($.T.RCurly);
                  }
                }
              ]);
            }
          }
        ]);
      }
    });

    $.CONSUME($.T.Semi);
    const loc = $.endRule();
    return new JsImport(
      { path: pathNode, ...(specifiers.length ? { imports: specifiers } : {}) },
      { namespace },
      loc,
      $.context
    );
  };
}

/**
 * `@-export './file.jess' [as namespace];`
 * Produces StyleImport(type: 'compose', importOptions: { forward: true }).
 */
export function jessExportAtRule(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    $.CONSUME($.T.AtKeyword); // @-export
    const pathNode: Quoted = $.OR([
      { ALT: () => $.SUBRULE($.urlFunction, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) }
    ]) as unknown as Quoted;

    let namespace: string | undefined;
    $.OPTION({
      GATE: () => $.LA(1).tokenType === $.T.PlainIdent && $.LA(1).image === 'as',
      DEF: () => {
        $.CONSUME($.T.PlainIdent); // 'as'
        const nsTok = $.CONSUME2($.T.PlainIdent) as unknown as IToken;
        namespace = nsTok.image;
      }
    });

    $.CONSUME($.T.Semi);
    const loc = $.endRule();
    return new StyleImport(
      { path: pathNode },
      { type: 'compose', namespace, importOptions: { forward: true } },
      loc,
      $.context
    );
  };
}

/**
 * Override unknownAtRule to dispatch Jess-specific dashed at-rules before
 * falling through to the SCSS handler.
 */
export function unknownAtRule(this: P, T: TokenMap) {
  const $ = this;
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
    if (img === '@use') {
      return $.SUBRULE($.scssUseAtRule, { ARGS: [ctx] });
    }
    if (img === '@forward') {
      return $.SUBRULE($.scssForwardAtRule, { ARGS: [ctx] });
    }
    if (img === '@extend') {
      return $.SUBRULE($.scssExtendAtRule, { ARGS: [ctx] });
    }
    if (img === '@content') {
      return $.SUBRULE($.scssContentAtRule, { ARGS: [ctx] });
    }
    if (img === '@if') {
      return $.SUBRULE($.scssIfAtRule, { ARGS: [ctx] });
    }
    if (img === '@for') {
      return $.SUBRULE($.scssForAtRule, { ARGS: [ctx] });
    }
    if (img === '@each') {
      return $.SUBRULE($.scssEachAtRule, { ARGS: [ctx] });
    }
    if (img === '@while') {
      return $.SUBRULE($.scssWhileAtRule, { ARGS: [ctx] });
    }
    if (img === '@include') {
      return $.SUBRULE($.scssIncludeAtRule, { ARGS: [ctx] });
    }
    if (img === '@mixin') {
      return $.SUBRULE($.scssMixinAtRule, { ARGS: [ctx] });
    }
    if (img === '@function') {
      return $.SUBRULE($.scssFunctionAtRule, { ARGS: [ctx] });
    }
    if (img === '@return') {
      return $.SUBRULE($.scssReturnAtRule, { ARGS: [ctx] });
    }
    if (img === '@debug' || img === '@warn' || img === '@error') {
      return $.SUBRULE($.scssDiagnosticAtRule, { ARGS: [ctx] });
    }
    if (img === '@at-root') {
      return $.SUBRULE($.scssAtRootAtRule, { ARGS: [ctx] });
    }
    return cssProductions.unknownAtRule.call($, $.T)(ctx);
  };
}
