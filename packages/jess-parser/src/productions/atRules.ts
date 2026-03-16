import type { JessRuleContext as RuleContext } from '../jessRecursiveParser.js';
import type { IToken } from '@jesscss/parser';
import { ScssRecursiveParser } from '@jesscss/scss-parser';
import {
  JsImport,
  Quoted,
  StyleImport
} from '@jesscss/core';

/** Use `any` for `this` to avoid structural incompatibility */
type P = any;

const scssUnknownAtRule = ScssRecursiveParser.prototype.unknownAtRule;

/**
 * `@-compose './file.jess' [as namespace];`
 * Produces StyleImport(type: 'compose').
 */
export function jessComposeAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  $.CONSUME($.T.AtKeyword); // @-compose
  const pathNode: Quoted = $.OR([
    { ALT: () => $.urlFunction(ctx) },
    { ALT: () => $.string(ctx) }
  ]) as unknown as Quoted;

  let namespace: string | undefined;
  if ($.LA(1).image === 'as') {
    $.CONSUME($.T.PlainIdent); // 'as'
    const nsTok = $.CONSUME($.T.PlainIdent) as unknown as IToken;
    namespace = nsTok.image;
  }

  $.CONSUME($.T.Semi);
  const loc = $.endRule();
  return new StyleImport(
    { path: pathNode },
    { type: 'compose', namespace, importOptions: {} },
    loc,
    $.context
  );
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
export function jessFromAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  $.CONSUME($.T.AtKeyword); // @-from
  const pathNode: Quoted = $.OR([
    { ALT: () => $.urlFunction(ctx) },
    { ALT: () => $.string(ctx) }
  ]) as unknown as Quoted;

  let namespace: string | undefined;
  const specifiers: Array<string | [string, string]> = [];

  if ($.LA(1).tokenType === $.T.PlainIdent && $.LA(1).image === 'import') {
    $.CONSUME($.T.PlainIdent); // 'import'
    if ($.LA(1).tokenType === $.T.Star) {
      // import * as namespace
      $.CONSUME($.T.Star);
      $.CONSUME($.T.PlainIdent); // 'as'
      const nsTok = $.CONSUME($.T.PlainIdent) as unknown as IToken;
      namespace = nsTok.image;
    } else {
      // import ( names ) or import { names }
      const isParens = $.LA(1).tokenType === $.T.LParen;
      if (isParens) {
        $.CONSUME($.T.LParen);
      } else {
        $.CONSUME($.T.LCurly);
      }
      $.OPTION(() => {
        $.AT_LEAST_ONE_SEP({
          SEP: $.T.Comma,
          DEF: () => {
            const nameTok = $.CONSUME($.T.PlainIdent) as unknown as IToken;
            const name = nameTok.image;
            if ($.LA(1).tokenType === $.T.PlainIdent && $.LA(1).image === 'as') {
              $.CONSUME($.T.PlainIdent); // 'as'
              const aliasTok = $.CONSUME($.T.PlainIdent) as unknown as IToken;
              specifiers.push([name, aliasTok.image]);
            } else {
              specifiers.push(name);
            }
          }
        });
      });
      if (isParens) {
        $.CONSUME($.T.RParen);
      } else {
        $.CONSUME($.T.RCurly);
      }
    }
  }

  $.CONSUME($.T.Semi);
  const loc = $.endRule();
  return new JsImport(
    { path: pathNode as any, ...(specifiers.length ? { imports: specifiers } : {}) },
    { namespace },
    loc,
    $.context
  );
}

/**
 * `@-export './file.jess' [as namespace];`
 * Produces StyleImport(type: 'compose', importOptions: { forward: true }).
 */
export function jessExportAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  $.CONSUME($.T.AtKeyword); // @-export
  const pathNode: Quoted = $.OR([
    { ALT: () => $.urlFunction(ctx) },
    { ALT: () => $.string(ctx) }
  ]) as unknown as Quoted;

  let namespace: string | undefined;
  if ($.LA(1).image === 'as') {
    $.CONSUME($.T.PlainIdent); // 'as'
    const nsTok = $.CONSUME($.T.PlainIdent) as unknown as IToken;
    namespace = nsTok.image;
  }

  $.CONSUME($.T.Semi);
  const loc = $.endRule();
  return new StyleImport(
    { path: pathNode },
    { type: 'compose', namespace, importOptions: { forward: true } },
    loc,
    $.context
  );
}

/**
 * Override unknownAtRule to dispatch Jess-specific dashed at-rules before
 * falling through to the SCSS handler.
 */
export function unknownAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  const img = $.LA(1).image;
  if (img === '@-compose') {
    return $.jessComposeAtRule(ctx);
  }
  if (img === '@-from') {
    return $.jessFromAtRule(ctx);
  }
  if (img === '@-export') {
    return $.jessExportAtRule(ctx);
  }
  return scssUnknownAtRule.call($, ctx);
}
